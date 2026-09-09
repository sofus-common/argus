import { createStrategy, evaluateScenario, sampleContractId, validateStrategy, type StrategyState } from './options'

export function createLabPosition(): StrategyState {
  const state = createStrategy('bull-call')
  return { ...state, scenarioSpot: 103, scenarioDate: '2026-09-10T20:00:00.000Z', legs: state.legs.map((leg, i) => ({ ...leg, strike: i ? 105 : 100, entryPrice: i ? 1 : 3, contractId: sampleContractId('call', i ? 105 : 100, leg.expiry) })) }
}

export function labScenarios(position: StrategyState, target: number, date: string) {
  assertLabPosition(position)
  const expiry = position.legs.reduce((a, leg) => a < leg.expiry ? a : leg.expiry, position.legs[0].expiry)
  return [
    { name: 'Base case', spot: target, date },
    { name: 'Smaller move', spot: position.spot + (target - position.spot) / 3, date },
    { name: 'Later move', spot: target, date: expiry },
  ].map(item => {
    const state = { ...position, scenarioSpot: item.spot, scenarioDate: item.date }
    const errors = validateStrategy(state)
    if (errors.length) throw new Error(errors.join('; '))
    return { name: item.name, state, pnl: evaluateScenario(state).pnl }
  })
}

export function assertLabPosition(state: StrategyState) {
  const errors = validateStrategy(state)
  if (errors.length) throw new Error(errors[0])
  if (state.pricing || state.stock || state.excludedLegIds?.length || state.expiryIvShifts?.length || state.underlyingKind || state.underlying !== 'SPY' || state.spot !== 100 || state.rate !== .04 || state.dividendYield !== .012 || state.feeAllowance || state.valuationModel !== 'european-bsm-v1' || state.valuationTimestamp !== '2026-09-01T20:00:00.000Z' || state.legs.length !== 2 || state.legs.some(l => l.type !== 'call' || l.iv !== .22 || l.multiplier !== 100) || state.legs[0].side !== 'long' || state.legs[1].side !== 'short' || state.legs[0].expiry !== state.legs[1].expiry) throw new Error('This prototype accepts only the fixed synthetic SPY call example.')
  if (state.legs[0].strike >= state.legs[1].strike || state.legs[0].contracts !== state.legs[1].contracts) throw new Error('Keep the long strike below the short strike and quantities equal for this spread.')
  if (state.scenarioSpot < 80 || state.scenarioSpot > 120) throw new Error('Prototype target must be between $80 and $120.')
}
