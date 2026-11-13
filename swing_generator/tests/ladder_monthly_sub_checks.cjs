const assert = require('node:assert/strict');

// A ladder drawn on Monthly also shows on Daily, where each Monthly 10% gap
// is split into three (user, 2026-11-13: "Daily goes into monthly 10% 3
// times"): the Monthly lines keep their big labels ("20%"), the thirds get
// small grey ones ("3.3%", "6.7%"), and Monthly itself never shows them. It
// is not a Daily ladder: not on 1H, not dashed, not split by five.
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
  if (!(await tb.locator('[data-act="draw-labels"]').isVisible())) await tb.locator('.reel-draw-fold').click();
  await tb.locator('[data-act="draw-labels"]').click();
  const onM = await saved('M');
  assert.equal(onM.length, 1, 'the ladder drawn on Monthly is saved as a Monthly ladder');
  const d = onM[0];
  assert.ok(d.link && d.tfs.length === 2 && d.tfs.includes('M') && d.tfs.includes('D'), 'it shows on Monthly and Daily only: ' + JSON.stringify(d.tfs));
  assert.ok(!d.dash, 'it is not dashed like a Daily ladder');
  assert.equal(await page.locator('#chartFull .reel-draw .reel-ladder-sub').count(), 0, 'no thirds on Monthly itself');
  await page.locator('#chartFull [data-act="channel"]').click();
  await close();
  assert.equal((await saved('D')).length, 1, 'its copy is on the Daily chart');

  await openFull('D');
  // Frame the price scale on the ladder's first 20% so the thirds have room
  // for their labels, whatever else is on the chart.
  const texts = async () => page.evaluate(() => ({
    sub: [...document.querySelectorAll('#chartFull .reel-draw .reel-ladder-sublbl')].map(e => e.textContent),
    lines: document.querySelectorAll('#chartFull .reel-draw .reel-ladder-sub').length,
  }));
  let t = await texts();
  for (let i = 0; i < 8 && !t.sub.some(x => /\.[37]%$/.test(x)); i++) {
    let g = null;
    for (let k = 0; k < 40 && !g; k++) { g = await page.locator('#chartFull .reel-ygrip').boundingBox({ timeout: 1000 }).catch(() => null); if (!g) await page.waitForTimeout(50); }
    assert.ok(g, 'price-axis grip is on screen');
    await page.mouse.move(g.x + g.width / 2, g.y + g.height * .55); await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height * .55 - 160, { steps: 8 }); await page.mouse.up();
    t = await texts();
  }
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
  await close();

  console.log('PASS: Monthly ladder shows on Daily split into three, not on 1H');
};
