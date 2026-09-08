import { beforeAll, expect, it, vi } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import migration from "../migrations/0003_quote_snapshots.sql?raw";
import { createOptionChainStore } from "../src/option-chain";
import { createMarketStrategy, calculateStrategy, contractTermsFacts, validateMarketStrategy } from "../src/options";

const db = (workerEnv as { DB: D1Database }).DB;
beforeAll(async () => { await db.batch(migration.split(";").filter(sql => sql.trim()).map(sql => db.prepare(sql))); });
const env = { DB: db, TASTYTRADE_CLIENT_SECRET: "secret", TASTYTRADE_REFRESH_TOKEN: "refresh" };
const dates = ["2099-09-18", "2099-09-25"];
it('reports bounded load failure stages without raw provider or storage errors', async () => {
  await expect(createOptionChainStore(fixture('iv')).load(env)).rejects.toMatchObject({ stage: 'quotes', reason: 'Missing volatility' });
  await expect(createOptionChainStore(fixture('crossed')).load(env)).rejects.toMatchObject({ stage: 'quotes', reason: 'Crossed quote' });
  await expect(createOptionChainStore(fixture('future')).load(env)).rejects.toMatchObject({ stage: 'quotes', reason: 'Future quote timestamp' });
  const privateText = 'private-token-and-database-details';
  const provider = vi.fn<typeof fetch>(async () => { throw new Error(privateText) });
  const authError = await createOptionChainStore(provider).load(env).catch(error => error);
  expect(authError).toMatchObject({ stage: 'authentication', reason: 'Unavailable' });
  expect(JSON.stringify(authError)).not.toContain(privateText);
  const storage = { ...env, DB: { ...db, prepare: () => { throw new Error(privateText) } } as unknown as D1Database };
  const storageError = await createOptionChainStore(fixture()).load(storage).catch(error => error);
  expect(storageError).toMatchObject({ stage: 'storage', reason: 'Unavailable' });
  expect(JSON.stringify(storageError)).not.toContain(privateText);
});
const id = (date: string, type: string, strike: number) => `SPY   ${date.slice(2).replaceAll("-", "")}${type}${String(strike * 1000).padStart(8, "0")}`;
function streamed(contractId: string) {
  const now = Date.now();
  const receivedAt = new Date(now - 1000).toISOString();
  return { capturedAt: new Date(now).toISOString(), underlying: { bid: 100, ask: 102, bidTime: now - 4000, askTime: now - 3000, receivedAt }, contracts: [{ contractId, quote: { bid: 3, ask: 4, bidTime: now - 5000, askTime: now - 3000, receivedAt }, greeks: { iv: .3, time: now - 6000, receivedAt } }] };
}

it("persists underlying-only captures without fabricating option quotes or terms", async () => {
  const store = createOptionChainStore(fixture());
  const base = await store.load(env, undefined, "stock-owner");
  const capture = { ...streamed(base.contracts[0].contractId), contracts: [] };
  const next = await store.capture(base, [], capture, env, "stock-owner");
  expect(next).toMatchObject({ contracts: [], availableExpiries: [], spot: 101, captureSource: "DXLink" });
  expect(next.contractTerms).toBeUndefined();
  expect(await store.get(next.id, env, "stock-owner")).toEqual(next);
  expect(await store.get(next.id, env, "other-owner")).toBeUndefined();
  expect(await store.restore(next, env, "stock-owner")).toMatchObject({ contracts: [], historical: true, spotSourceTimes: next.spotSourceTimes });
  await expect(store.capture(next, [], { ...capture, underlying: { ...capture.underlying, bidTime: Date.now() - 301000 } }, env, "stock-owner")).rejects.toThrow();
  await expect(store.restore({ ...next, captureSource: undefined, spotSourceTimes: undefined }, env, "stock-owner")).rejects.toThrow();
});

