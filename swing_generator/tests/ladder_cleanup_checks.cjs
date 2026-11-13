const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// One-time ladder cleanup (user, 2026-11-03): ladders drawn on their own on
// 1H/4H are deleted, Daily ladders that were never linked are linked and
// shown on 1H (4H removed permanently 2026-11-07), and everything else
// is left alone. Runs in a fresh
// browser context so it starts from a device that has old drawings saved.
module.exports = async function checkLadderCleanup(page) {
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
  const lad = (p1, extra) => ({ kind: 'ladder', p1, p4: p1 + 30, ...extra });
  // A ladder drawn on Monthly (home 'M', 2026-11-13), shown on Daily and with
  // its 1H chip on: none of the Daily passes may touch it.
  const mon = () => lad(90, { link: 'Lmon', home: 'M', tfs: ['1H', 'D', 'M'], strokeWeight: 2 });
  // Old ladders on Monthly without `home` (2026-11-13, "all the old ladders
  // to go"): one unlinked, one linked to Weekly, one linked to Daily too.
  const seed = {
    TEST: {
      M: [mon(), lad(20, { link: 'Lkeep', tfs: ['D', '1H', '4H'], strokeWeight: 2 }), lad(100), lad(110, { link: 'Lmw', tfs: ['W', 'M'] }), lad(120, { link: 'Ldm', tfs: ['D', 'M'] })],
      W: [lad(110, { link: 'Lmw', tfs: ['W', 'M'] })],
      D: [lad(10, { strokeWeight: 1 }), lad(20, { link: 'Lkeep', tfs: ['D', '1H', '4H'], strokeWeight: 2 }), lad(30, { link: 'Ldonly', tfs: ['D'] }),
          lad(80, { link: 'Loff', tfs: ['D'], strokeWeight: 2, dashOff: true }), mon(), lad(120, { link: 'Ldm', tfs: ['D', 'M'] })],
      '1H': [lad(40), lad(50, { link: 'Lh', tfs: ['1H', '4H'] }), lad(20, { link: 'Lkeep', tfs: ['D', '1H', '4H'], strokeWeight: 2 }), mon(),
             { kind: 'trend', t1: '2026-01-01', p1: 1, t2: '2026-02-01', p2: 2 }],
      '4H': [lad(60), lad(50, { link: 'Lh', tfs: ['1H', '4H'] }), lad(20, { link: 'Lkeep', tfs: ['D', '1H', '4H'] })],
    },
  };
  await p.addInitScript(s => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('sp-channels', JSON.stringify(s));
  }, seed);
  await p.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
  await p.waitForFunction(() => localStorage.getItem('sp-ladder-cleanup-2026-11-03') && localStorage.getItem('sp-ladder-no4h-2026-11-07') && localStorage.getItem('sp-ladder-thick-2026-11-05') && localStorage.getItem('sp-ladder-dash-2026-11-07') && localStorage.getItem('sp-ladder-oldm-2026-11-13'), null, { timeout: 60000 });
  const got = await p.evaluate(() => JSON.parse(localStorage.getItem('sp-channels') || '{}').TEST || {});
  // A Daily ladder's copy stored in the Monthly list (every linked drawing
  // has one) does not make it a Monthly ladder: it is kept.
  assert.ok((got.D || []).some(x => x.link === 'Lkeep'), 'a Daily ladder not shown on Monthly is kept');
  // Every old ladder on Monthly is gone, with its linked copies.
  for (const tf of ['M', 'W', 'D', '1H'])
    assert.ok(!(got[tf] || []).some(x => x.kind === 'ladder' && [100, 110, 120].includes(x.p1)),
      tf + ': old Monthly ladders deleted everywhere: ' + JSON.stringify((got[tf] || []).filter(x => x.kind === 'ladder')));
  const ladders = tf => (got[tf] || []).filter(d => d.kind === 'ladder' && d.home !== 'M');
  for (const tf of ['M', 'D', '1H']) {
    const m = (got[tf] || []).filter(x => x.kind === 'ladder' && x.link === 'Lmon');
    assert.ok(m.length === 1 && !m[0].dash && m[0].strokeWeight === 2 && m[0].tfs.join() === '1H,D,W,M',
      tf + ': a Monthly ladder is kept (not Thick, not dashed; Weekly added 2026-11-13): ' + JSON.stringify(m));
  }
  const d = ladders('D');
  assert.equal(d.length, 4, 'no Daily ladder is deleted (but the one on Monthly too): ' + JSON.stringify(d));
  const was = d.find(x => x.p1 === 10);
  assert.ok(was.link && ['D', '1H'].every(t => was.tfs.includes(t)) && !was.tfs.includes('4H'), 'an unlinked Daily ladder now shows on Daily and 1H, not 4H: ' + JSON.stringify(was));
  // 4H removed permanently (2026-11-07): no Daily ladder lists 4H any more,
  // on any stored copy, including one that was on 4H before.
  for (const tf of ['D', '1H', '4H'])
    assert.ok(ladders(tf).filter(x => x.link && x.tfs.includes('D')).every(x => !x.tfs.includes('4H')), tf + ': no Daily ladder is on 4H: ' + JSON.stringify(ladders(tf)));
  assert.deepEqual(d.find(x => x.p1 === 20).tfs, ['D', '1H'], 'a Daily ladder that was on 1H and 4H keeps 1H only');
  assert.deepEqual(d.find(x => x.p1 === 30).tfs, ['D'], 'a Daily ladder whose 1H/4H were switched off stays that way');
  for (const tf of ['1H', '4H']) {
    const l = ladders(tf);
    assert.ok(l.every(x => x.link && x.tfs.includes('D')), tf + ': only Daily ladders remain: ' + JSON.stringify(l));
    // 1H holds the Daily ladders' copies.
    if (tf === '1H') assert.ok(l.some(x => x.link === 'Lkeep') && l.some(x => x.link === was.link), tf + ': Daily ladders are there: ' + JSON.stringify(l));
  }
  assert.equal((got['1H'] || []).filter(x => x.kind === 'trend').length, 1, 'other drawings are untouched');
  // Daily ladders on Thick (2026-11-05), then dashed and Thin (2026-11-07),
  // on Daily and on their 1H copies; one set back to dotted
  // (`dashOff`) is left dotted, on the Thick the first pass gave it.
  const off = x => x.dashOff;
  for (const tf of ['D', '1H'])
    assert.ok(ladders(tf).filter(x => !off(x)).length && ladders(tf).filter(x => !off(x)).every(x => x.dash === true && x.strokeWeight === 1),
      tf + ': every Daily ladder is dashed and Thin: ' + JSON.stringify(ladders(tf)));
  const kept = d.find(x => x.p1 === 80);
  assert.ok(!kept.dash && kept.strokeWeight === 3, 'a ladder set back to dotted stays dotted: ' + JSON.stringify(kept));
  // Once only: a ladder drawn on 1H after the cleanup survives a reload.
  await p.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('sp-channels'));
    all.TEST['1H'].push({ kind: 'ladder', p1: 70, p4: 100 });
    localStorage.setItem('sp-channels', JSON.stringify(all));
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const again = await p.evaluate(() => JSON.parse(localStorage.getItem('sp-channels')).TEST['1H']);
  assert.ok(again.some(x => x.kind === 'ladder' && x.p1 === 70), 'the cleanup runs once per device');
  const own = again.find(x => x.p1 === 70);
  assert.ok(!('strokeWeight' in own) && !own.dash, 'a ladder drawn on its own on 1H is not made Thick or dashed');
  assert.equal(errors.length, 0, errors.join('\n'));
  await context.close();
  console.log('PASS: one-time ladder cleanups (standalone 1H/4H ladders removed, Daily ladders on 1H, off 4H for good, on Thick, then dashed and Thin)');
};
