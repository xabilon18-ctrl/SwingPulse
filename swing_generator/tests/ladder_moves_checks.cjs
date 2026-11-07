const assert = require('node:assert/strict');

// "Move %" on a ladder (user, 2026-11-06): the actual price move of each gap
// between two Daily 10% lines, written in the middle of the gap, through the
// stacks (past 100%), and on 1H for a Daily ladder too (4H removed
// 2026-11-07). Equal price
// steps mean the move shrinks as price climbs; a reversed ladder measures
// down from the upper line.
module.exports = async function checkLadderMoves(page, name = 'TEST') {
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
  const moves = () => page.evaluate(() => [...document.querySelectorAll('#chartFull .reel-draw .reel-ladder-move')]
    .map(e => ({ t: e.textContent, from: +e.dataset.from, to: +e.dataset.to, y: +e.getAttribute('y') })));
  const stored = () => page.evaluate(n => {
    const all = JSON.parse(localStorage.getItem('sp-channels') || '{}');
    return ((all[n] && all[n].D) || []).filter(d => d && d.kind === 'ladder' && d.moves).pop() || null;
  }, name);
  const fmt = v => { const a = Math.abs(v); return (v < 0 ? '-' : '+') + (a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(1) : a.toFixed(2)) + '%'; };
  // The move each gap should show, from the saved ladder's two anchors.
  const want = (d, m) => {
    const step = (d.p4 - d.p1) / 3, at = pct => d.p1 + (d.reverse ? 100 - pct : pct) / 10 * step;
    const lo = Math.min(at(m.from), at(m.to)), hi = Math.max(at(m.from), at(m.to));
    return fmt(d.reverse ? (lo - hi) / hi * 100 : (hi - lo) / lo * 100);
  };

  await openFull('D');
  await page.locator('#chartFull [data-act="channel"]').click();
  const tb = page.locator('#chartFull .reel-toolbar');
  await tb.locator('[data-kind="ladder"]').click();
  if (!(await tb.locator('[data-act="draw-moves"]').isVisible())) await tb.locator('.reel-draw-fold').click();
  const sw = tb.locator('[data-act="draw-moves"]');
  assert.equal(await sw.getAttribute('aria-pressed'), 'false', 'Move % starts off');
  assert.equal((await moves()).length, 0, 'no move labels before the switch');
  await sw.click();
  assert.equal(await tb.locator('[data-act="draw-moves"]').getAttribute('aria-pressed'), 'true', 'the switch turns on');
  // A block above, so the labels run past 100%.
  await tb.locator('[data-act="draw-stack"][data-dir="up"][data-d="1"]').click();
  const d = await stored();
  assert.ok(d && d.moves === true, 'the ladder is saved with Move % on');
  assert.ok(d.link && d.tfs.includes('1H') && !d.tfs.includes('4H'), 'a Daily ladder carries it to 1H (not 4H): ' + JSON.stringify(d && d.tfs));
  let m = await moves();
  assert.ok(m.length >= 5, 'Daily: a move label in most gaps: ' + JSON.stringify(m));
  for (const x of m) {
    assert.equal(x.to - x.from, 10, 'each label sits on one Daily 10% gap: ' + JSON.stringify(x));
    assert.equal(x.t, want(d, x), 'Daily: the actual move of the ' + x.from + '-' + x.to + '% gap');
  }
  assert.ok(m.some(x => x.from >= 100), 'labels carry on through the block above 100%: ' + m.map(x => x.from).join(' '));
  // Equal price steps: the higher the gap, the smaller its % move.
  const up = m.slice().sort((a, b) => a.from - b.from).map(x => parseFloat(x.t));
  assert.ok(up.every((v, i) => !i || v < up[i - 1]), 'moves shrink going up the ladder: ' + up.join(' '));
  // Each label is in the middle of its gap (between its two lines).
  const ys = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#chartFull .reel-draw .reel-ladder[data-pct]')].map(e => [e.dataset.pct, +e.getAttribute('y1')])));
  for (const x of m) if (ys[x.from] != null && ys[x.to] != null)
    assert.ok(Math.abs(x.y - (ys[x.from] + ys[x.to]) / 2) < 0.2, 'label in the middle of its gap: ' + JSON.stringify({ x, a: ys[x.from], b: ys[x.to] }));
  // Reversed numbering measures the move down from the upper line.
  await tb.locator('[data-act="draw-reverse"]').click();
  const dr = await stored();
  m = await moves();
  assert.ok(m.length && m.every(x => x.t.startsWith('-') && x.t === want(dr, x)), 'reversed: down moves from the upper line: ' + JSON.stringify(m));
  await tb.locator('[data-act="draw-reverse"]').click();
  await page.locator('#chartFull [data-act="channel"]').click();
  await close();

  for (const tf of ['1H']) {
    await openFull(tf);
    let got = await moves();
    // Zoom the price scale OUT until at least one Daily gap's middle is on screen.
    for (let i = 0; i < 6 && !got.length; i++) {
      let g = null;
      for (let k = 0; k < 40 && !g; k++) { g = await page.locator('#chartFull .reel-ygrip').boundingBox({ timeout: 1000 }).catch(() => null); if (!g) await page.waitForTimeout(50); }
      assert.ok(g, tf + ': price-axis grip is on screen');
      await page.mouse.move(g.x + g.width / 2, g.y + g.height * .45); await page.mouse.down();
      await page.mouse.move(g.x + g.width / 2, g.y + g.height * .45 + 160, { steps: 8 }); await page.mouse.up();
      got = await moves();
    }
    assert.ok(got.length, tf + ': the Daily ladder shows its move labels');
    for (const x of got) {
      assert.equal(x.to - x.from, 10, tf + ': labels are on the Daily gaps, not the finer steps: ' + JSON.stringify(x));
      assert.equal(x.t, want(d, x), tf + ': same move as on Daily for the ' + x.from + '-' + x.to + '% gap');
    }
    await close();
  }
  console.log('PASS: ladder Move % labels each Daily gap on D and 1H');
};
