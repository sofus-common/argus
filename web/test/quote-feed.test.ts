import { expect, it, vi } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import { createQuoteRelay } from "../src/quote-feed";

const env = { TASTYTRADE_CLIENT_SECRET: "private-secret", TASTYTRADE_REFRESH_TOKEN: "private-refresh" };
const contractId = "SPY   260918C00100000";
const selection = { underlying: "SPY", contractIds: [contractId] };
const fields = { Quote: ["eventType", "eventSymbol", "bidPrice", "askPrice", "bidTime", "askTime"], Greeks: ["eventType", "eventSymbol", "volatility", "time"] };
function fixture(partialConfig = false, silent = false, candleReply = false, cashIndex = false, indexOnly = false) {
  const upstreams: WebSocket[] = [];
  const receivers: WebSocket[] = [];
  const subscriptions: any[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "test.dxfeed.com") {
      const pair = new WebSocketPair();
      pair[1].accept(); upstreams.push(pair[1]); receivers.push(pair[0]);
      let candleFields: string[] = [];
      pair[1].addEventListener("message", event => {
        if (silent) return;
        const message = JSON.parse(String(event.data));
        if (message.type === "SETUP") {
          pair[1].send(JSON.stringify({ type: "SETUP", channel: 0 }));
          pair[1].send(JSON.stringify({ type: "AUTH_STATE", channel: 0, state: "UNAUTHORIZED" }));
        } else if (message.type === "AUTH") pair[1].send(JSON.stringify({ type: "AUTH_STATE", channel: 0, state: "AUTHORIZED" }));
        else if (message.type === "CHANNEL_REQUEST") pair[1].send(JSON.stringify({ type: "CHANNEL_OPENED", channel: 3 }));
        else if (message.type === "FEED_SETUP") {
          candleFields = message.acceptEventFields?.Candle ?? [];
          if (message.acceptEventFields?.Candle) pair[1].send(JSON.stringify({ type: "FEED_CONFIG", channel: 3, dataFormat: "COMPACT", eventFields: { Candle: message.acceptEventFields.Candle } }));
          else if (partialConfig) {
            pair[1].send(JSON.stringify({ type: "FEED_CONFIG", channel: 3, dataFormat: "COMPACT", eventFields: {} }));
            pair[1].send(JSON.stringify({ type: "FEED_CONFIG", channel: 3, dataFormat: "COMPACT", eventFields: { Quote: fields.Quote } }));
            pair[1].send(JSON.stringify({ type: "FEED_DATA", channel: 3, data: ["Quote", ["Quote", ".SPY260918C100", 1, 2, 0, 0]] }));
            pair[1].send(JSON.stringify({ type: "FEED_CONFIG", channel: 3, dataFormat: "COMPACT", eventFields: { Greeks: fields.Greeks } }));
            pair[1].send(JSON.stringify({ type: "FEED_DATA", channel: 3, data: ["Greeks", ["Greeks", ".SPY260918C100", 0.25, 0]] }));
          } else pair[1].send(JSON.stringify({ type: "FEED_CONFIG", channel: 3, dataFormat: "COMPACT", eventFields: { ...(indexOnly ? {} : fields), ...(cashIndex ? { Trade: ["eventType", "eventSymbol", "time", "price"] } : {}) } }));
        }
        else if (message.type === "FEED_SUBSCRIPTION") {
          subscriptions.push(message);
          if (candleReply && message.add.every((item: any) => item.type === "Candle")) {
            const names = candleFields;
            pair[1].send(JSON.stringify({ type: "FEED_DATA", channel: 3, data: ["Candle", message.add.flatMap((item: any) => {
              const bar: Record<string, unknown> = { eventType: "Candle", eventSymbol: item.symbol, eventFlags: 12, time: item.fromTime, sequence: 0, count: 1, open: 1, high: 2, low: 1, close: 2, volume: "NaN" };
              return names.map(name => name === 'impVolatility' ? .25 : bar[name]);
            })] }));
          }
        }
      });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === "/oauth/token") {
      expect(JSON.parse(String(init?.body)).scope).toBe("read");
      return Response.json({ access_token: "private-access" });
    }
    if (url.pathname === "/api-quote-tokens") return Response.json({ data: { token: "private-quote-token".repeat(100), "dxlink-url": "wss://test.dxfeed.com/feed" } });
    if (url.pathname === "/instruments/equities/SPY") return Response.json({ data: { symbol: "SPY", "streamer-symbol": "SPY" } });
    if (cashIndex && url.pathname === "/instruments/equities/XSP") return Response.json({ data: { symbol: "XSP", "streamer-symbol": "XSP", "is-index": true, "instrument-sub-type": "INDEX" } });
    const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
    if (cashIndex && id.startsWith("XSP   ")) return Response.json({ data: { symbol: id, "streamer-symbol": ".XSP260918C100", "underlying-symbol": "XSP", "root-symbol": "XSP", "shares-per-contract": 100, "option-chain-type": "Standard", "exercise-style": "European", "settlement-type": "PM", "option-type": "C", "strike-price": "100", "expiration-date": "2026-09-18" } });
    return Response.json({ data: { symbol: id, "streamer-symbol": `.SPY260918${id[12]}${Number(id.slice(13)) / 1000}`, "underlying-symbol": "SPY", "root-symbol": "SPY", "shares-per-contract": 100, "option-chain-type": "Standard", "exercise-style": "American", "settlement-type": "PM", "option-type": id[12], "strike-price": String(Number(id.slice(13)) / 1000), "expiration-date": "2026-09-18" } });
  });
  return { fetcher, upstreams, receivers, subscriptions };
}
function client() {
  const pair = new WebSocketPair();
  pair[0].accept(); pair[1].accept();
  const messages: any[] = [];
  pair[0].addEventListener("message", event => { messages.push(JSON.parse(String(event.data))); });
  return { socket: pair[1], browser: pair[0], messages };
}

function captureEvents(socket: WebSocket, time = Date.now(), greekTime = time) {
  socket.send(JSON.stringify({ type: "FEED_DATA", channel: 3, data: ["Quote", ["Quote", "SPY", 99, 101, time, time, "Quote", ".SPY260918C100", 1, 2, time, time], "Greeks", ["Greeks", ".SPY260918C100", 0.25, greekTime]] }));
}

const indexSelection = { underlying: "XSP", underlyingKind: "cash-index" as const, contractIds: ["XSP   260918C00100000"] };
function indexEvents(socket: WebSocket, time = Date.now(), price = 100, optionTime = time) {
  socket.send(JSON.stringify({ type: "FEED_DATA", channel: 3, data: ["Trade", ["Trade", "XSP", time, price], "Quote", ["Quote", ".XSP260918C100", 1, 2, optionTime, optionTime], "Greeks", ["Greeks", ".XSP260918C100", .25, optionTime]] }));
}

