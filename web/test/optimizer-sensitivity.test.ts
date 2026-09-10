import { expect, it } from 'vitest'
import { optimizerSensitivity } from '../src/optimizer-sensitivity'
import { createStrategy, marketLeg, type MarketSnapshot } from '../src/options'

function quoted() {
  const source = createStrategy('bull-call')
  source.legs = source.legs.map(leg => ({ ...leg, contractId: `SPY   ${leg.expiry.slice(2, 10).replaceAll('-', '')}${leg.type === 'call' ? 'C' : 'P'}${String(leg.strike * 1000).padStart(8, '0')}` }))
  const snapshot: MarketSnapshot = { id: 'sensitivity', source: 'Tastytrade', underlying: source.underlying, spot: source.spot, spotAsOf: source.valuationTimestamp, retrievedAt: source.valuationTimestamp, availableExpiries: [source.legs[0].expiry.slice(0, 10)], contracts: source.legs.map(leg => ({ contractId: leg.contractId, type: leg.type, strike: leg.strike, expiry: leg.expiry, multiplier: 100 as const, bid: leg.entryPrice, ask: leg.entryPrice + 1, iv: leg.iv, quoteAsOf: source.valuationTimestamp })) }
  const state = { ...source, scenarioSpot: 103, feeAllowance: 7, pricing: { mode: 'market' as const, basis: 'mid' as const, snapshotId: snapshot.id }, legs: source.legs.map((leg, index) => marketLeg(snapshot.contracts[index], leg.side, 2, leg.id)) }
  return { state, snapshot }
}

it('compares identical quoted structures at midpoint and natural, with costs once and no mutation', () => {
  const { state, snapshot } = quoted(), before = structuredClone({ state, snapshot })
  const result = optimizerSensitivity(state, snapshot)
  const [mid, natural] = result.entries!
  expect(natural.pnl).toBeCloseTo(mid.pnl - 200, 8)
  expect(natural.pnl).toBeLessThanOrEqual(mid.pnl)
  expect(mid.state.legs.map(leg => [leg.contractId, leg.side, leg.contracts])).toEqual(natural.state.legs.map(leg => [leg.contractId, leg.side, leg.contracts]))
  const free = optimizerSensitivity({ ...state, feeAllowance: 0 }, snapshot)
  expect(free.baseline.pnl - result.baseline.pnl).toBeCloseTo(7, 8)
  result.scenarios.forEach((scenario, index) => expect(free.scenarios[index].pnl! - scenario.pnl!).toBeCloseTo(7, 8))
  free.entries!.forEach((entry, index) => expect(entry.pnl - result.entries![index].pnl).toBeCloseTo(7, 8))
  expect({ state, snapshot }).toEqual(before)
  const held = { ...state, pricing: { ...state.pricing, entryMode: 'fixed' as const }, legs: state.legs.map(leg => ({ ...leg, entryPrice: 10 })) }
  expect(optimizerSensitivity(held, snapshot).entries).toEqual(result.entries)
})

it('keeps stress dates within the first expiry and synthetic fill comparison unavailable', () => {
  const state = { ...createStrategy('bull-call'), scenarioSpot: 106 }
  const result = optimizerSensitivity(state)
  expect(result.entries).toBeNull()
  expect(result.scenarios.find(row => row.name === 'Adverse move')!.state.scenarioSpot).toBe(94)
  expect(result.scenarios.find(row => row.name === 'Smaller move')!.state.scenarioSpot).toBe(102)
  expect(result.scenarios.find(row => row.name === 'At first expiry')!.state.scenarioDate).toBe(state.legs[0].expiry)
  expect(result.scenarios.every(row => Date.parse(row.state.scenarioDate) <= Date.parse(state.legs[0].expiry))).toBe(true)
  const calendar = createStrategy('call-calendar')
  const calendarResult = optimizerSensitivity(calendar)
  const first = Math.min(...calendar.legs.map(leg => Date.parse(leg.expiry)))
  expect(calendarResult.scenarios.every(row => Date.parse(row.state.scenarioDate) <= first)).toBe(true)
})

it('flags invalid IV and adverse price stresses without clamping', () => {
  const source = createStrategy('bull-call')
  const result = optimizerSensitivity({ ...source, scenarioSpot: 250, ivShift: -.20 })
  for (const name of ['IV -5 points', 'Adverse move', 'Adverse move and IV -5 points']) {
    const row = result.scenarios.find(row => row.name === name)!
    expect(row.pnl).toBeNull()
    expect(row.unavailable).toBeTruthy()
  }
  expect(result.scenarios.find(row => row.name === 'Adverse move')!.state.scenarioSpot).toBe(-50)
  expect(result.scenarios.find(row => row.name === 'IV -5 points')!.state.ivShift).toBe(-.25)
})

it('rejects mismatched, missing and malformed market inputs before comparing', () => {
  const { state, snapshot } = quoted()
  expect(() => optimizerSensitivity(state)).toThrow()
  expect(() => optimizerSensitivity(state, { ...snapshot, id: 'wrong' })).toThrow()
  expect(() => optimizerSensitivity(state, { ...snapshot, contracts: snapshot.contracts.slice(1) })).toThrow()
  expect(() => optimizerSensitivity(state, { ...snapshot, contracts: snapshot.contracts.map(leg => ({ ...leg, ask: leg.bid - 1 })) })).toThrow()
  expect(() => optimizerSensitivity({ ...state, scenarioDate: 'invalid' }, snapshot)).toThrow()
})
