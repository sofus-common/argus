const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && message.text().includes('same key')) errors.push(message.text()); });
    if (process.argv.includes('--live')) {
      const databases = await (await page.request.get('http://127.0.0.1:5173/cdn-cgi/local/explorer/api/d1/database')).json();
      assert.deepEqual(databases.result.map(db => db.uuid), ['argus-local'], 'Local backend must use only the local database binding');
      await page.goto('http://127.0.0.1:5174/prototype.html');
      page.on('dialog', d => d.accept());
      await page.getByLabel('Symbol', { exact: true }).fill('AAPL');
      await page.getByRole('button', { name: 'Load symbol', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.lab-badge')?.textContent === 'DATED MARKET QUOTES', null, { timeout: 45000 });
      await page.waitForFunction(() => document.querySelector('.payoff-chart')?.getAttribute('aria-busy') === 'false');
      await page.screenshot({ path: '.wrangler/market-workbench-live.png', fullPage: true });
      assert.ok((await page.locator('.lab-market strong').innerText()).includes('AAPL'));
      assert.deepEqual(errors, []);
      console.log('PASS live AAPL symbol load through local API and rendered chart');
      return;
    }
    const at = '2026-09-10T15:00:00.000Z';
    const snapshot = (symbol, date = '2026-09-18') => ({ id: `fixture-${symbol}-${date}`, underlying: symbol, source: 'Tastytrade', spot: 230, retrievedAt: at, spotAsOf: at, availableExpiries: ['2026-09-18', '2026-11-20'], contracts: [220,225,230,235,240].flatMap(strike => ['call','put'].map(type => ({ contractId: `${symbol.padEnd(6)}${date.slice(2).replaceAll('-','')}${type === 'call' ? 'C' : 'P'}${String(strike * 1000).padStart(8,'0')}`, type, strike, expiry: `${date}T${date.includes('11-') ? '21' : '20'}:00:00.000Z`, multiplier: 100, bid: type === 'call' ? (245-strike)/3 : (strike-215)/3, ask: type === 'call' ? (245-strike)/3+1 : (strike-215)/3+1, iv: .3, quoteAsOf: at }))) });
    let calls = 0, delayed;
    await page.route('**/api/chain?**', async route => {
      calls++;
      const query = new URL(route.request().url()).searchParams, symbol = query.get('symbol');
      if (symbol === 'FAIL') return route.fulfill({ status: 503, json: { error: { message: 'Fixture quotes unavailable' } } });
      if (symbol === 'WAIT') { delayed = () => route.fulfill({ json: { snapshot: snapshot('WAIT') } }); return; }
      return route.fulfill({ json: { snapshot: snapshot(symbol, query.get('expiries') || undefined) } });
    });
    await page.goto('http://127.0.0.1:5174/prototype.html');
    const original = await page.locator('#thesis').inputValue();
    await page.getByLabel('Symbol', { exact: true }).fill('AAPL');
    page.once('dialog', d => d.dismiss());
    await page.getByRole('button', { name: 'Load symbol', exact: true }).click();
    assert.equal(calls, 0); assert.equal(await page.locator('#thesis').inputValue(), original);
    page.on('dialog', d => d.accept());
    await page.getByRole('button', { name: 'Load symbol', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.lab-badge')?.textContent === 'DATED MARKET QUOTES');
    assert.equal(await page.locator('#thesis').inputValue(), '');
    assert.equal(await page.getByLabel('Target price', { exact: true }).inputValue(), '230');
    assert.equal(await page.getByRole('button', { name: 'Optimize · sample', exact: true }).isDisabled(), true);
    assert.ok((await page.locator('.lab-market').innerText()).includes('Tastytrade'));
    await page.getByLabel('Thesis horizon', { exact: true }).fill('2026-09-18');
    await page.locator('#thesis').fill('AAPL thesis');
    await page.waitForFunction(() => document.querySelector('.payoff-chart')?.getAttribute('aria-busy') === 'false');
    await page.getByRole('slider', { name: 'long call strike', exact: true }).press('ArrowRight');
    assert.equal(await page.getByLabel('Target price', { exact: true }).inputValue(), '230');
    await page.getByText('Explore quoted contracts', { exact: false }).click();
    assert.equal(await page.locator('.chain-table-scroll tbody tr').count(), 10);
    await page.getByLabel('Workbench expiry').selectOption('2026-11-20');
    await page.waitForFunction(() => document.querySelector('[aria-label="Scenario date UTC"]')?.max.includes('21:00'), null, { timeout: 5000 }).catch(async error => { await page.screenshot({ path: '.wrangler/market-failure.png', fullPage: true }); throw new Error(`${error.message}: ${JSON.stringify(errors)} / ${await page.locator('.lab-footer').innerText()}`); });
    assert.equal(await page.locator('.lac').count(), 1, 'Quote replacement must remove the previous chart');
    assert.equal(await page.locator('#thesis').inputValue(), 'AAPL thesis');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.getByRole('button', { name: 'Sample mode', exact: true }).click();
    await page.getByRole('button', { name: 'Open draft', exact: true }).click();
    assert.equal(await page.getByLabel('Symbol', { exact: true }).inputValue(), 'AAPL');
    assert.equal(await page.getByLabel('Workbench expiry').inputValue(), '2026-11-20');
    await page.getByLabel('Symbol', { exact: true }).fill('FAIL');
    await page.getByRole('button', { name: 'Load symbol', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.lab-footer')?.textContent.includes('Fixture quotes unavailable'));
    assert.equal(await page.locator('#thesis').inputValue(), 'AAPL thesis');
    await page.getByLabel('Symbol', { exact: true }).fill('WAIT');
    await page.getByRole('button', { name: 'Load symbol', exact: true }).click();
    await page.getByRole('button', { name: 'Loading quotes…', exact: true }).waitFor();
    await page.locator('#thesis').fill('Keep edited thesis');
    assert.ok(delayed); await delayed();
    await page.waitForFunction(() => document.querySelector('.lab-footer')?.textContent.includes('work changed'));
    assert.equal(await page.locator('#thesis').inputValue(), 'Keep edited thesis');
    assert.ok((await page.locator('.lab-market strong').innerText()).includes('AAPL'));
    await page.getByLabel('Symbol', { exact: true }).fill('AAPL');
    await page.screenshot({ path: '.wrangler/market-workbench.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: '.wrangler/market-workbench-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS market load/cancel, quote-only strikes, DST expiry, draft, failure/stale preservation and mobile');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