it("captures selected stream prices with trusted identity and restores exact dated provenance", async () => {
  const store = createOptionChainStore(fixture());
  const base = await store.load(env, undefined, "alice");
  expect(base.contractTerms).toEqual({ exerciseStyle: "American", settlement: "physical-shares", sharesPerContract: 100, settlementSession: "PM" });
  expect((await store.get(base.id, env, "alice"))?.contractTerms).toEqual(base.contractTerms);
  const contract = base.contracts[0], capture = streamed(contract.contractId);
  const supplied = structuredClone(base);
  supplied.contracts[0].strike = 999;
  const next = await store.capture(supplied, [contract.contractId], capture, env, "alice");
  expect(next.id).not.toBe(base.id);
  expect(next.captureSource).toBe("DXLink");
  expect(next.contractTerms).toEqual(base.contractTerms);
  expect(next.spot).toBe(101);
  expect(next.spotAsOf).toBe(new Date(capture.underlying.bidTime).toISOString());
  expect(next.contracts).toHaveLength(1);
  expect(next.contracts[0]).toMatchObject({ contractId: contract.contractId, strike: contract.strike, expiry: contract.expiry, bid: 3, ask: 4, iv: .3, quoteAsOf: new Date(capture.contracts[0].greeks.time).toISOString() });
  expect(next.contracts[0].volume).toBeUndefined();
  const state = createMarketStrategy("long-call", next);
  expect(validateMarketStrategy(state, next)).toEqual([]);
  expect(calculateStrategy(state).entryAmount).toBe(350);
  const restored = await store.restore(next, env, "alice");
  expect(restored).toEqual({ ...next, id: restored.id, historical: true });
  const imported = await store.restore({ ...restored, imported: true }, env, 'alice');
  expect(imported.imported).toBe(true);
  expect(contractTermsFacts(imported).status).toBe('unknown');
  const capturedImport = await store.capture(imported, [contract.contractId], capture, env, 'alice');
  expect(capturedImport.contractTerms).toBeUndefined();
  expect(contractTermsFacts(capturedImport).status).toBe('unknown');
  expect(capturedImport.contracts[0].bid).toBe(3);
  next.contracts[0].bid = 999;
  expect((await store.get(next.id, env, "alice"))!.contracts[0].bid).toBe(3);
  expect((await store.get(base.id, env, "alice"))!.contracts[0].bid).toBe(1);
});

it("rejects malformed recorded contract terms and preserves unknown legacy terms", async () => {
  const store = createOptionChainStore(fixture());
  const snapshot = await store.load(env, undefined, "alice");
  for (const contractTerms of [null, [], {}, { ...snapshot.contractTerms, exerciseStyle: "European" }, { ...snapshot.contractTerms, settlement: "cash" }, { ...snapshot.contractTerms, sharesPerContract: 10 }, { ...snapshot.contractTerms, settlementSession: "AM" }, { ...snapshot.contractTerms, extra: true }]) {
    await expect(store.restore({ ...snapshot, contractTerms } as typeof snapshot, env, "alice")).rejects.toThrow("Invalid contract terms");
  }
  delete snapshot.contractTerms;
  const restored = await store.restore(snapshot, env, "alice");
  expect(restored.contractTerms).toBeUndefined();
  expect((await store.get(restored.id, env, "alice"))?.contractTerms).toBeUndefined();
});

