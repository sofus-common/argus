import { createStrategy, evaluateScenario, sampleContractId, validateStrategy, type StrategyState } from './options'
import { readWorkspaceDraft } from './workspace-draft'

function validHorizon(value: unknown): value is string {
  return typeof value === 'string' && (value === '' || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value))
}

export function labThesisFit(position: StrategyState, horizon: string): { status: 'missing' | 'invalid' | 'after-expiry' | 'calculated'; pnl: number | null } {
  assertLabPosition(position)
  if (!horizon) return { status: 'missing', pnl: null }
  const date = `${horizon}T20:00:00.000Z`
  if (!validHorizon(horizon) || date < position.valuationTimestamp) return { status: 'invalid', pnl: null }
  if (date > position.legs[0].expiry) return { status: 'after-expiry', pnl: null }
  return { status: 'calculated', pnl: evaluateScenario({ ...position, scenarioDate: date }).pnl }
}

export function readLabDraft(raw: string) {
  if (raw.length > 256 * 1024) throw new Error('Draft too large')
  const value = JSON.parse(raw)
  const envelope = value?.version === 2
  if (envelope && (Object.keys(value).sort().join() !== 'draft,horizon,version' || !validHorizon(value.horizon))) throw new Error('Invalid thesis horizon')
  const draft = readWorkspaceDraft(envelope ? JSON.stringify(value.draft) : raw)
  assertLabPosition(draft.state)
  return { draft, horizon: envelope ? value.horizon as string : '' }
}

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
  if (state.pricing || state.stock || state.excludedLegIds?.length || state.expiryIvShifts?.length || state.underlyingKind || state.underlying !== 'SPY' || state.spot !== 100 || state.rate !== .04 || state.dividendYield !== .012 || state.valuationModel !== 'european-bsm-v1' || state.valuationTimestamp !== '2026-09-01T20:00:00.000Z' || state.legs.length !== 2 || state.legs.some(l => l.type !== 'call' || l.iv !== .22 || l.multiplier !== 100) || state.legs[0].side !== 'long' || state.legs[1].side !== 'short' || state.legs[0].expiry !== state.legs[1].expiry) throw new Error('This prototype accepts only the fixed synthetic SPY call example.')
  if (state.legs[0].strike >= state.legs[1].strike || state.legs[0].contracts !== state.legs[1].contracts) throw new Error('Keep the long strike below the short strike and quantities equal for this spread.')
  if (state.scenarioSpot < 80 || state.scenarioSpot > 120) throw new Error('Prototype target must be between $80 and $120.')
}
