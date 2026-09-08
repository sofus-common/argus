import { SAMPLE_EXPIRIES, SAMPLE_STRIKES, sampleContractId, pruneExpiryIvShifts, validateMarketStrategy, type MarketSnapshot, type OptionLeg, type PricingBasis, type StrategyState } from "./options";
import { projectPosition, recordPriceCorrection, recordCloseVoid, type PositionRecord, type PriceCorrection, type CloseVoid } from "./position-lifecycle";

export type LotAsset = { kind: "stock"; symbol: string } | { kind: "option"; contractId: string; type: "call" | "put"; strike: number; expiry: string; multiplier: number };
export interface LotOpening { id: string; asset: LotAsset; side: "long" | "short"; quantity: number; entryPrice: number }
export interface LotClose { id: string; lotId: string; quantity: number; price: number }
export interface LotTransaction { id: string; at: string; recordedAt: string; closes: LotClose[]; opens: LotOpening[] }
export type OpeningPriceCorrection = Omit<PriceCorrection, "closeId"> & { lotId: string };
export type LotAmendment = ({ kind: "price-correction" } & PriceCorrection) | ({ kind: "close-void" } & CloseVoid) | ({ kind: "opening-price-correction" } & OpeningPriceCorrection);
export interface PositionLots { schemaVersion: 2; legacy: PositionRecord; transactions: LotTransaction[]; amendments?: LotAmendment[] }
export interface RemainingLot extends LotOpening { at: string; recordedAt: string }

const keys = (value: unknown, expected: string) => !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === expected;
const time = (value: string) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const quantity = (value: number) => Number.isSafeInteger(value) && value > 0;
const money = (value: number) => Number.isFinite(value) && value >= 0;
const round = (value: number) => Number(value.toFixed(8));
const multiplier = (asset: LotAsset) => asset.kind === "option" ? asset.multiplier : 1;
const assetKey = (asset: LotAsset) => asset.kind === "stock" ? `stock:${asset.symbol}` : `option:${asset.contractId}`;
const optionAsset = (leg: OptionLeg): LotAsset => ({ kind: "option", contractId: leg.contractId, type: leg.type, strike: leg.strike, expiry: leg.expiry, multiplier: leg.multiplier });
const fingerprint = (value: LotAsset | LotTransaction | LotAmendment) => JSON.stringify(value, ["id", "at", "recordedAt", "closes", "opens", "lotId", "price", "quantity", "asset", "side", "entryPrice", "kind", "symbol", "contractId", "type", "strike", "expiry", "multiplier", "closeId", "reason"]);
const assetFingerprint = (asset: LotAsset) => fingerprint(asset.kind === "option" ? { ...asset, expiry: new Date(asset.expiry).toISOString() } : asset);

function validateAsset(asset: LotAsset, legacy: PositionRecord, at: string) {
  const state = legacy.initial;
  if (asset?.kind === "stock") {
    if (!keys(asset, "kind,symbol") || asset.symbol !== state.underlying) throw new Error("Invalid opening stock identity");
    return;
  }
  if (!keys(asset, "contractId,expiry,kind,multiplier,strike,type") || asset.kind !== "option" || !["call", "put"].includes(asset.type) || !Number.isFinite(asset.strike) || asset.strike <= 0 || asset.multiplier !== 100 || !time(asset.expiry) || Date.parse(asset.expiry) <= Date.parse(at)) throw new Error("Invalid opening option identity");
  if (state.pricing) {
    const identity = typeof asset.contractId === "string" && asset.contractId.slice(0, 6) === state.underlying.padEnd(6) ? /^(\d{6})([CP])(\d{8})$/.exec(asset.contractId.slice(6)) : null;
    if (!identity || identity[1] !== asset.expiry.slice(2, 10).replaceAll("-", "") || identity[2] !== (asset.type === "call" ? "C" : "P") || Number(identity[3]) / 1000 !== asset.strike) throw new Error("Opening contract identity mismatch");
  } else if (!SAMPLE_STRIKES.includes(asset.strike) || !SAMPLE_EXPIRIES.includes(asset.expiry as typeof SAMPLE_EXPIRIES[number]) || asset.contractId !== sampleContractId(asset.type, asset.strike, asset.expiry)) throw new Error("Opening outside sample catalog");
}

