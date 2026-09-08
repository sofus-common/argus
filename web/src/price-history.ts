import { validateStrategy, type StrategyState } from './options.ts'
import type { BrokerBindings, createThetaRequest } from './broker-context'

export type HistoricalMark = { bid: number; ask: number; mid: number; created: string; lastTrade: string }
export type HistoricalRange = { start: string; end: string }
export function historyPriceScale(state: StrategyState): number | null {
  if (!state || !Array.isArray(state.legs) || !state.legs.length || state.legs.some(leg => !leg || !Number.isSafeInteger(leg.contracts) || leg.contracts <= 0 || leg.multiplier !== 100)) return null
  const quantities = state.legs.map(leg => leg.contracts)
  if (state.stock !== undefined) {
    if (!state.stock || !Number.isSafeInteger(state.stock.shares) || state.stock.shares === 0) return null
    quantities.push(Math.abs(state.stock.shares))
  }
  const packages = quantities.reduce((a, b) => { while (b) [a, b] = [b, a % b]; return a })
  const divisor = 100 * packages
  return Number.isSafeInteger(divisor) && divisor > 0 ? divisor : null
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid history response')
  return value as Record<string, unknown>
}
function day(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Invalid history date')
  return value
}
function localTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?$/.test(value)) throw new Error('Invalid history timestamp')
  day(value.slice(0, 10))
  return value.slice(0, 19) + '.' + (value.split('.')[1] ?? '').padEnd(3, '0')
}
function marks(raw: unknown, range: HistoricalRange): Map<string, HistoricalMark> {
  if (!Array.isArray(raw) || raw.length > 31) throw new Error('Invalid history rows')
  const result = new Map<string, HistoricalMark>()
  for (const item of raw) {
    const row = record(item), created = localTimestamp(row.created), lastTrade = localTimestamp(row.last_trade)
    const date = created.slice(0, 10), { bid, ask } = row
    if (date < range.start || date > range.end || lastTrade > created || result.has(date)
      || typeof bid !== 'number' || typeof ask !== 'number' || !Number.isFinite(bid) || !Number.isFinite(ask)
      || bid < 0 || ask <= 0 || ask < bid || ask > 1_000_000) throw new Error('Invalid historical quote')
    result.set(date, { bid, ask, mid: (bid + ask) / 2, created: row.created as string, lastTrade: row.last_trade as string })
  }
  return result
}

export function historyToday(now = new Date()) {
  const todayParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (type: string) => todayParts.find(item => item.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function buildPriceHistory(state: StrategyState, optionResponses: unknown[], stockResponse: unknown, range: HistoricalRange, now = new Date()) {
  if (validateStrategy(state).length || state.pricing?.mode !== 'market' || state.legs.some(leg => !Number.isSafeInteger(leg.contracts))) throw new Error('History requires a valid listed position')
  const start = day(range?.start), end = day(range?.end), today = historyToday(now)
  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1
  if (days < 1 || days > 31 || end >= today || state.legs.some(leg => end > leg.expiry.slice(0, 10))) throw new Error('History requires at most 31 complete dates through first expiry')
  if (!Array.isArray(optionResponses) || optionResponses.length !== state.legs.length) throw new Error('Incomplete history response set')
  const options = state.legs.map((leg, index) => {
    const response = record(optionResponses[index]).response
    if (!Array.isArray(response) || response.length > 1) throw new Error('Invalid option history response')
    if (!response.length) return new Map<string, HistoricalMark>()
    const item = record(response[0]), contract = record(item.contract)
    if (contract.symbol !== state.underlying || contract.strike !== leg.strike || contract.right !== leg.type.toUpperCase() || contract.expiration !== leg.expiry.slice(0, 10)) throw new Error('Historical contract mismatch')
    return marks(item.data, range)
  })
  const stock = marks(record(stockResponse).response, range)
  const rows = Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.parse(start) + index * 86_400_000).toISOString().slice(0, 10)
    const underlying = stock.get(date) ?? null
    const legs = state.legs.map((leg, i) => ({ contractId: leg.contractId, mark: options[i].get(date) ?? null }))
    let value: { mid: number; bidSide: number; askSide: number } | null = null
    if (legs.every(leg => leg.mark) && (!state.stock || underlying)) {
      value = { mid: 0, bidSide: 0, askSide: 0 }
      const add = (mark: HistoricalMark, quantity: number) => {
        value!.mid += mark.mid * quantity
        value!.bidSide += (quantity > 0 ? mark.bid : mark.ask) * quantity
        value!.askSide += (quantity > 0 ? mark.ask : mark.bid) * quantity
      }
      legs.forEach((leg, i) => add(leg.mark!, state.legs[i].contracts * state.legs[i].multiplier * (state.legs[i].side === 'long' ? 1 : -1)))
      if (state.stock) add(underlying!, state.stock.shares)
      if (!Object.values(value).every(Number.isFinite)) throw new Error('Historical composite exceeds numeric range')
    }
    return { date, underlying, legs, value }
  })
  return { rows }
}

