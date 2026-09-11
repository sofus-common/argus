import { expect, it } from 'vitest';
import { renderOperationalAnswer } from '../src/operational-answer';
import { createStrategy } from '../src/options';

it('withholds unknown terms and policy without accepting model-authored facts', () => {
  const state = createStrategy('bull-call'), before = structuredClone(state);
  const input = { scope: 'current-position', topics: ['assignment', 'exercise', 'broker-policy', 'closing-value'], legIds: [] };
  const answer = renderOperationalAnswer(state, undefined, input);
  expect(answer.text).toContain('unavailable');
  expect(answer.text).toContain('unknown');
  expect(answer.text).not.toContain('5:30');
  expect(state).toEqual(before);
  for (const invalid of [{ ...input, text: '5:30 is guaranteed' }, { ...input, legIds: ['invented'] }, { ...input, topics: ['assignment', 'assignment'] }, { ...input, scope: 'execute' }, { ...input, topics: ['profit'] }]) expect(() => renderOperationalAnswer(state, undefined, invalid)).toThrow();
});

it('does not substitute independent rows for a combined event or action', () => {
  const state = createStrategy('bull-call');
  for (const scope of ['combined-events', 'action', 'unclear']) {
    const answer = renderOperationalAnswer(state, undefined, { scope, topics: ['assignment'], legIds: [] });
    expect(answer.text).toMatch(/clarify|cannot|not calculated/);
    expect(answer.text).not.toContain('Gross strike');
  }
  expect(() => renderOperationalAnswer(state, undefined, { scope: 'current-position', topics: ['assignment'], legIds: [state.legs.find(leg => leg.side === 'long')!.id] })).toThrow();
  for (const topic of ['broker-policy', 'closing-value']) expect(() => renderOperationalAnswer(state, undefined, { scope: 'current-position', topics: ['exercise', topic], legIds: [state.legs.find(leg => leg.side === 'long')!.id] })).toThrow();
  expect(() => renderOperationalAnswer(state, undefined, { scope: 'current-position', topics: ['assignment', 'exercise'], legIds: state.legs.map(leg => leg.id) })).not.toThrow();
});
