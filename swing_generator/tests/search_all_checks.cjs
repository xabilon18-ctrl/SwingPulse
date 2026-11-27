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

  // A chart opened from the list steps through that list; the search that
  // finds every instrument is the Watchlist's (the chart screen's own search
  // is the laptop / iPad workspace's, desktop_workspace.cjs).
  await page.locator('#wl2Lists [data-wl-cls="all"]').click();
  await page.locator('#wl2Body .wl2-row').first().click();
  await page.locator('.wl2-sheet [data-wl-act="chart"]').click();
  await page.locator('#chartFull.open').waitFor();
  assert.equal(await page.locator('#chartFull').getAttribute('data-name'), 'TEST');
  assert.equal((await page.locator('#chartFull .cf-pos').innerText()).trim(), '1/1', 'the chart steps through the list');
  await page.locator('#chartFull [data-act="chart-full-close"]').click();
  await page.locator('#wl2Search').fill('test');
  await page.locator('#wl2Body .wl2-row[data-wl-row="TEST2"]').click();
  await page.locator('.wl2-sheet [data-wl-act="chart"]').click();
  await page.locator('#chartFull.open[data-name="TEST2"]').waitFor();
  assert.equal((await page.locator('#chartFull .cf-pos').innerText()).trim(), '2/3', 'opened from a search, it steps through every match');
  await page.locator('#chartFull [data-act="chart-full-close"]').click();
  await page.evaluate(s => { localStorage.clear(); for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); }, saved);
  await page.close();
  console.log('PASS: search finds every instrument from any list; a chart opened from it steps through the matches');
};
