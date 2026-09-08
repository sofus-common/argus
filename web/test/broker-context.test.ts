import { expect, it, vi } from "vitest";
import { createBrokerContextLoader, searchSymbols } from "../src/broker-context";

const env = { TASTYTRADE_CLIENT_SECRET: "secret", TASTYTRADE_REFRESH_TOKEN: "refresh", THETADATA_TERMINAL_URL: "http://127.0.0.1:25503" };
const json = (value: unknown) => new Response(JSON.stringify(value));

it("searches company names read-only and returns only bounded unique supported option underlyings", async () => {
  const row = { symbol: "AAPL", description: "Apple Inc.", options: true, "instrument-type": "Equity" };
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    if (String(input).endsWith("/oauth/token")) { expect(JSON.parse(String(init?.body)).scope).toBe("read"); return json({ access_token: "private-token" }); }
    expect(String(input)).toBe("https://api.tastyworks.com/symbols/search/Apple%20Inc.");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer private-token" });
    return json({ data: { items: [row, row, { ...row, symbol: "BRK.B" }, { ...row, symbol: "NO", options: false }, { ...row, symbol: "FUT", "instrument-type": "Future" }, { ...row, symbol: "BAD", description: "" }, ...Array.from({ length: 11 }, (_, i) => ({ ...row, symbol: `Z${String.fromCharCode(65 + i)}` }))] } });
  });
  const result = await searchSymbols(env, " Apple Inc. ", fetcher);
  expect(result).toMatchObject({ query: "Apple Inc.", source: "Tastytrade", truncated: true });
  expect(result.items).toHaveLength(10); expect(result.items[0]).toEqual({ symbol: "AAPL", name: "Apple Inc." });
  expect(JSON.stringify(result)).not.toContain("private-token"); expect(fetcher).toHaveBeenCalledTimes(2);
});

it("rejects invalid symbol queries before authentication and distinguishes empty results from malformed data", async () => {
  const fetcher = vi.fn<typeof fetch>();
  for (const q of ["", "A", "  ", "---", "a/b", "Apple\n", "a".repeat(81)]) await expect(searchSymbols(env, q, fetcher)).rejects.toThrow("invalid_query");
  expect(fetcher).not.toHaveBeenCalled();
  const provider = (payload: unknown) => vi.fn<typeof fetch>(async input => String(input).endsWith("/oauth/token") ? json({ access_token: "token" }) : json(payload));
  expect(await searchSymbols(env, "Apple", provider({ data: { items: [] } }))).toMatchObject({ items: [], truncated: false });
  await expect(searchSymbols(env, "Apple", provider({ data: {} }))).rejects.toThrow();
  await expect(searchSymbols(env, "Apple", provider({ data: { items: [], padding: "x".repeat(140000) } }))).rejects.toThrow();
});
const metric = () => ({ symbol: "SPY", "implied-volatility-index": "0.25", "implied-volatility-index-rank": "0.42", "implied-volatility-percentile": "0.63", "implied-volatility-index-rank-source": "tos", "tos-implied-volatility-index-rank-updated-at": new Date().toISOString(), "implied-volatility-updated-at": new Date().toISOString(), "liquidity-value": "18000.5", "liquidity-rank": "0.91", "liquidity-rating": 4, "updated-at": new Date().toISOString() });
const earnings = () => ({ visible: true, "expected-report-date": new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10), estimated: false, "late-flag": 0, "updated-at": new Date(Date.now() - 3600000).toISOString(), "actual-eps": "7.77" });

it("reuses metric data for separately timestamped provider-reported earnings dates without issuer confirmation", async () => {
  for (const estimated of [false, true]) {
    const event = { ...earnings(), estimated }, row = { ...metric(), earnings: event };
    const fetcher = vi.fn<typeof fetch>(async input => String(input).endsWith("/oauth/token") ? json({ access_token: "private-token" }) : json({ data: { items: [row] } }));
    const sources = await createBrokerContextLoader(fetcher)({ TASTYTRADE_CLIENT_SECRET: "secret", TASTYTRADE_REFRESH_TOKEN: "refresh" });
    expect(sources[4]).toMatchObject({ id: "tastytrade-earnings-spy", status: "available", asOf: event["updated-at"] });
    expect(sources[4].summary).toContain(event["expected-report-date"]);
    expect(sources[4].summary).toContain(`estimated=${estimated}`);
    expect(sources[4].summary).toContain("not issuer-confirmed");
    expect(sources[4].summary).toContain("report time or session");
    expect(sources[4].summary).not.toContain("7.77");
    expect(fetcher).toHaveBeenCalledTimes(3);
  }
});

