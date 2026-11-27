const assert = require('node:assert/strict');
const openChart = require('./chart_open.cjs');

// Dashed ladder (user, 2026-11-06: "add the dash lines as an option for the
// percentage line with thin med and thick"; since 2026-11-07 every Daily
// ladder is dashed, new ones too; dashed starts on Medium since 2026-11-20,
// on Thin before). Dashed turns the 10% lines (and the 1H finer steps) into
// dashes; Thin / Thick still work, on Daily and on 1H (4H removed 2026-11-07). The 0% / 100% ends keep their
// own dash. Dotted stays available and is remembered (`dashOff`).
module.exports = async function checkLadderDash(page, name = 'TEST') {
  const openFull = async tf => {
    await openChart(page, name, tf);
  };
  const close = () => page.locator('#chartFull [data-act="chart-full-close"]').click();
  const stored = () => page.evaluate(n => {
    const all = JSON.parse(localStorage.getItem('sp-channels') || '{}');
    return ((all[n] && all[n].D) || []).filter(d => d && d.kind === 'ladder').pop() || null;
  }, name);
  // The newest ladder's lines: the last .reel-draw group holding ladder lines.
  const look = () => page.evaluate(() => {
    const g = [...document.querySelectorAll('#chartFull .reel-draw')].filter(x => x.querySelector('.reel-ladder')).pop();
    const st = e => { const c = getComputedStyle(e); return { w: parseFloat(c.strokeWidth), da: c.strokeDasharray, dash: e.classList.contains('is-dash') }; };
    const q = s => [...g.querySelectorAll(s)].map(st);
    return { stroke: g.getAttribute('data-stroke'), inner: q('.reel-ladder:not(.reel-ladder-key):not(.reel-ladder-bold)'), bold: q('.reel-ladder.reel-ladder-bold'),
      key: q('.reel-ladder.reel-ladder-key'), sub: q('.reel-ladder-sub') };
  });
  const same = (xs, f) => xs.length && xs.every(f);

  await openFull('D');
  await page.locator('#chartFull [data-act="channel"]').click();
  const tb = page.locator('#chartFull .reel-toolbar');
  await tb.locator('[data-kind="ladder"]').click();
  if (!(await tb.locator('[data-act="draw-dash"][data-v="1"]').isVisible())) await tb.locator('.reel-draw-fold').click();
  const dotted = tb.locator('[data-act="draw-dash"][data-v="0"]'), dashed = tb.locator('[data-act="draw-dash"][data-v="1"]');
  // A new Daily ladder opens dashed (2026-11-07) and on Medium (2026-11-20:
  // "the standard dash lines should be on medium and not strong").
  assert.equal(await dashed.getAttribute('aria-pressed'), 'true', 'a new Daily ladder is dashed');
  assert.equal(await tb.locator('[data-act="draw-div"]').count(), 0, 'no ÷10 switch on a ladder');
  const d = await stored();
  assert.ok(d && d.dash === true && d.strokeWeight === 2, 'saved dashed and Medium: ' + JSON.stringify(d && { dash: d.dash, w: d.strokeWeight }));
  let l = await look();
  assert.equal(l.stroke, '2', 'a new Daily ladder opens on Medium');
  assert.equal(await tb.locator('[data-act="draw-weight"][data-v="2"]').getAttribute('aria-pressed'), 'true', 'the Medium button is on');
  l = await look();
  assert.ok(same(l.inner, x => x.dash && x.da.startsWith('10') && Math.abs(x.w - 1.7) < 0.01), 'Medium dashed 10% lines: ' + JSON.stringify(l.inner.slice(0, 2)));
  assert.ok(same(l.key, x => !x.dash && x.da.startsWith('14')), 'the 0% / 100% ends keep their own dash: ' + JSON.stringify(l.key));
  // Bolder 0% / 100% / 200%... (2026-11-07): Medium ends are 5.5 on Daily.
  assert.ok(same(l.key, x => Math.abs(x.w - 5.5) < 0.01), 'Medium Daily ends are 5.5: ' + JSON.stringify(l.key));
  // Thin and Thick work on a dashed ladder.
  for (const [v, w] of [['1', 0.9], ['3', 2.6]]) {
    await tb.locator(`[data-act="draw-weight"][data-v="${v}"]`).click();
    l = await look();
    assert.ok(same(l.inner, x => x.dash && Math.abs(x.w - w) < 0.01), `weight ${v} dashed: ` + JSON.stringify(l.inner.slice(0, 2)));
  }
  // Back to dotted: the dashes go, the weight stays (Thick here), and the
  // choice is remembered so the one-time dash pass leaves it alone.
  await dotted.click();
  let back = await stored();
  assert.ok(back && !back.dash && back.strokeWeight === 3 && back.dashOff === true, 'dotted again, weight kept, remembered: ' + JSON.stringify(back && { dash: back.dash, w: back.strokeWeight, off: back.dashOff }));
  l = await look();
  // Dotted lines take the close-set dot (--dd-s on the chart), 2026-11-07.
  const ddL = await page.evaluate(() => getComputedStyle(document.querySelector('#chartFull .reel-chart svg')).getPropertyValue('--dd-s').trim().split(/\s+/).map(Number));
  const nums = da => da.split(/[ ,]+/).map(parseFloat);
  assert.ok(ddL.length === 2 && same(l.inner, x => !x.dash && nums(x.da).every((v, i) => Math.abs(v - ddL[i]) < 0.02)),
    'dotted again, close-set dots: ' + JSON.stringify({ ddL, inner: l.inner.slice(0, 2) }));
  // Dashed again starts on Medium again.
  await tb.locator('[data-act="draw-dash"][data-v="1"]').click();
  back = await stored();
  assert.ok(back && back.dash === true && back.strokeWeight === 2 && !back.dashOff, 'dashed again, on Medium: ' + JSON.stringify(back && { dash: back.dash, w: back.strokeWeight, off: back.dashOff }));
  await page.locator('#chartFull [data-act="channel"]').click();
  await close();

  // 1H: the same dashes, and the chosen weight (Medium) instead of the
  // fixed widths, in the order finer steps < 10% lines < bold 20s / ends.
  for (const tf of ['1H']) {
    await openFull(tf);
    l = await look();
    assert.ok(same(l.inner, x => x.dash && Math.abs(x.w - 2.2) < 0.01), tf + ': Medium dashed Daily lines: ' + JSON.stringify(l.inner.slice(0, 2)));
    // 0% / 100% / 200%... heavier than the bold 20s since 2026-11-07.
    assert.ok(same(l.key, x => Math.abs(x.w - 6) < 0.01), tf + ': Medium ends: ' + JSON.stringify(l.key));
    if (tf === '1H' && l.bold.length) assert.ok(same(l.bold, x => x.dash && Math.abs(x.w - 4) < 0.01), '1H: Medium dashed bold 20s: ' + JSON.stringify(l.bold));
    if (l.sub.length) assert.ok(l.sub.every(x => x.dash && x.w < 2.2), tf + ': finer steps dashed and thinner: ' + JSON.stringify(l.sub.slice(0, 2)));
    await close();
  }

  console.log('PASS: dashed ladder option (Medium first, Thin / Thick, on D and 1H)');
};