export function upgradePositionLots(legacy: PositionRecord): PositionLots {
  projectPosition(legacy);
  const position: PositionLots = { schemaVersion: 2, legacy: structuredClone(legacy), transactions: [] };
  projectPositionLots(position);
  return position;
}

export function projectPositionLots(position: PositionLots) {
  if (!(keys(position, "legacy,schemaVersion,transactions") || keys(position, "amendments,legacy,schemaVersion,transactions")) || position.schemaVersion !== 2 || !Array.isArray(position.transactions) || "amendments" in position && !Array.isArray(position.amendments)) throw new Error("Invalid lot ledger");
  const legacy = position.legacy, originalBase = projectPosition(legacy), initial = legacy.initial;
  const events = [...legacy.closes, ...(legacy.priceCorrections ?? []), ...(legacy.closeVoids ?? [])];
  const ids = new Set(events.map(event => event.id));
  const identities = new Map(initial.legs.map(leg => { const asset = optionAsset(leg); return [assetKey(asset), asset] as const; }));
  const reserve = (stem: string) => {
    let id = stem, suffix = 0;
    while (ids.has(id)) id = `${stem}:${++suffix}`;
    ids.add(id); return id;
  };
  const initialIds = initial.legs.map((_, index) => reserve(`initial:option:${index}`));
  const stockId = initial.stock ? reserve("initial:stock") : null;
  const openingPrices = new Map<string, number>();
  const voided = new Set(legacy.closeVoids?.map(event => event.closeId) ?? []), effectivePrices = new Map<string, number>();
  const voidTimes = new Map(legacy.closeVoids?.map(event => [event.closeId, event.recordedAt]) ?? []);
  let overlay = legacy;
  let amendmentAt = new Date(Math.max(Date.parse(initial.valuationTimestamp), ...events.map(event => Date.parse("recordedAt" in event ? event.recordedAt : event.at)))).toISOString();
  for (const amendment of position.amendments ?? []) {
    if (amendment?.kind === "opening-price-correction") {
      const initialLot = initialIds.includes(amendment.lotId) || stockId !== null && amendment.lotId === stockId;
      const transaction = position.transactions.find(item => Array.isArray(item?.opens) && item.opens.some(opening => opening?.id === amendment.lotId));
      const targetAt = initialLot ? initial.valuationTimestamp : transaction?.recordedAt;
      if (!keys(amendment, "id,kind,lotId,price,reason,recordedAt") || typeof amendment.id !== "string" || !amendment.id || amendment.id.length > 128 || ids.has(amendment.id) || !targetAt || !money(amendment.price) || typeof amendment.reason !== "string" || !amendment.reason.trim() || amendment.reason.length > 500 || !time(amendment.recordedAt) || Date.parse(amendment.recordedAt) < Math.max(Date.parse(targetAt), Date.parse(amendmentAt)) || Date.parse(amendment.recordedAt) > Date.now()) throw new Error("Invalid opening-price correction");
      ids.add(amendment.id); amendmentAt = amendment.recordedAt; openingPrices.set(amendment.lotId, amendment.price);
      continue;
    }
    const legacyClose = legacy.closes.find(close => close.id === amendment?.closeId);
    const transaction = position.transactions.find(transaction => transaction?.closes?.some(close => close?.id === amendment?.closeId));
    const targetAt = legacyClose?.at ?? transaction?.at, targetRecordedAt = legacyClose?.at ?? transaction?.recordedAt;
    if (!amendment || !keys(amendment, amendment.kind === "price-correction" ? "closeId,id,kind,price,reason,recordedAt" : "closeId,id,kind,reason,recordedAt") || !["price-correction", "close-void"].includes(amendment.kind) || typeof amendment.id !== "string" || !amendment.id || amendment.id.length > 128 || ids.has(amendment.id) || !targetAt || !targetRecordedAt || typeof amendment.reason !== "string" || !amendment.reason.trim() || amendment.reason.length > 500 || !time(amendment.recordedAt) || Date.parse(amendment.recordedAt) < Math.max(Date.parse(targetAt), Date.parse(targetRecordedAt), Date.parse(amendmentAt)) || Date.parse(amendment.recordedAt) > Date.now() || voided.has(amendment.closeId) || amendment.kind === "price-correction" && !money(amendment.price)) throw new Error("Invalid lot amendment");
    ids.add(amendment.id); amendmentAt = amendment.recordedAt;
    if (legacyClose) {
      const { kind, ...request } = amendment;
      overlay = kind === "price-correction" ? recordPriceCorrection(overlay, request as PriceCorrection) : recordCloseVoid(overlay, request);
    }
    if (amendment.kind === "close-void") { voided.add(amendment.closeId); voidTimes.set(amendment.closeId, amendment.recordedAt); }
    else effectivePrices.set(amendment.closeId, amendment.price);
  }
  const base = overlay === legacy ? originalBase : projectPosition(overlay);
  let lots: RemainingLot[] = [];
  const originals = new Map<string, RemainingLot>();
  const effectiveOpening = (opening: RemainingLot) => {
    for (const amendment of position.amendments ?? []) if (amendment.kind === "opening-price-correction" && amendment.lotId === opening.id && !Number.isFinite(amendment.price * opening.quantity * multiplier(opening.asset))) throw new Error("Opening correction exceeds numerical range");
    return { ...structuredClone(opening), entryPrice: openingPrices.get(opening.id) ?? opening.entryPrice };
  };
  initial.legs.forEach((leg, index) => {
    const id = initialIds[index], remaining = base.active?.legs.find(item => item.id === leg.id);
    const original: RemainingLot = { id, asset: optionAsset(leg), side: leg.side, quantity: leg.contracts, entryPrice: leg.entryPrice, at: initial.valuationTimestamp, recordedAt: initial.valuationTimestamp };
    originals.set(id, original);
    const effective = effectiveOpening(original);
    if (remaining) lots.push({ ...effective, quantity: remaining.contracts });
  });
  if (initial.stock) {
    const original: RemainingLot = { id: stockId!, asset: { kind: "stock", symbol: initial.underlying }, side: initial.stock.shares > 0 ? "long" : "short", quantity: Math.abs(initial.stock.shares), entryPrice: initial.stock.entryPrice, at: initial.valuationTimestamp, recordedAt: initial.valuationTimestamp };
    originals.set(stockId!, original);
    const effective = effectiveOpening(original);
    if (base.stock) lots.push({ ...effective, quantity: Math.abs(base.stock.shares) });
  }
  let grossRealizedPnl = 0;
  const pendingRestorations: { lotId: string; quantity: number; recordedAt: string }[] = [];
  for (const close of legacy.closes) {
    const lotId = close.assetId === "stock" ? stockId! : initialIds[initial.legs.findIndex(leg => `option:${leg.id}` === close.assetId)];
    if (voided.has(close.id)) {
      pendingRestorations.push({ lotId, quantity: close.quantity, recordedAt: voidTimes.get(close.id)! });
      continue;
    }
    const price = effectivePrices.get(close.id) ?? legacy.priceCorrections?.filter(event => event.closeId === close.id).at(-1)?.price ?? close.price;
    grossRealizedPnl += (price - (openingPrices.get(lotId) ?? close.entryPrice)) * close.quantity * close.multiplier * (close.side === "long" ? 1 : -1);
    if (!Number.isFinite(grossRealizedPnl)) throw new Error("Corrected legacy totals exceed numerical range");
  }
  let asOf = base.asOf, executionAt = legacy.closes.at(-1)?.at ?? initial.valuationTimestamp;
  let recordedAt = new Date(Math.max(Date.parse(executionAt), ...events.map(event => Date.parse("recordedAt" in event ? event.recordedAt : event.at)))).toISOString();
  const claimId = (id: string) => {
    if (typeof id !== "string" || !id || id.length > 128 || ids.has(id)) throw new Error("Invalid or duplicate lot event ID");
    ids.add(id);
  };
  for (const transaction of position.transactions) {
    if (!keys(transaction, "at,closes,id,opens,recordedAt") || !Array.isArray(transaction.closes) || !Array.isArray(transaction.opens) || !transaction.closes.length && !transaction.opens.length || !time(transaction.at) || !time(transaction.recordedAt) || Date.parse(transaction.at) < Date.parse(executionAt) || Date.parse(transaction.recordedAt) < Math.max(Date.parse(recordedAt), Date.parse(transaction.at)) || Date.parse(transaction.recordedAt) > Date.now()) throw new Error("Invalid lot transaction");
    claimId(transaction.id);
    for (const close of transaction.closes) {
      if (!keys(close, "id,lotId,price,quantity") || !quantity(close.quantity) || !money(close.price)) throw new Error("Invalid lot close");
      claimId(close.id);
      const original = originals.get(close.lotId);
      if (!original || close.quantity > original.quantity || original.asset.kind === "option" && Date.parse(transaction.at) > Date.parse(original.asset.expiry) || !Number.isFinite((close.price - original.entryPrice) * close.quantity * multiplier(original.asset))) throw new Error("Invalid original lot close");
      for (const amendment of position.amendments ?? []) if (amendment.kind === "price-correction" && amendment.closeId === close.id && !Number.isFinite((amendment.price - original.entryPrice) * close.quantity * multiplier(original.asset))) throw new Error("Correction exceeds numerical range");
      const lot = lots.find(item => item.id === close.lotId);
      const unavailable = pendingRestorations.filter(item => item.lotId === close.lotId && Date.parse(item.recordedAt) > Date.parse(transaction.recordedAt)).reduce((sum, item) => sum + item.quantity, 0);
      if (!lot || close.quantity > lot.quantity - unavailable || lot.asset.kind === "option" && Date.parse(transaction.at) > Date.parse(lot.asset.expiry)) throw new Error("Invalid lot allocation or restoration not yet recorded");
      if (voided.has(close.id)) { pendingRestorations.push({ lotId: close.lotId, quantity: close.quantity, recordedAt: voidTimes.get(close.id)! }); continue; }
      const realized = ((effectivePrices.get(close.id) ?? close.price) - lot.entryPrice) * close.quantity * multiplier(lot.asset) * (lot.side === "long" ? 1 : -1);
      if (!Number.isFinite(realized) || !Number.isFinite(grossRealizedPnl + realized)) throw new Error("Lot close exceeds numerical range");
      grossRealizedPnl += realized;
      lot.quantity -= close.quantity;
      lots = lots.filter(item => item.quantity > 0);
    }
    for (const opening of transaction.opens) {
      if (!keys(opening, "asset,entryPrice,id,quantity,side") || !["long", "short"].includes(opening.side) || !quantity(opening.quantity) || !money(opening.entryPrice)) throw new Error("Invalid opening lot");
      claimId(opening.id);
      validateAsset(opening.asset, legacy, transaction.at);
      const known = identities.get(assetKey(opening.asset));
      if (known && assetFingerprint(known) !== assetFingerprint(opening.asset)) throw new Error("Opening changes recorded asset identity");
      identities.set(assetKey(opening.asset), structuredClone(opening.asset));
      if (!Number.isFinite(opening.entryPrice * opening.quantity * multiplier(opening.asset))) throw new Error("Opening exceeds numerical range");
      const matching = lots.filter(lot => assetKey(lot.asset) === assetKey(opening.asset));
      if (matching.some(lot => lot.side !== opening.side)) throw new Error("Opposite-side lots require explicit closure");
      if (!Number.isSafeInteger(matching.reduce((sum, lot) => sum + lot.quantity, opening.quantity))) throw new Error("Aggregate quantity exceeds numerical range");
      const original = { ...structuredClone(opening), at: transaction.at, recordedAt: transaction.recordedAt };
      originals.set(opening.id, original);
      lots.push(effectiveOpening(original));
    }
    if (transaction.opens.length || transaction.closes.some(close => !voided.has(close.id))) asOf = transaction.at;
    executionAt = transaction.at; recordedAt = transaction.recordedAt;
  }
  recordedAt = new Date(Math.max(Date.parse(recordedAt), Date.parse(amendmentAt))).toISOString();
  const version = initial.version + legacy.closes.length + (legacy.closeVoids?.length ?? 0) + position.transactions.length + (position.amendments?.filter(event => event.kind !== "price-correction").length ?? 0);
  if (!Number.isSafeInteger(version) || !Number.isFinite(grossRealizedPnl) || !Number.isFinite(grossRealizedPnl - base.allowance) || !Number.isFinite(lots.reduce((sum, lot) => sum + lot.quantity * lot.entryPrice * multiplier(lot.asset), 0))) throw new Error("Lot totals exceed numerical range");
  const openings = [...originals.values()].map(original => ({ ...effectiveOpening(original), originalEntryPrice: original.entryPrice }));
  return { initial: structuredClone(initial), lots, openings, version, asOf, recordedAt, grossRealizedPnl: round(grossRealizedPnl), allowance: base.allowance, netClosedPnl: lots.length ? null : round(grossRealizedPnl - base.allowance), status: lots.length ? "open" as const : "closed" as const };
}