it("withholds missing stale ambiguous and invalid earnings dates without claiming no event", async () => {
  for (const patch of [null, { visible: false }, { estimated: undefined }, { "late-flag": 1 }, { "late-flag": "0" }, { "expected-report-date": "2026-02-30" }, { "expected-report-date": "2020-01-01" }, { "expected-report-date": "2099-01-01" }, { "updated-at": undefined }, { "updated-at": new Date(Date.now() - 86400001).toISOString() }, { "updated-at": new Date(Date.now() + 60000).toISOString() }]) {
    const row = { ...metric(), earnings: patch === null ? undefined : { ...earnings(), ...patch } };
    const sources = await createBrokerContextLoader(async input => String(input).endsWith("/oauth/token") ? json({ access_token: "private-token" }) : json({ data: { items: [row] } }))({ TASTYTRADE_CLIENT_SECRET: "secret", TASTYTRADE_REFRESH_TOKEN: "refresh" });
    expect(sources[4]).toMatchObject({ status: "unavailable", asOf: null });
    expect(sources[4].reason).toContain("not establish");
    expect(sources.slice(2, 4).every(source => source.status === "available")).toBe(true);
  }
});

it("loads independently dated raw IV and liquidity metrics with one shared read-only token", async () => {
  const row = metric(), requests: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input)); requests.push(url.pathname);
    if (url.pathname === "/oauth/token") { expect(JSON.parse(String(init?.body)).scope).toBe("read"); return json({ access_token: "private-token" }); }
    expect(init?.headers).toMatchObject({ Authorization: "Bearer private-token" });
    if (url.pathname === "/market-metrics") { expect(url.searchParams.get("symbols")).toBe("SPY"); return json({ data: { items: [row] } }); }
    return new Response("quote denied", { status: 403 });
  });
  const result = await createBrokerContextLoader(fetcher)({ TASTYTRADE_CLIENT_SECRET: "secret", TASTYTRADE_REFRESH_TOKEN: "refresh" });
  expect(result.map(source => source.status)).toEqual(["unavailable", "unavailable", "available", "available", "unavailable"]);
  expect(result[2]).toMatchObject({ id: "tastytrade-iv-spy", asOf: [row["implied-volatility-updated-at"], row["tos-implied-volatility-index-rank-updated-at"]].sort()[0] });
  expect(result[2].summary).toContain("index 0.25, index rank 0.42");
  expect(result[2].summary).toContain("Percentile omitted"); expect(result[2].summary).not.toContain("0.63");
  expect(result[3]).toMatchObject({ id: "tastytrade-liquidity-spy", asOf: row["updated-at"] });
  expect(result[3].summary).toContain("value 18000.5, rank 0.91, rating 4");
  expect(result[3].summary).toContain("record timestamp"); expect(result[3].summary).toContain("not a liquidity-observation timestamp");
  expect(requests.filter(path => path === "/oauth/token")).toHaveLength(1);
});

