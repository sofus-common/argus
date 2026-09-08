import { createCandleSnapshot, type CandleRow } from './candle-history';

const fields = ['eventType', 'eventSymbol', 'eventFlags', 'time', 'sequence', 'count', 'open', 'high', 'low', 'close', 'volume'];

export async function readCandleFeed<M extends 'price' | 'iv' = 'price'>(fetcher: typeof fetch, url: string, token: string, symbols: string[], range: { start: number; end: number }, signal: AbortSignal, mode: M = 'price' as M): Promise<Record<string, CandleRow<M>[]>> {
  const snapshot = createCandleSnapshot(symbols, range, mode), selected = [...symbols], fromTime = range.start;
  const requestedFields = mode === 'iv' ? [...fields.slice(0, 5), 'impVolatility'] : fields;
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'wss:' || !endpoint.hostname.endsWith('.dxfeed.com') || endpoint.username || endpoint.password || endpoint.port && endpoint.port !== '443' || endpoint.hash
    || typeof token !== 'string' || !token || token.length > 16_384 || /[\s\x00-\x1f]/.test(token)) throw new Error('Invalid candle feed metadata');
  signal.throwIfAborted();
  endpoint.protocol = 'https:';
  const deadline = Date.now() + 45_000;
  return new Promise((resolve, reject) => {
    let socket: WebSocket | undefined, done = false, phase = 'setup', names: string[] | undefined, frames = 0, bytes = 0;
    const controller = new AbortController();
    const close = (value?: WebSocket) => { try { value?.close(1000, 'History finished'); } catch {} };
    const finish = (error?: Error) => {
      if (done) return;
      if (!error && (signal.aborted || Date.now() >= deadline)) error = new Error('Candle history expired');
      done = true; clearTimeout(timer); signal.removeEventListener('abort', aborted); controller.abort(); close(socket);
      if (error) reject(error); else resolve(snapshot.read());
    };
    const aborted = () => finish(new Error('Candle history cancelled or expired'));
    const timer = setTimeout(aborted, 45_000);
    signal.addEventListener('abort', aborted, { once: true });
    const send = (value: unknown) => socket!.send(JSON.stringify(value));
    void (async () => {
      const response = await fetcher(endpoint.toString(), { headers: { Upgrade: 'websocket' }, redirect: 'manual', signal: controller.signal });
      if (done || signal.aborted || Date.now() >= deadline) {
        try { response.webSocket?.accept(); } catch {}
        close(response.webSocket ?? undefined); aborted(); return;
      }
      if (response.status !== 101 || !response.webSocket) { void response.body?.cancel().catch(() => {}); throw new Error('Candle feed upgrade failed'); }
      socket = response.webSocket; socket.accept();
      socket.addEventListener('close', () => finish(new Error('Candle snapshot interrupted')));
      socket.addEventListener('error', () => finish(new Error('Candle feed unavailable')));
      socket.addEventListener('message', event => {
        if (done) return;
        try {
          if (signal.aborted || Date.now() >= deadline) throw new Error();
          if (++frames > 200 || typeof event.data !== 'string' || event.data.length > 131_072) throw new Error();
          const size = new TextEncoder().encode(event.data).length;
          if (size > 131_072 || (bytes += size) > 2_097_152) throw new Error();
          const message = JSON.parse(event.data);
          if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error();
          if (message.type === 'SETUP') {
            if (phase !== 'setup' || message.channel !== 0) throw new Error();
            phase = 'unauthorized';
          } else if (message.type === 'AUTH_STATE') {
            if (message.channel !== 0) throw new Error();
            if (phase === 'unauthorized' && message.state === 'UNAUTHORIZED') {
              phase = 'auth'; send({ type: 'AUTH', channel: 0, token });
            } else if (phase === 'auth' && message.state === 'AUTHORIZED') {
              phase = 'opening'; send({ type: 'CHANNEL_REQUEST', channel: 3, service: 'FEED', parameters: { contract: 'AUTO' } });
            } else throw new Error();
          } else if (message.type === 'CHANNEL_OPENED') {
            if (phase !== 'opening' || message.channel !== 3) throw new Error();
            phase = 'channel';
            send({ type: 'FEED_SETUP', channel: 3, acceptAggregationPeriod: 0.1, acceptDataFormat: 'COMPACT', acceptEventFields: { Candle: requestedFields } });
            send({ type: 'FEED_SUBSCRIPTION', channel: 3, reset: true, add: selected.map(symbol => ({ type: 'Candle', symbol, fromTime })) });
          } else if (message.type === 'FEED_CONFIG') {
            if (phase !== 'channel' || message.channel !== 3 || message.dataFormat !== 'COMPACT' || message.eventFields !== undefined && (!message.eventFields || typeof message.eventFields !== 'object' || Array.isArray(message.eventFields))) throw new Error();
            for (const [type, value] of Object.entries(message.eventFields ?? {})) {
              if (type !== 'Candle' || !Array.isArray(value) || value.length !== requestedFields.length || new Set(value).size !== requestedFields.length || requestedFields.some(field => !value.includes(field))) throw new Error();
              names = value;
            }
          } else if (message.type === 'FEED_DATA') {
            if (phase !== 'channel' || message.channel !== 3 || !names || !Array.isArray(message.data) || message.data.length % 2) throw new Error();
            for (let i = 0; i < message.data.length; i += 2) {
              const values = message.data[i + 1];
              if (message.data[i] !== 'Candle' || !Array.isArray(values) || values.length % names.length) throw new Error();
              for (let j = 0; j < values.length; j += names.length) snapshot.push(Object.fromEntries(names.map((name, index) => [name, values[j + index]])));
            }
            if (snapshot.complete()) finish();
          } else if (message.type !== 'KEEPALIVE' || message.channel !== 0) throw new Error();
        } catch { finish(new Error('Invalid or incomplete candle feed')); }
      });
      send({ type: 'SETUP', channel: 0, version: '0.1-DXF-JS/0.3.0', keepaliveTimeout: 60, acceptKeepaliveTimeout: 60 });
    })().catch(() => finish(new Error('Candle feed unavailable')));
  });
}
