// Dated-capture policy, not a guarantee of live or executable prices.
export function streamFreshness(sources: readonly (number | null)[], receipts: readonly number[], now: number): 'ready' | 'unknown' | 'future' | 'stale-source' | 'stale-receipt' | 'skewed' {
  if (!Number.isFinite(now) || !sources.length || !receipts.length || sources.some(time => time === null || !Number.isFinite(time) || time <= 0) || receipts.some(time => !Number.isFinite(time) || time <= 0)) return 'unknown';
  const times = sources as readonly number[];
  if ([...times, ...receipts].some(time => time > now)) return 'future';
  if (times.some(time => now - time > 300000)) return 'stale-source';
  if (receipts.some(time => now - time > 60000)) return 'stale-receipt';
  if (Math.max(...times) - Math.min(...times) > 60000) return 'skewed';
  return 'ready';
}
