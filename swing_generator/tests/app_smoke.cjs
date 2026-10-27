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
    // A Chart range stored by an older version must not survive the load: a set
    // range switches off every timeframe's opening frame (2026-10-27).
    localStorage.setItem('swingpulse-reel-range', '130');
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
  assert.equal(await page.evaluate(() => localStorage.getItem('swingpulse-reel-range')), null, 'stored Chart range is dropped');
  assert.equal(await page.locator('#reelRangeOpts .reel-opt.active').getAttribute('data-range'), '0', 'charts open on their frames, not a stored range');
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
  if (!live) {
    // Weekly and Monthly (back 2026-10-19): chart only, each read through its own
    // chunk map, with no 4H read under their name, divided by administration
    // term with every line equal (no bold, no year lines).
    for (const [tf, word] of [['W', 'weekly'], ['M', 'monthly']]) {
      const index = page.waitForResponse(r => r.url().includes(`/ma500/chart/${tf}/index.json`));
      const chunk = page.waitForResponse(r => r.url().includes(`/ma500/chart/${tf}/0.json`));
      await page.locator(`#tfBtn${tf}`).click();
      await Promise.all([index, chunk]);
      await page.waitForFunction(id => document.querySelector(id).getAttribute('aria-selected') === 'true', `#tfBtn${tf}`);
      await page.locator('#chartReel .reel-chart svg').first().waitFor({ timeout: 60000 });
      const card = await page.locator('#chartReel .reel-card').first().innerText();
      // Labels are thinned to fit, so which ones are named depends on width.
      // Labels are thinned to fit, so which terms are named depends on width.
      assert.ok(/20\d\d · (Obama|Trump|Biden)/.test(card), `${tf} is divided by term`);
      const grid = page.locator('#chartReel .reel-card').first();
      assert.equal(await grid.locator('.reel-tgrid-admin, .reel-tgrid-year, .reel-tgrid-quarter, .reel-tgrid-month').count(), 0, `${tf} lines are all equal`);
      assert.ok(await grid.locator('line.reel-tgrid').count() >= 3, `${tf} draws its term lines`);
      assert.ok(!/\b[WM] (aligned|minor)/.test(card), `${tf} shows no borrowed 4H relation`);
      assert.ok(/Bar \d+ \w+/.test(card), `${word} bar is dated`);
      if (tf === 'W') {
        // The Monthly overlay on Weekly, drawn from the Weekly bundle's own `mo`.
        await page.locator('#chartReel [data-act="tf-menu"]').first().click();
        await page.locator('.reel-tf-menu [data-act="ov-htf"][data-tf="M"]').click();
        await page.waitForFunction(() => [...document.querySelectorAll('#chartReel .reel-chart .reel-ov text')].some(t => t.textContent.startsWith('M50')));
        await page.locator('.reel-tf-menu [data-act="ov-htf"][data-tf="M"]').click();
        await page.locator('#chartReel [data-act="tf-menu"]').first().click();
      }
    }
    assert.equal(errors.length, 0, errors.join('\n'));
  }
  await page.locator('#tfBtn4H').click();
  await page.waitForFunction(() => document.querySelector('#tfBtn4H').getAttribute('aria-selected') === 'true');
  await page.locator('#chartReel [data-act="chart-expand"]').first().click();
  await page.locator('#chartFull .reel-chart svg').waitFor({ timeout: 60000 });
  for (let i = 0; i < 2; i++) {
    // Repainting replaces the SVG node, so read visibility and coordinates
    // together instead of racing waitFor() against a separate boundingBox().
    const ready = await page.waitForFunction(() => {
      const el = document.querySelector('#chartFull .reel-tgrip');
      if (!el) return null;
      const { x, y, width, height } = el.getBoundingClientRect();
      return width > 0 && height > 0 ? { x, y, width, height } : null;
    });
    const grip = await ready.jsonValue();
    await ready.dispose();
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
  // Swap shaded gaps is kept per market (2026-10-17; 'other' split into
  // energy, commodities, crypto, currency and rates 2026-10-21). The swap
  // lands on the open chart's market only (TEST offline is a stock; live, the
  // first chart can be any market), and the other markets keep their own.
  await page.locator('.reel-grid-menu [data-act="grid-set"][data-part="on"]').click();
  const bandXs = () => page.locator('#chartFull .reel-band-g rect').evaluateAll(rs => rs.map(r => r.getAttribute('x')).join(','));
  const unswapped = await bandXs();
  assert.ok(unswapped.length > 0, 'Shading draws bands on 4H');
  const market = await page.locator('.reel-grid-menu [data-division="M"]').getAttribute('data-grid-scope');
  assert.ok(await page.evaluate(m => Object.hasOwn(window.SwingPulseModules.chartPreferences.scopes, m), market), 'The menu names a known market');
  if (!live) assert.equal(market, 'stocks', 'TEST is a stock');
  await page.locator('.reel-grid-menu [data-part="flip"]').click();
  await page.waitForFunction(before => [...document.querySelectorAll('#chartFull .reel-band-g rect')].map(r => r.getAttribute('x')).join(',') !== before, unswapped);
  const shade4h = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('sp-overlay')))).shade['4H']);
  assert.deepEqual(Object.keys(shade4h.flipBy), [market], 'Only the open chart\'s market is swapped');
  assert.equal(shade4h.flipBy[market], true);
  await page.locator('.reel-grid-menu [data-part="flip"]').click();
  await page.waitForFunction(before => [...document.querySelectorAll('#chartFull .reel-band-g rect')].map(r => r.getAttribute('x')).join(',') === before, unswapped);
  await page.locator('.reel-grid-menu [data-act="grid-set"][data-part="on"]').click();
  await page.locator('#chartFull [data-act="grid-menu"]').click();
  await require('./drawing_toolbar_checks.cjs')(page);
  await require('./saved_work_checks.cjs')(page);
  await page.locator('#tfBtn1H').click();
  await page.screenshot({ path: 'hourly-chart-mobile.png', fullPage: false });
  await page.locator('.nav-tab[data-tab="scanner"]').click();
  await page.locator('.al-chips [data-al-tf="4H"]').waitFor();
  await page.locator('.al-chips [data-al-tf="D"]').waitFor();
  assert.equal(await page.locator('.al-chips [data-al-tf="1H"]').count(), 0, '1H is linked entry context, not a standalone signal stream');
  assert.ok((await page.locator('#alertsPane').innerText()).includes('linked 1H entry detail'));
  assert.equal(await page.locator('[data-al-tf="30m"]').count(), 0);
  await page.locator('.nav-tab[data-tab="watchlist"]').click();
  assert.equal(await page.locator('[data-wl-ttf="30m"]').count(), 0);
  assert.equal(errors.length, 0, errors.join('\n'));
  if (!live) await require('./chart_framing_checks.cjs')(page);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: mobile 1H/4H/Weekly/Monthly charts, removed 30m, alerts, compact drawing toolbar, refresh and chart-cache invalidation');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
