import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LabRiskPanels } from '../src/lab-risk-panels'
import { createLabPosition } from '../src/scenario-lab-model'
import { createMarketStrategy, type MarketSnapshot } from '../src/options'

it('labels sample execution and unknown terms without inventing quotes', () => {
  const position = createLabPosition(), before = structuredClone(position)
  const html = renderToStaticMarkup(<LabRiskPanels position={position} scenario={position}/>)
  expect(html).toContain('synthetic premiums are not market quotes')
  expect(html).toContain('Terms unavailable')
  expect(html).toContain('Not a forecast or historical win rate')
  expect(position).toEqual(before)
})

it('separates dated execution from an inspected scenario without changing held entries', () => {
  const sample = createLabPosition()
  const snapshot: MarketSnapshot = { id: 'risk-test', underlying: 'SPY', source: 'Tastytrade', retrievedAt: sample.valuationTimestamp, spot: 100, spotAsOf: sample.valuationTimestamp, availableExpiries: [sample.legs[0].expiry.slice(0, 10)], contracts: sample.legs.map(leg => ({ contractId: leg.contractId.replace('SPY', 'SPY   '), type: leg.type, strike: leg.strike, expiry: leg.expiry, multiplier: 100, bid: leg.entryPrice - .1, ask: leg.entryPrice + .1, iv: leg.iv, quoteAsOf: sample.valuationTimestamp })) }
  const position = createMarketStrategy('bull-call', snapshot)
  const before = structuredClone(position)
  const html = renderToStaticMarkup(<LabRiskPanels position={position} scenario={{ ...position, scenarioSpot: 104 }} snapshot={snapshot}/>)
  expect(html).toContain('Dated quote P/L')
  expect(html).toContain('Scenario-model P/L')
  expect(html).toContain('Option spread width')
  expect(html).toContain('not measured mispricing')
  expect(html).toContain('$104.00')
  expect(position).toEqual(before)
})
