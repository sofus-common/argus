import type { MarketSnapshot } from "./options";
import { MAX_CHAIN_CONTRACTS, validContractTerms } from "./options";

export function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error("Invalid timestamp");
  return new Date(value).toISOString();
}
export function capturedProvenance(snapshot: MarketSnapshot) {
  const index = snapshot.underlyingKind === 'cash-index';
  if (index) {
    const at = Date.parse(timestamp(snapshot.retrievedAt)), source = timestamp(snapshot.indexSourceTime);
    if (snapshot.spotSourceTimes !== undefined || timestamp(snapshot.spotAsOf) !== source || at > Date.now() || Date.parse(source) <= 0 || Date.parse(source) > at || at - Date.parse(source) > 300_000) throw new Error('Invalid index provenance');
  } else if (snapshot.indexSourceTime !== undefined) throw new Error('Invalid index provenance');
  if (snapshot.captureSource === undefined) {
    if (snapshot.spotSourceTimes !== undefined || snapshot.contracts.some(c => c.sourceTimes !== undefined)) throw new Error("Invalid capture provenance");
    return;
  }
  if (snapshot.captureSource !== "DXLink") throw new Error("Invalid capture source");
  const capturedAt = Date.parse(timestamp(snapshot.retrievedAt)), times: number[] = [];
  if (capturedAt > Date.now()) throw new Error("Invalid capture timestamp");
  const source = (value: unknown) => {
    const iso = timestamp(value), at = Date.parse(iso);
    if (at <= 0 || at > capturedAt || capturedAt - at > 300_000) throw new Error("Invalid capture timestamp");
    times.push(at); return iso;
  };
  const spotSourceTimes = index ? undefined : { bid: source(snapshot.spotSourceTimes?.bid), ask: source(snapshot.spotSourceTimes?.ask) };
  if (index) source(snapshot.indexSourceTime);
  else if (timestamp(snapshot.spotAsOf) !== [spotSourceTimes!.bid, spotSourceTimes!.ask].sort()[0]) throw new Error("Invalid spot provenance");
  const sourceTimes = snapshot.contracts.map(c => {
    const stamps = { bid: source(c.sourceTimes?.bid), ask: source(c.sourceTimes?.ask), iv: source(c.sourceTimes?.iv) };
    if (timestamp(c.quoteAsOf) !== Object.values(stamps).sort()[0]) throw new Error("Invalid option provenance");
    return stamps;
  });
  if (Math.max(...times) - Math.min(...times) > 60_000) throw new Error("Capture timestamps disagree");
  return { spotSourceTimes, sourceTimes };
}

export function validatedSnapshot(snapshot: MarketSnapshot): MarketSnapshot {
  if (snapshot?.imported !== undefined && (snapshot.imported !== true || snapshot.historical !== true)) throw new Error("Imported quotes must remain historical");
  if (snapshot?.historical !== undefined && snapshot.historical !== true) throw new Error("Invalid historical provenance");
  const underlying = snapshot?.underlying === undefined ? "SPY" : snapshot.underlying;
  if (typeof underlying !== "string" || !/^[A-Z]{1,6}$/.test(underlying)) throw new Error("Invalid saved underlying");
  if (!snapshot || snapshot.source !== "Tastytrade" || !Number.isFinite(snapshot.spot) || snapshot.spot <= 0 || !Array.isArray(snapshot.availableExpiries) || snapshot.availableExpiries.some(date => typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) || !Array.isArray(snapshot.contracts) || (!snapshot.contracts.length && (snapshot.captureSource !== "DXLink" || snapshot.availableExpiries.length !== 0 || snapshot.contractTerms !== undefined)) || snapshot.contracts.length > MAX_CHAIN_CONTRACTS) throw new Error("Invalid saved snapshot");
  const strikeCenter = snapshot.strikeCenter === undefined ? snapshot.spot : snapshot.strikeCenter;
  if (!Number.isFinite(strikeCenter) || strikeCenter <= 0 || strikeCenter > 1_000_000) throw new Error("Invalid saved strike center");
  timestamp(snapshot.retrievedAt); timestamp(snapshot.spotAsOf);
  const provenance = capturedProvenance(snapshot);
  const terms = snapshot.contractTerms;
  if (!validContractTerms(snapshot)) throw new Error("Invalid contract terms");
  const contracts = snapshot.contracts.map((c, index) => {
    if (!c || typeof c.contractId !== "string" || c.contractId.slice(0, 6) !== underlying.padEnd(6) || !/^\d{6}[CP]\d{8}$/.test(c.contractId.slice(6)) || !["call", "put"].includes(c.type) || !Number.isFinite(c.strike) || c.strike <= 0 || c.multiplier !== 100 || !Number.isFinite(c.bid) || !Number.isFinite(c.ask) || c.bid < 0 || c.ask <= 0 || c.ask < c.bid || !Number.isFinite(c.iv) || c.iv <= 0 || c.iv > 10) throw new Error("Invalid saved contract");
    timestamp(c.expiry); timestamp(c.quoteAsOf);
    if (c.contractId.slice(6, 12) !== c.expiry.slice(2, 10).replaceAll("-", "") || c.contractId[12] !== (c.type === "call" ? "C" : "P") || Number(c.contractId.slice(13)) / 1000 !== c.strike || !snapshot.availableExpiries.includes(c.expiry.slice(0, 10))) throw new Error("Invalid saved identity");
    const { contractId, type, strike, expiry, multiplier, bid, ask, iv, quoteAsOf } = c;
    return { contractId, type, strike, expiry, multiplier, bid, ask, iv, quoteAsOf, ...(provenance ? { sourceTimes: provenance.sourceTimes[index] } : {}), ...(Number.isSafeInteger(c.volume) && c.volume! >= 0 ? { volume: c.volume } : {}), ...(Number.isSafeInteger(c.openInterest) && c.openInterest! >= 0 ? { openInterest: c.openInterest } : {}) };
  });
  if (new Set(contracts.map(c => c.contractId)).size !== contracts.length) throw new Error("Duplicate saved contracts");
return { ...(snapshot.imported ? { imported: true as const } : {}), id: snapshot.id, underlying, ...(snapshot.underlyingKind ? { underlyingKind: snapshot.underlyingKind, indexSourceTime: snapshot.indexSourceTime } : {}), strikeCenter, ...(terms ? { contractTerms: { ...terms } } : {}), ...(snapshot.historical ? { historical: true as const } : {}), source: snapshot.source, spot: snapshot.spot, retrievedAt: snapshot.retrievedAt, spotAsOf: snapshot.spotAsOf, ...(provenance ? { captureSource: "DXLink", ...(provenance.spotSourceTimes ? { spotSourceTimes: provenance.spotSourceTimes } : {}) } as const : {}), availableExpiries: [...snapshot.availableExpiries], contracts };
}