it("acquires a fresh index-only event through the shared relay and preserves its source time", async () => {
  const f = fixture(false, false, false, true, true), relay = createQuoteRelay(env, f.fetcher);
  const pending = relay.indexLevel("XSP", Date.now() + 60_000);
  await vi.waitFor(() => expect(f.subscriptions.at(-1)?.add).toEqual([{ type: "Trade", symbol: "XSP" }]));
  expect(f.fetcher.mock.calls.some(([url]) => String(url).includes("/equity-options/"))).toBe(false);
  const time = Date.now() - 1000;
  f.upstreams[0].send(JSON.stringify({ type: "FEED_DATA", channel: 3, data: ["Trade", ["Trade", "XSP", time, 100]] }));
  expect(await pending).toEqual({ kind: "index", price: 100, time, receivedAt: expect.any(String) });
  await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
});

it("readies an index-only subscription from Trade configuration without weakening option capture", async () => {
  const f = fixture(false, false, false, true, true), relay = createQuoteRelay(env, f.fetcher), a = client();
  const selected = { ...indexSelection, contractIds: [] };
  try {
    await relay.attach(a.socket, selected, Date.now() + 60_000);
    await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("connected"));
    const time = Date.now() - 1000;
    f.upstreams[0].send(JSON.stringify({ type: "FEED_DATA", channel: 3, data: ["Trade", ["Trade", "XSP", time, 100]] }));
    await vi.waitFor(() => expect(relay.capture(selected).underlying).toMatchObject({ kind: "index", time }));
    expect(() => relay.capture(indexSelection)).toThrow();
  } finally { a.browser.close(1000); }
});

it("ignores unknown, stale and future initial index times while preserving a shared client", async () => {
  const f = fixture(false, false, false, true), relay = createQuoteRelay(env, f.fetcher), a = client();
  try {
    await relay.attach(a.socket, selection, Date.now() + 60_000);
    await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("connected"));
    let settled = false;
    const pending = relay.indexLevel("XSP", Date.now() + 60_000).then(value => { settled = true; return value; });
    await vi.waitFor(() => expect(f.subscriptions.at(-1)?.add).toContainEqual({ type: "Trade", symbol: "XSP" }));
    for (const time of [0, Date.now() - 300_001, Date.now() + 60_000]) {
      f.upstreams[0].send(JSON.stringify({ type: "FEED_DATA", channel: 3, data: ["Trade", ["Trade", "XSP", time, 100]] }));
      const count = a.messages.length;
      captureEvents(f.upstreams[0]);
      await vi.waitFor(() => expect(a.messages.length).toBeGreaterThan(count));
      expect(settled).toBe(false);
    }
    const time = Date.now() - 1000;
    f.upstreams[0].send(JSON.stringify({ type: "FEED_DATA", channel: 3, data: ["Trade", ["Trade", "XSP", time, 100]] }));
    expect(await pending).toMatchObject({ kind: "index", time });
    await vi.waitFor(() => expect(f.subscriptions.at(-1)?.add).not.toContainEqual({ type: "Trade", symbol: "XSP" }));
    expect(f.upstreams).toHaveLength(1);
    expect(f.upstreams[0].readyState).toBe(WebSocket.OPEN);
    expect(() => relay.capture(selection)).not.toThrow();
  } finally { a.browser.close(1000); }
});

it("times out silent initial index acquisition at ten seconds and closes its shared connection", async () => {
  const f = fixture(false, false, false, true, true), relay = createQuoteRelay(env, f.fetcher);
  vi.useFakeTimers();
  try {
    const pending = relay.indexLevel("XSP", Date.now() + 60_000), rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(f.subscriptions.at(-1)?.add).toEqual([{ type: "Trade", symbol: "XSP" }]));
    await vi.advanceTimersByTimeAsync(10_000); await rejected;
    await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
    expect(f.upstreams).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it("rejects invalid initial index selections and deadlines before provider access", async () => {
  const f = fixture(), relay = createQuoteRelay(env, f.fetcher);
  for (const symbol of ["", "xsp", "XSP/", null]) await expect(relay.indexLevel(symbol as string, Date.now() + 60_000)).rejects.toThrow();
  for (const deadline of [0, NaN, Infinity, Date.now() - 1]) await expect(relay.indexLevel("XSP", deadline)).rejects.toThrow();
  expect(f.fetcher).not.toHaveBeenCalled();
  const stub = (workerEnv as { FEED: DurableObjectNamespace }).FEED.getByName(crypto.randomUUID());
  const headers = { "X-ARGUS-Feed-Selection": JSON.stringify({ ...indexSelection, contractIds: [] }), "X-ARGUS-Feed-Expires-At": String(Date.now() + 60_000) };
  for (const selected of [selection, indexSelection, { ...indexSelection, contractIds: [], extra: true }]) {
    expect((await stub.fetch(new Request("https://feed.internal/index-level", { method: "POST", headers: { ...headers, "X-ARGUS-Feed-Selection": JSON.stringify(selected) } }))).status).toBe(400);
  }
  for (const deadline of ["", "NaN", "Infinity", String(Date.now() - 1), "1e20"]) {
    expect((await stub.fetch(new Request("https://feed.internal/index-level", { method: "POST", headers: { ...headers, "X-ARGUS-Feed-Expires-At": deadline } }))).status).toBe(401);
  }
});

it("bounds pending initial index metadata by the session without reviving a late socket", async () => {
  const f = fixture(false, false, false, true); let release!: () => void, started = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetcher = vi.fn<typeof fetch>(async (url, init) => { if (String(url).includes("/instruments/")) { started = true; await gate; } return f.fetcher(url, init); });
  const relay = createQuoteRelay(env, fetcher);
  vi.useFakeTimers();
  try {
    const pending = relay.indexLevel("XSP", Date.now() + 1000), rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(started).toBe(true));
    await vi.advanceTimersByTimeAsync(1000); await rejected;
    release(); await vi.advanceTimersByTimeAsync(0);
    expect(f.upstreams).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally { release(); vi.useRealTimers(); }
});

it("subscribes typed index values, captures their original time and isolates equity events", async () => {
  const f = fixture(false, false, false, true), relay = createQuoteRelay(env, f.fetcher), a = client(), b = client();
  try {
    await relay.attach(a.socket, indexSelection, Date.now() + 60_000);
    await relay.attach(b.socket, selection, Date.now() + 60_000);
    await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("connected"));
    await vi.waitFor(() => expect(b.messages.at(-1)?.state).toBe("connected"));
    expect(f.subscriptions.at(-1).add).toEqual(expect.arrayContaining([{ type: "Trade", symbol: "XSP" }, { type: "Quote", symbol: ".XSP260918C100" }, { type: "Greeks", symbol: ".XSP260918C100" }, { type: "Quote", symbol: "SPY" }]));
    expect(f.subscriptions.at(-1).add).not.toContainEqual({ type: "Quote", symbol: "XSP" });
    const time = Date.now() - 1000;
    indexEvents(f.upstreams[0], time);
    captureEvents(f.upstreams[0], time);
    await vi.waitFor(() => expect(() => relay.capture(indexSelection)).not.toThrow());
    expect(relay.capture(indexSelection).underlying).toEqual({ kind: "index", price: 100, time, receivedAt: expect.any(String) });
    expect(a.messages).toContainEqual({ type: "index", price: 100, time, receivedAt: expect.any(String), contractId: "XSP" });
    expect(() => relay.capture({ underlying: "XSP", contractIds: indexSelection.contractIds })).toThrow();
    f.upstreams[0].send(JSON.stringify({ type: "FEED_DATA", channel: 3, data: ["Quote", ["Quote", "XSP", 98, 102, time, time], "Trade", ["Trade", "SPY", time, 999], "Quote", ["Quote", ".SPY260918C100", 1.5, 2, time, time]] }));
    await vi.waitFor(() => expect(relay.capture(selection).contracts[0].quote.bid).toBe(1.5));
    expect(relay.capture(selection).underlying).toMatchObject({ bid: 99, ask: 101 });
    expect(relay.capture(indexSelection).underlying).toMatchObject({ kind: "index", price: 100 });
    expect(a.messages.some(message => message.type === "quote" && message.contractId === "XSP")).toBe(false);
    expect(b.messages.some(message => message.type === "index")).toBe(false);
  } finally { a.browser.close(1000); b.browser.close(1000); }
  await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
});

it("rejects unqualified index metadata, kind contradictions and index candle history", async () => {
  for (const [selected, mutation] of [
    [{ ...indexSelection, underlyingKind: "other" }, {}],
    [{ ...indexSelection, underlyingKind: null }, {}],
    [{ underlying: "XSP", contractIds: indexSelection.contractIds }, {}],
    [selection, { "is-index": true }],
    [selection, { "instrument-sub-type": "INDEX" }],
    [indexSelection, { "is-index": false }],
    [indexSelection, { "instrument-sub-type": "COMMON" }],
    [indexSelection, { "exercise-style": "American" }],
    [indexSelection, { "settlement-type": "AM" }],
  ] as const) {
    const f = fixture(false, false, false, true), a = client();
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const response = await f.fetcher(url, init);
      if (!String(url).includes("/instruments/")) return response;
      const body = await response.json() as any;
      return Response.json({ data: { ...body.data, ...mutation } });
    });
    await createQuoteRelay(env, fetcher).attach(a.socket, selected as typeof indexSelection, Date.now() + 60_000);
    await vi.waitFor(() => expect(a.socket.readyState).toBe(WebSocket.CLOSED));
    expect(f.upstreams).toHaveLength(0);
  }
  const f = fixture(false, false, false, true), relay = createQuoteRelay(env, f.fetcher);
  for (const mode of ["price", "iv"] as const) await expect(relay.history(indexSelection, historyRange, Date.now() + 60_000, mode)).rejects.toThrow();
  expect(f.fetcher).not.toHaveBeenCalled();
});

