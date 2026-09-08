import { validateMarketConstruction, validateConstruction, type MarketSnapshot, type StrategyState } from './options';
import { timestamp, validatedSnapshot } from './market-snapshot';

export type WorkspaceDraft = { schemaVersion: 1; state: StrategyState; snapshot: MarketSnapshot | null; title: string; thesis: string; composer: string; savedAt: string };

export function readWorkspaceDraft(raw: string): WorkspaceDraft {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 131072) throw new Error('Draft is too large');
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'composer,savedAt,schemaVersion,snapshot,state,thesis,title' || value.schemaVersion !== 1) throw new Error('Invalid draft');
  for (const [field, limit] of [['title', 120], ['thesis', 12000], ['composer', 12000]] as const) if (typeof value[field] !== 'string' || value[field].length > limit) throw new Error('Invalid draft text');
  const canonical = (date: unknown) => { if (timestamp(date) !== date) throw new Error('Invalid draft date'); };
  canonical(value.savedAt);
  if (validateConstruction(value.state).length) throw new Error('Invalid draft strategy');
  const input: StrategyState = value.state;
  canonical(input.valuationTimestamp); canonical(input.scenarioDate);
  input.legs.forEach(leg => { canonical(leg.expiry); if (!Number.isSafeInteger(leg.contracts)) throw new Error('Invalid draft quantity'); });
  const { id, version, name, underlying, spot, valuationTimestamp, rate, dividendYield, scenarioDate, scenarioSpot, ivShift, valuationModel, stock, feeAllowance, expiryIvShifts } = input;
  const state: StrategyState = { id, version, name, underlying, spot, valuationTimestamp, rate, dividendYield, scenarioDate, scenarioSpot, ivShift,
    legs: input.legs.map(({ id, contractId, side, type, contracts, strike, expiry, entryPrice, iv, multiplier }) => ({ id, contractId, side, type, contracts, strike, expiry, entryPrice, iv, multiplier })),
    ...(input.excludedLegIds !== undefined ? { excludedLegIds: [...input.excludedLegIds] } : {}),
    ...(valuationModel !== undefined ? { valuationModel } : {}), ...(stock !== undefined ? { stock } : {}), ...(feeAllowance !== undefined ? { feeAllowance } : {}), ...(expiryIvShifts !== undefined ? { expiryIvShifts } : {}),
  };
  let snapshot: MarketSnapshot | null = null;
  if (input.pricing) {
    if (typeof value.snapshot?.id !== 'string' || !value.snapshot.id || value.snapshot.id.length > 200) throw new Error('Invalid draft snapshot identity');
    snapshot = validatedSnapshot(value.snapshot);
    canonical(snapshot.retrievedAt); canonical(snapshot.spotAsOf);
    snapshot.availableExpiries.forEach(date => canonical(`${date}T00:00:00.000Z`));
    snapshot.contracts.forEach(contract => { canonical(contract.expiry); canonical(contract.quoteAsOf); });
    const { mode, snapshotId, basis, historical, entryMode } = input.pricing;
    state.pricing = { mode, snapshotId, basis, ...(historical !== undefined ? { historical } : {}), ...(entryMode !== undefined ? { entryMode } : {}) };
    if (validateMarketConstruction(state, snapshot).length) throw new Error('Draft pricing does not match');
  } else if (value.snapshot !== null) throw new Error('Sample draft cannot contain market quotes');
  return structuredClone({ schemaVersion: 1, state, snapshot, title: value.title, thesis: value.thesis, composer: value.composer, savedAt: value.savedAt });
}

export function recoverWorkspaceDraft(draft: WorkspaceDraft): WorkspaceDraft {
  const recovered = readWorkspaceDraft(JSON.stringify(draft));
  if (recovered.snapshot && recovered.state.pricing) {
    const id = `draft-${crypto.randomUUID()}`;
    recovered.snapshot = { ...recovered.snapshot, id, historical: true };
    recovered.state.pricing = { ...recovered.state.pricing, snapshotId: id, historical: true };
  }
  return recovered;
}
