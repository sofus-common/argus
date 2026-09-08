import { describe, expect, it } from 'vitest';
import { parseDiscoveryIntent as parse, renderDiscovery } from '../src/discovery';
import { createMarketStrategy, searchCandidates, type MarketSnapshot } from '../src/options';

const date = '2027-10-09T20:00:00.000Z';
const parseDiscoveryIntent = (raw: unknown, messages: Parameters<typeof parse>[1], underlying = 'SPY') => parse(raw, messages, underlying);
const constraints = `Target SPY at $103 on ${date}. Rank by target P/L, with a maximum loss of $2000, total fee allowance $5 and natural quote pricing.`;
const conversation = (family = 'standard iron condors', outlay = true) => [{ role: 'user' as const, content: `Find new ${family} only. ${constraints}${outlay ? ' Maximum net entry outlay is $1500.' : ''}` }];
const evidence = (quote: string, message = 0) => ({ message, quote });
const raw = (family = 'standard iron condors', outlay = true) => ({ scope: 'search', families: [evidence(family)], targetSpot: evidence('Target SPY at $103'), targetDate: evidence(`on ${date}`), maxLoss: evidence('maximum loss of $2000'), feeAllowance: evidence('total fee allowance $5'), basis: evidence('natural quote pricing'), objective: evidence('Rank by target P/L'), maxEntryOutlay: outlay ? evidence('Maximum net entry outlay is $1500') : null });

