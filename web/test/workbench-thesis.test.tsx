import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkbenchThesis, buildThesisScenario, thesisDateUtc } from '../src/WorkbenchThesis'
import { createStrategy, projectAnalysisPosition, mergeAnalysisProposal, validateConstruction } from '../src/options'

it('preserves user thesis across proposals and permits a stored horizon that is no longer testable', () => {
  const state = createStrategy('long-call')
  state.thesis = { text: 'My view', targetSpot: 105, targetDate: '2026-08-01T20:00:00.000Z' }
  expect(validateConstruction(state)).toEqual([])
  expect(buildThesisScenario(state, 105, state.thesis.targetDate!).scenario).toBeNull()
  const proposal = { ...state, version: state.version + 1, thesis: { ...state.thesis, text: 'Model replacement' } }
  expect(mergeAnalysisProposal(state, proposal).thesis).toEqual(state.thesis)
})

it('normalizes native datetime input as UTC and rejects rolled-over or noncanonical dates', () => {
  expect(thesisDateUtc('2026-09-10T12:30')).toBe('2026-09-10T12:30:00.000Z')
  expect(thesisDateUtc('2026-09-10T12:30:15.2')).toBe('2026-09-10T12:30:15.200Z')
  for (const value of ['', '2026-02-30T12:30', '2026-09-10T24:00', '2026-09-10', '2026-09-10T12:30Z', '2026-09-10T12:30+02:00']) expect(thesisDateUtc(value)).toBe('')
})

it('accepts the inclusive valuation and first expiry boundaries, rejects outside or invalid targets', () => {
  const state = createStrategy('call-diagonal')
  const expiry = state.legs.map(leg => leg.expiry).sort()[0]
  for (const target of [.001, 1_000_000]) for (const date of [state.valuationTimestamp, expiry]) expect(buildThesisScenario(state, target, date).scenario).not.toBeNull()
  for (const target of [0, .0009, 1_000_001, Infinity, NaN]) expect(buildThesisScenario(state, target, expiry).scenario).toBeNull()
  for (const date of [new Date(Date.parse(state.valuationTimestamp) - 1).toISOString(), new Date(Date.parse(expiry) + 1).toISOString(), '2026-09-01T20:00:00Z', '2026-09-01T22:00:00.000+02:00', '2026-02-30T12:00:00.000Z', 'invalid']) expect(buildThesisScenario(state, 105, date).scenario).toBeNull()
})

it('requires projected included options and preserves every held cost, assumption and version', () => {
  const state = { ...createStrategy('covered-call'), version: 7, feeAllowance: 4.5 }
  const before = structuredClone(state)
  const preview = buildThesisScenario(state, 110, state.legs[0].expiry).scenario!
  expect(preview).toEqual({ ...state, scenarioSpot: 110, scenarioDate: state.legs[0].expiry })
  preview.legs[0].entryPrice = 999
  preview.stock!.entryPrice = 999
  expect(state).toEqual(before)
  const excluded = { ...state, excludedLegIds: [state.legs[0].id] }
  expect(buildThesisScenario(excluded, 110, state.scenarioDate).scenario).toBeNull()
  expect(buildThesisScenario(projectAnalysisPosition(excluded), 110, state.scenarioDate).scenario).toBeNull()
  expect(buildThesisScenario(null, 110, state.scenarioDate).scenario).toBeNull()
  const diagonal = createStrategy('call-diagonal')
  const included = projectAnalysisPosition({ ...diagonal, excludedLegIds: [diagonal.legs[0].id] })!
  expect(buildThesisScenario(included, 110, included.legs[0].expiry).scenario?.legs).toEqual([diagonal.legs[1]])
})

it('revalues a compatible changed source at the same thesis and fails closed after its horizon changes', () => {
  const state = createStrategy('long-call')
  const date = state.legs[0].expiry
  const changed = { ...state, version: 2, feeAllowance: 9, scenarioSpot: 90 }
  expect(buildThesisScenario(changed, 110, date).scenario).toEqual({ ...changed, scenarioSpot: 110, scenarioDate: date })
  expect(buildThesisScenario({ ...changed, valuationTimestamp: new Date(Date.parse(date) + 1).toISOString() }, 110, date).scenario).toBeNull()
})

it('starts blank with both actions disabled, UTC bounds and no preview chart', () => {
  const state = createStrategy('long-call')
  const html = renderToStaticMarkup(<WorkbenchThesis state={state} onChange={() => { throw new Error('Unexpected edit') }} optimizeEnabled onOptimize={() => { throw new Error('Unexpected action') }} />)
  expect(html.match(/disabled=""/g)).toHaveLength(2)
  expect(html).toContain('type="datetime-local"')
  expect(html).toContain(`min="${state.valuationTimestamp.slice(0, -1)}"`)
  expect(html).toContain(`max="${state.legs[0].expiry.slice(0, -1)}"`)
  expect(html).toContain('saved with the position')
  expect(html).not.toContain('Thesis preview')
  expect(html).not.toContain('<svg')
})
