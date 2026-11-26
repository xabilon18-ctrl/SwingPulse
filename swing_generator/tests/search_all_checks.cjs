const assert = require('node:assert/strict');
const { fixturePage } = require('./chart_autoplay_checks.cjs');

// Search finds every instrument, whatever list is open (user, 2026-11-26:
// "make the search work in finding all instruments any list i may be").
// The fixture page serves TEST, TEST2 and TEST3; the open list holds TEST
// only, with a Crypto filter set that hides even that.
module.exports = async function checkSearchAll(page0) {
  const page = await fixturePage(page0);
  // The context's storage is shared with the checks after this one: keep it
  // as it was found.
  const saved = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
  await page.evaluate(() => localStorage.setItem('sp-watchlists', JSON.stringify({ mod: Date.now(),
    lists: [{ id: 'a', name: 'Mine', items: ['TEST'] }] })));
  await page.reload({ waitUntil: 'networkidle' });
  if (await page.locator('.up-skip').isVisible()) await page.locator('.up-skip').click();
  await page.locator('.nav-tab[data-tab="watchlist"]').click();
  const rows = () => page.locator('#wl2Body .wl2-row').evaluateAll(rs => [...new Set(rs.map(r => r.dataset.wlRow))].sort());
  await page.locator('#wl2DdMode').click();
  await page.locator('#wl2MenuMode [data-wl-mode="lists"]').click();
  await page.locator('#wl2Lists [data-wl-list="a"]').click();
  assert.deepEqual(await rows(), ['TEST'], 'the list holds TEST');
  await page.locator('#wl2DdMode').click();
  await page.locator('#wl2MenuMode [data-wl-mode="cls"]').click();
  await page.locator('#wl2Lists [data-wl-cls="Crypto"]').click();
  assert.deepEqual(await rows(), [], 'the filter hides it');

  // Watchlist: a name outside the list is found, past the filter too.
  await page.locator('#wl2Search').fill('TEST3');
  assert.deepEqual(await rows(), ['TEST3'], 'search finds an instrument outside the open list');
  assert.equal(await page.locator('#wl2InList').isHidden(), true, 'no "searching Mine only" chip while searching');
  await page.locator('#wl2Search').fill('test');
  assert.deepEqual(await rows(), ['TEST', 'TEST2', 'TEST3'], 'every match, not just the list and filter');
  await page.locator('#wl2Search').fill('zzzz');
  assert.match(await page.locator('#wl2Body .wl2-empty').innerText(), /No instrument matches/);
  // Clearing goes back to the list with its filter.
  await page.locator('#wl2SearchClear').click();
  assert.deepEqual(await rows(), [], 'cleared: back to the list and its filter');
  assert.equal(await page.locator('#wl2Lists .wl2-pill.on').getAttribute('data-wl-cls'), 'Crypto', 'the filter stayed set');

  // Charts: opened from a list, the search still looks through everything.
  await page.locator('#wl2Lists [data-wl-cls="all"]').click();
  await page.locator('#wl2Body .wl2-row').first().click();
  await page.locator('.wl2-sheet [data-wl-act="chart"]').click();
  await page.locator('#chartReel .reel-card').first().waitFor();
  const cards = () => page.locator('#chartReel .reel-card').evaluateAll(cs => cs.map(c => c.dataset.name).sort());
  assert.deepEqual(await cards(), ['TEST'], 'the reel is the list');
  await page.locator('#reelSearch').fill('TEST2');
  await page.waitForFunction(() => [...document.querySelectorAll('#chartReel .reel-card')].map(c => c.dataset.name).join() === 'TEST2', null, { timeout: 5000 });
  await page.locator('#reelSearch').fill('test');
  await page.waitForFunction(() => document.querySelectorAll('#chartReel .reel-card').length === 3, null, { timeout: 5000 });
  assert.deepEqual(await cards(), ['TEST', 'TEST2', 'TEST3'], 'Charts search finds every match, not just the list');
  await page.locator('#reelSearch').fill('');
  await page.waitForFunction(() => document.querySelectorAll('#chartReel .reel-card').length === 1, null, { timeout: 5000 });
  await page.evaluate(s => { localStorage.clear(); for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); }, saved);
  await page.close();
  console.log('PASS: search finds every instrument from any list, on Watchlist and Charts');
};
