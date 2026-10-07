const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let summaries = 0, chunks = 0, revision = 0;
  const live = process.env.SMOKE_LIVE === '1';
  if (!live) {
    const dataDir = path.resolve(__dirname, '../webapp/publish/browser-data');
    await page.route('**/ma500/**', async route => {
      const url = new URL(route.request().url());
      const relative = decodeURIComponent(url.pathname.split('/ma500/')[1]);
      const file = path.join(dataDir, relative);
      if (relative === 'summary.json') summaries++;
      if (relative.startsWith('chart/1H/') && relative.endsWith('.json')) chunks++;
      let body = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.from('null');
      if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
      if (relative === 'summary.json') {
        const summary = JSON.parse(body);
        summary.fetched_at = new Date(Date.parse(summary.fetched_at) + revision * 60000).toISOString();
        body = JSON.stringify(summary);
      }
      await route.fulfill({ contentType: 'application/json', body });
    });
  }
  await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
  await page.locator('.up-skip').click();
  await page.locator('.nav-tab[data-tab="charts"]').click();
  await page.locator('#tfBtn1H').click();
  await page.waitForFunction(() => document.querySelector('#tfBtn1H').getAttribute('aria-selected') === 'true');
  await page.locator('.reel-chart svg').first().waitFor({ timeout: 60000 });
  assert.equal(errors.length, 0, errors.join('\n'));
  if (!live) {
    assert.ok(chunks > 0, '1H chart chunk was fetched');
    await page.clock.install();
    const oldSummaries = summaries, oldChunks = chunks;
    revision++;
    await page.clock.fastForward(30 * 60 * 1000 + 1000);
    await page.waitForFunction(() => document.querySelector('.reel-chart svg'));
    await page.waitForTimeout(1000);
    assert.ok(summaries > oldSummaries, 'visible app reloads datasets after 30 minutes');
    assert.ok(chunks > oldChunks, 'new dataset invalidates and reloads chart chunks');
  }
  await page.screenshot({ path: 'hourly-chart-mobile.png', fullPage: false });
  await page.locator('.nav-tab[data-tab="scanner"]').click();
  await page.locator('[data-al-tf="1H"], [data-al-key="tf"][data-al-val="1H"]').first().waitFor({ timeout: 15000 }).catch(async () => {
    // Alert chips use a shared data-al-* handler; inspect their rendered text.
    assert.ok((await page.locator('#pane-scanner').innerText()).includes('1H'), 'Alerts offers 1H');
  });
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: mobile 1H chart, alerts, refresh and chart-cache invalidation');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
