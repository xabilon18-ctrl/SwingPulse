const assert = require('node:assert/strict');

// Close-set dots (user, 2026-11-07, with a TradingView screenshot: "The dots
// look properly close together and tiny"; then "I only just asked for the
// spaces to be closed in ... the size is way too big on ours"). TradingView:
// 1.5 CSS px dots, 2.5 gap. Every fine dotted line here — the timelines on
// the default grid weight, the last-price line — must come out at exactly
// that on screen, whatever the chart's size, with square ends, and must keep
// the thickness it had before (viewBox units: timeline 1, last-price 1.6).
module.exports = async function checkDottedLines(page, name = 'TEST') {
  await page.locator('.nav-tab[data-tab="charts"]').click();
  await page.locator('#reelSearch').fill(name);
  const card = page.locator('.reel-card[data-name="' + name + '"]');
  await page.locator('#tfBtnD').click();
  await card.locator('.reel-chart svg').waitFor();
  const measure = scope => page.evaluate(sel => {
    const svg = document.querySelector(sel);
    const k = svg.getScreenCTM().a;                     // CSS px per viewBox unit
    const out = {};
    for (const [key, q] of [['timeline', '.reel-tgrid:not(.reel-tgrid-admin):not(.reel-tgrid-year):not(.reel-tgrid-quarter):not(.reel-tgrid-month)'], ['last', '.reel-last-line']]) {
      const e = svg.querySelector(q);
      if (!e) continue;
      const c = getComputedStyle(e), da = c.strokeDasharray.split(/[ ,]+/).map(parseFloat);
      out[key] = { wUnits: parseFloat(c.strokeWidth), dot: +(da[0] * k).toFixed(2), gap: +(da[1] * k).toFixed(2), cap: c.strokeLinecap };
    }
    return out;
  }, scope);
  const check = (where, m) => {
    assert.ok(m.timeline && m.last, where + ': timeline and last-price line found: ' + JSON.stringify(m));
    const was = { timeline: 1, last: 1.6 };
    for (const [k, v] of Object.entries(m))
      assert.ok(Math.abs(v.dot - 1.5) < 0.05 && Math.abs(v.gap - 2.5) < 0.05 && v.cap === 'butt' && Math.abs(v.wUnits - was[k]) < 1e-6,
        where + ' ' + k + ': 1.5 dot, 2.5 gap, square ends, thickness unchanged: ' + JSON.stringify(v));
  };
  check('card', await measure('.reel-card[data-name="' + name + '"] .reel-chart svg'));
  await card.locator('[data-act="chart-expand"]').click();
  await page.locator('#chartFull .reel-chart svg').waitFor();
  check('full screen', await measure('#chartFull .reel-chart svg'));
  await page.locator('#chartFull [data-act="chart-full-close"]').click();
  console.log('PASS: dotted lines are close-set (1.5 dot, 2.5 gap, thickness unchanged) on the card and full screen');
};
