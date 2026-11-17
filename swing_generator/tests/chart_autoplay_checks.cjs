const assert = require('node:assert/strict');

// Chart auto-play (user, 2026-11-17): the ‹ n/N › counter in full screen opens
// a menu with Play / Pause / Continue and four speeds. Playing steps through
// the selected list; a touch on the chart pauses it and closes the menu, and
// the menu then offers Continue. Leaving full screen ends it.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// The local fixture holds one instrument, so locally the check opens its own
// page whose signals list carries two copies of TEST (TEST2, TEST3): enough
// charts to play through. Their charts have no data; stepping does not care.
async function fixturePage(page) {
  const p = await page.context().newPage();
  const dataDir = path.resolve(__dirname, '../webapp/publish/browser-data');
  await p.route('**/ma500/**', async route => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.split('/ma500/')[1]);
    const file = path.join(dataDir, rel);
    let body = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.from('null');
    if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
    if (rel === 'signals.json') {
      const sig = JSON.parse(body);
      const one = sig.data[0];
      sig.data.push({ ...one, instrument_name: 'TEST2' }, { ...one, instrument_name: 'TEST3' });
      body = JSON.stringify(sig);
    }
    await route.fulfill({ contentType: 'application/json', body });
  });
  await p.setViewportSize(page.viewportSize() || { width: 390, height: 844 });
  await p.goto(page.url(), { waitUntil: 'networkidle' });
  if (await p.locator('.up-skip').isVisible().catch(() => false)) await p.locator('.up-skip').click();
  return p;
}

module.exports = async function checkChartAutoplay(page0, live = false) {
  const page = live ? page0 : await fixturePage(page0);
  // The smoke page runs on an installed clock; this one may not.
  const wait = ms => page.waitForTimeout(ms);
  await page.locator('.nav-tab[data-tab="charts"]').click();
  await page.locator('#reelSearch').fill('');
  const card = page.locator('#chartReel .reel-card').first();
  await card.locator('[data-act="chart-expand"]').click();
  await page.locator('#chartFull .reel-chart').waitFor();
  const full = page.locator('#chartFull');
  const counter = full.locator('.cf-pos');
  const at = async () => (await counter.innerText()).trim();
  const start = await at();
  const [i0, n] = start.split('/').map(Number);
  assert.ok(n >= 3, 'the fixture list has charts to play: ' + start);

  await counter.click();
  const menu = full.locator('.cf-auto-menu');
  await menu.waitFor();
  assert.equal(await menu.locator('[data-act="chart-auto-speed"]').count(), 4, 'four speeds');
  assert.match(await menu.locator('[data-act="chart-auto-play"]').innerText(), /Play/);
  await menu.locator('[data-act="chart-auto-speed"][data-ms="3000"]').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('sp-chart-auto-ms')), '3000', 'the speed is remembered');
  await menu.locator('[data-act="chart-auto-play"]').click();
  assert.ok(await counter.evaluate(e => e.classList.contains('is-playing')), 'the counter shows it is playing');
  assert.match(await full.locator('.cf-auto-menu [data-act="chart-auto-play"]').innerText(), /Pause/);
  await page.waitForFunction(s => document.querySelector('#chartFull .cf-pos')?.textContent.trim() !== s, start, { timeout: 6000 });
  assert.equal(await at(), `${(i0 % n) + 1}/${n}`, 'it moved on one chart by itself');
  assert.ok(await full.locator('.cf-auto-menu').isVisible(), 'the menu stays open while it plays');

  // A touch on the chart pauses it and closes the menu.
  const box = await full.locator('.reel-chart').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  assert.equal(await full.locator('.cf-auto-menu').count(), 0, 'tapping the chart closes the menu');
  assert.ok(await counter.evaluate(e => e.classList.contains('is-paused')), 'the counter shows it is paused');
  const held = await at();
  await wait(3600);
  assert.equal(await at(), held, 'paused: it stays on this chart');

  // The menu now offers Continue.
  await counter.click();
  await full.locator('.cf-auto-menu').waitFor();
  assert.match(await full.locator('.cf-auto-menu [data-act="chart-auto-play"]').innerText(), /Continue/);
  // Step back (‹ wraps) to the chart before the last, so the run's end comes
  // after one step on any list size (851 charts on the live site).
  const cur = +(await at()).split('/')[0];
  for (let k = (cur - (n - 1) + n) % n; k > 0; k--) await full.locator('[data-act="chart-full-step"][data-dir="-1"]').click();
  assert.equal(await at(), `${n - 1}/${n}`, 'stepped to the chart before the last');
  if (!(await full.locator('.cf-auto-menu').count())) await counter.click();
  await full.locator('.cf-auto-menu [data-act="chart-auto-play"]').click();
  // Played to the LAST chart of the list, it stops there by itself.
  await page.waitForFunction(m => document.querySelector('#chartFull .cf-pos')?.textContent.trim() === m, `${n}/${n}`, { timeout: 8000 });
  await page.waitForFunction(() => !document.querySelector('#chartFull .cf-pos.is-playing'), null, { timeout: 2000 });
  assert.match(await full.locator('.cf-auto-menu [data-act="chart-auto-play"]').innerText(), /Play/, 'ended on the last chart');
  // Play on the last chart starts again from 1; Stop ends it.
  await full.locator('.cf-auto-menu [data-act="chart-auto-play"]').click();
  assert.equal(await at(), `1/${n}`, 'Play on the last chart starts from 1');
  await page.screenshot({ path: 'chart-autoplay-mobile.png', fullPage: false });
  await full.locator('.cf-auto-menu [data-act="chart-auto-stop"]').click();
  assert.ok(!(await counter.evaluate(e => e.classList.contains('is-playing') || e.classList.contains('is-paused'))), 'stopped');
  const stopped = await at();
  await wait(3600);
  assert.equal(await at(), stopped, 'stopped: it stays on this chart');

  // Leaving full screen ends it.
  await counter.click();
  await full.locator('.cf-auto-menu [data-act="chart-auto-play"]').click();
  await full.locator('[data-act="chart-full-close"]').click();
  const before = await page.locator('#chartFull.open').count();
  await wait(3600);
  assert.equal(await page.locator('#chartFull.open').count(), before, 'closing full screen ends auto-play');
  assert.equal(before, 0);
  if (!live) await page.close();
  console.log('PASS: chart auto-play from the counter (play, speeds, tap to pause, continue, stop, ends on close)');
};
