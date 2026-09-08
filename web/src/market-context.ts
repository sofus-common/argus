export type MarketBindings = {
  ALPACA_API_KEY?: string;
  ALPACA_SECRET_KEY?: string;
  FRED_API_KEY?: string;
  EXA_AI_KEY?: string;
};
export type SourceEvidence = {
  id: string;
  provider: string;
  status: "available" | "unavailable";
  label: string;
  asOf: string | null;
  url: string | null;
  summary: string;
  reason?: string;
};
export type MarketContext = { retrievedAt: string; sources: SourceEvidence[] };

const DAY = 86_400_000;
const OFFICIAL_DOMAINS = ["federalreserve.gov", "bls.gov", "bea.gov", "treasury.gov"];
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const snippet = (value: unknown, length = 400) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, length) : "";
function safeUrl(value: unknown, official = false): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (official && !OFFICIAL_DOMAINS.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return null;
    return url.href;
  } catch { return null; }
}
function dated(value: unknown, now: number, age: number): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return null;
  const date = Date.parse(value);
  if (!Number.isFinite(date) || date > now || now - date > age) return null;
  const day = value.slice(0, 10);
  if (new Date(day).toISOString().slice(0, 10) !== day) return null;
  return value;
}
function unavailable(id: string, provider: string, label: string, reason: string): SourceEvidence {
  return { id, provider, label, status: "unavailable", asOf: null, url: null, summary: "", reason };
}

