const { fixturePage } = require('./chart_autoplay_checks.cjs');

// The live release runs these checks one after another on ONE page; locally
// each opens its own. So state one leaves behind (a chart still open full
// screen) only showed up on the deployed site: on 2026-11-20 the 1H
// drop-down check (2H/4H, since removed) could not reach the Charts tab under
// the full-screen chart the magnifier check had left open, and the release
// stopped at the preview.
// This runs them in the live order on one local page (3 instruments), so the
// PR checks see what the release will.
module.exports = async function checkLiveOrder(page0) {
  const page = await fixturePage(page0);
  for (const f of ['chart_autoplay_checks', 'chart_loupe_checks']) await require('./' + f + '.cjs')(page, true);
  // The next live check expects the reel, not full screen.
  if (await page.locator('#chartFull.open').count()) throw new Error('a live check left full screen open');
  await page.close();
  console.log('PASS: the live-order checks run on one page as on the deployed site');
};
