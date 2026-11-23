// Yearly chart (user, 2026-11-23). The fixture's Yearly chart is TEST's closed
// years 2001-2025 with the 10-year MA, and 2026 as a forming candle, built by
// tools/publish_htf.py with Monthly (browser_fixture.py). Checks: the Yearly
// button after Monthly, its own chunk map, the MA10 line, the forming 2026
// candle and its "still forming" reading, its close following the live price
// (and ignoring one off its level), the 40/50/80/100-year grids alone with 40
// by default and a choice that is saved, and the full-screen timeframe steps
// through it. Run from app_smoke.cjs with its browser, on a page of its own.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('node:assert/strict');

module.exports = async browser => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const dataDir = path.resolve(__dirname, '../webapp/publish/browser-data');
  // A quote for TEST (the fixture has none) and a live relay whose price the
  // test sets: the forming year follows it.
  const runAt = new Date(Date.now() - 3600e3).toISOString();
  await page.route('**/ma500/**', async route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/ma500/')[1]);
    if (relative === 'quotes.json')
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ q: { TEST: { p: 130, pc: 128, t: runAt, y: 'TEST-Y' } } }) });
    const file = path.join(dataDir, relative);
    let body = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.from('null');
    if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
    await route.fulfill({ contentType: 'application/json', body });
  });
  let livePrice = 140;
  await page.route('**/swingpulse-cron.xabilon18.workers.dev/live**', route => route.fulfill({
    contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ 'TEST-Y': [livePrice, Math.floor(Date.now() / 1000)] }) }));
  const open = async () => {
    await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
    if (await page.locator('.up-skip').isVisible()) await page.locator('.up-skip').click();
    await page.locator('.nav-tab[data-tab="charts"]').click();
  };
  await page.clock.install();
  await open();
  assert.deepEqual(await page.locator('.tf-switch-btn').evaluateAll(es => es.map(e => e.dataset.tf)), ['1H', 'D', 'M', 'Y'],
    'Yearly comes after Monthly');

  // Its own chunk map, like Monthly.
  const index = page.waitForResponse(r => r.url().includes('/ma500/chart/Y/index.json'));
  const chunk = page.waitForResponse(r => r.url().includes('/ma500/chart/Y/0.json'));
  await page.locator('#tfBtnY').click();
  await Promise.all([index, chunk]);
  const host = page.locator('#chartReel .reel-chart').first();
  await host.locator('svg').waitFor({ timeout: 60000 });
  const read = () => host.evaluate(h => {
    const b = h._reelCtx.b, svg = h.querySelector('svg'), n = b.t.length;
    return { first: b.t[0], last: b.t[n - 1], bars: n, periods: b.p, lastClose: b.c[n - 1], lastHigh: b.h[n - 1],
      maLast: b.m[0] && b.m[0][b.m[0].length - 1],
      maLines: [...svg.querySelectorAll('polyline')].filter(p => /reel-ma|--sell/.test(p.getAttribute('stroke') || '')).length,
      labels: [...svg.querySelectorAll('text')].map(t => t.textContent.trim()).filter(t => /^\d{4}$/.test(t)) };
  });
  // The live price (140, inside the band around the published close 130) is in.
  await page.waitForFunction(() => {
    const h = document.querySelector('#chartReel .reel-chart'), b = h && h._reelCtx && h._reelCtx.b;
    return b && b.c[b.c.length - 1] === 140;
  }, null, { timeout: 10000 });
  let chart = await read();
  assert.deepEqual([chart.first, chart.last, chart.bars], ['2001-01-01', '2026-01-01', 26],
    'closed years 2001-2025 and 2026 forming: ' + JSON.stringify(chart));
  assert.deepEqual(chart.periods, [10], 'the 10-year MA');
  assert.ok(chart.maLines >= 1, 'the MA line is drawn: ' + JSON.stringify(chart));
  assert.equal(chart.lastHigh, 140, 'the forming high widens to the live price');
  const closes = await host.evaluate(h => h._reelCtx.b.c.slice(-10));
  assert.ok(Math.abs(chart.maLast - closes.reduce((a, v) => a + v, 0) / 10) < 1e-6, 'the MA point is redone with the live price');
  // 40-year lines from 2000 by default. TEST starts in 2001, so no line falls
  // inside it (2000 and 2040 are either side): the axis names its two ends by
  // year, not by date.
  assert.deepEqual(chart.labels.sort(), ['2001', '2026'], 'no grid line inside 2001-2026; the ends read as years: ' + chart.labels);
  assert.equal(await host.locator('svg text').evaluateAll(ts => ts.filter(t => /\d{4}-\d{2}-\d{2}/.test(t.textContent)).length), 0,
    'no full dates on the Yearly axis');

  // A price off the candle's level (more than 25% away) is not used: the
  // candle shows its published close (130) until a price on its level comes.
  livePrice = 400;
  await page.clock.fastForward(31000);
  await page.waitForFunction(() => {
    const b = document.querySelector('#chartReel .reel-chart')._reelCtx.b;
    return b.c[b.c.length - 1] === 130;
  }, null, { timeout: 10000 });
  assert.equal((await read()).lastHigh, 131, 'its published high, not 400');
  livePrice = 125;
  await page.clock.fastForward(31000);
  await page.waitForFunction(() => {
    const b = document.querySelector('#chartReel .reel-chart')._reelCtx.b;
    return b.c[b.c.length - 1] === 125;
  }, null, { timeout: 10000 });

  // The Grid menu: Yearly's grids alone, 40 on; 50 is saved across a reload.
  const gridBtn = page.locator('#chartReel [data-act="grid-menu"]').first();
  const codes = async () => {
    await gridBtn.click();
    await page.locator('.reel-grid-menu').waitFor();
    return page.locator('.reel-grid-menu [data-act="time-grid-set"]').evaluateAll(es =>
      es.map(e => e.dataset.division + (e.classList.contains('on') ? '*' : '')));
  };
  assert.deepEqual(await codes(), ['Y40*', 'Y50', 'Y80', 'Y100'], 'Yearly offers 40, 50, 80 and 100 years');
  await page.locator('.reel-grid-menu [data-act="time-grid-set"][data-division="Y50"]').click();
  await page.waitForTimeout(300);
  if (await page.locator('.reel-grid-menu').count()) await gridBtn.click();
  await open();
  if (await page.locator('#tfBtnY').getAttribute('aria-selected') !== 'true') await page.locator('#tfBtnY').click();
  await page.locator('#chartReel .reel-chart svg').first().waitFor({ timeout: 60000 });
  assert.deepEqual(await codes(), ['Y40', 'Y50*', 'Y80', 'Y100'], 'the Yearly grid choice is saved across a reload');
  await gridBtn.click();
  // Monthly keeps its own grids and gets none of Yearly's.
  await page.locator('#tfBtnM').click();
  await page.locator('#chartReel .reel-chart svg').first().waitFor({ timeout: 60000 });
  const monthly = await codes();
  assert.ok(!monthly.some(c => /^Y(40|50|80|100)/.test(c)) && monthly.some(c => /^T\*?$/.test(c)), 'Monthly grids unchanged: ' + monthly);
  await gridBtn.click();
  await page.locator('#tfBtnY').click();
  await page.locator('#chartReel .reel-chart svg').first().waitFor({ timeout: 60000 });

  // Full screen: the last bar reads as the forming year, and ‹ › step M <- Y -> 1H.
  await page.locator('#chartReel [data-act="chart-expand"]').first().click();
  await page.locator('#chartFull.open .reel-chart svg').waitFor({ timeout: 60000 });
  await page.locator('#chartFull .cf-info summary').click();
  await page.waitForFunction(() => /forming/i.test(document.querySelector('#chartFull .cf-info')?.innerText || ''), null, { timeout: 10000 });
  const info = await page.locator('#chartFull .cf-info').innerText();
  assert.match(info, /Still forming/i, info);
  assert.match(info, /\b2026\b/, 'the forming bar reads 2026: ' + info);
  await page.locator('#chartFull .cf-info summary').click();
  const tag = () => page.locator('#chartFull .reel-foot .reel-tf-tag').innerText();
  await page.locator('#chartFull [data-act="chart-tf-step"][data-dir="-1"]').click();
  await page.waitForFunction(() => /Monthly/.test(document.querySelector('#chartFull .reel-foot .reel-tf-tag')?.innerText || ''));
  await page.locator('#chartFull [data-act="chart-tf-step"][data-dir="1"]').click();
  await page.waitForFunction(() => /Yearly/.test(document.querySelector('#chartFull .reel-foot .reel-tf-tag')?.innerText || ''));
  await page.locator('#chartFull [data-act="chart-tf-step"][data-dir="1"]').click();
  // The pill names the timeframe in full: 1H is "Hourly".
  await page.waitForFunction(() => /Hourly/.test(document.querySelector('#chartFull .reel-foot .reel-tf-tag')?.innerText || ''));
  assert.match(await tag(), /Hourly/, 'Yearly wraps to 1H');
  assert.deepEqual(errors, []);
  await context.close();
};
