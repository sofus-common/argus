import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';

// Protocol: https://developer.tastytrade.com/docs/guides/stream-market-data/
const fields = { Quote: ['eventType', 'eventSymbol', 'bidPrice', 'askPrice', 'bidTime', 'askTime'], Greeks: ['eventType', 'eventSymbol', 'volatility', 'time'] };
const probeRequire = createRequire(import.meta.url);
const WorkspaceSocket = process.argv.includes('--workspace-feed') ? createRequire(createRequire(probeRequire.resolve('wrangler/package.json')).resolve('miniflare'))('ws') : null;
const candleFields = { Candle: ['eventType', 'eventSymbol', 'eventFlags', 'time', 'sequence', 'count', 'open', 'high', 'low', 'close', 'volume'] };
const candleStart = Date.parse('2026-09-04T13:30:00Z'), candleEnd = Date.parse('2026-09-04T20:00:00Z');
function candleState() { return { events: 0, removals: 0, invalid: 0, invalidSamples: [], duplicateRows: 0, begin: false, end: false, snipped: false, pending: false, flags: {}, rows: new Map() }; }
function collectCandle(state, value) {
  assert.ok(Number.isSafeInteger(value.eventFlags) && value.eventFlags >= 0 && Number.isSafeInteger(value.time) && Number.isSafeInteger(value.sequence));
  state.events++; assert.ok(state.events <= 2000);
  const flags = value.eventFlags;
  state.flags[flags] = (state.flags[flags] ?? 0) + 1;
  if (flags & 4) { state.begin = true; state.end = false; state.snipped = false; state.rows.clear(); state.duplicateRows = 0; }
  if (flags & 8) state.end = true;
  if (flags & 16) state.snipped = true;
  state.pending = !!(flags & 1);
  const key = `${value.time}:${value.sequence}`;
  if (flags & 2) { state.removals++; state.rows.delete(key); return; }
  if (!['count', 'open', 'high', 'low', 'close'].every(name => typeof value[name] === 'number' && Number.isFinite(value[name])) || value.count < 0 || !(value.volume === 'NaN' || typeof value.volume === 'number' && Number.isFinite(value.volume) && value.volume >= 0) || value.low < 0 || value.high < value.low || value.open < value.low || value.open > value.high || value.close < value.low || value.close > value.high || value.time <= 0) {
    state.invalid++;
    if (state.invalidSamples.length < 2 && value.time >= candleStart && value.time < candleEnd) state.invalidSamples.push(Object.fromEntries(candleFields.Candle.slice(2).map(name => [name, { value: typeof value[name] === 'number' && Number.isFinite(value[name]) ? value[name] : null, type: value[name] === null ? 'null' : typeof value[name] }])));
    return;
  }
  if (state.rows.has(key)) state.duplicateRows++;
  state.rows.set(key, { ...value, volume: value.volume === 'NaN' ? null : value.volume });
}
function joinSpreadCandles(longRows, shortRows, underlyingRows) {
  const maps = [longRows, shortRows, underlyingRows].map(rows => {
    const map = new Map();
    for (const row of rows) {
      assert.ok(row.sequence === 0 && Number.isSafeInteger(row.time) && (row.time - candleStart) % 300_000 === 0 && !map.has(row.time), 'Ambiguous candle bucket');
      assert.ok(Number.isFinite(row.close) && row.close >= 0);
      map.set(row.time, row.close);
    }
    return map;
  });
  return Array.from({ length: 78 }, (_, i) => {
    const time = candleStart + i * 300_000;
    const long = maps[0].get(time), short = maps[1].get(time);
    const value = long !== undefined && short !== undefined ? (long - short) * 100 : null;
    assert.ok(value === null || Number.isFinite(value));
    return { time: new Date(time).toISOString(), longMarkClose: long ?? null, shortMarkClose: short ?? null, value, underlyingTradeClose: maps[2].get(time) ?? null };
  });
}
function ivSummary(rows) {
  const reported = rows.filter(row => typeof row.impVolatility === 'number' && Number.isFinite(row.impVolatility) && row.impVolatility >= 0);
  const unavailable = rows.filter(row => row.impVolatility === undefined || row.impVolatility === 'NaN');
  return { reported: reported.length, unavailable: unavailable.length, invalid: rows.length - reported.length - unavailable.length,
    samples: reported.slice(0, 3).map(row => ({ time: new Date(row.time).toISOString(), rawImpVolatility: row.impVolatility })) };
}
function candleSummary(state) {
  const rows = [...state.rows.values()].sort((a, b) => a.time - b.time);
  const session = rows.filter(row => row.time >= candleStart && row.time < candleEnd);
  return { events: state.events, removals: state.removals, invalid: state.invalid, invalidSamples: state.invalidSamples, duplicateRows: state.duplicateRows, flags: state.flags, snapshotBegin: state.begin, snapshotEnd: state.end, snapshotSnipped: state.snipped, transactionPending: state.pending,
    complete: state.begin && state.end && !state.snipped && !state.pending && !state.invalid, priceRows: rows.length, sessionRows: session.length,
    firstTime: rows.length ? new Date(rows[0].time).toISOString() : null, lastTime: rows.length ? new Date(rows.at(-1).time).toISOString() : null,
    ...(process.argv.includes('--candle-iv') ? { iv: ivSummary(session) } : {}),
    sampleBars: session.slice(0, 3).map(({ time, sequence, count, open, high, low, close, volume }) => ({ time: new Date(time).toISOString(), sequence, count, open, high, low, close, volume })) };
}
function decode(data, config) {
  assert.ok(Array.isArray(data) && data.length % 2 === 0);
  const events = [];
  for (let i = 0; i < data.length; i += 2) {
    const names = config[data[i]], values = data[i + 1];
    assert.ok(Array.isArray(names) && names.length && Array.isArray(values) && values.length % names.length === 0);
    for (let j = 0; j < values.length; j += names.length) events.push(Object.fromEntries(names.map((name, k) => [name, values[j + k]])));
  }
  return events;
}
if (process.argv.includes('--self-check')) {
  assert.deepEqual(ivSummary([{ time: candleStart, impVolatility: .25 }, { time: candleStart, impVolatility: 0 }, { time: candleStart, impVolatility: 'NaN' }, { time: candleStart }, { time: candleStart, impVolatility: -1 }, { time: candleStart, impVolatility: 'private text' }]), { reported: 2, unavailable: 2, invalid: 2, samples: [{ time: new Date(candleStart).toISOString(), rawImpVolatility: .25 }, { time: new Date(candleStart).toISOString(), rawImpVolatility: 0 }] });
  assert.deepEqual(decode(['Quote', ['Quote', 'SPY', 1, 2, 1000, 2000]], fields), [{ eventType: 'Quote', eventSymbol: 'SPY', bidPrice: 1, askPrice: 2, bidTime: 1000, askTime: 2000 }]);
  assert.throws(() => decode(['Quote', ['Quote']], fields));
  const bar = { eventType: 'Candle', eventSymbol: 'SPY{=5m,price=mark}', eventFlags: 4, time: candleStart, sequence: 0, count: 1, open: 1, high: 2, low: 1, close: 2, volume: 1 };
  assert.deepEqual(decode(['Candle', candleFields.Candle.map(name => bar[name])], candleFields), [bar]);
  const candles = candleState(); collectCandle(candles, bar);
  assert.equal(candleSummary(candles).complete, false);
  collectCandle(candles, { ...bar, eventFlags: 9 }); assert.equal(candleSummary(candles).complete, false);
  collectCandle(candles, { ...bar, eventFlags: 0 }); assert.equal(candleSummary(candles).complete, true);
  collectCandle(candles, { ...bar, eventFlags: 2, open: NaN, high: NaN, low: NaN, close: NaN }); assert.equal(candleSummary(candles).priceRows, 0); assert.equal(candles.invalid, 0);
  collectCandle(candles, { ...bar, eventFlags: 16, time: candleEnd }); assert.equal(candleSummary(candles).complete, false); assert.equal(candleSummary(candles).sampleBars.length, 0);
  assert.throws(() => collectCandle(candles, { ...bar, eventFlags: 1.5 }));
  assert.throws(() => collectCandle({ ...candleState(), events: 2000 }, bar));
  const noVolume = candleState(); collectCandle(noVolume, { ...bar, eventFlags: 12, volume: 'NaN' });
  assert.equal(candleSummary(noVolume).sessionRows, 1);
  assert.equal(candleSummary(noVolume).sampleBars[0].volume, null);
  const missing = candleState(); collectCandle(missing, { ...bar, close: NaN }); assert.equal(candleSummary(missing).priceRows, 0); assert.equal(missing.invalid, 1);
  assert.deepEqual(missing.invalidSamples[0].close, { value: null, type: 'number' });
  collectCandle(missing, { ...bar, volume: 'private server text' }); assert.deepEqual(missing.invalidSamples[1].volume, { value: null, type: 'string' });
  collectCandle(missing, { ...bar, close: null }); assert.equal(missing.invalidSamples.length, 2);
  assert.ok(!JSON.stringify(candleSummary(missing)).includes('private server text'));
  const joined = joinSpreadCandles([{ ...bar, close: 1 }], [{ ...bar, close: 2 }], [{ ...bar, close: 770 }]);
  assert.equal(joined.length, 78); assert.equal(joined[0].value, -100); assert.equal(joined[0].underlyingTradeClose, 770); assert.equal(joined[1].value, null);
  assert.equal(joinSpreadCandles([bar], [], [bar])[0].value, null);
  assert.throws(() => joinSpreadCandles([bar, bar], [], []));
  assert.throws(() => joinSpreadCandles([{ ...bar, sequence: 1 }], [], []));
  assert.throws(() => joinSpreadCandles([{ ...bar, time: candleStart + 1 }], [], []));
  console.log('DXLink compact decoder self-check passed.');
} else {
  if (!process.argv.includes('--run')) throw new Error('Pass --run for a bounded read-only DXLink probe, or --self-check.');
  let socket, keepalive, deadline;
  const intradayApi = process.argv.includes('--intraday-api');
  assert.ok(!process.argv.includes('--candle-iv') || process.argv.includes('--candles') && !intradayApi, '--candle-iv requires the direct --candles probe');
  const spreadCandles = process.argv.includes('--spread-candles') || intradayApi;
  assert.ok(!spreadCandles || !['--last-trade', '--from-seconds'].some(flag => process.argv.includes(flag)), 'Spread candles require option marks and millisecond bounds');
  const candles = process.argv.includes('--candles') || spreadCandles, probeStarted = Date.now();
  const candleDeadline = candles ? AbortSignal.timeout(intradayApi ? 85_000 : 45_000) : null;
  let stage = 'local-chain';
  let report = { setup: false, authorized: false, channelOpened: false, configured: false, counts: {}, receivedCounts: {}, latest: {} };
  try {
    assert.equal(typeof WebSocket, 'function');
    const chainTimeout = AbortSignal.timeout(35_000);
    const loaded = await fetch('http://127.0.0.1:5173/api/chain?symbol=SPY', { signal: candleDeadline ? AbortSignal.any([chainTimeout, candleDeadline]) : chainTimeout });
    assert.equal(loaded.status, 200);
    const { snapshot } = await loaded.json();
    assert.equal(snapshot.underlying, 'SPY');
    const contract = snapshot.contracts.filter(c => c.type === 'call').sort((a, b) => Math.abs(a.strike - snapshot.spot) - Math.abs(b.strike - snapshot.spot))[0];
    assert.ok(contract && /^SPY {3}\d{6}C\d{8}$/.test(contract.contractId));
    const upper = spreadCandles ? snapshot.contracts.filter(c => c.type === 'call' && c.expiry === contract.expiry && c.strike > contract.strike).sort((a, b) => a.strike - b.strike)[0] : null;
    if (spreadCandles) { assert.ok(upper && /^SPY {3}\d{6}C\d{8}$/.test(upper.contractId)); report.shortContractId = upper.contractId; }
    report.underlying = snapshot.underlying;
    report.contractId = contract.contractId;
    registerHooks({ resolve(specifier, context, next) {
      return next(specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) ? new URL(`${specifier}.ts`, context.parentURL).href : specifier, context);
    } });
    if (process.argv.includes('--workspace-feed')) {
      assert.ok(!candles, 'Workspace feed probe cannot be combined with candle probes');
      stage = 'workspace-feed';
      const { createMarketStrategy } = await import('../src/options.ts');
      const { streamFreshness } = await import('../src/stream-freshness.ts');
      const selected = createMarketStrategy('iron-condor', snapshot).legs.map(leg => leg.contractId);
      const expected = [snapshot.underlying, ...selected];
      const observations = Object.fromEntries(expected.map(id => [id, { quote: null, greeks: null }]));
      report = { mode: 'workspace-feed', snapshotId: snapshot.id, contracts: selected, statuses: [], frames: 0, sourceAdvances: 0, advancesBySource: {}, events: {}, startedAt: new Date().toISOString() };
      const url = new URL('ws://127.0.0.1:5173/api/feed');
      url.search = new URLSearchParams({ snapshot: snapshot.id, contracts: selected.join(',') }).toString();
      stage = 'workspace-handshake';
      socket = new WorkspaceSocket(url, { origin: 'http://127.0.0.1:5173' });
      await new Promise((done, reject) => {
        deadline = setTimeout(done, 30000);
        socket.on('unexpected-response', (_request, response) => { report.httpStatus = response.statusCode; response.resume(); reject(new Error('Upgrade rejected')); });
        socket.addEventListener('error', () => reject(new Error('Local feed transport failed')));
        socket.addEventListener('close', () => { report.closed = true; done(); });
        socket.addEventListener('message', event => {
          try {
            assert.ok(++report.frames <= 500 && typeof event.data === 'string' && event.data.length <= 16384);
            const value = JSON.parse(event.data);
            if (value.type === 'status') {
              assert.ok(['connecting', 'connected', 'reconnecting', 'unavailable'].includes(value.state));
              report.statuses.push(value.state);
              if (value.state !== 'connected') for (const observation of Object.values(observations)) { observation.quote = null; observation.greeks = null; }
              return;
            }
            assert.ok(expected.includes(value.contractId) && ['quote', 'greeks'].includes(value.type));
            assert.ok(Number.isFinite(Date.parse(value.receivedAt)));
            const times = value.type === 'quote' ? [value.bidTime, value.askTime] : [value.time];
            assert.ok(times.every(time => time === null || Number.isSafeInteger(time) && time > 0));
            if (value.type === 'quote') assert.ok(Number.isFinite(value.bid) && Number.isFinite(value.ask) && value.bid >= 0 && value.ask >= value.bid && value.ask > 0);
            else assert.ok(selected.includes(value.contractId) && Number.isFinite(value.iv) && value.iv > 0 && value.iv <= 10);
            const key = `${value.contractId}:${value.type}`, old = observations[value.contractId][value.type];
            if (old && [...old.times, ...times].every(time => time !== null) && Math.min(...times) > Math.min(...old.times)) {
              report.sourceAdvances++; report.advancesBySource[key] = (report.advancesBySource[key] ?? 0) + 1;
            }
            report.events[key] = (report.events[key] ?? 0) + 1;
            observations[value.contractId][value.type] = { times, receivedAt: value.receivedAt };
          } catch { reject(new Error('Invalid local feed event')); }
        });
      });
      const required = expected.flatMap(id => id === snapshot.underlying ? [observations[id].quote] : [observations[id].quote, observations[id].greeks]);
      report.coverage = expected.map(id => ({ contractId: id, quote: !!observations[id].quote, iv: id === snapshot.underlying ? 'not-required' : !!observations[id].greeks,
        quoteSourceTimes: observations[id].quote?.times.map(time => time === null ? null : new Date(time).toISOString()) ?? null,
        ivSourceTime: observations[id].greeks?.times.map(time => time === null ? null : new Date(time).toISOString()) ?? null }));
      report.captureEligibility = report.closed || report.statuses.at(-1) !== 'connected' ? 'disconnected' : required.every(Boolean) ? streamFreshness(required.flatMap(value => value.times), required.map(value => Date.parse(value.receivedAt)), Date.now()) : 'incomplete';
      report.endedAt = new Date().toISOString();
      report.result = report.captureEligibility === 'ready' && report.sourceAdvances > 0 ? 'Complete recent selected-source coverage with timestamp advancement during this bounded sample; sustained market-open quality remains unproven.' : 'Current selected-source coverage or progression insufficient; connection alone is not real-time data proof.';
      if (report.captureEligibility !== 'ready' || report.sourceAdvances === 0) process.exitCode = 1;
    } else if (intradayApi) {
      stage = 'intraday-api';
      const { createMarketStrategy, marketLeg, validateMarketStrategy } = await import('../src/options.ts');
      const state = createMarketStrategy('bull-call', snapshot);
      state.legs = [marketLeg(contract, 'long'), marketLeg(upper, 'short')];
      assert.deepEqual(validateMarketStrategy(state, snapshot), []);
      const range = { start: candleStart, end: candleEnd };
      const response = await fetch('http://127.0.0.1:5173/api/intraday-history', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173', 'X-ARGUS-Request': '1' }, body: JSON.stringify({ state, range }), signal: candleDeadline });
      assert.equal(response.status, 200);
      const body = await response.json(), history = body.history;
      assert.equal(body.snapshotId, snapshot.id); assert.equal(body.positionVersion, state.version); assert.deepEqual(body.range, range);
      assert.equal(history.source, 'Tastytrade DXLink'); assert.equal(history.basis, 'option-midpoints'); assert.equal(history.intervalMs, 300_000);
      assert.equal(history.rows.length, 78);
      for (const [i, row] of history.rows.entries()) {
        assert.equal(row.time, candleStart + i * 300_000);
        assert.deepEqual(row.legs.map(leg => leg.contractId), state.legs.map(leg => leg.contractId));
        assert.ok(row.legs.every(leg => typeof leg.close === 'number' && Number.isFinite(leg.close)));
        assert.ok(typeof row.value === 'number' && Number.isFinite(row.value));
        assert.ok(Math.abs(row.value - (row.legs[0].close - row.legs[1].close) * 100) < 1e-8);
      }
      report = { mode: 'intraday-api', status: response.status, source: history.source, basis: history.basis, contracts: state.legs.map(leg => leg.contractId), expectedBuckets: 78, matched: history.rows.filter(row => row.value !== null).length, underlyingTradeBuckets: history.rows.filter(row => row.underlying !== null).length, samples: [...history.rows.slice(0, 3), ...history.rows.slice(-3)], result: 'Actual local API through shared feed and projection. Fixed inventory estimates, not historical P/L or executions.' };
    } else {
    const { createBrokerRequest, tastyToken } = await import('../src/broker-context.ts');
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
    const env = parseEnv(readFileSync(resolve(dirname(resolve(common)), '.env'), 'utf8'));
    const request = createBrokerRequest(candleDeadline ? (url, init) => fetch(url, { ...init, signal: AbortSignal.any([candleDeadline, ...(init?.signal ? [init.signal] : [])]) }) : fetch);
    stage = 'read-oauth';
    const token = await tastyToken(env, request);
    const get = path => request(`https://api.tastyworks.com${path}`, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'argus/0.1' } });
    stage = 'stream-metadata';
    const [{ data: instrument }, { data: equity }, { data: auth }, upperResponse] = await Promise.all([
      get(`/instruments/equity-options/${encodeURIComponent(contract.contractId)}`), get('/instruments/equities/SPY'), get('/api-quote-tokens'),
      ...(upper ? [get(`/instruments/equity-options/${encodeURIComponent(upper.contractId)}`)] : []),
    ]);
    assert.equal(instrument.symbol, contract.contractId);
    assert.equal(instrument['underlying-symbol'], 'SPY');
    assert.equal(instrument['root-symbol'], 'SPY');
    assert.equal(instrument['shares-per-contract'], 100);
    assert.equal(instrument['option-chain-type'], 'Standard');
    if (upper) {
      assert.equal(upperResponse.data.symbol, upper.contractId);
      assert.equal(upperResponse.data['underlying-symbol'], 'SPY');
      assert.equal(upperResponse.data['root-symbol'], 'SPY');
      assert.equal(upperResponse.data['shares-per-contract'], 100);
      assert.equal(upperResponse.data['option-chain-type'], 'Standard');
      assert.ok(typeof upperResponse.data['streamer-symbol'] === 'string' && upperResponse.data['streamer-symbol']);
    }
    assert.equal(equity.symbol, 'SPY');
    const optionSymbol = instrument['streamer-symbol'], equitySymbol = equity['streamer-symbol'];
    assert.ok(typeof optionSymbol === 'string' && optionSymbol && typeof equitySymbol === 'string' && equitySymbol);
    const endpoint = new URL(auth['dxlink-url']);
    assert.ok(endpoint.protocol === 'wss:' && endpoint.hostname.endsWith('.dxfeed.com') && !endpoint.username && !endpoint.password);
    assert.ok(typeof auth.token === 'string' && auth.token);
    candleDeadline?.throwIfAborted();
    const requestedFields = candles ? process.argv.includes('--candle-iv') ? { Candle: [...candleFields.Candle, 'impVolatility'] } : candleFields : fields;
    const candleDecorator = process.argv.includes('--last-trade') ? '{=5m}' : '{=5m,price=mark}';
    const candleSymbols = spreadCandles ? [`${equitySymbol}{=5m}`, `${optionSymbol}{=5m,price=mark}`, `${upperResponse.data['streamer-symbol']}{=5m,price=mark}`] : [`${equitySymbol}${candleDecorator}`, `${optionSymbol}${candleDecorator}`];
    const candleStates = Object.fromEntries(candleSymbols.map(symbol => [symbol, candleState()]));
    const snapshotParser = candles ? (await import('../src/candle-history.ts')).createCandleSnapshot(candleSymbols, { start: candleStart, end: candleEnd }) : null;
    const fromTime = process.argv.includes('--from-seconds') ? Math.floor(candleStart / 1000) : candleStart;
    if (candles) Object.assign(report, { mode: 'candles', fromTime, fromTimeUnit: process.argv.includes('--from-seconds') ? 'seconds diagnostic' : 'milliseconds', interval: process.argv.includes('--last-trade') ? '5m last trade' : '5m mark', sessionStart: new Date(candleStart).toISOString(), sessionEndExclusive: new Date(candleEnd).toISOString(), frames: 0, rows: 0, bytes: 0 });
    if (spreadCandles) Object.assign(report, { mode: 'spread-candles', interval: '5m option marks; separate underlying last trade', candleRoles: { underlyingTrade: candleSymbols[0], longMark: candleSymbols[1], shortMark: candleSymbols[2] } });
    stage = 'socket';
    socket = new WebSocket(endpoint);
    await new Promise((resolveProbe, reject) => {
      let config = {};
      const send = message => socket.send(JSON.stringify(message));
      const fail = () => reject(new Error('Probe failed'));
      deadline = setTimeout(() => { report.sessionLimitReached = true; resolveProbe(); }, candles ? Math.max(1, 45_000 - (Date.now() - probeStarted)) : 45_000);
      socket.addEventListener('open', () => {
        stage = 'setup';
        send({ type: 'SETUP', channel: 0, version: '0.1-DXF-JS/0.3.0', keepaliveTimeout: 60, acceptKeepaliveTimeout: 60 });
        keepalive = setInterval(() => { if (socket.readyState === WebSocket.OPEN) send({ type: 'KEEPALIVE', channel: 0 }); }, 30_000);
      });
      socket.addEventListener('error', fail);
      socket.addEventListener('close', () => { report.closedByProvider = true; resolveProbe(); });
      socket.addEventListener('message', event => {
        try {
          assert.ok(typeof event.data === 'string' && event.data.length <= 131_072);
          if (candles) {
            const bytes = Buffer.byteLength(event.data);
            if (report.frames === 200 || report.bytes + bytes > 1_048_576) { report.boundReached = true; resolveProbe(); return; }
            report.frames++; report.bytes += bytes;
          }
          const message = JSON.parse(event.data);
          if (message.type === 'SETUP') { assert.equal(message.channel, 0); report.setup = true; }
          else if (message.type === 'AUTH_STATE' && message.state === 'UNAUTHORIZED') {
            assert.ok(report.setup); stage = 'auth'; send({ type: 'AUTH', channel: 0, token: auth.token });
          } else if (message.type === 'AUTH_STATE' && message.state === 'AUTHORIZED') {
            assert.equal(stage, 'auth'); report.authorized = true; stage = 'channel';
            send({ type: 'CHANNEL_REQUEST', channel: 3, service: 'FEED', parameters: { contract: 'AUTO' } });
          } else if (message.type === 'CHANNEL_OPENED') {
            assert.ok(report.authorized); assert.equal(message.channel, 3); report.channelOpened = true; stage = 'configuration';
            send({ type: 'FEED_SETUP', channel: 3, acceptAggregationPeriod: 0.1, acceptDataFormat: 'COMPACT', acceptEventFields: requestedFields });
            send({ type: 'FEED_SUBSCRIPTION', channel: 3, reset: true, add: candles ? candleSymbols.map(symbol => ({ type: 'Candle', symbol, fromTime })) : [{ type: 'Quote', symbol: equitySymbol }, { type: 'Quote', symbol: optionSymbol }, { type: 'Greeks', symbol: optionSymbol }] });
          } else if (message.type === 'FEED_CONFIG') {
            assert.ok(report.channelOpened); assert.equal(message.channel, 3); assert.equal(message.dataFormat, 'COMPACT');
            for (const [type, names] of Object.entries(message.eventFields ?? {})) {
              assert.ok(requestedFields[type] && Array.isArray(names) && requestedFields[type].every(name => names.includes(name)) && names.every(name => requestedFields[type].includes(name)));
              config[type] = names;
            }
            report.configured = true; report.fields = config; stage = 'events';
          } else if (message.type === 'FEED_DATA') {
            assert.ok(report.configured); assert.equal(message.channel, 3);
            for (const value of decode(message.data, config)) {
              if (candles) {
                if (report.rows === 2000) { report.boundReached = true; resolveProbe(); return; }
                report.rows++;
                assert.equal(value.eventType, 'Candle'); assert.ok(candleStates[value.eventSymbol]);
                snapshotParser.push(value);
                collectCandle(candleStates[value.eventSymbol], value);
                report.candles = Object.fromEntries(Object.entries(candleStates).map(([symbol, state]) => [symbol, candleSummary(state)]));
                continue;
              }
              assert.ok(value.eventSymbol === equitySymbol || value.eventSymbol === optionSymbol);
              assert.ok(value.eventType === 'Quote' || value.eventType === 'Greeks' && value.eventSymbol === optionSymbol);
              const key = `${value.eventSymbol === equitySymbol ? 'underlying' : 'option'}-${value.eventType}`;
              const latest = { receivedAt: new Date().toISOString() };
              for (const name of fields[value.eventType].slice(2)) {
                assert.ok(typeof value[name] === 'number' && Number.isFinite(value[name]));
                latest[name] = value[name];
              }
              const valid = value.eventType === 'Quote'
                ? value.bidPrice >= 0 && value.askPrice > 0 && value.askPrice >= value.bidPrice && value.bidTime > 0 && value.askTime > 0 && value.bidTime <= Date.now() && value.askTime <= Date.now()
                : value.volatility > 0 && value.volatility <= 10 && value.time > 0 && value.time <= Date.now();
              latest.valid = valid;
              report.receivedCounts[key] = (report.receivedCounts[key] ?? 0) + 1;
              if (valid) report.counts[key] = (report.counts[key] ?? 0) + 1;
              report.latest[key] = latest;
            }
            if (candles ? Object.values(candleStates).every(state => state.end && !state.pending) : Object.keys(report.receivedCounts).length === 3) resolveProbe();
          } else if (message.type === 'ERROR') fail();
        } catch { fail(); }
      });
    });
    assert.ok(report.setup && report.authorized && report.channelOpened && report.configured);
    if (candles) {
      report.candles = Object.fromEntries(Object.entries(candleStates).map(([symbol, state]) => [symbol, candleSummary(state)]));
      const complete = !report.boundReached && Object.values(report.candles).every(value => value.complete && value.sessionRows > 0);
      report.parserComplete = snapshotParser.complete();
      if (spreadCandles && !report.boundReached && Object.values(report.candles).every(value => value.complete)) {
        assert.ok(Object.values(candleStates).every(state => state.duplicateRows === 0), 'Duplicate candle bucket received');
        const parsed = snapshotParser.read();
        const bars = symbol => parsed[symbol].map(bar => ({ ...bar, sequence: 0 }));
        const rows = joinSpreadCandles(bars(candleSymbols[1]), bars(candleSymbols[2]), bars(candleSymbols[0]));
        const matched = rows.filter(row => row.value !== null).length;
        report.spread = { expectedBuckets: rows.length, matched, missing: rows.length - matched, underlyingTradeBuckets: rows.filter(row => row.underlyingTradeClose !== null).length, samples: [...rows.slice(0, 3), ...rows.slice(-3)], basis: 'Fixed long-one/short-one inventory mark-close estimate in total USD. Underlying trade close is separate. Not synchronized quotes, fills, P/L or composite OHLC extrema.' };
      }
      report.result = complete ? 'Bounded Candle snapshots ended for all subscribed symbols; session coverage, alignment and executable pricing remain unproven.' : 'Candle coverage incomplete; quiet or deadline does not prove a completed snapshot.';
      if (!complete) process.exitCode = 1;
    } else {
      report.result = Object.keys(report.counts).length === 3 ? 'Validated initial quote and IV events; continuous movement not proven.' : 'Subscription accepted; valid timestamped event coverage incomplete.';
      if (Object.keys(report.counts).length !== 3) process.exitCode = 1;
    }
    }
  } catch {
    report.result = 'Probe failed; private response suppressed.';
    report.failedStage = stage;
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline); clearInterval(keepalive);
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000);
    console.log(JSON.stringify(report));
    if (!intradayApi) setTimeout(() => process.exit(process.exitCode ?? 0), 1000).unref();
  }
}
