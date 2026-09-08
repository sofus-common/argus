import { expect, it } from 'vitest';
import { createStrategy } from '../src/options';
import { createPosition } from '../src/position-lifecycle';
import { recordLotTransaction, upgradePositionLots } from '../src/position-lots';
import { buildPositionPerformance, loadPositionPerformance, performanceCutoff, readPositionPerformance } from '../src/position-performance';

function fixture() {
  const state = createStrategy('long-call');
  state.valuationTimestamp = state.scenarioDate = '2026-09-01T12:00:00.000Z';
  state.legs[0] = { ...state.legs[0], contractId: 'SPY   261009C00100000', strike: 100, expiry: '2026-10-09T20:00:00.000Z', contracts: 2, entryPrice: 2 };
  state.pricing = { mode: 'market', snapshotId: 'initial', basis: 'mid', entryMode: 'fixed' };
  state.stock = { shares: -10, entryPrice: 100 }; state.feeAllowance = 7;
  let position = upgradePositionLots(createPosition(state));
  const at = '2026-09-02T12:00:00.000Z', leg = state.legs[0];
  position = recordLotTransaction(position, { id: 'roll', at, recordedAt: at, closes: [{ id: 'close', lotId: 'initial:option:0', quantity: 1, price: 3 }], opens: [{ id: 'new', side: 'long', quantity: 1, entryPrice: 4, asset: { kind: 'option', contractId: 'SPY   261016C00105000', strike: 105, expiry: '2026-10-16T20:00:00.000Z', type: leg.type, multiplier: 100 } }] });
  const final = '2026-09-04T12:00:00.000Z';
  position = recordLotTransaction(position, { id: 'finish', at: final, recordedAt: final, opens: [], closes: [{ id: 'old-exit', lotId: 'initial:option:0', quantity: 1, price: 4 }, { id: 'new-exit', lotId: 'new', quantity: 1, price: 5 }, { id: 'stock-exit', lotId: 'initial:stock', quantity: 10, price: 90 }] });
  const mark = (date: string, mid: number) => ({ bid: mid - .1, ask: mid + .1, created: `${date}T17:15:00.000`, last_trade: `${date}T16:00:00.000` });
  const options = [
    { response: [{ contract: { symbol: 'SPY', strike: 100, expiration: '2026-10-09', right: 'CALL' }, data: [mark('2026-09-01', 3), mark('2026-09-02', 4), mark('2026-09-03', 4)] }] },
    { response: [{ contract: { symbol: 'SPY', strike: 105, expiration: '2026-10-16', right: 'CALL' }, data: [mark('2026-09-02', 5)] }] },
  ];
  return { position, options, stock: { response: ['2026-09-01', '2026-09-02', '2026-09-03'].map(date => mark(date, 90)) }, range: { start: '2026-08-31', end: '2026-09-05' }, now: new Date('2026-09-07T12:00:00Z') };
}

it('reconciles dated rolls and short stock, gaps and closed days without inventing marks', () => {
  const f = fixture(), result = buildPositionPerformance(f.position, f.options, f.stock, f.range, f.now);
  expect(result.rows.map(row => row.combinedPnl)).toEqual([null, 293, 493, null, 493, 493]);
  expect(result.rows.map(row => row.changeUsd)).toEqual([null, null, 200, null, null, 0]);
  expect(result.rows[1].lots).toHaveLength(2); expect(result.rows[2].lots).toHaveLength(3);
  expect(result.rows[4]).toMatchObject({ status: 'closed', grossRealizedPnl: 500, unrealizedPnl: 0 });
  expect(result.high).toEqual({ date: '2026-09-02', value: 493 }); expect(result.low).toEqual({ date: '2026-09-01', value: 293 });
  expect(readPositionPerformance(JSON.parse(JSON.stringify(result)), f.position, f.range, f.now)).toEqual(result);
  const altered = structuredClone(result); altered.rows[2].combinedPnl!++;
  expect(() => readPositionPerformance(altered, f.position, f.range, f.now)).toThrow();
  f.options[0].response[0].contract.strike = 999;
  expect(() => buildPositionPerformance(f.position, f.options, f.stock, f.range, f.now)).toThrow();
});

it('uses New York DST accounting cutoffs and validates ranges before requesting data', async () => {
  expect(performanceCutoff('2026-01-05')).toBe('2026-01-05T22:15:00.000Z');
  expect(performanceCutoff('2026-07-05')).toBe('2026-07-05T21:15:00.000Z');
  const f = fixture(); let calls = 0;
  const request = async () => { calls++; return [...f.options, f.stock]; };
  const result = await loadPositionPerformance(f.position, f.range, {}, request, f.now);
  expect(result.rows[2].combinedPnl).toBe(493); expect(calls).toBe(1);
  await expect(loadPositionPerformance(f.position, { start: '2026-01-01', end: '2026-09-05' }, {}, request, f.now)).rejects.toThrow();
  expect(calls).toBe(1);
});

