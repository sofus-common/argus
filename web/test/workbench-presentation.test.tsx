import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { App } from '../src/App'

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
})
