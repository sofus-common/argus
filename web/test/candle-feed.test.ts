import { expect, it, vi } from 'vitest';
import { readCandleFeed } from '../src/candle-feed';

const endpoint = 'wss://test.dxfeed.com/feed';
const symbols = ['SPY{=5m}', '.SPY261009C770{=5m,price=mark}'];
const start = Date.parse('2026-09-04T13:30:00Z'), range = { start, end: start + 600_000 };
const fields = ['eventType', 'eventSymbol', 'eventFlags', 'time', 'sequence', 'count', 'open', 'high', 'low', 'close', 'volume'];
const candle = (symbol = symbols[0], flags = 12, time = start) => ({ eventType: 'Candle', eventSymbol: symbol, eventFlags: flags, time, sequence: 0, count: 1, open: 1, high: 2, low: 1, close: 2, volume: 'NaN' });
function frame(rows: Record<string, unknown>[], names = fields) { return { type: 'FEED_DATA', channel: 3, data: ['Candle', rows.flatMap(row => names.map(name => row[name]))] }; }
function fixture(names = fields, config: unknown = { Candle: names }) {
  const upstreams: WebSocket[] = [], subscriptions: any[] = [], messages: any[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_url, _init) => {
    const pair = new WebSocketPair(); pair[1].accept(); upstreams.push(pair[1]);
    const send = (data: unknown) => pair[1].send(JSON.stringify(data));
    pair[1].addEventListener('message', event => {
      const value = JSON.parse(String(event.data)); messages.push(value);
      if (value.type === 'SETUP') { send({ type: 'SETUP', channel: 0 }); send({ type: 'AUTH_STATE', channel: 0, state: 'UNAUTHORIZED' }); }
      else if (value.type === 'AUTH') send({ type: 'AUTH_STATE', channel: 0, state: 'AUTHORIZED' });
      else if (value.type === 'CHANNEL_REQUEST') send({ type: 'CHANNEL_OPENED', channel: 3 });
      else if (value.type === 'FEED_SETUP') send({ type: 'FEED_CONFIG', channel: 3, dataFormat: 'COMPACT', eventFields: config });
      else if (value.type === 'FEED_SUBSCRIPTION') subscriptions.push(value);
    });
    return new Response(null, { status: 101, webSocket: pair[0] });
  });
  return { fetcher, upstreams, subscriptions, messages, send(value: unknown) { upstreams[0].send(JSON.stringify(value)); } };
}

it('upgrades manually and subscribes millisecond bounds with negotiated arbitrary Candle field order', async () => {
  const names = [...fields].reverse(), f = fixture(names), controller = new AbortController();
  const pending = readCandleFeed(f.fetcher, endpoint, 'synthetic-token', symbols, range, controller.signal);
  try {
    await vi.waitFor(() => expect(f.subscriptions).toHaveLength(1));
    expect(String(f.fetcher.mock.calls[0][0])).toBe('https://test.dxfeed.com/feed');
    expect(f.fetcher.mock.calls[0][1]?.redirect).toBe('manual');
    expect(new Headers(f.fetcher.mock.calls[0][1]?.headers).get('upgrade')).toBe('websocket');
    expect(f.subscriptions[0].add).toEqual(symbols.map(symbol => ({ type: 'Candle', symbol, fromTime: start })));
    expect(f.messages.find(message => message.type === 'AUTH').token).toBe('synthetic-token');
    f.send(frame(symbols.map(symbol => candle(symbol)), names));
    expect(await pending).toEqual(Object.fromEntries(symbols.map(symbol => [symbol, [{ time: start, count: 1, open: 1, high: 2, low: 1, close: 2, volume: null }]])));
    await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
  } finally { controller.abort(); }
});