it("requires dated fresh index sources, preserves monotonic time through unknown events and invalidates on reconnect", async () => {
  const f = fixture(false, false, false, true), relay = createQuoteRelay(env, f.fetcher), a = client();
  try {
    await relay.attach(a.socket, indexSelection, Date.now() + 3_600_000);
    await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("connected"));
    const time = Date.now() - 1000;
    const indexValue = (sourceTime: number, price = 100) => f.upstreams[0].send(JSON.stringify({ type: "FEED_DATA", channel: 3, data: ["Trade", ["Trade", "XSP", sourceTime, price]] }));
    indexEvents(f.upstreams[0], time - 300_001, 100, time);
    await vi.waitFor(() => expect(a.messages.some(message => message.type === "index")).toBe(true));
    expect(() => relay.capture(indexSelection)).toThrow();
    indexValue(time - 60_001);
    await vi.waitFor(() => expect(a.messages.filter(message => message.type === "index").at(-1)?.time).toBe(time - 60_001));
    expect(() => relay.capture(indexSelection)).toThrow();
    indexEvents(f.upstreams[0], time);
    await vi.waitFor(() => expect(() => relay.capture(indexSelection)).not.toThrow());
    for (const invalidTime of [0, time + .5, Date.now() + 60_000]) {
      const count = a.messages.filter(message => message.type === "index").length;
      indexValue(invalidTime);
      await vi.waitFor(() => expect(a.messages.filter(message => message.type === "index")).toHaveLength(count + 1));
      await vi.waitFor(() => expect(a.messages.filter(message => message.type === "index").at(-1)?.time).toBeNull());
      expect(() => relay.capture(indexSelection)).toThrow();
    }
    indexValue(time, 101);
    await vi.waitFor(() => expect(relay.capture(indexSelection).underlying).toMatchObject({ price: 101 }));
    const clock = vi.spyOn(Date, "now").mockReturnValue(time + 300_001);
    try { expect(() => relay.capture(indexSelection)).toThrow(); } finally { clock.mockRestore(); }
    const receiptClock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(relay.capture(indexSelection).underlying.receivedAt) + 60_001);
    try { expect(() => relay.capture(indexSelection)).toThrow(); } finally { receiptClock.mockRestore(); }
    f.upstreams[0].close(1000);
    await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("reconnecting"));
    expect(() => relay.capture(indexSelection)).toThrow();
    await vi.waitFor(() => expect(f.upstreams).toHaveLength(2), { timeout: 3000 });
    await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("connected"));
    expect(() => relay.capture(indexSelection)).toThrow();
    indexEvents(f.upstreams[1], time);
    await vi.waitFor(() => expect(() => relay.capture(indexSelection)).not.toThrow());
    indexEvents(f.upstreams[1], 0);
    await vi.waitFor(() => expect(a.messages.filter(message => message.type === "index").at(-1)?.time).toBeNull());
    indexEvents(f.upstreams[1], time - 1);
    await vi.waitFor(() => expect(a.socket.readyState).toBe(WebSocket.CLOSED));
    expect(() => relay.capture(indexSelection)).toThrow();
  } finally { a.browser.close(1000); }
});

it("rejects invalid index values without publishing a capture", async () => {
  for (const price of [0, -1, "100", null, 1_000_001]) {
    const f = fixture(false, false, false, true), relay = createQuoteRelay(env, f.fetcher), a = client();
    await relay.attach(a.socket, indexSelection, Date.now() + 60_000);
    await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("connected"));
    f.upstreams[0].send(JSON.stringify({ type: "FEED_DATA", channel: 3, data: ["Trade", ["Trade", "XSP", Date.now(), price]] }));
    await vi.waitFor(() => expect(a.socket.readyState).toBe(WebSocket.CLOSED));
    expect(a.messages.some(message => message.type === "index")).toBe(false);
    expect(() => relay.capture(indexSelection)).toThrow();
  }
});

