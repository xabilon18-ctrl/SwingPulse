const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// One-time ladder cleanup (user, 2026-11-03): ladders drawn on their own on
// 1H/4H are deleted, Daily ladders that were never linked are linked and
// shown on 1H and 4H, and everything else is left alone. Runs in a fresh
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
  const seed = {
    TEST: {
      D: [lad(10), lad(20, { link: 'Lkeep', tfs: ['D', '1H', '4H'] }), lad(30, { link: 'Ldonly', tfs: ['D'] })],
      '1H': [lad(40), lad(50, { link: 'Lh', tfs: ['1H', '4H'] }), lad(20, { link: 'Lkeep', tfs: ['D', '1H', '4H'] }),
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
  await p.waitForFunction(() => localStorage.getItem('sp-ladder-cleanup-2026-11-03'), null, { timeout: 60000 });
  const got = await p.evaluate(() => JSON.parse(localStorage.getItem('sp-channels') || '{}').TEST || {});
  const ladders = tf => (got[tf] || []).filter(d => d.kind === 'ladder');
  const d = ladders('D');
  assert.equal(d.length, 3, 'no Daily ladder is deleted: ' + JSON.stringify(d));
  const was = d.find(x => x.p1 === 10);
  assert.ok(was.link && ['D', '1H', '4H'].every(t => was.tfs.includes(t)), 'an unlinked Daily ladder now shows on Daily, 1H and 4H: ' + JSON.stringify(was));
  assert.deepEqual(d.find(x => x.p1 === 30).tfs, ['D'], 'a Daily ladder whose 1H/4H were switched off stays that way');
  for (const tf of ['1H', '4H']) {
    const l = ladders(tf);
    assert.ok(l.every(x => x.link && x.tfs.includes('D')), tf + ': only Daily ladders remain: ' + JSON.stringify(l));
    assert.ok(l.some(x => x.link === 'Lkeep') && l.some(x => x.link === was.link), tf + ': Daily ladders are there: ' + JSON.stringify(l));
  }
  assert.equal((got['1H'] || []).filter(x => x.kind === 'trend').length, 1, 'other drawings are untouched');
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
  assert.equal(errors.length, 0, errors.join('\n'));
  await context.close();
  console.log('PASS: one-time ladder cleanup (standalone 1H/4H ladders removed, Daily ladders on 1H/4H)');
};
