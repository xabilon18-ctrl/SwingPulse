const assert = require('node:assert/strict');

// TradingView-style dots (user, 2026-11-07, with a TradingView screenshot:
// "The dots look properly close together and tiny ... Anything that's a dot,
// please make it look like that"). Measured there: a dot 1 CSS px thick and
// 1.5 long, a 2.5 gap, solid. Every fine dotted line here — the timelines on
// the default grid weight, the last-price line — must come out at exactly
// that on screen, in CSS pixels, whatever the chart's size, with square dots.
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
      out[key] = { w: +(parseFloat(c.strokeWidth) * k).toFixed(2), dot: +(da[0] * k).toFixed(2), gap: +(da[1] * k).toFixed(2), cap: c.strokeLinecap, op: +c.strokeOpacity };
    }
    return out;
  }, scope);
  const check = (where, m) => {
    assert.ok(m.timeline && m.last, where + ': timeline and last-price line found: ' + JSON.stringify(m));
    for (const [k, v] of Object.entries(m))
      assert.ok(Math.abs(v.w - 1) < 0.05 && Math.abs(v.dot - 1.5) < 0.05 && Math.abs(v.gap - 2.5) < 0.05 && v.cap === 'butt' && v.op === 1,
        where + ' ' + k + ': 1 px thick, 1.5 dot, 2.5 gap, square and solid: ' + JSON.stringify(v));
  };
  check('card', await measure('.reel-card[data-name="' + name + '"] .reel-chart svg'));
  await card.locator('[data-act="chart-expand"]').click();
  await page.locator('#chartFull .reel-chart svg').waitFor();
  check('full screen', await measure('#chartFull .reel-chart svg'));
  await page.locator('#chartFull [data-act="chart-full-close"]').click();
  console.log('PASS: dotted lines are TradingView-style (1 px, 1.5 dot, 2.5 gap) on the card and full screen');
};
