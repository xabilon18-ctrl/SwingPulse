const assert = require('node:assert/strict');

// A ladder drawn on Daily also shows on 1H (not on 4H since 2026-11-04),
// where each Daily 10% gap is split into four (every 2.5%): the Daily lines
// keep their big black labels ("20%"), the finer steps get small grey ones
// ("22.5%"), and Daily itself never shows the finer steps.
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
  // A block stacked above: its 120/140/160/180% lines are bold on 1H too.
  await tb.locator('[data-act="draw-stack"][data-dir="up"][data-d="1"]').click();
  // Phone alerts on its lines (2026-11-03): the bell is a press / unpress
  // switch stored on the ladder, which the sync Worker reads after each run.
  const bell = tb.locator('[data-act="draw-alert"]');
  assert.equal(await bell.getAttribute('aria-pressed'), 'false', 'alerts start off');
  await bell.click();
  assert.equal(await tb.locator('[data-act="draw-alert"]').getAttribute('aria-pressed'), 'true', 'the bell turns alerts on');
  const stored = await page.evaluate(n => {
    const all = JSON.parse(localStorage.getItem('sp-channels') || '{}');
    const list = (all[n] && all[n].D) || [];
    return list.filter(d => d && d.kind === 'ladder').pop();
  }, name);
  assert.equal(stored && stored.alert, true, 'the ladder is saved with its alert on');
  assert.ok(stored && stored.link && ['D', '1H'].every(t => stored.tfs.includes(t)) && !stored.tfs.includes('4H'),
    'a ladder drawn on Daily shows on Daily and 1H, not 4H (2026-11-04): ' + JSON.stringify(stored && stored.tfs));
  const dailyLabels = await main();
  assert.ok(dailyLabels.includes('20%'), 'Daily labels: ' + dailyLabels.join(' '));
  assert.equal(await subLines(), 0, 'no sub-lines on Daily itself');
  assert.equal(await page.locator('#chartFull .reel-ladder-bold').count(), 0, 'no bold 20% lines on Daily itself');
  await page.locator('#chartFull [data-act="channel"]').click();
  await close();

  // Not on 4H (2026-11-04, user: "remove 4h").
  await openFull('4H');
  // Its labels are on and it has a stacked block (110-200%): none of them on 4H.
  assert.ok(!(await main()).some(t => ['150%', '200%'].includes(t)), 'a Daily ladder does not show on 4H: ' + (await main()).join(' '));
  await close();
  for (const tf of ['1H']) {
    await openFull(tf);
    // On 1H only, the Daily 20/40/60/80% lines are bold (2026-11-03).
    // Only this Daily ladder's lines (.reel-ladder-daily): other tests leave
    // their own ladders, at other line weights, on these charts.
    const widths = await page.evaluate(() => [...document.querySelectorAll('#chartFull .reel-draw .reel-ladder.reel-ladder-daily:not(.reel-ladder-key)')]
      .map(e => ({ pct: +e.dataset.pct, bold: e.classList.contains('reel-ladder-bold'), w: parseFloat(getComputedStyle(e).strokeWidth) })));
    const bold = widths.filter(x => x.bold), plain = widths.filter(x => !x.bold);
    if (tf === '1H') {
      assert.ok(bold.length && bold.every(x => x.pct % 20 === 0), '1H: the bold lines are the 20% steps: ' + JSON.stringify(widths));
      assert.ok([20, 40, 60, 80, 120, 140, 160, 180].every(p => bold.some(x => x.pct === p)), '1H: 20-80% and the stacked 120-180% are bold: ' + JSON.stringify(bold.map(x => x.pct)));
      assert.ok(plain.every(x => x.pct % 20 !== 0), '1H: every 20% step is bold: ' + JSON.stringify(widths));
      assert.ok(Math.min(...bold.map(x => x.w)) > Math.max(...plain.map(x => x.w)), '1H: bold lines are thicker: ' + JSON.stringify(widths));
    } else assert.equal(bold.length, 0, tf + ': no bold 20% lines off 1H');
    // The finer lines are clearly visible (2026-11-03: "The lines too light")
    // yet thinner than the Daily 10% lines.
    const subLook = await page.evaluate(() => { const e = document.querySelector('#chartFull .reel-ladder-sub'); if (!e) return null; const c = getComputedStyle(e); return { w: parseFloat(c.strokeWidth), o: +c.strokeOpacity }; });
    if (subLook) {
      assert.ok(subLook.o >= 0.8, tf + ': the finer lines are dark enough: ' + JSON.stringify(subLook));
      assert.ok(plain.length && subLook.w < Math.min(...plain.map(x => x.w)), tf + ': finer lines thinner than the Daily lines: ' + JSON.stringify({ subLook, plain }));
    }
    // Zoom the price scale in until the finer steps have room for labels.
    for (let i = 0; i < 6 && !(await sub()).length; i++) {
      // The grip is rebuilt with every repaint: re-measure until it is back.
      let g = null;
      for (let k = 0; k < 40 && !g; k++) { g = await page.locator('#chartFull .reel-ygrip').boundingBox({ timeout: 1000 }).catch(() => null); if (!g) await page.waitForTimeout(50); }
      assert.ok(g, tf + ': price-axis grip is on screen');
      await page.mouse.move(g.x + g.width / 2, g.y + g.height * .55); await page.mouse.down();
      await page.mouse.move(g.x + g.width / 2, g.y + g.height * .55 - 160, { steps: 8 }); await page.mouse.up();
    }
    const m = await main(), s = await sub();
    assert.ok(m.length && m.every(t => /^-?\d+(\.\d+)?%$/.test(t) && Math.abs(parseFloat(t) / 10 - Math.round(parseFloat(t) / 10)) < 1e-6),
      tf + ': the big labels are the Daily 10% lines: ' + m.join(' '));
    // Big (Daily) and small (finer) labels are told apart by size and colour.
    const look = await page.evaluate(() => { const st = q => { const e = document.querySelector('#chartFull ' + q); if (!e) return null; const c = getComputedStyle(e); return { size: parseFloat(c.fontSize), fill: c.fill }; };
      return { big: st('.reel-ladder-lbl'), small: st('.reel-ladder-sublbl') }; });
    assert.ok(look.small && look.big && look.small.size < look.big.size && look.small.fill !== look.big.fill, tf + ': small grey vs big black labels: ' + JSON.stringify(look));
    assert.ok(await subLines() > 0, tf + ': the Daily gaps are subdivided');
    assert.ok(s.length && s.every(t => /^-?\d+(\.\d+)?%$/.test(t)), tf + ': finer steps carry small plain labels: ' + s.join(' '));
    // Every small label sits on this timeframe's step between two Daily 10%
    // lines: 1H every 2.5% (each gap in four), 4H every 5% (each gap in two).
    const stepPct = tf === '1H' ? 2.5 : 5;
    assert.ok(s.every(t => { const v = parseFloat(t); return Math.abs(v / stepPct - Math.round(v / stepPct)) < 1e-6 && Math.abs(v / 10 - Math.round(v / 10)) > 1e-6; }),
      tf + ': small labels are the ' + stepPct + '% steps: ' + s.join(' '));
    if (tf === '4H') assert.ok(s.every(t => Math.abs(parseFloat(t) % 10) === 5), '4H shows none of the in-between 1H 2.5% steps: ' + s.join(' '));
    if (tf === '1H') assert.ok(s.some(t => /\.5%$/.test(t)), '1H shows the 2.5% steps (2.5, 7.5…): ' + s.join(' '));
    await close();
  }
  console.log('PASS: Daily ladder subdivided on 1H/4H with big Daily and small grey labels');
};
