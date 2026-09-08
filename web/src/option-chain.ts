import { createBrokerRequest, tastyToken, type BrokerBindings } from "./broker-context";
import type { MarketContract, MarketSnapshot } from "./options";
import type { StreamCapture } from "./quote-feed";
import { capturedProvenance, timestamp, validatedSnapshot } from "./market-snapshot";

export type OptionChainBindings = BrokerBindings & { DB?: D1Database };
export class OptionChainLoadError extends Error {
  readonly reason: string;
  constructor(readonly stage: 'validation' | 'authentication' | 'catalog' | 'selection' | 'instruments' | 'quotes' | 'storage', error: unknown) {
    super("Option chain unavailable: authentication, entitlement, timeout or incomplete provider data.");
    const message = error instanceof Error ? error.message : '';
    this.reason = ['Invalid quote', 'Crossed quote', 'Future quote timestamp', 'Missing volatility', 'Missing quote', 'Invalid timestamp', 'Incomplete response', 'Invalid instrument', 'Invalid expiry', 'Conflicting expiry schedules', 'Timed out', 'Oversized', 'Not configured', 'Quote snapshot storage unavailable'].includes(message) ? message : 'Unavailable';
  }
}
async function credentialKey(env: BrokerBindings) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([env.TASTYTRADE_CLIENT_ID, env.TASTYTRADE_CLIENT_SECRET, env.TASTYTRADE_REFRESH_TOKEN])));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
function database(env: OptionChainBindings) {
  if (!env.DB) throw new Error("Quote snapshot storage unavailable");
  return env.DB;
}
const number = (value: unknown) => (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value)) ? Number(value) : NaN;
function items(value: any): any[] {
  if (!Array.isArray(value?.data?.items) || value.pagination && (number(value.pagination["total-pages"]) !== 1 || value.pagination["next-link"] || value.pagination["next-page"])) throw new Error("Incomplete response");
  return value.data.items;
}
function quote(value: any) {
  const bid = number(value?.bid), ask = number(value?.ask), quoteAsOf = timestamp(value?.["updated-at"]);
  if (ask < bid) throw new Error("Crossed quote");
  if (Date.parse(quoteAsOf) > Date.now()) throw new Error("Future quote timestamp");
  if (bid < 0 || ask <= 0 || ask > 100_000 || !Number.isFinite(bid) || !Number.isFinite(ask)) throw new Error("Invalid quote");
  return { bid, ask, quoteAsOf };
}


