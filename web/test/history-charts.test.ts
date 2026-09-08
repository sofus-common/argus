import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HistoryCharts } from '../src/HistoryCharts'

describe('paired history charts', () => {
  it('shows individual-contract IV percentages with gaps, zero and no monetary or AI semantics', () => {
    const rows = [.25, null, 0].map((value, i) => ({ label: `13:${30 + i * 5} UTC`, value, underlying: null }));
    const html = renderToStaticMarkup(createElement(HistoryCharts, { rows, selected: 2, intraday: true, ivLabel: 'SPY call 770', onInspect() {} }));
    expect(html).toContain('25.00%'); expect(html).toContain('0.00%'); expect(html).toContain('SPY call 770');
    expect(html).toContain('Inspect history interval'); expect(html).toContain('Historical option implied volatility');
    expect(html).not.toMatch(/USD|\$|Inventory|Underlying|discussion|NaN|Infinity/);
    const paths = [...html.matchAll(/class="history-line" d="([^"]*)"/g)].map(match => match[1]);
    expect(paths).toHaveLength(2); expect(paths.every(path => !path.includes('L'))).toBe(true);
  });
  it('offers an explicitly labeled normalized price without replacing total inventory', () => {
    const rows = [{ label: '13:30 UTC', value: 252, underlying: 770, envelope: { low: 248, high: 256 } }]
    const html = renderToStaticMarkup(createElement(HistoryCharts, { rows, selected: 0, priceScale: 200, onInspect() {} }))
    expect(html).toContain('Strategy price')
    expect(html).toContain('$1.26')
    expect(html).toContain('$252.00')
    expect(html).toContain('$770.00')
  })
  it('breaks missing sessions, retains signed values and exposes a shared native inspector', () => {
    const rows = [-20, null, 0].map((value, i) => ({ label: `2026-09-0${i + 1}`, underlying: value === null ? null : 100, value, ...(value === null ? {} : { envelope: { low: value - 10, high: value + 10 } }) }))
    const html = renderToStaticMarkup(createElement(HistoryCharts, { rows, selected: 0, onInspect() {} }))
    expect(html).toContain('Historical strategy value')
    expect(html).toContain('Historical underlying price')
    expect(html).toContain('Inspect history date')
    expect(html).toContain('-$20.00')
    expect(html).toContain('-$30.00')
    expect(html).toContain('data-history-segment="0"')
    expect(html).toContain('data-history-segment="2"')
    const paths = [...html.matchAll(/class="history-line" d="([^"]*)"/g)].map(match => match[1])
    expect(paths).toHaveLength(4)
    expect(paths.every(path => path.startsWith('M') && !path.includes('L'))).toBe(true)
    expect(html).not.toMatch(/NaN|Infinity/)
    const gap = renderToStaticMarkup(createElement(HistoryCharts, { rows, selected: 1, onInspect() {} }))
    expect(gap).toContain('Unavailable')
    for (const subset of [[], [rows[2]], [rows[1]]]) {
      const rendered = renderToStaticMarkup(createElement(HistoryCharts, { rows: subset, selected: 8, onInspect() {} }))
      expect(rendered).not.toMatch(/NaN|Infinity/)
      if (!subset.some(row => row.value !== null || row.underlying !== null)) expect(rendered).not.toContain('class="history-grid"')
    }
  })
  it('renders intraday zero and signed values without a quote envelope and preserves independent gaps', () => {
    const rows = [{ label: '13:30 UTC', value: 0, underlying: 770 }, { label: '13:35 UTC', value: null, underlying: 771 }, { label: '13:40 UTC', value: -100, underlying: null }]
    const html = renderToStaticMarkup(createElement(HistoryCharts, { rows, selected: 0, intraday: true, stockTrades: true, onInspect() {} }))
    expect(html).toContain('$0.00'); expect(html).toContain('-$100.00'); expect(html).toContain('Last trade'); expect(html).toContain('Inspect history interval')
    expect(html).not.toContain('class="history-envelope"'); expect(html).not.toContain('class="history-interval"'); expect(html).not.toContain('Quote sides'); expect(html).not.toMatch(/NaN|Infinity/)
    const paths = [...html.matchAll(/class="history-line" d="([^"]*)"/g)].map(match => match[1])
    expect(paths).toHaveLength(3); expect(paths[0]).not.toContain('L'); expect(paths[1]).not.toContain('L'); expect(paths[2]).toContain('L')
  })
})
