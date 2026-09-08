import { evaluateScenario, pruneExpiryIvShifts, validateConstruction, validateStrategy, type StrategyState } from "./options";
import type { projectPositionLots, valuePositionLots } from "./position-lots";

export type LotScenarioSide = { projection: ReturnType<typeof projectPositionLots>; valuation: ReturnType<typeof valuePositionLots> | null };
export type LotScenarioInput = { before: LotScenarioSide; after: LotScenarioSide };
export type LotScenario = { spot: number; date: string; ivShift: number };

export function assertRemainingLotInventory(lots: LotScenarioSide["projection"]["lots"], state: StrategyState) {
  const groups = new Map<string, { quantity: number; cost: number; lot: typeof lots[number] }>();
  for (const lot of lots) {
    if (!Number.isSafeInteger(lot.quantity) || lot.quantity <= 0 || typeof lot.entryPrice !== "number" || !Number.isFinite(lot.entryPrice) || lot.entryPrice < 0 || !["long", "short"].includes(lot.side) || lot.asset.kind === "stock" && lot.asset.symbol !== state.underlying) throw new Error("Invalid remaining lot basis.");
    const key = lot.asset.kind === "stock" ? "stock" : lot.asset.contractId;
    const group = groups.get(key);
    const known = group?.lot.asset, asset = lot.asset;
    const sameAsset = !known || known.kind === "stock" && asset.kind === "stock" && known.symbol === asset.symbol
      || known.kind === "option" && asset.kind === "option" && known.contractId === asset.contractId && known.type === asset.type && known.strike === asset.strike && known.multiplier === asset.multiplier && Date.parse(known.expiry) === Date.parse(asset.expiry);
    if (group && (group.lot.side !== lot.side || !sameAsset)) throw new Error("Conflicting remaining lot identities.");
    groups.set(key, { quantity: (group?.quantity ?? 0) + lot.quantity, cost: (group?.cost ?? 0) + lot.quantity * lot.entryPrice, lot });
  }
  const options = [...groups.values()].filter(group => group.lot.asset.kind === "option"), stock = groups.get("stock");
  if (options.length !== state.legs.length || new Set(state.legs.map(leg => leg.contractId)).size !== state.legs.length || !!stock !== !!state.stock) throw new Error("Remaining scenario inventory mismatch.");
  for (const leg of state.legs) {
    const group = groups.get(leg.contractId), asset = group?.lot.asset;
    if (!group || asset?.kind !== "option" || leg.side !== group.lot.side || leg.contracts !== group.quantity || leg.entryPrice !== group.cost / group.quantity || leg.type !== asset.type || leg.strike !== asset.strike || leg.multiplier !== asset.multiplier || Date.parse(leg.expiry) !== Date.parse(asset.expiry)) throw new Error("Remaining scenario lot basis mismatch.");
  }
  if (stock && (!state.stock || state.stock.shares !== stock.quantity * (stock.lot.side === "long" ? 1 : -1) || state.stock.entryPrice !== stock.cost / stock.quantity)) throw new Error("Remaining scenario stock basis mismatch.");
}

