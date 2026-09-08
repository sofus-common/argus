import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import candidate from '../prompts/analysis-v18.json';
import { defaultAnalysisPrompts } from '../src/analysis-prompts';
import { createMarketStrategy, searchCandidates, type MarketSnapshot } from '../src/options';
import { parseSparringRequest, spar, type SparringRequest } from '../src/sparring';

const date = '2027-10-09T20:00:00.000Z', now = '2027-09-01T12:00:00.000Z';
const snapshot: MarketSnapshot = {
  id: 'discovery-runtime', source: 'Tastytrade', underlying: 'SPY', spot: 100, retrievedAt: now, spotAsOf: now,
  availableExpiries: [date.slice(0, 10)], contracts: [90, 100].map(strike => ({
    contractId: `SPY   271009P${String(strike * 1000).padStart(8, '0')}`, type: 'put', strike, expiry: date,
    multiplier: 100, bid: 1.9, ask: 2.1, iv: .25, quoteAsOf: now,
  })),
};
const evidence = (quote: string, message = 0) => ({ message, quote });
const request = (outlay = true): SparringRequest => ({
  request_id: 'discovery-runtime', base_state_version: 1, discovery: true,
  state: createMarketStrategy('long-put', snapshot, 'natural'),
  conversation: [{ role: 'user', content: `Find new bear put spreads only. Target SPY at $103 on ${date}. Rank by target P/L, with a maximum loss of $2000, total fee allowance $5 and natural quote pricing.${outlay ? ' Maximum net entry outlay is $1500.' : ''}` }],
});
const intent = (outlay = true) => ({
  scope: 'search', families: [evidence('bear put spreads')], targetSpot: evidence('Target SPY at $103'), targetDate: evidence(`on ${date}`),
  maxLoss: evidence('maximum loss of $2000'), feeAllowance: evidence('total fee allowance $5'), basis: evidence('natural quote pricing'),
  objective: evidence('Rank by target P/L'), maxEntryOutlay: outlay ? evidence('Maximum net entry outlay is $1500') : null,
});
const provider = (value: unknown) => vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] }));

