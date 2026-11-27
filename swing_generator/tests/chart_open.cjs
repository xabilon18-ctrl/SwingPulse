// Open `name` on the chart screen (full screen on a phone; the laptop / iPad
// workspace at those widths) at timeframe `tf` (the one in use when not
// given), the way the Watchlist's "Open chart in app" does, and wait for it
// to be drawn. The Charts tab and its small cards were removed on 2026-11-27
// (user: "get rid of the chart tab but not the charts"), so every chart check
// starts here instead of on a card.
// No name: the chart screen as it opens on its own (the chart last looked at,
// else the first of the list).
module.exports = async function openChart(page, name = 'TEST', tf = null) {
  await page.evaluate(n => n ? window.SP.openChartFor(n) : window.SP.navigateToTab('charts'), name);
  if (tf) {
    const on = await page.locator('#tfBtn' + tf).getAttribute('aria-selected');
    if (on !== 'true') await page.locator('#tfBtn' + tf).dispatchEvent('click');
    await page.waitForFunction(id => document.querySelector(id).getAttribute('aria-selected') === 'true', '#tfBtn' + tf);
  }
  await page.waitForFunction(n => {
    const el = document.getElementById('chartFull');
    const h = el && el.classList.contains('open') && (!n || el.dataset.name === n) && el.querySelector('.reel-chart');
    // Drawn, or told it has no data (a fixture copy without a chart).
    return !!(h && (h._reelCtx && h._reelCtx.name === el.dataset.name && h.querySelector('svg') || h.querySelector('.reel-nodata')));
  }, name, { timeout: 60000 });
};
