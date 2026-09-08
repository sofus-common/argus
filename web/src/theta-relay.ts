import { DurableObject } from 'cloudflare:workers';
import { createBrokerRequest, thetaRelayConfig, validateThetaPaths, type BrokerBindings } from './broker-context';

type Admission = { nextStart: number; leaseUntil: number };

export function createThetaRelay(env: BrokerBindings, storage: Pick<DurableObjectStorage, 'get' | 'put'>, fetcher: typeof fetch = fetch) {
  let admission: Admission = { nextStart: 0, leaseUntil: 0 }, busy = false, initialized = false;
  const ready = storage.get<Admission>('admission').then(value => {
    if (value !== undefined) {
      if (!value || Object.keys(value).sort().join() !== 'leaseUntil,nextStart' || !Number.isSafeInteger(value.nextStart) || !Number.isSafeInteger(value.leaseUntil) || value.nextStart < 0 || value.leaseUntil < 0) throw new Error('Invalid admission');
      admission = value;
    }
    initialized = true;
  }).catch(() => {});
  const upstream = createBrokerRequest(fetcher);
  const reply = (text: string, status: number) => new Response(text, { status, headers: { 'Cache-Control': 'no-store' } });
  return {
    ready,
    async fetch(request: Request): Promise<Response> {
      if (request.method !== 'POST' || request.url !== 'https://theta.internal/history') return reply('Not found', 404);
      if (busy) return reply('Theta history busy', 429);
      busy = true;
      try {
        await ready;
        const config = thetaRelayConfig(env);
        if (!initialized || !config) return reply('Theta history unavailable', 503);
        let paths: string[];
        try {
          if (!request.body || Number(request.headers.get('content-length')) > 8192) throw new Error();
          const reader = request.body.getReader();
          let timer: ReturnType<typeof setTimeout> | undefined;
          const body = await Promise.race([
            new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new Error()); }, 5000); }),
            (async () => {
              const decoder = new TextDecoder('utf-8', { fatal: true });
              let text = '', bytes = 0;
              try {
                for (;;) {
                  const chunk = await reader.read();
                  if (chunk.done) break;
                  bytes += chunk.value.byteLength;
                  if (bytes > 8192) throw new Error();
                  text += decoder.decode(chunk.value, { stream: true });
                }
                return JSON.parse(text + decoder.decode());
              } finally { void reader.cancel().catch(() => {}); }
            })(),
          ]).finally(() => clearTimeout(timer));
          if (!body || typeof body !== 'object' || Object.keys(body).join() !== 'paths') throw new Error();
          validateThetaPaths(body.paths);
          paths = body.paths;
        } catch { return reply('Invalid Theta request', 400); }
        const results = [];
        for (const path of paths) {
          const wait = Math.max(admission.nextStart, admission.leaseUntil) - Date.now();
          if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
          const start = Date.now();
          admission = { nextStart: start + 3500, leaseUntil: start + 5000 };
          await storage.put('admission', admission);
          const upstreamStart = Date.now(), remaining = admission.leaseUntil - upstreamStart;
          if (remaining < 3500) throw new Error('Admission expired');
          admission.nextStart = upstreamStart + 3500;
          results.push(await upstream(config.origin + path, { headers: config.headers }, 131_072, remaining));
          admission = { ...admission, leaseUntil: 0 };
          await storage.put('admission', admission);
        }
        return Response.json(results, { headers: { 'Cache-Control': 'no-store' } });
      } catch { return reply('Theta history unavailable', 503); }
      finally { busy = false; }
    },
  };
}

export class ThetaHistory extends DurableObject<BrokerBindings> {
  private relay;
  constructor(ctx: DurableObjectState, env: BrokerBindings) {
    super(ctx, env);
    this.relay = createThetaRelay(env, ctx.storage);
    ctx.blockConcurrencyWhile(() => this.relay.ready);
  }
  fetch(request: Request): Promise<Response> { return this.relay.fetch(request); }
}
