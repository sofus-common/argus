import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { FirstExpiryBreakevens } from '../src/App'
import { createStrategy, firstExpiryBreakevens } from '../src/options'

it('allows retry on remount with orphaned pending state and hides results from another position', () => {
  const state = createStrategy('call-calendar')
  const props = { state, min: 50, max: 150, onResult() {} }
  const pending = renderToStaticMarkup(createElement(FirstExpiryBreakevens, { ...props, result: { source: state } }))
  expect(pending).toContain('Find first-expiry breakevens')
  expect(pending).not.toContain('disabled')
  const value = firstExpiryBreakevens(state, { min: 50, max: 150, spotTolerance: .01, maxEvaluations: 256 })
  const current = renderToStaticMarkup(createElement(FirstExpiryBreakevens, { ...props, result: { source: state, value } }))
  expect(current).toContain('Calculation assumptions')
  const stale = renderToStaticMarkup(createElement(FirstExpiryBreakevens, { ...props, result: { source: { ...state }, value } }))
  expect(stale).not.toContain('Calculation assumptions')
})
