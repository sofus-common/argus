import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { App } from '../src/App'
import { CandidateSearch, checkSearch, outlookPreset } from '../src/CandidateSearch'
import { ExpiryPlot, ExpiryStrip } from '../src/scenario-lab-optimizer'
import { candidateStrategyFamily, createMarketStrategy, createStrategy, searchCandidates, type MarketSnapshot } from '../src/options'
import * as valuationClient from '../src/workspace-valuation-client'
import { calculateWorkspaceValuation } from '../src/workspace-valuation'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('opens optimizer navigation and renders controls without allowing unquoted search', () => {
  vi.stubGlobal('window', { location: { search: '' } })
  const app = renderToStaticMarkup(<App presentation="workbench" />)
  expect(app).toMatch(/<button[^>]*>Optimize<\/button>/)
  expect(app).not.toMatch(/<button[^>]*disabled[^>]*>Optimize<\/button>/)
  const html = renderToStaticMarkup(<CandidateSearch state={createStrategy('bull-call')} disabled={false} expanded onSearch={() => { throw new Error('Unexpected search') }} onInspect={() => { throw new Error('Unexpected inspect') }} renderComparison={() => null} />)
  expect(html).toContain('Quotes unavailable')
  expect(html).toContain('Market outlook')
  expect(html).toContain('verified-risk compact-optimizer')
  expect(html).toContain('<details class="quoted-families"><summary>Search families')
  expect(html).toContain('<details class="quoted-method"><summary>Mixed-expiry risk and model limits')
  expect(html).toContain('Return / chance blend')
  expect(html).toContain('0 loaded quoted expiries')
  expect(html).toContain('<button type="submit" disabled="">Find strategies</button>')
  expect(html).not.toContain('DATED QUOTES')
})
it('uses explicit outlook presets including two-sided move targets without inferring forecasts', () => {
  expect(outlookPreset('Bullish', 200)).toEqual({ target: 206, families: ['long-call', 'bull-call', 'bull-put'] })
  expect(outlookPreset('Very bullish', 200)?.target).toBe(212)
  expect(outlookPreset('Bearish', 200)).toEqual({ target: 194, families: ['long-put', 'bear-call', 'bear-put'] })
  expect(outlookPreset('Very bearish', 200)?.target).toBe(188)
  expect(outlookPreset('Neutral', 200)?.target).toBe(200)
  expect(outlookPreset('Either direction', 200)).toEqual({ target: 212, lowerTarget: 188, families: ['long-straddle', 'long-strangle', 'inverse-iron-butterfly', 'inverse-iron-condor'] })
  for (const [label, spot] of [['unknown', 200], ['Bullish', 1000000], ['Bullish', NaN], ['Bearish', 0]] as const) expect(outlookPreset(label, spot)).toBeNull()
})
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

it('reuses the expiry strip with quoted dates, bounded choices and no form submissions', () => {
  const html = renderToStaticMarkup(<ExpiryStrip quoted expiry="" dates={['2026-09-11T20:00:00.000Z', '2026-10-16T20:00:00.000Z']} minDate="2026-09-18T20:00:00.000Z" onChange={() => { throw new Error('Unexpected selection') }} />)
  expect(html).toContain('All quoted expiries')
  expect(html).toContain('2 loaded quoted expiries')
  expect(html).toContain('disabled="" title="Before target horizon" aria-label="Expiry Sep 11, 2026"')
  expect(html.match(/type="button"/g)).toHaveLength(4)
  expect(html).not.toContain('sample')
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
  expect(html).toContain('Market outlook')
  expect(html).toContain('Either direction')
  expect(html).toContain('First / short expiry')
  expect(html).toContain('<option value="balanced">Return / chance blend</option>')
  expect(html).toContain('<option value="target-pnl" selected="">')
  expect(state).toEqual(before)
})

