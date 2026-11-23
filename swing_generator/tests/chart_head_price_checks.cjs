// Price beside the chart's name (user, 2026-11-23: "have the price feed on the
// head next to the instrument name"). The offline fixture has no quotes.json,
// so this serves one for TEST and answers the cron Worker's /live relay: the
// card header and the full-screen header show the run's price, then the live
// print once Charts polls. Run from app_smoke.cjs with its browser, on a page
// of its own.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('node:assert/strict');

module.exports = async browser => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const dataDir = path.resolve(__dirname, '../webapp/publish/browser-data');
  const runAt = new Date(Date.now() - 3600e3).toISOString();
  await page.route('**/ma500/**', async route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/ma500/')[1]);
    if (relative === 'quotes.json')
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ q: { TEST: { p: 101.25, pc: 100, t: runAt, y: 'TEST-Y' } } }) });
    const file = path.join(dataDir, relative);
    let body = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.from('null');
    if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
    await route.fulfill({ contentType: 'application/json', body });
  });
  let livePrice = null, liveCalls = 0;
  await page.route('**/swingpulse-cron.xabilon18.workers.dev/live**', async route => {
    liveCalls++;
    const body = livePrice == null ? '{}' : JSON.stringify({ 'TEST-Y': [livePrice, Math.floor(Date.now() / 1000)] });
    await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body });
  });
  await page.clock.install();
  await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
  if (await page.locator('.up-skip').isVisible()) await page.locator('.up-skip').click();

  // The card header: ticker, then the price, on the first line.
  const callsBefore = liveCalls;
  livePrice = 102.5;
  await page.locator('.nav-tab[data-tab="charts"]').click();
  const card = page.locator('#chartReel .reel-card:not(.reel-shell)').first();
  const price = card.locator('.reel-head-line .reel-price');
  await price.waitFor();
  await page.waitForFunction(() => document.querySelector('#chartReel .reel-head-line .reel-price')?.textContent.trim() === '102.50',
    null, { timeout: 5000 });
  assert.ok(liveCalls > callsBefore, 'Charts polls the live feed');
  const order = await card.locator('.reel-head-line > *').evaluateAll(es => es.map(e => e.classList[0]));
  assert.deepEqual(order.slice(0, 2), ['reel-name', 'reel-price'], 'the price sits right after the ticker: ' + order.join(', '));
  const hh = await card.locator('.reel-head').evaluate(h => h.getBoundingClientRect().height);
  assert.ok(hh <= 60, 'the card header stays two short lines: ' + hh + 'px');
  const line = await card.locator('.reel-head-line').evaluate(l => {
    const n = l.querySelector('.reel-name').getBoundingClientRect(), p = l.querySelector('.reel-price').getBoundingClientRect();
    return { sameLine: Math.abs(n.bottom - p.bottom) < 6, right: p.right, width: l.getBoundingClientRect().right };
  });
  assert.ok(line.sameLine && line.right <= line.width + 0.5, 'the price is on the name\'s line, inside the card: ' + JSON.stringify(line));

  // Full screen: under the ticker, before the full name (the title line is
  // too narrow there beside the buttons), and re-priced in place.
  await card.locator('[data-act="chart-expand"]').click();
  const full = page.locator('#chartFull.open .cf-sub .reel-price');
  await full.waitFor();
  assert.equal((await full.textContent()).trim(), '102.50');
  livePrice = 103.75;
  await page.clock.fastForward(31000);   // the 30s clock
  await page.waitForFunction(() => document.querySelector('#chartFull .cf-sub .reel-price')?.textContent.trim() === '103.75',
    null, { timeout: 5000 });
  await page.locator('[data-act="chart-full-close"]').click();

  // Leaving Charts for a tab with no prices stops the polling.
  await page.locator('.nav-tab[data-tab="scanner"]').click();
  const stopped = liveCalls;
  await page.clock.fastForward(31000);
  await page.waitForTimeout(300);
  assert.equal(liveCalls, stopped, 'no polling off the Watchlist and Charts');
  assert.deepEqual(errors, []);
  await page.context().close();
};
