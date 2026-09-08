import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { OptionChainTable } from '../src/OptionChainTable'
import { createStrategy, type MarketSnapshot } from '../src/options'

it('renders zero, unreported and unquoted counts distinctly without mixing expiries', () => {
  const snapshot: MarketSnapshot = {
    id: 'activity', source: 'Tastytrade', underlying: 'SPY', spot: 100,
    retrievedAt: '2026-09-06T12:00:00.000Z', spotAsOf: '2026-09-04T20:00:00.000Z',
    availableExpiries: ['2026-09-08', '2026-09-09'],
    contracts: ['2026-09-08', '2026-09-09'].map((date, index) => ({
      contractId: `SPY   ${date.slice(2).replaceAll('-', '')}C00100000`,
      type: 'call', strike: 100, expiry: `${date}T20:00:00.000Z`, multiplier: 100,
      bid: 2, ask: 3, iv: .3, quoteAsOf: '2026-09-04T20:00:00.000Z', volume: index ? 999 : 0,
    })),
  }
  const render = () => renderToStaticMarkup(createElement(OptionChainTable, {
    state: createStrategy('long-call'), snapshot, comparisonPending: false,
    onSelect() {}, onAdd() {}, onCompare() {}, onDiscussActivity() {},
  })).split('<div class="chain-table-controls">')[0]
  const original = JSON.stringify(snapshot)
  const zero = render()
  expect(zero).toContain('Call volume: <b>0</b>')
  expect(zero).toContain('Put volume: <b>not quoted</b>')
  expect(zero).toContain('1 quoted contracts · 0 missing reported counts')
  expect(zero).not.toContain('999')
  expect(zero).not.toMatch(/NaN|Infinity/)
  expect(JSON.stringify(snapshot)).toBe(original)
  delete snapshot.contracts[0].volume
  expect(render()).toContain('Call volume: <b>unavailable (not reported)</b>')
  expect(render()).toContain('1 quoted contracts · 1 missing reported counts')
})
