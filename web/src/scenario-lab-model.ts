import { calculateStrategy, createStrategy, evaluateScenario, sampleContractId, validateStrategy, type StrategyState, type OptionLeg } from './options'
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

export function labFamily(state: StrategyState): string {
  const [a, b, c] = state.legs
  if (!a) return ''
  if (state.stock) return state.legs.length === 1 && a.type === 'call' && a.side === 'short' && state.stock.shares === 100 * a.contracts && state.stock.entryPrice === 100 ? 'Covered call' : ''
  if (state.legs.length === 1) return a.type === 'call' && a.side === 'long' ? 'Long call' : a.type === 'put' && a.side === 'short' ? 'Cash-secured put' : ''
  if (state.legs.length === 2 && a.contracts === b.contracts && a.type === b.type) {
    if (a.type === 'call' && a.side === 'long' && b.side === 'short' && a.strike < b.strike) return 'Bull call spread'
    if (a.type === 'put' && a.side === 'short' && b.side === 'long' && a.strike > b.strike) return 'Bull put spread'
  }
  if (state.legs.length === 3 && state.legs.every(l => l.type === 'call') && a.side === 'long' && b.side === 'short' && c.side === 'long' && a.strike < b.strike && b.strike < c.strike && a.strike + c.strike === 2 * b.strike && a.contracts === c.contracts && b.contracts === 2 * a.contracts) return 'Bullish call butterfly'
  return ''
}

export function assertLabPosition(state: StrategyState) {
  const errors = validateStrategy(state)
  if (errors.length) throw new Error(errors[0])
  if (state.pricing || state.excludedLegIds?.length || state.expiryIvShifts?.length || state.underlyingKind || state.underlying !== 'SPY' || state.spot !== 100 || state.rate !== .04 || state.dividendYield !== .012 || state.valuationModel !== 'european-bsm-v1' || state.valuationTimestamp !== '2026-09-01T20:00:00.000Z' || state.legs.some(l => l.iv !== .22 || l.multiplier !== 100 || l.expiry !== state.legs[0].expiry) || !labFamily(state)) throw new Error('Use a supported synthetic SPY bullish structure, preserving strike order, coverage and quantity ratios.')
  if (state.scenarioSpot < 80 || state.scenarioSpot > 120) throw new Error('Prototype target must be between $80 and $120.')
}

export function optimizeLab(position: StrategyState, horizon: string, budget: number, objective: 'profit' | 'return', collateralBudget = 10000) {
  if (labThesisFit(position, horizon).status !== 'calculated') throw new Error('Set a thesis horizon between valuation and the selected expiry.')
  if (!Number.isFinite(budget) || budget <= 0 || budget > 100000 || !['profit', 'return'].includes(objective)) throw new Error('Enter a maximum loss between $0.01 and $100,000 and a supported objective.')
  if (!Number.isFinite(collateralBudget) || collateralBudget < 0 || collateralBudget > 1000000) throw new Error('Enter a stock/cash collateral budget between $0 and $1,000,000.')
  const date = `${horizon}T20:00:00.000Z`
  const premium = (strike: number, type: OptionLeg['type']) => {
    const leg = { ...position.legs[0], side: 'long' as const, type, contracts: 1, strike, contractId: sampleContractId(type, strike, position.legs[0].expiry), entryPrice: 0 }
    return Math.round(evaluateScenario({ ...position, stock: undefined, legs: [leg], feeAllowance: 0, ivShift: 0, scenarioSpot: position.spot, scenarioDate: position.valuationTimestamp }).pnl) / 100
  }
  const prices = new Map<string, number>()
  for (const strike of new Set([...Array.from({ length: 16 }, (_, i) => 95 + i), ...position.legs.map(l => l.strike)])) for (const type of ['call', 'put'] as const) prices.set(`${type}:${strike}`, premium(strike, type))
  const quantity = position.legs[0].contracts
  const leg = (type: OptionLeg['type'], side: OptionLeg['side'], strike: number, ratio = 1): OptionLeg => ({ ...position.legs[0], id: `${side}-${type}-${strike}`, type, side, strike, contracts: quantity * ratio, contractId: sampleContractId(type, strike, position.legs[0].expiry), entryPrice: prices.get(`${type}:${strike}`)! })
  const candidate = (legs: OptionLeg[], stock?: StrategyState['stock']) => {
    const state = { ...position, stock, scenarioDate: date, legs }
    const family = labFamily(state)
    state.name = family
    const metrics = calculateStrategy(state)
    const debit = metrics.entryAmount * (metrics.entryLabel === 'Debit' ? 1 : -1)
    const maxLoss = metrics.maxLoss!
    const collateral = stock ? stock.shares * stock.entryPrice : family === 'Cash-secured put' ? legs[0].strike * 100 * quantity : 0
    const riskNote = stock ? 'Includes buying shares at $100; stock downside and call assignment risk.' : family === 'Cash-secured put' ? 'Full strike cash reserved; assignment may require buying shares.' : family === 'Bullish call butterfly' ? 'Target-centred payoff; a larger rise can reduce profit. Short-leg assignment not simulated.' : legs.some(l => l.side === 'short') ? 'Limited expiry loss; early assignment and temporary funding needs not simulated.' : 'Entire premium can be lost; upside is uncapped.'
    const pnl = evaluateScenario(state).pnl
    const smaller = evaluateScenario({ ...state, scenarioSpot: state.spot + (state.scenarioSpot - state.spot) / 3 }).pnl
    const later = evaluateScenario({ ...state, scenarioDate: state.legs[0].expiry }).pnl
    return { state, family, collateral, riskNote, debit, maxLoss, maxProfit: metrics.maxProfit, breakevens: metrics.breakevens, pnl, smaller, later, returnOnRisk: maxLoss > 0 ? pnl / maxLoss : null }
  }
  const current = candidate(position.legs.map(l => ({ ...l, entryPrice: prices.get(`${l.type}:${l.strike}`)! })), position.stock)
  const candidates: ReturnType<typeof candidate>[] = []
  let searched = 0
  const add = (legs: OptionLeg[], stock?: StrategyState['stock']) => {
    searched++
    const result = candidate(legs, stock)
    if (result.maxLoss !== null && result.maxLoss > 0 && result.maxLoss <= budget && result.collateral <= collateralBudget) candidates.push(result)
  }
  for (let strike = 95; strike <= 110; strike++) {
    add([leg('call', 'long', strike)])
    add([leg('call', 'short', strike)], { shares: 100 * quantity, entryPrice: 100 })
    add([leg('put', 'short', strike)])
    for (let upper = strike + 1; upper <= 110; upper++) {
      add([leg('call', 'long', strike), leg('call', 'short', upper)])
      add([leg('put', 'short', upper), leg('put', 'long', strike)])
    }
    if (strike > position.spot && Math.abs(strike - position.scenarioSpot) <= 1) for (let width = 1; strike - width >= 95 && strike + width <= 110; width++) add([leg('call', 'long', strike - width), leg('call', 'short', strike, 2), leg('call', 'long', strike + width)])
  }
  const score = (c: typeof current) => objective === 'profit' ? c.pnl : c.returnOnRisk!
  candidates.sort((a, b) => score(b) - score(a) || a.maxLoss - b.maxLoss || a.family.localeCompare(b.family) || a.state.legs[0].strike - b.state.legs[0].strike)
  return { current, candidates: candidates.filter((c, i) => candidates.findIndex(other => other.family === c.family) === i), searched, eligible: candidates.length }
}
