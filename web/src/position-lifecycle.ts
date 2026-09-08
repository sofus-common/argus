import { pruneExpiryIvShifts, quoteValuation, validateStrategy, type MarketSnapshot, type OptionLeg, type StrategyState } from "./options";

export interface CloseRequest {
  id: string;
  assetId: string;
  quantity: number;
  price: number;
  at: string;
}
export interface RecordedClose extends CloseRequest {
  entryPrice: number;
  side: "long" | "short";
  multiplier: number;
  contractId: string;
}
export interface PriceCorrection {
  id: string;
  closeId: string;
  price: number;
  reason: string;
  recordedAt: string;
}
export type CloseVoid = Omit<PriceCorrection, "price">;
export interface PositionRecord {
  schemaVersion: 1;
  initial: StrategyState;
  closes: RecordedClose[];
  priceCorrections?: PriceCorrection[];
  closeVoids?: CloseVoid[];
}

const requestKeys = ["assetId", "at", "id", "price", "quantity"];
const eventKeys = [...requestKeys, "entryPrice", "side", "multiplier", "contractId"].sort();
const correctionKeys = ["closeId", "id", "price", "reason", "recordedAt"];
const voidKeys = ["closeId", "id", "reason", "recordedAt"];
const round = (value: number) => Number(value.toFixed(8));
const canonicalTime = (value: string) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

function validateInitial(state: StrategyState) {
  if (validateStrategy(state).length || !Number.isSafeInteger(state.version) || state.legs.some(leg => !Number.isSafeInteger(leg.contracts)) || state.pricing && state.pricing.entryMode !== "fixed") throw new Error("Lifecycle requires valid fixed entry basis");
}

export function createPosition(initial: StrategyState): PositionRecord {
  validateInitial(initial);
  return { schemaVersion: 1, initial: structuredClone(initial), closes: [] };
}

function closeEvent(request: CloseRequest, legs: OptionLeg[], stock: StrategyState["stock"], underlying: string, notBefore: string): RecordedClose {
  if (!request || Object.keys(request).sort().join() !== requestKeys.join() || typeof request.id !== "string" || !request.id || request.id.length > 128 || typeof request.assetId !== "string" || !Number.isSafeInteger(request.quantity) || request.quantity <= 0 || !Number.isFinite(request.price) || request.price < 0 || !canonicalTime(request.at) || Date.parse(request.at) < Date.parse(notBefore) || Date.parse(request.at) > Date.now()) throw new Error("Invalid recorded close");
  const leg = legs.find(leg => request.assetId === `option:${leg.id}`);
  if (!leg && (request.assetId !== "stock" || !stock)) throw new Error("Unknown remaining asset");
  const available = leg ? leg.contracts : Math.abs(stock!.shares);
  if (request.quantity > available) throw new Error("Close exceeds remaining quantity");
  if (leg && Date.parse(request.at) > Date.parse(leg.expiry)) throw new Error("Option close must not follow expiry; settlement is not simulated");
  const event: RecordedClose = { ...request, entryPrice: leg?.entryPrice ?? stock!.entryPrice, side: leg?.side ?? (stock!.shares > 0 ? "long" : "short"), multiplier: leg?.multiplier ?? 1, contractId: leg?.contractId ?? underlying };
  if (!Number.isFinite((event.price - event.entryPrice) * event.quantity * event.multiplier)) throw new Error("Recorded close exceeds numerical range");
  return event;
}

