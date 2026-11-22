// Big-fund 13F moves on the Monthly chart (2026-11-22, user: "red and green
// markers that show the information on a pop up when I tap the marker" and "a
// switch for on and off"). The fixture's holdings.json has two funds selling
// TEST in Q3 2026 and one buying in Q2. Run from app_smoke.cjs with its
// browser, on a page of its own.
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
    await route.fulfill({ contentType: 'application/json', body });
  });
  await page.addInitScript(() => {
    localStorage.setItem('swingpulse-chart-tf', 'M');
    localStorage.setItem('swingpulse-tf', 'M');
  });
  await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
  if (await page.locator('.up-skip').isVisible()) await page.locator('.up-skip').click();
  await page.locator('.nav-tab[data-tab="charts"]').click();
  if (await page.locator('#tfBtnM').getAttribute('aria-selected') !== 'true') await page.locator('#tfBtnM').click();
  const chart = page.locator('#chartReel .reel-chart').first();
  await page.locator('#chartReel .reel-chart .fm-mark').first().waitFor({ timeout: 60000 });
  const count = sel => page.locator('#chartReel .reel-chart').first().locator(sel).count();
  assert.equal(await count('.fm-mark.sell'), 1, 'one red marker for the quarter two funds sold');
  assert.equal(await count('.fm-mark.buy'), 1, 'one green marker for the quarter a fund bought');
  assert.equal(await chart.locator('.fm-n.sell').textContent(), '2', 'the red marker says two funds');

  // Tap the red marker: the pop-up names both funds, the quarter is shaded.
  const box = await chart.locator('.fm-mark.sell').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const pop = page.locator('.fm-pop');
  await pop.waitFor();
  const text = await pop.textContent();
  for (const want of ['Q3 2026', 'Jul–Sep 2026', 'Selling (2)', 'Duquesne Family Office', 'Stanley Druckenmiller',
                      'Tiger Global', 'Sold out', 'Cut 62%', 'disclosed by 16 Nov 2026'])
    assert.ok(text.includes(want), `pop-up says "${want}": ${text}`);
  assert.ok(!text.includes('Appaloosa'), 'only that quarter\'s funds');
  assert.equal(await count('.fm-band'), 1, 'the quarter is shaded while its pop-up is open');
  assert.equal(await page.locator('#modal.show, .modal-overlay.show').count(), 0, 'the tap did not open the instrument');

  // The close button, then the switch.
  await pop.locator('[data-act="fm-close"]').click();
  await page.waitForFunction(() => !document.querySelector('.fm-pop'));
  assert.equal(await count('.fm-band'), 0, 'no shading once closed');
  const grid = page.locator('#chartReel [data-act="grid-menu"]').first();
  const flip = async () => {
    await grid.click();
    const sw = page.locator('.reel-grid-menu [data-act="fm-set"]');
    await sw.click();
    const on = await sw.getAttribute('aria-checked');
    await grid.click();
    return on;
  };
  assert.equal(await flip(), 'false', 'the switch turns the markers off');
  await page.waitForFunction(() => !document.querySelector('#chartReel .reel-chart .fm-mark'));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => /sp-overlay/.test(k)))).smart), 0, 'and it is remembered');
  assert.equal(await flip(), 'true', 'and back on');
  await page.locator('#chartReel .reel-chart .fm-mark').first().waitFor();
  assert.deepEqual(errors, [], errors.join('\n'));
  await page.close();
  console.log('PASS: big-fund 13F markers on Monthly (red/green, tap pop-up, quarter shading, close, on/off switch remembered)');
};