export function prepareLotScenarioComparison(input: LotScenarioInput, scenario: LotScenario) {
  const captured = structuredClone(input), selected = structuredClone(scenario), sides = [captured.before, captured.after];
  const finite = (value: number) => typeof value === "number" && Number.isFinite(value);
  const date = Date.parse(selected.date);
  if (!finite(selected.spot) || selected.spot <= 0 || selected.spot > 1e6 || !finite(selected.ivShift) || Math.abs(selected.ivShift) > 10 || !Number.isFinite(date) || new Date(date).toISOString() !== selected.date) throw new Error("Invalid lot scenario coordinates.");
  const initial = sides[0].projection.initial, model = initial.valuationModel ?? "european-bsm-v1";
  const expiryShifts = (state: StrategyState) => (state.expiryIvShifts ?? []).filter(shift => shift.ivShift !== 0).map(shift => [shift.expiry, shift.ivShift]).sort();
  const settings = (state: StrategyState) => [state.underlying, state.valuationModel ?? "european-bsm-v1", state.rate, state.dividendYield];
  const expectedSettings = JSON.stringify(settings(initial));
  const valuations = sides.flatMap(side => side.valuation ? [side.valuation] : []);
  if (valuations.some(value => !value.snapshotId || value.snapshotId !== valuations[0].snapshotId || value.retrievedAt !== valuations[0].retrievedAt || value.basis !== valuations[0].basis)) throw new Error("Lot scenarios require the same captured snapshot, retrieval time and quote basis.");
  const optionLots = sides.flatMap(side => side.projection.lots.filter(lot => lot.asset.kind === "option"));
  const minimumDate = Math.max(...sides.flatMap(side => [Date.parse(side.projection.asOf), Date.parse(side.projection.initial.valuationTimestamp), ...(side.valuation ? [Date.parse(side.valuation.retrievedAt)] : [])]));
  const maximumDate = Math.min(...optionLots.map(lot => lot.asset.kind === "option" ? Date.parse(lot.asset.expiry) : Infinity));
  if (!Number.isFinite(minimumDate) || date < minimumDate || date > maximumDate) throw new Error("Scenario date must follow both inventories and captured quotes, and not pass the first remaining option expiry.");
  const strikes = optionLots.map(lot => lot.asset.kind === "option" ? lot.asset.strike : selected.spot);
  const min = Math.min(selected.spot * .76, ...strikes), max = Math.max(selected.spot * 1.24, ...strikes);
  if (!finite(min) || !finite(max) || min <= 0 || max <= min) throw new Error("Invalid lot scenario range.");
  const states = sides.map(side => {
    const { projection, valuation } = side;
    if (JSON.stringify(settings(projection.initial)) !== expectedSettings || JSON.stringify(expiryShifts(projection.initial)) !== JSON.stringify(expiryShifts(initial)) || ![projection.grossRealizedPnl, projection.allowance].every(finite) || projection.allowance < 0) throw new Error("Lot scenario assumptions do not match.");
    if (!projection.lots.length) return null;
    if (!valuation) throw new Error("Value both remaining inventories with the same captured snapshot first.");
    for (const lot of projection.lots) if (!Number.isSafeInteger(lot.quantity) || lot.quantity <= 0 || !finite(lot.entryPrice) || lot.entryPrice < 0 || !["long", "short"].includes(lot.side) || lot.asset.kind === "stock" && lot.asset.symbol !== initial.underlying) throw new Error("Invalid remaining lot basis.");
    if (projection.lots.every(lot => lot.asset.kind === "stock")) return null;
    const state = valuation.remainingState;
    if (!state) throw new Error(valuation.analysisUnavailable ?? "Remaining option inventory is not supported by the scenario engine.");
    if (JSON.stringify(expiryShifts(state)) !== JSON.stringify(expiryShifts(pruneExpiryIvShifts({ ...initial, legs: state.legs })))) throw new Error("Remaining expiry IV assumptions do not match their original basis.");
    if (JSON.stringify(settings(state)) !== expectedSettings || state.valuationTimestamp !== valuation.retrievedAt || state.feeAllowance !== 0 || state.pricing && state.pricing.entryMode !== "fixed" || state.pricing && state.pricing.snapshotId !== valuation.snapshotId) throw new Error("Remaining scenario state does not match its captured basis.");
    assertRemainingLotInventory(projection.lots, state);
    if (validateConstruction(state).length) throw new Error("Remaining scenario construction is invalid.");
    const { excludedLegIds: _selection, ...heldInventory } = state;
    const next = { ...heldInventory, scenarioSpot: selected.spot, scenarioDate: selected.date, ivShift: selected.ivShift };
    if (validateStrategy(next).length) throw new Error("Remaining scenario state is invalid for these coordinates.");
    return next;
  });
  const optionStates = states.filter(state => state !== null);
  if (optionStates.some(state => state.spot !== optionStates[0].spot)) throw new Error("Remaining scenario states have different captured underlying prices.");
  return { sides, selected, model, min, max, states };
}

export function calculateLotScenarioComparison(input: LotScenarioInput, scenario: LotScenario) {
  const { sides, selected, model, states } = prepareLotScenarioComparison(input, scenario);
  const totals = sides.map((side, index) => {
    const { grossRealizedPnl, allowance } = side.projection;
    const state = states[index];
    const unrealizedPnl = state ? evaluateScenario(state).pnl : side.projection.lots.reduce((pnl, lot) => pnl + (selected.spot - lot.entryPrice) * lot.quantity * (lot.side === "long" ? 1 : -1), 0);
    const combinedPnl = unrealizedPnl + (grossRealizedPnl - allowance);
    if (![unrealizedPnl, combinedPnl].every(Number.isFinite)) throw new Error("Lot scenario totals exceed numerical range.");
    return { combinedPnl, grossRealizedPnl, unrealizedPnl, allowance };
  });
  return { scenario: selected, model, before: totals[0], after: totals[1] };
}
