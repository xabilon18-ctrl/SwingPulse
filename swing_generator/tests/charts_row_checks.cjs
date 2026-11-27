// Charts follow the Watchlist (2026-11-04, user: "the chart tab can solely
// focus on the chart" and "works hand in hand with the watch list"). The
// Charts tab lost its own filter row and Sort: they live on the Watchlist,
// and the reel shows the Watchlist's view. Its header is the search and the
// set in view with a count and "Show all". Run from app_smoke.cjs on its page,
// after the Watchlist checks (lists "Mine" = TEST, "Other" = empty).
const assert = require('node:assert/strict');

module.exports = async page => {
  const tab = t => page.locator(`.nav-tab[data-tab="${t}"]`).click();
  const mode = async m => { await page.locator('#wl2DdMode').click(); await page.locator(`#wl2MenuMode [data-wl-mode="${m}"]`).click(); };
  const wlRow = page.locator('#wl2Lists');
  const full = page.locator('#chartFull');
  // Open the first row's chart from the Watchlist, the way a reader does.
  const openFromRow = async () => {
    await page.locator('#wl2Body .wl2-row').first().click();
    await page.locator('.wl2-sheet [data-wl-act="chart"]').click();
    await page.locator('#chartFull.open .reel-chart svg').waitFor({ timeout: 60000 });
  };
  const closeChart = async () => {
    await full.locator('[data-act="chart-full-close"]').click();
    await page.waitForFunction(() => document.querySelector('#pane-watchlist').classList.contains('active'));
  };

  // No Charts tab and no small charts (user, 2026-11-27: "get rid of the
  // chart tab but not the charts").
  await tab('watchlist');
  assert.equal(await page.locator('.nav-tab[data-tab="charts"]').count(), 0, 'no Charts tab');
  for (const id of ['#reelDdMode', '#reelRow', '#reelDdSort', '#reelReset', '#reelMenus', '#reelNav'])
    assert.equal(await page.locator(id).count(), 0, id + ' is gone');

  // The filters that were only on Charts are on the Watchlist now, counted.
  assert.match(await wlRow.locator('[data-wl-list="all"]').innerText(), /All markets\s*1/, 'All markets is counted');
  await mode('scope');
  assert.equal(await page.locator('#wl2DdMode .wl2-mode-lbl').innerText(), 'Signals');
  assert.ok(await wlRow.locator('[data-wl-scope="views"]').count() === 1 && await wlRow.locator('[data-wl-scope="dxafter"]').count() === 1);
  assert.match(await wlRow.locator('[data-wl-scope="all"]').innerText(), /Everything\s*1/);
  await mode('cluster');
  assert.equal(await page.locator('#wl2DdMode .wl2-mode-lbl').innerText(), 'MA');
  assert.ok(await wlRow.locator('[data-cluster-mode]').count() >= 2, 'clusters stay in MA');
  assert.ok(await wlRow.locator('[data-wl-stack]').count() >= 2 && await wlRow.locator('[data-wl-near]').count() >= 2, 'MA order and Near MA came over');
  await page.locator('#wl2DdSort').click();
  assert.ok(await page.locator('#wl2SortOpts [data-wl-sort="signal"]').count() === 1 && await page.locator('#wl2SortOpts [data-wl-sort="recent"]').count() === 1,
    'the Charts sorts came over');
  await page.locator('#wl2DdSort').click();

  // A chart opened from a filtered Watchlist: full screen, stepping through
  // what the Watchlist shows; closing lands back on it, filters kept.
  await mode('cls');
  await wlRow.locator('[data-wl-cls="Equity"]').click();
  await wlRow.locator('[data-wl-grp="tech"]').click();
  assert.match(await page.locator('#wl2AsOf').innerText(), /^1 instrument/, 'the list says how many it shows');
  await openFromRow();
  assert.equal(await full.getAttribute('data-name'), 'TEST');
  assert.equal((await full.locator('.cf-pos').innerText()).trim(), '1/1', 'the chart steps through the Watchlist view');
  assert.equal(await page.locator('#chartReel .reel-card').count(), 0, 'no small charts behind it');
  await closeChart();
  assert.equal(await page.locator('.nav-tab.active').getAttribute('data-tab'), 'watchlist', 'closing lands on the Watchlist');
  assert.equal(await full.evaluate(e => e.classList.contains('open')), false, 'and the chart is closed');
  assert.deepEqual(await wlRow.locator('.wl2-pill.on').allInnerTexts(), ['Stocks 1', 'Tech 1'], 'the Watchlist kept its filters');
  await wlRow.locator('[data-wl-cls="all"]').click();

  // A list: opening a chart from it, then closing, lands on that list.
  await mode('lists');
  await wlRow.locator('[data-wl-list="a"]').click();
  await openFromRow();
  assert.equal((await full.locator('.cf-pos').innerText()).trim(), '1/1', 'the chart steps through the list');
  await closeChart();
  assert.equal(await wlRow.locator('.wl2-pill.on').getAttribute('data-wl-list'), 'a', 'back on the same list');

  // Leave the Watchlist as the next checks expect it: All markets, no filter.
  await wlRow.locator('[data-wl-list="all"]').click();
  console.log('PASS: no Charts tab; a chart opens full screen from the Watchlist and closes back to the same list and filters');
};
