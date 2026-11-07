const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Resizing around zero (user, 2026-11-07: "I should be able to take it down
// and take it up without it moving on the 0% level ... when I try to make it
// big, it doesn't move because of the zero"). A ladder with a block below 0%
// whose bottom line rests on price 0: the scale dot and the 40% dot make it
// bigger and smaller with the bottom held on zero. Before, bigger was refused
// and smaller lifted the ladder off zero. Fresh context, seeded ladder.
module.exports = async function checkLadderZeroScale(page) {
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 } });
  const p = await context.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  const dataDir = path.resolve(__dirname, '../webapp/publish/browser-data');
  await p.route('**/ma500/**', async route => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.split('/ma500/')[1]);
    let body = fs.existsSync(path.join(dataDir, rel)) ? fs.readFileSync(path.join(dataDir, rel)) : Buffer.from('null');
    if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
    await route.fulfill({ contentType: 'application/json', body });
  });
  // 0% at 50, 5 a step, one block below (bottom at 0), one above (top 150).
  const seed = { TEST: { D: [{ kind: 'ladder', p1: 50, p4: 65, up: 1, down: 1, strokeWeight: 1, dash: true }] } };
  await p.addInitScript(s => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('sp-channels', JSON.stringify(s));
  }, seed);
  await p.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
  if (await p.locator('.up-skip').isVisible()) await p.locator('.up-skip').click();
  await p.locator('.nav-tab[data-tab="charts"]').click();
  await p.locator('#reelSearch').fill('TEST');
  await p.locator('#tfBtnD').click();
  const card = p.locator('.reel-card[data-name="TEST"]');
  await card.locator('.reel-chart svg').waitFor();
  await card.locator('[data-act="chart-expand"]').click();
  await p.locator('#chartFull .reel-chart svg').waitFor();
  await p.locator('#chartFull [data-act="channel"]').click();
  const ln = p.locator('#chartFull .reel-draw .reel-ladder').nth(3);
  const lb = await ln.boundingBox();
  await p.mouse.click(lb.x + lb.width * 0.8, lb.y + lb.height / 2);   // select it

  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('sp-channels')).TEST.D[0]);
  const step = d => (d.p4 - d.p1) / 3, bottom = d => d.p1 - 10 * step(d);
  const drag = async (sel, dy) => {
    const dot = p.locator(`#chartFull .reel-ch-h${sel}:not(.is-idle)`);
    assert.equal(await dot.count(), 1, 'dot on screen: ' + sel);
    const b = await dot.boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
    await p.mouse.move(x, y); await p.mouse.down();
    await p.mouse.move(x, y + dy, { steps: 6 }); await p.mouse.up();
  };
  for (const [sel, name] of [['[data-h^="ls:"]', 'scale dot'], ['[data-h="l4"]', '40% dot']]) {
    let before = await st();
    await drag(sel, -60);
    let after = await st();
    assert.ok(step(after) > step(before) + 1e-6, name + ': bigger works: ' + step(before) + ' -> ' + step(after));
    assert.ok(Math.abs(bottom(after)) < 1e-6, name + ': bigger keeps the bottom on zero: ' + bottom(after));
    before = after;
    await drag(sel, +60);
    after = await st();
    assert.ok(step(after) < step(before) - 1e-6, name + ': smaller works: ' + step(before) + ' -> ' + step(after));
    assert.ok(Math.abs(bottom(after)) < 1e-6, name + ': smaller keeps the bottom on zero: ' + bottom(after));
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  await context.close();
  console.log('PASS: a ladder resting on zero resizes around zero (bigger and smaller, scale dot and 40% dot)');
};
