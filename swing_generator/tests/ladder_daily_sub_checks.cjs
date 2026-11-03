const assert = require('node:assert/strict');

// A ladder drawn on Daily also shows on 1H and 4H, where each Daily 10% gap is
// split into five (user, 2026-11-03): the Daily lines keep their big black
// labels ("20%"), the finer steps get small grey ones ("22%"), and Daily
// itself never shows the finer steps.
module.exports = async function checkLadderDailySub(page, name = 'TEST') {
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
  const main = () => page.locator('#chartFull .reel-draw .reel-ladder-lbl').allTextContents();
  const sub = () => page.locator('#chartFull .reel-draw .reel-ladder-sublbl').allTextContents();
  const subLines = () => page.locator('#chartFull .reel-draw .reel-ladder-sub').count();

  // Draw it on Daily, with its % labels on.
  await openFull('D');
  await page.locator('#chartFull [data-act="channel"]').click();
  const tb = page.locator('#chartFull .reel-toolbar');
  await tb.locator('[data-kind="ladder"]').click();
  if (!(await tb.locator('[data-act="draw-labels"]').isVisible())) await tb.locator('.reel-draw-fold').click();
  await tb.locator('[data-act="draw-labels"]').click();
  const stored = await page.evaluate(n => {
    const all = JSON.parse(localStorage.getItem('sp-channels') || '{}');
    const list = (all[n] && all[n].D) || [];
    return list.filter(d => d && d.kind === 'ladder').pop();
  }, name);
  assert.ok(stored && stored.link && ['D', '1H', '4H'].every(t => stored.tfs.includes(t)),
    'a ladder drawn on Daily shows on Daily, 1H and 4H: ' + JSON.stringify(stored && stored.tfs));
  const dailyLabels = await main();
  assert.ok(dailyLabels.includes('20%'), 'Daily labels: ' + dailyLabels.join(' '));
  assert.equal(await subLines(), 0, 'no sub-lines on Daily itself');
  assert.equal(await page.locator('#chartFull .reel-ladder-daily, #chartFull .reel-ladder-lbl-daily').count(), 0, 'Daily itself draws its ladder as before');
  await page.locator('#chartFull [data-act="channel"]').click();
  await close();

  for (const tf of ['1H', '4H']) {
    await openFull(tf);
    // Zoom the price scale in until the finer steps have room for labels.
    for (let i = 0; i < 6 && !(await sub()).length; i++) {
      const g = await page.locator('#chartFull .reel-ygrip').boundingBox();
      await page.mouse.move(g.x + g.width / 2, g.y + g.height * .55); await page.mouse.down();
      await page.mouse.move(g.x + g.width / 2, g.y + g.height * .55 - 160, { steps: 8 }); await page.mouse.up();
    }
    const m = await main(), s = await sub();
    assert.ok(m.length && m.every(t => /^-?\d+(\.\d+)?%$/.test(t) && Math.abs(parseFloat(t) / 10 - Math.round(parseFloat(t) / 10)) < 1e-6),
      tf + ': the big labels are the Daily 10% lines: ' + m.join(' '));
    // Daily and finer labels are told apart by size and weight, both black
    // (grey was "not visible enough", 2026-11-03); Daily lines are bolder here.
    const look = await page.evaluate(() => { const st = q => { const e = document.querySelector('#chartFull ' + q); if (!e) return null; const c = getComputedStyle(e); return { size: parseFloat(c.fontSize), weight: +c.fontWeight, fill: c.fill, stroke: parseFloat(c.strokeWidth) }; };
      return { big: st('.reel-ladder-lbl'), small: st('.reel-ladder-sublbl'), dline: st('.reel-ladder.reel-ladder-daily:not(.reel-ladder-key)'), sline: st('.reel-ladder-sub') }; });
    assert.ok(look.small && look.big && look.small.size < look.big.size && look.big.weight > look.small.weight, tf + ': bold Daily vs small labels: ' + JSON.stringify(look));
    assert.equal(look.small.fill, 'rgb(0, 0, 0)', tf + ': the small labels are black');
    assert.ok(!look.dline || look.dline.stroke > look.sline.stroke, tf + ': Daily lines are bolder than the finer ones: ' + JSON.stringify(look));
    assert.ok(await subLines() > 0, tf + ': the Daily gaps are subdivided');
    assert.ok(s.length && s.every(t => /^-?\d+(\.\d+)?%$/.test(t)), tf + ': finer steps carry small plain labels: ' + s.join(' '));
    // Every small label sits on a 2% step between two Daily 10% lines.
    assert.ok(s.every(t => { const v = parseFloat(t); return Math.abs(v / 2 - Math.round(v / 2)) < 1e-6 && Math.abs(v / 10 - Math.round(v / 10)) > 1e-6; }),
      tf + ': small labels are the 2% steps: ' + s.join(' '));
    await close();
  }
  console.log('PASS: Daily ladder subdivided on 1H/4H with big Daily and small grey labels');
};
