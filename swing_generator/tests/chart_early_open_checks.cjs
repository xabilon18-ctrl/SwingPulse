// The chart screen opened before the instruments have loaded (a notification
// or chart link at start-up; the live release check does exactly this) waits
// for them and shows a chart, on a phone and on a laptop, instead of closing
// straight back to the Watchlist (2026-11-27: the release-check preview went
// red on this after the Charts tab was removed). Run from app_smoke.cjs with
// its browser, on pages of its own whose data arrives 2 seconds late.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('node:assert/strict');

module.exports = async browser => {
  const dataDir = path.resolve(__dirname, '../webapp/publish/browser-data');
  for (const [width, height] of [[390, 844], [1366, 768]]) {
    const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/ma500/**', async route => {
      const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/ma500/')[1]);
      const file = path.join(dataDir, relative);
      let body = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.from('null');
      if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
      await new Promise(r => setTimeout(r, 2000));
      await route.fulfill({ contentType: 'application/json', body });
    });
    await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8000', { waitUntil: 'domcontentloaded' });
    await page.locator('.up-skip').waitFor({ timeout: 60000 });
    await page.locator('.up-skip').click();
    assert.equal(await page.locator('#wl2Body .wl2-row').count(), 0, width + ': the data has not arrived yet');
    await page.evaluate(() => window.SP.navigateToTab('charts'));
    await page.waitForFunction(() => document.querySelector('#chartFullHost')?._reelCtx && document.querySelector('#chartFull.open'), null, { timeout: 60000 });
    assert.equal(await page.locator('#pane-charts').evaluate(p => p.classList.contains('active')), true, width + ': still on the chart screen');
    assert.equal(await page.locator('#desktopChartWorkspace').count(), width >= 1024 ? 1 : 0, width + ': the right layout');
    assert.deepEqual(errors, [], width + ': page errors');
    await page.context().close();
  }
  console.log('PASS: the chart screen opened before the data loads waits for it and shows a chart (phone and laptop)');
};
