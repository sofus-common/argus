import { afterEach, expect, it, vi } from 'vitest';
import { createStrategy, type MarketSnapshot } from '../src/options';
import { readWorkspaceDraft, recoverWorkspaceDraft, type WorkspaceDraft } from '../src/workspace-draft';

afterEach(() => vi.useRealTimers());

it('round trips position-owned thesis fields and rejects invalid metadata', () => {
  const value = draft(false);
  const thesis = { text: 'Neutral through expiry', targetSpot: 103, targetDate: '2026-09-10T18:30:00.123Z' };
  Object.assign(value.state, { thesis });
  expect(recoverWorkspaceDraft(value).state).toMatchObject({ thesis });
  for (const invalid of [{ ...thesis, targetSpot: -1 }, { ...thesis, text: 'x'.repeat(12001) }, { ...thesis, targetDate: '2026-02-30T00:00:00.000Z' }, { ...thesis, extra: true }]) {
    Object.assign(value.state, { thesis: invalid });
    expect(() => readWorkspaceDraft(JSON.stringify(value))).toThrow();
  }
});

it('preserves cash-index identity and Trade event provenance through draft recovery', () => {
  const value = draft(true);
  Object.assign(value.state, { underlying: 'XSP', underlyingKind: 'cash-index', valuationModel: 'european-bsm-v1' });
  delete value.state.stock;
  value.state.legs.forEach(leg => { leg.contractId = leg.contractId.replace('SPY', 'XSP'); });
  Object.assign(value.snapshot!, { underlying: 'XSP', underlyingKind: 'cash-index', indexSourceTime: value.state.valuationTimestamp,
    contractTerms: { exerciseStyle: 'European', settlement: 'cash', multiplier: 100, settlementSession: 'PM' } });
  value.snapshot!.contracts.forEach(leg => { leg.contractId = leg.contractId.replace('SPY', 'XSP'); });
  const recovered = recoverWorkspaceDraft(value);
  expect(recovered.state).toMatchObject({ underlyingKind: 'cash-index', valuationModel: 'european-bsm-v1' });
  expect(recovered.snapshot).toMatchObject({ underlyingKind: 'cash-index', indexSourceTime: value.state.valuationTimestamp, contractTerms: value.snapshot!.contractTerms });
  expect(recovered.state.legs).toEqual(value.state.legs);
  expect(readWorkspaceDraft(JSON.stringify(recovered))).toEqual(recovered);
  const captured = structuredClone(value);
  captured.snapshot!.captureSource = 'DXLink';
  captured.snapshot!.contracts.forEach(c => { c.sourceTimes = { bid: c.quoteAsOf, ask: c.quoteAsOf, iv: c.quoteAsOf }; });
  expect(recoverWorkspaceDraft(captured).snapshot).toMatchObject({ captureSource: 'DXLink', indexSourceTime: value.state.valuationTimestamp });
  const unsynchronized = structuredClone(captured);
  Object.assign(unsynchronized.snapshot!, { indexSourceTime: new Date(Date.parse(value.state.valuationTimestamp) - 60_001).toISOString(), spotAsOf: new Date(Date.parse(value.state.valuationTimestamp) - 60_001).toISOString() });
  expect(() => readWorkspaceDraft(JSON.stringify(unsynchronized))).toThrow('Capture timestamps disagree');
  const mutations: Array<(v: any) => void> = [
    v => { delete v.state.underlyingKind; },
    v => { delete v.snapshot.underlyingKind; },
    v => { v.state.underlyingKind = 'future'; },
    v => { v.snapshot.underlyingKind = 'future'; },
    v => { v.state.stock = { shares: 100, entryPrice: 100 }; },
    v => { v.state.valuationModel = 'american-crr-1024-v1'; },
    v => { delete v.snapshot.indexSourceTime; },
    v => { v.snapshot.indexSourceTime = new Date(Date.parse(v.snapshot.retrievedAt) + 1).toISOString(); },
    v => { v.snapshot.indexSourceTime = new Date(Date.parse(v.snapshot.retrievedAt) - 300001).toISOString(); },
    v => { v.snapshot.spotSourceTimes = { bid: v.snapshot.spotAsOf, ask: v.snapshot.spotAsOf }; },
    v => { v.snapshot.contractTerms.sharesPerContract = 100; },
    v => { v.snapshot.contractTerms.multiplier = 10; },
    v => { v.snapshot.contractTerms.settlementSession = 'AM'; },
    v => { delete v.snapshot.contractTerms; },
  ];
  for (const mutate of mutations) { const invalid = structuredClone(value); mutate(invalid); expect(() => readWorkspaceDraft(JSON.stringify(invalid))).toThrow(); }
  const equity = draft(true);
  Object.assign(equity.snapshot!, { indexSourceTime: equity.state.valuationTimestamp });
  expect(() => readWorkspaceDraft(JSON.stringify(equity))).toThrow();
});

it.each(['界', '\u0000'])('recovers eight held legs across four expiries with 200 quotes and maximum-length %j draft text', text => {
  const value = draft(true), state = value.state, snapshot = value.snapshot!;
  const dates = ['2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30'];
  snapshot.availableExpiries = dates;
  snapshot.contracts = Array.from({ length: 200 }, (_, i) => {
    const expiry = `${dates[Math.floor(i / 50)]}T20:00:00.000Z`, strike = 700 + i % 50;
    return { contractId: `SPY   ${expiry.slice(2, 10).replaceAll('-', '')}C${String(strike * 1000).padStart(8, '0')}`, type: 'call', strike, expiry, multiplier: 100, bid: 1.12345678, ask: 2.12345678, iv: .23456789, quoteAsOf: state.valuationTimestamp, volume: 100000, openInterest: 100000 };
  });
  state.legs = Array.from({ length: 8 }, (_, i) => {
    const quote = snapshot.contracts[Math.floor(i / 2) * 50 + i % 2];
    return { ...state.legs[i % 2], id: `held-${i}`, contractId: quote.contractId, strike: quote.strike, expiry: quote.expiry, iv: quote.iv };
  });
  state.expiryIvShifts = dates.map(date => ({ expiry: `${date}T20:00:00.000Z`, ivShift: .01 }));
  state.excludedLegIds = [state.legs[7].id];
  value.title = text.repeat(120); value.thesis = text.repeat(12000); value.composer = text.repeat(12000);
  const serialized = JSON.stringify(value);
  expect(new TextEncoder().encode(serialized).length).toBeLessThanOrEqual(256 * 1024);
  const recovered = recoverWorkspaceDraft(readWorkspaceDraft(serialized));
  expect(recovered.state.legs).toEqual(state.legs);
  expect(recovered.state.expiryIvShifts).toEqual(state.expiryIvShifts);
  expect(recovered.state.excludedLegIds).toEqual(state.excludedLegIds);
  expect(recovered.snapshot!.contracts).toEqual(snapshot.contracts);
  expect([recovered.title, recovered.thesis, recovered.composer]).toEqual([value.title, value.thesis, value.composer]);
  expect(recovered.state.pricing).toMatchObject({ entryMode: 'fixed', historical: true });
});

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
  expect(() => readWorkspaceDraft(' '.repeat(256 * 1024 + 1))).toThrow();
  expect(() => readWorkspaceDraft('{')).toThrow();
  const sample = draft(); sample.snapshot = draft(true).snapshot;
  expect(() => readWorkspaceDraft(JSON.stringify(sample))).toThrow();
});
