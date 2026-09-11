import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { App } from '../src/App'
import { CandidateSearch } from '../src/CandidateSearch'
import { createStrategy, type MarketSnapshot } from '../src/options'

afterEach(() => vi.unstubAllGlobals())
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
})

it('prefills an explicit optimizer target without changing the held scenario', () => {
  const state = createStrategy('bull-call'), before = structuredClone(state)
  const snapshot: MarketSnapshot = { id: 'prefill', underlying: 'SPY', source: 'Tastytrade', retrievedAt: state.valuationTimestamp, spot: state.spot, spotAsOf: state.valuationTimestamp, contracts: [], availableExpiries: [] }
  const html = renderToStaticMarkup(<CandidateSearch state={state} snapshot={snapshot} disabled={false} onSearch={() => { throw new Error('Unexpected search') }} onInspect={() => { throw new Error('Unexpected apply') }} renderComparison={() => null} expanded initialTarget={{ targetSpot: 108, targetDate: '2026-09-10T18:30:00.123Z' }} />)
  expect(html).toContain('<details open="">')
  expect(html).toContain('value="108"')
  expect(html).toContain('value="2026-09-10T18:30:00.123"')
  expect(html).toContain('Find strategies')
  expect(state).toEqual(before)
})
