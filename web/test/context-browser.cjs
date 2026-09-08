const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], writes = []; let count = 0, fail = false, wrong = false, delayed = false, release;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/api/')) writes.push(request.url()); });
    await page.route('**/api/strategies', route => route.fulfill({ json: { strategies: [] } }));
    const result = symbol => ({ symbol, retrievedAt: '2026-09-06T06:00:00.000Z', sources: [
      { id: 'quote', provider: 'Alpaca', status: 'available', label: `${symbol} IEX quote`, asOf: '2026-09-04T20:00:00Z', url: 'javascript:alert(1)', summary: 'Dated quote, not an executable fill.' },
      { id: `tastytrade-earnings-${symbol.toLowerCase()}`, provider: 'Tastytrade', status: 'available', label: `${symbol} estimated earnings date`, asOf: '2026-09-06T04:00:00Z', url: 'https://developer.tastytrade.com/', summary: 'Expected report date 2026-10-29; estimated=true. Not issuer-confirmed. No report time supplied.' },
      { id: 'dividend-gap', provider: 'Alpaca', status: 'unavailable', label: `${symbol} cash dividends`, asOf: null, url: null, summary: '', reason: 'No validated upcoming event. This is not a complete calendar.' },
    ] });
    await page.route('**/api/context?**', async route => {
      count++; const symbol = new URL(route.request().url()).searchParams.get('symbol');
      if (delayed) await new Promise(resolve => { release = resolve; });
      try { await route.fulfill({ status: fail ? 503 : 200, json: fail ? { error: 'unavailable' } : result(wrong ? 'WRONG' : symbol) }); } catch {}
    });
    await page.route('**/api/chain?**', route => {
      const symbol = new URL(route.request().url()).searchParams.get('symbol');
      const contracts = [90, 95, 100, 105, 110].flatMap(strike => ['call', 'put'].map(type => ({ contractId: `${symbol.padEnd(6)}260918${type === 'call' ? 'C' : 'P'}${String(strike * 1000).padStart(8, '0')}`, type, strike, expiry: '2026-09-18T20:00:00.000Z', multiplier: 100, bid: 2, ask: 2.1, iv: .25, quoteAsOf: '2026-09-04T19:00:00.000Z' })));
      return route.fulfill({ json: { snapshot: { id: 'context-chain', underlying: symbol, source: 'Tastytrade', spot: 100, spotAsOf: '2026-09-04T19:00:00.000Z', retrievedAt: '2026-09-06T06:00:00.000Z', availableExpiries: ['2026-09-18'], contracts } } });
    });
    await page.goto('http://127.0.0.1:5173/');
    const panel = page.getByLabel('Events and market context', { exact: true });
    await panel.waitFor(); assert.equal(count, 0);
    assert.equal(await panel.getAttribute('open'), null);
    await panel.locator(':scope > summary').click(); assert.equal(count, 0);
    assert.match(await panel.innerText(), /sample\/manual position/);
    await panel.getByRole('button', { name: 'Load context', exact: true }).click();
    await panel.getByRole('button', { name: 'Refresh context', exact: true }).waitFor();
    assert.equal(count, 1); assert.match(await panel.innerText(), /2 available; 1 gap\./);
    assert.match(await panel.locator('.workspace-context-sources summary').first().innerText(), /earnings/);
    await panel.getByText('SPY estimated earnings date', { exact: true }).click();
    assert.match(await panel.innerText(), /2026-10-29/); assert.match(await panel.innerText(), /2026-09-06T04:00:00Z/);
    await panel.getByText('SPY IEX quote', { exact: true }).click();
    assert.equal(await panel.locator('a[href^="javascript:"]').count(), 0);
    assert.ok((await panel.boundingBox()).height <= 330, 'Expanded context must leave room for conversation');
    assert.ok((await page.locator('.composer').boundingBox()).height >= 110, 'Context must not squeeze the composer');
    await panel.screenshot({ path: 'web/.wrangler/context-desktop.png' });
    await page.screenshot({ path: 'web/.wrangler/context-workspace.png' });
    fail = true;
    await panel.getByRole('button', { name: 'Refresh context', exact: true }).click();
    await panel.getByRole('alert').waitFor(); assert.equal(await panel.locator('.workspace-context-sources').count(), 0);
    fail = false; wrong = true;
    await panel.getByRole('button', { name: 'Load context', exact: true }).click();
    await panel.getByRole('alert').waitFor(); assert.equal(await panel.locator('.workspace-context-sources').count(), 0);
    wrong = false; delayed = true;
    await panel.getByRole('button', { name: 'Load context', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.workspace-context button')?.textContent === 'Loading context…');
    await page.getByLabel('Underlying symbol', { exact: true }).fill('AAPL');
    await page.getByRole('button', { name: 'Load symbol', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.ticker-symbol')?.textContent === 'AAPL');
    assert.equal(await panel.getAttribute('open'), null);
    await panel.locator(':scope > summary').click();
    release(); delayed = false;
    await panel.getByRole('button', { name: 'Load context', exact: true }).click();
    await panel.getByRole('button', { name: 'Refresh context', exact: true }).waitFor();
    assert.doesNotMatch(await panel.innerText(), /SPY/); assert.match(await panel.innerText(), /AAPL/);
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.getByText('AAPL estimated earnings date', { exact: true }).click();
    await panel.screenshot({ path: 'web/.wrangler/context-mobile.png' });
    assert.equal(await panel.evaluate(element => element.scrollWidth > element.clientWidth), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    console.log('Context browser PASS: explicit fetch, event ordering, dates/gaps, unsafe links, failure/retry, late-symbol cancellation, mobile fit; no API writes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
