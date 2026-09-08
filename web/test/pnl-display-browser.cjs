const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const { createStrategy, calculateStrategy, scenarioTable, evaluateScenario, pnlDisplayBasis } = await import(pathToFileURL(path.resolve(__dirname, '../src/options.ts')).href);
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], requests = [];
    let reviewed;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      requests.push(pathname);
      if (pathname === '/api/strategies') return route.fulfill({ json: { strategies: [] } });
      if (pathname === '/api/sparring') {
        reviewed = request.postDataJSON();
        const calculated = await page.evaluate(async input => { const { strategyFacts } = await import('/src/sparring.ts'); return strategyFacts(input.state, undefined, input.chart_context); }, reviewed);
        return route.fulfill({ json: { request_id: reviewed.request_id, base_state_version: reviewed.base_state_version, next_state: reviewed.state, metrics: calculateStrategy(reviewed.state), calculated: { ...calculated, requestedScenarios: [] }, reply: { text: 'Offline display review.', operations: [], assumptions: [], objections: [], suggested_prompts: [], risk_classification: 'bounded', evidence_ids: [] } } });
      }
      return route.fulfill({ status: 503, json: { error: 'Provider access disabled for display regression' } });
    });
    const ready = selector => page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('aria-busy') === 'false', selector);
    const readPosition = () => page.locator('.leg-row input, .leg-row select, [aria-label="Total cost allowance"], [aria-label="Scenario spot"], [aria-label="Scenario date UTC"], [aria-label="IV shift in percentage points"]').evaluateAll(nodes => nodes.map(node => node.value));
    const parse = text => Number(text.replaceAll(',', '').replace('−', '-').replace(/[^\d.+-]/g, ''));
    await page.goto('http://127.0.0.1:5173/');
    const display = page.getByLabel('Scenario value display', { exact: true });
    await display.waitFor({ timeout: 2000 });
    assert.deepEqual(await display.locator('option').evaluateAll(nodes => nodes.map(node => node.value)), ['pnl', 'position-value', 'risk-percent']);
    await page.locator('.template-list button').filter({ hasText: 'Long call' }).click();
    await page.getByLabel('Total cost allowance', { exact: true }).fill('7');
    await page.getByLabel('Total cost allowance', { exact: true }).press('Enter');
    const state = { ...createStrategy('long-call'), feeAllowance: 7 }, before = await readPosition();
    for (const mode of ['pnl', 'position-value', 'risk-percent']) {
      await display.selectOption(mode);
      await ready('.payoff-chart');
      const chart = page.locator('.payoff-chart').first();
      await chart.focus(); await page.keyboard.press('ArrowRight');
      const output = await page.locator('.chart-wrap output').first().innerText();
      const basis = pnlDisplayBasis(state, mode);
      assert.ok(output.includes(mode === 'pnl' ? 'profit and loss' : basis.label), output);
      assert.ok(output.includes(basis.unit), output);
      assert.deepEqual(await readPosition(), before, 'Display switching must not edit the position');
      await page.getByRole('button', { name: 'Table', exact: true }).click();
      await ready('[aria-label="Scenario P/L and Greeks"]');
      const table = page.getByRole('table', { name: 'Scenario P/L and Greeks', exact: true });
      const expected = scenarioTable(state);
      for (const row of expected) {
        const text = await table.locator(`tr[data-spot="${row.spot}"] td`).first().textContent();
        assert.ok(Math.abs(parse(text) - (row.pnl * basis.scale + basis.offset)) < .0051, `${mode} row ${row.spot}: ${text}`);
      }
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export scenario CSV', exact: true }).click();
      let csv = ''; for await (const chunk of await (await downloading).createReadStream()) csv += chunk.toString('utf8');
      const exported = csv.replace(/^\uFEFF/, '').split('\r\n').map(line => line.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map(cell => cell.startsWith('"') ? cell.slice(1, -1).replaceAll('""', '"') : cell));
      assert.equal(exported[0][11], 'P/L USD');
      for (const [index, row] of expected.entries()) assert.equal(Number(exported[index + 1][11]), row.pnl, 'Canonical CSV P/L must stay in dollars');
      if (mode !== 'pnl') {
        const column = exported[0].findIndex(name => /displayed value/i.test(name));
        assert.ok(column >= 18, 'Display column must be appended without moving canonical data');
        for (const [index, row] of expected.entries()) assert.ok(Math.abs(Number(exported[index + 1][column]) - (row.pnl * basis.scale + basis.offset)) < .00001);
      }
      await page.getByRole('button', { name: 'Ask about this chart', exact: true }).click();
      await page.getByText('Offline display review.', { exact: true }).last().waitFor();
      assert.equal(reviewed.chart_context.pnlDisplay ?? 'pnl', mode);
      assert.deepEqual(scenarioTable(reviewed.state), expected);
      const captured = page.locator('.chart-analysis').last();
      await captured.locator(':scope > summary').click();
      const capturedRows = await captured.locator('tbody tr').allTextContents();
      for (const [index, row] of expected.entries()) {
        const value = parse(await captured.locator('tbody tr').nth(index).locator('td').first().textContent());
        assert.ok(Math.abs(value - (row.pnl * basis.scale + basis.offset)) < .501, 'Captured scenario must use captured display basis');
      }
      await display.selectOption(mode === 'position-value' ? 'pnl' : 'position-value');
      assert.deepEqual(await captured.locator('tbody tr').allTextContents(), capturedRows, 'Historical chart values must not follow later display selection');
      await display.selectOption(mode);
      await page.getByRole('button', { name: 'Heatmap', exact: true }).click();
      await ready('canvas.heatmap');
      const canvas = page.locator('canvas.heatmap');
      await canvas.focus(); await page.keyboard.press('ArrowRight');
      const tooltip = await page.locator('.heatmap-tooltip').innerText();
      assert.ok(tooltip.includes(basis.label) && tooltip.includes(basis.unit), tooltip);
      const match = tooltip.match(/\$(\d+(?:\.\d+)?)/);
      assert.ok(match, tooltip);
      const target = Number(match[1]);
      await page.keyboard.press('Enter'); await ready('canvas.heatmap');
      assert.ok(Math.abs(Number(await page.getByLabel('Scenario spot', { exact: true }).inputValue()) - target) < .006);
      const selectedSpot = Number(await page.getByLabel('Scenario spot', { exact: true }).inputValue());
      const selectedDate = new Date(`${await page.getByLabel('Scenario date UTC', { exact: true }).inputValue()}Z`).toISOString();
      const modeled = evaluateScenario({ ...state, scenarioSpot: selectedSpot, scenarioDate: selectedDate }).pnl * basis.scale + basis.offset;
      assert.ok(tooltip.includes(Math.abs(modeled).toFixed(0)) || tooltip.includes(Math.abs(modeled).toFixed(2)), `Heatmap must show transformed scenario value ${modeled}: ${tooltip}`);
      await page.getByRole('button', { name: 'Undo', exact: true }).click(); await ready('canvas.heatmap');
      assert.deepEqual(await readPosition(), before);
      await page.getByRole('button', { name: 'Curve', exact: true }).click();
    }
    for (const template of ['Short call', 'Call calendar']) {
      await page.locator('.template-list button').filter({ hasText: template }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Scenario value display"] option[value="risk-percent"]')?.disabled);
      assert.equal(await display.locator('option[value="risk-percent"]').evaluate(option => option.disabled), true, `${template} has no valid exact risk denominator`);
      assert.equal(await display.inputValue(), 'risk-percent', 'Invalid selected risk view must be disclosed, not silently changed');
      assert.equal(await page.getByRole('button', { name: 'Ask about this chart', exact: true }).isDisabled(), true);
    }
    await page.locator('.template-list button').filter({ hasText: 'Long call' }).click();
    await page.getByLabel('Entry premium', { exact: true }).fill('0');
    await page.waitForFunction(() => document.querySelector('[aria-label="Scenario value display"] option[value="risk-percent"]')?.disabled);
    assert.equal(await display.locator('option[value="risk-percent"]').evaluate(option => option.disabled), true, 'Zero-risk long call cannot divide by zero');
    await display.selectOption('position-value');
    await ready('.payoff-chart');
    await page.locator('.canvas-card').screenshot({ path: 'web/.wrangler/pnl-display-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.canvas-card').screenshot({ path: 'web/.wrangler/pnl-display-mobile.png' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.ok(requests.every(item => ['/api/bootstrap', '/api/strategies', '/api/sparring'].includes(item)), JSON.stringify(requests));
    assert.deepEqual(errors, []);
    console.log('P/L display PASS: curve/heatmap units, table transforms, canonical CSV preservation, captured AI context, unchanged holdings, invalid denominators and mobile layout. Provider and AI responses mocked.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
