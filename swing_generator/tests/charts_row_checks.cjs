// Charts: one row, five views (2026-10-30), the Watchlist's row on Charts.
// The dropdown before the row swaps it for a filter's choices; Sort and
// reset sit beside the search. Run from app_smoke.cjs on its page.
const assert = require('node:assert/strict');

module.exports = async page => {
  await page.locator('.nav-tab[data-tab="charts"]').click();
  const row = page.locator('#reelRow');
  const count = async () => parseInt(await page.locator('#reelCount').innerText(), 10);
  await page.locator('#chartReel .reel-card').first().waitFor();
  assert.equal(await page.locator('#reelDrops').count(), 0, 'the old dropdown row is gone');
  assert.ok(await page.locator('.reel-head2 #reelDdSort').isVisible(), 'Sort sits beside the search');
  const all = await count();
  // Class view: the classes in the row; a pick filters and is counted.
  await page.locator('#reelDdMode').click();
  await page.locator('#reelMenuMode [data-reel-mode="cat"]').click();
  assert.equal(await page.locator('#reelDdMode .wl2-mode-lbl').innerText(), 'Class');
  assert.equal(await row.locator('.wl2-pill').first().innerText(), 'All classes');
  await row.locator('[data-rk="cat"][data-rv="ccyindex"]').click();
  assert.equal(await row.locator('.wl2-pill.on').getAttribute('data-rv'), 'ccyindex');
  assert.ok(await count() < all, 'a class narrows the charts');
  assert.equal(await page.locator('#reelDdMode .wl2-mode-n').innerText(), '1', 'the dropdown counts the filters set');
  // The menu names it from another view.
  await page.locator('#reelDdMode').click();
  assert.match(await page.locator('#reelMenuMode [data-reel-mode="cat"]').innerText(), /Ccy Index/);
  await page.locator('#reelMenuMode [data-reel-mode="sector"]').click();
  await row.locator('[data-rk="sector"]:not([data-rv=""])').first().click();
  assert.ok(await row.locator('.wl2-sub[data-rk="industry"]').count() >= 1, 'a picked sector opens its industries');
  assert.equal(await page.locator('#reelDdMode .wl2-mode-n').innerText(), '2');
  // Trend and MA views draw their groups, labelled ("Daily", "4H") without
  // the label running into the first chip (2026-10-30: an old 1px divider
  // rule squeezed it).
  await page.locator('#reelDdMode').click();
  await page.locator('#reelMenuMode [data-reel-mode="trend"]').click();
  const gap = await row.evaluate(r => { const s = r.querySelector('.wl2-sep'), c = s.nextElementSibling;
    return c.getBoundingClientRect().left - s.getBoundingClientRect().left - s.scrollWidth; });
  assert.ok(gap >= 0, 'the Daily label does not overlap the first chip: ' + gap);
  await page.locator('#reelDdMode').click();
  await page.locator('#reelMenuMode [data-reel-mode="ma"]').click();
  assert.ok(await row.locator('[data-cluster-mode]').count() >= 2 && await row.locator('[data-rk="near"]').count() >= 2);
  // Reset clears every view and keeps the view.
  await page.locator('#reelReset').click();
  assert.equal(await page.locator('#reelDdMode .wl2-mode-n').isHidden(), true);
  assert.equal(await count(), all, 'reset brings every chart back');
  assert.equal(await page.locator('#reelDdMode .wl2-mode-lbl').innerText(), 'MA');
  await page.locator('#reelDdMode').click();
  await page.locator('#reelMenuMode [data-reel-mode="scope"]').click();
  console.log('PASS: Charts one row, five views');
};
