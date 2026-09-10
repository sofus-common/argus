import { expect, it } from 'vitest'
import { assertLabPosition, assertWorkbenchPosition, createLabPosition, labScenarios, labThesisFit, readLabDraft, optimizeLab } from '../src/scenario-lab-model'
import { calculateStrategy, createMarketStrategy, evaluateScenario, validateStrategy, LAB_SAMPLE_EXPIRIES, SAMPLE_EXPIRIES, sampleContractId, type MarketSnapshot } from '../src/options'

it('keeps market Workbench analysis and drafts separate from the synthetic optimizer', () => {
  const at = '2026-09-10T15:00:00.000Z', expiry = '2026-09-18T20:00:00.000Z'
  const snapshot: MarketSnapshot = { id: 'fixture-aapl', underlying: 'AAPL', source: 'Tastytrade', spot: 230, retrievedAt: at, spotAsOf: at, availableExpiries: ['2026-09-18'], contracts: [225,230,235].map(strike => ({ contractId: `AAPL  260918C${String(strike * 1000).padStart(8, '0')}`, type: 'call', strike, expiry, multiplier: 100, bid: 4, ask: 5, iv: .3, quoteAsOf: at })) }
  const state = createMarketStrategy('bull-call', snapshot)
  expect(() => assertWorkbenchPosition(state, snapshot)).not.toThrow()
  expect(() => assertWorkbenchPosition(state)).toThrow('quotes are required')
  expect(() => assertWorkbenchPosition(state, { ...snapshot, underlying: 'MSFT' })).toThrow()
  expect(() => assertWorkbenchPosition({ ...state, legs: state.legs.map(leg => ({ ...leg, entryPrice: 99 })) }, snapshot)).toThrow()
  expect(labThesisFit(state, '2026-09-18', snapshot).status).toBe('calculated')
  expect(labScenarios(state, 240, state.scenarioDate, snapshot)).toHaveLength(3)
  expect(() => optimizeLab(state, '2026-09-18', 300, 'profit')).toThrow()
  const draft = { schemaVersion: 1, state, snapshot, title: 'AAPL', thesis: 'AAPL rises', composer: '', savedAt: at }
  expect(readLabDraft(JSON.stringify({ version: 2, horizon: '2026-09-18', draft })).draft.state.underlying).toBe('AAPL')
  expect(() => readLabDraft(JSON.stringify({ ...draft, snapshot: null }))).toThrow()
})

it('rejects unsafe quantities and overflowing money before pricing, search or draft import', () => {
  for (const overrides of [{ contracts: 1e307 }, { contracts: Number.MAX_SAFE_INTEGER + 1 }, { entryPrice: 1e308 }, { entryPrice: 1e306 }]) {
    const source = createLabPosition()
    const state = { ...source, legs: source.legs.map(leg => ({ ...leg, ...overrides })) }
    expect(validateStrategy(state).length).toBeGreaterThan(0)
    expect(() => calculateStrategy(state)).toThrow()
    expect(() => evaluateScenario(state)).toThrow()
    expect(() => optimizeLab(state, '2026-09-10', 300, 'profit')).toThrow()
    const draft = { schemaVersion: 1, state, snapshot: null, title: 'Lab', thesis: '', composer: '', savedAt: source.valuationTimestamp }
    expect(() => readLabDraft(JSON.stringify(draft))).toThrow()
  }
  const extremeCarry = { ...createLabPosition(), rate: -1e308 }
  expect(() => evaluateScenario(extremeCarry)).toThrow('numerical range')
  expect(() => calculateStrategy(extremeCarry)).toThrow('numerical range')
})

