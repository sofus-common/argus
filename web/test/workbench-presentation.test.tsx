import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { App } from '../src/App'
import { CandidateSearch, checkSearch } from '../src/CandidateSearch'
import { ExpiryPlot } from '../src/scenario-lab-optimizer'
import { candidateStrategyFamily, createMarketStrategy, createStrategy, searchCandidates, type MarketSnapshot } from '../src/options'
import * as valuationClient from '../src/workspace-valuation-client'
import { calculateWorkspaceValuation } from '../src/workspace-valuation'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('keeps the compact view on the root state owner without replacing the original layout', () => {
  vi.stubGlobal('window', { location: { search: '' } })
  const original = renderToStaticMarkup(<App />)
  const compact = renderToStaticMarkup(<App presentation="workbench" />)
  expect(original).not.toContain('integrated-workbench')
  expect(compact).toContain('integrated-workbench')
  expect(compact).toContain('Change strategy')
  expect(compact.indexOf('Your thesis')).toBeLessThan(compact.indexOf('Strategy chart'))
  for (const label of ['Underlying symbol', 'Undo', 'Saved positions', 'Ask ARGUS', 'Heatmap', 'Greeks by leg']) {
    expect(original).toContain(label)
    expect(compact).toContain(label)
  }
  expect(compact.match(/id="trade-thesis"/g)).toHaveLength(1)
  expect(compact).toContain('Thesis target price')
  expect(compact).toContain('Thesis horizon UTC')
  expect(compact).toContain('Optimize trade')
  expect(compact).toContain('Workbench and optimizer')
  expect(original).not.toContain('Workbench and optimizer')
})

it('scales the shared expiry plot to market levels and labels cash-index units', () => {
  const state = createStrategy('long-call')
  state.spot = 760; state.scenarioSpot = 770
  state.legs[0].strike = 765
  state.legs[0].contractId = 'SPY   260918C00765000'
  state.pricing = { mode: 'market', snapshotId: 'plot', basis: 'mid' }
  const html = renderToStaticMarkup(<ExpiryPlot state={state} referenceSpot={760} />)
  expect(html).toContain('prices 722 to 836')
  expect(html).not.toContain('prices 95')
  const index = renderToStaticMarkup(<ExpiryPlot state={{ ...state, underlying: 'XSP', underlyingKind: 'cash-index', legs: state.legs.map(leg => ({ ...leg, contractId: leg.contractId.replace('SPY', 'XSP') })) }} referenceSpot={760} />)
  expect(index).toContain('Index level at expiry (points)')
  expect(index).not.toContain('Underlying price at expiry ($)')
})

it('prefills an explicit optimizer target without changing the held scenario', () => {
  const state = createStrategy('bull-call'), before = structuredClone(state)
  const snapshot: MarketSnapshot = { id: 'prefill', underlying: 'SPY', source: 'Tastytrade', retrievedAt: state.valuationTimestamp, spot: state.spot, spotAsOf: state.valuationTimestamp, contracts: [], availableExpiries: [] }
  const html = renderToStaticMarkup(<CandidateSearch state={state} snapshot={snapshot} disabled={false} onSearch={() => { throw new Error('Unexpected search') }} onInspect={() => { throw new Error('Unexpected apply') }} renderComparison={() => null} expanded initialTarget={{ targetSpot: 108, targetDate: '2026-09-10T18:30:00.123Z' }} />)
  expect(html).toContain('<details open="">')
  expect(html).toContain('value="108"')
  expect(html).toContain('value="2026-09-10T18:30:00.123"')
  expect(html).toContain('Find strategies')
  expect(html).toContain('Best per strategy family')
  expect(html).toContain('Top five overall')
  expect(state).toEqual(before)
})

it('validates grouped search counts and distinct families without weakening legacy results', async () => {
  const expiry = '2026-09-18T20:00:00.000Z'
  const snapshot: MarketSnapshot = {
    id: 'grouped-validation', underlying: 'SPY', source: 'Tastytrade', retrievedAt: '2026-09-05T12:00:00.000Z', spot: 100, spotAsOf: '2026-09-04T20:00:00.000Z', availableExpiries: [expiry.slice(0, 10)],
    contracts: [90, 95, 100, 105, 110].flatMap(strike => (['call', 'put'] as const).map(type => ({ contractId: `SPY   260918${type === 'call' ? 'C' : 'P'}${String(strike * 1000).padStart(8, '0')}`, type, strike, expiry, multiplier: 100 as const, bid: 2, ask: 3, iv: .25, quoteAsOf: '2026-09-04T20:00:00.000Z' }))),
  }
  const state = createMarketStrategy('bull-call', snapshot)
  const input = { targetSpot: 103, targetDate: expiry, maxLoss: 10000, feeAllowance: 5, basis: 'natural' as const, objective: 'target-pnl' as const }
  const domain = { families: ['options' as const], maxEntryOutlay: 10000, resultMode: 'best-per-family' as const }
  const result = searchCandidates(state, snapshot, input, domain), signal = new AbortController().signal
  vi.spyOn(valuationClient, 'requestWorkspaceValuation').mockImplementation(async next => calculateWorkspaceValuation(next))
  expect(result.candidates.length).toBeGreaterThan(1)
  await expect(checkSearch(result, state, snapshot, input, domain, signal)).resolves.toEqual(result)
  for (const count of [-1, .5, 26, result.eligibleFamilies! + 1]) {
    await expect(checkSearch({ ...result, eligibleFamilies: count }, state, snapshot, input, domain, signal)).rejects.toThrow(/coverage/)
  }
  const calls = searchCandidates(state, snapshot, input, { families: ['long-call'], maxEntryOutlay: 10000 }).candidates
  const duplicate = structuredClone(result)
  const alternate = calls.find(candidate => !duplicate.candidates.some(existing => existing.id === candidate.id))!
  expect(alternate).toBeDefined()
  duplicate.candidates[duplicate.candidates.findIndex(candidate => candidateStrategyFamily(candidate.state) !== 'long-call')] = alternate
  duplicate.candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  await expect(checkSearch(duplicate, state, snapshot, input, domain, signal)).rejects.toThrow('Search repeats a strategy family.')
  const legacyDomain = { families: ['options' as const], maxEntryOutlay: 10000 }
  const legacy = searchCandidates(state, snapshot, input, legacyDomain)
  await expect(checkSearch(legacy, state, snapshot, input, legacyDomain, signal)).resolves.toEqual(legacy)
  await expect(checkSearch({ ...legacy, eligibleFamilies: legacy.candidates.length }, state, snapshot, input, legacyDomain, signal)).rejects.toThrow('Search family coverage is invalid.')
})
