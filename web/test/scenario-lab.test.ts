import { expect, it } from 'vitest'
import { assertLabPosition, createLabPosition, labScenarios, labThesisFit, readLabDraft, optimizeLab } from '../src/scenario-lab-model'
import { calculateStrategy, evaluateScenario, validateStrategy, LAB_SAMPLE_EXPIRIES, SAMPLE_EXPIRIES, sampleContractId } from '../src/options'

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
