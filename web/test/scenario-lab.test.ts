import { expect, it } from 'vitest'
import { assertLabPosition, createLabPosition, labScenarios, labThesisFit, readLabDraft } from '../src/scenario-lab-model'
import { evaluateScenario, validateStrategy } from '../src/options'

it('uses real engine results and keeps later scenarios inside expiry', () => {
  const state = createLabPosition()
  expect(validateStrategy(state)).toEqual([])
  const scenarios = labScenarios(state, 103, '2026-09-10T20:00:00.000Z')
  expect(scenarios[2].state.scenarioDate).toBe(state.legs[0].expiry)
  expect(scenarios[2].pnl).toBe(100)
  expect(evaluateScenario({ ...state, scenarioSpot: 101, scenarioDate: state.legs[0].expiry }).pnl).toBe(-100)
  expect(scenarios.every(s => Date.parse(s.state.scenarioDate) <= Date.parse(state.legs[0].expiry))).toBe(true)
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