describe('bounded discovery evidence and deterministic replies', () => {
  it.each([['standard iron condors', 'iron-condor'], ['inverse iron condors', 'inverse-iron-condor'], ['bull put spreads', 'bull-put'], ['bear put spreads', 'bear-put']])('extracts the frozen %s task without inferred values', (name, id) => {
    const messages = conversation(name), input = raw(name), before = structuredClone({ messages, input });
    const intent = parseDiscoveryIntent(input, messages)!;
    expect(intent).toMatchObject({ scope: 'search', families: [id], targetSpot: 103, targetDate: date, maxLoss: 2000, feeAllowance: 5, basis: 'natural', objective: 'target-pnl', maxEntryOutlay: 1500, evidence: input });
    expect({ messages, input }).toEqual(before);
  });
  it('clarifies missing outlay and ambiguous butterfly, retaining only explicit user constraints', () => {
    const messages = conversation('standard iron condors', false), input = raw('standard iron condors', false);
    expect(renderDiscovery(parseDiscoveryIntent(input, messages)!, null).text).toMatch(/maximum net entry outlay/i);
    const butterfly = parseDiscoveryIntent(raw('butterfly'), conversation('butterfly'))!;
    expect(butterfly.families).toBeNull();
    expect(renderDiscovery(butterfly, null).text).toMatch(/call-butterfly.*put-butterfly.*iron-butterfly/);
    const followup = [...messages, { role: 'assistant' as const, content: 'What maximum net entry outlay should I use?' }, { role: 'user' as const, content: '1500' }];
    expect(parseDiscoveryIntent({ ...input, maxEntryOutlay: evidence('1500', 2) }, followup)!.maxEntryOutlay).toBeNull();
    followup[2].content = 'net entry outlay is $1500';
    expect(parseDiscoveryIntent({ ...input, maxEntryOutlay: evidence(followup[2].content, 2) }, followup)!.maxEntryOutlay).toBe(1500);
  });
  it('rejects unbound, assistant-owned and extra-schema evidence', () => {
    expect(parseDiscoveryIntent({ ...raw(), surprise: 1 }, conversation())).toBeNull();
    expect(parseDiscoveryIntent({ ...raw(), maxLoss: evidence('maximum loss of $999') }, conversation())).toBeNull();
    expect(parseDiscoveryIntent(raw(), [{ role: 'assistant', content: conversation()[0].content }])).toBeNull();
    expect(parseDiscoveryIntent({ ...raw(), maxLoss: { ...evidence('maximum loss of $2000'), value: 2000 } }, conversation())).toBeNull();
  });
  it.each(['$2k', '$2 million', '$2 + 3', '$2%', '$2,00', '-$2'])('does not infer numeric expression %s', amount => {
    const input = raw(), messages = conversation();
    messages[0].content = messages[0].content.replace('maximum loss of $2000', `maximum loss of ${amount}`);
    input.maxLoss = evidence(`maximum loss of ${amount}`);
    expect(parseDiscoveryIntent(input, messages)!.maxLoss).toBeNull();
    if (amount.startsWith('$2')) expect(parseDiscoveryIntent({ ...input, maxLoss: evidence('maximum loss of $2') }, messages)!.maxLoss).toBeNull();
  });
  it('preserves zero, decimals and comma groups; rejects contradictory values and invalid dates', () => {
    const messages = conversation(), input = raw();
    messages[0].content = messages[0].content.replace('$2000', '$2,000.50').replace('allowance $5', 'allowance $0').replace('outlay is $1500', 'outlay is $0');
    const zero = parseDiscoveryIntent({ ...input, maxLoss: evidence('maximum loss of $2,000.50'), feeAllowance: evidence('total fee allowance $0'), maxEntryOutlay: evidence('Maximum net entry outlay is $0') }, messages)!;
    expect([zero.maxLoss, zero.feeAllowance, zero.maxEntryOutlay]).toEqual([2000.5, 0, 0]);
    expect(parseDiscoveryIntent(raw(), [...conversation(), { role: 'user', content: 'maximum loss of $1000' }])!.maxLoss).toBeNull();
    expect(parseDiscoveryIntent(raw(), [...conversation(), { role: 'user', content: 'maximum loss of $2k' }])!.maxLoss).toBeNull();
    const badDate = date.replace('10-09', '02-30');
    expect(parseDiscoveryIntent({ ...raw(), targetDate: evidence(`on ${badDate}`) }, [{ role: 'user', content: conversation()[0].content.replace(date, badDate) }])!.targetDate).toBeNull();
    expect(parseDiscoveryIntent(raw('broken wing butterfly'), conversation('broken wing butterfly'))!.families).toBeNull();
  });
  it('does not drop explicit negation, alternatives or a second named family', () => {
    for (const text of ['not maximum loss of $2000', 'maximum loss of $2000 or $3000', 'maximum loss of $2000 per contract']) {
      expect(parseDiscoveryIntent(raw(), [{ role: 'user', content: conversation()[0].content.replace('maximum loss of $2000', text) }])!.maxLoss).toBeNull();
    }
    expect(parseDiscoveryIntent(raw(), [...conversation(), { role: 'user', content: 'Find inverse iron condors instead.' }])!.families).toBeNull();
    expect(parseDiscoveryIntent(raw('iron condors'), conversation('inverse iron condors'))!.families).toBeNull();
    expect(parseDiscoveryIntent(raw('call butterflies'), conversation('call butterflies'))!.families).toEqual(['call-butterfly']);
  });
  it('binds a named target to the workspace symbol without interpreting another ticker', () => {
    const messages = [{ role: 'user', content: conversation()[0].content.replace('Target SPY', 'Target NVDA') }];
    const input = { ...raw(), targetSpot: evidence('Target NVDA at $103') };
    expect(parseDiscoveryIntent(input, messages, 'SPY')!.targetSpot).toBeNull();
    expect(parseDiscoveryIntent(input, messages, 'NVDA')!.targetSpot).toBe(103);
    expect(parseDiscoveryIntent({ ...raw(), targetSpot: evidence('target spot is $103') }, [{ role: 'user', content: conversation()[0].content.replace('Target SPY at $103', 'target spot is $103') }], 'SPY')!.targetSpot).toBe(103);
  });
  it.each(['CAD', 'AUD', 'NZD', 'JPY', 'CHF', 'SEK', 'EUR', 'GBP', 'Canadian dollars'])('does not convert %s into USD by truncating evidence', currency => {
    const messages = [{ role: 'user', content: conversation()[0].content.replace('maximum loss of $2000', `maximum loss of $2000 ${currency}`) }];
    expect(parseDiscoveryIntent(raw(), messages, 'SPY')!.maxLoss).toBeNull();
    expect(parseDiscoveryIntent({ ...raw(), maxLoss: evidence(`maximum loss of $2000 ${currency}`) }, messages, 'SPY')!.maxLoss).toBeNull();
    expect(parseDiscoveryIntent({ ...raw(), maxLoss: evidence(`maximum loss of ${currency} $2000`) }, [{ role: 'user', content: conversation()[0].content.replace('maximum loss of $2000', `maximum loss of ${currency} $2000`) }], 'SPY')!.maxLoss).toBeNull();
  });
  it('accepts an explicit USD suffix and bounded connecting clauses', () => {
    const messages = [{ role: 'user', content: conversation()[0].content.replace('maximum loss of $2000', 'maximum loss of $2000 USD') }];
    expect(parseDiscoveryIntent({ ...raw(), maxLoss: evidence('maximum loss of $2000 USD') }, messages, 'SPY')!.maxLoss).toBe(2000);
    expect(parseDiscoveryIntent(raw(), [{ role: 'user', content: conversation()[0].content.replace('maximum loss of $2000', 'CAD maximum loss of $2000') }], 'SPY')!.maxLoss).toBeNull();
  });
  it('renders actual engine rank and money, not generated financial prose', () => {
    const retrievedAt = '2027-09-01T12:00:00.000Z';
    const snapshot: MarketSnapshot = { id: 'discovery-test', underlying: 'SPY', source: 'Tastytrade', retrievedAt, spot: 100, spotAsOf: retrievedAt, availableExpiries: [date.slice(0, 10)], contracts: [90, 100].map(strike => ({ contractId: `SPY   271009P${String(strike * 1000).padStart(8, '0')}`, type: 'put', strike, expiry: date, multiplier: 100, bid: 1.9, ask: 2.1, iv: .25, quoteAsOf: retrievedAt })) };
    const state = createMarketStrategy('long-put', snapshot, 'natural');
    const search = searchCandidates(state, snapshot, { targetSpot: 103, targetDate: date, maxLoss: 2000, feeAllowance: 5, basis: 'natural', objective: 'target-pnl' }, { families: ['bear-put'], maxEntryOutlay: 1500 });
    expect(search.candidates[0].metrics.maxProfit).toBe(975);
    const result = renderDiscovery(parseDiscoveryIntent(raw('bear put spreads'), conversation('bear put spreads'))!, search);
    expect(result.text).toContain('1.');
    expect(result.text).toContain('USD 975.00');
    expect(result.text).toContain('USD 25.00');
    expect(result.text).toContain('unchanged');
    expect(result.assumptions.join(' ')).toContain('not a global optimum');
    expect(result).not.toHaveProperty('operations');
    const later = '2027-11-09T20:00:00.000Z';
    const mixedSnapshot = { ...snapshot, availableExpiries: [date.slice(0, 10), later.slice(0, 10)], contracts: [...snapshot.contracts, ...snapshot.contracts.map(contract => ({ ...contract, contractId: contract.contractId.replace('271009', '271109'), expiry: later }))] };
    const mixed = searchCandidates(state, mixedSnapshot, search.request, { families: ['put-calendar'], maxEntryOutlay: 1500 });
    expect(mixed.candidates.length).toBeGreaterThan(0);
    const mixedReply = renderDiscovery(parseDiscoveryIntent(raw('put calendars'), conversation('put calendars'))!, mixed);
    expect(mixedReply.text).toContain('conservative first-expiry loss bound');
    expect(mixedReply.text).toContain('Mixed-expiry probability unavailable');
    expect(mixedReply.text).not.toContain('maximum profit');
  });
});
