import { DurableObject } from "cloudflare:workers";
import { MAX_OPTION_LEGS } from "./options";
import { createBrokerRequest, tastyToken, type BrokerBindings } from "./broker-context";
import { createCandleSnapshot } from "./candle-history";
import { readCandleFeed } from "./candle-feed";
import { streamFreshness } from "./stream-freshness";

type Selection = { underlying: string; contractIds: string[] };
type CapturedQuote = { bid: number; ask: number; bidTime: number; askTime: number; receivedAt: string };
type CapturedGreeks = { iv: number; time: number; receivedAt: string };
export type StreamCapture = { capturedAt: string; underlying: CapturedQuote; contracts: Array<{ contractId: string; quote: CapturedQuote; greeks: CapturedGreeks }> };
type LatestQuote = Omit<CapturedQuote, "bidTime" | "askTime"> & { bidTime: number | null; askTime: number | null };
type LatestGreeks = Omit<CapturedGreeks, "time"> & { time: number | null };
const CAPTURE_UNAVAILABLE = "Dated stream capture unavailable; refresh quotes.";
function validSelection(selection: Selection): boolean {
  return !!selection && typeof selection.underlying === "string" && /^[A-Z]{1,6}$/.test(selection.underlying) && Array.isArray(selection.contractIds) && selection.contractIds.length <= MAX_OPTION_LEGS && new Set(selection.contractIds).size === selection.contractIds.length && selection.contractIds.every(id => typeof id === "string" && id.length === 21 && id.slice(0, 6) === selection.underlying.padEnd(6) && /^\d{6}[CP]\d{8}$/.test(id.slice(6)));
}
class FeedProtocolError extends Error {}
const fields: Record<string, string[]> = { Quote: ["eventType", "eventSymbol", "bidPrice", "askPrice", "bidTime", "askTime"], Greeks: ["eventType", "eventSymbol", "volatility", "time"] };
const stamp = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= Date.now() ? value : null;
const symbolValid = (value: unknown): value is string => typeof value === "string" && value.length <= 128 && value.length > 0 && !/[\s\x00-\x1f]/.test(value);

function mapInstruments(selection: Selection, instruments: any[]) {
  const mapped = new Map<string, { id: string; option: boolean }>();
  instruments.forEach(({ data }, index) => {
    const id = index === 0 ? selection.underlying : selection.contractIds[index - 1];
    if (data?.symbol !== id || !symbolValid(data?.["streamer-symbol"])) throw new Error("Invalid instrument");
    if (index > 0 && (data["underlying-symbol"] !== selection.underlying || data["root-symbol"] !== selection.underlying || data["shares-per-contract"] !== 100 || data["option-chain-type"] !== "Standard" || data["exercise-style"] !== "American" || data["settlement-type"] !== "PM" || data["option-type"] !== id[12] || Number(data["strike-price"]) !== Number(id.slice(13)) / 1000 || typeof data["expiration-date"] !== "string" || data["expiration-date"].slice(2).replaceAll("-", "") !== id.slice(6, 12))) throw new Error("Invalid option");
    if (mapped.has(data["streamer-symbol"])) throw new Error("Duplicate identity");
    mapped.set(data["streamer-symbol"], { id, option: index > 0 });
  });
  return mapped;
}