it("subscribes and captures underlying-only quotes without option or Greeks requirements", async () => {
  const f = fixture(), relay = createQuoteRelay(env, f.fetcher), a = client(), stock = { underlying: "SPY", contractIds: [] };
  try {
    await relay.attach(a.socket, stock, Date.now() + 3_600_000);
    await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("connected"));
    await vi.waitFor(() => expect(f.subscriptions.at(-1)?.add).toEqual([{ type: "Quote", symbol: "SPY" }]));
    expect(f.fetcher.mock.calls.some(([url]) => String(url).includes("/equity-options/"))).toBe(false);
    expect(() => relay.capture(stock)).toThrow();
    const time = Date.now();
    f.upstreams[0].send(JSON.stringify({ type: "FEED_DATA", channel: 3, data: ["Quote", ["Quote", "SPY", 99, 101, time, time]] }));
    await vi.waitFor(() => expect(() => relay.capture(stock)).not.toThrow());
    expect(relay.capture(stock)).toMatchObject({ underlying: { bid: 99, ask: 101, bidTime: time, askTime: time }, contracts: [] });
    expect(() => relay.capture({ ...stock, contractIds: [""] })).toThrow();
    const receivedAt = Date.parse(relay.capture(stock).underlying.receivedAt);
    const clock = vi.spyOn(Date, "now").mockReturnValue(receivedAt + 60_001);
    try { expect(() => relay.capture(stock)).toThrow(); } finally { clock.mockRestore(); }
  } finally { a.browser.close(1000); }
  await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
  expect(() => relay.capture(stock)).toThrow();
});

it("rejects malformed underlying-only subscriptions before metadata access", async () => {
  const f = fixture(), relay = createQuoteRelay(env, f.fetcher);
  for (const invalid of [{ underlying: "SPY", contractIds: [""] }, { underlying: "SPY", contractIds: null }, { underlying: "spy", contractIds: [] }]) {
    const a = client();
    await relay.attach(a.socket, invalid as typeof selection, Date.now() + 60_000);
    await vi.waitFor(() => expect(a.socket.readyState).toBe(WebSocket.CLOSED));
    expect(() => relay.capture(invalid as typeof selection)).toThrow();
  }
  expect(f.fetcher).not.toHaveBeenCalled();
});

it("expires only the affected subscriber even when the expiry timer is delayed", async () => {
  const f = fixture(), relay = createQuoteRelay(env, f.fetcher), a = client(), b = client(), now = Date.now();
  await Promise.all([relay.attach(a.socket, selection, now + 1000), relay.attach(b.socket, selection, now + 3600000)]);
  await vi.waitFor(() => expect(b.messages.at(-1)?.state).toBe("connected"));
  const before = a.messages.length;
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 1001);
  try {
    captureEvents(f.upstreams[0], now);
    await vi.waitFor(() => expect(b.messages.some(message => message.type === "quote")).toBe(true));
    await vi.waitFor(() => expect(a.socket.readyState).toBe(WebSocket.CLOSED));
    expect(a.messages).toHaveLength(before); expect(f.upstreams).toHaveLength(1); expect(f.upstreams[0].readyState).toBe(WebSocket.OPEN);
  } finally { clock.mockRestore(); b.browser.close(1000); }
  await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
});

it("expires pending attachments without reviving them when metadata resolves", async () => {
  const f = fixture(); let release!: () => void, started = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetcher = vi.fn<typeof fetch>(async (url, init) => { if (String(url).includes("/instruments/")) { started = true; await gate; } return f.fetcher(url, init); });
  const relay = createQuoteRelay(env, fetcher), a = client();
  vi.useFakeTimers();
  try {
    const pending = relay.attach(a.socket, selection, Date.now() + 1000);
    await vi.waitFor(() => expect(started).toBe(true));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(a.socket.readyState).toBe(WebSocket.CLOSED));
    release(); await pending;
    expect(f.upstreams).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally { release(); vi.useRealTimers(); }
});

it("rejects missing or invalid internal deadlines and bounds long-session timers", async () => {
  const stub = (workerEnv as { FEED: DurableObjectNamespace }).FEED.getByName(crypto.randomUUID());
  for (const deadline of [undefined, "NaN", "Infinity", "99999999999999999", String(Date.now() - 1), "1e20"]) {
    const response = await stub.fetch(new Request("https://feed.internal/", { headers: { Upgrade: "websocket", "X-ARGUS-Feed-Selection": JSON.stringify(selection), ...(deadline === undefined ? {} : { "X-ARGUS-Feed-Expires-At": deadline }) } }));
    expect(response.status).toBe(401);
  }
  const f = fixture(), relay = createQuoteRelay(env, f.fetcher), a = client(), now = Date.now();
  const timer = vi.spyOn(globalThis, "setTimeout"), clock = vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    await relay.attach(a.socket, selection, now + 2_147_484_647);
    await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("connected"));
    const index = timer.mock.calls.findIndex(call => call[1] === 2_147_483_647);
    expect(index).toBeGreaterThanOrEqual(0);
    clearTimeout(timer.mock.results[index].value);
    clock.mockReturnValue(now + 2_147_483_647);
    (timer.mock.calls[index][0] as () => void)();
    expect(timer.mock.calls.at(-1)?.[1]).toBe(1000); expect(a.socket.readyState).toBe(WebSocket.OPEN);
    a.browser.close(1000);
    await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
  } finally { clock.mockRestore(); timer.mockRestore(); a.browser.close(1000); }
});

it("clears the feed on regressing source times but accepts changed equal-time snapshots", async () => {
  for (const unknownBetween of [false, true]) for (const kind of ["bid", "ask", "greeks"] as const) {
    const f = fixture(), relay = createQuoteRelay(env, f.fetcher), a = client();
    await relay.attach(a.socket, selection, Date.now() + 3_600_000);
    await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("connected"));
    const time = Date.now() - 2000;
    captureEvents(f.upstreams[0], time);
    await vi.waitFor(() => expect(() => relay.capture(selection)).not.toThrow());
    f.upstreams[0].send(JSON.stringify({ type: "FEED_DATA", channel: 3, data: ["Quote", ["Quote", ".SPY260918C100", 1.1, 2.1, time, time]] }));
    await vi.waitFor(() => expect(relay.capture(selection).contracts[0].quote.bid).toBe(1.1));
    if (unknownBetween) {
      const count = a.messages.length;
      captureEvents(f.upstreams[0], 0);
      await vi.waitFor(() => expect(a.messages.length).toBeGreaterThan(count + 1));
      expect(() => relay.capture(selection)).toThrow();
    }
    const data = kind === "greeks" ? ["Greeks", ["Greeks", ".SPY260918C100", .3, time - 1000]] : ["Quote", ["Quote", ".SPY260918C100", 1.2, 2.2, time + (kind === "bid" ? -1000 : 1000), time + (kind === "ask" ? -1000 : 1000)]];
    f.upstreams[0].send(JSON.stringify({ type: "FEED_DATA", channel: 3, data }));
    await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("unavailable"));
    expect(() => relay.capture(selection)).toThrow("Dated stream capture unavailable");
    expect(a.messages.some(m => m.bid === 1.2 || m.iv === .3)).toBe(false);
    await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
  }
});

