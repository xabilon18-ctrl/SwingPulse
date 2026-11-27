// Live last candle on 1H and Daily (user, 2026-11-23: "price feed changes
// must happen on open chart", then "Do the smaller version, 1H and Daily").
// The fixture's bars are old, so each page here serves TEST's Daily bundle
// with its last bar re-dated, its 1H bundle with a forming hour for the
// current hour, a quote, and a live relay whose price the test sets.
// Checks: today's open Daily bar and the forming hour follow the live price
// (close, high, MA end points), on the card and in full screen; a price off
// the candle's level changes nothing; yesterday's closed bar takes no live
// price, and today's bar opens from it when the run has not added it yet;
// a live bar has its dot. Run from app_smoke.cjs with its browser, on pages of its own.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('node:assert/strict');

module.exports = async browser => {
  const errors = [];
  const dataDir = path.resolve(__dirname, '../webapp/publish/browser-data');
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 864e5).toISOString().slice(0, 10);
  const hour = new Date(Math.floor(now.getTime() / 36e5) * 36e5);
  const fmtHour = d => d.toISOString().slice(0, 13).replace('T', ' ') + ':00';
  const read = rel => {
    const file = path.join(dataDir, rel);
    let body = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.from('null');
    if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
    return body;
  };

  // One page on Charts / Daily: TEST's last Daily bar dated `lastDay`.
  async function openPage(lastDay) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    // TEST's last Daily close, known before the page asks for its quote.
    const cid = JSON.parse(read('chart/index.json')).chunks.TEST;
    const db = JSON.parse(read(`chart/D/${cid}.json`)).data.TEST;
    const s = { page, context, dailyClose: db.c[db.c.length - 1], hourClose: null, live: null };
    await page.route('**/ma500/**', async route => {
      const rel = decodeURIComponent(new URL(route.request().url()).pathname.split('/ma500/')[1]);
      if (rel === 'quotes.json')
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ q: { TEST: {
          p: s.dailyClose, pc: s.dailyClose, t: new Date(Date.now() - 600e3).toISOString(), y: 'TEST-Y' } } }) });
      let body = read(rel);
      if (/^chart\/(D|1H)\/\d+\.json$/.test(rel)) {
        const chunk = JSON.parse(body), b = chunk.data && chunk.data.TEST;
        if (b) {
          const n = b.t.length;
          if (rel.startsWith('chart/D/')) {
            b.t[n - 1] = lastDay;
          } else {
            s.hourClose = b.c[n - 1];
            b.forming = { t: fmtHour(hour), closes_at: new Date(hour.getTime() + 36e5).toISOString().replace('.000', ''),
              o: s.hourClose, h: s.hourClose, l: s.hourClose, c: s.hourClose, m: b.m.map(x => x[x.length - 1]) };
          }
        }
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
    await page.locator('.nav-tab[data-tab="charts"]').click();
    if (await page.locator('#tfBtnD').getAttribute('aria-selected') !== 'true') await page.locator('#tfBtnD').click();
    await page.locator('#chartReel .reel-chart svg').first().waitFor({ timeout: 60000 });
    return s;
  }
  const lastBar = (page, sel = '#chartReel .reel-chart') => page.evaluate(sel => {
    const ctx = document.querySelector(sel)?._reelCtx, b = ctx && ctx.b;
    if (!b) return null;
    const n = b.t.length, pub = ctx.bundle && (ctx.bundle._base || ctx.bundle);
    return { t: b.t[n - 1], c: b.c[n - 1], h: b.h[n - 1], p: b.p, m: b.m.map(x => x[x.length - 1]),
      base: pub ? pub.c[pub.c.length - 1] : null };
  }, sel);
  const waitClose = (page, v, sel = '#chartReel .reel-chart') => page.waitForFunction(([v, sel]) => {
    const b = document.querySelector(sel)?._reelCtx?.b;
    return b && Math.abs(b.c[b.c.length - 1] - v) < 1e-9;
  }, [v, sel], { timeout: 10000 });
  const poll = page => page.clock.fastForward(31000);   // the 30s live clock

  // DAILY, today's bar open: it follows the live price.
  let s = await openPage(today);
  const c0 = s.dailyClose, up = +(c0 * 1.03).toFixed(4);
  const before = await lastBar(s.page);
  s.live = up;
  await poll(s.page);
  await waitClose(s.page, up);
  const after = await lastBar(s.page);
  assert.equal(after.t, today, 'the last Daily bar is today');
  assert.equal(after.h, Math.max(before.h, up), 'its high widens to the live price');
  after.p.forEach((per, i) => assert.ok(Math.abs(after.m[i] - (before.m[i] + (up - c0) / per)) < 1e-6,
    `MA${per} end point follows: ${after.m[i]} vs ${before.m[i]}`));
  assert.equal(after.base, c0, 'the published bundle is untouched');
  // A live bar carries the dot on its close (user, 2026-11-27, A + G).
  assert.equal(await s.page.locator('#chartReel .reel-live-mark').count() > 0, true, 'the live bar has its dot');
  // A price off the level (+60%) is not used: back to the published close.
  s.live = +(c0 * 1.6).toFixed(4);
  await poll(s.page);
  await waitClose(s.page, c0);
  assert.equal(await s.page.locator('#chartReel .reel-live-mark').count(), 0, 'a bar not following the price has no dot');
  // The open full-screen chart follows it too.
  s.live = up;
  await poll(s.page);
  await waitClose(s.page, up);
  await s.page.locator('#chartReel [data-act="chart-expand"]').first().click();
  await s.page.locator('#chartFull.open .reel-chart svg').waitFor({ timeout: 60000 });
  const down = +(c0 * 0.98).toFixed(4);
  s.live = down;
  await poll(s.page);
  await waitClose(s.page, down, '#chartFull .reel-chart');
  assert.equal((await lastBar(s.page, '#chartFull .reel-chart')).t, today);
  await s.page.locator('[data-act="chart-full-close"]').click();

  // 1H: the forming hour follows the live price.
  await s.page.locator('#tfBtn1H').click();
  await s.page.waitForFunction(() => {
    const b = document.querySelector('#chartReel .reel-chart')?._reelCtx?.b;
    return b && b.forming && b.t[b.t.length - 1] === b.forming.t;
  }, null, { timeout: 60000 });
  const h1 = +(s.hourClose * 1.01).toFixed(4);
  s.live = h1;
  await poll(s.page);
  await waitClose(s.page, h1);
  const hb = await lastBar(s.page);
  assert.equal(hb.t, fmtHour(hour), 'the forming hour is the last candle');
  assert.equal(hb.h, h1, 'its high widens to the live price');
  // ...with the dot, and no time-left box under the price tag (removed 2026-11-27).
  assert.equal(await s.page.locator('#chartReel .reel-live-mark').count() > 0, true, 'the forming hour has its dot');
  assert.equal(await s.page.locator('#chartReel .reel-live-left, #chartReel [data-live-left]').count(), 0, 'no countdown under the price tag');
  await s.context.close();

  // DAILY, the last bar is yesterday's (closed) and the run has not added
  // today's yet: yesterday keeps its close, and today's bar opens at it and
  // follows the live price (2026-11-27, the gap after the UTC day turns).
  s = await openPage(yesterday);
  const nextUp = +(s.dailyClose * 1.03).toFixed(4);
  s.live = nextUp;
  await poll(s.page);
  await waitClose(s.page, nextUp);
  const opened = await lastBar(s.page);
  assert.equal(opened.t, today, 'today\'s bar is started from the live price');
  assert.equal(opened.base, s.dailyClose, 'the published bundle is untouched');
  const prior = await s.page.evaluate(() => { const b = document.querySelector('#chartReel .reel-chart')._reelCtx.b, n = b.t.length;
    return { t: b.t[n - 2], c: b.c[n - 2], o: b.o[n - 1] }; });
  assert.deepEqual(prior, { t: yesterday, c: s.dailyClose, o: s.dailyClose }, 'a closed Daily bar keeps its close; the new one opens at it');
  await s.context.close();
  assert.deepEqual(errors, []);
};
