import type { SourceEvidence } from "./market-context";
import { MAX_OPTION_LEGS } from "./options";

export type BrokerBindings = {
  TASTYTRADE_CLIENT_ID?: string;
  TASTYTRADE_CLIENT_SECRET?: string;
  TASTYTRADE_REFRESH_TOKEN?: string;
  THETADATA_TERMINAL_URL?: string;
};

export function createBrokerRequest(providerFetch: typeof fetch = fetch) {
  return async function request(url: string, init?: RequestInit, limit = 131_072): Promise<any> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Unavailable")); }, 5_000);
    });
    try {
      return await Promise.race([timeout, (async () => {
      const response = await providerFetch(url, { ...init, signal: controller.signal, redirect: "manual" });
      if (!response.ok || !response.body || Number(response.headers.get("content-length")) > limit) throw new Error("Unavailable");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0;
      let text = "";
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > limit) throw new Error("Oversized");
          text += decoder.decode(chunk.value, { stream: true });
        }
        return JSON.parse(text + decoder.decode());
      } finally {
        await reader.cancel().catch(() => {});
      }
      })()]);
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createThetaRequest(providerFetch: typeof fetch = fetch) {
  const request = createBrokerRequest(providerFetch);
  // ponytail: one local app process; hosted history needs a relay with shared admission.
  let busy = false, nextStart = -Infinity;
  return async (env: BrokerBindings, paths: string[]): Promise<any[]> => {
    const url = new URL(env.THETADATA_TERMINAL_URL ?? "");
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "25503" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Only local Theta terminal is supported");
    if (!Array.isArray(paths) || !paths.length || paths.length > MAX_OPTION_LEGS + 1 || paths.some(path => typeof path !== "string" || !/^\/v3\/(?:option\/(?:list\/expirations|history\/eod)|stock\/history\/eod)(?:\?[^#\s\\]*)?$/.test(path))) throw new Error("Invalid Theta request batch");
    if (busy) throw new Error("Theta request already in progress");
    busy = true;
    try {
      const results = [];
      for (const path of paths) {
        const wait = nextStart - Date.now();
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        nextStart = Date.now() + 3500;
        results.push(await request(`${url.origin}${path}`));
      }
      return results;
    } finally { busy = false; }
  };
}

export async function tastyToken(env: BrokerBindings, request: ReturnType<typeof createBrokerRequest>): Promise<string> {
  if (!env.TASTYTRADE_CLIENT_SECRET || !env.TASTYTRADE_REFRESH_TOKEN) throw new Error("Not configured");
  const auth = await request("https://api.tastyworks.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "argus/0.1" },
    body: JSON.stringify({ grant_type: "refresh_token", client_secret: env.TASTYTRADE_CLIENT_SECRET, refresh_token: env.TASTYTRADE_REFRESH_TOKEN, ...(env.TASTYTRADE_CLIENT_ID ? { client_id: env.TASTYTRADE_CLIENT_ID } : {}), scope: "read" }),
  });
  if (typeof auth?.access_token !== "string" || !auth.access_token) throw new Error("Invalid auth");
  return auth.access_token;
}

export async function searchSymbols(env: BrokerBindings, query: string, providerFetch: typeof fetch = fetch) {
  if (!/^[A-Za-z0-9 &'().,\-]{2,80}$/.test(query) || !/[A-Za-z0-9]/.test(query) || query.trim().length < 2) throw new Error("invalid_query");
  query = query.trim();
  const request = createBrokerRequest(providerFetch);
  const token = await tastyToken(env, request);
  const response = await request(`https://api.tastyworks.com/symbols/search/${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${token}`, "User-Agent": "argus/0.1" } });
  if (!Array.isArray(response?.data?.items)) throw new Error("Unavailable");
  const items: { symbol: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const row of response.data.items) {
    if (!row || row["instrument-type"] !== "Equity" || row.options !== true || typeof row.symbol !== "string" || !/^[A-Z]{1,6}$/.test(row.symbol) || typeof row.description !== "string" || !row.description.trim() || row.description.length > 200 || /[\u0000-\u001f\u007f]/.test(row.description) || seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    items.push({ symbol: row.symbol, name: row.description.trim() });
  }
  return { query, items: items.slice(0, 10), truncated: items.length > 10, source: "Tastytrade" as const };
}

export function createBrokerContextLoader(providerFetch: typeof fetch = fetch, thetaRequest = createThetaRequest(providerFetch)) {
  // ponytail: one configuration cached per worker; use tenant-scoped storage for multi-user credentials.
  let cached: { key: string; expires: number; pending: Promise<SourceEvidence[]> } | undefined;
  const request = createBrokerRequest(providerFetch);

  async function tasty(symbol: string, access: Promise<string> | undefined): Promise<SourceEvidence> {
    const base: SourceEvidence = { id: `tastytrade-${symbol.toLowerCase()}`, provider: "Tastytrade", label: `${symbol} quote`, status: "unavailable", asOf: null, url: "https://developer.tastytrade.com/docs/concepts/market-data/", summary: `Tastytrade ${symbol} quote unavailable.` };
    if (!access) return { ...base, reason: "Not configured." };
    try {
      const token = await access;
      const data = await request(`https://api.tastyworks.com/market-data/by-type?equity=${symbol}`, { headers: { Authorization: `Bearer ${token}`, "User-Agent": "argus/0.1" } });
      const quote = data?.data?.items?.find((item: any) => item?.symbol === symbol);
      const bid = typeof quote?.bid === "string" || typeof quote?.bid === "number" ? Number(quote.bid) : NaN;
      const ask = typeof quote?.ask === "string" || typeof quote?.ask === "number" ? Number(quote.ask) : NaN;
      const stamp = typeof quote?.["updated-at"] === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(quote["updated-at"]) ? Date.parse(quote["updated-at"]) : NaN;
      if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid || ask > 100_000 || !Number.isFinite(stamp) || stamp > Date.now()) throw new Error("Invalid quote");
      const asOf = new Date(stamp).toISOString();
      if (Date.now() - stamp > 86_400_000) return { ...base, asOf, summary: `${symbol} quote dated ${asOf} is stale and excluded from current analysis.`, reason: "Quote is older than 24 hours." };
      return { ...base, status: "available", asOf, summary: `${symbol} underlying bid $${bid.toFixed(2)}, ask $${ask.toFixed(2)}; quote timestamp ${asOf}. Not option-contract prices. Older timestamps may reflect closed markets; not a guarantee of executable prices.` };
    } catch {
      return { ...base, reason: "Quote unavailable: authentication, entitlement, timeout or invalid provider data." };
    }
  }

  async function metrics(symbol: string, access: Promise<string> | undefined): Promise<SourceEvidence[]> {
    const bases: SourceEvidence[] = ["iv", "liquidity", "earnings"].map(kind => ({ id: `tastytrade-${kind}-${symbol.toLowerCase()}`, provider: "Tastytrade", label: `${symbol} provider ${kind === "iv" ? "IV statistics" : kind === "earnings" ? "earnings date" : "liquidity statistics"}`, status: "unavailable", asOf: null, url: "https://developer.tastytrade.com/openapi/market-metrics.json", summary: `${symbol} ${kind} context unavailable.` }));
    if (!access) return bases.map(base => ({ ...base, reason: "Not configured." }));
    try {
      const token = await access;
      const data = await request(`https://api.tastyworks.com/market-metrics?symbols=${symbol}`, { headers: { Authorization: `Bearer ${token}`, "User-Agent": "argus/0.1" } });
      if (!Array.isArray(data?.data?.items) || data.data.items.length !== 1 || data.data.items[0]?.symbol !== symbol || data.pagination && (Number(data.pagination["total-pages"]) !== 1 || data.pagination["next-link"] || data.pagination["next-page"])) throw new Error("Invalid metric identity");
      const row = data.data.items[0];
      const numeric = (value: unknown) => {
        if (!(typeof value === "number" || typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) || !Number.isFinite(Number(value))) throw new Error("Invalid metric value");
        return Number(value);
      };
      const dated = (value: unknown) => {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value.slice(0, 10)).toISOString().slice(0, 10) !== value.slice(0, 10) || Date.parse(value) > Date.now() || Date.now() - Date.parse(value) > 86_400_000) throw new Error("Invalid or stale metric timestamp");
        return new Date(value).toISOString();
      };
      return bases.map((base, index) => {
        try {
          if (index === 2) {
            const event = row.earnings, reportDate = event?.["expected-report-date"], today = new Date().toISOString().slice(0, 10), lastDate = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
            if (event?.visible !== true || typeof event.estimated !== "boolean" || event["late-flag"] !== 0 || typeof reportDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || !Number.isFinite(Date.parse(reportDate)) || new Date(reportDate).toISOString().slice(0, 10) !== reportDate || reportDate < today || reportDate > lastDate) throw new Error("Invalid earnings date");
            const asOf = dated(event["updated-at"]);
            return { ...base, status: "available" as const, asOf, label: `${symbol} provider-reported ${event.estimated ? "estimated " : ""}earnings date`, summary: `${symbol} provider-reported expected earnings report date ${reportDate}; estimated=${event.estimated}; earnings-record update ${asOf}. This is not issuer-confirmed, including when estimated=false. No report time or session is supplied. Not a complete event calendar; no EPS or quarter linkage, price-move forecast or IV forecast is established.` };
          }
          const updatedAt = dated(row[index === 0 ? "implied-volatility-updated-at" : "updated-at"]);
          const rankSource = row["implied-volatility-index-rank-source"];
          if (index === 0 && !["tos", "tw"].includes(rankSource)) throw new Error("Unsupported rank source");
          const rankUpdatedAt = index === 0 ? dated(row[`${rankSource}-implied-volatility-index-rank-updated-at`]) : updatedAt;
          const asOf = updatedAt < rankUpdatedAt ? updatedAt : rankUpdatedAt;
          const values = (index === 0 ? ["implied-volatility-index", "implied-volatility-index-rank"] : ["liquidity-value", "liquidity-rank", "liquidity-rating"]).map(key => numeric(row[key]));
          if (index === 0 ? values[0] <= 0 : values[0] < 0 || !Number.isSafeInteger(values[2]) || values[2] < 0) throw new Error("Invalid metric domain");
          return { ...base, status: "available" as const, asOf, summary: index === 0
            ? `${symbol} raw provider IV statistics: index ${values[0]}, index rank ${values[1]}; IV update ${updatedAt}; ${rankSource} rank update ${rankUpdatedAt}. Percentile omitted: no independently established timestamp. Values are reported without rescaling or assuming percentage units, lookback or methodology. Underlying-level context, not an option-leg IV, forecast or a change to model assumptions.`
            : `${symbol} raw provider liquidity statistics: value ${values[0]}, rank ${values[1]}, rating ${values[2]}; record timestamp ${asOf}, not a liquidity-observation timestamp. Units, scale and methodology are not established here. Not current or executable option-contract liquidity, market depth, fill probability or trading-cost evidence.` };
        } catch { return { ...base, reason: index === 2 ? "Earnings date or its own update timestamp missing, stale, flagged or invalid. This does not establish that no earnings event is upcoming." : "Required metric fields or timestamp missing, invalid, future-dated or older than 24 hours." }; }
      });
    } catch { return bases.map(base => ({ ...base, reason: "Metrics unavailable: authentication, entitlement, timeout, pagination or invalid provider data." })); }
  }

  async function theta(env: BrokerBindings, symbol: string): Promise<SourceEvidence> {
    const base: SourceEvidence = { id: symbol === "SPY" ? "theta-reference" : `theta-reference-${symbol.toLowerCase()}`, provider: "ThetaData", label: `${symbol} options catalog reference`, status: "unavailable", asOf: null, url: "https://docs.thetadata.us/operations/option_list_expirations.html", summary: `Theta ${symbol} options reference unavailable; no live option prices supplied.` };
    if (!env.THETADATA_TERMINAL_URL) return { ...base, reason: "Local terminal not configured." };
    try {
      const [data] = await thetaRequest(env, [`/v3/option/list/expirations?symbol=${symbol}&format=json`]);
      if (!Array.isArray(data?.response)) throw new Error("Invalid catalog");
      const today = new Date().toISOString().slice(0, 10);
      const dates = [...new Set<string>(data.response.filter((row: any) => row?.symbol === symbol && typeof row.expiration === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.expiration) && Number.isFinite(Date.parse(row.expiration)) && new Date(row.expiration).toISOString().slice(0, 10) === row.expiration && row.expiration >= today).map((row: any) => row.expiration))].sort();
      if (!dates.length) throw new Error("Empty catalog");
      return { ...base, status: "available", summary: `${symbol} reference catalog has ${dates.length} unexpired expirations; nearest ${dates[0]}. Reference metadata only, not market-analysis evidence, quotes, Greeks or proof of live-data entitlement. Historical EOD access is separate.` };
    } catch {
      return { ...base, reason: "Local terminal unavailable, timed out or returned invalid reference data." };
    }
  }

  return async (env: BrokerBindings, symbol = "SPY"): Promise<SourceEvidence[]> => {
    if (typeof symbol !== "string" || !/^[A-Z]{1,6}$/.test(symbol)) throw new Error("Invalid symbol");
    const key = JSON.stringify([env.TASTYTRADE_CLIENT_ID, env.TASTYTRADE_CLIENT_SECRET, env.TASTYTRADE_REFRESH_TOKEN, env.THETADATA_TERMINAL_URL, symbol]);
    if (cached?.key === key && cached.expires > Date.now()) return cached.pending;
    const access = env.TASTYTRADE_CLIENT_SECRET && env.TASTYTRADE_REFRESH_TOKEN ? tastyToken(env, request) : undefined;
    const pending = Promise.all([tasty(symbol, access), theta(env, symbol), metrics(symbol, access)]).then(([quote, reference, values]) => [quote, reference, ...values]);
    cached = { key, expires: Date.now() + 60_000, pending };
    return pending;
  };
}
