const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const { calculateStrategy, createStrategy } = await import(pathToFileURL(path.resolve(__dirname, '../src/options.ts')).href);
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (process.argv.includes('--stale-workspace-only')) {
      const state = createStrategy('long-put');
      const record = { id: 'stale-check', title: 'Saved put fixture', revision: 1, state, snapshot: null, lifecycle: null, createdAt: state.valuationTimestamp, updatedAt: state.valuationTimestamp };
      let chains = 0, release, begin, responseDone;
      const snapshot = { id: 'stale-chain', source: 'Tastytrade', underlying: 'SPY', spot: 100, retrievedAt: '2026-09-09T12:00:00.000Z', spotAsOf: '2026-09-09T12:00:00.000Z', availableExpiries: ['2026-09-18'], contracts: [{ contractId: 'SPY   260918C00100000', type: 'call', strike: 100, expiry: '2026-09-18T20:00:00.000Z', multiplier: 100, bid: 2, ask: 2.2, iv: .2, quoteAsOf: '2026-09-09T12:00:00.000Z' }] };
      await page.route('**/api/bootstrap', route => route.fulfill({ json: { session: { label: 'Offline fixture', local: true, recoveryKey: 'stale-workspace' } } }));
      await page.route('**/api/strategies**', route => {
        assert.equal(route.request().method(), 'GET', 'Stale review checks must not write saved records');
        return route.fulfill({ json: new URL(route.request().url()).pathname === '/api/strategies' ? { strategies: [record] } : { record } });
      });
      await page.route('**/api/chain*', route => route.fulfill({ json: { snapshot: { ...snapshot, id: `stale-chain-${++chains}` } } }));
      await page.goto('http://127.0.0.1:5173/?template=long-call');
      await page.getByRole('button', { name: 'Use real prices', exact: true }).click();
      await page.getByRole('button', { name: 'Refresh prices', exact: true }).waitFor();
      for (const action of ['refresh', 'load']) {
        const started = new Promise(resolve => { begin = resolve; });
        const held = new Promise(resolve => { release = resolve; });
        const finished = new Promise(resolve => { responseDone = resolve; });
        await page.route('**/api/sparring', async route => {
          const body = route.request().postDataJSON();
          begin(); await held;
          await route.fulfill({ json: { request_id: body.request_id, base_state_version: body.base_state_version, next_state: { ...body.state, version: body.state.version + 1 }, reply: { text: `Discard ${action} stale answer`, operations: [], assumptions: [], objections: [], evidence_ids: [] } } }).catch(() => {});
          responseDone();
        });
        const question = `Review before ${action}, keep my question.`;
        await page.getByLabel('Ask ARGUS').fill(question);
        await page.getByRole('button', { name: 'Send message', exact: true }).click();
        await started;
        if (action === 'refresh') {
          await page.getByRole('button', { name: 'Refresh prices', exact: true }).click();
          await page.getByRole('button', { name: 'Refresh prices', exact: true }).waitFor();
          assert.equal(chains, 2);
        } else {
          await page.locator('.saved-workspace > summary').click();
          await page.getByLabel('Saved positions', { exact: true }).selectOption(record.id);
          await page.getByRole('button', { name: 'Load', exact: true }).click();
          await page.getByText('Loaded saved position. Undo restores the previous position.', { exact: true }).waitFor();
        }
        await page.getByText('STALE REVIEW · no changes applied', { exact: true }).last().waitFor();
        release(); await finished;
        assert.equal(await page.getByText(question, { exact: true }).count(), 1);
        assert.equal(await page.getByText(`Discard ${action} stale answer`, { exact: true }).count(), 0);
        assert.equal(await page.getByRole('region', { name: 'Scenario chart preview', exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Apply proposal', exact: true }).count(), 0);
        await page.unroute('**/api/sparring');
      }
      assert.deepEqual(errors, []);
      console.log('Stale workspace passed: delayed AI response discarded after quote refresh and saved load; questions retained; no preview, Apply or saved writes.');
      return;
    }
    await page.goto('http://127.0.0.1:5173/?template=long-call');
    const time = page.getByRole('slider', { name: 'Scenario time', exact: true });
    await time.waitFor({ timeout: 5000 });
    const ready = () => page.waitForFunction(() => document.querySelector('.payoff-chart')?.getAttribute('aria-busy') === 'false' && !!document.querySelector('.greek-strip b'));
    await ready();
    assert.equal((await page.locator('.payoff-chart').boundingBox()).height, 320);
    assert.ok(await page.locator('.payoff-chart').evaluate(plot => {
      const top = plot.getBoundingClientRect().top;
      return document.querySelector('.scenario-time').getBoundingClientRect().top < top
        && document.querySelector('.scenario-display').getBoundingClientRect().top > top
        && document.querySelector('.chart-range').getBoundingClientRect().top > top;
    }), 'Date context precedes the plot; secondary controls follow it');
    const date = page.getByLabel('Scenario date UTC', { exact: true });
    const initialDate = await date.inputValue();
    const initialCurve = await page.locator('.profit-line').getAttribute('d');
    const initialGreeks = await page.locator('.greek-strip').innerText();
    const expiryDate = await page.locator('.expiry-reference').getAttribute('data-as-of');
    await time.focus(); await time.press('End');
    await ready();
    assert.equal(await time.inputValue(), '1000');
    assert.notEqual(await date.inputValue(), initialDate);
    assert.notEqual(await page.locator('.profit-line').getAttribute('d'), initialCurve);
    assert.notEqual(await page.locator('.greek-strip').innerText(), initialGreeks);
    assert.equal(await page.locator('.expiry-reference').getAttribute('data-as-of'), expiryDate);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(await date.inputValue(), initialDate);
    const sliderBounds = await time.boundingBox();
    await page.mouse.move(sliderBounds.x + 3, sliderBounds.y + sliderBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(sliderBounds.x + sliderBounds.width * .6, sliderBounds.y + sliderBounds.height / 2, { steps: 6 });
    await page.mouse.move(sliderBounds.x + sliderBounds.width * .8, sliderBounds.y + sliderBounds.height / 2, { steps: 6 });
    await page.mouse.up();
    assert.notEqual(await date.inputValue(), initialDate);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(await date.inputValue(), initialDate);
    await date.fill('2026-09-10T12:00');
    assert.match(await date.inputValue(), /^2026-09-10T12:00/);
    await date.fill('2026-09-25T12:00');
    await page.locator('.calculation-error[role="alert"]').waitFor();
    assert.match(await date.inputValue(), /^2026-09-10T12:00/);
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    let analyzed;
    await page.route('**/api/sparring', route => {
      analyzed = route.request().postDataJSON();
      return route.fulfill({ json: { request_id: analyzed.request_id, base_state_version: analyzed.base_state_version, next_state: { ...analyzed.state, version: analyzed.state.version + 1 },
        reply: { text: 'Scenario context checked.', operations: [], assumptions: [], objections: [], evidence_ids: [] },
      } });
    });
    await page.getByRole('button', { name: 'Break the thesis', exact: true }).click();
    await page.getByText('Scenario context checked.', { exact: true }).waitFor();
    assert.equal(analyzed.state.scenarioDate, '2026-09-10T12:00:00.000Z');
    const metrics = calculateStrategy(analyzed.state);
    await page.waitForFunction(theta => document.querySelector('.greek-strip')?.textContent.includes(theta), metrics.theta.toFixed(2));
    assert.ok((await page.locator('.greek-strip').innerText()).includes(metrics.theta.toFixed(2)));
    await page.getByRole('button', { name: 'Heatmap', exact: true }).click();
    const canvas = page.locator('canvas');
    const heatmapReady = () => page.waitForFunction(() => document.querySelector('canvas')?.getAttribute('aria-busy') === 'false');
    await heatmapReady();
    await canvas.focus(); await canvas.press('ArrowRight');
    const inspectedSpot = (await page.locator('.heatmap-tooltip').innerText()).match(/SPY \$(\d+\.\d+)/)[1];
    await canvas.press('Enter');
    await page.waitForFunction(expected => Number(document.querySelector('input[aria-label="Scenario spot"]').value).toFixed(2) === expected, inspectedSpot);
    assert.notEqual(await date.inputValue(), '2026-09-10T12:00');
    const keyboardDate = await date.inputValue();
    const keyboardSpot = await page.getByLabel('Scenario spot', { exact: true }).inputValue();
    await heatmapReady();
    const bounds = await canvas.boundingBox();
    await canvas.click({ position: { x: bounds.width * .7, y: bounds.height * .7 } });
    assert.notEqual(await date.inputValue(), keyboardDate);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(await date.inputValue(), keyboardDate);
    assert.equal(await page.getByLabel('Scenario spot', { exact: true }).inputValue(), keyboardSpot);
    await page.locator('.template-list button').filter({ hasText: 'Call calendar' }).click();
    await time.focus(); await time.press('End');
    assert.equal(Date.parse(`${await date.inputValue()}Z`), Date.parse(`${await date.getAttribute('max')}Z`));
    await page.getByRole('button', { name: 'Curve', exact: true }).click();
    await page.getByText('First-expiry reference', { exact: true }).waitFor();
    await time.focus(); await time.press('Home'); await time.press('PageUp');
    await page.screenshot({ path: path.resolve(__dirname, '../../docs/screenshots/argus-scenario-time.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Heatmap', exact: true }).click();
    await heatmapReady();
    await canvas.focus(); await canvas.press('ArrowRight'); await canvas.press(' ');
    await heatmapReady();
    await canvas.press('ArrowRight');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.unroute('**/api/sparring');
    let releaseReview, reviewStarted;
    const started = new Promise(resolve => { reviewStarted = resolve; });
    const held = new Promise(resolve => { releaseReview = resolve; });
    await page.route('**/api/sparring', async route => {
      const body = route.request().postDataJSON();
      reviewStarted();
      await held;
      await route.fulfill({ json: { request_id: body.request_id, base_state_version: body.base_state_version, next_state: { ...body.state, version: body.state.version + 1 }, reply: { text: 'Stale result must not appear.', operations: [], assumptions: [], objections: [], evidence_ids: [] } } }).catch(() => {});
    });
    const question = 'Compare this exact position without editing it.';
    await page.getByLabel('Ask ARGUS').fill(question);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await started;
    const spotInput = page.getByLabel('Scenario spot', { exact: true });
    await spotInput.fill(String(Number(await spotInput.inputValue()) + 1));
    await spotInput.press('Enter');
    await page.getByText('STALE REVIEW · no changes applied', { exact: true }).waitFor();
    releaseReview();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(await page.getByText(question, { exact: true }).count(), 1, 'Cancelled question remains in conversation after edit and Undo');
    assert.equal(await page.getByText('Stale result must not appear.', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('region', { name: 'Scenario chart preview', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Apply proposal', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log('Scenario browser passed: time endpoints, UTC input, curve/Greeks, unchanged expiry reference, AI context, heatmap keyboard/click, Undo, calendar bound, mobile.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
