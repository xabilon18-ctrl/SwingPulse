const assert = require('node:assert/strict');
const openChart = require('./chart_open.cjs');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Yearly ladders chain down like Monthly ones (user, 2026-11-26: "I've just
// placed a yearly chart, which should show daily and hourly. I can't see the
// divisions on the daily"): a ladder drawn on Yearly is `home: 'Y'`, shown on
// Yearly, Monthly, Daily and 1H, each 10% gap split in two on Monthly, four on
// Daily and ten on 1H (user, same day: "10% yearly is divided by 2 on
// monthly and 4 on daily", then "Make 1h by 10"). A
// Yearly ladder drawn before (unlinked, no home) is linked once per device.
// Fresh context: it starts from a device with that old ladder saved.
// { ccy: true }: TEST is served as a currency (group Currency), where a
// Yearly ladder takes the CURRENCY set (user, 2026-11-27: "10% yearly -
// M/3, D/6, H/12", then 1H by 18 the same day).
module.exports = async function checkLadderYearly(page, { ccy = false } = {}) {
  const parts = ccy ? { M: 3, D: 6, '1H': 18 } : { M: 2, D: 4, '1H': 10 };
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 } });
  const p = await context.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  const dataDir = path.resolve(__dirname, '../webapp/publish/browser-data');
  await p.route('**/ma500/**', async route => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.split('/ma500/')[1]);
    let body = fs.existsSync(path.join(dataDir, rel)) ? fs.readFileSync(path.join(dataDir, rel)) : Buffer.from('null');
    if (body[0] === 0x1f && body[1] === 0x8b) body = zlib.gunzipSync(body);
    if (ccy && rel === 'signals.json') {
      const j = JSON.parse(body);
      for (const r of j.data || []) if (r.instrument_name === 'TEST') Object.assign(r, { group: 'Currency', sector: 'Currency', asset_class: 'Currency' });
      body = JSON.stringify(j);
    }
    await route.fulfill({ contentType: 'application/json', body });
  });
  // An old Yearly ladder: 0% at 90, a 10% gap of 5 (p4 is the 30% line).
  await p.addInitScript(s => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('sp-channels', JSON.stringify(s));
  }, { TEST: { Y: [{ kind: 'ladder', p1: 90, p4: 105, strokeWeight: 2 }] } });
  await p.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
  await p.waitForFunction(() => localStorage.getItem('sp-ladder-yearly-2026-11-26'), null, { timeout: 60000 });
  const stored = () => p.evaluate(() => JSON.parse(localStorage.getItem('sp-channels') || '{}').TEST || {});
  let got = await stored();
  for (const tf of ['Y', 'M', 'D', '1H']) {
    const l = (got[tf] || []).filter(d => d && d.kind === 'ladder');
    assert.ok(l.length === 1 && l[0].home === 'Y' && l[0].link && ['Y', 'M', 'D', '1H'].every(t => l[0].tfs.includes(t)),
      tf + ': the old Yearly ladder is linked and shown on Yearly, Monthly, Daily and 1H: ' + JSON.stringify(got[tf]));
  }

  if (await p.locator('.up-skip').isVisible().catch(() => false)) await p.locator('.up-skip').click();
  const openFull = tf => openChart(p, 'TEST', tf);
  const close = () => p.locator('#chartFull [data-act="chart-full-close"]').click();
  // Lines between the two lowest neighbouring 10% lines in view.
  const between = () => p.evaluate(() => {
    const y = e => +e.getAttribute('y1');
    const own = [...document.querySelectorAll('#chartFull .reel-draw .reel-ladder.reel-ladder-daily')].map(y).sort((a, b) => a - b);
    const sub = [...document.querySelectorAll('#chartFull .reel-draw .reel-ladder-sub')].map(y);
    if (own.length < 2) return { own: own.length, n: -1 };
    const a = own[own.length - 2], z = own[own.length - 1];
    return { own: own.length, n: sub.filter(v => v > a + 0.5 && v < z - 0.5).length, sub: sub.length };
  });
  await openFull('Y');
  assert.equal(await p.locator('#chartFull .reel-draw .reel-ladder-sub').count(), 0, 'Yearly itself shows no split lines');
  await close();
  // Each timeframe's ladder is sized to that chart's window (a 10% gap is 60%
  // of it, two 10% lines in view) so its finest split has room to draw (lines
  // closer than LADDER_SUB_LINE_MIN are not drawn); the split does not depend
  // on the size.
  const fitTo = async tf => {
    await openFull(tf);
    const win = await p.evaluate(() => { const h = [...document.querySelectorAll('#chartFull *')].find(e => e._reelCtx); return h && { lo: h._reelCtx.sc.lo, hi: h._reelCtx.sc.hi }; });
    assert.ok(win && win.hi > win.lo, tf + ': price window found: ' + JSON.stringify(win));
    await close();
    await p.evaluate(w => {
      const all = JSON.parse(localStorage.getItem('sp-channels') || '{}');
      for (const list of Object.values(all.TEST || {}))
        for (const x of list || []) if (x && x.kind === 'ladder' && x.home === 'Y') { x.p1 = w.lo + (w.hi - w.lo) * 0.1; x.p4 = x.p1 + (w.hi - w.lo) * 1.8; }
      localStorage.setItem('sp-channels', JSON.stringify(all));
    }, win);
    await p.reload({ waitUntil: 'networkidle' });
    if (await p.locator('.up-skip').isVisible().catch(() => false)) await p.locator('.up-skip').click();
  };
  for (const tf of ['M', 'D', '1H']) {
    await fitTo(tf);
    await openFull(tf);
    const b = await between();
    assert.equal(b.n, parts[tf] - 1, `${tf}: each Yearly 10% gap is split in ${parts[tf]}${ccy ? ' (currency)' : ''}: ` + JSON.stringify(b));
    await close();
  }
  // A ladder drawn on Yearly now is a Yearly ladder.
  await openFull('Y');
  await p.locator('#chartFull [data-act="channel"]').click();
  await p.locator('#chartFull .reel-toolbar [data-kind="ladder"]').click();
  got = await stored();
  const fresh = (got.Y || []).filter(d => d && d.kind === 'ladder' && d.made);
  assert.ok(fresh.length === 1 && fresh[0].home === 'Y' && fresh[0].link && fresh[0].tfs.join() === ['1H', 'D', 'M', 'Y'].filter(t => fresh[0].tfs.includes(t)).join() && fresh[0].tfs.length === 4,
    'a new Yearly ladder is home Y on Yearly, Monthly, Daily and 1H: ' + JSON.stringify(fresh));
  assert.ok((got.D || []).some(d => d && d.link === fresh[0].link), 'its copy is on Daily');
  assert.deepEqual(errors, []);
  await context.close();
  console.log(ccy ? 'PASS: Yearly ladders on a currency split in 3 on Monthly, 6 on Daily, 18 on 1H'
                  : 'PASS: Yearly ladders split in 2 on Monthly, 4 on Daily, 10 on 1H; old ones linked once');
};