it('offers the provider expiry catalog for explicit retained-position quote loading', () => {
  const state = createStrategy('bull-call')
  const snapshot: MarketSnapshot = { id: 'catalog', underlying: 'SPY', source: 'Tastytrade', retrievedAt: state.valuationTimestamp, spot: 100, spotAsOf: state.valuationTimestamp, contracts: [], availableExpiries: ['2026-09-18', '2026-12-18'] }
  const html = renderToStaticMarkup(<CandidateSearch state={state} snapshot={snapshot} disabled={false} expanded onLoadQuotes={async () => { throw new Error('Must be explicit') }} onSearch={() => {}} onInspect={() => {}} renderComparison={() => null} />)
  expect(html).toContain('Load another quote window')
  expect(html).toContain('2026-12-18')
  expect(html).toContain('Optimizer quote expiry 4')
  expect(html).toContain('Load quotes · keep position')
  expect(html).toContain('held entry costs stay fixed')
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
  const datedDomain = { ...domain, expiry }
  const dated = searchCandidates(state, snapshot, input, datedDomain)
  await expect(checkSearch(dated, state, snapshot, input, datedDomain, signal)).resolves.toEqual(dated)
  const twoSidedInput = { ...input, targetSpot: 110, lowerTargetSpot: 90, objective: 'two-sided-pnl' as const }
  const twoSided = searchCandidates(state, snapshot, twoSidedInput, datedDomain)
  await expect(checkSearch(twoSided, state, snapshot, twoSidedInput, datedDomain, signal)).resolves.toEqual(twoSided)
  for (const field of ['downsidePnl', 'score'] as const) {
    const changed = structuredClone(twoSided); changed.candidates[0][field]! += .01
    await expect(checkSearch(changed, state, snapshot, twoSidedInput, datedDomain, signal)).rejects.toThrow(/reconciled/)
  }
  for (const lowerTargetSpot of [0, 100, 101, NaN, undefined]) await expect(checkSearch(twoSided, state, snapshot, { ...twoSidedInput, lowerTargetSpot }, datedDomain, signal)).rejects.toThrow(/constraints/)
  await expect(checkSearch({ ...twoSided, request: { ...twoSidedInput, lowerTargetSpot: 89 } }, state, snapshot, twoSidedInput, datedDomain, signal)).rejects.toThrow(/request/)
  const blendedInput = { ...input, objective: 'balanced' as const, chanceWeight: 50 }
  const blended = searchCandidates(state, snapshot, blendedInput, datedDomain)
  await expect(checkSearch(blended, state, snapshot, blendedInput, datedDomain, signal)).resolves.toEqual(blended)
  const roundoff = structuredClone(blended)
  roundoff.candidates.forEach(candidate => { candidate.probability.probability! += 1.2e-13; candidate.score += 1.2e-13 })
  await expect(checkSearch(roundoff, state, snapshot, blendedInput, datedDomain, signal)).resolves.toEqual(roundoff)
  for (const mutate of [(candidate: typeof blended.candidates[number]) => { candidate.probability.probability! += 1e-9 }, (candidate: typeof blended.candidates[number]) => { candidate.probability.spot += 1 }, (candidate: typeof blended.candidates[number]) => { candidate.probability.probability = null }]) {
    const changed = structuredClone(blended); mutate(changed.candidates[0])
    await expect(checkSearch(changed, state, snapshot, blendedInput, datedDomain, signal)).rejects.toThrow(/ranking/)
  }
  const wrongScore = structuredClone(blended); wrongScore.candidates[0].score += .01
  await expect(checkSearch(wrongScore, state, snapshot, blendedInput, datedDomain, signal)).rejects.toThrow(/ranking/)
  await expect(checkSearch({ ...blended, request: { ...blendedInput, chanceWeight: 51 } }, state, snapshot, blendedInput, datedDomain, signal)).rejects.toThrow(/request/)
  for (const chanceWeight of [-1, 101, .5, NaN, undefined]) await expect(checkSearch(blended, state, snapshot, { ...blendedInput, chanceWeight }, datedDomain, signal)).rejects.toThrow(/constraints/)
  await expect(checkSearch(dated, state, snapshot, input, { ...datedDomain, expiry: '2026-10-16T20:00:00.000Z' }, signal)).rejects.toThrow('Invalid candidate search domain.')
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
