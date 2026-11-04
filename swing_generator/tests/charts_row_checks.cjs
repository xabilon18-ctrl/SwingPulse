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
  const bar = page.locator('#reelSimBar');

  // Nothing of the old Charts row is left; the card header is two lines.
  await tab('charts');
  await page.locator('#chartReel .reel-card .reel-head').first().waitFor();
  for (const id of ['#reelDdMode', '#reelRow', '#reelDdSort', '#reelReset', '#reelMenus'])
    assert.equal(await page.locator(id).count(), 0, id + ' is gone from Charts');
  const head = page.locator('#chartReel .reel-card .reel-head').first();
  assert.equal(await head.locator('.reel-name').innerText(), 'TEST');
  assert.ok(await head.locator('.reel-fullname').isVisible(), 'the full name stays');
  assert.match(await head.locator('.reel-trend-mini').innerText(), /^Main\s/, 'the main trend stays');
  for (const gone of ['.reel-group', '.reel-sig', '.sp-cluster-badge', '.reel-near', '.reel-simpct'])
    assert.equal(await head.locator(gone).count(), 0, gone + ' is off the card header');
  assert.equal(await page.locator('#chartReel .reel-card [data-freshness-name]').count(), 0, 'no bar-time line on the card');
  const hh = await head.evaluate(h => h.getBoundingClientRect().height);
  assert.ok(hh <= 60, 'the card header is two short lines: ' + hh + 'px');

  // The filters that were only on Charts are on the Watchlist now, counted.
  await tab('watchlist');
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

  // Charts take the Watchlist's view from the tab bar, named and counted.
  await mode('cls');
  await wlRow.locator('[data-wl-cls="Equity"]').click();
  await wlRow.locator('[data-wl-grp="tech"]').click();
  assert.match(await page.locator('#wl2AsOf').innerText(), /^1 instrument/, 'the list says how many it shows');
  await tab('charts');
  await page.locator('#chartReel .reel-card').first().waitFor();
  assert.equal(await bar.isHidden(), false, 'the set bar shows the Watchlist view');
  assert.match(await bar.innerText(), /Stocks · Tech\s*1/);
  assert.equal(await page.locator('#reelSimClear').isVisible(), true, 'Show all is offered');
  // Show all: every instrument, until the Watchlist changes.
  await page.locator('#reelSimClear').click();
  assert.equal(await bar.isHidden(), true);
  await tab('watchlist');
  assert.deepEqual(await wlRow.locator('.wl2-pill.on').allInnerTexts(), ['Stocks 1', 'Tech 1'], 'the Watchlist kept its filters');
  await tab('charts');
  assert.equal(await bar.isHidden(), true, 'Show all holds while the Watchlist is unchanged');
  await tab('watchlist');
  await wlRow.locator('[data-wl-cls="all"]').click();
  await tab('charts');
  assert.match(await bar.innerText(), /All markets\s*1/, 'a changed Watchlist is followed again');
  assert.equal(await page.locator('#reelSimClear').isHidden(), true, 'nothing to show all of: already everything');

  // A list: opening a chart from it, then going back, lands on that list.
  await tab('watchlist');
  await mode('lists');
  await wlRow.locator('[data-wl-list="a"]').click();
  await page.locator('#wl2Body .wl2-row').first().click();
  await page.locator('.wl2-sheet [data-wl-act="chart"]').click();
  await page.locator('#chartReel .reel-card').first().waitFor();
  assert.match(await bar.innerText(), /Mine\s*1/);
  // The search finds inside the set.
  await page.locator('#reelSearch').fill('TEST');
  await page.waitForFunction(() => document.getElementById('reelCount').textContent === '1 chart');
  await page.locator('#reelSearch').fill('');
  await page.waitForTimeout(300);
  await tab('watchlist');
  assert.equal(await wlRow.locator('.wl2-pill.on').getAttribute('data-wl-list'), 'a', 'back on the same list');
  await tab('charts');
  assert.match(await bar.innerText(), /Mine\s*1/, 'the tab bar keeps the set the chart was opened in');

  // Leave the Watchlist as the next checks expect it: All markets, no filter.
  await tab('watchlist');
  await wlRow.locator('[data-wl-list="all"]').click();
  await tab('charts');
  console.log('PASS: Charts follow the Watchlist; filters moved to the Watchlist with counts');
};
