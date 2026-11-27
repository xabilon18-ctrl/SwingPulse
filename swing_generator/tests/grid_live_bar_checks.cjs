// The time grid stays on a chart with a live bar added (user, 2026-11-27:
// "the grids disappear", US30 Daily screenshot with no time lines and no grid
// tag). The Daily MA overlay on 1H caches the Daily bundle's bar times; the
// live next-day bar was then added to a copy that carried that cache one date
// short, and the grid drew nothing until the app restarted. Checks 1H with the
// Daily overlay on, then Daily with today's bar from the live price: grid
// lines and the grid tag on open, after a live poll, and closed and reopened.
// Run from app_smoke.cjs with its browser, on a page of its own.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('node:assert/strict');
const openChart = require('./chart_open.cjs');

module.exports = async browser => {
  const dataDir = path.resolve(__dirname, '../webapp/publish/browser-data');
  const read = rel => {
    const f = path.join(dataDir, rel);
    let b = fs.existsSync(f) ? fs.readFileSync(f) : Buffer.from('null');
    if (b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b);
    return b;
  };
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // TEST's last Daily bar is yesterday's, so a live price today starts today's bar.
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const cid = JSON.parse(read('chart/index.json')).chunks.TEST;
  const close = JSON.parse(read(`chart/D/${cid}.json`)).data.TEST.c.at(-1);
  const live = +(close * 1.02).toFixed(4);
  await page.route('**/ma500/**', async route => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.split('/ma500/')[1]);
    if (rel === 'quotes.json') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ q: { TEST: {
      p: close, pc: close, t: new Date(Date.now() - 600e3).toISOString(), y: 'TEST-Y' } } }) });
    let body = read(rel);
    if (/^chart\/D\/\d+\.json$/.test(rel)) {
      const chunk = JSON.parse(body), b = chunk.data && chunk.data.TEST;
      if (b) b.t[b.t.length - 1] = yesterday;
      body = JSON.stringify(chunk);
    }
    await route.fulfill({ contentType: 'application/json', body });
  });
  await page.route('**/swingpulse-cron.xabilon18.workers.dev/live**', r => r.fulfill({ contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ 'TEST-Y': [live, Math.floor(Date.now() / 1000)] }) }));
  await page.clock.install();
  await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
  if (await page.locator('.up-skip').isVisible()) await page.locator('.up-skip').click();
  const grid = () => page.evaluate(() => {
    const h = document.querySelector('#chartFullHost'), b = h && h._reelCtx && h._reelCtx.b, src = b && (b._src || b);
    return { lines: h ? h.querySelectorAll('line.reel-tgrid').length : 0,
      tag: (document.querySelector('#chartFull [data-cf-grid]') || {}).textContent || '', last: src && src.t[src.t.length - 1] };
  });
  const poll = () => page.clock.fastForward(31000);

  await openChart(page, 'TEST', '1H');
  await page.locator('#chartFull [data-act="tf-menu"]').click();
  const sw = page.locator('.reel-tf-menu [data-act="ov-htf"][data-tf="D"]');
  if (await sw.getAttribute('aria-checked') !== 'true') await sw.click();
  await page.locator('#chartFull [data-act="tf-menu"]').click();
  await page.waitForFunction(() => document.querySelector('#chartFullHost .reel-ov polyline'), null, { timeout: 30000 });
  assert.ok((await grid()).lines > 0, '1H with the Daily overlay has its grid');

  const today = new Date().toISOString().slice(0, 10);
  for (const step of ['Daily', 'after a live poll', 'closed and reopened', 'reopened, after a poll']) {
    if (step === 'Daily') await openChart(page, 'TEST', 'D');
    if (step.includes('poll')) await poll();
    if (step === 'closed and reopened') {
      await page.locator('#chartFull [data-act="chart-full-close"]').click();
      await openChart(page, 'TEST', 'D');
    }
    await page.waitForFunction(t => {
      const b = document.querySelector('#chartFullHost')?._reelCtx?.b, s = b && (b._src || b);
      return s && s.t[s.t.length - 1] === t;
    }, today, { timeout: 15000 });
    const g = await grid();
    assert.ok(g.lines > 0 && /Y/.test(g.tag), `Daily with today's live bar, ${step}: grid lines and tag: ` + JSON.stringify(g));
  }
  await page.locator('#chartFull [data-act="chart-full-close"]').click();
  assert.deepEqual(errors, []);
  await page.context().close();
  console.log('PASS: the time grid stays with a live bar added after the Daily overlay (open, poll, close and reopen)');
};
