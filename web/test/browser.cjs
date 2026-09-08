const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('heading', { name: 'Iron Condor', exact: true }).waitFor();
  const shot = name => page.screenshot({ path: path.resolve(__dirname, '../../docs/screenshots/' + name + '.png'), fullPage: false });
  await shot('argus-redesign');
  const marker = page.getByRole('slider', { name: 'long put strike', exact: true });
  const markerBox = await marker.locator('rect').boundingBox();
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + 12);
  await page.mouse.down();
  await page.mouse.move(markerBox.x + markerBox.width / 2 - 34, markerBox.y + 12, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  assert.notEqual(await page.getByLabel('Strike', { exact: true }).first().inputValue(), '94');
  await page.getByRole('button', { name: 'Undo' }).click();
  assert.equal(await page.getByLabel('Strike', { exact: true }).first().inputValue(), '94');
  await marker.focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.getByLabel('Strike', { exact: true }).first().inputValue(), '93');
  await page.getByRole('button', { name: 'Undo' }).click();
  assert.equal(await page.getByLabel('Strike', { exact: true }).first().inputValue(), '94');
  await page.getByLabel('Strike', { exact: true }).first().selectOption('97');
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByLabel('Strike', { exact: true }).first().inputValue(), '94');
  await shot('argus-edit-rejected');
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  const shift = page.getByLabel('IV shift in percentage points');
  await shift.fill('-30');
  await shift.press('Enter');
  await page.getByRole('alert').waitFor();
  await shift.fill('-5');
  await shift.press('Enter');
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.route('**/api/sparring', route => route.fulfill({ status: 503, json: { error: { code: 'ai_unavailable', message: 'Add OPENROUTER_API_KEY to enable chat.' } } }));
  await page.getByRole('button', { name: 'Break the thesis', exact: true }).click();
  await page.getByText('Add OPENROUTER_API_KEY to enable chat.', { exact: true }).waitFor();
  await shot('argus-offline-tested');
  await page.unroute('**/api/sparring');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.route('**/api/sparring', route => route.fulfill({ status: 502, json: { error: { code: 'analysis_unverified', message: 'The draft did not pass the analysis check and was withheld. Your position is unchanged.' } } }));
  const beforeWithheld = await page.getByLabel('Entry premium', { exact: true }).evaluateAll(nodes => nodes.map(node => node.value));
  await page.getByRole('button', { name: 'Break the thesis', exact: true }).click();
  await page.getByText('The draft did not pass the analysis check and was withheld. Your position is unchanged.', { exact: true }).waitFor();
  assert.equal(await page.locator('.analysis-context').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Apply proposal', exact: true }).count(), 0);
  assert.deepEqual(await page.getByLabel('Entry premium', { exact: true }).evaluateAll(nodes => nodes.map(node => node.value)), beforeWithheld);
  await page.unroute('**/api/sparring');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.route('**/api/sparring', route => {
    const input = route.request().postDataJSON();
    const earlier = input.conversation.find(message => message.role === 'assistant');
    if (earlier) assert.match(earlier.content, /Review of Iron Condor, workspace version \d+; earlier workspace version, not the current position/);
    return route.fulfill({ json: { request_id: input.request_id, base_state_version: input.base_state_version, next_state: input.state,
      reply: { text: 'Structural review only.\n'.repeat(40), operations: [], assumptions: ['Sample IV unchanged.'], objections: ['A move beyond the short strikes breaks the thesis.'], evidence_ids: ['fred-DFF'] },
      calculated: { riskSummary: 'Sample expiration loss is bounded; before costs.' },
      market_context: { retrievedAt: '2026-09-05T12:00:00Z', sources: [
        { id: 'fred-DFF', provider: 'FRED', status: 'available', label: 'Effective federal funds rate', asOf: '2026-09-03', url: 'https://fred.stlouisfed.org/series/DFF', summary: 'Dated observation, not live.' },
        { id: 'exa-research', provider: 'Exa', status: 'unavailable', label: 'Official research', asOf: null, url: null, summary: '', reason: 'No valid dated evidence.' }
      ] }
    } });
  });
  await page.getByRole('button', { name: 'Break the thesis', exact: true }).click();
  await page.getByText('A move beyond the short strikes breaks the thesis.', { exact: true }).waitFor();
  await page.locator('.analysis-context').filter({ hasText: 'Current position' }).waitFor();
  assert.ok(await page.locator('.conversation').evaluate(pane => {
    const reply = pane.querySelector('.message.argus');
    return reply.getBoundingClientRect().height > pane.clientHeight
      && Math.abs(reply.getBoundingClientRect().top - pane.getBoundingClientRect().top) < 2;
  }), 'Long completed analysis opens at its beginning, not its ending');
  await shift.fill('-4');
  await shift.press('Enter');
  await page.locator('.analysis-context').filter({ hasText: 'Earlier position' }).waitFor();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.locator('.analysis-context').filter({ hasText: 'Earlier position' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Apply proposal', exact: true }).count(), 0);
  await page.getByText('Sources & data gaps · 1 available', { exact: true }).click();
  assert.equal(await page.getByRole('link', { name: 'Effective federal funds rate' }).getAttribute('href'), 'https://fred.stlouisfed.org/series/DFF');
  await page.getByText('No valid dated evidence.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Break the thesis', exact: true }).click();
  await page.locator('.analysis-context').filter({ hasText: 'Current position' }).waitFor();
  await shot('argus-grounded-analysis-tested');
  await page.unroute('**/api/sparring');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.route('**/api/sparring', async route => {
    const input = route.request().postDataJSON();
    const next = structuredClone(input.state);
    next.legs[0].entryPrice += 0.25;
    next.version++;
    await route.fulfill({ json: {
      request_id: input.request_id, base_state_version: input.base_state_version,
      next_state: next, reply: {
        text: 'Browser test proposal: compare the cost of a higher premium.',
        assumptions: ['Sample premiums only.'], objections: ['A higher debit reduces the payoff.'],
        operations: [{ kind: 'update_leg', leg_id: next.legs[0].id, leg: next.legs[0] }], suggested_prompts: []
      }
    } });
  });
  await page.getByRole('button', { name: 'Reduce downside', exact: true }).click();
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).waitFor();
  await shift.focus();
  await shift.press('Tab');
  assert.equal(await page.getByRole('button', { name: 'Apply proposal', exact: true }).count(), 1);
  assert.equal(await page.locator('.proposal-line').count(), 1);
  assert.equal(await page.getByLabel('Entry premium', { exact: true }).first().inputValue(), '0.5');
  await shot('argus-comparison-tested');
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  assert.equal(await page.getByLabel('Entry premium', { exact: true }).first().inputValue(), '0.75');
  await page.getByRole('button', { name: 'Undo' }).click();
  assert.equal(await page.getByLabel('Entry premium', { exact: true }).first().inputValue(), '0.5');
  await page.unroute('**/api/sparring');
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  let started;
  const requested = new Promise(resolve => { started = resolve; });
  await page.route('**/api/sparring', async route => {
    const input = route.request().postDataJSON();
    started();
    await hold;
    await route.fulfill({ json: { request_id: input.request_id, base_state_version: input.base_state_version, next_state: input.state, reply: { text: 'Stale', operations: [], assumptions: [], objections: [], suggested_prompts: [] } } });
  });
  await page.getByRole('button', { name: 'Break the thesis', exact: true }).click();
  await requested;
  const spot = page.getByLabel('Scenario spot', { exact: true });
  await spot.fill('102');
  await spot.press('Enter');
  release();
  await page.getByText('That proposal expired because the strategy changed while I was checking it.', { exact: true }).waitFor();
  assert.equal(await spot.inputValue(), '102');
  assert.equal(await page.getByRole('button', { name: 'Apply proposal', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Heatmap', exact: true }).click();
  await page.locator('canvas').focus();
  await page.keyboard.press('ArrowRight');
  assert.ok((await page.locator('.heatmap-tooltip').textContent()).includes('modeled P/L'));
  // Ignore abort deliberately: a late completion must not revive cleared chat or
  // release the busy state of a newer review.
  await page.evaluate(() => {
    const original = window.fetch;
    window.delayedReviews = [];
    window.fetch = (url, init) => String(url) === '/api/sparring' ? new Promise(resolve => {
      window.delayedReviews.push({ input: JSON.parse(init.body), resolve });
    }) : original(url, init);
    window.finishReview = (index, text) => {
      const { input, resolve } = window.delayedReviews[index];
      resolve(new Response(JSON.stringify({ request_id: input.request_id, base_state_version: input.base_state_version, next_state: input.state,
        reply: { text, operations: [], assumptions: [], objections: [], evidence_ids: [] },
      }), { headers: { 'content-type': 'application/json' } }));
    };
  });
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('button', { name: 'Break the thesis', exact: true }).click();
  await page.waitForFunction(() => window.delayedReviews.length === 1);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByLabel('Ask ARGUS').fill('Review the new conversation.');
  assert.equal(await page.getByRole('button', { name: 'Send message', exact: true }).isDisabled(), false);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.waitForFunction(() => window.delayedReviews.length === 2);
  await page.evaluate(async () => { window.finishReview(0, 'Cleared review must stay hidden.'); await new Promise(requestAnimationFrame); });
  assert.equal(await page.getByText('Cleared review must stay hidden.', { exact: true }).count(), 0);
  await page.getByLabel('Ask ARGUS').fill('Still waiting.');
  assert.equal(await page.getByRole('button', { name: 'Send message', exact: true }).isDisabled(), true);
  await page.evaluate(() => window.finishReview(1, 'New review survives.'));
  await page.getByText('New review survives.', { exact: true }).waitFor();
  assert.equal(await page.locator('.thinking').count(), 0);
  await page.goto('http://127.0.0.1:5173/?template=call-calendar&view=heatmap');
  await page.getByRole('heading', { name: 'Call Calendar', exact: true }).waitFor();
  await shot('argus-calendar-redesign');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('heading', { name: 'Iron Condor', exact: true }).waitFor();
  assert.ok(await page.locator('.market-pill').isVisible());
  assert.match(await page.locator('.market-pill').innerText(), /sample.*not live/);
  const mobileQuotes = page.getByRole('button', { name: 'Use real prices', exact: true });
  assert.ok(await mobileQuotes.isVisible());
  assert.ok((await mobileQuotes.boundingBox()).height >= 44);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const sections = page.getByRole('navigation', { name: 'Workspace sections' });
  await page.getByLabel('Ask ARGUS', { exact: true }).fill('Keep this unsent question.');
  for (const [name, id] of [['Chart', 'workspace-chart'], ['Legs', 'workspace-legs'], ['Ask ARGUS', 'workspace-question']]) {
    const link = sections.getByRole('link', { name, exact: true });
    assert.ok((await link.boundingBox()).height >= 44);
    await link.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), id);
    assert.ok(await page.locator(`#${id}`).evaluate(target => target.getBoundingClientRect().top >= document.querySelector('.workspace-nav').getBoundingClientRect().bottom));
  }
  assert.equal(await page.getByLabel('Ask ARGUS', { exact: true }).inputValue(), 'Keep this unsent question.');
  assert.ok(await page.locator('#workspace-question').evaluate(target => target.getBoundingClientRect().bottom <= innerHeight));
  assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), true);
  await shot('argus-mobile-redesign');
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(await sections.isVisible(), false);
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('Browser checks passed: invalid edits, offline response, proposal preview/apply/undo, stale response, keyboard heatmap, mobile overflow.');
})().catch(error => { console.error(error); process.exitCode = 1; });
