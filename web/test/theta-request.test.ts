import { afterEach, expect, it, vi } from "vitest";
import { createThetaRequest, thetaRelayConfig, validateThetaPaths } from "../src/broker-context";

const env = { THETADATA_TERMINAL_URL: "http://127.0.0.1:25503" };
const paths = ["/v3/option/list/expirations?symbol=SPY&format=json", "/v3/option/history/eod?symbol=SPY&format=json", "/v3/stock/history/eod?symbol=SPY&format=json"];
const json = (value: unknown) => new Response(JSON.stringify(value));
afterEach(() => vi.useRealTimers());

it("routes configured clients through one relay name without credential-dependent partitions or loopback fallback", async () => {
  const direct = vi.fn<typeof fetch>();
  const relayFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect(JSON.parse(String(init?.body))).toEqual({ paths: [paths[0]] });
    expect(JSON.stringify(init)).not.toContain('secret-token');
    return Response.json([{ response: [] }]);
  });
  const getByName = vi.fn(() => ({ fetch: relayFetch }));
  const configured = { THETA_RELAY: { getByName } as unknown as DurableObjectNamespace, THETA_RELAY_ORIGIN: 'https://theta.example.com', THETA_ACCESS_CLIENT_ID: 'client', THETA_ACCESS_CLIENT_SECRET: 'secret-token' };
  for (const secret of ['secret-token', 'rotated-token']) expect(await createThetaRequest(direct)({ ...configured, THETA_ACCESS_CLIENT_SECRET: secret }, [paths[0]])).toEqual([{ response: [] }]);
  expect(getByName.mock.calls).toEqual([['theta-terminal'], ['theta-terminal']]);
  await expect(createThetaRequest(direct)({ ...env, THETA_RELAY_ORIGIN: configured.THETA_RELAY_ORIGIN }, [paths[0]])).rejects.toThrow();
  expect(direct).not.toHaveBeenCalled();
  expect(thetaRelayConfig({})).toBeNull();
});

it("rejects hosted bulk queries, duplicate parameters and invalid dates before relay admission", () => {
  const valid = '/v3/option/history/eod?symbol=SPY&start_date=20260901&end_date=20260904&expiration=20260918&strike=100&right=call&format=json';
  expect(() => validateThetaPaths([valid, paths[0]])).not.toThrow();
  for (const path of [valid + '&symbol=QQQ', valid + '&limit=0', valid.replace('symbol=SPY', 'symbol=*'), valid.replace('20260901', '20260230'), valid.replace('20260904', '20261004'), valid.replace('strike=100', 'strike=*'), paths[1]]) expect(() => validateThetaPaths([path])).toThrow();
});

it("serializes bounded batches and retains provider-start spacing across batches", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const selected = [...Array.from({ length: 8 }, (_, i) => `/v3/option/history/eod?symbol=SPY&strike=${770 + i}&format=json`), paths[2]];
  const starts: number[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    starts.push(Date.now());
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return json({ url: String(input) });
  });
  const request = createThetaRequest(fetcher), first = request(env, selected);
  await vi.advanceTimersByTimeAsync(0);
  expect(starts).toEqual([0]);
  await vi.advanceTimersByTimeAsync(3499);
  expect(starts).toEqual([0]);
  await vi.advanceTimersByTimeAsync(1);
  expect(starts).toEqual([0, 3500]);
  await vi.advanceTimersByTimeAsync(7 * 3500);
  expect(await first).toEqual(selected.map(path => ({ url: `${env.THETADATA_TERMINAL_URL}${path}` })));
  const second = request({ THETADATA_TERMINAL_URL: "http://localhost:25503/" }, [paths[0]]);
  await vi.advanceTimersByTimeAsync(3499);
  expect(starts).toEqual(Array.from({ length: 9 }, (_, i) => i * 3500));
  await vi.advanceTimersByTimeAsync(1);
  expect(await second).toEqual([{ url: `http://localhost:25503${paths[0]}` }]);
  expect(starts).toEqual(Array.from({ length: 10 }, (_, i) => i * 3500));
});

it("rejects concurrent batches and releases failed batches without erasing their pacing interval", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  let rejectFirst!: (error: Error) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise<Response>((_, reject) => { rejectFirst = reject; })).mockImplementation(async () => json({ response: [] }));
  const request = createThetaRequest(fetcher), first = request(env, paths);
  const failure = expect(first).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(0);
  await expect(request(env, [paths[0]])).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
  rejectFirst(new Error("provider failed")); await failure;
  const retry = request(env, [paths[0]]);
  await vi.advanceTimersByTimeAsync(3499);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await retry).toEqual([{ response: [] }]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("rejects unsafe origins, paths and batch sizes before any provider request", async () => {
  const fetcher = vi.fn<typeof fetch>(), request = createThetaRequest(fetcher);
  for (const origin of [undefined, "https://localhost:25503", "http://example.com:25503", "http://127.0.0.1:80", "http://user:pass@localhost:25503", "http://localhost:25503/path", "http://localhost:25503?x=1", "http://localhost:25503#x"]) {
    await expect(request({ THETADATA_TERMINAL_URL: origin }, [paths[0]])).rejects.toThrow();
  }
  for (const path of ["https://example.com/v3/option/history/eod", "//example.com/v3/option/history/eod", "/v3/option/history/eod#fragment", "/v3/option/snapshot/quote", "/v3/option/history/eod/../quote", "/v3/option/history/%65od", "v3/stock/history/eod", "/v3/stock/history/eod\n"]) {
    await expect(request(env, [paths[0], path])).rejects.toThrow();
  }
  for (const batch of [[], Array(10).fill(paths[0])]) await expect(request(env, batch)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it("bounds provider failures, oversized bodies and requests that ignore cancellation", async () => {
  vi.useFakeTimers();
  for (const response of [new Response(null, { status: 302, headers: { Location: "https://example.com" } }), json({ padding: "x".repeat(131072) })]) {
    const fetcher = vi.fn<typeof fetch>(async () => response);
    await expect(createThetaRequest(fetcher)(env, [paths[0]])).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
  const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => {})), request = createThetaRequest(fetcher);
  const pending = expect(request(env, [paths[0]])).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(5000); await pending;
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
});