export function createMarketContextLoader(providerFetch: typeof fetch = fetch): (env: MarketBindings, symbol?: string) => Promise<MarketContext> {
  let cache: { fingerprint: string; until: number; pending: Promise<MarketContext> } | undefined;

  async function request(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Source unavailable")); }, 5000);
    });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await providerFetch(url, { ...init, signal: controller.signal, redirect: "manual" });
        if (!response.ok || Number(response.headers.get("content-length")) > 128 * 1024 || !response.body) {
          await response.body?.cancel();
          throw new Error("Source unavailable");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let size = 0;
        let body = "";
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 128 * 1024) { await reader.cancel(); throw new Error("Source unavailable"); }
            body += decoder.decode(chunk.value, { stream: true });
          }
        } finally { reader.releaseLock(); }
        return record(JSON.parse(body + decoder.decode()));
      })()]);
    } finally { clearTimeout(timer); }
  }

  async function collect(env: MarketBindings, symbol: string): Promise<MarketContext> {
    const suffix = symbol === "SPY" ? "" : `-${symbol.toLowerCase()}`;
    const now = Date.now();
    const retrievedAt = new Date(now).toISOString();
    const start = new Date(now - 7 * DAY).toISOString();
    const alpacaHeaders = { "APCA-API-KEY-ID": env.ALPACA_API_KEY ?? "", "APCA-API-SECRET-KEY": env.ALPACA_SECRET_KEY ?? "" };
    async function source(id: string, provider: string, label: string, configured: boolean, fetchSource: () => Promise<SourceEvidence[]>): Promise<SourceEvidence[]> {
      if (!configured) return [unavailable(id, provider, label, "Credentials not configured.")];
      try {
        const result = await fetchSource();
        return result.length ? result : [unavailable(id, provider, label, "No valid dated evidence in the requested window.")];
      } catch { return [unavailable(id, provider, label, "Request failed, timed out, was denied, or returned invalid data.")]; }
    }
    function articles(data: unknown, provider: string, prefix: string, official: boolean): SourceEvidence[] {
      return rows(data).flatMap((item, index): SourceEvidence[] => {
        const row = record(item);
        const asOf = dated(official ? row.publishedDate : row.created_at, now, 7 * DAY);
        const url = safeUrl(row.url, official);
        const label = snippet(official ? row.title : row.headline, 160);
        if (!asOf || !url || !label) return [];
        return [{ id: `${prefix}-${index}`, provider, status: "available", label, asOf, url, summary: snippet(official ? row.text : row.summary) || label }];
      }).slice(0, 3);
    }
    const results = await Promise.all([
      source(`alpaca-quote${suffix}`, "Alpaca", `${symbol} IEX quote`, !!(env.ALPACA_API_KEY && env.ALPACA_SECRET_KEY), async () => {
        const data = await request(`https://data.alpaca.markets/v2/stocks/${symbol}/quotes/latest?feed=iex`, { headers: alpacaHeaders });
        if (data.symbol !== symbol) return [];
        const quote = record(data.quote);
        const asOf = dated(quote.t, now, 365 * DAY);
        if (!asOf || typeof quote.bp !== "number" || typeof quote.ap !== "number" || !Number.isFinite(quote.bp) || !Number.isFinite(quote.ap) || quote.bp <= 0 || quote.ap < quote.bp || quote.ap > 1_000_000) return [];
        const hours = (now - Date.parse(asOf)) / 3_600_000;
        return [{ id: `alpaca-quote${suffix}`, provider: "Alpaca", label: `${symbol} IEX quote`, status: hours > 24 ? "unavailable" : "available", asOf, url: "https://docs.alpaca.markets/us/reference/stocklatestquotesingle-1", summary: `${symbol} IEX bid $${quote.bp}, ask $${quote.ap}; ${hours.toFixed(1)} hours old. Timestamped IEX only, not NBBO or a live-market assertion; latest-session status unknown.`, ...(hours > 24 ? { reason: "Quote is older than 24 hours; do not use for current claims." } : {}) }];
      }),
      source(`alpaca-news${suffix}`, "Alpaca", `${symbol} news (7 days)`, !!(env.ALPACA_API_KEY && env.ALPACA_SECRET_KEY), async () => {
        const query = new URLSearchParams({ symbols: symbol, start, end: retrievedAt, limit: "3", sort: "desc", include_content: "false", exclude_contentless: "true" });
        const data = await request(`https://data.alpaca.markets/v1beta1/news?${query}`, { headers: alpacaHeaders });
        return articles(rows(data.news).filter(item => rows(record(item).symbols).includes(symbol)), "Alpaca", `alpaca-news${suffix}`, false).map(article => ({ ...article, label: snippet(`${symbol}: ${article.label}`, 160), summary: snippet(`${symbol}: ${article.summary}`) }));
      }),
      source(`alpaca-dividend${suffix}`, "Alpaca", `${symbol} provider-reported cash dividends`, !!(env.ALPACA_API_KEY && env.ALPACA_SECRET_KEY), async () => {
        const from = new Date(now - 90 * DAY).toISOString().slice(0, 10), through = new Date(now + 90 * DAY).toISOString().slice(0, 10), today = retrievedAt.slice(0, 10);
        const query = new URLSearchParams({ symbols: symbol, types: "cash_dividend", start: from, end: through, data_quality: "complete", limit: "1000" });
        const data = await request(`https://data.alpaca.markets/v1/corporate-actions?${query}`, { headers: alpacaHeaders });
        const dividends = record(data.corporate_actions).cash_dividends, fetchedAt = new Date().toISOString();
        if (data.next_page_token !== null || !Array.isArray(dividends) || dividends.length > 1000) throw new Error("Incomplete dividend response");
        const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
        const evidence = dividends.map(item => {
          const row = record(item);
          if (row.symbol !== symbol || !date(row.process_date) || row.process_date < from || row.process_date > through || !date(row.ex_date) || typeof row.rate !== "number" || !Number.isFinite(row.rate) || row.rate <= 0 || typeof row.special !== "boolean" || typeof row.foreign !== "boolean") throw new Error("Invalid dividend record");
          return { id: `alpaca-dividend${suffix}-${row.process_date}-${row.ex_date}-${String(row.rate).replace(".", "-").replace("+", "")}`, provider: "Alpaca", status: "available" as const, label: `${symbol} provider-reported cash dividend: ex-date ${row.ex_date}`, asOf: fetchedAt, url: "https://docs.alpaca.markets/us/reference/corporateactions-1",
            summary: `${symbol} provider-reported cash dividend: ex-date ${row.ex_date}; rate ${row.rate} per share (currency not supplied); special=${row.special}, foreign=${row.foreign}. Fetched ${fetchedAt}; process date ${row.process_date}. Query ${from} through ${through} filters process dates, not ex-dates. Showing up to three upcoming records, not a complete event calendar or independent issuer confirmation. No model cashflows or yields changed.`, exDate: row.ex_date };
        });
        if (new Set(evidence.map(item => item.id)).size !== evidence.length) throw new Error("Duplicate dividend records");
        const upcoming = evidence.filter(item => item.exDate >= today && item.exDate <= through).sort((a, b) => a.exDate.localeCompare(b.exDate) || a.id.localeCompare(b.id)).slice(0, 3).map(({ exDate: _exDate, ...item }) => item);
        return upcoming.length ? upcoming : [unavailable(`alpaca-dividend${suffix}`, "Alpaca", `${symbol} provider-reported cash dividends`, "No validated upcoming ex-date in the returned process-date window. This is not a complete event calendar and does not establish that no dividend is upcoming.")];
      }),
      ...["DFF", "DGS10"].map((series) => source(`fred-${series}`, "FRED", `${series} observation`, !!env.FRED_API_KEY, async () => {
        const query = new URLSearchParams({ series_id: series, api_key: env.FRED_API_KEY!, file_type: "json", sort_order: "desc", limit: "7", observation_start: start.slice(0, 10), observation_end: retrievedAt.slice(0, 10) });
        const data = await request(`https://api.stlouisfed.org/fred/series/observations?${query}`);
        const observations = rows(data.observations).map(record).filter((row) => dated(row.date, now, 7 * DAY) && typeof row.value === "string" && /^-?\d+(?:\.\d+)?$/.test(row.value) && Number(row.value) >= -10 && Number(row.value) <= 100).sort((a, b) => String(b.date).localeCompare(String(a.date)));
        const observation = observations[0];
        if (!observation) return [];
        return [{ id: `fred-${series}`, provider: "FRED", label: series === "DFF" ? "Effective federal funds rate" : "10-year Treasury constant maturity", status: "available", asOf: String(observation.date), url: `https://fred.stlouisfed.org/series/${series}`, summary: `${series}: ${observation.value}% on ${observation.date}. Dated daily observation, not a live rate or yield curve.` }];
      })),
      source("exa-research", "Exa", "Official macro research (7 days)", !!env.EXA_AI_KEY, async () => {
        const data = await request("https://api.exa.ai/search", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": env.EXA_AI_KEY! }, body: JSON.stringify({ query: "US Federal Reserve monetary policy inflation employment economic releases", numResults: 3, includeDomains: OFFICIAL_DOMAINS, startPublishedDate: start, endPublishedDate: retrievedAt, contents: { text: { maxCharacters: 400 } } }) });
        return articles(data.results, "Exa", "exa-research", true);
      }),
    ]);
    return { retrievedAt, sources: results.flat() };
  }

  return async (env, symbol = "SPY") => {
    if (typeof symbol !== "string" || !/^[A-Z]{1,6}$/.test(symbol)) throw new Error("Invalid symbol");
    const bytes = new TextEncoder().encode(JSON.stringify([env.ALPACA_API_KEY, env.ALPACA_SECRET_KEY, env.FRED_API_KEY, env.EXA_AI_KEY, symbol]));
    const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (cache?.fingerprint === fingerprint && cache.until > Date.now()) return cache.pending;
    const pending = collect(env, symbol);
    cache = { fingerprint, until: Date.now() + 60_000, pending };
    return pending;
  };
}