it('matches hand-calculated six-family expiry fixtures, including quantity and costs', () => {
  const fixtures = [
    { family: 'Long call', terms: [['call', 'long', 100, 3, 1]], loss: 300, profit: null, roots: [103], slopes: [100] },
    { family: 'Bull call spread', terms: [['call', 'long', 100, 3, 1], ['call', 'short', 105, 1, 1]], loss: 200, profit: 300, roots: [102], slopes: [100] },
    { family: 'Bull put spread', terms: [['put', 'short', 105, 3, 1], ['put', 'long', 100, 1, 1]], loss: 300, profit: 200, roots: [103], slopes: [100] },
    { family: 'Covered call', terms: [['call', 'short', 105, 1, 1]], loss: 9900, profit: 600, roots: [99], slopes: [100] },
    { family: 'Cash-secured put', terms: [['put', 'short', 100, 2, 1]], loss: 9800, profit: 200, roots: [98], slopes: [100] },
    { family: 'Bullish call butterfly', terms: [['call', 'long', 95, 7, 1], ['call', 'short', 100, 3, 2], ['call', 'long', 105, 1, 1]], loss: 200, profit: 300, roots: [97, 103], slopes: [100, -100] },
  ] as const
  for (const fixture of fixtures) for (const quantity of [1, 3]) for (const fee of [0, 2]) {
    const source = createLabPosition()
    const state = { ...source, feeAllowance: fee, scenarioDate: source.legs[0].expiry,
      stock: fixture.family === 'Covered call' ? { shares: 100 * quantity, entryPrice: 100 } : undefined,
      legs: fixture.terms.map(([type, side, strike, entryPrice, ratio], index) => ({ ...source.legs[0], id: String(index), type, side, strike, entryPrice, contracts: quantity * ratio, contractId: sampleContractId(type, strike, source.legs[0].expiry) })),
    }
    assertLabPosition(state)
    const metrics = calculateStrategy(state)
    expect(metrics.maxLoss, fixture.family).toBe(fixture.loss * quantity + fee)
    expect(metrics.maxProfit, fixture.family).toBe(fixture.profit === null ? null : fixture.profit * quantity - fee)
    expect(metrics.breakevens).toHaveLength(fixture.roots.length)
    fixture.roots.forEach((root, index) => expect(metrics.breakevens[index]).toBeCloseTo(root + fee / (fixture.slopes[index] * quantity), 7))
    for (const spot of [0.01, 90, 95, 97, 100, 103, 105, 110, 1000]) {
      const shares = fixture.family === 'Covered call' ? (spot - 100) * 100 * quantity : 0
      const expected = fixture.terms.reduce((pnl, [type, side, strike, premium, ratio]) => pnl + (side === 'long' ? 1 : -1) * (Math.max(0, type === 'call' ? spot - strike : strike - spot) - premium) * ratio * quantity * 100, shares - fee)
      expect(evaluateScenario({ ...state, scenarioSpot: spot }).pnl, `${fixture.family} at ${spot}`).toBeCloseTo(expected, 7)
    }
  }
})

it('supports seven months of synthetic prototype expiries without changing default samples', () => {
  expect(SAMPLE_EXPIRIES).toHaveLength(2)
  expect(new Set(LAB_SAMPLE_EXPIRIES.map(date => date.slice(0, 7))).size).toBe(7)
  for (const expiry of LAB_SAMPLE_EXPIRIES) {
    const source = createLabPosition()
    const state = { ...source, legs: source.legs.map(leg => ({ ...leg, expiry, contractId: sampleContractId(leg.type, leg.strike, expiry) })) }
    expect(validateStrategy(state)).toEqual([])
    expect(Number.isFinite(evaluateScenario(state).pnl)).toBe(true)
  }
  const expiry = LAB_SAMPLE_EXPIRIES.at(-1)!
  const source = createLabPosition()
  const state = { ...source, legs: source.legs.map(leg => ({ ...leg, expiry, contractId: sampleContractId(leg.type, leg.strike, expiry) })) }
  expect(optimizeLab(state, '2027-03-12', 15000, 'profit', 15000).candidates.length).toBeGreaterThan(0)
})

it('uses real engine results and keeps later scenarios inside expiry', () => {
  const state = createLabPosition()
  expect(validateStrategy(state)).toEqual([])
  const scenarios = labScenarios(state, 103, '2026-09-10T20:00:00.000Z')
  expect(scenarios[2].state.scenarioDate).toBe(state.legs[0].expiry)
  expect(scenarios[2].pnl).toBe(100)
  expect(evaluateScenario({ ...state, scenarioSpot: 101, scenarioDate: state.legs[0].expiry }).pnl).toBe(-100)
  expect(scenarios.every(s => Date.parse(s.state.scenarioDate) <= Date.parse(state.legs[0].expiry))).toBe(true)
})

it('ranks a bounded synthetic search reproducibly without changing the draft', () => {
  const state = createLabPosition(), before = JSON.stringify(state)
  const result = optimizeLab(state, '2026-09-10', 300, 'profit')
  expect(result.searched).toBeGreaterThan(240)
  expect(result.candidates.map(c => c.family)).toEqual(expect.arrayContaining(['Long call', 'Bull call spread', 'Bull put spread', 'Bullish call butterfly']))
  expect(new Set(result.candidates.map(c => c.family)).size).toBe(result.candidates.length)
  expect(result).toEqual(optimizeLab(state, '2026-09-10', 300, 'profit'))
  expect(JSON.stringify(state)).toBe(before)
  result.candidates.forEach((c, i) => {
    expect(c.maxLoss).toBeLessThanOrEqual(300)
    expect(c.pnl).toBe(evaluateScenario(c.state).pnl)
    expect(validateStrategy(c.state)).toEqual([])
    if (i) expect(result.candidates[i - 1].pnl).toBeGreaterThanOrEqual(c.pnl)
  })
  expect(optimizeLab(state, '2026-09-10', .01, 'profit').candidates).toEqual([])
  expect(() => optimizeLab(state, '2026-10-01', 300, 'profit')).toThrow()
  expect(() => optimizeLab(state, '', 300, 'profit')).toThrow()
  expect(() => optimizeLab(state, '2026-09-10', NaN, 'profit')).toThrow()
})