export function projectPosition(position: PositionRecord) {
  if (!position || Object.keys(position).some(key => !["closes", "initial", "schemaVersion", "priceCorrections", "closeVoids"].includes(key)) || position.schemaVersion !== 1 || !Array.isArray(position.closes) || "priceCorrections" in position && !Array.isArray(position.priceCorrections) || "closeVoids" in position && !Array.isArray(position.closeVoids)) throw new Error("Invalid position record");
  validateInitial(position.initial);
  const initial = position.initial;
  const version = initial.version + position.closes.length + (position.closeVoids?.length ?? 0);
  if (!Number.isSafeInteger(version)) throw new Error("Lifecycle version exceeds numerical range");
  let legs = structuredClone(initial.legs), stock = initial.stock ? { ...initial.stock } : undefined;
  let grossRealizedPnl = 0, asOf = initial.valuationTimestamp;
  const ids = new Set<string>();
  const voided = new Map<string, string>();
  let voidedAt = initial.valuationTimestamp, originalAt = initial.valuationTimestamp;
  for (const event of position.closeVoids ?? []) {
    const close = position.closes.find(close => close?.id === event?.closeId);
    if (!event || Object.keys(event).sort().join() !== voidKeys.join() || typeof event.id !== "string" || !event.id || event.id.length > 128 || ids.has(event.id) || !close || voided.has(event.closeId) || typeof event.reason !== "string" || !event.reason.trim() || event.reason.length > 500 || !canonicalTime(event.recordedAt) || Date.parse(event.recordedAt) < Math.max(Date.parse(close.at), Date.parse(voidedAt)) || Date.parse(event.recordedAt) > Date.now()) throw new Error("Invalid erroneous-close void");
    ids.add(event.id); voided.set(event.closeId, event.recordedAt); voidedAt = event.recordedAt;
  }
  for (const event of position.closes) {
    if (!event || Object.keys(event).sort().join() !== eventKeys.join() || ids.has(event.id)) throw new Error("Invalid or duplicate close event");
    const request = { id: event.id, assetId: event.assetId, quantity: event.quantity, price: event.price, at: event.at };
    const expected = closeEvent(request, initial.legs, initial.stock, initial.underlying, originalAt);
    if (eventKeys.some(key => event[key as keyof RecordedClose] !== expected[key as keyof RecordedClose])) throw new Error("Recorded close basis mismatch");
    ids.add(event.id);
    originalAt = event.at;
    if (voided.has(event.id)) continue;
    closeEvent(request, legs, stock, initial.underlying, asOf);
    grossRealizedPnl += (event.price - event.entryPrice) * event.quantity * event.multiplier * (event.side === "long" ? 1 : -1);
    if (!Number.isFinite(grossRealizedPnl)) throw new Error("Recorded totals exceed numerical range");
    if (event.assetId === "stock") {
      stock!.shares -= event.quantity * Math.sign(stock!.shares);
      if (stock!.shares === 0) stock = undefined;
    } else legs = legs.map(leg => event.assetId === `option:${leg.id}` ? { ...leg, contracts: leg.contracts - event.quantity } : leg).filter(leg => leg.contracts > 0);
    asOf = event.at;
  }
  const effectivePrices = new Map(position.closes.map(event => [event.id, event.price]));
  let correctedAt = initial.valuationTimestamp;
  for (const correction of position.priceCorrections ?? []) {
    const close = position.closes.find(event => event.id === correction?.closeId);
    if (!correction || Object.keys(correction).sort().join() !== correctionKeys.join() || typeof correction.id !== "string" || !correction.id || correction.id.length > 128 || ids.has(correction.id) || !close || !Number.isFinite(correction.price) || correction.price < 0 || typeof correction.reason !== "string" || !correction.reason.trim() || correction.reason.length > 500 || !canonicalTime(correction.recordedAt) || Date.parse(correction.recordedAt) < Math.max(Date.parse(close.at), Date.parse(correctedAt)) || Date.parse(correction.recordedAt) > Date.now() || !Number.isFinite((correction.price - close.entryPrice) * close.quantity * close.multiplier)) throw new Error("Invalid close-price correction");
    if (voided.has(close.id) && Date.parse(correction.recordedAt) > Date.parse(voided.get(close.id)!)) throw new Error("Correction follows close cancellation");
    ids.add(correction.id); effectivePrices.set(close.id, correction.price); correctedAt = correction.recordedAt;
  }
  grossRealizedPnl = 0;
  for (const close of position.closes) {
    if (voided.has(close.id)) continue;
    grossRealizedPnl += (effectivePrices.get(close.id)! - close.entryPrice) * close.quantity * close.multiplier * (close.side === "long" ? 1 : -1);
    if (!Number.isFinite(grossRealizedPnl)) throw new Error("Corrected totals exceed numerical range");
  }
  const allowance = initial.feeAllowance ?? 0;
  if (!Number.isFinite(grossRealizedPnl - allowance)) throw new Error("Recorded net total exceeds numerical range");
  // This is structural inventory, not a fresh mark after the recorded closes.
  const active: StrategyState | null = legs.length || stock ? pruneExpiryIvShifts({ ...structuredClone(initial), legs, stock, feeAllowance: 0, version }) : null;
  return {
    status: legs.length ? "options-active" as const : stock ? "stock-only" as const : "closed" as const,
    active, stock: stock ?? null, asOf, requiresRevaluation: position.closes.length > 0 && !!(active || stock),
    grossRealizedPnl: round(grossRealizedPnl), allowance,
    netClosedPnl: active || stock ? null : round(grossRealizedPnl - allowance),
    basis: "User-recorded closes, not broker-verified fills, exercise or assignment. Gross realized excludes the position allowance; no allocation to individual legs. Remaining inventory requires a compatible dated valuation before combined P/L.",
  };
}

export function recordCloseVoid(position: PositionRecord, request: CloseVoid): PositionRecord {
  projectPosition(position);
  const existing = position.closeVoids?.find(event => event.id === request?.id);
  if (existing) {
    if (Object.keys(request).sort().join() !== voidKeys.join() || voidKeys.some(key => existing[key as keyof CloseVoid] !== request[key as keyof CloseVoid])) throw new Error("Void event ID conflict");
    return structuredClone(position);
  }
  const next = { ...structuredClone(position), closeVoids: [...structuredClone(position.closeVoids ?? []), structuredClone(request)] };
  projectPosition(next);
  return next;
}