export function projectPositionLotsAt(position: PositionLots, cutoff: string) {
  const full = projectPositionLots(position), at = Date.parse(cutoff);
  if (!time(cutoff) || at < Date.parse(full.initial.valuationTimestamp) || at > Date.now()) throw new Error("Invalid historical cutoff");
  const lots: RemainingLot[] = full.openings.filter(opening => Date.parse(opening.at) <= at).map(({ originalEntryPrice: _original, ...opening }) => opening);
  const voided = new Set(position.legacy.closeVoids?.map(event => event.closeId));
  const prices = new Map(position.legacy.priceCorrections?.map(event => [event.closeId, event.price]));
  for (const amendment of position.amendments ?? []) {
    if (amendment.kind === "close-void") voided.add(amendment.closeId);
    else if (amendment.kind === "price-correction") prices.set(amendment.closeId, amendment.price);
  }
  let grossRealizedPnl = 0;
  const closeLot = (close: LotClose) => {
    if (voided.has(close.id)) return;
    const lot = lots.find(item => item.id === close.lotId);
    if (!lot || close.quantity > lot.quantity) throw new Error("Invalid historical allocation");
    grossRealizedPnl += ((prices.get(close.id) ?? close.price) - lot.entryPrice) * close.quantity * multiplier(lot.asset) * (lot.side === "long" ? 1 : -1);
    if (!Number.isFinite(grossRealizedPnl)) throw new Error("Historical totals exceed numerical range");
    lot.quantity -= close.quantity;
  };
  for (const close of position.legacy.closes) {
    if (Date.parse(close.at) > at) continue;
    const index = close.assetId === "stock" ? full.initial.legs.length : full.initial.legs.findIndex(leg => `option:${leg.id}` === close.assetId);
    closeLot({ ...close, lotId: full.openings[index].id });
  }
  for (const transaction of position.transactions) if (Date.parse(transaction.at) <= at) transaction.closes.forEach(closeLot);
  const remaining = lots.filter(lot => lot.quantity > 0);
  if (!Number.isFinite(grossRealizedPnl - full.allowance)) throw new Error("Historical totals exceed numerical range");
  return { cutoff, lots: remaining, grossRealizedPnl: round(grossRealizedPnl), allowance: full.allowance, netClosedPnl: remaining.length ? null : round(grossRealizedPnl - full.allowance), status: remaining.length ? "open" as const : "closed" as const,
    basis: "Latest-revision restated holdings and realized P/L, not as-known-then history. Effective execution times use the latest audited price corrections and voids. No historical marks, expiry settlement, or percentage returns are inferred." };
}

