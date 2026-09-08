const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto('http://127.0.0.1:5173/?template=iron-condor');
    const markers = page.locator('.strike-marker[role="slider"]');
    await markers.first().waitFor();
    const strikes = () => markers.evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('aria-valuenow'))));
    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    const baseline = await strikes();
    await markers.first().press('Shift+ArrowRight');
    assert.deepEqual(await strikes(), baseline.map(strike => strike + 1));
    await undo.click();
    assert.deepEqual(await strikes(), baseline);
    await page.getByRole('checkbox', { name: 'Move all strikes', exact: true }).check();
    await markers.first().press('ArrowRight');
    assert.deepEqual(await strikes(), baseline.map(strike => strike + 1));
    await undo.click();
    assert.deepEqual(await strikes(), baseline);

    const begin = async () => {
      await markers.first().scrollIntoViewIfNeeded();
      const bounds = await markers.first().boundingBox();
      const x = bounds.x + bounds.width / 2, y = bounds.y + 12;
      await page.mouse.move(x, y);
      await page.mouse.down();
      return { x, y };
    };
    const release = async () => { await page.mouse.up(); };
    let point = await begin();
    await page.mouse.move(point.x + 80, point.y, { steps: 5 });
    await page.getByText('Hypothetical chart preview', { exact: false }).waitFor();
    const preview = await strikes();
    assert.notDeepEqual(preview, baseline);
    assert.ok(preview.every((strike, index) => strike - baseline[index] === preview[0] - baseline[0]));
    await release();
    assert.deepEqual(await strikes(), preview);
    await undo.click();
    assert.deepEqual(await strikes(), baseline);

    // Fill the bounded history, then prove cancelled/no-op drags did not evict its oldest entry.
    for (let index = 0; index < 20; index++) await markers.first().press(index % 2 ? 'Shift+ArrowLeft' : 'Shift+ArrowRight');
    point = await begin();
    await page.mouse.move(point.x + 80, point.y, { steps: 3 });
    await page.keyboard.press('Escape');
    await release();
    assert.deepEqual(await strikes(), baseline);
    await begin();
    await release();
    for (let index = 0; index < 20; index++) {
      assert.equal(await undo.isEnabled(), true);
      await undo.click();
      assert.deepEqual(await strikes(), baseline.map(strike => strike + (index % 2 ? 0 : 1)));
    }
    assert.equal(await undo.isEnabled(), false);

    // Another committed edit invalidates the in-flight preview; releasing cannot overwrite it.
    point = await begin();
    await page.mouse.move(point.x + 80, point.y, { steps: 3 });
    const allowance = page.getByRole('textbox', { name: 'Total cost allowance', exact: true });
    await allowance.fill('7');
    await allowance.press('Tab');
    await release();
    assert.deepEqual(await strikes(), baseline);
    assert.equal(await allowance.inputValue(), '7');
    await undo.click();
    assert.equal(await allowance.inputValue(), '0');
    assert.deepEqual(await strikes(), baseline);
    await page.getByRole('button', { name: '╱ Short put', exact: true }).click();
    await page.getByLabel('Entry premium', { exact: true }).fill('95');
    await page.getByLabel('Entry premium', { exact: true }).press('Tab');
    await page.getByLabel('Scenario value display', { exact: true }).selectOption({ label: 'P/L / max loss · %' });
    point = await begin();
    await page.mouse.move(point.x - 400, point.y, { steps: 5 });
    await release();
    assert.deepEqual(await strikes(), [100]);
    await page.getByText('Choose P/L to preview a position without a positive exact expiry loss bound.', { exact: true }).waitFor();
    await markers.first().press('Shift+ArrowRight');
    assert.deepEqual(await strikes(), [101]);
    await undo.click();
    assert.deepEqual(await strikes(), [100]);
    console.log('Strike gesture keyboard, atomic drag, cancel, full-history preservation, stale-preview and risk-display checks passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
