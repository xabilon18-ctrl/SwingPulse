// One dollar index (2026-10-29): USD_IDX, the app's equal-weight basket, is
// left off the board, and USDX (ICE's dollar index) shows in the Currency
// Index group as well as its own. The offline fixture holds one instrument, so this
// copies its row as USD_IDX and USDX (signals.json only) and checks the
// Watchlist, search, a list's count and the Ccy Index class. Run from
// app_smoke.cjs with its browser, on a page of its own.
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
    if (relative === 'signals.json') {
      const s = JSON.parse(body);
      const row = s.data[0];
      s.data.push({ ...row, instrument_name: 'USD_IDX', group: 'Currency Index', sector: 'Currency', asset_class: 'Index' },
                  { ...row, instrument_name: 'USDX', group: 'US Index', sector: 'Index', asset_class: 'Index' });
      body = JSON.stringify(s);
    }
    await route.fulfill({ contentType: 'application/json', body });
  });
  await page.addInitScript(() => {
    localStorage.setItem('sp-watchlists', JSON.stringify({ mod: Date.now(),
      lists: [{ id: 'fx', name: 'FX', items: ['USD_IDX', 'USDX', 'TEST'] }] }));
    localStorage.setItem('swingpulse-wl-ui', JSON.stringify({ list: 'all', mode: 'lists' }));
  });
  await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
  if (await page.locator('.up-skip').isVisible()) await page.locator('.up-skip').click();
  await page.locator('.nav-tab[data-tab="watchlist"]').click();
  const rows = () => page.locator('#wl2Body .wl2-row').evaluateAll(rs => rs.map(r => r.dataset.wlRow));
  await page.locator('#wl2Body .wl2-row').first().waitFor();
  assert.deepEqual((await rows()).sort(), ['TEST', 'USDX', 'USDX'], 'USD_IDX is off the board; USDX shows twice');
  const groups = await page.locator('#wl2Body .wl2-group').allInnerTexts();
  assert.ok(groups.some(g => /currency index/i.test(g)), 'USDX is under Currency Index: ' + groups.join(', '));
  assert.ok(groups.some(g => /us index/i.test(g)), 'USDX keeps its own group: ' + groups.join(', '));
  // A list that holds USD_IDX counts and shows only what is on the board.
  assert.match(await page.locator('#wl2Lists [data-wl-list="fx"]').innerText(), /FX\s*2/);
  // The Ccy Index class shows USDX once; so does a list holding it.
  await page.locator('#wl2DdMode').click();
  await page.locator('#wl2MenuMode [data-wl-mode="cls"]').click();
  await page.locator('#wl2Lists [data-wl-cls="CcyIndex"]').click();
  assert.deepEqual(await rows(), ['USDX']);
  await page.evaluate(() => document.querySelector('#wl2Menus [data-wl-mode="lists"]').click());
  await page.locator('#wl2Lists [data-wl-list="fx"]').click();
  await page.locator('#wl2DdMode').click();
  await page.locator('#wl2MenuMode [data-wl-mode="cls"]').click();
  // Another list switches the filters off (2026-10-30); set it again there.
  assert.equal(await page.locator('#wl2Lists [data-wl-cls="all"]').getAttribute('class'), 'wl2-pill on', 'a new list starts unfiltered');
  await page.locator('#wl2Lists [data-wl-cls="CcyIndex"]').click();
  assert.deepEqual(await rows(), ['USDX'], 'Ccy Index inside a list finds USDX');
  await page.locator('#wl2InList').click();
  // Search cannot find it either.
  await page.locator('#wl2Lists [data-wl-cls="all"]').click();
  await page.locator('#wl2Search').fill('USD_IDX');
  assert.equal(await page.locator('#wl2Body .wl2-row').count(), 0, 'search does not find USD_IDX');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: one dollar index (USD_IDX hidden, USDX under US Index and Currency Index)');
  await page.context().close();
};
