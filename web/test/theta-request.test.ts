import { afterEach, expect, it, vi } from "vitest";
import { createThetaRequest } from "../src/broker-context";

const env = { THETADATA_TERMINAL_URL: "http://127.0.0.1:25503" };
const paths = ["/v3/option/list/expirations?symbol=SPY&format=json", "/v3/option/history/eod?symbol=SPY&format=json", "/v3/stock/history/eod?symbol=SPY&format=json"];
const json = (value: unknown) => new Response(JSON.stringify(value));
afterEach(() => vi.useRealTimers());

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