export function createOptionChainStore(fetcher: typeof fetch = fetch) {
  const request = createBrokerRequest(fetcher);
  async function register(snapshot: MarketSnapshot, env: OptionChainBindings, owner: string) {
    const db = database(env), frozen = structuredClone(snapshot), json = JSON.stringify(frozen), now = Date.now();
    const key = await credentialKey(env);
    const results = await db.batch([
      db.prepare("DELETE FROM quote_snapshots WHERE expires_at <= ?").bind(now),
      db.prepare("INSERT INTO quote_snapshots (id, owner, credential_fingerprint, expires_at, snapshot_json) VALUES (?, ?, ?, ?, ?)").bind(frozen.id, owner, key, now + 600_000, json),
    ]);
    if (results.some(result => !result.success)) throw new Error("Quote snapshot storage unavailable");
    return frozen;
  }
  async function get(id: string, env: OptionChainBindings, owner = "local-development"): Promise<MarketSnapshot | undefined> {
    const db = database(env), key = await credentialKey(env);
    const row = await db.prepare("SELECT snapshot_json, expires_at FROM quote_snapshots WHERE id = ? AND owner = ? AND credential_fingerprint = ? AND expires_at > ?").bind(id, owner, key, Date.now()).first<{ snapshot_json: string; expires_at: number }>();
    if (!row) return undefined;
    try {
      if (!Number.isSafeInteger(row.expires_at) || row.expires_at <= Date.now() || typeof row.snapshot_json !== "string") return undefined;
      const snapshot = JSON.parse(row.snapshot_json) as MarketSnapshot;
      if (!snapshot || snapshot.id !== id || typeof snapshot.underlying !== "string") return undefined;
      return validatedSnapshot(snapshot);
    } catch { return undefined; }
  }
  async function load(env: OptionChainBindings, expiries?: string[], owner = "local-development", symbol = "SPY", window: { center?: number; retain?: string[] } = {}): Promise<MarketSnapshot> {
    let stage: OptionChainLoadError['stage'] = 'storage';
    try {
      database(env);
      stage = 'validation';
      if (typeof symbol !== "string" || !/^[A-Z]{1,6}$/.test(symbol)) throw new Error("Invalid underlying");
      if (!window || typeof window !== "object" || window.center !== undefined && (!Number.isFinite(window.center) || window.center <= 0 || window.center > 1_000_000)) throw new Error("Invalid strike center");
      const retain = window.retain === undefined ? [] : window.retain;
      if (!Array.isArray(retain) || retain.length > 4 || new Set(retain).size !== retain.length || retain.some(id => typeof id !== "string" || id.length !== 21 || id.slice(0, 6) !== symbol.padEnd(6) || !/^\d{6}[CP]\d{8}$/.test(id.slice(6)))) throw new Error("Invalid retained contracts");
      const deadline = Date.now() + 30_000;
      stage = 'authentication';
      const token = await tastyToken(env, request);
      const get = (path: string, limit?: number) => {
        if (Date.now() >= deadline) throw new Error("Timed out");
        return request(`https://api.tastyworks.com${path}`, { headers: { Authorization: `Bearer ${token}`, "User-Agent": "argus/0.1" } }, limit);
      };
      stage = 'catalog';
      const [rawChain, rawSpot] = await Promise.all([get(`/option-chains/${symbol}/nested`, 2_097_152), get(`/market-data/by-type?equity=${symbol}`)]);
      const underlying = quote(items(rawSpot).find(x => x.symbol === symbol));
      const spot = (underlying.bid + underlying.ask) / 2;
      const strikeCenter = window.center ?? spot;
      if (spot <= 0) throw new Error("Invalid spot");
      stage = 'selection';
      const chains = items(rawChain).filter(x => x["underlying-symbol"] === symbol && x["root-symbol"] === symbol && x["option-chain-type"] === "Standard" && x["shares-per-contract"] === 100 && Array.isArray(x.deliverables) && x.deliverables.length === 1 && x.deliverables[0].symbol === symbol && x.deliverables[0]["deliverable-type"] === "Shares" && number(x.deliverables[0].amount) === 100);
      const today = new Date().toISOString().slice(0, 10);
      const windows = chains.flatMap(x => Array.isArray(x.expirations) ? x.expirations : []).filter(x => typeof x["expiration-date"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x["expiration-date"]) && Number.isFinite(Date.parse(x["expiration-date"])) && new Date(x["expiration-date"]).toISOString().slice(0, 10) === x["expiration-date"] && x["expiration-date"] > today && x["settlement-type"] === "PM" && Array.isArray(x.strikes));
      const availableExpiries = [...new Set<string>(windows.map(x => x["expiration-date"]))].sort();
      const selected = expiries ?? availableExpiries.slice(0, 2);
      if (!selected.length || selected.length > 2 || new Set(selected).size !== selected.length || selected.some(x => !availableExpiries.includes(x))) throw new Error("Invalid expiries");
      const selectedWindows = selected.map(date => windows.find(x => x["expiration-date"] === date));
      const strikes = selectedWindows.map(x => x.strikes.filter((s: any) => number(s["strike-price"]) > 0 && typeof s.call === "string" && typeof s.put === "string"));
      if (retain.some(id => !strikes.some(rows => rows.some((row: any) => row.call === id || row.put === id)))) throw new Error("Retained contract is not listed");
      const common = strikes[0].map((s: any) => number(s["strike-price"])).filter((s: number) => strikes.every(rows => rows.some((r: any) => number(r["strike-price"]) === s)));
      const nearest = (a: number, b: number) => Math.abs(a - strikeCenter) - Math.abs(b - strikeCenter) || a - b;
      const commonWindow = common.sort(nearest).slice(0, 25);
      const contracts = strikes.flatMap((rows, index) => {
        const chosen = [...rows].sort((a, b) => Number(retain.includes(b.call) || retain.includes(b.put)) - Number(retain.includes(a.call) || retain.includes(a.put)) || Number(commonWindow.includes(number(b["strike-price"]))) - Number(commonWindow.includes(number(a["strike-price"]))) || nearest(number(a["strike-price"]), number(b["strike-price"]))).slice(0, 25);
        return chosen.flatMap(row => (["call", "put"] as const).map(type => ({ contractId: row[type] as string, type, strike: number(row["strike-price"]), date: selected[index] })));
      });
      if (!contracts.length || contracts.length > 100 || new Set(contracts.map(x => x.contractId)).size !== contracts.length || contracts.some(x => x.contractId.slice(0, 6) !== symbol.padEnd(6) || !/^\d{6}[CP]\d{8}$/.test(x.contractId.slice(6)))) throw new Error("Invalid contracts");
      if (retain.some(id => !contracts.some(c => c.contractId === id))) throw new Error("Retained contract missing from window");
      if (contracts.some(c => c.contractId.slice(6, 12) !== c.date.slice(2).replaceAll("-", "") || c.contractId[12] !== (c.type === "call" ? "C" : "P") || Number(c.contractId.slice(13)) / 1000 !== c.strike)) throw new Error("Mismatched contract identity");
      // ponytail: standard expiry schedules verified on one call/put per date; per-strike metadata if adjusted contracts are supported.
      const representatives = selected.flatMap(date => (["call", "put"] as const).map(type => contracts.find(c => c.date === date && c.type === type)!));
      stage = 'instruments';
      const schedules = await Promise.all(representatives.map(async c => {
        const instrument = (await get(`/instruments/equity-options/${encodeURIComponent(c.contractId)}`)).data;
        if (instrument?.symbol !== c.contractId || instrument["underlying-symbol"] !== symbol || instrument["root-symbol"] !== symbol || instrument["shares-per-contract"] !== 100 || instrument["exercise-style"] !== "American" || instrument["settlement-type"] !== "PM" || instrument["option-chain-type"] !== "Standard" || instrument["option-type"] !== (c.type === "call" ? "C" : "P") || number(instrument["strike-price"]) !== c.strike || instrument["expiration-date"] !== c.date) throw new Error("Invalid instrument");
        const expiry = timestamp(instrument["stops-trading-at"]), expiresAt = timestamp(instrument["expires-at"]);
        if (expiry.slice(0, 10) !== c.date || Date.parse(expiry) > Date.parse(expiresAt) || Date.parse(expiry) <= Date.now()) throw new Error("Invalid expiry");
        return { date: c.date, expiry, expiresAt };
      }));
      for (const date of selected) { const pair = schedules.filter(s => s.date === date); if (pair[0].expiry !== pair[1].expiry || pair[0].expiresAt !== pair[1].expiresAt) throw new Error("Conflicting expiry schedules"); }
      stage = 'quotes';
      const rawQuotes = items(await get(`/market-data/by-type?${new URLSearchParams({ "equity-option": contracts.map(c => c.contractId).join(",") })}`, 1_048_576));
      const normalized: MarketContract[] = contracts.map(c => {
        const expiry = schedules.find(s => s.date === c.date)!.expiry;
        const matches = rawQuotes.filter(q => q.symbol === c.contractId);
        if (matches.length !== 1) throw new Error("Missing quote");
        const raw = matches[0], prices = quote(raw), iv = number(raw.volatility);
        if (!(iv > 0 && iv <= 10)) throw new Error("Missing volatility");
        const volume = number(raw.volume), openInterest = number(raw["open-interest"]);
        return { contractId: c.contractId, type: c.type, strike: c.strike, expiry, multiplier: 100, ...prices, iv, ...(Number.isSafeInteger(volume) && volume >= 0 ? { volume } : {}), ...(Number.isSafeInteger(openInterest) && openInterest >= 0 ? { openInterest } : {}) };
      });
      if (Date.now() > deadline) throw new Error("Timed out");
      const snapshot: MarketSnapshot = { id: crypto.randomUUID(), underlying: symbol, strikeCenter, source: "Tastytrade", retrievedAt: new Date().toISOString(), spot, spotAsOf: underlying.quoteAsOf, availableExpiries, contracts: normalized };
      snapshot.contractTerms = { exerciseStyle: "American", settlement: "physical-shares", sharesPerContract: 100, settlementSession: "PM" };
      stage = 'storage';
      return await register(snapshot, env, owner);
    } catch (error) { throw new OptionChainLoadError(stage, error); }
  }
  return {
    load,
    async capture(baseSnapshot: MarketSnapshot, selectedIds: string[], capture: StreamCapture, env: OptionChainBindings, owner: string): Promise<MarketSnapshot> {
      selectedIds = structuredClone(selectedIds); capture = structuredClone(capture);
      const base = await get(baseSnapshot?.id, env, owner);
      if (!base) throw new Error("Snapshot unavailable");
      if (!Array.isArray(selectedIds) || selectedIds.length > 4 || new Set(selectedIds).size !== selectedIds.length || selectedIds.some(id => typeof id !== "string" || !base.contracts.some(c => c.contractId === id && Date.parse(c.expiry) > Date.now()))) throw new Error("Invalid capture selection");
      const retrievedAt = timestamp(capture?.capturedAt), at = Date.parse(retrievedAt);
      if (at > Date.now() || Date.now() - at > 60_000 || !Array.isArray(capture.contracts) || capture.contracts.length !== selectedIds.length || new Set(capture.contracts.map(c => c?.contractId)).size !== selectedIds.length || capture.contracts.some(c => !selectedIds.includes(c?.contractId))) throw new Error("Invalid capture");
      const sourceTime = (value: unknown) => {
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > at || at - value > 300_000) throw new Error("Invalid source time");
        return new Date(value).toISOString();
      };
      const received = (value: unknown) => { const time = Date.parse(timestamp(value)); if (time > at || at - time > 60_000) throw new Error("Invalid receipt time"); };
      const prices = (value: StreamCapture["underlying"]) => {
        received(value?.receivedAt);
        const bid = value?.bid, ask = value?.ask;
        if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid < 0 || ask <= 0 || ask < bid || ask > 100_000) throw new Error("Invalid capture quote");
        const sourceTimes = { bid: sourceTime(value.bidTime), ask: sourceTime(value.askTime) };
        return { bid, ask, sourceTimes };
      };
      const underlying = prices(capture.underlying);
      const contracts: MarketContract[] = selectedIds.map(id => {
        const { contractId, type, strike, expiry, multiplier } = base.contracts.find(c => c.contractId === id)!;
        const update = capture.contracts.find(c => c.contractId === id)!, values = prices(update.quote), iv = update.greeks?.iv;
        received(update.greeks?.receivedAt);
        if (!Number.isFinite(iv) || iv <= 0 || iv > 10) throw new Error("Invalid capture IV");
        const sourceTimes = { ...values.sourceTimes, iv: sourceTime(update.greeks.time) };
        return { contractId, type, strike, expiry, multiplier, bid: values.bid, ask: values.ask, iv, sourceTimes, quoteAsOf: Object.values(sourceTimes).sort()[0] };
      });
      const snapshot: MarketSnapshot = { id: crypto.randomUUID(), underlying: base.underlying, strikeCenter: base.strikeCenter, source: "Tastytrade", captureSource: "DXLink", retrievedAt, spot: (underlying.bid + underlying.ask) / 2, spotAsOf: Object.values(underlying.sourceTimes).sort()[0], spotSourceTimes: underlying.sourceTimes, availableExpiries: [...new Set(contracts.map(c => c.expiry.slice(0, 10)))].sort(), contracts };
      if (contracts.length && base.contractTerms && !base.imported) snapshot.contractTerms = { ...base.contractTerms };
      capturedProvenance(snapshot);
      return register(snapshot, env, owner);
    },
    async restore(snapshot: MarketSnapshot, env: OptionChainBindings, owner: string): Promise<MarketSnapshot> {
      return register({ ...validatedSnapshot(snapshot), id: crypto.randomUUID(), historical: true }, env, owner);
    },
    get,
  };
}