it("captures a server-owned dated copy only while selected marks are current and subscribed", async () => {
  const f = fixture(), relay = createQuoteRelay(env, f.fetcher), a = client(), b = client();
  await Promise.all([relay.attach(a.socket, selection, Date.now() + 3_600_000), relay.attach(b.socket, { underlying: "SPY", contractIds: ["SPY   260918P00105000"] }, Date.now() + 3_600_000)]);
  await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("connected"));
  expect(() => relay.capture(selection)).toThrow("Dated stream capture unavailable");
  const time = Date.now();
  captureEvents(f.upstreams[0], time);
  await vi.waitFor(() => expect(a.messages.some(m => m.type === "greeks")).toBe(true));
  const captured = relay.capture(selection);
  expect(captured).toMatchObject({ underlying: { bid: 99, ask: 101, bidTime: time, askTime: time }, contracts: [{ contractId, quote: { bid: 1, ask: 2, bidTime: time, askTime: time }, greeks: { iv: 0.25, time } }] });
  captured.contracts[0].quote.bid = 999;
  expect(relay.capture(selection).contracts[0].quote.bid).toBe(1);
  const before = a.messages.length;
  captureEvents(f.upstreams[0], 0);
  await vi.waitFor(() => expect(a.messages.length).toBeGreaterThan(before + 1));
  expect(() => relay.capture(selection)).toThrow("Dated stream capture unavailable");
  captureEvents(f.upstreams[0]);
  await vi.waitFor(() => expect(() => relay.capture(selection)).not.toThrow());
  expect(() => relay.capture({ underlying: "SPY", contractIds: ["SPY   260918C00115000"] })).toThrow();
  a.browser.close(1000);
  await vi.waitFor(() => expect(a.socket.readyState).toBe(WebSocket.CLOSED));
  expect(() => relay.capture(selection)).toThrow();
  b.browser.close(1000);
  await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
});

it("refuses unknown, stale, skewed and recovery-generation captures without replacing source times", async () => {
  const f = fixture(), relay = createQuoteRelay(env, f.fetcher), a = client();
  await relay.attach(a.socket, selection, Date.now() + 3_600_000);
  await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("connected"));
  for (const [time, greekTime] of [[0, 0], [Date.now() + 60_000, Date.now() + 60_000], [Date.now() - 300_001, Date.now() - 300_001], [Date.now(), Date.now() - 60_001]]) {
    const before = a.messages.length;
    captureEvents(f.upstreams[0], time, greekTime);
    await vi.waitFor(() => expect(a.messages.length).toBeGreaterThan(before + 1));
    expect(() => relay.capture(selection)).toThrow("Dated stream capture unavailable");
  }
  captureEvents(f.upstreams[0]);
  await vi.waitFor(() => expect(() => relay.capture(selection)).not.toThrow());
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(Date.now() + 60_001);
    expect(() => relay.capture(selection)).toThrow();
  } finally { vi.useRealTimers(); }
  f.upstreams[0].close(1000);
  await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("reconnecting"));
  expect(() => relay.capture(selection)).toThrow();
  a.browser.close(1000);
  await vi.waitFor(() => expect(a.socket.readyState).toBe(WebSocket.CLOSED));
});

it("shares one upstream, forwards only selected normalized events, and closes on last subscriber", async () => {
  const f = fixture(), relay = createQuoteRelay(env, f.fetcher), a = client(), b = client();
  await Promise.all([relay.attach(a.socket, selection, Date.now() + 3_600_000), relay.attach(b.socket, selection, Date.now() + 3_600_000)]);
  await vi.waitFor(() => expect(a.messages).toContainEqual(expect.objectContaining({ type: "status", state: "connected" })));
  expect(f.upstreams).toHaveLength(1);
  await vi.waitFor(() => expect(f.subscriptions.at(-1)?.add).toHaveLength(3));
  f.upstreams[0].send(JSON.stringify({ type: "FEED_DATA", channel: 3, data: ["Quote", ["Quote", ".SPY260918C100", 1, 2, 0, 0], "Greeks", ["Greeks", ".SPY260918C100", 0.25, 0]] }));
  await vi.waitFor(() => expect(a.messages).toContainEqual(expect.objectContaining({ type: "quote", contractId, bid: 1, ask: 2, bidTime: null, askTime: null })));
  expect(a.messages).toContainEqual(expect.objectContaining({ type: "greeks", contractId, iv: 0.25, time: null }));
  expect(JSON.stringify(a.messages)).not.toMatch(/private-|streamer|260918C100/);
  a.browser.close(1000);
  await vi.waitFor(() => expect(a.socket.readyState).toBe(WebSocket.CLOSED));
  expect(f.upstreams[0].readyState).toBe(WebSocket.OPEN);
  b.browser.close(1000);
  await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
});

it("rejects untrusted selection before provider calls and suppresses malformed feed data", async () => {
  const f = fixture(), relay = createQuoteRelay(env, f.fetcher), a = client();
  await relay.attach(a.socket, { underlying: "SPY", contractIds: ["QQQ   260918C00100000"] }, Date.now() + 3_600_000);
  expect(f.fetcher).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(a.messages).toContainEqual(expect.objectContaining({ state: "unavailable" })));
  const b = client();
  await relay.attach(b.socket, selection, Date.now() + 3_600_000);
  await vi.waitFor(() => expect(b.messages).toContainEqual(expect.objectContaining({ state: "connected" })));
  f.upstreams[0].send(JSON.stringify({ type: "FEED_DATA", channel: 3, data: ["Quote", ["Quote", ".SPY260918C100", 5, 1, 0, 0]] }));
  await vi.waitFor(() => expect(b.messages).toContainEqual(expect.objectContaining({ state: "unavailable" })));
  expect(b.messages.some(m => m.type === "quote")).toBe(false);
});

it("reference-counts the union without forwarding another client's options and reconnects explicitly", async () => {
  const f = fixture(), relay = createQuoteRelay(env, f.fetcher), a = client(), b = client();
  const otherId = "SPY   260918P00105000";
  await Promise.all([relay.attach(a.socket, selection, Date.now() + 3_600_000), relay.attach(b.socket, { underlying: "SPY", contractIds: [otherId] }, Date.now() + 3_600_000)]);
  await vi.waitFor(() => expect(f.subscriptions.at(-1)?.add).toHaveLength(5));
  await vi.waitFor(() => expect(b.messages).toContainEqual(expect.objectContaining({ state: "connected" })));
  f.upstreams[0].send(JSON.stringify({ type: "FEED_DATA", channel: 3, data: ["Quote", ["Quote", ".SPY260918C100", 1, 2, 1000, 2000]] }));
  await vi.waitFor(() => expect(a.messages.some(m => m.type === "quote")).toBe(true));
  expect(b.messages.some(m => m.type === "quote")).toBe(false);
  a.browser.close(1000);
  await vi.waitFor(() => expect(f.subscriptions.at(-1)?.add).toHaveLength(3));
  expect(f.subscriptions.at(-1).add).not.toContainEqual({ type: "Quote", symbol: ".SPY260918C100" });
  f.upstreams[0].send(JSON.stringify({ type: "ERROR", channel: 0 }));
  await vi.waitFor(() => expect(b.messages).toContainEqual(expect.objectContaining({ state: "unavailable" })));
  const c = client();
  await relay.attach(c.socket, selection, Date.now() + 3_600_000);
  await vi.waitFor(() => expect(c.messages).toContainEqual(expect.objectContaining({ state: "connected" })));
  expect(f.upstreams).toHaveLength(2);
  c.browser.close(1000);
  await vi.waitFor(() => expect(f.upstreams[1].readyState).toBe(WebSocket.CLOSED));
});

