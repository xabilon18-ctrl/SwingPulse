// Where you left off (user, 2026-11-26: the installed app "opens fresh and
// resets"; chose "Always where I left off"). A first visit opens on the
// Watchlist; after that a reload or a fresh start comes back on the tab, the
// chart and its timeframe, full screen, and the page scroll it was left on. A
// chart link in the URL wins over the saved place. Run from app_smoke.cjs
// with its browser, on a page of its own.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('node:assert/strict');

module.exports = async browser => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const dataDir = path.resolve(__dirname, '../webapp/publish/browser-data');
  await page.route('**/ma500/**', async route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/ma500/')[1]);
    const file = path.join(dataDir, relative);
    let body = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.from('null');
    if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
    await route.fulfill({ contentType: 'application/json', body });
  });
  const base = process.env.SMOKE_URL || 'http://127.0.0.1:8000';
  const skip = async () => { if (await page.locator('.up-skip').isVisible()) await page.locator('.up-skip').click(); };
  const activeTab = () => page.locator('.nav-tab.active').getAttribute('data-tab');
  // The saved place is put back after the data load; wait for it to settle.
  const settled = () => page.waitForTimeout(1500);

  await page.goto(base, { waitUntil: 'networkidle' });
  await skip();
  assert.equal(await activeTab(), 'watchlist', 'a first visit opens on the Watchlist');

  // Charts, Monthly, full screen: all three come back.
  await page.locator('.nav-tab[data-tab="charts"]').click();
  await page.locator('#tfBtnM').click();
  await page.waitForFunction(() => document.querySelector('#tfBtnM').getAttribute('aria-selected') === 'true');
  const card = page.locator('#chartReel .reel-card').first();
  await card.locator('.reel-chart svg').waitFor({ timeout: 60000 });
  const name = await card.getAttribute('data-name');
  await card.locator('[data-act="chart-expand"]').click();
  await page.locator('#chartFull.open').waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await skip();
  await page.locator('#chartFull.open').waitFor({ timeout: 10000 });
  assert.equal(await activeTab(), 'charts', 'reopens on Charts');
  assert.equal(await page.locator('#tfBtnM').getAttribute('aria-selected'), 'true', 'on the timeframe it was left on');
  assert.equal(await page.locator('#chartFull [data-name]').first().getAttribute('data-name'), name, 'full screen again, on the same chart');
  await page.locator('#chartFull [data-act="chart-full-close"]').first().click();
  await page.waitForFunction(() => !document.querySelector('#chartFull.open'));
  await page.reload({ waitUntil: 'networkidle' });
  await skip();
  await settled();
  assert.equal(await activeTab(), 'charts');
  assert.equal(await page.locator('#chartFull.open').count(), 0, 'closed full screen stays closed');
  assert.equal(await page.locator('#chartReel .reel-card').first().getAttribute('data-name'), name);

  // Market, scrolled down: the tab and the scroll come back.
  await page.locator('.nav-tab[data-tab="dashboard"]').click();
  await page.locator('#marketToday *').first().waitFor();
  const room = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  const y = Math.min(400, Math.floor(room / 2));
  await page.evaluate(top => window.scrollTo({ top, behavior: 'instant' }), y);
  await page.reload({ waitUntil: 'networkidle' });
  await skip();
  await settled();
  assert.equal(await activeTab(), 'dashboard', 'reopens on the Market tab');
  if (y > 0) {
    const now = await page.evaluate(() => window.scrollY);
    assert.ok(Math.abs(now - y) <= 2, `back at the same scroll (${now} vs ${y})`);
  }

  // A chart link (a notification tap) wins over the saved place.
  await page.goto(`${base}/?chart=${encodeURIComponent(name)}&tf=D`, { waitUntil: 'networkidle' });
  await skip();
  await page.waitForFunction(() => document.querySelector('#tfBtnD')?.getAttribute('aria-selected') === 'true', null, { timeout: 15000 });
  await settled();
  assert.equal(await activeTab(), 'charts', 'the link opens its chart, not the saved Market tab');

  assert.equal(errors.length, 0, errors.join('\n'));
  await page.context().close();
  console.log('PASS: reopens where you left off (tab, chart, timeframe, full screen, scroll); a chart link wins');
};
