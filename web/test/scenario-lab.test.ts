import { expect, it } from 'vitest'
import { assertLabPosition, createLabPosition, labScenarios, labThesisFit, readLabDraft, optimizeLab } from '../src/scenario-lab-model'
import { calculateStrategy, evaluateScenario, validateStrategy } from '../src/options'

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
  expect(result.searched).toBe(120)
  expect(result.candidates).toHaveLength(3)
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
  expect(result.candidates).toHaveLength(3)
  result.candidates.forEach((c, i) => {
    expect(c.maxLoss).toBeCloseTo(calculateStrategy(c.state).maxLoss!, 6)
    expect(c.maxLoss).toBeCloseTo(c.debit + 12, 6)
    expect(c.returnOnRisk).toBeCloseTo(c.pnl / c.maxLoss, 6)
    if (i) expect(result.candidates[i - 1].returnOnRisk!).toBeGreaterThanOrEqual(c.returnOnRisk!)
  })
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