export function createQuoteRelay(env: BrokerBindings, fetcher: typeof fetch = fetch) {
  const request = createBrokerRequest(fetcher);
  const clients = new Map<WebSocket, Map<string, { id: string; option: boolean }>>();
  const leases = new Map<WebSocket, { expiresAt: number; timer?: ReturnType<typeof setTimeout> }>();
  const latest = new Map<string, { quote?: LatestQuote; greeks?: LatestGreeks }>();
  const sourceTimes = new Map<string, { bid?: number; ask?: number; iv?: number }>();
  let upstream: WebSocket | undefined;
  let connecting: Promise<void> | undefined;
  let auth: Promise<string> | undefined;
  let historyBusy = false;
  let generation = 0;
  let phase = "idle";
  let config: Record<string, string[]> = {};
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let startup: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let healthySince: number | undefined;
  let attempts = 0;
  let lastMessage = 0;
  const send = (socket: WebSocket, value: unknown) => { if (!clients.has(socket) || active(socket)) socket.send(JSON.stringify(value)); };
  const status = (socket: WebSocket, state: string) => send(socket, { type: "status", state, message: state === "connected" ? "Feed connected; event timestamps determine freshness." : state === "connecting" ? "Connecting market feed." : state === "reconnecting" ? "Feed interrupted; bounded automatic recovery in progress." : "Market feed unavailable; reconnect explicitly." });
  async function token() {
    if (auth) return auth;
    const pending = tastyToken(env, request);
    auth = pending;
    try { return await pending; } finally { if (auth === pending) auth = undefined; }
  }
  function discard(response: Response) {
    try { response.webSocket?.accept(); } catch {}
    try { response.webSocket?.close(1000, "Feed stopped"); } catch {}
  }
  function stop(reset = true) {
    generation++;
    clearInterval(keepalive); clearTimeout(startup); clearTimeout(retry); retry = undefined; healthySince = undefined;
    if (reset) attempts = 0;
    const socket = upstream;
    upstream = undefined; connecting = undefined; phase = "idle"; config = {};
    latest.clear();
    sourceTimes.clear();
    try { socket?.close(1000, "Feed stopped"); } catch {}
  }
  function remove(socket: WebSocket) {
    clearTimeout(leases.get(socket)?.timer); leases.delete(socket);
    if (!clients.delete(socket)) return;
    if (!clients.size) stop(); else subscribe();
  }
  function active(socket: WebSocket): boolean {
    if (!clients.has(socket)) return false;
    const lease = leases.get(socket);
    if (lease && Date.now() < lease.expiresAt) return true;
    try { socket.close(1008, "Session expired; reconnect to authenticate"); } catch {}
    remove(socket);
    return false;
  }
  function scheduleExpiry(socket: WebSocket) {
    if (!active(socket)) return;
    const lease = leases.get(socket)!;
    lease.timer = setTimeout(() => scheduleExpiry(socket), Math.min(2_147_483_647, Math.max(1, lease.expiresAt - Date.now())));
  }
  function unavailable(socket: WebSocket) {
    try { status(socket, "unavailable"); socket.close(1011, "Feed unavailable"); } catch {}
    remove(socket);
  }
  function fail() {
    for (const socket of [...clients.keys()]) unavailable(socket);
    if (upstream || connecting) stop();
  }
  function recover() {
    if (retry || !clients.size) return;
    if (attempts >= 3) { fail(); return; }
    stop(false);
    for (const client of [...clients.keys()]) {
      try { status(client, "reconnecting"); } catch { remove(client); }
    }
    if (!clients.size) return;
    const delay = 1_000 * 2 ** attempts++ + Math.floor(Math.random() * 251);
    retry = setTimeout(() => { retry = undefined; void connect(); }, delay);
  }
  function subscribe() {
    const active = new Set([...clients.values()].flatMap(selection => [...selection.values()].map(item => item.id)));
    for (const id of latest.keys()) if (!active.has(id)) { latest.delete(id); sourceTimes.delete(id); }
    if (!upstream || !["channel", "ready"].includes(phase)) return;
    const union = new Map<string, boolean>();
    for (const selection of clients.values()) for (const [symbol, item] of selection) union.set(symbol, item.option);
    try { send(upstream, { type: "FEED_SUBSCRIPTION", channel: 3, reset: true, add: [...union].flatMap(([symbol, option]) => [{ type: "Quote", symbol }, ...(option ? [{ type: "Greeks", symbol }] : [])]) }); } catch { recover(); }
  }
  async function connect(): Promise<void> {
    if (retry || upstream || connecting) return connecting;
    const epoch = generation;
    const pending = (async () => {
      const access = await token();
      const data = (await request("https://api.tastyworks.com/api-quote-tokens", { headers: { Authorization: `Bearer ${access}`, "User-Agent": "argus/0.1" } })).data;
      const endpoint = new URL(data?.["dxlink-url"]);
      if (endpoint.protocol !== "wss:" || !endpoint.hostname.endsWith(".dxfeed.com") || endpoint.username || endpoint.password || typeof data?.token !== "string" || !data.token || data.token.length > 16_384 || /[\s\x00-\x1f]/.test(data.token)) throw new FeedProtocolError("Invalid feed metadata");
      if (epoch !== generation || !clients.size) return;
      endpoint.protocol = "https:";
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let response: Response;
      try {
        response = await Promise.race([fetcher(endpoint.toString(), { headers: { Upgrade: "websocket" }, redirect: "manual", signal: controller.signal }).then(value => {
          if (epoch !== generation || controller.signal.aborted) discard(value);
          return value;
        }), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Feed timeout")); }, 5_000); })]);
      } finally { clearTimeout(timer); }
      if (epoch !== generation || !clients.size) { discard(response); return; }
      if (response.status !== 101 || !response.webSocket) throw new Error("Feed upgrade failed");
      const socket = response.webSocket;
      upstream = socket; socket.accept(); phase = "setup"; lastMessage = Date.now();
      startup = setTimeout(() => { if (epoch === generation && phase !== "ready") recover(); }, 10_000);
      keepalive = setInterval(() => {
        if (epoch !== generation) return;
        if (Date.now() - lastMessage > 65_000) { recover(); return; }
        try { send(socket, { type: "KEEPALIVE", channel: 0 }); } catch { recover(); }
      }, 30_000);
      socket.addEventListener("close", () => { if (epoch === generation) recover(); });
      socket.addEventListener("error", () => { if (epoch === generation) recover(); });
      socket.addEventListener("message", event => {
        if (epoch !== generation) return;
        try {
          if (typeof event.data !== "string" || new TextEncoder().encode(event.data).length > 131_072) throw new Error("Invalid frame");
          const message = JSON.parse(event.data);
          if (message.type === "SETUP") {
            if (phase !== "setup" || message.channel !== 0) throw new Error("Invalid setup");
            phase = "unauthorized";
          } else if (message.type === "AUTH_STATE") {
            if (message.channel !== 0) throw new Error("Invalid auth channel");
            if (message.state === "UNAUTHORIZED" && phase === "unauthorized") {
              phase = "auth"; send(socket, { type: "AUTH", channel: 0, token: data.token });
            } else if (message.state === "AUTHORIZED" && phase === "auth") {
              phase = "opening"; send(socket, { type: "CHANNEL_REQUEST", channel: 3, service: "FEED", parameters: { contract: "AUTO" } });
            } else throw new Error("Invalid auth");
          } else if (message.type === "CHANNEL_OPENED") {
            if (phase !== "opening" || message.channel !== 3) throw new Error("Invalid channel");
            phase = "channel";
            send(socket, { type: "FEED_SETUP", channel: 3, acceptAggregationPeriod: 0.1, acceptDataFormat: "COMPACT", acceptEventFields: fields });
            subscribe();
          } else if (message.type === "FEED_CONFIG") {
            if (!["channel", "ready"].includes(phase) || message.channel !== 3 || message.dataFormat !== "COMPACT" || message.eventFields !== undefined && (!message.eventFields || typeof message.eventFields !== "object" || Array.isArray(message.eventFields))) throw new Error("Invalid configuration");
            for (const [type, names] of Object.entries(message.eventFields ?? {})) {
              if (!fields[type] || !Array.isArray(names) || names.length !== fields[type].length || new Set(names).size !== names.length || fields[type].some(name => !names.includes(name))) throw new Error("Invalid fields");
              config[type] = names;
            }
            if (config.Quote) {
              if (phase !== "ready") healthySince = Date.now();
              phase = "ready"; clearTimeout(startup);
              for (const [client, selection] of clients) if (selection.size) status(client, "connected");
            }
          } else if (message.type === "FEED_DATA") {
            if (!["channel", "ready"].includes(phase) || message.channel !== 3 || !Array.isArray(message.data) || message.data.length % 2) throw new Error("Invalid data");
            for (let i = 0; i < message.data.length; i += 2) {
              const type = message.data[i], names = config[type], values = message.data[i + 1];
              if (!names || !Array.isArray(values) || values.length % names.length) throw new Error("Invalid compact data");
              for (let j = 0; j < values.length; j += names.length) {
                const value = Object.fromEntries(names.map((name, index) => [name, values[j + index]]));
                if (value.eventType !== type || !symbolValid(value.eventSymbol)) throw new Error("Invalid event");
                let normalized: ({ type: "quote" } & Omit<LatestQuote, "receivedAt">) | ({ type: "greeks" } & Omit<LatestGreeks, "receivedAt">);
                if (type === "Quote") {
                  if (typeof value.bidPrice !== "number" || typeof value.askPrice !== "number" || !Number.isFinite(value.bidPrice) || !Number.isFinite(value.askPrice) || value.bidPrice < 0 || value.askPrice <= 0 || value.askPrice < value.bidPrice || value.askPrice > 100_000) throw new Error("Invalid quote");
                  normalized = { type: "quote", bid: value.bidPrice, ask: value.askPrice, bidTime: stamp(value.bidTime), askTime: stamp(value.askTime) };
                } else {
                  if (typeof value.volatility !== "number" || !Number.isFinite(value.volatility) || value.volatility <= 0 || value.volatility > 10) throw new Error("Invalid Greeks");
                  normalized = { type: "greeks", iv: value.volatility, time: stamp(value.time) };
                }
                for (const [client, selection] of clients) {
                  if (!active(client)) continue;
                  const selected = selection.get(value.eventSymbol);
                  if (selected && (type === "Quote" || selected.option)) {
                    const previous = sourceTimes.get(selected.id);
                    const regressed = (next: number | null, before: number | null | undefined) => next !== null && before != null && next < before;
                    if (normalized.type === "quote"
                      ? regressed(normalized.bidTime, previous?.bid) || regressed(normalized.askTime, previous?.ask)
                      : regressed(normalized.time, previous?.iv)) throw new FeedProtocolError("Source time regressed; reconnect required");
                    sourceTimes.set(selected.id, normalized.type === "quote"
                      ? { ...previous, bid: normalized.bidTime ?? previous?.bid, ask: normalized.askTime ?? previous?.ask }
                      : { ...previous, iv: normalized.time ?? previous?.iv });
                    const receivedAt = new Date().toISOString();
                    const { type: kind, ...mark } = normalized;
                    latest.set(selected.id, { ...latest.get(selected.id), [kind]: { ...mark, receivedAt } });
                    send(client, { ...normalized, contractId: selected.id, receivedAt });
                  }
                }
              }
            }
          } else if (message.type !== "KEEPALIVE" || message.channel !== 0) throw new Error("Unexpected feed message");
          lastMessage = Date.now();
          if (phase === "ready" && healthySince !== undefined && lastMessage - healthySince >= 60_000) attempts = 0;
        } catch { fail(); }
      });
      send(socket, { type: "SETUP", channel: 0, version: "0.1-DXF-JS/0.3.0", keepaliveTimeout: 60, acceptKeepaliveTimeout: 60 });
    })();
    connecting = pending;
    try { await pending; } catch (error) {
      if (epoch === generation) { if (error instanceof FeedProtocolError) fail(); else recover(); }
    } finally { if (connecting === pending) connecting = undefined; }
  }
  return {
    async history(selection: Selection, range: { start: number; end: number }, expiresAt: number, mode: 'price' | 'iv' = 'price') {
      if (!validSelection(selection) || mode === 'iv' && !selection.contractIds.length || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new Error("Invalid history selection or session deadline");
      selection = { underlying: selection.underlying, contractIds: [...selection.contractIds] };
      range = { start: range?.start, end: range?.end };
      createCandleSnapshot([selection.underlying], range, mode);
      if (historyBusy) throw new Error("History request already in progress");
      historyBusy = true;
      const deadline = Math.min(expiresAt, Date.now() + 45_000), controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const check = () => { if (controller.signal.aborted || Date.now() >= deadline) { controller.abort(); throw new Error("History deadline exceeded"); } };
      const historyRequest = createBrokerRequest(async (url, init) => {
        check();
        return fetcher(url, { ...init, signal: AbortSignal.any([controller.signal, ...(init?.signal ? [init.signal] : [])]) });
      });
      try {
        return await Promise.race([(async () => {
          const access = await token(); check();
          const get = (path: string) => historyRequest(`https://api.tastyworks.com${path}`, { headers: { Authorization: `Bearer ${access}`, "User-Agent": "argus/0.1" } });
          const instruments = await Promise.all([get(`/instruments/equities/${selection.underlying}`), ...selection.contractIds.map(id => get(`/instruments/equity-options/${encodeURIComponent(id)}`))]);
          check();
          const mapped = [...mapInstruments(selection, instruments)];
          if (mapped.some(([symbol]) => /[{}]/.test(symbol))) throw new Error("Invalid candle instrument");
          if (mode === 'iv') {
            const options = mapped.filter(([, item]) => item.option), symbols = options.map(([symbol]) => `${symbol}{=5m}`);
            const { data } = await get('/api-quote-tokens'); check();
            const rows = await readCandleFeed(fetcher, data?.['dxlink-url'], data?.token, symbols, range, controller.signal, 'iv'); check();
            return { contracts: options.map(([, item], index) => ({ contractId: item.id, basis: 'trade-candle' as const, bars: rows[symbols[index]] })) };
          }
          const symbols = mapped.map(([symbol, item]) => `${symbol}${item.option ? '{=5m,price=mark}' : '{=5m}'}`);
          const { data } = await get('/api-quote-tokens'); check();
          const rows = await readCandleFeed(fetcher, data?.['dxlink-url'], data?.token, symbols, range, controller.signal); check();
          return {
            underlying: { symbol: selection.underlying, basis: 'last-trade' as const, bars: rows[symbols[0]] },
            contracts: mapped.slice(1).map(([, item], index) => ({ contractId: item.id, basis: 'midpoint' as const, bars: rows[symbols[index + 1]] })),
          };
        })(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("History deadline exceeded")); }, Math.max(1, deadline - Date.now())); })]);
      } finally { clearTimeout(timer); controller.abort(); historyBusy = false; }
    },
    capture(selection: Selection): StreamCapture {
      for (const socket of clients.keys()) active(socket);
      if (!validSelection(selection) || phase !== "ready") throw new Error(CAPTURE_UNAVAILABLE);
      const subscribed = [...clients.values()].flatMap(mapped => [...mapped.values()]);
      if (!subscribed.some(item => item.id === selection.underlying && !item.option) || selection.contractIds.some(id => !subscribed.some(item => item.id === id && item.option))) throw new Error(CAPTURE_UNAVAILABLE);
      const now = Date.now(), times: number[] = [], receipts: number[] = [];
      const source = (time: number | null) => {
        if (time === null) throw new Error(CAPTURE_UNAVAILABLE);
        times.push(time); return time;
      };
      const receipt = (value: string) => {
        receipts.push(Date.parse(value));
      };
      const quote = (id: string): CapturedQuote => {
        const value = latest.get(id)?.quote;
        if (!value) throw new Error(CAPTURE_UNAVAILABLE);
        receipt(value.receivedAt);
        return { ...value, bidTime: source(value.bidTime), askTime: source(value.askTime) };
      };
      const underlying = quote(selection.underlying);
      const contracts = selection.contractIds.map(contractId => {
        const value = latest.get(contractId)?.greeks;
        if (!value) throw new Error(CAPTURE_UNAVAILABLE);
        receipt(value.receivedAt);
        return { contractId, quote: quote(contractId), greeks: { ...value, time: source(value.time) } };
      });
      if (streamFreshness(times, receipts, now) !== 'ready') throw new Error(CAPTURE_UNAVAILABLE);
      return { capturedAt: new Date(now).toISOString(), underlying, contracts };
    },
    async attach(socket: WebSocket, selection: Selection, expiresAt: number) {
      try {
        if (!validSelection(selection) || clients.size >= 32 || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new Error("Invalid selection or session deadline");
        clients.set(socket, new Map());
        leases.set(socket, { expiresAt });
        scheduleExpiry(socket);
        socket.addEventListener("close", () => remove(socket)); socket.addEventListener("error", () => remove(socket));
        socket.addEventListener("message", () => unavailable(socket));
        status(socket, retry ? "reconnecting" : "connecting");
        const access = await token();
        if (!active(socket)) return;
        const get = (path: string) => request(`https://api.tastyworks.com${path}`, { headers: { Authorization: `Bearer ${access}`, "User-Agent": "argus/0.1" } });
        const instruments = await Promise.all([get(`/instruments/equities/${selection.underlying}`), ...selection.contractIds.map(id => get(`/instruments/equity-options/${encodeURIComponent(id)}`))]);
        if (!active(socket)) return;
        const mapped = mapInstruments(selection, instruments);
        clients.set(socket, mapped);
        await connect();
        if (!active(socket)) return;
        subscribe();
        if (phase === "ready") status(socket, "connected");
      } catch { unavailable(socket); }
    },
  };
}

