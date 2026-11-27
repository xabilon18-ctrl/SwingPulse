const assert = require('node:assert/strict');
const openChart = require('./chart_open.cjs');
const { fixturePage } = require('./chart_autoplay_checks.cjs');

// A ladder zoomed in between two of its 10% lines still shows (user,
// 2026-11-20: "the ladder lines sometimes on the 1h they do not show then on
// pinching the price in that's when they show"). On 1H only the finer split
// lines can be on screen; the whole ladder used to give way to the off-scale
// tag until a 10% line came back into view.
module.exports = async function checkLadderZoomedIn(page0) {
  // A linked Daily ladder with 10% lines at 0, 500, 1000 ...: on TEST's 1H
  // (price ~60-200) no 10% line is in view, only the fifths at 100 and 200.
  await page0.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('sp-channels') || '{}');
    const lad = { kind: 'ladder', p1: 0, p4: 1500, link: 'Lzoom', tfs: ['D', '1H'], made: '2026-11-20T00:00:00Z' };
    all.TEST = all.TEST || {};
    for (const tf of ['D', '1H']) all.TEST[tf] = [...(all.TEST[tf] || []).filter(d => !d || d.link !== 'Lzoom'), { ...lad }];
    localStorage.setItem('sp-channels', JSON.stringify(all));
  });
  const page = await fixturePage(page0);
  await openChart(page, 'TEST', '1H');
  const seen = await page.evaluate(() => {
    const g = [...document.querySelectorAll('#chartFull .reel-draw')].find(x => x.querySelector('.reel-ladder-sub, .reel-clip-tag'));
    const ctx = document.querySelector('#chartFull .reel-chart')._reelCtx;
    return { lo: ctx.sc.lo, hi: ctx.sc.hi, sub: g ? g.querySelectorAll('.reel-ladder-sub').length : 0,
      main: g ? g.querySelectorAll('.reel-ladder:not(.reel-ladder-sub)').length : 0,
      offScale: [...document.querySelectorAll('#chartFull .reel-clip-tag')].map(e => e.textContent) };
  });
  assert.ok(seen.hi < 500, 'no 10% line is on screen: ' + JSON.stringify(seen));
  assert.equal(seen.main, 0, 'no 10% line drawn: ' + JSON.stringify(seen));
  assert.ok(seen.sub > 0, 'the split lines in view are drawn: ' + JSON.stringify(seen));
  assert.ok(!seen.offScale.some(t => /ladder/.test(t)), 'no "ladder off-scale" tag while its lines are on screen: ' + JSON.stringify(seen));
  await page.close();
  await page0.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('sp-channels') || '{}');
    for (const tf of ['D', '1H']) if (all.TEST && all.TEST[tf]) all.TEST[tf] = all.TEST[tf].filter(d => !d || d.link !== 'Lzoom');
    localStorage.setItem('sp-channels', JSON.stringify(all));
  });
  console.log('PASS: a ladder zoomed in between its 10% lines still draws its split lines on 1H');
};