it("rejects stream capture with wrong ownership, selection or source timing", async () => {
  const store = createOptionChainStore(fixture());
  const base = await store.load(env, undefined, "alice");
  const selected = [base.contracts[0].contractId], capture = streamed(selected[0]);
  await expect(store.capture(base, selected, capture, env, "bob")).rejects.toThrow();
  await expect(store.capture(base, selected, capture, { ...env, TASTYTRADE_REFRESH_TOKEN: "other" }, "alice")).rejects.toThrow();
  await expect(store.capture({ ...base, id: "missing" }, selected, capture, env, "alice")).rejects.toThrow();
  for (const ids of [[], [...selected, ...selected], [base.contracts[2].contractId]]) await expect(store.capture(base, ids, capture, env, "alice")).rejects.toThrow();
  await expect(store.capture(base, base.contracts.slice(0, 5).map(c => c.contractId), capture, env, "alice")).rejects.toThrow();
  for (const mutate of [
    (c: ReturnType<typeof streamed>) => { c.underlying.bidTime = 0; },
    (c: ReturnType<typeof streamed>) => { Reflect.deleteProperty(c.contracts[0].quote, "bidTime"); },
    (c: ReturnType<typeof streamed>) => { c.underlying.ask = -1; },
    (c: ReturnType<typeof streamed>) => { c.contracts[0].greeks.iv = NaN; },
    (c: ReturnType<typeof streamed>) => { c.contracts[0].greeks.time = Date.now() + 1000; },
    (c: ReturnType<typeof streamed>) => { c.contracts[0].quote.askTime = Date.now() - 301_000; },
    (c: ReturnType<typeof streamed>) => { c.contracts[0].quote.bidTime = Date.now() - 64_000; },
    (c: ReturnType<typeof streamed>) => { c.underlying.receivedAt = new Date(Date.now() - 61_000).toISOString(); },
  ]) { const bad = structuredClone(capture); mutate(bad); await expect(store.capture(base, selected, bad, env, "alice")).rejects.toThrow(); }
  const next = await store.capture(base, selected, capture, env, "alice");
  const corrupt = structuredClone(next);
  corrupt.contracts[0].sourceTimes!.iv = "2099-01-01T00:00:00Z";
  await expect(store.restore(corrupt, env, "alice")).rejects.toThrow();
});
function fixture(problem = "", dates = ["2099-09-18", "2099-09-25"]) {
  const symbols = dates.flatMap(date => Array.from({ length: 31 }, (_, i) => ["C", "P"].map(type => ({ symbol: id(date, type, 85 + i), date, type, strike: 85 + i }))).flat());
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if ((url.searchParams.get('equity-option')?.split(',').length ?? 0) > 100) return new Response('Too many symbols', { status: 400 });
    let value: unknown;
    if (url.pathname === "/oauth/token") {
      expect(JSON.parse(String(init?.body)).scope).toBe("read");
      value = { access_token: "private" };
    } else if (url.pathname.includes("option-chains")) value = { data: { items: [{ "underlying-symbol": "SPY", "root-symbol": "SPY", "option-chain-type": "Standard", "shares-per-contract": 100, deliverables: [{ amount: "100", "deliverable-type": "Shares", symbol: "SPY" }], expirations: dates.map(date => ({ "expiration-date": date, "settlement-type": problem === "settlement" ? "AM" : "PM", strikes: Array.from({ length: 31 }, (_, i) => ({ "strike-price": String(85 + i), call: id(date, "C", 85 + i), put: id(date, "P", 85 + i) })) })) }] }, pagination: problem === "partial" ? { "total-pages": 2 } : null };
    else if (url.pathname.includes("instruments")) {
      const s = symbols.find(s => decodeURIComponent(url.pathname.split("/").at(-1)!) === s.symbol)!;
      value = { data: { symbol: s.symbol, "underlying-symbol": "SPY", "root-symbol": "SPY", "option-type": s.type, "strike-price": String(s.strike), "expiration-date": s.date, "expires-at": `${s.date}T20:15:00Z`, "stops-trading-at": `${s.date}T20:15:00Z`, "exercise-style": "American", "shares-per-contract": 100, "settlement-type": "PM", "option-chain-type": "Standard" } };
    }
    else if (url.searchParams.has("equity")) value = { data: { items: [{ symbol: "SPY", bid: "99", ask: "101", "updated-at": "2026-01-01T00:00:00Z" }] } };
    else value = { data: { items: symbols.filter(s => url.searchParams.get("equity-option")?.split(",").includes(s.symbol)).map(s => ({ symbol: s.symbol, bid: "1", ask: problem === "crossed" ? ".5" : "2", volatility: problem === "iv" ? null : ".22", "updated-at": problem === "future" ? "2200-01-01T00:00:00Z" : "2026-01-01T00:00:00Z" })) } };
    return new Response(JSON.stringify(value));
  }) as typeof fetch;
}