it("shares bounded recovery with late joiners and cancels backoff on last disconnect", async () => {
  const f = fixture(), relay = createQuoteRelay(env, f.fetcher), a = client(), b = client();
  await Promise.all([relay.attach(a.socket, selection, Date.now() + 3_600_000), relay.attach(b.socket, selection, Date.now() + 3_600_000)]);
  await vi.waitFor(() => expect(a.messages.some(m => m.state === "connected")).toBe(true));
  vi.useFakeTimers(); vi.spyOn(Math, "random").mockReturnValue(0);
  try {
    f.upstreams[0].close(1000);
    await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("reconnecting"));
    f.receivers[0].dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "FEED_DATA", channel: 3, data: ["Quote", ["Quote", ".SPY260918C100", 7, 8, 1, 1]] }) }));
    expect(a.messages.some(m => m.type === "quote")).toBe(false);
    expect(b.socket.readyState).toBe(WebSocket.OPEN);
    const c = client();
    await relay.attach(c.socket, selection, Date.now() + 3_600_000);
    expect(f.upstreams).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(f.upstreams).toHaveLength(2));
    await vi.waitFor(() => expect(c.messages.at(-1)?.state).toBe("connected"));
    f.upstreams[1].close(1000);
    await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("reconnecting"));
    a.browser.close(1000); b.browser.close(1000); c.browser.close(1000);
    await vi.waitFor(() => expect(c.socket.readyState).toBe(WebSocket.CLOSED));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.upstreams).toHaveLength(2);
  } finally { vi.useRealTimers(); vi.restoreAllMocks(); }
});

it("exhausts three retries despite successful flapping handshakes", async () => {
  const f = fixture(), a = client();
  await createQuoteRelay(env, f.fetcher).attach(a.socket, selection, Date.now() + 3_600_000);
  await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("connected"));
  vi.useFakeTimers(); vi.spyOn(Math, "random").mockReturnValue(0);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      f.upstreams[attempt].close(1000);
      await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("reconnecting"));
      await vi.advanceTimersByTimeAsync(1_000 * 2 ** attempt);
      await vi.waitFor(() => expect(f.upstreams).toHaveLength(attempt + 2));
      await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("connected"));
    }
    f.upstreams[3].close(1000);
    await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("unavailable"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.upstreams).toHaveLength(4);
  } finally { vi.useRealTimers(); vi.restoreAllMocks(); }
});

it("resets retry budget only after sixty healthy seconds and retains in-flight attachment metadata", async () => {
  const f = fixture();
  let delay = false, started = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (delay && String(url).includes("/instruments/equity-options/")) { started = true; await gate; }
    return f.fetcher(url, init);
  });
  const relay = createQuoteRelay(env, fetcher), a = client(), b = client();
  await relay.attach(a.socket, selection, Date.now() + 3_600_000);
  await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("connected"));
  delay = true;
  const attaching = relay.attach(b.socket, selection, Date.now() + 3_600_000);
  await vi.waitFor(() => expect(started).toBe(true));
  vi.useFakeTimers(); vi.spyOn(Math, "random").mockReturnValue(0);
  try {
    f.upstreams[0].close(1000);
    await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("reconnecting"));
    release(); await attaching;
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(b.messages.at(-1)?.state).toBe("connected"));
    f.upstreams[1].send(JSON.stringify({ type: "FEED_DATA", channel: 3, data: ["Quote", ["Quote", ".SPY260918C100", 1, 2, 1, 1]] }));
    await vi.waitFor(() => expect(b.messages.some(m => m.type === "quote")).toBe(true));
    await vi.advanceTimersByTimeAsync(60_000);
    f.upstreams[1].send(JSON.stringify({ type: "KEEPALIVE", channel: 0 }));
    await vi.advanceTimersByTimeAsync(1);
    for (let attempt = 0; attempt < 3; attempt++) {
      f.upstreams[attempt + 1].close(1000);
      await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("reconnecting"));
      await vi.advanceTimersByTimeAsync(1_000 * 2 ** attempt);
      await vi.waitFor(() => expect(f.upstreams).toHaveLength(attempt + 3));
      await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("connected"));
    }
    a.browser.close(1000); b.browser.close(1000);
    await vi.waitFor(() => expect(f.upstreams[4].readyState).toBe(WebSocket.CLOSED));
  } finally { vi.useRealTimers(); vi.restoreAllMocks(); }
});

it("recovers a handshake timeout without closing downstream clients", async () => {
  vi.useFakeTimers(); vi.spyOn(Math, "random").mockReturnValue(0);
  try {
    const f = fixture(false, true), a = client();
    await createQuoteRelay(env, f.fetcher).attach(a.socket, selection, Date.now() + 3_600_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("reconnecting"));
    expect(a.socket.readyState).toBe(WebSocket.OPEN);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(f.upstreams).toHaveLength(2));
    a.browser.close(1000);
    await vi.waitFor(() => expect(f.upstreams[1].readyState).toBe(WebSocket.CLOSED));
  } finally { vi.useRealTimers(); vi.restoreAllMocks(); }
});

it("exhausts recovery when each ready upstream goes silent instead of resetting on elapsed time", async () => {
  vi.useFakeTimers(); vi.spyOn(Math, "random").mockReturnValue(0);
  try {
    const f = fixture(), a = client();
    await createQuoteRelay(env, f.fetcher).attach(a.socket, selection, Date.now() + 3_600_000);
    await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("connected"));
    for (let attempt = 0; attempt < 3; attempt++) {
      await vi.advanceTimersByTimeAsync(100_000);
      await vi.waitFor(() => expect(f.upstreams).toHaveLength(attempt + 2));
      await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("connected"));
    }
    await vi.advanceTimersByTimeAsync(100_000);
    await vi.waitFor(() => expect(a.messages.at(-1)?.state).toBe("unavailable"));
    expect(f.upstreams).toHaveLength(4);
  } finally { vi.useRealTimers(); vi.restoreAllMocks(); }
});

