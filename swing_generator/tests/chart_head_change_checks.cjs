// Today's % change on the chart header (user, 2026-11-23: "price change in
// percentage green up red negative or down and also on the right not left";
// it replaced the price #250 put beside the ticker). The offline fixture has
// no quotes.json, so this serves one for TEST (previous close 100) and answers
// the cron Worker's /live relay: the card's name line and the full-screen line
// under the ticker show the change at their right end, green up, red down,
// and follow the live print once Charts polls. Run from app_smoke.cjs with its
// browser, on a page of its own.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('node:assert/strict');
const openChart = require('./chart_open.cjs');

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
  // Each reading carries the app's own up / down colours where the change
  // sits: full screen sets darker ones for its white background.
  const look = sel => page.evaluate(sel => {
    const e = document.querySelector(sel);
    if (!e || e.hidden) return null;
    const s = getComputedStyle(e), probe = document.createElement('i');
    e.parentElement.appendChild(probe);
    const rgb = v => { probe.style.color = s.getPropertyValue(v).trim(); return getComputedStyle(probe).color; };
    const up = rgb('--buy'), down = rgb('--sell');
    probe.remove();
    const line = e.parentElement.getBoundingClientRect(), r = e.getBoundingClientRect();
    return { text: e.textContent.trim(), colour: s.color, up, down, rightGap: line.right - r.right, left: r.left, lineLeft: line.left, lineWidth: line.width };
  }, sel);
  const waitText = (sel, text) => page.waitForFunction(([s, t]) => document.querySelector(s)?.textContent.trim() === t, [sel, text], { timeout: 5000 });

  // Full screen: +2.50% (live 102.50 on 100), green, at the right end of
  // the line under the ticker; repainted red when the market turns down.
  // (The small chart cards that also showed it were removed on 2026-11-27.)
  const FULL = '#chartFull.open .cf-sub .reel-chg';
  const callsBefore = liveCalls;
  livePrice = 102.5;
  await openChart(page, 'TEST');
  await page.locator(FULL).waitFor();
  await waitText(FULL, '+2.50%');
  assert.ok(liveCalls > callsBefore, 'the chart screen polls the live feed');
  let c = await look(FULL);
  assert.equal(c.colour, c.up, 'up is green: ' + JSON.stringify(c));
  assert.equal(await page.locator('#chartFull .reel-price').count(), 0, 'no price, the change only');
  livePrice = 99;
  await page.clock.fastForward(31000);   // the 30s clock
  await waitText(FULL, '−1.00%');
  c = await look(FULL);
  assert.equal(c.colour, c.down, 'down is red: ' + JSON.stringify(c));
  assert.ok(c.rightGap <= 1 && c.left > c.lineLeft + c.lineWidth / 2, 'the change sits at the right end in full screen: ' + JSON.stringify(c));
  await page.locator('[data-act="chart-full-close"]').click();

  // Leaving Charts for a tab with no prices stops the polling.
  await page.locator('.nav-tab[data-tab="scanner"]').click();
  const stopped = liveCalls;
  await page.clock.fastForward(31000);
  await page.waitForTimeout(300);
  assert.equal(liveCalls, stopped, 'no polling off the Watchlist and the chart screen');
  assert.deepEqual(errors, []);
  await page.context().close();
};
