const assert = require('node:assert/strict');

// Dashed ladder (user, 2026-11-06: "add the dash lines as an option for the
// percentage line with thin med and thick. With thin being default"; since
// 2026-11-07 every Daily ladder is dashed and Thin, new ones too). Dashed
// turns the 10% lines (and the 1H finer steps) into dashes; Medium /
// Thick still work, on Daily and on 1H (4H removed 2026-11-07). The 0% / 100% ends keep their
// own dash. Dotted stays available and is remembered (`dashOff`).
module.exports = async function checkLadderDash(page, name = 'TEST') {
  await page.locator('.nav-tab[data-tab="charts"]').click();
  await page.locator('#reelSearch').fill(name);
  const card = page.locator('.reel-card[data-name="' + name + '"]');
  const openFull = async tf => {
    await page.locator('#tfBtn' + tf).click();
    await card.locator('.reel-chart svg').waitFor();
    await card.locator('[data-act="chart-expand"]').click();
    await page.locator('#chartFull .reel-chart svg').waitFor();
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
  // A new Daily ladder opens dashed and Thin (2026-11-07).
  assert.equal(await dashed.getAttribute('aria-pressed'), 'true', 'a new Daily ladder is dashed');
  assert.equal(await tb.locator('[data-act="draw-div"]').count(), 0, 'no ÷10 switch on a ladder');
  const d = await stored();
  assert.ok(d && d.dash === true && d.strokeWeight === 1, 'saved dashed and Thin: ' + JSON.stringify(d && { dash: d.dash, w: d.strokeWeight }));
  let l = await look();
  assert.equal(l.stroke, '1', 'a new Daily ladder opens on Thin');
  assert.equal(await tb.locator('[data-act="draw-weight"][data-v="1"]').getAttribute('aria-pressed'), 'true', 'the Thin button is on');
  l = await look();
  assert.ok(same(l.inner, x => x.dash && x.da.startsWith('10') && Math.abs(x.w - 0.9) < 0.01), 'Thin dashed 10% lines: ' + JSON.stringify(l.inner.slice(0, 2)));
  assert.ok(same(l.key, x => !x.dash && x.da.startsWith('14')), 'the 0% / 100% ends keep their own dash: ' + JSON.stringify(l.key));
  // Bolder 0% / 100% / 200%... (2026-11-07): Thin ends 2 -> 3.5 on Daily.
  assert.ok(same(l.key, x => Math.abs(x.w - 3.5) < 0.01), 'Thin Daily ends are 3.5: ' + JSON.stringify(l.key));
  // Medium and Thick work on a dashed ladder.
  for (const [v, w] of [['2', 1.7], ['3', 2.6]]) {
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
  // Dashed again starts on Thin again.
  await tb.locator('[data-act="draw-dash"][data-v="1"]').click();
  back = await stored();
  assert.ok(back && back.dash === true && back.strokeWeight === 1 && !back.dashOff, 'dashed again, on Thin: ' + JSON.stringify(back && { dash: back.dash, w: back.strokeWeight, off: back.dashOff }));
  await page.locator('#chartFull [data-act="channel"]').click();
  await close();

  // 1H: the same dashes, and the chosen weight (Thin) instead of the
  // fixed widths, in the order finer steps < 10% lines < bold 20s / ends.
  for (const tf of ['1H']) {
    await openFull(tf);
    l = await look();
    assert.ok(same(l.inner, x => x.dash && Math.abs(x.w - 1.4) < 0.01), tf + ': Thin dashed Daily lines: ' + JSON.stringify(l.inner.slice(0, 2)));
    // 0% / 100% / 200%... heavier than the bold 20s since 2026-11-07 (2.6 -> 4).
    assert.ok(same(l.key, x => Math.abs(x.w - 4) < 0.01), tf + ': Thin ends: ' + JSON.stringify(l.key));
    if (tf === '1H' && l.bold.length) assert.ok(same(l.bold, x => x.dash && Math.abs(x.w - 2.6) < 0.01), '1H: Thin dashed bold 20s: ' + JSON.stringify(l.bold));
    if (l.sub.length) assert.ok(l.sub.every(x => x.dash && x.w < 1.4), tf + ': finer steps dashed and thinner: ' + JSON.stringify(l.sub.slice(0, 2)));
    await close();
  }

  console.log('PASS: dashed ladder option (Thin first, Medium / Thick, on D and 1H)');
};
