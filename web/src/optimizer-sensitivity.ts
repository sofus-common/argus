import { evaluateScenario, marketLeg, validateMarketStrategy, validateStrategy, type MarketSnapshot, type StrategyState } from './options'
import { validatedSnapshot } from './market-snapshot'

export function optimizerSensitivity(state: StrategyState, snapshot?: MarketSnapshot) {
  const errors = validateStrategy(state)
  if (errors.length) throw new Error(errors.join('; '))
  if (state.pricing && !snapshot || snapshot && !state.pricing) throw new Error('Matching market snapshot required')
  if (snapshot) {
    snapshot = validatedSnapshot(snapshot)
    const mismatch = validateMarketStrategy(state, snapshot)
    if (mismatch.length) throw new Error(mismatch.join('; '))
  }
  const baseline = structuredClone(state)
  const adverseSpot = 2 * state.spot - state.scenarioSpot
  const expiry = state.legs.reduce((first, leg) => Date.parse(leg.expiry) < Date.parse(first) ? leg.expiry : first, state.legs[0]?.expiry ?? state.scenarioDate)
  const variants = [
    { name: 'Unchanged price', scenarioSpot: state.spot },
    { name: 'Smaller move', scenarioSpot: state.spot + (state.scenarioSpot - state.spot) / 3 },
    { name: 'Adverse move', scenarioSpot: adverseSpot },
    { name: 'At first expiry', scenarioDate: expiry },
    { name: 'IV +5 points', ivShift: state.ivShift + .05 },
    { name: 'IV -5 points', ivShift: state.ivShift - .05 },
    { name: 'Adverse move and IV -5 points', scenarioSpot: adverseSpot, ivShift: state.ivShift - .05 },
  ]
  const scenarios = variants.map(({ name, ...patch }) => {
    const scenario = { ...structuredClone(baseline), ...patch }
    const invalid = validateStrategy(scenario)
    return { name, state: scenario, pnl: invalid.length ? null : evaluateScenario(scenario).pnl, unavailable: invalid.length ? invalid.join('; ') : null }
  })
  const entries = snapshot ? (['mid', 'natural'] as const).map(basis => {
    const repriced = { ...structuredClone(baseline), pricing: { ...baseline.pricing!, basis, entryMode: undefined }, legs: baseline.legs.map(leg => marketLeg(snapshot!.contracts.find(contract => contract.contractId === leg.contractId)!, leg.side, leg.contracts, leg.id, basis)) }
    return { basis, state: repriced, pnl: evaluateScenario(repriced).pnl }
  }) : null
  return { baseline: { state: baseline, pnl: evaluateScenario(baseline).pnl }, scenarios, entries,
    assumptions: `Conditional same-structure scenarios, not expected returns. IV shocks are absolute five-point shifts; invalid scenarios are unavailable, never clamped. ${snapshot ? 'Entry comparison re-estimates identical option legs from supplied dated quotes; midpoint and natural are not fills.' : 'Synthetic entries: fill-price comparison unavailable.'} Share costs and the allowance are retained once. No closing slippage, assignment, financing or stock bid/ask is simulated. No freshness or tradability claim.` }
}