export function recordLotTransaction(position: PositionLots, request: LotTransaction): PositionLots {
  const projection = projectPositionLots(position);
  const existing = position.transactions.find(transaction => transaction.id === request?.id);
  if (existing) {
    projectPositionLots({ ...position, transactions: position.transactions.map(transaction => transaction.id === request.id ? request : transaction) });
    if (fingerprint(existing) !== fingerprint(request)) throw new Error("Lot transaction ID conflict");
    return structuredClone(position);
  }
  if (!request || Date.parse(request.recordedAt) < Date.parse(projection.recordedAt)) throw new Error("Transaction recording precedes existing audit history");
  const next = { ...structuredClone(position), transactions: [...structuredClone(position.transactions), structuredClone(request)] };
  projectPositionLots(next);
  return next;
}

function recordAmendment(position: PositionLots, amendment: LotAmendment): PositionLots {
  const projection = projectPositionLots(position), existing = position.amendments?.find(event => event.id === amendment.id);
  if (existing) {
    projectPositionLots({ ...position, amendments: position.amendments!.map(event => event.id === amendment.id ? amendment : event) });
    if (fingerprint(existing) !== fingerprint(amendment)) throw new Error("Lot amendment ID conflict");
    return structuredClone(position);
  }
  if (Date.parse(amendment.recordedAt) < Date.parse(projection.recordedAt)) throw new Error("Amendment recording precedes existing audit history");
  const next = { ...structuredClone(position), amendments: [...structuredClone(position.amendments ?? []), structuredClone(amendment)] };
  projectPositionLots(next);
  return next;
}