it("fails closed on incomplete metric identity and validates IV and liquidity groups independently", async () => {
  const load = (body: unknown) => createBrokerContextLoader(async input => String(input).endsWith("/oauth/token") ? json({ access_token: "private-token" }) : json(body))({ TASTYTRADE_CLIENT_SECRET: "secret", TASTYTRADE_REFRESH_TOKEN: "refresh" });
  for (const body of [{}, { data: { items: [metric(), metric()] } }, { data: { items: [{ ...metric(), symbol: "AAPL" }] } }, { data: { items: [metric()] }, pagination: { "total-pages": 2 } }]) expect((await load(body)).slice(2, 4).map(source => source.status)).toEqual(["unavailable", "unavailable"]);
  for (const patch of [{ "implied-volatility-index": null }, { "implied-volatility-index": 0 }, { "implied-volatility-index-rank": "" }, { "implied-volatility-index-rank-source": "other" }, { "tos-implied-volatility-index-rank-updated-at": undefined }, { "tos-implied-volatility-index-rank-updated-at": new Date(Date.now() - 86400001).toISOString() }, { "implied-volatility-updated-at": "2026-02-30T12:00:00Z" }, { "implied-volatility-updated-at": new Date(Date.now() - 86400001).toISOString() }, { "implied-volatility-updated-at": new Date(Date.now() + 60000).toISOString() }]) expect((await load({ data: { items: [{ ...metric(), ...patch }] } })).slice(2, 4).map(source => source.status)).toEqual(["unavailable", "available"]);
  for (const patch of [{ "liquidity-value": "" }, { "liquidity-value": -1 }, { "liquidity-rating": null }, { "liquidity-rating": 1.5 }, { "liquidity-rating": -1 }, { "liquidity-rank": "Infinity" }, { "updated-at": undefined }, { "updated-at": new Date(Date.now() - 86400001).toISOString() }]) expect((await load({ data: { items: [{ ...metric(), ...patch }] } })).slice(2, 4).map(source => source.status)).toEqual(["available", "unavailable"]);
});

it("isolates quote and reference requests, evidence and cache by symbol", async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth/token")) return json({ access_token: "private-token" });
    const symbol = url.searchParams.get("equity") ?? url.searchParams.get("symbol");
    if (url.pathname.includes("market-data")) return json({ data: { items: [{ symbol, bid: "100", ask: "101", "updated-at": new Date().toISOString() }] } });
    return json({ response: [{ symbol, expiration: "2099-09-18" }] });
  }) as typeof fetch;
  const load = createBrokerContextLoader(fetcher);
  for (const symbol of ["SPY", "QQQ", "AAPL"]) {
    const result = await load(env, symbol);
    expect(result.map(x => x.status)).toEqual(["available", "available", "unavailable", "unavailable", "unavailable"]);
    expect(result.map(x => x.id)).toEqual([`tastytrade-${symbol.toLowerCase()}`, symbol === "SPY" ? "theta-reference" : `theta-reference-${symbol.toLowerCase()}`, `tastytrade-iv-${symbol.toLowerCase()}`, `tastytrade-liquidity-${symbol.toLowerCase()}`, `tastytrade-earnings-${symbol.toLowerCase()}`]);
    expect(result.every(x => x.label.includes(symbol) && x.summary.includes(symbol))).toBe(true);
    await load(env, symbol);
  }
  expect(fetcher).toHaveBeenCalledTimes(12);
}, 15000);

it.each(["qqq", "AAPL/", "", "TOOLONG", "SPY\n"])("rejects invalid root %j before broker requests", async symbol => {
  const fetcher = vi.fn() as typeof fetch;
  await expect(createBrokerContextLoader(fetcher)(env, symbol)).rejects.toThrow("Invalid symbol");
  expect(fetcher).not.toHaveBeenCalled();
});

it("does not relabel a different underlying's quote or reference catalog", async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/oauth/token")) return json({ access_token: "private-token" });
    if (String(input).includes("market-data")) return json({ data: { items: [{ symbol: "SPY", bid: "100", ask: "101", "updated-at": new Date().toISOString() }] } });
    return json({ response: [{ symbol: "SPY", expiration: "2099-09-18" }] });
  }) as typeof fetch;
  const result = await createBrokerContextLoader(fetcher)(env, "QQQ");
  expect(result.every(x => x.status === "unavailable" && x.label.includes("QQQ"))).toBe(true);
});

