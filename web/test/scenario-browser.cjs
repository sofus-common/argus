const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const { calculateStrategy } = await import(pathToFileURL(path.resolve(__dirname, '../src/options.ts')).href);
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5173/?template=long-call');
    const time = page.getByRole('slider', { name: 'Scenario time', exact: true });
    await time.waitFor({ timeout: 5000 });
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
    await page.getByRole('alert').waitFor();
    assert.match(await date.inputValue(), /^2026-09-10T12:00/);
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    let analyzed;
    await page.route('**/api/sparring', route => {
      analyzed = route.request().postDataJSON();
      return route.fulfill({ json: { request_id: analyzed.request_id, base_state_version: analyzed.base_state_version, next_state: analyzed.state,
        reply: { text: 'Scenario context checked.', operations: [], assumptions: [], objections: [], evidence_ids: [] },
      } });
    });
    await page.getByRole('button', { name: 'Break the thesis', exact: true }).click();
    await page.getByText('Scenario context checked.', { exact: true }).waitFor();
    assert.equal(analyzed.state.scenarioDate, '2026-09-10T12:00:00.000Z');
    const metrics = calculateStrategy(analyzed.state);
    assert.ok((await page.locator('.greek-strip').innerText()).includes(metrics.theta.toFixed(2)));
    await page.getByRole('button', { name: 'Heatmap', exact: true }).click();
    const canvas = page.locator('canvas');
    await canvas.focus(); await canvas.press('ArrowRight');
    const inspectedSpot = (await page.locator('.heatmap-tooltip').innerText()).match(/SPY \$(\d+\.\d+)/)[1];
    await canvas.press('Enter');
    await page.waitForFunction(expected => Number(document.querySelector('input[aria-label="Scenario spot"]').value).toFixed(2) === expected, inspectedSpot);
    assert.notEqual(await date.inputValue(), '2026-09-10T12:00');
    const keyboardDate = await date.inputValue();
    const keyboardSpot = await page.getByLabel('Scenario spot', { exact: true }).inputValue();
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
    await canvas.focus(); await canvas.press('ArrowRight'); await canvas.press(' ');
    await canvas.press('ArrowRight');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log('Scenario browser passed: time endpoints, UTC input, curve/Greeks, unchanged expiry reference, AI context, heatmap keyboard/click, Undo, calendar bound, mobile.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
