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
    // Install before navigation so the app's interval is registered on this
    // clock; installing after load leaves already-created real timers intact.
    await page.clock.install();
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
  await page.addInitScript(() => {
    localStorage.setItem('swingpulse-chart-tf', '30m');
    localStorage.setItem('swingpulse-tf', '30m');
    localStorage.setItem('swingpulse-wl-ui', JSON.stringify({ ttf: '30m' }));
    localStorage.setItem('swingpulse-al-ui', JSON.stringify({ tf: '30m' }));
    localStorage.setItem('swingpulse-mk-ui', JSON.stringify({ ccyTf: '30m' }));
  });
  await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
  await page.locator('.up-skip').click();
  await page.locator('.nav-tab[data-tab="charts"]').click();
  assert.equal(await page.locator('[data-tf="30m"]').count(), 0, 'Removed timeframe has no global or chart control');
  assert.equal(await page.locator('#tfBtn1H').getAttribute('aria-selected'), 'true', 'Saved 30m chart selection opens on 1H');
  assert.equal(await page.evaluate(() => localStorage.getItem('swingpulse-chart-tf')), '1H');
  await page.locator('#tfBtn1H').click();
  await page.waitForFunction(() => document.querySelector('#tfBtn1H').getAttribute('aria-selected') === 'true');
  await page.locator('.reel-chart svg').first().waitFor({ timeout: 60000 });
  assert.equal(errors.length, 0, errors.join('\n'));
  if (!live) {
    assert.ok(chunks > 0, '1H chart chunk was fetched');
    const oldSummaries = summaries, oldChunks = chunks;
    const refreshedSummary = page.waitForResponse(r => r.url().includes('/ma500/summary.json'));
    const refreshedChart = page.waitForResponse(r => r.url().includes('/ma500/chart/1H/'));
    revision++;
    await page.clock.fastForward(30 * 60 * 1000 + 1000);
    await Promise.all([refreshedSummary, refreshedChart]);
    await page.waitForFunction(() => document.querySelector('.reel-chart svg'));
    await page.waitForTimeout(1000);
    assert.ok(summaries > oldSummaries, 'visible app reloads datasets after 30 minutes');
    assert.ok(chunks > oldChunks, 'new dataset invalidates and reloads chart chunks');
  }
  await page.locator('#tfBtn4H').click();
  await page.waitForFunction(() => document.querySelector('#tfBtn4H').getAttribute('aria-selected') === 'true');
  await page.locator('#chartReel [data-act="chart-expand"]').first().click();
  await page.locator('#chartFull .reel-chart svg').waitFor({ timeout: 60000 });
  for (let i = 0; i < 2; i++) {
    await page.locator('#chartFull .reel-tgrip').waitFor({ state: 'visible' });
    const grip = await page.locator('#chartFull .reel-tgrip').boundingBox();
    await page.mouse.move(grip.x + 12, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width - 8, grip.y + grip.height / 2, { steps: 12 });
    await page.mouse.up();
  }
  await page.locator('#chartFull .reel-tgrid-year').first().waitFor({ state: 'attached' });
  assert.equal(await page.locator('#chartFull .reel-tgrid-year').first().evaluate(line => getComputedStyle(line).strokeWidth), '6px', 'Yearly stroke is bold');
  assert.ok(await page.locator('#chartFull .reel-tgrid-year').count() > 0, 'Permanent yearly references render on 4H');
  await page.locator('#chartFull [data-act="grid-menu"]').click();
  await page.locator('.reel-grid-menu [data-division="M"]').click();
  await page.locator('#chartFull [data-act="chart-full-close"]').click();
  await page.locator('#tfBtn1H').click();
  await page.screenshot({ path: 'hourly-chart-mobile.png', fullPage: false });
  await page.locator('.nav-tab[data-tab="scanner"]').click();
  await page.locator('[data-al-tf="1H"], [data-al-key="tf"][data-al-val="1H"]').first().waitFor({ timeout: 15000 }).catch(async () => {
    // Alert chips use a shared data-al-* handler; inspect their rendered text.
    assert.ok((await page.locator('#pane-scanner').innerText()).includes('1H'), 'Alerts offers 1H');
  });
  assert.equal(await page.locator('[data-al-tf="30m"]').count(), 0);
  await page.locator('.nav-tab[data-tab="watchlist"]').click();
  assert.equal(await page.locator('[data-wl-ttf="30m"]').count(), 0);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: mobile 1H/4H charts, removed 30m, alerts, refresh and chart-cache invalidation');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