function symbolFixture(symbol: string, problem = "") {
  const base = fixture();
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const original = new URL(url);
    original.pathname = decodeURIComponent(original.pathname).replaceAll(symbol.padEnd(6), "SPY   ").replaceAll(symbol, "SPY");
    for (const [key, value] of original.searchParams) original.searchParams.set(key, value.replaceAll(symbol.padEnd(6), "SPY   ").replaceAll(symbol, "SPY"));
    const response = await base(original, init);
    const body = JSON.parse((await response.text()).replaceAll("SPY   ", symbol.padEnd(6)).replaceAll('"SPY"', JSON.stringify(symbol)).replaceAll("T20:15:00Z", "T20:00:00Z"));
    if (problem === "root" && url.pathname.includes("option-chains")) body.data.items[0]["root-symbol"] = "SPY";
    if (problem === "deliverable" && url.pathname.includes("option-chains")) body.data.items[0].deliverables[0].symbol = "SPY";
    if (problem === "instrument" && url.pathname.includes("instruments")) body.data["underlying-symbol"] = "SPY";
    if ((problem === "contract" || problem === "padding") && url.pathname.includes("option-chains")) {
      for (const expiry of body.data.items[0].expirations) for (const strike of expiry.strikes) strike.call = problem === "contract" ? `SPY   ${strike.call.slice(6)}` : strike.call.replace("  ", " ");
    }
    return new Response(JSON.stringify(body));
  }) as typeof fetch;
}

it("includes same-day contracts before their verified stop time and omits them at the cutoff", async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date(`${dates[0]}T19:00:00Z`));
    const store = createOptionChainStore(fixture());
    const snapshot = await store.load(env);
    expect(snapshot.availableExpiries).toEqual(dates);
    expect(snapshot.contracts.some(contract => contract.expiry.startsWith(dates[0]))).toBe(true);
    const position = createMarketStrategy('bull-call', snapshot);
    expect(validateMarketStrategy(position, snapshot)).toEqual([]);
    expect(Number.isFinite(calculateStrategy(position).entryAmount)).toBe(true);
    expect(await store.get(snapshot.id, env)).toEqual(snapshot);
    vi.setSystemTime(new Date(`${dates[0]}T20:15:00Z`));
    const later = await store.load(env);
    expect(later.availableExpiries).toEqual([dates[1]]);
    expect(later.contracts.every(contract => contract.expiry.startsWith(dates[1]))).toBe(true);
    await expect(store.load(env, [dates[0]])).rejects.toThrow();
    await expect(store.load(env, undefined, 'local-development', 'SPY', { retain: [snapshot.contracts[0].contractId] })).rejects.toThrow();
    const historical = await store.restore(snapshot, env, 'local-development');
    expect(historical.contracts).toEqual(snapshot.contracts);
    expect(historical.historical).toBe(true);
  } finally { vi.useRealTimers(); }
});

it.each(['conflict', 'representative-conflict', 'invalid', 'crossing'])("rejects unsafe same-day %s schedules without storing a snapshot", async problem => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date(`${dates[0]}T20:14:59Z`));
    const base = fixture();
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input)), response = await base(input, init);
      const value = await response.json() as any;
      if (url.pathname.includes('instruments') && value.data['expiration-date'] === dates[0]) {
        if (problem === 'conflict' && value.data['option-type'] === 'P') value.data['stops-trading-at'] = `${dates[0]}T20:14:00Z`;
        if (problem === 'representative-conflict' && Number(value.data['strike-price']) > 85) value.data['expires-at'] = `${dates[0]}T20:16:00Z`;
        if (problem === 'invalid') value.data['stops-trading-at'] = 'invalid';
      }
      if (problem === 'crossing' && url.searchParams.has('equity-option')) vi.setSystemTime(new Date(`${dates[0]}T20:15:00Z`));
      return Response.json(value);
    };
    const batch = vi.fn();
    const bindings = { ...env, DB: { prepare: db.prepare.bind(db), batch } as unknown as D1Database };
    await expect(createOptionChainStore(fetcher).load(bindings)).rejects.toThrow('Option chain unavailable');
    expect(batch.mock.calls.length).toBe(0);
  } finally { vi.useRealTimers(); }
});

