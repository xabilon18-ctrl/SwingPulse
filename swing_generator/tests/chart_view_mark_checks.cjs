const assert = require('node:assert/strict');
const { fixturePage } = require('./chart_autoplay_checks.cjs');

// Buy / Sell markers (user, 2026-11-25: "Make the thick of buy and sell line
// thicker and remove any text on it"): a marker placed from the full-screen
// chart's ▲ / ▼ draws its line at the new Thin width (5 units, was 1.3), with
// an anchor dot and no BUY / SELL word.
module.exports = async function checkViewMarks(page0) {
  const page = await fixturePage(page0);
  await page.locator('.nav-tab[data-tab="charts"]').click();
  await page.locator('#reelSearch').fill('');
  await page.locator('#chartReel .reel-card').first().locator('[data-act="chart-expand"]').click();
  await page.locator('#chartFull .reel-chart svg.reel-svg').waitFor();
  for (const side of ['buy', 'sell']) {
    await page.locator(`#chartFull [data-act="view-mark"][data-side="${side}"]`).first().click();
    const g = page.locator(`#chartFull .reel-chart .reel-draw[data-stroke-kind="${side}"]`).last();
    await g.waitFor();
    const got = await g.evaluate(e => ({
      texts: [...e.querySelectorAll('text')].map(t => t.textContent),
      width: parseFloat(getComputedStyle(e.querySelector('.reel-entry')).strokeWidth),
      r: parseFloat(e.querySelector('.reel-view-tri').getAttribute('r')),
    }));
    assert.deepEqual(got.texts, [], `no text on the ${side} line: ` + JSON.stringify(got));
    assert.equal(got.width, 5, `${side} line Thin is 5 units: ` + JSON.stringify(got));
    assert.ok(got.r >= 5, `${side} anchor dot drawn: ` + JSON.stringify(got));
  }
  await page.close();
  console.log('PASS: Buy / Sell markers draw thicker with no text');
};
