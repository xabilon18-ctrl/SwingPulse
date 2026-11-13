const assert = require('node:assert/strict');

// ‹ › around the full-screen timeframe pill (user, 2026-11-13: "an option to
// screen through times by clicking right or left like the instrument"): they
// step through the chart timeframes in the switch's order and wrap, the
// chart stays open on the same instrument, and the footer still fits on one
// row at phone widths.
module.exports = async function checkChartTfStep(page, name = 'TEST') {
  await page.locator('.nav-tab[data-tab="charts"]').click();
  await page.locator('#reelSearch').fill(name);
  await page.evaluate(() => document.getElementById('tfBtnD').click());
  const card = page.locator('.reel-card[data-name="' + name + '"]');
  await card.locator('.reel-chart svg').waitFor();
  await card.locator('[data-act="chart-expand"]').click();
  await page.locator('#chartFull .reel-chart svg').waitFor();
  const order = await page.evaluate(() => (window.SP_TIMEFRAMES || []).map(t => t.code));
  assert.ok(order.length > 1, 'chart timeframes: ' + JSON.stringify(order));
  const label = () => page.locator('#chartFull .cf-title .reel-group').first().textContent();
  const labels = await page.evaluate(() => Object.fromEntries((window.SP_TIMEFRAMES || []).map(t => [t.code, t.label])));
  const step = async dir => {
    await page.locator(`#chartFull [data-act="chart-tf-step"][data-dir="${dir}"]`).click();
    await page.locator('#chartFull .reel-chart svg').waitFor();
  };
  let at = order.indexOf('D');
  for (let k = 0; k < order.length; k++) {
    await step(1);
    at = (at + 1) % order.length;
    assert.equal((await label()).trim(), labels[order[at]], 'next goes to ' + order[at]);
    assert.equal(await page.locator('#chartFull').getAttribute('data-name'), name, 'same instrument, still full screen');
  }
  assert.equal(order[at], 'D', 'stepping right wraps back round to Daily');
  await step(-1);
  assert.equal((await label()).trim(), labels[order[(order.indexOf('D') - 1 + order.length) % order.length]], 'previous steps back, wrapping');
  // One footer row at phone widths, on the widest pill (1H with its overlays).
  for (const w of [390, 375]) {
    await page.setViewportSize({ width: w, height: 844 });
    await page.waitForTimeout(200);
    const fit = await page.evaluate(() => { const f = document.querySelector('#chartFull .reel-foot'); const r = f.getBoundingClientRect();
      const kids = [...f.children].filter(c => c.offsetParent).map(c => c.getBoundingClientRect());
      return { over: f.scrollWidth - f.clientWidth, rows: new Set(kids.map(k => Math.round(k.top / 10))).size, right: Math.max(...kids.map(k => k.right)), edge: r.right }; });
    assert.ok(fit.over <= 1 && fit.rows === 1 && fit.right <= fit.edge + 1, w + 'px: footer fits on one row: ' + JSON.stringify(fit));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#chartFull [data-act="chart-full-close"]').click();
  console.log('PASS: full-screen ‹ › step through timeframes and wrap; footer fits at 375 and 390px');
};