describe('single-call evidence-only discovery runtime', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); });
  afterEach(() => { vi.useRealTimers(); });

  it('searches exactly the evidenced bear-put domain and renders correct money without a verifier or mutation', async () => {
    const input = request(); input.state.pricing!.entryMode = 'fixed'; input.state.legs[0].entryPrice = 8;
    const before = structuredClone(input), fetcher = provider(intent());
    const result = await spar(input, 'synthetic-key', fetcher, undefined, snapshot, candidate);
    expect(fetcher).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.messages[0].content).toBe(candidate.prompts.DISCOVERY_INTENT_PROMPT);
    expect(body.response_format.json_schema.name).toBe('discovery_intent');
    expect(body.tools).toBeUndefined(); expect(body.tool_choice).toBeUndefined();
    expect(JSON.parse(body.messages[1].content).conversation).toEqual(input.conversation);
    const expected = searchCandidates(input.state, snapshot, { targetSpot: 103, targetDate: date, maxLoss: 2000, feeAllowance: 5, basis: 'natural', objective: 'target-pnl' }, { families: ['bear-put'], maxEntryOutlay: 1500 });
    expect(result.calculated.candidateSearch).toEqual(expected);
    expect(expected.candidates[0].metrics.maxProfit).toBe(975);
    expect(result.reply.text).toContain('USD 975.00');
    expect(result.reply.text).not.toContain('USD 475.00');
    expect(result.reply.operations).toEqual([]);
    expect(result.next_state).toEqual({ ...input.state, version: input.state.version + 1 });
    expect(input).toEqual(before);
  });

  it('clarifies missing outlay without search and uses only the explicit user follow-up', async () => {
    const input = request(false), before = structuredClone(input), first = provider(intent(false));
    const clarification = await spar(input, 'synthetic-key', first, undefined, snapshot, candidate);
    expect(first).toHaveBeenCalledOnce();
    expect(clarification.reply.text).toMatch(/maximum net entry outlay/i);
    expect(clarification.calculated.candidateSearch).toBeNull();
    expect(clarification.reply.operations).toEqual([]); expect(input).toEqual(before);
    input.conversation.push({ role: 'assistant', content: clarification.reply.text }, { role: 'user', content: 'net entry outlay is $1500' });
    const followup = provider({ ...intent(false), maxEntryOutlay: evidence('net entry outlay is $1500', 2) });
    const searched = await spar(input, 'synthetic-key', followup, undefined, snapshot, candidate);
    expect(followup).toHaveBeenCalledOnce();
    expect(searched.calculated.candidateSearch?.domain).toEqual({ families: ['bear-put'], maxEntryOutlay: 1500 });
    expect(searched.reply.operations).toEqual([]);
  });

  it('fails before inference when the prompt is unavailable or another analysis scope is supplied', async () => {
    const input = request(), fetcher = provider(intent());
    await expect(spar(input, 'synthetic-key', fetcher, undefined, snapshot, defaultAnalysisPrompts)).rejects.toThrow();
    for (const scope of [{ chart_context: { view: 'curve', metric: 'pnl' } }, { probability_range: { lower: 90, upper: 110 } }, { first_expiry_range: { min: 90, max: 110 } }, { candidate_selection: { id: 'other', request: {} } }]) {
      expect(parseSparringRequest({ ...input, ...scope })).toBeNull();
      await expect(spar({ ...input, ...scope } as SparringRequest, 'synthetic-key', fetcher, undefined, snapshot, candidate)).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps the normal discussion provider payload identical to v16 when v18 is configured', async () => {
    const input = request(); delete input.discovery;
    const before = structuredClone(input), bodies: unknown[] = [];
    for (const bundle of [defaultAnalysisPrompts, candidate]) {
      const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response('', { status: 503 });
      });
      await expect(spar(input, 'synthetic-key', fetcher, undefined, snapshot, bundle)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledOnce();
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(input).toEqual(before);
  });

  it('rejects unbound and assistant evidence, extra values and tool calls in one attempt', async () => {
    const input = request(); input.conversation.push({ role: 'assistant', content: 'maximum loss of $9999' });
    const before = structuredClone(input);
    for (const value of [{ ...intent(), maxLoss: evidence('maximum loss of $9999') }, { ...intent(), maxLoss: evidence('maximum loss of $9999', 1) }, { ...intent(), text: 'Maximum profit is $475' }, { ...intent(), maxLoss: { ...evidence('maximum loss of $2000'), value: 2000 } }]) {
      const fetcher = provider(value);
      await expect(spar(input, 'synthetic-key', fetcher, undefined, snapshot, candidate)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledOnce();
    }
    const tool = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: JSON.stringify(intent()), tool_calls: [{ id: 'unexpected', type: 'function', function: { name: 'search_candidates', arguments: '{}' } }] } }] }));
    await expect(spar(input, 'synthetic-key', tool, undefined, snapshot, candidate)).rejects.toThrow();
    expect(tool).toHaveBeenCalledOnce(); expect(input).toEqual(before);
  });

  it('clarifies another symbol or currency rather than searching the workspace with those values', async () => {
    for (const change of ['symbol', 'currency']) {
      const input = request(), extracted = intent();
      if (change === 'symbol') { input.conversation[0].content = input.conversation[0].content.replace('Target SPY', 'Target QQQ'); extracted.targetSpot = evidence('Target QQQ at $103'); }
      else input.conversation[0].content = input.conversation[0].content.replace('maximum loss of $2000', 'maximum loss of $2000 CAD');
      const fetcher = provider(extracted), before = structuredClone(input);
      const result = await spar(input, 'synthetic-key', fetcher, undefined, snapshot, candidate);
      expect(result.calculated.candidateSearch).toBeNull();
      expect(result.reply.operations).toEqual([]); expect(input).toEqual(before); expect(fetcher).toHaveBeenCalledOnce();
    }
  });

  it('withholds a search when captured quote provenance is stale', async () => {
    const input = request(), before = structuredClone(input), fetcher = provider(intent());
    const old = '2027-09-01T11:50:00.000Z';
    const stale = { ...snapshot, contracts: snapshot.contracts.map(contract => ({ ...contract, quoteAsOf: old, sourceTimes: { bid: old, ask: old, iv: old } })) };
    await expect(spar(input, 'synthetic-key', fetcher, undefined, stale, candidate)).rejects.toThrow();
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(1); expect(input).toEqual(before);
  });
});
