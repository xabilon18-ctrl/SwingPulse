// Full-screen footer arrows hit their own button (user, 2026-11-23: "the
// arrows on both sides get mistaken for the middle button with the menu
// button"). At 390px the timeframe arrows took taps on 19px and the chart
// arrows on 23px, flush against the timeframe pill and the counter. Each
// arrow's tap area now reaches over its menu button's near edge (style.css,
// "Arrows hit their own button"). This reads what a tap lands on along the
// row at 390, 375 and 320px, then taps just inside the Daily pill's right
// edge: the timeframe steps and no menu opens. Run from app_smoke.cjs with
// its browser, on pages of its own.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('node:assert/strict');
const openChart = require('./chart_open.cjs');

module.exports = async browser => {
  const dataDir = path.resolve(__dirname, '../webapp/publish/browser-data');
  // Minimum tap widths (px) for each arrow and what each menu keeps. At 390
  // and 375px the pill and counter have fixed widths, so these are absolute.
  // At 320px every button is as wide as its text, which differs with the
  // fonts installed (the CI runner draws the counter ~4px narrower than a
  // desktop Linux), so there each button is measured against its own drawn
  // width: an arrow takes >= 6px more than it shows, and a menu loses
  // <= 10px (the two 4px reaches, and 2px for rounding).
  const want = { 390: { arrow: 30, menu: 40, gap: 5 }, 375: { arrow: 30, menu: 40, gap: 1 }, 320: { relative: true, gap: 1 } };
  for (const width of [390, 375, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 760 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/ma500/**', async route => {
      const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/ma500/')[1]);
      const file = path.join(dataDir, relative);
      let body = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.from('null');
      if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
      await route.fulfill({ contentType: 'application/json', body });
    });
    await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
    if (await page.locator('.up-skip').isVisible()) await page.locator('.up-skip').click();
    await page.evaluate(() => window.SP.navigateToTab('charts'));
    await openChart(page, 'TEST');
    await page.locator('#chartFull.open .reel-foot .cf-pos').waitFor();

    const row = await page.evaluate(() => {
      const foot = document.querySelector('#chartFull .reel-foot'), fr = foot.getBoundingClientRect(), y = fr.top + fr.height / 2;
      const key = e => { const b = e && e.closest('button'); return b ? b.dataset.act + (b.dataset.dir || '') : 'none'; };
      const spans = {};
      for (let x = Math.ceil(fr.left); x < fr.right; x++) {
        const k = key(document.elementFromPoint(x, y));
        (spans[k] ||= []).push(x);
      }
      const box = sel => { const r = foot.querySelector(sel).getBoundingClientRect(); return [r.left, r.right]; };
      const drawn = Object.fromEntries([...foot.querySelectorAll('button')].map(b => [key(b), Math.round(b.getBoundingClientRect().width)]));
      return { drawn,
        taps: Object.fromEntries(Object.entries(spans).map(([k, xs]) => [k, { w: xs.length, contiguous: xs.at(-1) - xs[0] + 1 === xs.length }])),
        tfRight: box('[data-act="chart-tf-step"][data-dir="1"]'), save: box('.reel-capsule'),
        stepLeft: box('[data-act="chart-full-step"][data-dir="-1"]'),
      };
    });
    const w = want[width], t = row.taps, at = JSON.stringify(t);
    const minArrow = k => w.relative ? row.drawn[k] + 6 : w.arrow;
    const minMenu = k => w.relative ? row.drawn[k] - 10 : w.menu;
    const drawn = JSON.stringify(row.drawn);
    for (const k of ['chart-tf-step-1', 'chart-tf-step1', 'chart-full-step-1', 'chart-full-step1']) {
      assert.ok(t[k] && t[k].contiguous, `${width}px: ${k} has one tap area: ${at}`);
      assert.ok(t[k].w >= minArrow(k), `${width}px: ${k} takes taps on ${t[k].w}px, want >= ${minArrow(k)}: ${at} drawn ${drawn}`);
    }
    for (const k of ['tf-menu', 'chart-auto-menu', 'chart-view-save', 'channel'])
      assert.ok(t[k] && t[k].contiguous && t[k].w >= minMenu(k), `${width}px: ${k} keeps ${t[k] && t[k].w}px, want >= ${minMenu(k)}: ${at} drawn ${drawn}`);
    // The three groups stay apart, so each arrow reads as its menu's.
    assert.ok(row.save[0] - row.tfRight[1] >= w.gap && row.stepLeft[0] - row.save[1] >= w.gap,
      `${width}px: gaps between the groups: ${JSON.stringify(row)}`);

    // A real tap 5px inside the Daily pill's right edge steps the timeframe.
    if (width >= 360) {
      const label = () => page.locator('#chartFull .reel-foot .reel-tf-tag').innerText();
      const before = await label();
      const pill = await page.locator('#chartFull .reel-foot .reel-tf-tag').boundingBox();
      await page.touchscreen.tap(pill.x + pill.width - 5, pill.y + pill.height / 2);
      await page.waitForFunction(b => document.querySelector('#chartFull .reel-foot .reel-tf-tag').innerText !== b, before);
      assert.equal(await page.locator('.reel-tf-menu:visible').count(), 0, `${width}px: the timeframe menu stays shut`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
};