it('negotiates IV-only fields independently of prices without altering symbols or units', async () => {
  const names = ['impVolatility', 'sequence', 'time', 'eventFlags', 'eventSymbol', 'eventType'];
  const f = fixture(names), controller = new AbortController();
  const selected = ['.SPY261009C770{=5m}'];
  const pending = readCandleFeed(f.fetcher, endpoint, 'synthetic-token', selected, range, controller.signal, 'iv');
  void pending.catch(() => {});
  try {
    await vi.waitFor(() => expect(f.subscriptions).toHaveLength(1));
    expect(f.messages.find(message => message.type === 'FEED_SETUP').acceptEventFields.Candle).toEqual([...names].reverse());
    expect(f.subscriptions[0].add).toEqual([{ type: 'Candle', symbol: selected[0], fromTime: start }]);
    f.send(frame([{ ...candle(selected[0], 4), impVolatility: 0 }, { ...candle(selected[0], 8, start + 300_000), impVolatility: 'NaN' }], names));
    expect(await pending).toEqual({ [selected[0]]: [{ time: start, iv: 0 }, { time: start + 300_000, iv: null }] });
    await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
  } finally { controller.abort(); }
});

it('rejects missing or duplicate IV fields and malformed IV payloads', async () => {
  const names = ['eventType', 'eventSymbol', 'eventFlags', 'time', 'sequence', 'impVolatility'];
  for (const invalid of ['missing', 'duplicate', 'payload']) {
    const config = invalid === 'missing' ? names.slice(0, -1) : invalid === 'duplicate' ? [...names.slice(0, -1), 'time'] : names;
    const f = fixture(names, { Candle: config }), controller = new AbortController();
    const pending = readCandleFeed(f.fetcher, endpoint, 'synthetic-token', [symbols[0]], range, controller.signal, 'iv');
    const rejected = expect(pending).rejects.toThrow();
    try {
      if (invalid === 'payload') {
        await vi.waitFor(() => expect(f.subscriptions).toHaveLength(1));
        f.send(frame([{ ...candle(), impVolatility: null }], names));
      }
      await rejected;
      await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
    } finally { controller.abort(); }
  }
});

it('receives a dense seven-day nine-symbol snapshot without dropping buckets', async () => {
  const selected = [symbols[0], ...[770, 775, 780, 785, 790, 795, 800, 805].map(strike => `.SPY261009C${strike}{=5m,price=mark}`)];
  const week = { start: Date.parse('2026-08-31T00:00:00Z'), end: Date.parse('2026-09-07T00:00:00Z') };
  const f = fixture(), controller = new AbortController();
  const pending = readCandleFeed(f.fetcher, endpoint, 'synthetic-token', selected, week, controller.signal);
  try {
    await vi.waitFor(() => expect(f.subscriptions).toHaveLength(1));
    for (const symbol of selected) {
      const rows = Array.from({ length: 2016 }, (_, i) => candle(symbol, i === 0 ? 4 : i === 2015 ? 8 : 0, week.start + i * 300000));
      for (let i = 0; i < rows.length; i += 200) f.send(frame(rows.slice(i, i + 200)));
    }
    const result = await pending;
    for (const symbol of selected) { expect(result[symbol]).toHaveLength(2016); expect(result[symbol].at(-1)!.time).toBe(week.end - 300000); }
  } finally { controller.abort(); }
});

it('consumes the entire data frame before resolving after end, restart and transaction-pending flags', async () => {
  const f = fixture(), controller = new AbortController(); let settled = false;
  const pending = readCandleFeed(f.fetcher, endpoint, 'synthetic-token', symbols, range, controller.signal);
  void pending.then(() => { settled = true; }, () => { settled = true; });
  try {
    await vi.waitFor(() => expect(f.subscriptions).toHaveLength(1));
    f.send(frame([candle(symbols[0]), candle(symbols[1]), candle(symbols[0], 5, start + 300_000)]));
    await new Promise(resolve => setTimeout(resolve, 20)); expect(settled).toBe(false);
    f.send(frame([candle(symbols[0], 9, start + 300_000)]));
    await new Promise(resolve => setTimeout(resolve, 20)); expect(settled).toBe(false);
    f.send(frame([candle(symbols[0], 0, start + 300_000)]));
    const result = await pending;
    expect(result[symbols[0]].map(row => row.time)).toEqual([start + 300_000]);
  } finally { controller.abort(); }
});

