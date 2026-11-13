const assert = require('node:assert/strict');

// A ladder drawn on Monthly also shows on Daily, where each Monthly 10% gap
// is split into three (user, 2026-11-13: "Daily goes into monthly 10% 3
// times"): the Monthly lines keep their big labels ("20%"), the thirds get
// small grey ones ("3.3%", "6.7%"), and Monthly itself never shows them.
// Then on 1H (2026-11-13: "build on top of the original") each third is
// replaced by eight equal parts per Monthly 10% gap ("Make 1h 8 instead of
// 6"); the thirds do not line up with eighths, so 1H does not show them. It is not a Daily ladder: not
// dashed, and its own 10% gaps are never split straight into five.
module.exports = async function checkLadderMonthlySub(page, name = 'TEST') {
  await page.locator('.nav-tab[data-tab="charts"]').click();
  await page.locator('#reelSearch').fill(name);
  const card = page.locator('.reel-card[data-name="' + name + '"]');
  const openFull = async tf => {
    await page.evaluate(t => document.getElementById('tfBtn' + t).click(), tf);
    await card.locator('.reel-chart svg').waitFor();
    await card.locator('[data-act="chart-expand"]').click();
    await page.locator('#chartFull .reel-chart svg').waitFor();
  };
  const close = () => page.locator('#chartFull [data-act="chart-full-close"]').click();
  const saved = tf => page.evaluate(([n, t]) => {
    const all = JSON.parse(localStorage.getItem('sp-channels') || '{}');
    return ((all[n] && all[n][t]) || []).filter(d => d && d.kind === 'ladder' && d.home === 'M');
  }, [name, tf]);

  await openFull('M');
  await page.locator('#chartFull [data-act="channel"]').click();
  const tb = page.locator('#chartFull .reel-toolbar');
  await tb.locator('[data-kind="ladder"]').click();
  // % labels are on from the start (2026-11-13).
  if (!(await tb.locator('[data-act="draw-labels"]').isVisible())) await tb.locator('.reel-draw-fold').click();
  const onM = await saved('M');
  assert.equal(onM.length, 1, 'the ladder drawn on Monthly is saved as a Monthly ladder');
  const d = onM[0];
  assert.ok(d.link && d.tfs.length === 4 && ['M', 'W', 'D', '1H'].every(t => d.tfs.includes(t)), 'all its timeframes are on by default: ' + JSON.stringify(d.tfs));
  assert.ok(!d.dash, 'it is not dashed like a Daily ladder');
  assert.equal(await page.locator('#chartFull .reel-draw .reel-ladder-sub').count(), 0, 'no thirds on Monthly itself');
  await page.locator('#chartFull [data-act="channel"]').click();
  await close();
  assert.equal((await saved('D')).length, 1, 'its copy is on the Daily chart');

  await openFull('D');
  const zoomIn = async () => {
    let g = null;
    for (let k = 0; k < 40 && !g; k++) { g = await page.locator('#chartFull .reel-ygrip').boundingBox({ timeout: 1000 }).catch(() => null); if (!g) await page.waitForTimeout(50); }
    assert.ok(g, 'price-axis grip is on screen');
    await page.mouse.move(g.x + g.width / 2, g.y + g.height * .55); await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height * .55 - 160, { steps: 8 }); await page.mouse.up();
  };
  // Zoom the price scale in so the thirds have room for their labels.
  const texts = async () => page.evaluate(() => ({
    sub: [...document.querySelectorAll('#chartFull .reel-draw .reel-ladder-sublbl')].map(e => e.textContent),
    lines: document.querySelectorAll('#chartFull .reel-draw .reel-ladder-sub').length,
  }));
  let t = await texts();
  for (let i = 0; i < 8 && !t.sub.some(x => /\.[37]%$/.test(x)); i++) { await zoomIn(); t = await texts(); }
  assert.ok(t.lines > 0, 'Daily: the Monthly gaps are subdivided');
  const thirds = t.sub.filter(x => /\.[37]%$/.test(x));
  assert.ok(thirds.length, 'Daily: small labels on the thirds (3.3%, 6.7% ...): ' + t.sub.join(' '));
  assert.ok(thirds.every(x => { const v = parseFloat(x) * 3 / 10; return Math.abs(v - Math.round(v)) < 0.05; }), 'every one a third of a 10% gap: ' + thirds.join(' '));
  // Two thirds between each pair of Monthly lines, at the right prices.
  const geo = await page.evaluate(() => {
    const y = e => +e.getAttribute('y1');
    const big = [...document.querySelectorAll('#chartFull .reel-draw .reel-ladder.reel-ladder-daily:not(.is-dash)')].map(e => ({ y: y(e), pct: +e.dataset.pct })).sort((a, b) => a.y - b.y);
    const small = [...document.querySelectorAll('#chartFull .reel-draw .reel-ladder-sub:not(.is-dash)')].map(y).sort((a, b) => a - b);
    return { big, small };
  });
  assert.ok(geo.big.length >= 2, 'Daily: at least two Monthly lines in view: ' + JSON.stringify(geo.big));
  const a = geo.big[0], z = geo.big[1], gap = z.y - a.y;
  const between = geo.small.filter(v => v > a.y + 0.5 && v < z.y - 0.5);
  assert.equal(between.length, 2, 'two lines between neighbouring Monthly lines: ' + JSON.stringify({ a, z, between }));
  assert.ok(Math.abs(between[0] - (a.y + gap / 3)) < 0.6 && Math.abs(between[1] - (a.y + 2 * gap / 3)) < 0.6, 'at one third and two thirds: ' + JSON.stringify({ a, z, between }));
  assert.equal(await page.locator('#chartFull .reel-ladder-mid').count(), 0, 'Daily: one tier only, no 1H steps');
  // Its own 10% lines are bold, thicker than the thirds (2026-11-13).
  const w = await page.evaluate(() => {
    const sw = q => [...document.querySelectorAll('#chartFull .reel-draw ' + q)].map(e => parseFloat(getComputedStyle(e).strokeWidth));
    return { own: sw('.reel-ladder.reel-ladder-daily.reel-ladder-bold:not(.is-dash)'), plain: sw('.reel-ladder.reel-ladder-daily:not(.reel-ladder-bold):not(.reel-ladder-key):not(.is-dash)'), sub: sw('.reel-ladder-sub:not(.is-dash)') };
  });
  assert.ok(w.own.length && !w.plain.length, 'Daily: every Monthly 10% line is bold: ' + JSON.stringify(w));
  assert.ok(Math.min(...w.own) >= 1.5 * Math.max(...w.sub), 'Daily: bold 10% lines clearly thicker than the thirds: ' + JSON.stringify(w));
  await close();

  // Weekly: each 10% gap in two (2026-11-13, "make weekly by 2").
  await openFull('W');
  let wk = await page.evaluate(() => ({ own: [...document.querySelectorAll('#chartFull .reel-draw .reel-ladder.reel-ladder-daily:not(.is-dash)')].map(e => +e.getAttribute('y1')).sort((a, b) => a - b),
    sub: [...document.querySelectorAll('#chartFull .reel-draw .reel-ladder-sub:not(.is-dash)')].map(e => +e.getAttribute('y1')) }));
  for (let i = 0; i < 8 && !(wk.sub.length && wk.own.length >= 2); i++) { await zoomIn(); wk = await page.evaluate(() => ({ own: [...document.querySelectorAll('#chartFull .reel-draw .reel-ladder.reel-ladder-daily:not(.is-dash)')].map(e => +e.getAttribute('y1')).sort((a, b) => a - b),
    sub: [...document.querySelectorAll('#chartFull .reel-draw .reel-ladder-sub:not(.is-dash)')].map(e => +e.getAttribute('y1')) })); }
  const wa = wk.own[0], wz = wk.own[1], wIn = wk.sub.filter(v => v > wa + 0.5 && v < wz - 0.5);
  assert.equal(wIn.length, 1, 'Weekly: one line inside each 10% gap: ' + JSON.stringify({ wa, wz, wIn }));
  assert.ok(Math.abs(wIn[0] - (wa + wz) / 2) < 0.6, 'Weekly: at the middle: ' + JSON.stringify({ wa, wz, wIn }));
  await close();

  // 1H: each Monthly 10% gap in eight, no thirds.
  // A ladder sized on Monthly spans far more than a 1H screen, so put this
  // one around the 1H price (a 10% gap = the visible range / 3) and leave
  // it the only ladder there; the split does not depend on its size.
  await openFull('1H');
  const win = await page.evaluate(() => { const h = [...document.querySelectorAll('#chartFull *')].find(e => e._reelCtx); return h && { lo: h._reelCtx.sc.lo, hi: h._reelCtx.sc.hi }; });
  assert.ok(win && win.hi > win.lo, '1H: price window found: ' + JSON.stringify(win));
  await close();
  await page.evaluate(([n, w]) => {
    const all = JSON.parse(localStorage.getItem('sp-channels') || '{}');
    const step = (w.hi - w.lo) / 3;       // one 10% gap: three in view
    for (const tf of Object.keys(all[n] || {})) {
      all[n][tf] = (all[n][tf] || []).filter(x => !(x && x.kind === 'ladder' && x.home !== 'M'));
      for (const x of all[n][tf]) if (x && x.kind === 'ladder' && x.home === 'M') { x.p1 = w.lo + (w.hi - w.lo) * 0.2; x.p4 = x.p1 + 3 * step; }
    }
    localStorage.setItem('sp-channels', JSON.stringify(all));
  }, [name, win]);
  await page.reload({ waitUntil: 'networkidle' });
  if (await page.locator('.up-skip').isVisible().catch(() => false)) await page.locator('.up-skip').click();
  await page.locator('.nav-tab[data-tab="charts"]').click();
  await page.locator('#reelSearch').fill(name);
  await openFull('1H');
  const tiers = () => page.evaluate(() => {
    const y = e => +e.getAttribute('y1');
    const own = [...document.querySelectorAll('#chartFull .reel-draw .reel-ladder.reel-ladder-daily:not(.is-dash)')].map(y);
    const mid = [...document.querySelectorAll('#chartFull .reel-draw .reel-ladder-sub.reel-ladder-mid:not(.is-dash)')].map(y);
    const fine = [...document.querySelectorAll('#chartFull .reel-draw .reel-ladder-sub:not(.reel-ladder-mid):not(.is-dash)')].map(y);
    return { all: [...own, ...mid].sort((a, b) => a - b), mid, fine };
  });
  let h = await tiers();
  for (let i = 0; i < 10 && !(h.fine.length && h.all.length >= 2); i++) { await zoomIn(); h = await tiers(); }
  assert.equal(h.mid.length, 0, '1H: no thirds tier: ' + JSON.stringify(h));
  assert.ok(h.fine.length, '1H: the 10% gaps are split: ' + JSON.stringify(h));
  const lo = h.all[0], hi = h.all[1], step = hi - lo;
  const inGap = h.fine.filter(v => v > lo + 0.5 && v < hi - 0.5).sort((a, b) => a - b);
  assert.equal(inGap.length, 7, '1H: seven lines inside each 10% gap (eight parts): ' + JSON.stringify({ lo, hi, inGap }));
  assert.ok(inGap.every((v, i) => Math.abs(v - (lo + step * (i + 1) / 8)) < 0.6), '1H: evenly at eighths: ' + JSON.stringify({ lo, hi, inGap }));
  const labels = await page.locator('#chartFull .reel-draw .reel-ladder-sublbl').allTextContents();
  assert.ok(labels.includes('1.25%') && labels.includes('3.75%') && !labels.some(t => /^(3\.3|6\.7|1\.7)%$/.test(t)), '1H: eighths labelled exactly, no thirds or sixths: ' + labels.join(' '));
  await close();

  console.log('PASS: Monthly ladder on every timeframe by default: halves on Weekly, thirds on Daily, eighths on 1H, bold 10% lines');
};
