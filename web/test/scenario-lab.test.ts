import { expect, it } from 'vitest'
import { assertLabPosition, createLabPosition, labScenarios } from '../src/scenario-lab-model'
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

it('rejects invalid inputs rather than silently evaluating an invented scenario', () => {
  const state = createLabPosition()
  expect(() => labScenarios(state, NaN, state.scenarioDate)).toThrow()
  expect(() => labScenarios(state, 103, '2026-10-01T20:00:00.000Z')).toThrow()
  expect(() => assertLabPosition({ ...state, spot: 120 })).toThrow()
  expect(() => assertLabPosition({ ...state, stock: { shares: 100, entryPrice: 100 } })).toThrow()
  expect(() => assertLabPosition({ ...state, legs: state.legs.map((leg, i) => ({ ...leg, contracts: i + 1 })) })).toThrow()
})