it('rejects malformed configs, trailing malformed events and partial provider closure without returning bars', async () => {
  for (const invalid of ['config', 'trailing', 'partial', 'oversized'] as const) {
    const f = fixture(fields, invalid === 'config' ? { Candle: fields.slice(1) } : { Candle: fields }), controller = new AbortController();
    const pending = readCandleFeed(f.fetcher, endpoint, 'synthetic-token', symbols, range, controller.signal);
    const rejected = expect(pending).rejects.toThrow();
    try {
      if (invalid !== 'config') {
        await vi.waitFor(() => expect(f.subscriptions).toHaveLength(1));
        if (invalid === 'trailing') f.send(frame([...symbols.map(symbol => candle(symbol)), { ...candle(), close: 'arbitrary' }]));
        else if (invalid === 'partial') { f.send(frame([candle(symbols[0], 4)])); f.upstreams[0].close(1000); }
        else f.upstreams[0].send('x'.repeat(131_073));
      }
      await rejected;
      await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
    } finally { controller.abort(); }
  }
});

it('rejects unsafe endpoints and already-aborted requests before upgrading', async () => {
  const fetcher = vi.fn<typeof fetch>();
  for (const url of ['https://test.dxfeed.com/feed', 'wss://dxfeed.com.evil.example/feed', 'wss://user:password@test.dxfeed.com/feed', 'wss://localhost/feed', 'wss://test.dxfeed.com:8443/feed', 'wss://test.dxfeed.com/feed#fragment']) {
    await expect(readCandleFeed(fetcher, url, 'synthetic-token', symbols, range, new AbortController().signal)).rejects.toThrow();
  }
  await expect(readCandleFeed(fetcher, endpoint, 'synthetic-token', symbols, range, AbortSignal.abort())).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it('aborts pending sockets and disposes upgrades that arrive after cancellation', async () => {
  for (const late of [false, true]) {
    const f = fixture(), controller = new AbortController(); let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fetcher = vi.fn<typeof fetch>(async (url, init) => { if (late) await gate; return f.fetcher(url, init); });
    const pending = readCandleFeed(fetcher, endpoint, 'synthetic-token', symbols, range, controller.signal);
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    if (!late) await vi.waitFor(() => expect(f.subscriptions).toHaveLength(1));
    controller.abort(); await rejected; release();
    await vi.waitFor(() => expect(f.upstreams).toHaveLength(1));
    await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
    if (late) expect(f.messages).toEqual([]);
  }
});

it('bounds frame count and cumulative bytes before accepting any partial snapshot', async () => {
  for (const limit of ['frames', 'bytes']) {
    const f = fixture(), controller = new AbortController();
    const selected = ['X'.repeat(200)];
    const pending = readCandleFeed(f.fetcher, endpoint, 'synthetic-token', selected, range, controller.signal);
    const rejected = expect(pending).rejects.toThrow();
    try {
      await vi.waitFor(() => expect(f.subscriptions).toHaveLength(1));
      if (limit === 'frames') for (let i = 0; i < 201; i++) f.send({ type: 'KEEPALIVE', channel: 0 });
      else {
        f.send(frame([candle(selected[0], 4)]));
        const payload = JSON.stringify(frame(Array.from({ length: 200 }, () => candle(selected[0], 0))));
        const bytes = new TextEncoder().encode(payload).length;
        expect(bytes).toBeLessThan(131_072);
        const count = Math.ceil(2_097_152 / bytes) + 1;
        expect(count).toBeLessThan(190); expect(count * 200).toBeLessThan(20_000);
        for (let i = 0; i < count; i++) f.upstreams[0].send(payload);
      }
      await rejected;
      await vi.waitFor(() => expect(f.upstreams[0].readyState).toBe(WebSocket.CLOSED));
    } finally { controller.abort(); }
  }
});

it('refuses completion beyond its absolute deadline even when timer delivery is delayed', async () => {
  const f = fixture(), controller = new AbortController(), now = Date.now();
  const pending = readCandleFeed(f.fetcher, endpoint, 'synthetic-token', symbols, range, controller.signal);
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(f.subscriptions).toHaveLength(1));
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 45_001);
  try { f.send(frame(symbols.map(symbol => candle(symbol)))); await rejected; }
  finally { clock.mockRestore(); controller.abort(); }
});