export class QuoteFeed extends DurableObject<BrokerBindings> {
  private relay = createQuoteRelay(this.env);
  async fetch(request: Request): Promise<Response> {
    const capture = request.method === "POST" && new URL(request.url).pathname === "/capture";
    const iv = new URL(request.url).pathname === '/history-iv';
    const history = request.method === "POST" && (new URL(request.url).pathname === "/history" || iv);
    if (!capture && !history && (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket")) return new Response("WebSocket required", { status: 426 });
    const header = request.headers.get("X-ARGUS-Feed-Selection");
    if (!header || header.length > 512) return new Response("Invalid selection", { status: 400 });
    let selection: Selection;
    try { selection = JSON.parse(header); if (!validSelection(selection)) throw new Error("Invalid selection"); } catch { return new Response("Invalid selection", { status: 400 }); }
    if (capture) {
      try { return Response.json(this.relay.capture(selection)); } catch { return Response.json({ error: CAPTURE_UNAVAILABLE }, { status: 409 }); }
    }
    const deadline = request.headers.get("X-ARGUS-Feed-Expires-At"), expiresAt = Number(deadline);
    if (!deadline || !Number.isSafeInteger(expiresAt) || String(expiresAt) !== deadline || expiresAt <= Date.now()) return new Response("Invalid session deadline", { status: 401 });
    if (history) {
      const header = request.headers.get('X-ARGUS-History-Range');
      let range: { start: number; end: number };
      try {
        if (!header || header.length > 128) throw new Error();
        range = JSON.parse(header);
        if (!range || typeof range !== 'object' || Object.keys(range).sort().join() !== 'end,start') throw new Error();
        createCandleSnapshot([selection.underlying], range);
      } catch { return new Response('Invalid history range', { status: 400 }); }
      try { return Response.json(await this.relay.history(selection, range, expiresAt, iv ? 'iv' : 'price'), { headers: { 'Cache-Control': 'no-store' } }); }
      catch { return Response.json({ error: 'Candle history unavailable or busy' }, { status: 503 }); }
    }
    const pair = new WebSocketPair();
    pair[1].accept();
    this.ctx.waitUntil(this.relay.attach(pair[1], selection, expiresAt));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
}