it.each(["QQQ", "AAPL", "F", "ABCDEF"])("binds %s quotes, contracts, schedules and saved states to their root", async symbol => {
  const fetcher = symbolFixture(symbol);
  const store = createOptionChainStore(fetcher);
  const snapshot = await store.load(env, undefined, "alice", symbol);
  expect(snapshot.underlying).toBe(symbol);
  expect(snapshot.contracts[0].contractId.slice(0, 6)).toBe(symbol.padEnd(6));
  expect(snapshot.contracts[0].expiry).toMatch(/T20:00:00.000Z$/);
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(`/option-chains/${symbol}/nested`), expect.anything());
  const state = createMarketStrategy("bull-call", snapshot);
  expect(state.underlying).toBe(symbol);
  expect(validateMarketStrategy(state, snapshot)).toEqual([]);
  expect(validateMarketStrategy({ ...state, underlying: "SPY" }, snapshot).length).toBeGreaterThan(0);
  expect((await store.restore(snapshot, env, "alice")).underlying).toBe(symbol);
  const wrong = structuredClone(snapshot);
  wrong.contracts.at(-1)!.contractId = `SPY   ${wrong.contracts.at(-1)!.contractId.slice(6)}`;
  await expect(store.restore(wrong, env, "alice")).rejects.toThrow();
});

it.each(["root", "deliverable", "instrument", "contract", "padding"])("rejects mismatched market %s metadata", async problem => {
  await expect(createOptionChainStore(symbolFixture("AAPL", problem)).load(env, undefined, "alice", "AAPL")).rejects.toThrow();
});

it("rejects unsupported roots before provider calls and restores only proven legacy SPY catalogs", async () => {
  const fetcher = fixture();
  const store = createOptionChainStore(fetcher);
  for (const symbol of ["qqq", "BRK.B", "SPX1", "ABCDEFG", "", "../SPY", "SPY\n", "SPY\r\n"]) {
    await expect(store.load(env, undefined, "alice", symbol)).rejects.toThrow();
  }
  expect(fetcher).not.toHaveBeenCalled();
  const snapshot = await store.load(env);
  for (const underlying of ["SPY\n", "SPY\r\n"]) {
    await expect(store.restore({ ...snapshot, underlying }, env, "alice")).rejects.toThrow("underlying");
  }
  const legacy = { ...snapshot };
  delete (legacy as Partial<typeof legacy>).underlying;
  expect((await store.restore(legacy, env, "alice")).underlying).toBe("SPY");
  legacy.contracts[0].contractId = `QQQ   ${legacy.contracts[0].contractId.slice(6)}`;
  await expect(store.restore(legacy, env, "alice")).rejects.toThrow();
});

it("scopes quote handles by owner and restores historical prices without changing valuations", async () => {
  const store = createOptionChainStore(fixture());
  const snapshot = await store.load(env, undefined, "alice");
  expect(await store.get(snapshot.id, env, "bob")).toBeUndefined();
  const state = createMarketStrategy("bull-call", snapshot);
  const restored = await store.restore(snapshot, env, "alice");
  expect(restored.id).not.toBe(snapshot.id);
  expect(restored).toEqual({ ...snapshot, id: restored.id, historical: true });
  expect(await store.get(restored.id, env, "bob")).toBeUndefined();
  const reopened = { ...state, pricing: { ...state.pricing!, snapshotId: restored.id, historical: true as const } };
  expect(validateMarketStrategy(reopened, restored)).toEqual([]);
  expect(calculateStrategy(reopened)).toEqual(calculateStrategy(state));
  expect(validateMarketStrategy({ ...reopened, pricing: { ...reopened.pricing, historical: undefined } }, restored)).toContain("historical quote provenance does not match");
  const corrupt = structuredClone(snapshot);
  corrupt.contracts.at(-1)!.bid = -1;
  await expect(store.restore(corrupt, env, "alice")).rejects.toThrow("Invalid saved contract");
});

