const assert = require('node:assert/strict');

// The scale dot near the price (user, 2026-11-03, USDX trading near its
// ladder's 200% line): a third round dot on the ladder line nearest the last
// close. Dragging it re-spaces the ladder with 0% held, so that line follows
// the finger, without zooming out to the 0% and 40% dots.
module.exports = async function checkLadderScaleDot(page, name = 'TEST') {
  await page.locator('.nav-tab[data-tab="charts"]').click();
  await page.locator('#reelSearch').fill(name);
  const card = page.locator('.reel-card[data-name="' + name + '"]');
  await page.locator('#tfBtnD').click();
  await card.locator('.reel-chart svg').waitFor();
  await card.locator('[data-act="chart-expand"]').click();
  await page.locator('#chartFull .reel-chart svg').waitFor();
  await page.locator('#chartFull [data-act="channel"]').click();
  await page.locator('#chartFull .reel-toolbar [data-kind="ladder"]').click();

  const stored = () => page.evaluate(n => {
    const all = JSON.parse(localStorage.getItem('sp-channels') || '{}');
    return ((all[n] && all[n].D) || []).filter(d => d && d.kind === 'ladder').pop();
  }, name);
  const dot = page.locator('#chartFull .reel-ch-h[data-h^="ls:"]:not(.is-idle)');
  assert.equal(await dot.count(), 1, 'a scale dot sits near the price');
  const k = +(await dot.getAttribute('data-h')).slice(3);
  // Shown from two stored steps past the 37.5% dot (Daily lines every 12.5%).
  assert.ok(k >= 5.75, 'the scale dot is on a line at 57.5% or up here: ' + k);

  const before = await stored();
  const box = await dot.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x, y - 40, { steps: 6 });
  // Mid-drag the dot stays on the same line, even though another line is
  // now nearer the price.
  assert.equal(await page.locator('#chartFull .reel-ch-h[data-h="ls:' + k + '"]').count(), 1, 'the dot keeps its line while dragging');
  await page.mouse.move(x, y - 80, { steps: 6 });
  await page.mouse.up();

  const after = await stored();
  assert.ok(Math.abs(after.p1 - before.p1) < 1e-9, '0% stays put: ' + before.p1 + ' -> ' + after.p1);
  const s0 = (before.p4 - before.p1) / 3, s1 = (after.p4 - after.p1) / 3;
  assert.ok(s1 > s0, 'dragging the line up widens the spacing: ' + s0 + ' -> ' + s1);
  // The dragged line ended under the finger.
  const fingerPrice = await page.evaluate(([fy]) => {
    const svg = document.querySelector('#chartFull .reel-chart svg');
    const pt = svg.createSVGPoint(); pt.x = 0; pt.y = fy;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    const host = svg.closest('.reel-chart');
    const ctx = host && host._reelCtx;
    return ctx ? ctx.sc.inv(p.y) : null;
  }, [y - 80]);
  assert.ok(fingerPrice != null, 'chart scale readable');
  const lineAt = after.p1 + k * s1;
  assert.ok(Math.abs(lineAt - fingerPrice) / Math.abs(fingerPrice) < 0.02, 'the dragged line follows the finger: ' + lineAt + ' vs ' + fingerPrice);
  await page.locator('#chartFull [data-act="channel"]').click();
  await page.locator('#chartFull [data-act="chart-full-close"]').click();
  console.log('PASS: ladder scale dot near the price re-spaces the ladder with 0% held');
};