export function readPriceHistory(raw: unknown, state: StrategyState, range: HistoricalRange, now = new Date()) {
  const body = record(raw), returnedRange = record(body.range), rows = record(body.history).rows
  if (body.source !== 'Theta EOD' || body.snapshotId !== state.pricing?.snapshotId || body.positionVersion !== state.version || returnedRange.start !== range.start || returnedRange.end !== range.end || !Array.isArray(rows) || !rows.length || rows.length > 31) throw new Error('History response does not match this request')
  for (const rawRow of rows) {
    const row = record(rawRow)
    if (!Array.isArray(row.legs) || row.legs.length !== state.legs.length || row.legs.some((leg, i) => record(leg).contractId !== state.legs[i].contractId)) throw new Error('History inventory mismatch')
  }
  const sourceMark = (value: unknown) => {
    if (value === null) return []
    const mark = record(value)
    return [{ bid: mark.bid, ask: mark.ask, created: mark.created, last_trade: mark.lastTrade }]
  }
  const options = state.legs.map((leg, i) => ({ response: [{ contract: { symbol: state.underlying, strike: leg.strike, expiration: leg.expiry.slice(0, 10), right: leg.type.toUpperCase() }, data: rows.flatMap(row => sourceMark(record((record(row).legs as unknown[])[i]).mark)) }] }))
  const result = buildPriceHistory(state, options, { response: rows.flatMap(row => sourceMark(record(row).underlying)) }, range, now)
  if (rows.length !== result.rows.length) throw new Error('Incomplete history dates')
  result.rows.forEach((expected, i) => {
    const actual = record(rows[i])
    if (actual.date !== expected.date) throw new Error('History date mismatch')
    const compare = (value: unknown, reference: object | null) => {
      if (reference === null ? value !== null : Object.entries(reference).some(([key, item]) => record(value)[key] !== item)) throw new Error('Historical arithmetic mismatch')
    }
    compare(actual.value, expected.value)
    compare(actual.underlying, expected.underlying)
    expected.legs.forEach((leg, j) => compare(record((actual.legs as unknown[])[j]).mark, leg.mark))
  })
  return result
}

export async function loadPriceHistory(state: StrategyState, range: HistoricalRange, env: BrokerBindings, request: ReturnType<typeof createThetaRequest>) {
  buildPriceHistory(state, state.legs.map(() => ({ response: [] })), { response: [] }, range)
  const common = { symbol: state.underlying, start_date: range.start.replaceAll('-', ''), end_date: range.end.replaceAll('-', ''), format: 'json' }
  const paths = state.legs.map(leg => `/v3/option/history/eod?${new URLSearchParams({ ...common, expiration: leg.expiry.slice(0, 10).replaceAll('-', ''), strike: String(leg.strike), right: leg.type })}`)
  paths.push(`/v3/stock/history/eod?${new URLSearchParams(common)}`)
  const responses = await request(env, paths)
  return buildPriceHistory(state, responses.slice(0, -1), responses.at(-1), range)
}