it('ranks return on risk and includes the allowance in each exact loss bound', () => {
  const result = optimizeLab({ ...createLabPosition(), feeAllowance: 12 }, '2026-09-10', 300, 'return')
  expect(result.candidates.length).toBeGreaterThanOrEqual(4)
  result.candidates.forEach((c, i) => {
    expect(c.maxLoss).toBeCloseTo(calculateStrategy(c.state).maxLoss!, 6)
    expect(c.maxProfit).toBe(calculateStrategy(c.state).maxProfit)
    expect(c.breakevens).toEqual(calculateStrategy(c.state).breakevens)
    expect(c.returnOnRisk).toBeCloseTo(c.pnl / c.maxLoss, 6)
    if (i) expect(result.candidates[i - 1].returnOnRisk!).toBeGreaterThanOrEqual(c.returnOnRisk!)
  })
})

it('searches six families with separate risk and collateral gates and supports applying/restoring each', () => {
  const result = optimizeLab(createLabPosition(), '2026-09-10', 15000, 'profit', 15000)
  expect(result.candidates).toHaveLength(6)
  for (const c of result.candidates) {
    expect(() => assertLabPosition(c.state)).not.toThrow()
    expect(c.maxLoss).toBeCloseTo(calculateStrategy(c.state).maxLoss!, 6)
    const draft = { schemaVersion: 1, state: c.state, snapshot: null, title: 'Lab', thesis: '', composer: '', savedAt: '2026-09-09T20:00:00.000Z' }
    expect(readLabDraft(JSON.stringify(draft)).draft.state).toEqual(c.state)
    expect(optimizeLab(c.state, '2026-09-10', 15000, 'profit', 15000).current.family).toBe(c.family)
  }
  expect(result.candidates.find(c => c.family === 'Covered call')!.state.stock!.shares).toBe(100)
  const put = result.candidates.find(c => c.family === 'Cash-secured put')!
  expect(put.collateral).toBe(put.state.legs[0].strike * 100)
  expect(put.debit).toBeLessThan(0)
  expect(optimizeLab(createLabPosition(), '2026-09-10', 15000, 'profit', 0).candidates.some(c => c.collateral > 0)).toBe(false)
  expect(() => optimizeLab(createLabPosition(), '2026-09-10', 15000, 'profit', NaN)).toThrow()
})

it('keeps the thesis horizon independent and refuses post-expiry evaluation', () => {
  const state = createLabPosition()
  expect(labThesisFit(state, '2026-09-18').pnl).toBe(100)
  expect(labThesisFit(state, '2026-09-19').status).toBe('after-expiry')
  expect(labThesisFit(state, '2026-09-19').pnl).toBeNull()
  expect(labThesisFit(state, '').status).toBe('missing')
  expect(labThesisFit(state, '2026-08-31').status).toBe('invalid')
  expect(labThesisFit({ ...state, feeAllowance: 10 }, '2026-09-18').pnl).toBe(90)
})

it('restores old drafts and validates new horizon metadata before applying it', () => {
  const draft = { schemaVersion: 1, state: createLabPosition(), snapshot: null, title: 'Lab', thesis: 'My view', composer: '', savedAt: '2026-09-09T20:00:00.000Z' }
  expect(readLabDraft(JSON.stringify(draft)).horizon).toBe('')
  expect(readLabDraft(JSON.stringify({ version: 2, horizon: '2026-10-01', draft })).horizon).toBe('2026-10-01')
  expect(() => readLabDraft(JSON.stringify({ version: 2, horizon: '2026-02-30', draft }))).toThrow()
})

it('rejects invalid inputs rather than silently evaluating an invented scenario', () => {
  const state = createLabPosition()
  expect(() => labScenarios(state, NaN, state.scenarioDate)).toThrow()
  expect(() => labScenarios(state, 103, '2026-10-01T20:00:00.000Z')).toThrow()
  expect(() => assertLabPosition({ ...state, spot: 120 })).toThrow()
  expect(() => assertLabPosition({ ...state, stock: { shares: 100, entryPrice: 100 } })).toThrow()
  expect(() => assertLabPosition({ ...state, legs: state.legs.map((leg, i) => ({ ...leg, contracts: i + 1 })) })).toThrow()
})
