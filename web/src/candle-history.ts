export type CandleBar = { time: number; count: number; open: number; high: number; low: number; close: number; volume: number | null };
export type CandleRow<M extends 'price' | 'iv'> = M extends 'iv' ? { time: number; iv: number | null } : CandleBar;

export function createCandleSnapshot<M extends 'price' | 'iv' = 'price'>(symbols: string[], range: { start: number; end: number }, mode: M = 'price' as M) {
  const start = range?.start, end = range?.end;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start % 300_000 || end % 300_000 || end <= start || end - start > 7 * 86_400_000 || end > Date.now()
    || !Array.isArray(symbols) || !symbols.length || symbols.length > 5 || new Set(symbols).size !== symbols.length || symbols.some(symbol => typeof symbol !== 'string' || !symbol || symbol.length > 200 || /[\s\x00-\x1f]/.test(symbol))) throw new Error('Invalid candle selection or range');
  if (mode !== 'price' && mode !== 'iv') throw new Error('Invalid candle mode');
  const states = new Map(symbols.map(symbol => [symbol, { begun: false, ended: false, snipped: false, pending: false, rows: new Map<number, CandleRow<'price' | 'iv'>>() }]));
  let events = 0, failed = false;
  const complete = () => !failed && [...states.values()].every(state => state.begun && state.ended && !state.snipped && !state.pending);
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  return {
    complete,
    push(raw: unknown) {
      try {
        if (failed || ++events > 20_000 || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error();
        const value = raw as Record<string, unknown>, state = states.get(value.eventSymbol as string);
        const flags = value.eventFlags as number, time = value.time as number;
        if (!state || value.eventType !== 'Candle' || !Number.isInteger(flags) || flags < 0 || flags > 31 || !Number.isSafeInteger(time) || time < 0 || time > Date.now() || value.sequence !== 0) throw new Error();
        const removed = !!(flags & 2);
        if ((!removed || time >= start && time < end) && (time === 0 || time % 300_000)) throw new Error();
        if (!(flags & 4) && !state.begun) throw new Error();
        let bar: CandleRow<'price' | 'iv'> | null = null;
        if (!removed && mode === 'iv') {
          const iv = value.impVolatility;
          if (iv !== 'NaN' && (!finite(iv) || iv < 0)) throw new Error();
          bar = { time, iv: iv === 'NaN' ? null : iv as number };
        } else if (!removed) {
          const prices = [value.open, value.high, value.low, value.close];
          if (prices.some(price => price !== 'NaN' && (!finite(price) || price < 0 || price > 1_000_000)) || !Number.isSafeInteger(value.count) || (value.count as number) < 0
            || value.volume !== 'NaN' && (!finite(value.volume) || value.volume < 0)) throw new Error();
          if (prices.every(finite)) {
            const [open, high, low, close] = prices;
            if (high < low || open < low || open > high || close < low || close > high) throw new Error();
            bar = { time, count: value.count as number, open, high, low, close, volume: value.volume === 'NaN' ? null : value.volume as number };
          }
        }
        if (flags & 4) { state.begun = true; state.ended = false; state.snipped = false; state.rows.clear(); }
        if (flags & 8) state.ended = true;
        if (flags & 16) state.snipped = true;
        state.pending = !!(flags & 1);
        if (time >= start && time < end) {
          if (bar) state.rows.set(time, bar);
          else state.rows.delete(time);
        }
      } catch { failed = true; throw new Error('Invalid or oversized candle snapshot'); }
    },
    read(): Record<string, CandleRow<M>[]> {
      if (!complete()) throw new Error('Candle snapshot is incomplete');
      return Object.fromEntries([...states].map(([symbol, state]) => [symbol, [...state.rows.values()].sort((a, b) => a.time - b.time).map(bar => ({ ...bar }))])) as Record<string, CandleRow<M>[]>;
    },
  };
}