it("browses around a separate strike center while retaining distant legs across expiries", async () => {
  const store = createOptionChainStore(fixture());
  const baseline = await store.load(env);
  const retain = [id(dates[0], "C", 85), id(dates[0], "P", 86), id(dates[1], "C", 85), id(dates[1], "P", 87)];
  const snapshot = await store.load(env, dates, "alice", "SPY", { center: 115, retain });
  expect(snapshot.spot).toBe(100);
  expect(snapshot.strikeCenter).toBe(115);
  expect(baseline.strikeCenter).toBe(100);
  expect(baseline.contracts.some(c => c.strike === 115)).toBe(false);
  expect(snapshot.contracts).toHaveLength(100);
  for (const contract of retain) expect(snapshot.contracts.some(c => c.contractId === contract)).toBe(true);
  for (const date of dates) expect(snapshot.contracts.some(c => c.expiry.startsWith(date) && c.strike === 115)).toBe(true);
  expect((await store.restore(snapshot, env, "alice")).strikeCenter).toBe(115);
  const legacy = { ...snapshot };
  delete legacy.strikeCenter;
  expect((await store.restore(legacy, env, "alice")).strikeCenter).toBe(100);
  for (const strikeCenter of [0, -1, Infinity, NaN, 1_000_001]) await expect(store.restore({ ...snapshot, strikeCenter }, env, "alice")).rejects.toThrow();
});

it("rejects invalid browsing inputs before providers and unlisted retained legs after chain lookup", async () => {
  const fetcher = fixture();
  const store = createOptionChainStore(fetcher);
  for (const center of [0, -1, NaN, Infinity, 1_000_001]) await expect(store.load(env, dates, "alice", "SPY", { center })).rejects.toThrow();
  for (const retain of [["QQQ   990918C00085000"], [id(dates[0], "C", 85), id(dates[0], "C", 85)], Array.from({ length: 9 }, (_, i) => id(dates[0], "C", 85 + i)), ["SPY  990918C00085000"], [`${id(dates[0], "C", 85)}\n`]]) await expect(store.load(env, dates, "alice", "SPY", { retain })).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  for (const retain of [[id(dates[0], "C", 200)], [id("2099-10-01", "C", 85)]]) await expect(store.load(env, dates, "alice", "SPY", { retain })).rejects.toThrow();
});

it("fails closed when a retained contract quote is missing", async () => {
  const normal = fixture();
  const retained = id(dates[0], "C", 85);
  const fetcher = (async (url, init) => {
    const response = await normal(url, init);
    if (!String(url).includes("equity-option=")) return response;
    const body = await response.json() as any;
    body.data.items = body.data.items.filter((item: any) => item.symbol !== retained);
    return Response.json(body);
  }) as typeof fetch;
  await expect(createOptionChainStore(fetcher).load(env, dates, "alice", "SPY", { center: 115, retain: [retained] })).rejects.toThrow();
});

