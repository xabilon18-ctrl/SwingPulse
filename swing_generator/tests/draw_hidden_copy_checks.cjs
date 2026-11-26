const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// A drawing not shown on this chart is never the one Delete acts on (user,
// 2026-11-26: "my Bitcoin percentage lines ... have disappeared. I didn't
// delete them", drawn on Monthly). A Monthly ladder keeps a hidden copy in
// the Yearly list; after deleting a ladder placed on Yearly, a second tap on
// Delete used to remove that unseen copy and, through the link, the Monthly
// ladder on Monthly, Daily and 1H. Fresh context with that ladder saved.
module.exports = async function checkDrawHiddenCopy(page) {
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 } });
  const p = await context.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  const dataDir = path.resolve(__dirname, '../webapp/publish/browser-data');
  await p.route('**/ma500/**', async route => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.split('/ma500/')[1]);
    let body = fs.existsSync(path.join(dataDir, rel)) ? fs.readFileSync(path.join(dataDir, rel)) : Buffer.from('null');
    if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
    await route.fulfill({ contentType: 'application/json', body });
  });
  const mon = { kind: 'ladder', p1: 90, p4: 105, link: 'Lmon', home: 'M', tfs: ['1H', 'D', 'M'], strokeWeight: 2 };
  await p.addInitScript(s => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('sp-channels', JSON.stringify(s));
  }, { TEST: { M: [mon], D: [{ ...mon }], '1H': [{ ...mon }], Y: [{ ...mon }] } });
  await p.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
  if (await p.locator('.up-skip').isVisible().catch(() => false)) await p.locator('.up-skip').click();
  await p.locator('.nav-tab[data-tab="charts"]').click();
  await p.locator('#reelSearch').fill('TEST');
  await p.evaluate(() => document.getElementById('tfBtnY').click());
  const card = p.locator('.reel-card[data-name="TEST"]');
  await card.locator('.reel-chart svg').waitFor();
  await card.locator('[data-act="chart-expand"]').click();
  await p.locator('#chartFull .reel-chart svg').waitFor();
  await p.locator('#chartFull [data-act="channel"]').click();
  const tb = p.locator('#chartFull .reel-toolbar');
  await tb.locator('[data-kind="ladder"]').click();
  const monthly = () => p.evaluate(() => {
    const a = JSON.parse(localStorage.getItem('sp-channels') || '{}').TEST || {};
    return ['M', 'D', '1H', 'Y'].map(tf => (a[tf] || []).filter(d => d && d.link === 'Lmon').length);
  });
  const del = tb.locator('[data-act="draw-delete"]');
  if (!(await del.isVisible())) await tb.locator('.reel-draw-fold').click();
  await del.click();       // the ladder just placed on Yearly
  for (let k = 0; k < 2; k++) if (await del.isVisible() && await del.isEnabled()) await del.click();
  assert.deepEqual(await monthly(), [1, 1, 1, 1], 'Delete on Yearly never removes the Monthly ladder it does not show');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS: Delete acts only on drawings shown on the chart (a hidden linked copy is safe)');
};
