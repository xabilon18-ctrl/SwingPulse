// iPad gets the laptop chart workspace at every full-screen size, portrait
// included (user, 2026-11-01: "make the iPad always use the laptop view").
// Slide Over / narrow Split View stay on the phone layout, and a non-iPad
// below 1024px is unchanged.
const {chromium} = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const url = process.env.IPAD_URL || 'http://127.0.0.1:8000';
const output = 'ipad-workspace-results';
fs.mkdirSync(output, {recursive: true});

// iPadOS 13+ Safari sends a Mac user agent; older iPads and some in-app
// browsers still say "iPad". Both must be recognised.
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function open(browser, {ua, touch, width, height}) {
  const context = await browser.newContext({viewport: {width, height}, userAgent: ua, hasTouch: touch > 0});
  await context.addInitScript(n => Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {get: () => n}), touch);
  const page = await context.newPage(), errors = [];
  let cdnBlocked = false;
  page.on('pageerror', e => errors.push(e.message));
  page.on('requestfailed', r => { if (/chart\.js/.test(r.url())) cdnBlocked = true; });
  await page.route('**/ma500/**', async route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/ma500/')[1]);
    const file = path.join(__dirname, '../webapp/publish/browser-data', relative);
    let body = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.from('null');
    if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
    await route.fulfill({contentType: 'application/json', body});
  });
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  await page.locator('.up-skip').waitFor({timeout: 60000});
  await page.locator('.up-skip').click();
  await page.locator('.nav-tab[data-tab="charts"]').click();
  // Chart.js comes from a CDN; a sandbox without it raises this one error,
  // which has nothing to do with the layout under test.
  const pageErrors = () => errors.filter(e => !(cdnBlocked && /Chart is not defined/.test(e)));
  return {context, page, pageErrors};
}
async function ready(page, desktop) {
  const selector = desktop ? '#chartFullHost' : '#chartReel .reel-chart';
  await page.waitForFunction(s => {
    const h = document.querySelector(s);
    return h?._reelCtx && h.querySelector('svg') && h.clientHeight > 100;
  }, selector, {timeout: 60000});
  await page.waitForTimeout(250);
}
async function assertWorkspace(page, label) {
  await ready(page, true);
  const l = await page.evaluate(() => {
    const box = s => { const r = document.querySelector(s).getBoundingClientRect(); return {x: r.x, w: r.width, h: r.height, right: r.right, bottom: r.bottom, y: r.y}; };
    const row = document.querySelector('#chartFull .cf-main-row');
    return {chart: box('#chartFull'), host: box('#chartFullHost'), list: box('#desktopChartWatchlist'),
      foot: box('#chartFull .reel-foot'), head: box('#chartFull .cf-head'),
      parent: document.querySelector('#chartFull').parentElement.id,
      scroll: document.documentElement.scrollWidth, width: innerWidth, height: innerHeight,
      row: {w: row.clientWidth, s: row.scrollWidth}};
  });
  assert.equal(await page.locator('#desktopChartWorkspace').count(), 1, label + ': workspace present');
  assert.equal(l.parent, 'desktopChartStage', label + ': chart in the stage');
  assert.ok(l.chart.right <= l.list.x, label + ': chart left, watchlist right');
  assert.ok(l.chart.w > l.list.w && l.host.h > 200, label + ': chart is the main area');
  assert.ok(l.foot.bottom <= l.height && l.head.y >= 0, label + ': controls fit the screen');
  assert.ok(l.scroll <= l.width + 1, label + ': no horizontal overflow');
  assert.ok(l.row.s <= l.row.w + 1, label + ': toolbar does not overflow');
  return l;
}
async function assertPhone(page, label) {
  await ready(page, false);
  assert.equal(await page.locator('#desktopChartWorkspace').count(), 0, label + ': no workspace');
  assert.ok(await page.locator('#chartReel .reel-card').count() > 0, label + ': phone chart cards');
}

(async () => {
  const browser = await chromium.launch();
  const report = [];
  try {
    // Full-screen iPads, portrait then landscape: mini, iPad/Air 11", Pro 11", Pro 13".
    for (const [ua, name] of [[MAC_UA, 'iPadOS (Mac UA)'], [IPAD_UA, 'iPad UA']]) {
      for (const [width, height] of [[744, 1133], [820, 1180], [834, 1194], [1024, 1366], [1180, 820], [1366, 1024]]) {
        const {context, page, pageErrors} = await open(browser, {ua, touch: 5, width, height});
        const label = `${name} ${width}x${height}`;
        report.push({label, ...(await assertWorkspace(page, label))});
        if (width === 820 && ua === MAC_UA) await page.screenshot({path: output + '/ipad-portrait.png'});
        assert.deepEqual(pageErrors(), [], label + ': page errors');
        await context.close();
      }
    }
    // Rotating / resizing on an iPad: portrait workspace -> Slide Over phone -> back.
    {
      const {context, page, pageErrors} = await open(browser, {ua: MAC_UA, touch: 5, width: 820, height: 1180});
      await assertWorkspace(page, 'iPad before Slide Over');
      await page.setViewportSize({width: 375, height: 1180});
      await assertPhone(page, 'iPad Slide Over 375');
      await page.setViewportSize({width: 678, height: 1024});
      await assertPhone(page, 'iPad half Split View 678');
      await page.setViewportSize({width: 1180, height: 820});
      await assertWorkspace(page, 'iPad back to landscape');
      assert.deepEqual(pageErrors(), [], 'iPad resize: page errors');
      await context.close();
    }
    // Unchanged elsewhere: a Mac (no touch) and a phone below 1024 keep the phone layout.
    for (const [ua, touch, width, height, label] of [[MAC_UA, 0, 820, 1180, 'Mac window 820'], [PHONE_UA, 5, 430, 932, 'iPhone']]) {
      const {context, page, pageErrors} = await open(browser, {ua, touch, width, height});
      await assertPhone(page, label);
      assert.deepEqual(pageErrors(), [], label + ': page errors');
      await context.close();
    }
    {
      const {context, page} = await open(browser, {ua: MAC_UA, touch: 0, width: 1280, height: 800});
      await assertWorkspace(page, 'Mac laptop 1280');
      await context.close();
    }
    fs.writeFileSync(output + '/layout.json', JSON.stringify(report, null, 2));
    console.log('PASS iPad laptop workspace at every full-screen size; Slide Over, Mac windows and phones unchanged');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