it('loads more than eight historical identities in bounded batches and rejects over-budget unions', async () => {
  const make = (days: number) => {
    const state = fixture().position.legacy.initial;
    delete state.stock;
    state.valuationTimestamp = state.scenarioDate = '2026-08-20T12:00:00.000Z';
    const leg = (index: number) => ({ ...state.legs[0], id: `held-${index}`, contracts: 1, strike: 100 + index, contractId: `SPY   261009C${String((100 + index) * 1000).padStart(8, '0')}` });
    state.legs = Array.from({ length: 8 }, (_, index) => leg(index));
    let position = upgradePositionLots(createPosition(state));
    for (let day = 1; day < days; day++) {
      const at = `2026-08-${20 + day}T12:00:00.000Z`;
      position = recordLotTransaction(position, { id: `roll-${day}`, at, recordedAt: at,
        closes: Array.from({ length: 8 }, (_, index) => ({ id: `exit-${day}-${index}`, lotId: day === 1 ? `initial:option:${index}` : `open-${day - 1}-${index}`, quantity: 1, price: 3 })),
        opens: Array.from({ length: 8 }, (_, index) => { const option = leg(day * 8 + index); return { id: `open-${day}-${index}`, side: 'long' as const, quantity: 1, entryPrice: 2, asset: { kind: 'option' as const, contractId: option.contractId, strike: option.strike, expiry: option.expiry, type: option.type, multiplier: 100 } }; }),
      });
    }
    return { position, range: { start: '2026-08-20', end: `2026-08-${19 + days}` } };
  };
  const batches: string[][] = [], request = async (_env: unknown, paths: string[]) => { batches.push(paths); return paths.map(() => ({ response: [] })); };
  const normal = make(2);
  const result = await loadPositionPerformance(normal.position, normal.range, {}, request);
  expect(batches.map(batch => batch.length)).toEqual([9, 7]);
  expect(new Set(batches.flat()).size).toBe(16);
  expect(result.rows[0].lots).toHaveLength(8); expect(result.rows[1].lots).toHaveLength(8);
  const over = make(9);
  await expect(loadPositionPerformance(over.position, over.range, {}, request)).rejects.toThrow(/64 held identities/);
  expect(batches).toHaveLength(2);
});

it('leaves expired remaining options unavailable, admits genuine zero P/L and requires no marks when closed', async () => {
  const f = fixture(), state = structuredClone(f.position.legacy.initial);
  delete state.stock; state.legs[0].contracts = 1;
  state.legs[0].expiry = '2026-09-02T20:00:00.000Z'; state.legs[0].contractId = 'SPY   260902C00100000';
  state.feeAllowance = 0;
  const position = upgradePositionLots(createPosition(state)), range = { start: '2026-09-01', end: '2026-09-02' };
  const options = structuredClone(f.options.slice(0, 1)); options[0].response[0].contract.expiration = '2026-09-02';
  options[0].response[0].data = options[0].response[0].data.slice(0, 2).map(mark => ({ ...mark, bid: 1.9, ask: 2.1 }));
  const result = buildPositionPerformance(position, options, { response: [] }, range, f.now);
  expect(result.rows.map(row => row.combinedPnl)).toEqual([0, null]);
  expect(readPositionPerformance(result, position, range, f.now)).toEqual(result);
  let calls = 0;
  const closed = await loadPositionPerformance(f.position, { start: '2026-09-04', end: '2026-09-05' }, {}, async () => { calls++; return []; }, f.now);
  expect(calls).toBe(0); expect(closed.rows.map(row => row.combinedPnl)).toEqual([493, 493]);
});

it('defers executions after the accounting cutoff to the next date', () => {
  const f = fixture();
  f.position.transactions[0].at = f.position.transactions[0].recordedAt = '2026-09-02T21:15:00.001Z';
  const result = buildPositionPerformance(f.position, f.options, f.stock, f.range, f.now);
  expect(result.rows[2]).toMatchObject({ cutoff: '2026-09-02T21:15:00.000Z', grossRealizedPnl: 0, combinedPnl: 493 });
  expect(result.rows[2].lots).toHaveLength(2);
  expect(result.rows[3].lots).toHaveLength(3);
  expect(result.rows[3].grossRealizedPnl).toBe(100);
});

it('rejects overflowing daily changes even when both daily net values are finite', () => {
  const f = fixture(), state = structuredClone(f.position.legacy.initial);
  state.legs = []; state.stock = { shares: 1, entryPrice: 1e308 }; state.feeAllowance = 0;
  const at = '2026-09-02T12:00:00.000Z';
  const position = recordLotTransaction(upgradePositionLots(createPosition(state)), { id: 'flip', at, recordedAt: at,
    closes: [{ id: 'long-exit', lotId: 'initial:stock', quantity: 1, price: 1e308 }],
    opens: [{ id: 'short', side: 'short', quantity: 1, entryPrice: 1e308, asset: { kind: 'stock', symbol: state.underlying } }],
  });
  const stock = { response: f.stock.response.slice(0, 2) };
  expect(() => buildPositionPerformance(position, [], stock, { start: '2026-09-01', end: '2026-09-02' }, f.now)).toThrow(/change exceeds numeric range/);
});
