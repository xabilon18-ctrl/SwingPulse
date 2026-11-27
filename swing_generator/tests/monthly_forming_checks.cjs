// Monthly shows the month in progress (user, 2026-11-26: "Yes monthly can
// also show progress"). The hourly run writes chart/M/forming.json
// (chart_feed.forming_feed); the app puts it on TEST's Monthly chart as a
// forming candle that follows the live price, and, while the Monthly chunk
// has not got last month yet (the 1st until publish_htf runs), last month as
// a closed bar. Each page here serves TEST's Monthly chunk without its last
// month and a forming feed the test sets. Run from app_smoke.cjs with its
// browser, on a page of its own.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('node:assert/strict');
const openChart = require('./chart_open.cjs');

module.exports = async browser => {
  const errors = [];
  const dataDir = path.resolve(__dirname, '../webapp/publish/browser-data');
  const read = rel => {
    const file = path.join(dataDir, rel);
    let body = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.from('null');
    if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
    return body;
  };
  const cid = JSON.parse(read('chart/M/index.json')).chunks.TEST;
  const mb = JSON.parse(read(`chart/M/${cid}.json`)).data.TEST;
  const n = mb.t.length;
  const lastT = mb.t[n - 1];                      // the newest closed month the chunk holds
  const [y, m] = lastT.split('-').map(Number);
  const next = (yy, mm) => (mm === 12 ? [yy + 1, 1] : [yy, mm + 1]);
  const ym = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}-01`;
  const formT = ym(...next(y, m));               // the month after it: in progress
  const closesAt = ym(...next(...next(y, m))) + 'T00:00:00Z';
  const c0 = mb.c[n - 1];
  const prev = { t: lastT, o: mb.o[n - 1], h: mb.h[n - 1], l: mb.l[n - 1], c: c0, v: (mb.v || [])[n - 1] || 0 };
  const forming = { t: formT, closes_at: closesAt, o: c0, h: c0 * 1.04, l: c0 * 0.97, c: c0 * 1.01,
    asof: new Date(Date.now() - 864e5).toISOString().slice(0, 10), live: true };

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const s = { live: null };
  await page.route('**/ma500/**', async route => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.split('/ma500/')[1]);
    if (rel === 'quotes.json')
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ q: { TEST: {
        p: forming.c, pc: forming.c, t: new Date(Date.now() - 600e3).toISOString(), y: 'TEST-Y' } } }) });
    if (rel === 'chart/M/forming.json')
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tf: 'M', data: { TEST: { ...forming, prev } } }) });
    let body = read(rel);
    if (rel === `chart/M/${cid}.json`) {
      // The chunk as it stands from the 1st until publish_htf runs: last month missing.
      const chunk = JSON.parse(body), b = chunk.data.TEST;
      for (const k of ['t', 'o', 'h', 'l', 'c', 'v']) if (Array.isArray(b[k])) b[k].pop();
      if (b.mi[b.mi.length - 1] === n - 1) { b.mi.pop(); b.m.forEach(x => x.pop()); }
      body = JSON.stringify(chunk);
    }
    await route.fulfill({ contentType: 'application/json', body });
  });
  await page.route('**/swingpulse-cron.xabilon18.workers.dev/live**', route => route.fulfill({
    contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(s.live == null ? {} : { 'TEST-Y': [s.live, Math.floor(Date.now() / 1000)] }) }));
  await page.clock.install();
  await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
  if (await page.locator('.up-skip').isVisible()) await page.locator('.up-skip').click();
  await page.evaluate(() => window.SP.navigateToTab('charts'));
  await page.locator('#tfBtnM').dispatchEvent('click');
  await page.waitForFunction(() => document.querySelector('#tfBtnM').getAttribute('aria-selected') === 'true');
  await page.locator('#chartFull .reel-chart svg').first().waitFor({ timeout: 60000 });

  const tail = () => page.evaluate(() => {
    const ctx = document.querySelector('#chartFull .reel-chart')?._reelCtx, b = ctx && ctx.bundle;
    if (!b) return null;
    const k = b.t.length;
    return { t: b.t.slice(-2), c: b.c.slice(-2), h: b.h[k - 1], l: b.l[k - 1], o: b.o[k - 1],
      m: b.m.map(x => x[x.length - 1]), p: b.p };
  });
  const t0 = await tail();
  assert.deepEqual(t0.t, [lastT, formT], 'last month back as a closed bar, then the month in progress');
  assert.equal(t0.c[0], c0, "last month's close");
  assert.ok(Math.abs(t0.c[1] - forming.c) < 1e-9, 'the forming close');
  assert.deepEqual([t0.o, t0.h, t0.l].map(v => +v.toFixed(6)), [forming.o, forming.h, forming.l].map(v => +v.toFixed(6)));

  // The live price moves it: close, high and the MA end points.
  const up = +(forming.h * 1.01).toFixed(4);
  s.live = up;
  await page.clock.fastForward(31000);
  await page.waitForFunction(v => {
    const b = document.querySelector('#chartFull .reel-chart')?._reelCtx?.bundle;
    return b && Math.abs(b.c[b.c.length - 1] - v) < 1e-9;
  }, up, { timeout: 10000 });
  const t1 = await tail();
  assert.equal(t1.h, up, 'its high widens to the live price');
  t1.p.forEach((per, i) => assert.ok(t1.m[i] > t0.m[i], `MA${per} end point follows the live price up`));

  // Full screen reads the last bar as the month in progress.
  await openChart(page, 'TEST');
  await page.locator('#chartFull.open .reel-chart svg').waitFor({ timeout: 60000 });
  await page.locator('#chartFull .cf-info summary').click();
  await page.waitForFunction(() => /forming/i.test(document.querySelector('#chartFull .cf-info')?.innerText || ''), null, { timeout: 10000 });
  assert.match(await page.locator('#chartFull .cf-info').innerText(), /Still forming/i);

  await context.close();
  assert.deepEqual(errors, []);
  console.log('PASS: Monthly shows the month in progress (feed, last month filled in, live price)');
};
