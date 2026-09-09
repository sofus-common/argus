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

export function optimizeLab(position: StrategyState, horizon: string, budget: number, objective: 'profit' | 'return') {
  if (labThesisFit(position, horizon).status !== 'calculated') throw new Error('Set a thesis horizon between valuation and the selected expiry.')
  if (!Number.isFinite(budget) || budget <= 0 || budget > 100000 || !['profit', 'return'].includes(objective)) throw new Error('Enter a maximum loss between $0.01 and $100,000 and a supported objective.')
  const date = `${horizon}T20:00:00.000Z`
  const premium = (strike: number) => {
    const leg = { ...position.legs[0], contracts: 1, strike, contractId: sampleContractId('call', strike, position.legs[0].expiry), entryPrice: 0 }
    return Math.round(evaluateScenario({ ...position, legs: [leg], feeAllowance: 0, ivShift: 0, scenarioSpot: position.spot, scenarioDate: position.valuationTimestamp }).pnl) / 100
  }
  const prices = new Map<number, number>()
  for (const strike of new Set([...Array.from({ length: 16 }, (_, i) => 95 + i), ...position.legs.map(l => l.strike)])) prices.set(strike, premium(strike))
  const candidate = (long: number, short: number) => {
    const state = { ...position, scenarioDate: date, legs: position.legs.map((leg, i) => {
      const strike = i ? short : long
      return { ...leg, strike, contractId: sampleContractId('call', strike, leg.expiry), entryPrice: prices.get(strike)! }
    }) }
    const debit = Number(((prices.get(long)! - prices.get(short)!) * 100 * state.legs[0].contracts).toFixed(2))
    const maxLoss = Number((debit + (state.feeAllowance ?? 0)).toFixed(2))
    const pnl = evaluateScenario(state).pnl
    const smaller = evaluateScenario({ ...state, scenarioSpot: state.spot + (state.scenarioSpot - state.spot) / 3 }).pnl
    const later = evaluateScenario({ ...state, scenarioDate: state.legs[0].expiry }).pnl
    return { state, debit, maxLoss, pnl, smaller, later, returnOnRisk: maxLoss > 0 ? pnl / maxLoss : null }
  }
  const current = candidate(position.legs[0].strike, position.legs[1].strike)
  const candidates: ReturnType<typeof candidate>[] = []
  let searched = 0
  for (let long = 95; long < 110; long++) for (let short = long + 1; short <= 110; short++) {
    searched++
    const result = candidate(long, short)
    if (result.maxLoss > 0 && result.maxLoss <= budget && !(long === position.legs[0].strike && short === position.legs[1].strike)) candidates.push(result)
  }
  const score = (c: typeof current) => objective === 'profit' ? c.pnl : c.returnOnRisk!
  candidates.sort((a, b) => score(b) - score(a) || a.maxLoss - b.maxLoss || a.state.legs[0].strike - b.state.legs[0].strike || a.state.legs[1].strike - b.state.legs[1].strike)
  return { current, candidates: candidates.slice(0, 3), searched, eligible: candidates.length }
}