it("loads and restores four expiries while retaining eight distant contracts", async () => {
  const selectedDates = [...dates, '2099-10-02', '2099-10-09'];
  const retain = selectedDates.flatMap(date => [id(date, 'C', 85), id(date, 'P', 115)]);
  const store = createOptionChainStore(fixture('', [...selectedDates, '2099-10-16']));
  const snapshot = await store.load(env, selectedDates, 'wider-owner', 'SPY', { center: 100, retain });
  expect(snapshot.contracts).toHaveLength(200);
  expect(new Set(snapshot.contracts.map(contract => contract.expiry)).size).toBe(4);
  expect(retain.every(contractId => snapshot.contracts.some(contract => contract.contractId === contractId))).toBe(true);
  expect(await store.get(snapshot.id, env, 'wider-owner')).toEqual(snapshot);
  expect((await store.restore(snapshot, env, 'wider-owner')).contracts).toEqual(snapshot.contracts);
  expect(await store.get(snapshot.id, env, 'other-owner')).toBeUndefined();
  await expect(store.load(env, [...selectedDates, '2099-10-16'])).rejects.toThrow();
  const capture = streamed(retain[0]);
  capture.contracts = retain.map(contractId => ({ ...structuredClone(capture.contracts[0]), contractId }));
  const captured = await store.capture(snapshot, retain, capture, env, 'wider-owner');
  expect(captured.contracts).toHaveLength(8);
  expect(captured.contracts.map(contract => contract.contractId)).toEqual(retain);
  await expect(store.capture(snapshot, [...retain, snapshot.contracts.find(c => !retain.includes(c.contractId))!.contractId], capture, env, 'wider-owner')).rejects.toThrow();
  const normal = fixture('', selectedDates), batch = vi.fn();
  const incomplete: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.searchParams.get('equity-option')?.includes('991009')) return Response.json({ data: { items: [] } });
    return normal(input, init);
  };
  await expect(createOptionChainStore(incomplete).load({ ...env, DB: { prepare: db.prepare.bind(db), batch } as unknown as D1Database }, selectedDates)).rejects.toMatchObject({ stage: 'quotes', reason: 'Missing quote' });
  expect(batch.mock.calls.length).toBe(0);
});

it("loads a bounded listed window, preserves OCC spaces and exact expiry, isolates and expires snapshots", async () => {
  const fetcher = fixture();
  const store = createOptionChainStore(fetcher);
  const snapshot = await store.load(env);
  expect(snapshot.contracts).toHaveLength(100);
  expect(snapshot.contracts[0].contractId).toContain("SPY   ");
  expect(snapshot.contracts[0].expiry).toMatch(/T20:15:00.000Z$/);
  expect(snapshot.contracts[0].iv).toBe(.22);
  expect(await store.get(snapshot.id, env)).toEqual(snapshot);
  expect(await store.get(snapshot.id, { ...env, TASTYTRADE_REFRESH_TOKEN: "other" })).toBeUndefined();
  expect(await store.get("missing", env)).toBeUndefined();
  expect(JSON.stringify(snapshot)).not.toMatch(/private|secret|refresh/);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 601_000);
  expect(await store.get(snapshot.id, env)).toBeUndefined();
  vi.restoreAllMocks();
});

it.each(["settlement", "partial", "crossed", "iv", "future"])("rejects %s rather than fabricating prices", async problem => {
  await expect(createOptionChainStore(fixture(problem)).load(env)).rejects.toThrow("Option chain unavailable");
});

it("fails closed for unlisted expiries and missing credentials", async () => {
  const fetcher = fixture();
  await expect(createOptionChainStore(fetcher).load({})).rejects.toThrow("Option chain unavailable");
  expect(fetcher).not.toHaveBeenCalled();
  await expect(createOptionChainStore(fetcher).load(env, ["2099-01-01"])).rejects.toThrow("Option chain unavailable");
});

it("shares owner-scoped snapshots across instances without evicting live handles during churn", async () => {
  const store = createOptionChainStore(fixture());
  const first = await store.load(env);
  first.contracts[0].bid = 900;
  expect((await store.get(first.id, env))!.contracts[0].bid).toBe(1);
  for (let i = 0; i < 12; i++) await createOptionChainStore(fixture()).load(env, undefined, i % 2 ? "alice" : "bob");
  const other = createOptionChainStore(fixture());
  expect((await other.get(first.id, env))!.contracts[0].bid).toBe(1);
  const copy = (await other.get(first.id, env))!; copy.spot = 999;
  expect((await store.get(first.id, env))!.spot).toBe(100);
  expect(await other.get(first.id, env, "alice")).toBeUndefined();
});