it("does not revive a disconnected generation when old metadata resolves", async () => {
  const f = fixture();
  let release!: () => void;
  let delayed = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (!delayed && String(url).includes("/instruments/equity-options/")) { delayed = true; await gate; }
    return f.fetcher(url, init);
  });
  const relay = createQuoteRelay(env, fetcher), a = client();
  const pending = relay.attach(a.socket, selection, Date.now() + 3_600_000);
  await vi.waitFor(() => expect(delayed).toBe(true));
  a.browser.close(1000);
  await vi.waitFor(() => expect(a.socket.readyState).toBe(WebSocket.CLOSED));
  const b = client();
  await relay.attach(b.socket, selection, Date.now() + 3_600_000);
  await vi.waitFor(() => expect(b.messages).toContainEqual(expect.objectContaining({ state: "connected" })));
  release(); await pending;
  expect(f.upstreams).toHaveLength(1);
  b.browser.close(1000);
  await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
});

it("rejects mismatched provider metadata and non-dxfeed destinations without leaking responses", async () => {
  for (const badEndpoint of [false, true]) {
    const f = fixture();
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (badEndpoint && String(url).endsWith("/api-quote-tokens")) return Response.json({ data: { token: "private-token", "dxlink-url": "wss://dxfeed.com.attacker.example/" } });
      const response = await f.fetcher(url, init);
      if (!badEndpoint && String(url).includes("/instruments/equity-options/")) {
        const body = await response.json() as any;
        body.data["root-symbol"] = "QQQ";
        return Response.json(body);
      }
      return response;
    });
    const a = client();
    await createQuoteRelay(env, fetcher).attach(a.socket, selection, Date.now() + 3_600_000);
    await vi.waitFor(() => expect(a.messages).toContainEqual(expect.objectContaining({ state: "unavailable" })));
    expect(f.upstreams).toHaveLength(0);
    expect(JSON.stringify(a.messages)).not.toMatch(/private|attacker/);
  }
});

it("accepts incremental feed configuration and Quote events before Greeks fields arrive", async () => {
  const f = fixture(true), a = client();
  await createQuoteRelay(env, f.fetcher).attach(a.socket, selection, Date.now() + 3_600_000);
  await vi.waitFor(() => expect(a.messages).toContainEqual(expect.objectContaining({ type: "greeks", iv: 0.25 })));
  expect(a.messages).toContainEqual(expect.objectContaining({ type: "quote", bid: 1, ask: 2 }));
  expect(a.messages.some(m => m.state === "unavailable")).toBe(false);
  a.browser.close(1000);
  await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
});

it("closes a late upstream upgrade after its last waiting client disconnects", async () => {
  const f = fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const response = await f.fetcher(url, init);
    if (String(url).includes("test.dxfeed.com")) await gate;
    return response;
  });
  const a = client();
  const pending = createQuoteRelay(env, fetcher).attach(a.socket, selection, Date.now() + 3_600_000);
  await vi.waitFor(() => expect(f.upstreams).toHaveLength(1));
  a.browser.close(1000);
  await vi.waitFor(() => expect(a.socket.readyState).toBe(WebSocket.CLOSED));
  release(); await pending;
  await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
});

it("refreshes REST auth for new metadata batches after failure without stopping healthy subscribers", async () => {
  const f = fixture();
  let authCalls = 0, rejectMetadata = false;
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("/oauth/token")) authCalls++;
    if (rejectMetadata && String(url).includes("/instruments/")) return new Response("expired", { status: 401 });
    return f.fetcher(url, init);
  });
  const relay = createQuoteRelay(env, fetcher), a = client();
  await relay.attach(a.socket, selection, Date.now() + 3_600_000);
  await vi.waitFor(() => expect(a.messages).toContainEqual(expect.objectContaining({ state: "connected" })));
  const initialCalls = authCalls;
  rejectMetadata = true;
  const b = client();
  await relay.attach(b.socket, selection, Date.now() + 3_600_000);
  await vi.waitFor(() => expect(b.messages).toContainEqual(expect.objectContaining({ state: "unavailable" })));
  expect(authCalls).toBe(initialCalls + 1);
  expect(f.upstreams[0].readyState).toBe(WebSocket.OPEN);
  rejectMetadata = false;
  const c = client();
  await relay.attach(c.socket, selection, Date.now() + 3_600_000);
  await vi.waitFor(() => expect(c.messages).toContainEqual(expect.objectContaining({ state: "connected" })));
  expect(authCalls).toBe(initialCalls + 2);
  expect(f.upstreams).toHaveLength(1);
  expect(a.messages.some(m => m.state === "unavailable")).toBe(false);
  a.browser.close(1000); c.browser.close(1000);
  await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
});

const historyRange = { start: Date.parse('2026-09-04T13:30:00Z'), end: Date.parse('2026-09-04T14:00:00Z') };
it('subscribes only verified option trade candles for IV, never underlying aggregate IV', async () => {
  const f = fixture(false, false, true), relay = createQuoteRelay(env, f.fetcher);
  const result = await relay.history(selection, historyRange, Date.now() + 10_000, 'iv');
  expect(result).toEqual({ contracts: [{ contractId, basis: 'trade-candle', bars: [{ time: historyRange.start, iv: .25 }] }] });
  expect(f.subscriptions[0].add).toEqual([{ type: 'Candle', symbol: '.SPY260918C100{=5m}', fromTime: historyRange.start }]);
  await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
});
it.each(['history', 'history-iv'])('guards internal %s with canonical expiry and bounded range headers', async path => {
  const stub = (workerEnv as { FEED: DurableObjectNamespace }).FEED.getByName(crypto.randomUUID());
  const headers = { 'X-ARGUS-Feed-Selection': JSON.stringify(selection), 'X-ARGUS-Feed-Expires-At': String(Date.now() + 60_000), 'X-ARGUS-History-Range': JSON.stringify(historyRange) };
  for (const expiry of ['', 'NaN', 'Infinity', String(Date.now() - 1), '1e20']) {
    const response = await stub.fetch(new Request(`https://feed.internal/${path}`, { method: 'POST', headers: { ...headers, 'X-ARGUS-Feed-Expires-At': expiry } }));
    expect(response.status).toBe(401);
  }
  for (const range of ['', 'null', '[]', '{}', 'x'.repeat(129), JSON.stringify({ ...historyRange, end: historyRange.start })]) {
    const response = await stub.fetch(new Request(`https://feed.internal/${path}`, { method: 'POST', headers: { ...headers, 'X-ARGUS-History-Range': range } }));
    expect(response.status).toBe(400);
  }
});