export function recordPriceCorrection(position: PositionRecord, request: PriceCorrection): PositionRecord {
  projectPosition(position);
  const existing = position.priceCorrections?.find(event => event.id === request?.id);
  if (existing) {
    if (Object.keys(request).sort().join() !== correctionKeys.join() || correctionKeys.some(key => existing[key as keyof PriceCorrection] !== request[key as keyof PriceCorrection])) throw new Error("Correction event ID conflict");
    return structuredClone(position);
  }
  if (position.closeVoids?.some(event => event.closeId === request?.closeId)) throw new Error("Cannot correct a voided close");
  const next = { ...structuredClone(position), priceCorrections: [...structuredClone(position.priceCorrections ?? []), structuredClone(request)] };
  projectPosition(next);
  return next;
}

export function recordClose(position: PositionRecord, request: CloseRequest): PositionRecord {
  const projection = projectPosition(position);
  const existing = position.closes.find(event => event.id === request?.id);
  if (existing) {
    if (Object.keys(request).sort().join() !== requestKeys.join() || requestKeys.some(key => existing[key as keyof CloseRequest] !== request[key as keyof CloseRequest])) throw new Error("Close event ID conflict");
    return structuredClone(position);
  }
  const event = closeEvent(request, projection.active?.legs ?? [], projection.stock ?? undefined, position.initial.underlying, position.closes.at(-1)?.at ?? projection.asOf);
  const next = { ...structuredClone(position), closes: [...structuredClone(position.closes), event] };
  projectPosition(next);
  return next;
}

export function valuePosition(position: PositionRecord, snapshot: MarketSnapshot, basis: "mid" | "natural") {
  const projection = projectPosition(position), initial = position.initial;
  if (projection.status === "closed") throw new Error("Closed position already has a realized total");
  if (!snapshot || snapshot.underlying !== initial.underlying || !["mid", "natural"].includes(basis) || !Number.isFinite(snapshot.spot) || snapshot.spot <= 0 || !Array.isArray(snapshot.contracts) || new Set(snapshot.contracts.map(contract => contract.contractId)).size !== snapshot.contracts.length) throw new Error("Incompatible valuation snapshot");
  const at = Date.parse(snapshot.retrievedAt), minimum = Date.parse(projection.asOf);
  if (!Number.isFinite(at) || at < minimum || at > Date.now()) throw new Error("Valuation must follow recorded closes");
  const times: number[] = [];
  const sourceTime = (value: string) => {
    const time = Date.parse(value);
    if (!Number.isFinite(time) || time < minimum || time > at) throw new Error("Source quote must follow recorded closes and precede retrieval");
    times.push(time);
  };
  sourceTime(snapshot.spotAsOf);
  if (snapshot.spotSourceTimes) Object.values(snapshot.spotSourceTimes).forEach(sourceTime);
  let unrealizedPnl: number;
  let remainingState: StrategyState | null = null;
  if (projection.active) {
    const legs = projection.active.legs.map(leg => {
      const contract = snapshot.contracts.find(contract => contract.contractId === leg.contractId);
      if (!contract || ["type", "strike", "expiry", "multiplier"].some(key => contract[key as keyof typeof contract] !== leg[key as keyof OptionLeg]) || at >= Date.parse(leg.expiry)) throw new Error("Remaining option cannot be marked from this snapshot");
      sourceTime(contract.quoteAsOf);
      if (contract.sourceTimes) Object.values(contract.sourceTimes).forEach(sourceTime);
      return { ...leg, iv: contract.iv };
    });
    const state: StrategyState = { ...projection.active, name: "Remaining holdings", legs, spot: snapshot.spot, valuationTimestamp: snapshot.retrievedAt, scenarioDate: snapshot.retrievedAt, scenarioSpot: snapshot.spot, feeAllowance: 0, pricing: { mode: "market", snapshotId: snapshot.id, basis, entryMode: "fixed", ...(snapshot.historical ? { historical: true } : {}) } };
    unrealizedPnl = quoteValuation(state, snapshot).pnl;
    remainingState = state;
  } else unrealizedPnl = projection.stock!.shares * (snapshot.spot - projection.stock!.entryPrice);
  const combinedPnl = projection.grossRealizedPnl + unrealizedPnl - projection.allowance;
  if (!Number.isFinite(unrealizedPnl) || !Number.isFinite(combinedPnl)) throw new Error("Valuation exceeds numerical range");
  return { remainingState, snapshotId: snapshot.id, basis, retrievedAt: snapshot.retrievedAt, oldestQuoteAt: new Date(Math.min(...times)).toISOString(), newestQuoteAt: new Date(Math.max(...times)).toISOString(), historical: snapshot.historical === true, grossRealizedPnl: projection.grossRealizedPnl, unrealizedPnl: round(unrealizedPnl), allowance: projection.allowance, combinedPnl: round(combinedPnl), disclosure: "Dated estimate, not a fill or live return. Options use midpoint or natural liquidation quotes; shares use underlying spot, not executable bid/ask. User-recorded realized P/L plus remaining marked P/L minus the position allowance once. No dividends, financing, borrow, exercise, assignment or settlement cashflows." };
}
