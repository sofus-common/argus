const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const created = [];
  const base = 'http://127.0.0.1:5173';
  const headers = { Origin: base, 'Content-Type': 'application/json', 'X-ARGUS-Request': '1' };
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const guarded = () => page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.locator('.saved-workspace summary').click();
    const save = page.getByRole('button', { name: 'Save', exact: true });
    const load = page.getByRole('button', { name: 'Load', exact: true });
    const picker = page.getByLabel('Saved positions', { exact: true });
    await page.getByText('LOCAL · Local development', { exact: false }).waitFor();
    await page.locator('.template-list button').filter({ hasText: 'Bull call' }).click();
    await page.getByLabel('Saved strategy title').fill(`Browser verification ${Date.now()}`);
    const savedResponse = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/strategies'));
    await save.click();
    const response = await savedResponse;
    assert.equal(response.status(), 201);
    const { record } = await response.json();
    created.push(record.id);
    await page.getByText('Position saved. Subsequent changes are not saved automatically.').waitFor();
    await page.reload();
    await page.locator('.saved-workspace summary').click();
    await picker.locator(`option[value="${record.id}"]`).waitFor({ state: 'attached' });
    await picker.selectOption(record.id);
    await load.click();
    await page.getByText('Loaded saved position. Undo restores the previous position.').waitFor();
    assert.equal(await page.locator('h1').textContent(), record.state.name);
    assert.equal(await page.locator('.leg-row').count(), 2);
    if (process.argv.includes('--unsaved-only')) {
      assert.equal(await guarded(), false);
      await page.getByLabel('Contracts', { exact: true }).first().fill('3');
      assert.equal(await guarded(), true);
      assert.match(await page.locator('.saved-workspace summary').innerText(), /Unsaved changes/);
      let warned = false;
      page.once('dialog', async dialog => { assert.equal(dialog.type(), 'beforeunload'); warned = true; await dialog.dismiss(); });
      await page.reload({ timeout: 3000 }).catch(error => { assert.match(error.message, /ERR_ABORTED|Timeout/); });
      assert.equal(warned, true);
      assert.equal(await page.getByLabel('Contracts', { exact: true }).first().inputValue(), '3');
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      assert.equal(await guarded(), false);
      await page.getByLabel('Saved strategy title').fill('Unsaved renamed position');
      assert.equal(await guarded(), true);
      await save.click(); await page.getByText('Position saved. Subsequent changes are not saved automatically.').waitFor();
      assert.equal(await guarded(), false);
      console.log('Unsaved guard PASS: saved/load baseline, edit, canceled real reload, Undo, title and explicit save.');
      return;
    }
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(await page.locator('h1').textContent(), 'Iron Condor');
    assert.equal(await page.locator('.leg-row').count(), 4);
    await load.click();
    await page.getByText('Loaded saved position. Undo restores the previous position.').waitFor();
    assert.equal(await page.locator('.leg-row').count(), 2);

    // Another tab updates the same revision; the open editor must keep its edits.
    const competing = await page.request.put(`${base}/api/strategies/${record.id}`, { headers, data: { title: record.title, state: record.state, revision: record.revision } });
    assert.equal(competing.status(), 200);
    const updatedRecord = (await competing.json()).record;
    await page.getByLabel('Contracts', { exact: true }).first().fill('3');
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export saved JSON', exact: true }).click();
    const download = await downloadEvent;
    const stream = await download.createReadStream();
    let exportedText = ''; for await (const chunk of stream) exportedText += chunk.toString();
    const exported = JSON.parse(exportedText);
    assert.equal(exported.format, 'argus-saved-position'); assert.equal(exported.formatVersion, 1);
    assert.deepEqual(exported.record, updatedRecord);
    assert.equal(exported.record.revision, record.revision + 1);
    assert.equal(await page.getByLabel('Contracts', { exact: true }).first().inputValue(), '3');
    assert.match(download.suggestedFilename(), /-r2\.json$/);
    await page.getByText(/Exported saved revision 2/).waitFor();
    if (process.argv.includes('--export-only')) {
      let extraDownloads = 0; page.on('download', () => extraDownloads++);
      await page.route('**/api/strategies/*/export', route => route.fulfill({ status: 503, json: { error: { code: 'storage_unavailable' } } }));
      await page.getByRole('button', { name: 'Export saved JSON', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'No file was downloaded' }).waitFor();
      assert.equal(extraDownloads, 0);
      assert.equal(await page.getByLabel('Contracts', { exact: true }).first().inputValue(), '3');
      const unchanged = await page.request.get(`${base}/api/strategies/${record.id}`);
      assert.deepEqual((await unchanged.json()).record, updatedRecord);
      assert.deepEqual(errors, []);
      console.log('Saved export PASS: real local record download, current saved revision rather than unsaved edits, JSON fidelity, no write, failure without download.');
      return;
    }
    await save.click();
    await page.getByRole('alert').filter({ hasText: 'changed elsewhere' }).waitFor();
    assert.equal(await guarded(), true);
    assert.equal(await page.getByLabel('Contracts', { exact: true }).first().inputValue(), '3');

    await page.route('**/api/strategies', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { error: { message: 'Test storage outage' } } }) : route.continue());
    await page.getByRole('button', { name: 'Save as new', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Test storage outage' }).waitFor();
    assert.equal(await guarded(), true);
    assert.equal(await page.getByLabel('Contracts', { exact: true }).first().inputValue(), '3');
    await page.unroute('**/api/strategies');

    let release, began;
    const hold = new Promise(resolve => { release = resolve; });
    const requested = new Promise(resolve => { began = resolve; });
    await page.route(`**/api/strategies/${record.id}`, async route => {
      if (route.request().method() !== 'GET') return route.continue();
      const reply = await route.fetch(); began(); await hold; await route.fulfill({ response: reply });
    });
    await load.click(); await requested;
    await page.getByLabel('Contracts', { exact: true }).first().fill('4');
    release();
    await page.getByText('Load not applied: your workspace changed while loading.').waitFor();
    assert.equal(await guarded(), true);
    assert.equal(await page.getByLabel('Contracts', { exact: true }).first().inputValue(), '4');
    await page.unroute(`**/api/strategies/${record.id}`);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    assert.equal(await picker.inputValue(), '');

    // A save already committed by the server must not reconnect a newer workspace.
    let releaseSave, beganSave;
    const saveHold = new Promise(resolve => { releaseSave = resolve; });
    const saveRequested = new Promise(resolve => { beganSave = resolve; });
    await page.route('**/api/strategies', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const reply = await route.fetch();
      assert.equal(reply.status(), 201);
      created.push((await reply.json()).record.id);
      beganSave(); await saveHold; await route.fulfill({ response: reply });
    });
    await page.getByLabel('Saved strategy title').fill(`Delayed save ${Date.now()}`);
    await save.click(); await saveRequested;
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByLabel('Contracts', { exact: true }).fill('2');
    const refreshedList = page.waitForResponse(r => r.request().method() === 'GET' && r.url().endsWith('/api/strategies'));
    releaseSave(); await refreshedList;
    await picker.locator(`option[value="${created.at(-1)}"]`).waitFor({ state: 'attached' });
    assert.equal(await guarded(), true);
    if (process.argv.includes('--guard-races-only')) { console.log('Unsaved guard races PASS: conflict, failed save, stale load and delayed save/New remain dirty.'); return; }
    assert.equal(await picker.inputValue(), '');
    assert.equal(await page.getByLabel('Saved strategy title').inputValue(), '');
    assert.equal(await page.getByLabel('Contracts', { exact: true }).inputValue(), '2');
    await page.unroute('**/api/strategies');
    const newSaveResponse = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/strategies'));
    await save.click();
    const newSave = await newSaveResponse;
    assert.equal(newSave.status(), 201);
    created.push((await newSave.json()).record.id);
    await page.getByText('Position saved. Subsequent changes are not saved automatically.').waitFor();
    await page.getByRole('button', { name: 'New', exact: true }).click();

    // Real provider snapshot is saved to local D1 and reopened after a page reload.
    const chainResponse = page.waitForResponse(r => r.url().includes('/api/chain'), { timeout: 45000 });
    await page.getByRole('button', { name: 'Use real prices', exact: true }).click();
    const chain = await chainResponse;
    assert.equal(chain.status(), 200);
    const { snapshot } = await chain.json();
    await page.getByText('REAL CONTRACTS · ESTIMATED ENTRY', { exact: true }).waitFor();
    const premium = await page.getByLabel('Entry premium').inputValue();
    const ribbon = await page.locator('.metric-ribbon').innerText();
    await page.getByLabel('Saved strategy title').fill(`Historical verification ${Date.now()}`);
    const quoteSave = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/strategies'));
    await save.click();
    const quoteReply = await quoteSave;
    assert.equal(quoteReply.status(), 201);
    const quoted = (await quoteReply.json()).record;
    created.push(quoted.id);
    await page.getByText('Position saved. Subsequent changes are not saved automatically.').waitFor();
    await page.reload();
    await page.locator('.saved-workspace summary').click();
    await picker.locator(`option[value="${quoted.id}"]`).waitFor({ state: 'attached' });
    await picker.selectOption(quoted.id);
    const reopened = page.waitForResponse(r => r.url().endsWith(`/api/strategies/${quoted.id}`));
    await load.click();
    const restored = (await (await reopened).json()).record;
    await page.getByText('HISTORICAL SAVED QUOTES', { exact: true }).waitFor();
    assert.equal(restored.snapshot.retrievedAt, snapshot.retrievedAt);
    assert.equal(restored.snapshot.spotAsOf, snapshot.spotAsOf);
    assert.deepEqual(restored.snapshot.contracts, snapshot.contracts);
    assert.notEqual(restored.snapshot.id, snapshot.id);
    assert.equal(await page.getByLabel('Entry premium').inputValue(), premium);
    assert.equal(await page.locator('.metric-ribbon').innerText(), ribbon);
    await page.route('**/api/sparring', route => {
      const input = route.request().postDataJSON();
      assert.equal(input.state.pricing.historical, true);
      return route.fulfill({ json: { request_id: input.request_id, base_state_version: input.base_state_version, next_state: input.state,
        reply: { text: 'Review of saved quotes.', operations: [], assumptions: [], objections: [], evidence_ids: [] },
        calculated: { historicalQuotes: true, dataMode: 'market-snapshot', riskSummary: 'Historical position, before costs.' },
      } });
    });
    await page.getByRole('button', { name: 'Break the thesis', exact: true }).click();
    await page.getByText('CALCULATED · HISTORICAL QUOTES', { exact: true }).waitFor();
    await page.screenshot({ path: '../docs/screenshots/argus-private-workspace.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByText('Saved copy deleted. The open position is unchanged.').waitFor();
    assert.equal(await page.getByLabel('Entry premium').inputValue(), premium);
    assert.deepEqual(errors, []);
    console.log('Private browser checks passed: reload persistence, Load/Undo, revision conflict, failed save, stale load, delayed save/New isolation, real historical quote restoration, unchanged metrics, delete preservation and mobile overflow.');
  } finally {
    const request = await browser.newContext();
    for (const id of created) {
      const response = await request.request.get(`${base}/api/strategies/${id}`);
      if (response.ok()) { const { record } = await response.json(); await request.request.delete(`${base}/api/strategies/${id}`, { headers, data: { revision: record.revision } }); }
    }
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
