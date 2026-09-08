import { afterEach, expect, it, vi } from 'vitest';
import { createStrategy, type MarketSnapshot } from '../src/options';
import { readWorkspaceDraft, recoverWorkspaceDraft, type WorkspaceDraft } from '../src/workspace-draft';

afterEach(() => vi.useRealTimers());

it('round-trips excluded inventory and empty constructions without discarding held costs', () => {
  for (const market of [false, true]) {
    const value = draft(market);
    const normalized = readWorkspaceDraft(JSON.stringify(value));
    value.state.excludedLegIds = value.state.legs.map(leg => leg.id);
    expect(readWorkspaceDraft(JSON.stringify(value))).toEqual({ ...normalized, state: value.state });
    const recovered = recoverWorkspaceDraft(value);
    expect(recovered.state.excludedLegIds).toEqual(value.state.excludedLegIds);
    expect(recovered.state.legs).toEqual(value.state.legs);
    value.state.legs = []; value.state.excludedLegIds = []; delete value.state.stock; delete value.state.expiryIvShifts;
    expect(readWorkspaceDraft(JSON.stringify(value))).toEqual({ ...normalized, state: value.state });
  }
});

it('validates excluded market contracts rather than hiding quote mismatches', () => {
  const value = draft(true);
  value.state.excludedLegIds = [value.state.legs[0].id];
  value.state.legs[0].iv += .1;
  expect(() => readWorkspaceDraft(JSON.stringify(value))).toThrow();
  const invalid = draft(); invalid.state.excludedLegIds = ['missing'];
  expect(() => readWorkspaceDraft(JSON.stringify(invalid))).toThrow();
});

function draft(market = false): WorkspaceDraft {
  const state = createStrategy('bull-call');
  let snapshot: MarketSnapshot | null = null;
  if (market) {
    state.pricing = { mode: 'market', snapshotId: 'original', basis: 'mid', entryMode: 'fixed' };
    state.legs.forEach(leg => { leg.contractId = `SPY   ${leg.expiry.slice(2, 10).replaceAll('-', '')}C${String(leg.strike * 1000).padStart(8, '0')}`; });
    snapshot = { id: 'original', underlying: state.underlying, source: 'Tastytrade', spot: state.spot, retrievedAt: state.valuationTimestamp, spotAsOf: state.valuationTimestamp, availableExpiries: [...new Set(state.legs.map(leg => leg.expiry.slice(0, 10)))], contracts: state.legs.map(leg => ({ ...leg, multiplier: 100, bid: 0, ask: 2, quoteAsOf: state.valuationTimestamp })) };
    state.stock = { shares: -100, entryPrice: 110 };
    state.feeAllowance = 5;
    state.expiryIvShifts = [{ expiry: state.legs[0].expiry, ivShift: .01 }];
  }
  return { schemaVersion: 1, state, snapshot, title: 'Draft', thesis: 'Test thesis', composer: 'Unsent question', savedAt: '2026-09-06T12:00:00.000Z' };
}

it('recovers immutable sample and expired market scenarios without identity or cost loss', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2027-01-01T12:00:00.000Z'));
  const sample = draft();
  expect(recoverWorkspaceDraft(readWorkspaceDraft(JSON.stringify(sample)))).toEqual(sample);
  const original = draft(true), before = structuredClone(original);
  const recovered = recoverWorkspaceDraft(original);
  expect(original).toEqual(before);
  expect(recovered.snapshot!.id).toMatch(/^draft-/);
  expect(recovered.snapshot!.id).not.toBe(recoverWorkspaceDraft(original).snapshot!.id);
  expect(recovered.snapshot!.historical).toBe(true);
  expect(recovered.state).toEqual({ ...original.state, pricing: { ...original.state.pricing, snapshotId: recovered.snapshot!.id, historical: true } });
  expect(readWorkspaceDraft(JSON.stringify(recovered))).toEqual(recovered);
});

it('rejects corrupted draft identity, source, dates, costs, quantities and oversized or extra data', () => {
  const mutations: Array<(value: any) => void> = [
    value => { value.savedIdentity = 'other'; },
    value => { value.schemaVersion = 2; },
    value => { value.savedAt = '2026-02-30T12:00:00.000Z'; },
    value => { value.savedAt = '2026-09-06T12:00:00Z'; },
    value => { value.title = 'x'.repeat(121); },
    value => { value.thesis = 'x'.repeat(12001); },
    value => { value.composer = 'x'.repeat(12001); },
    value => { value.snapshot = null; },
    value => { value.snapshot.id = 'other'; },
    value => { value.snapshot.source = 'Invented'; },
    value => { value.snapshot.contracts[0].bid = 3; },
    value => { value.snapshot.contracts[0].ask = 0; },
    value => { value.snapshot.contracts[0].contractId = value.snapshot.contracts[1].contractId; },
    value => { value.snapshot.spotSourceTimes = { bid: value.savedAt, ask: value.savedAt }; },
    value => { value.state.legs[0].contracts = 0; },
    value => { value.state.legs[0].entryPrice = -1; },
    value => { value.state.valuationTimestamp = '2026-09-06'; },
    value => { value.state.pricing.historical = true; },
    value => { value.state.pricing.mode = 'sample'; },
  ];
  for (const mutate of mutations) { const value = draft(true); mutate(value); expect(() => readWorkspaceDraft(JSON.stringify(value))).toThrow(); }
  expect(() => readWorkspaceDraft(' '.repeat(131073))).toThrow();
  expect(() => readWorkspaceDraft('{')).toThrow();
  const sample = draft(); sample.snapshot = draft(true).snapshot;
  expect(() => readWorkspaceDraft(JSON.stringify(sample))).toThrow();
});