it('keeps shared pending OAuth single-flight when a live client disconnects during history admission', async () => {
  const f = fixture(false, false, true); let release!: () => void, oauthCalls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/oauth/token')) { oauthCalls++; await gate; }
    return f.fetcher(url, init);
  });
  const relay = createQuoteRelay(env, fetcher), a = client(), b = client();
  const first = relay.attach(a.socket, selection, Date.now() + 60_000);
  let history: ReturnType<typeof relay.history> | undefined, second: Promise<void> | undefined;
  try {
    await vi.waitFor(() => expect(oauthCalls).toBe(1));
    history = relay.history(selection, historyRange, Date.now() + 10_000);
    a.browser.close(1000);
    await vi.waitFor(() => expect(a.socket.readyState).toBe(WebSocket.CLOSED));
    const stoppedMessages = a.messages.length;
    second = relay.attach(b.socket, selection, Date.now() + 60_000);
    await vi.waitFor(() => expect(b.messages.some(message => message.state === 'connecting')).toBe(true));
    expect(oauthCalls).toBe(1); expect(f.upstreams).toHaveLength(0);
    release();
    const [, result] = await Promise.all([first, history, second]);
    expect(result.contracts[0].contractId).toBe(contractId);
    await vi.waitFor(() => expect(b.messages.some(message => message.state === 'connected')).toBe(true));
    expect(a.messages).toHaveLength(stoppedMessages);
    expect(a.messages.some(message => message.state === 'connected')).toBe(false);
    await vi.waitFor(() => expect(f.upstreams.filter(socket => socket.readyState === WebSocket.OPEN)).toHaveLength(1));
  } finally {
    release(); a.browser.close(1000); b.browser.close(1000);
    await Promise.allSettled([first, ...(history ? [history] : []), ...(second ? [second] : [])]);
  }
  await vi.waitFor(() => expect(f.upstreams.every(socket => socket.readyState === WebSocket.CLOSED)).toBe(true));
});

it('validates history selection, range and private expiry before provider calls', async () => {
  const f = fixture(), relay = createQuoteRelay(env, f.fetcher);
  for (const invalid of [{ underlying: 'SPY', contractIds: [''] }, { underlying: 'QQQ', contractIds: [contractId] }, { underlying: 'SPY', contractIds: [contractId, contractId] }]) {
    await expect(relay.history(invalid, historyRange, Date.now() + 1000)).rejects.toThrow();
  }
  for (const expires of [NaN, Infinity, 0, Date.now() - 1]) await expect(relay.history(selection, historyRange, expires)).rejects.toThrow();
  for (const range of [{ ...historyRange, start: historyRange.start + 1 }, { start: historyRange.end, end: historyRange.start }]) await expect(relay.history(selection, range, Date.now() + 1000)).rejects.toThrow();
  expect(f.fetcher).not.toHaveBeenCalled();
});

it('loads underlying-only price history but rejects optionless IV before provider access', async () => {
  const f = fixture(false, false, true), relay = createQuoteRelay(env, f.fetcher), stock = { underlying: 'SPY', contractIds: [] };
  await expect(relay.history(stock, historyRange, Date.now() + 10_000, 'iv')).rejects.toThrow();
  expect(f.fetcher).not.toHaveBeenCalled();
  const result = await relay.history(stock, historyRange, Date.now() + 10_000);
  expect(result).toEqual({ underlying: { symbol: 'SPY', basis: 'last-trade', bars: [{ time: historyRange.start, count: 1, open: 1, high: 2, low: 1, close: 2, volume: null }] }, contracts: [] });
  expect(f.subscriptions[0].add).toEqual([{ type: 'Candle', symbol: 'SPY{=5m}', fromTime: historyRange.start }]);
  await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
});

it('projects history as separate underlying trade and contract midpoint candles without disturbing a live quote socket', async () => {
  const f = fixture(false, false, true), relay = createQuoteRelay(env, f.fetcher), a = client();
  try {
    await relay.attach(a.socket, selection, Date.now() + 60_000);
    await vi.waitFor(() => expect(a.messages.some(message => message.state === 'connected')).toBe(true));
    const result = await relay.history(selection, historyRange, Date.now() + 10_000);
    const bars = [{ time: historyRange.start, count: 1, open: 1, high: 2, low: 1, close: 2, volume: null }];
    expect(result).toEqual({ underlying: { symbol: 'SPY', basis: 'last-trade', bars }, contracts: [{ contractId, basis: 'midpoint', bars }] });
    expect(JSON.stringify(result)).not.toMatch(/private|token|secret/);
    expect(f.subscriptions.find(value => value.add[0].type === 'Candle').add).toEqual([
      { type: 'Candle', symbol: 'SPY{=5m}', fromTime: historyRange.start },
      { type: 'Candle', symbol: '.SPY260918C100{=5m,price=mark}', fromTime: historyRange.start },
    ]);
    await vi.waitFor(() => expect(f.upstreams[1].readyState).toBe(WebSocket.CLOSED));
    expect(f.upstreams[0].readyState).toBe(WebSocket.OPEN);
    const now = Date.now(); captureEvents(f.upstreams[0], now);
    await vi.waitFor(() => expect(a.messages.some(message => message.type === 'quote' && message.bidTime === now)).toBe(true));
    expect(await relay.history(selection, historyRange, Date.now() + 10_000)).toEqual(result);
    expect(f.upstreams[0].readyState).toBe(WebSocket.OPEN);
  } finally { a.browser.close(1000); }
  await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
});

it('rejects overlapping history before metadata awaits and releases admission after success and provider failure', async () => {
  const f = fixture(false, false, true); let release!: () => void, started = false, blocked = true, failMetadata = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).includes('/instruments/')) {
      if (blocked) { started = true; await gate; }
      if (failMetadata) return new Response('private failure', { status: 503 });
    }
    return f.fetcher(url, init);
  });
  const relay = createQuoteRelay(env, fetcher), first = relay.history(selection, historyRange, Date.now() + 10_000);
  try {
    await vi.waitFor(() => expect(started).toBe(true));
    const before = fetcher.mock.calls.length;
    await expect(relay.history(selection, historyRange, Date.now() + 10_000)).rejects.toThrow();
    await expect(relay.history(selection, historyRange, Date.now() + 10_000, 'iv')).rejects.toThrow();
    expect(fetcher.mock.calls).toHaveLength(before);
    blocked = false; release(); await first;
    failMetadata = true;
    await expect(relay.history(selection, historyRange, Date.now() + 10_000)).rejects.toThrow();
    failMetadata = false;
    expect((await relay.history(selection, historyRange, Date.now() + 10_000)).contracts[0].contractId).toBe(contractId);
  } finally { blocked = false; release(); }
});

it('expires pending history metadata without opening a late socket and releases admission', async () => {
  const f = fixture(false, false, true); let release!: () => void, started = false, blocked = true;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (blocked && String(url).includes('/instruments/')) { started = true; await gate; }
    return f.fetcher(url, init);
  });
  const relay = createQuoteRelay(env, fetcher);
  vi.useFakeTimers();
  try {
    const pending = relay.history(selection, historyRange, Date.now() + 1000), rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(started).toBe(true));
    await vi.advanceTimersByTimeAsync(1000); await rejected;
    blocked = false; release(); await vi.advanceTimersByTimeAsync(0);
    expect(f.upstreams).toHaveLength(0);
  } finally { blocked = false; release(); vi.useRealTimers(); }
  expect((await relay.history(selection, historyRange, Date.now() + 10_000)).contracts[0].contractId).toBe(contractId);
});
