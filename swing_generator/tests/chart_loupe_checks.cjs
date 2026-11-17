const assert = require('node:assert/strict');
const { fixturePage } = require('./chart_autoplay_checks.cjs');

// Magnifier on long press (user, 2026-11-17): holding a finger still on the
// full-screen chart opens a round lens above it that follows the finger, with
// the price and date under the fingertip. The chart does not pan meanwhile,
// and letting go removes it. A quick drag still pans, with no lens.
module.exports = async function checkChartLoupe(page0, live = false) {
  const page = live ? page0 : await fixturePage(page0);
  await page.locator('.nav-tab[data-tab="charts"]').click();
  await page.locator('#reelSearch').fill('');
  await page.locator('#chartReel .reel-card').first().locator('[data-act="chart-expand"]').click();
  await page.locator('#chartFull .reel-chart svg.reel-svg').waitFor();
  const host = page.locator('#chartFull .reel-chart');
  const box = await host.boundingBox();
  const lens = page.locator('#chartFull .reel-loupe');
  const frame = () => page.evaluate(() => { const c = document.querySelector('#chartFull .reel-chart')._reelCtx; return JSON.stringify([c.sc.lo, c.sc.hi, c.bw, c.b._from, c.b.t && c.b.t[0], c.b.c && c.b.c.length]); });
  const x = box.x + box.width * 0.45, y = box.y + box.height * 0.6;

  const f0 = await frame();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await lens.waitFor({ timeout: 2000 });
  const at0 = await lens.boundingBox();
  assert.ok(at0.width >= 190, 'the lens is 190px across: ' + at0.width);
  assert.ok(at0.y + at0.height < y, 'the lens sits above the finger: ' + JSON.stringify({ lens: at0, y }));
  assert.match(await lens.locator('.reel-loupe-read').innerText(), /\d/, 'it reads the price under the finger');
  assert.equal(await lens.locator('svg').count(), 1, 'it shows a copy of the chart');
  // Right and down: a 190px lens clamped at the chart's left edge would not
  // follow a move to the left from here.
  await page.mouse.move(x + 60, y + 40, { steps: 6 });
  const at1 = await lens.boundingBox();
  assert.ok(Math.abs((at1.x - at0.x) - 60) < 2 && Math.abs((at1.y - at0.y) - 40) < 2, 'it follows the finger: ' + JSON.stringify({ at0, at1 }));
  assert.equal(await frame(), f0, 'the chart does not pan under the lens');
  await page.mouse.up();
  assert.equal(await lens.count(), 0, 'letting go removes it');
  assert.equal(await page.locator('#chartFull.open').count(), 1, 'full screen stays open');

  // A quick drag is still a pan, with no lens.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 120, y, { steps: 6 });
  await page.waitForTimeout(700);
  assert.equal(await lens.count(), 0, 'no lens on a drag');
  await page.mouse.up();
  assert.notEqual(await frame(), f0, 'the drag panned the chart');
  if (!live) await page.close();
  console.log('PASS: long-press magnifier follows the finger, reads price and date, no pan; a drag still pans');
};