it("loads read-only quotes and reference dates, coalescing and caching requests", async () => {
  const requests: { url: string; body: string }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: String(init?.body ?? "") });
    if (url.endsWith("/oauth/token")) return json({ access_token: "private-token" });
    if (url.includes("market-data")) return json({ data: { items: [{ symbol: "SPY", bid: "100", ask: "101", "updated-at": new Date().toISOString() }] } });
    return json({ response: [{ symbol: "SPY", expiration: "2099-09-18" }, { symbol: "SPY", expiration: "2012-01-01" }] });
  }) as typeof fetch;
  const load = createBrokerContextLoader(fetcher);
  const [first, concurrent] = await Promise.all([load(env), load(env)]);
  expect(first).toEqual(concurrent);
  expect(first.map(x => x.status)).toEqual(["available", "available", "unavailable", "unavailable", "unavailable"]);
  expect(first[1].summary).toContain("reference");
  expect(first[1].summary).toContain("2099-09-18");
  expect(JSON.stringify(first)).not.toMatch(/private-token|refresh|secret/);
  expect(JSON.parse(requests.find(x => x.url.endsWith("/oauth/token"))!.body).scope).toBe("read");
  await load(env);
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("rejects remote Theta URLs and missing broker credentials without requests", async () => {
  const fetcher = vi.fn() as typeof fetch;
  const result = await createBrokerContextLoader(fetcher)({ THETADATA_TERMINAL_URL: "https://untrusted.example" });
  expect(result.every(x => x.status === "unavailable")).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["inverted", "oversized", "failure", "future"])("fails closed on %s provider data", async problem => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/oauth/token")) return json({ access_token: "private-token" });
    if (problem === "failure") throw new Error("private-token");
    if (problem === "oversized") return new Response("x".repeat(128 * 1024 + 1));
    return json({ data: { items: [{ symbol: "SPY", bid: "101", ask: problem === "inverted" ? "100" : "102", "updated-at": problem === "future" ? "2099-01-01T00:00:00Z" : new Date().toISOString() }] } });
  }) as typeof fetch;
  const result = await createBrokerContextLoader(fetcher)({ TASTYTRADE_CLIENT_SECRET: "secret", TASTYTRADE_REFRESH_TOKEN: "refresh" });
  expect(result[0].status).toBe("unavailable");
  expect(JSON.stringify(result)).not.toContain("private-token");
});

it("expires cached failures and fails closed when a provider ignores cancellation", async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn(() => new Promise<Response>(() => {})) as typeof fetch;
    const load = createBrokerContextLoader(fetcher);
    const pending = load({ TASTYTRADE_CLIENT_SECRET: "secret", TASTYTRADE_REFRESH_TOKEN: "refresh" });
    await vi.advanceTimersByTimeAsync(5_001);
    expect((await pending)[0].status).toBe("unavailable");
    await load({ TASTYTRADE_CLIENT_SECRET: "secret", TASTYTRADE_REFRESH_TOKEN: "refresh" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_001);
    const next = load({ TASTYTRADE_CLIENT_SECRET: "secret", TASTYTRADE_REFRESH_TOKEN: "refresh" });
    await vi.advanceTimersByTimeAsync(5_001);
    await next;
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

it("does not accept rolled-over invalid dates as Theta reference metadata", async () => {
  const fetcher = vi.fn(async () => json({ response: [{ symbol: "SPY", expiration: "2099-02-30" }] })) as typeof fetch;
  const result = await createBrokerContextLoader(fetcher)({ THETADATA_TERMINAL_URL: "http://localhost:25503" });
  expect(result[1].status).toBe("unavailable");
});

it.each([48 * 60 * 60 * 1000, -60_000])("rejects quote timestamp offset %s from now", async age => {
  const asOf = new Date(Date.now() - age).toISOString();
  const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/oauth/token")
    ? json({ access_token: "private-token" })
    : json({ data: { items: [{ symbol: "SPY", bid: "100", ask: "101", "updated-at": asOf }] } })) as typeof fetch;
  const [quote] = await createBrokerContextLoader(fetcher)({ TASTYTRADE_CLIENT_SECRET: "secret", TASTYTRADE_REFRESH_TOKEN: "refresh" });
  expect(quote.status).toBe("unavailable");
  if (age > 0) {
    expect(quote.asOf).toBe(asOf);
    expect(quote.reason).toContain("24 hours");
    expect(quote.summary).toContain(asOf);
  }
});
