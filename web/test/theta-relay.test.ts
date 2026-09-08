import { afterEach, expect, it, vi } from 'vitest';
import { createThetaRelay } from '../src/theta-relay';

const env = { THETA_RELAY: {} as DurableObjectNamespace, THETA_RELAY_ORIGIN: 'https://theta.example.com', THETA_ACCESS_CLIENT_ID: 'test-id', THETA_ACCESS_CLIENT_SECRET: 'test-secret' };
const path = '/v3/option/list/expirations?symbol=SPY&format=json';
const request = (body: unknown = { paths: [path] }) => new Request('https://theta.internal/history', { method: 'POST', body: JSON.stringify(body) });
function fixture(initial?: unknown) {
  let value = initial;
  const storage = { get: vi.fn(async () => value), put: vi.fn(async (_key: string, next: unknown) => { value = structuredClone(next); }) };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ response: [1] }));
  const relay = createThetaRelay(env, storage as any, fetcher);
  return { relay, storage, fetcher };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('rejects malformed, oversized and out-of-scope requests without upstream calls', async () => {
  const { relay, fetcher } = fixture();
  for (const body of [{ paths: [] }, { paths: [path], secret: true }, { paths: ['/admin'] }, { paths: Array(10).fill(path) }, { paths: [path], extra: 'x'.repeat(8192) }]) {
    expect((await relay.fetch(request(body))).status).toBe(400);
  }
  expect((await relay.fetch(new Request('https://theta.internal/other'))).status).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();
});

it('persists reservation before fetch and sends credentials only to configured origin', async () => {
  const { relay, storage, fetcher } = fixture();
  fetcher.mockImplementation(async (url, init) => {
    expect(storage.put).toHaveBeenCalled();
    expect(String(url)).toBe(env.THETA_RELAY_ORIGIN + path);
    expect(init?.redirect).toBe('manual');
    expect(init?.headers).toMatchObject({ 'CF-Access-Client-Id': 'test-id', 'CF-Access-Client-Secret': 'test-secret' });
    return Response.json({ response: [1] });
  });
  const response = await relay.fetch(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual([{ response: [1] }]);
});

it('rejects a competing batch and preserves spacing across batches and cold recovery', async () => {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  const { relay, storage, fetcher } = fixture({ nextStart: 12_000, leaseUntil: 15_000 });
  const first = relay.fetch(request());
  await vi.advanceTimersByTimeAsync(0);
  expect((await relay.fetch(request())).status).toBe(429);
  await vi.advanceTimersByTimeAsync(4999); expect(fetcher).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect((await first).status).toBe(200);
  const cold = createThetaRelay(env, storage as any, fetcher);
  const second = cold.fetch(request());
  await vi.advanceTimersByTimeAsync(3499); expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect((await second).status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('fails closed on missing config, corrupt storage, or failed durable admission', async () => {
  const { storage, fetcher } = fixture();
  expect((await createThetaRelay({}, storage as any, fetcher).fetch(request())).status).toBe(503);
  const corrupt = fixture({ nextStart: 'bad', leaseUntil: 0 });
  expect((await corrupt.relay.fetch(request())).status).toBe(503);
  storage.put.mockRejectedValue(new Error('private storage error'));
  expect((await createThetaRelay(env, storage as any, fetcher).fetch(request())).status).toBe(503);
  expect(fetcher).not.toHaveBeenCalled();
});

it('returns ordered batch data with paced starts and rejects a stalled inbound stream', async () => {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  const { relay, fetcher } = fixture();
  fetcher.mockImplementation(async url => Response.json({ path: String(url) }));
  const stock = '/v3/stock/history/eod?symbol=SPY&start_date=20260901&end_date=20260902&format=json';
  const pending = relay.fetch(request({ paths: [path, stock] }));
  await vi.advanceTimersByTimeAsync(3499); expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await (await pending).json()).toEqual([{ path: env.THETA_RELAY_ORIGIN + path }, { path: env.THETA_RELAY_ORIGIN + stock }]);
  const stalled = relay.fetch(new Request('https://theta.internal/history', { method: 'POST', body: new ReadableStream({ start() {} }) }));
  await vi.advanceTimersByTimeAsync(5000);
  expect((await stalled).status).toBe(400);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('does not begin upstream work after a slow durable write consumes the recovery spacing', async () => {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  const { relay, storage, fetcher } = fixture();
  storage.put.mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 1501)); });
  const pending = relay.fetch(request());
  await vi.advanceTimersByTimeAsync(1501);
  expect((await pending).status).toBe(503);
  expect(fetcher).not.toHaveBeenCalled();
});

it('bounds redirect, oversized response and timeout without exposing upstream errors', async () => {
  vi.useFakeTimers();
  for (const mode of ['redirect', 'oversize', 'timeout']) {
    const { relay, fetcher } = fixture();
    fetcher.mockImplementation(async () => mode === 'redirect' ? new Response(null, { status: 302, headers: { Location: 'https://evil.example/private' } }) : mode === 'oversize' ? new Response(JSON.stringify('x'.repeat(131072))) : new Promise<Response>(() => {}));
    const pending = relay.fetch(request());
    await vi.advanceTimersByTimeAsync(5001);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('Theta history unavailable');
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
