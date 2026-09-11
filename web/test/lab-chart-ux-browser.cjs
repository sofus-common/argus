const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.PROTOTYPE_URL || 'http://127.0.0.1:5174/prototype.html');
    const date = page.getByLabel('Scenario date UTC', { exact: true });
    const time = page.getByRole('slider', { name: 'Scenario time', exact: true });
    await time.press('Home');
    const start = Date.parse(`${await date.inputValue()}Z`);
    await time.press('ArrowRight');
    assert.equal(Date.parse(`${await date.inputValue()}Z`) - start, 3_600_000, 'Arrow advances one hour');
    assert.match(await time.getAttribute('aria-valuetext'), /\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
    await time.press('End');
    assert.equal(Date.parse(`${await date.inputValue()}Z`), Date.parse(`${await date.getAttribute('max')}Z`), 'Slider reaches exact expiry');
    const target = await page.getByLabel('Target price', { exact: true }).inputValue();
    await page.getByLabel('Scenario spot', { exact: true }).fill('104');
    await page.getByLabel('Scenario spot', { exact: true }).press('Enter');
    await page.waitForFunction(() => document.querySelector('.payoff-chart')?.getAttribute('aria-busy') === 'false');
    assert.match(await page.locator('.scenario-target:not(.thesis-target) text').textContent(), /SCENARIO 104\.00/);
    assert.equal(await page.locator('.thesis-target text').textContent(), `THESIS TARGET ${Number(target).toFixed(2)}`);
    assert.equal(await page.getByLabel('Target price', { exact: true }).inputValue(), target);
    assert.equal(await page.getByLabel('IV shift in percentage points').isVisible(), false);
    await page.locator('.lac-advanced > summary').click();
    assert.equal(await page.getByLabel('IV shift in percentage points').isVisible(), true);
    assert.equal(await page.getByRole('button', { name: 'Freeze comparison', exact: true }).isVisible(), true);
    assert.equal(await page.getByLabel('Chart range from').isVisible(), true);
    assert.equal(await page.evaluate(() => {
      const tray = document.querySelector('.lab-tray');
      return [document.querySelector('.lac'), document.querySelector('.lab-sparring')].every(element => !!(tray.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING));
    }), true, 'Scenario tests precede chart and conversation');
    await page.getByRole('button', { name: 'Change strategy', exact: true }).click();
    const library = page.getByRole('dialog', { name: 'Choose your structure' });
    assert.equal(await library.locator('.lsp-template').count(), 6);
    await library.getByRole('checkbox', { name: 'Show all structures, including unavailable' }).check();
    assert.equal(await library.locator('.lsp-template').count(), 27);
    await library.getByRole('button', { name: 'Close strategy library' }).click();
    await page.getByLabel('Symbol', { exact: true }).fill('123');
    await page.getByRole('button', { name: 'Load symbol', exact: true }).click();
    assert.match(await page.locator('.lab-market [role="status"]').innerText(), /Enter a ticker/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No mobile page overflow');
    console.log('PASS scenario/thesis markers, hour keyboard stepping, exact expiry and advanced disclosure');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