export function recordLotPriceCorrection(position: PositionLots, request: PriceCorrection): PositionLots {
  if (!keys(request, "closeId,id,price,reason,recordedAt")) throw new Error("Invalid price correction");
  return recordAmendment(position, { kind: "price-correction", ...request });
}

export function recordLotCloseVoid(position: PositionLots, request: CloseVoid): PositionLots {
  if (!keys(request, "closeId,id,reason,recordedAt")) throw new Error("Invalid close void");
  return recordAmendment(position, { kind: "close-void", ...request });
}

export function recordLotOpeningPriceCorrection(position: PositionLots, request: OpeningPriceCorrection): PositionLots {
  if (!keys(request, "id,lotId,price,reason,recordedAt")) throw new Error("Invalid opening-price correction");
  return recordAmendment(position, { kind: "opening-price-correction", ...request });
}

export function valuePositionLots(position: PositionLots, snapshot: MarketSnapshot, basis: PricingBasis) {
  const projection = projectPositionLots(position), { initial, lots } = projection;
  if (!lots.length) throw new Error("Closed position already has a realized total");
  if (!snapshot || typeof snapshot.id !== "string" || !snapshot.id || snapshot.underlying !== initial.underlying || !["mid", "natural"].includes(basis) || !Number.isFinite(snapshot.spot) || snapshot.spot <= 0 || !Array.isArray(snapshot.contracts) || new Set(snapshot.contracts.map(c => c.contractId)).size !== snapshot.contracts.length) throw new Error("Incompatible lot valuation snapshot");
  const retrieved = Date.parse(snapshot.retrievedAt), minimum = Date.parse(projection.asOf), times: number[] = [];
  if (!Number.isFinite(retrieved) || retrieved < minimum || retrieved > Date.now()) throw new Error("Valuation must follow recorded executions");
  const sourceTime = (value: string) => {
    const at = Date.parse(value);
    if (!Number.isFinite(at) || at < minimum || at > retrieved) throw new Error("Source quote must follow recorded executions and precede retrieval");
    times.push(at);
  };
  sourceTime(snapshot.spotAsOf);
  if (snapshot.spotSourceTimes) Object.values(snapshot.spotSourceTimes).forEach(sourceTime);
  const groups = new Map<string, { lot: RemainingLot; quantity: number; cost: number }>();
  let unrealizedPnl = 0;
  const lotMarks = lots.map(lot => {
    let mark = snapshot.spot;
    const asset = lot.asset;
    if (asset.kind === "option") {
      const contract = snapshot.contracts.find(c => c.contractId === asset.contractId);
      if (!contract || assetFingerprint({ kind: "option", contractId: contract.contractId, type: contract.type, strike: contract.strike, expiry: contract.expiry, multiplier: contract.multiplier }) !== assetFingerprint(asset) || retrieved >= Date.parse(asset.expiry)) throw new Error("Remaining option cannot be marked from this snapshot");
      if (!money(contract.bid) || !Number.isFinite(contract.ask) || contract.ask <= 0 || contract.ask < contract.bid) throw new Error("Invalid option quote");
      sourceTime(contract.quoteAsOf);
      if (contract.sourceTimes) Object.values(contract.sourceTimes).forEach(sourceTime);
      mark = basis === "mid" ? contract.bid / 2 + contract.ask / 2 : lot.side === "long" ? contract.bid : contract.ask;
    }
    const pnl = (mark - lot.entryPrice) * lot.quantity * multiplier(asset) * (lot.side === "long" ? 1 : -1);
    if (!Number.isFinite(mark * lot.quantity * multiplier(asset)) || !Number.isFinite(pnl) || !Number.isFinite(unrealizedPnl + pnl)) throw new Error("Lot valuation exceeds numerical range");
    unrealizedPnl += pnl;
    const key = assetKey(asset), group = groups.get(key) ?? { lot, quantity: 0, cost: 0 };
    group.quantity += lot.quantity; group.cost += lot.quantity * lot.entryPrice;
    if (!Number.isSafeInteger(group.quantity) || !Number.isFinite(group.cost)) throw new Error("Aggregated basis exceeds numerical range");
    groups.set(key, group);
    return { lotId: lot.id, quantity: lot.quantity, entryPrice: lot.entryPrice, mark, unrealizedPnl: round(pnl) };
  });
  const legs: OptionLeg[] = [];
  let stock: StrategyState["stock"];
  for (const { lot, quantity, cost } of groups.values()) {
    const asset = lot.asset, entryPrice = cost / quantity;
    if (asset.kind === "stock") stock = { shares: quantity * (lot.side === "long" ? 1 : -1), entryPrice };
    else {
      const contract = snapshot.contracts.find(c => c.contractId === asset.contractId)!;
      legs.push({ id: asset.contractId, contractId: asset.contractId, type: asset.type, strike: asset.strike, expiry: contract.expiry, multiplier: asset.multiplier, side: lot.side, contracts: quantity, entryPrice, iv: contract.iv });
    }
  }
  const candidate: StrategyState = pruneExpiryIvShifts({ ...initial, name: "Remaining holdings", version: projection.version, legs, stock, feeAllowance: 0, spot: snapshot.spot, scenarioSpot: snapshot.spot, valuationTimestamp: snapshot.retrievedAt, scenarioDate: snapshot.retrievedAt, pricing: { mode: "market", snapshotId: snapshot.id, basis, entryMode: "fixed", ...(snapshot.historical ? { historical: true } : {}) } });
  if (initial.excludedLegIds) candidate.excludedLegIds = initial.legs.filter((leg, index) => initial.excludedLegIds!.includes(leg.id) && lots.some(lot => lot.id === projection.openings[index].id)).map(leg => leg.contractId);
  const { excludedLegIds: _selection, ...heldInventory } = candidate;
  const errors = validateMarketStrategy(heldInventory, snapshot);
  const combinedPnl = projection.grossRealizedPnl + unrealizedPnl - projection.allowance;
  if (!Number.isFinite(combinedPnl)) throw new Error("Combined lot valuation exceeds numerical range");
  return { lotMarks, remainingState: errors.length ? null : candidate, analysisUnavailable: errors.length ? errors.join("; ") : null, snapshotId: snapshot.id, basis, retrievedAt: snapshot.retrievedAt, oldestQuoteAt: new Date(Math.min(...times)).toISOString(), newestQuoteAt: new Date(Math.max(...times)).toISOString(), historical: snapshot.historical === true, grossRealizedPnl: projection.grossRealizedPnl, unrealizedPnl: round(unrealizedPnl), allowance: projection.allowance, combinedPnl: round(combinedPnl), disclosure: "Dated estimate, not a fill or live return. Explicit-lot realized P/L plus remaining quoted P/L minus the position allowance once. Stock uses spot, not executable bid/ask. Weighted entry is for chart projection only; recorded lots are unchanged. No dividends, financing, borrow, exercise, assignment or settlement cashflows." };
}
