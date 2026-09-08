import { expect, it } from 'vitest';
import { streamFreshness } from '../src/stream-freshness';

it('shares exact capture boundaries and expires without requiring another event', () => {
  const now = 1_000_000;
  expect(streamFreshness([now - 300000, now - 240000], [now - 60000], now)).toBe('ready');
  expect(streamFreshness([now - 300000], [now], now + 1)).toBe('stale-source');
  expect(streamFreshness([now], [now - 60000], now + 1)).toBe('stale-receipt');
  expect(streamFreshness([now, now - 60001], [now], now)).toBe('skewed');
  expect(streamFreshness([now + 1], [now], now)).toBe('future');
  expect(streamFreshness([now], [now + 1], now)).toBe('future');
  for (const sources of [[], [null], [0], [NaN]]) expect(streamFreshness(sources, [now], now)).toBe('unknown');
  expect(streamFreshness([now], [], now)).toBe('unknown');
  expect(streamFreshness([now], [NaN], now)).toBe('unknown');
});