it("persists only credential fingerprints and removes expired rows without reviving handles", async () => {
  const store = createOptionChainStore(fixture()), snapshot = await store.load(env, undefined, "alice");
  const row = await db.prepare("SELECT * FROM quote_snapshots WHERE id = ?").bind(snapshot.id).first<{ credential_fingerprint: string; expires_at: number }>();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([undefined, "secret", "refresh"])));
  expect(row!.credential_fingerprint).toBe(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""));
  expect(JSON.stringify(row)).not.toMatch(/secret|refresh|private/);
  expect(await createOptionChainStore(fixture()).get(snapshot.id, { ...env, TASTYTRADE_REFRESH_TOKEN: "rotated" }, "alice")).toBeUndefined();
  const clock = vi.spyOn(Date, "now").mockReturnValue(row!.expires_at);
  try {
    expect(await createOptionChainStore(fixture()).get(snapshot.id, env, "alice")).toBeUndefined();
    await store.load(env, undefined, "bob");
    expect(await db.prepare("SELECT id FROM quote_snapshots WHERE id = ?").bind(snapshot.id).first()).toBeNull();
  } finally { clock.mockRestore(); }
});

it("fails closed for absent storage, failed persistence, and corrupt stored snapshots", async () => {
  const fetcher = fixture(), store = createOptionChainStore(fetcher), missing = { ...env, DB: undefined };
  await expect(store.load(missing)).rejects.toThrow();
  await expect(store.get("missing", missing)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  const snapshot = await store.load(env);
  await expect(store.restore(snapshot, missing, "alice")).rejects.toThrow();
  const failed = { ...env, DB: { prepare: db.prepare.bind(db), batch: async () => { throw new Error("storage failed"); } } as unknown as D1Database };
  await expect(store.load(failed)).rejects.toThrow();
  await expect(store.restore(snapshot, failed, "alice")).rejects.toThrow();
  await expect(store.capture(snapshot, [snapshot.contracts[0].contractId], streamed(snapshot.contracts[0].contractId), failed, "local-development")).rejects.toThrow();
  for (const json of ["{", JSON.stringify({ ...snapshot, id: "other" }), JSON.stringify({ ...snapshot, historical: false }), JSON.stringify({ ...snapshot, contracts: [{ ...snapshot.contracts[0], bid: -1 }] })]) {
    await db.prepare("UPDATE quote_snapshots SET snapshot_json = ? WHERE id = ?").bind(json, snapshot.id).run();
    expect(await createOptionChainStore(fixture()).get(snapshot.id, env)).toBeUndefined();
  }
});

it("rechecks handle expiry after an awaited database read", async () => {
  const store = createOptionChainStore(fixture()), snapshot = await store.load(env);
  const clock = vi.spyOn(Date, "now");
  const delayed = { ...env, DB: { prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({ first: async () => {
    const row = await db.prepare(sql).bind(...args).first<{ expires_at: number }>();
    clock.mockReturnValue(row!.expires_at);
    return row;
  } }) }) } as unknown as D1Database };
  try { expect(await store.get(snapshot.id, delayed)).toBeUndefined(); }
  finally { clock.mockRestore(); }
});

it("rejects missing quotes and provider redirects", async () => {
  const normal = fixture();
  const missing = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await normal(input, init);
    if (String(input).includes("equity-option=")) {
      const body = await response.json() as any;
      body.data.items.pop();
      return new Response(JSON.stringify(body));
    }
    return response;
  }) as typeof fetch;
  await expect(createOptionChainStore(missing).load(env)).rejects.toThrow("Option chain unavailable");
  const redirect = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.redirect).toBe("manual");
    return new Response(null, { status: 302, headers: { Location: "https://untrusted.example" } });
  }) as typeof fetch;
  await expect(createOptionChainStore(redirect).load(env)).rejects.toThrow("Option chain unavailable");
  expect(redirect).toHaveBeenCalledTimes(1);
});

it("bounds even a provider that ignores cancellation", async () => {
  vi.useFakeTimers();
  try {
    const pending = createOptionChainStore(vi.fn(() => new Promise<Response>(() => {})) as typeof fetch).load(env);
    const assertion = expect(pending).rejects.toThrow("Option chain unavailable");
    await vi.advanceTimersByTimeAsync(5_001);
    await assertion;
  } finally { vi.useRealTimers(); }
});
