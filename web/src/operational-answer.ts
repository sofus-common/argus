import { calculateConditionalAssignment, quoteValuation, type StrategyState, type MarketSnapshot } from './options';

const topics = ['assignment', 'exercise', 'broker-policy', 'closing-value'] as const;
export const OPERATIONAL_PARAMETERS = {
  type: 'object', additionalProperties: false, required: ['scope', 'topics', 'legIds'],
  properties: {
    scope: { type: 'string', enum: ['current-position', 'combined-events', 'action', 'unclear'] },
    topics: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: { type: 'string', enum: topics } },
    legIds: { type: 'array', maxItems: 8, uniqueItems: true, items: { type: 'string' } },
  },
};

export function renderOperationalAnswer(state: StrategyState, snapshot: MarketSnapshot | undefined, raw: unknown) {
  const invalid = () => { throw new Error('Invalid operational topic selection'); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join() !== 'legIds,scope,topics') return invalid();
  const intent = raw as { scope: string; topics: Array<typeof topics[number]>; legIds: string[] };
  if (!OPERATIONAL_PARAMETERS.properties.scope.enum.includes(intent.scope) || !Array.isArray(intent.topics) || !intent.topics.length || intent.topics.length > 4 || new Set(intent.topics).size !== intent.topics.length || intent.topics.some(topic => !topics.includes(topic)) || !Array.isArray(intent.legIds) || intent.legIds.length > 8 || new Set(intent.legIds).size !== intent.legIds.length || intent.legIds.some(id => typeof id !== 'string' || !state.legs.some(leg => leg.id === id && intent.topics.includes(leg.side === 'short' ? 'assignment' : 'exercise'))) || intent.legIds.length && intent.topics.some(topic => topic === 'closing-value' || topic === 'broker-policy')) return invalid();
  const reply = { text: '', assumptions: ['Included position only, not full account inventory. No orders or position changes.'], objections: [] as string[], suggested_prompts: [] as string[] };
  if (intent.scope !== 'current-position') return { ...reply, text: intent.scope === 'action' ? 'This explanation cannot execute an exercise, assignment or closing order.' : intent.scope === 'combined-events' ? 'Combined or partial events are not calculated here. Independent rows must not be added together. Please clarify a single full-leg event.' : 'Please clarify whether you mean assignment, exercise, broker policy or the current closing-value estimate.' };
  const facts = calculateConditionalAssignment(state, snapshot), lines: string[] = [];
  const cash = (value: number) => `${value < 0 ? '-' : '+'}USD ${Math.abs(value).toFixed(2)}`;
  for (const topic of intent.topics) {
    if (topic === 'broker-policy') lines.push('Broker exercise cutoff, forced-liquidation policy and margin requirements are unknown. No applicable account policy has been supplied.');
    else if (topic === 'closing-value') {
      const quote = snapshot ? quoteValuation(state, snapshot) : null;
      lines.push(quote ? `Whole included position: signed liquidation estimate ${cash(quote.signedLiquidationValue)}. ${quote.basis} Oldest quote ${quote.oldestQuoteAt}; newest ${quote.newestQuoteAt}. This is not realized proceeds, a guaranteed execution or a closing order.` : 'Closing-value quote estimate unavailable: no matching market snapshot supplied.');
    } else {
      const events = topic === 'assignment' ? facts.scenarios?.map(({ assignedLegId, ...event }) => ({ ...event, legId: assignedLegId })) : facts.exerciseScenarios?.map(({ exercisedLegId, ...event }) => ({ ...event, legId: exercisedLegId }));
      if (!events) { lines.push(`${topic}: share-delivery calculation unavailable without matching, nonhistorical, provider-verified physical contract terms.`); continue; }
      const selected = events.filter(event => !intent.legIds.length || intent.legIds.includes(event.legId));
      if (!selected.length) lines.push(`No included ${topic === 'assignment' ? 'short' : 'long'} options for ${topic}.`);
      for (const event of selected) {
        const leg = state.legs.find(item => item.id === event.legId)!;
        lines.push(`${topic} of ${leg.id} (${leg.side} ${leg.contracts} × ${leg.strike} ${leg.type}, ${leg.expiry}): share change ${event.shareChange}; resulting shares ${event.resultingShares}, starting independently from ${facts.beforeShares}. Gross strike cashflow ${cash(event.grossStrikeCashflow)}. Remaining option leg IDs: ${event.remainingOptionLegIds.join(', ') || 'none'}. The affected option is no longer open.`);
      }
    }
  }
  if (intent.topics.some(topic => topic === 'assignment' || topic === 'exercise')) reply.assumptions.push('Each full-leg event starts from original included inventory. No automatic offsetting exercise or assignment; rows are not cumulative. Gross cashflow is not profit, buying power or account cash. Premiums, fees, dividends and financing are excluded. No event likelihood, broker action or current corporate-action check is implied.');
  return { ...reply, text: lines.join('\n\n') };
}
