const assert = require('node:assert/strict');
const openChart = require('./chart_open.cjs');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// A new ladder lands on screen however many linked drawings the chart keeps
// out of sight (user, 2026-11-26: "Ladder not able to be placed on us500
// monthly chart"). Every linked drawing has a copy in every timeframe's list;
// channelAdd counted them all and moved a new ladder 12% of the scale lower
// for each. The scale stretches to take in a drawing off screen, but no
// ladder line is drawn below price 0: on US500 (lows of 4.4 in 1927) about
// eight unseen copies were enough to put every line there, and nothing
// appeared. TEST trades 69 to 131, so it takes 25 here. A ladder left
// wholly below zero by that is deleted once, with its linked copies; others
// are kept.
module.exports = async function checkLadderOffset(page) {
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
  // 25 Daily ladders (shown on Daily and 1H, copies in the Monthly list),
  // and one Monthly ladder already saved below zero by the old offset.
  const daily = [...Array(25)].map((_, i) => ({ kind: 'ladder', p1: 90 + i, p4: 95 + i, link: 'Lday' + i, tfs: ['D', '1H'], strokeWeight: 2 }));
  const ghost = { kind: 'ladder', p1: -900, p4: -800, link: 'Lghost', home: 'M', tfs: ['1H', 'D', 'M'], strokeWeight: 2 };
  const list = () => [...daily.map(d => ({ ...d })), { ...ghost }];
  await p.addInitScript(s => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('sp-channels', JSON.stringify(s));
  }, { TEST: { M: list(), D: list(), '1H': list() } });
  await p.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
  if (await p.locator('.up-skip').isVisible().catch(() => false)) await p.locator('.up-skip').click();
  await p.waitForFunction(() => localStorage.getItem('sp-ladder-subzero-2026-11-26'), null, { timeout: 60000 });
  const saved = () => p.evaluate(() => {
    const a = JSON.parse(localStorage.getItem('sp-channels') || '{}').TEST || {};
    return Object.fromEntries(['M', 'D', '1H'].map(tf => [tf, (a[tf] || []).filter(d => d && d.kind === 'ladder')]));
  });
  let s = await saved();
  assert.deepEqual(['M', 'D', '1H'].map(tf => s[tf].filter(d => d.link === 'Lghost').length), [0, 0, 0], 'the ladder wholly below zero is deleted on every timeframe');
  assert.deepEqual(['M', 'D', '1H'].map(tf => s[tf].filter(d => /^Lday/.test(d.link)).length), [25, 25, 25], 'the Daily ladders are kept');

  await openChart(p, 'TEST', 'M');
  assert.equal(await p.locator('#chartFull .reel-draw .reel-ladder').count(), 0, 'Monthly shows none of the Daily ladders');
  await p.locator('#chartFull [data-act="channel"]').click();
  await p.locator('#chartFull .reel-toolbar [data-kind="ladder"]').click();
  s = await saved();
  const mine = s.M.filter(d => d.home === 'M');
  assert.equal(mine.length, 1, 'one new Monthly ladder saved');
  const lines = await p.locator('#chartFull .reel-draw .reel-ladder').count();
  assert.ok(lines >= 6, 'the new ladder is on screen: ' + lines + ' lines, ' + JSON.stringify({ p1: mine[0].p1, p4: mine[0].p4 }));
  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS: a new ladder lands on screen past unseen linked copies; ladders below zero cleared');
};
