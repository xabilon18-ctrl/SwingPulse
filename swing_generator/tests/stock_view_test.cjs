// Opening views on every market (2026-10-22): 1H months, 4H quarters, Daily years; W/M terms.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const geometry = require('../webapp/static/js/modules/grid-geometry.js');
const source = fs.readFileSync(path.join(__dirname, '../webapp/static/js/app.js'), 'utf8');
const fn = name => {
  const a = source.indexOf(`  function ${name}(`);
  return source.slice(a, source.indexOf('\n  }\n', a) + 4);
};
const bt = b => b._bt || (b._bt = b.t.map(Date.parse));
const ctx = vm.createContext({
  timeframe: '1H', reel: { range: null }, REEL_MIN_WINDOW_BARS: 20, REEL_FUTURE_FRAC: 0.9,
  window: { SwingPulseModules: { gridGeometry: geometry } }, reelBarTimes: bt,
  instrumentByName: name => ({ STOCK: 'stocks', BTC: 'crypto', IDX: 'indices', EUR: 'other', FX: 'fx' }[name]),
  reelGridScope: scope => scope,
  assetClassOf: scope => ({ crypto: 'Crypto', fx: 'Currency' }[scope] || 'Other'),
});
const table = name => { const a = source.indexOf(`  const ${name} = {`); return source.slice(a, source.indexOf('  };\n', a) + 5).replace('const ', 'var '); };
vm.runInContext('var REEL_SESSION_HOURS = 16; var reelPerDayCache = new WeakMap(); var OV_TF_MS = { \'1H\': 36e5, \'2H\': 72e5, \'4H\': 144e5, D: 864e5 };' + table('REEL_SLOW_VIEW') + table('REEL_FRAME_VIEW') + fn('reelBarsPerDay') + fn('reelSessionOnly') + fn('reelOpenSpec') + fn('reelStockView'), ctx);

const hourly = (from, to, hours) => {
  const t = [];
  for (let d = from; d <= to; d += 864e5) {
    if ([0, 6].includes(new Date(d).getUTCDay())) continue;
    hours.forEach(h => t.push(new Date(d + h * 36e5).toISOString()));
  }
  return { t, c: t.map(() => 1) };
};
const hours = [13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5];
// The grid's months and quarters are equal parts of the year, so a line can
// fall a day either side of the calendar date.
const near = (iso, day) => Math.abs(Date.parse(iso) - Date.parse(day)) < 2.5 * 864e5;
// 1H, every market (2026-10-22): previous + current MONTH. Six months of 1H
// bars to mid-October: 7 a weekday on a stock, 9 on a European index, 24 round
// the clock.
const round = [];
for (let ms = Date.UTC(2026, 3, 17); ms <= Date.UTC(2026, 9, 17, 18); ms += 36e5) round.push(new Date(ms).toISOString());
for (const [market, b1] of [['STOCK', hourly(Date.UTC(2026, 3, 17), Date.UTC(2026, 9, 16), hours)],
  ['IDX', hourly(Date.UTC(2026, 3, 20), Date.UTC(2026, 9, 16), [8, 9, 10, 11, 12, 13, 14, 15, 16])],
  ['BTC', { t: round, c: round.map(() => 1) }], ['FX', { t: round, c: round.map(() => 1) }],
  ['EUR', { t: round, c: round.map(() => 1) }]]) {
  const v1 = ctx.reelStockView(b1, market);
  const f1 = b1.t.length - (v1.bars - v1.future);
  assert.ok(near(b1.t[f1], '2026-09-01'), market + ' ' + b1.t[f1]);
  // The window ends on the November line, the grid's own: its slot is the last one.
  const lines = geometry.timeGrid(b1, '1H', { barTimes: bt, getDivision: () => ({ parts: 12, code: 'M' }) });
  const month = k => lines.find(l => l.year === 2026 && l.part === k);
  const nov = month(10), sep = month(8);
  assert.ok(nov.fi - f1 > v1.bars - 2 && nov.fi - f1 <= v1.bars, market + ' next month line at the right edge');
  assert.ok(sep.fi - f1 >= 0 && sep.fi - f1 < 1, market + ' previous month line at the left edge');
  assert.ok(v1.future > 0 && v1.future < v1.bars * 0.9, market);
  assert.equal(v1.fit, 'centre', market);
}
// A new month moves the frame on: on 5 Nov it is October and November.
const nv = hourly(Date.UTC(2026, 5, 1), Date.UTC(2026, 10, 5), hours);
const qn = ctx.reelStockView(nv, 'STOCK');
assert.ok(near(nv.t[nv.t.length - (qn.bars - qn.future)], '2026-10-01'));

// 4H, every market: previous + current quarter on a round-the-clock feed —
// six bars a day on crypto, five on a weekday futures feed.
ctx.timeframe = '4H';
const r4 = [];
for (let ms = Date.UTC(2025, 9, 18); ms <= Date.UTC(2026, 9, 17, 16); ms += 4 * 36e5) r4.push(new Date(ms).toISOString());
const span4 = (b4, market, startDay, years) => {
  const c4 = ctx.reelStockView(b4, market);
  const f4 = b4.t.length - (c4.bars - c4.future);
  assert.ok(near(b4.t[f4], startDay), market + ' ' + b4.t[f4]);
  const fr4 = geometry.yearFrame(b4, bt);
  assert.ok(Math.abs(f4 + c4.bars - 1 - (fr4.anchor + years * fr4.yearBars)) <= 1, market + ' ends on its line');
  assert.equal(c4.fit, 'all', market);
};
span4({ t: r4, c: r4.map(() => 1) }, 'BTC', '2026-07-01', 1);
span4(hourly(Date.UTC(2025, 9, 1), Date.UTC(2026, 9, 16), [0, 4, 8, 12, 16]), 'IDX', '2026-07-01', 1);
// A session-only feed (2026-10-24) — two bars a session on a US stock or SOX,
// three on a European index — takes the previous + current HALF-YEAR, so it
// carries about as many candles as the 24h feeds show in two quarters.
span4(hourly(Date.UTC(2025, 9, 1), Date.UTC(2026, 9, 16), [13.5, 17.5]), 'STOCK', '2026-01-01', 1);
span4(hourly(Date.UTC(2025, 9, 1), Date.UTC(2026, 9, 16), [8, 12, 16]), 'IDX', '2026-01-01', 1);
// In January it is H2 of last year plus H1 of this one on a session feed,
// Q4 plus Q1 round the clock.
const j4 = hourly(Date.UTC(2026, 0, 5), Date.UTC(2027, 0, 20), [13.5, 17.5]);
const k4 = ctx.reelStockView(j4, 'STOCK');
assert.ok(near(j4.t[j4.t.length - (k4.bars - k4.future)], '2026-07-01'));
const jr = [];
for (let ms = Date.UTC(2026, 0, 5); ms <= Date.UTC(2027, 0, 20); ms += 4 * 36e5) jr.push(new Date(ms).toISOString());
const kr = ctx.reelStockView({ t: jr, c: jr.map(() => 1) }, 'BTC');
assert.ok(near(jr[jr.length - (kr.bars - kr.future)], '2026-10-01'));
// 2H (back 2026-10-25): previous + current TWO-MONTH block round the clock
// (12 bars a day: Jul-Aug and Sep-Oct on 25 Oct, to the 1 Nov line),
// FOUR-MONTH blocks on a session feed (4 a day on a US stock, 5 on a European
// index: May-Aug and Sep-Dec, to the 1 Jan line).
ctx.timeframe = '2H';
const r2 = [];
for (let ms = Date.UTC(2025, 9, 25); ms <= Date.UTC(2026, 9, 24, 20); ms += 2 * 36e5) r2.push(new Date(ms).toISOString());
const span2 = (b2, market, startDay, endParts) => {
  const v2 = ctx.reelStockView(b2, market);
  const f2 = b2.t.length - (v2.bars - v2.future);
  // The first bar on or after the line: a weekend can sit between (1 May 2026 is a Friday).
  assert.ok(Math.abs(Date.parse(b2.t[f2]) - Date.parse(startDay)) < 4 * 864e5, market + ' ' + b2.t[f2]);
  const fr2 = geometry.yearFrame(b2, bt);
  assert.ok(Math.abs(f2 + v2.bars - 1 - (fr2.anchor + endParts * fr2.yearBars)) <= 1, market + ' ends on its line');
  assert.equal(v2.fit, 'centre', market);
};
span2({ t: r2, c: r2.map(() => 1) }, 'BTC', '2026-07-01', 10 / 12);                                  // Jul → 1 Nov
span2(hourly(Date.UTC(2025, 9, 1), Date.UTC(2026, 9, 23), [13.5, 15.5, 17.5, 19.5]), 'STOCK', '2026-05-01', 1); // May → 1 Jan
span2(hourly(Date.UTC(2025, 9, 1), Date.UTC(2026, 9, 23), [7, 9, 11, 13, 15]), 'IDX', '2026-05-01', 1);
// Daily, every market (2026-10-22): last year's line to two year lines ahead
// (2025 → 2028). Round the clock (crypto) and a session a weekday.
ctx.timeframe = 'D';
const rd = [];
for (let ms = Date.UTC(2021, 9, 1); ms <= Date.UTC(2026, 9, 16); ms += 864e5) rd.push(new Date(ms).toISOString());
const wd = hourly(Date.UTC(2021, 0, 4), Date.UTC(2026, 9, 16), [0]);
for (const [market, bd] of [['BTC', { t: rd, c: rd.map(() => 1) }], ['FX', { t: rd, c: rd.map(() => 1) }],
  ['EUR', { t: rd, c: rd.map(() => 1) }], ['STOCK', wd], ['IDX', wd]]) {
  delete bd._sv;
  const vd = ctx.reelStockView(bd, market);
  const fd = bd.t.length - (vd.bars - vd.future);
  assert.ok(near(bd.t[fd], '2025-01-01'), market + ' ' + bd.t[fd]);
  const frd = geometry.yearFrame(bd, bt);
  assert.ok(Math.abs(fd + vd.bars - 1 - (frd.anchor + 2 * frd.yearBars)) <= 1, market + ' ends on the 2028 line');
  assert.equal(vd.fit, 'all', market);
}
// A new year moves it on: in January 2027 it is 2026 to 2029.
const jd = hourly(Date.UTC(2022, 0, 3), Date.UTC(2027, 0, 15), [0]);
const vj = ctx.reelStockView(jd, 'STOCK');
assert.ok(near(jd.t[jd.t.length - (vj.bars - vj.future)], '2026-01-01'));
// Only these timeframes, only without a Range pill.
ctx.timeframe = '15m';
assert.equal(ctx.reelStockView(hourly(Date.UTC(2026, 3, 17), Date.UTC(2026, 9, 16), hours), 'STOCK'), null);

// Weekly and Monthly (2026-10-19): on every market, from week starts (Mondays)
// and month starts. Weekly opens on four terms, 2013 to 2029.
ctx.timeframe = 'W';
const wk = [];
for (let ms = Date.UTC(2006, 0, 2); ms <= Date.UTC(2026, 9, 12); ms += 7 * 864e5) wk.push(new Date(ms).toISOString().slice(0, 10));
for (const market of ['STOCK', 'BTC', 'EUR']) {
  const vw = ctx.reelStockView({ t: wk, c: wk.map(() => 1) }, market);
  assert.equal(wk[wk.length - (vw.bars - vw.future)], '2012-12-31', market);   // the week holding 1 Jan 2013
  assert.equal(vw.fit, 'all');
}
const vw = ctx.reelStockView({ t: wk, c: wk.map(() => 1) }, 'STOCK');
const frw = geometry.yearFrame({ t: wk }, bt);
assert.ok(Math.abs(wk.length - (vw.bars - vw.future) + vw.bars - 1 - (frw.anchor + 3 * frw.yearBars)) <= 1, 'Weekly ends on the 2029 line');
// Monthly opens on ALL its history, to the 2029 line.
ctx.timeframe = 'M';
const mo = [];
for (let y = 2006; y <= 2026; y++) for (let m = 0; m < 12 && (y < 2026 || m < 9); m++) mo.push(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10));
const vm1 = ctx.reelStockView({ t: mo, c: mo.map(() => 1) }, 'EUR');
assert.equal(mo[mo.length - (vm1.bars - vm1.future)], mo[0]);
const frm = geometry.yearFrame({ t: mo }, bt);
assert.ok(Math.abs(mo.length - (vm1.bars - vm1.future) + vm1.bars - 1 - (frm.anchor + 3 * frm.yearBars)) <= 1, 'Monthly ends on the 2029 line');
ctx.timeframe = '1H'; ctx.reel.range = 300;
assert.equal(ctx.reelStockView(hourly(Date.UTC(2026, 3, 17), Date.UTC(2026, 9, 16), hours), 'STOCK'), null);

// The overlay fit is capped: the frame grows to at most twice what the bars need.
const pw = vm.createContext({ REEL_OPENING_PRICE_FILL: 0.85, REEL_CENTRE_PRICE_FILL: 0.6, REEL_OV_FIT_CAP: 2, REEL_ALL_FIT_REACH: 2.5, REEL_ALL_FIT_PAD: 0.05 });
vm.runInContext(fn('reelOpeningPriceWindow'), pw);
const bars = { c: [100], l: [95], h: [105] };
const plain = pw.reelOpeningPriceWindow(bars);
const close = pw.reelOpeningPriceWindow(bars, { lo: 92, hi: 104 });
const far = pw.reelOpeningPriceWindow(bars, { lo: 62, hi: 104 });
assert.ok(close.lo < plain.lo && close.lo <= 92, 'a nearby MA is fitted');
assert.ok(Math.abs((far.hi - far.lo) - 2 * (plain.hi - plain.lo)) < 1e-9, 'a far MA stops at the cap');
assert.ok(far.lo > 62, 'the far MA is left off-screen');
// 1H 'centre', measured off the user's saved GOLD (close 4077, candles
// 4040-4520, scale 3280-4620): the close in the middle, the bars about a third
// of the height. It takes no overlay range at all (the caller passes none).
const gold = pw.reelOpeningPriceWindow({ c: [4077], l: [4040], h: [4520] }, null, 'centre');
assert.ok(Math.abs((gold.hi + gold.lo) / 2 - 4077) < 1e-9, JSON.stringify(gold));
const share = (4520 - 4040) / (gold.hi - gold.lo);
assert.ok(share > 0.3 && share < 0.4, String(share));
// 4H / Daily 'all': candles, MAs and drawings, 5% margin; a runaway line held to 2.5 ranges.
const btc4 = pw.reelOpeningPriceWindow({ c: [81377], l: [63000], h: [88000] }, { lo: 44000, hi: 141000 }, 'all');
assert.ok(Math.abs(btc4.lo - 39150) < 1 && Math.abs(btc4.hi - 145850) < 1, JSON.stringify(btc4));
const run = pw.reelOpeningPriceWindow({ c: [10], l: [9], h: [11] }, { lo: 9, hi: 1000 }, 'all');
assert.ok(Math.abs(run.hi - (16 + 7 * 0.05)) < 1e-9);
// Daily, off CHINA_NET: candles 21-41, a down channel reaching -12 in view —
// the channel sets the bottom; 0 is not forced onto the scale.
const net = pw.reelOpeningPriceWindow({ c: [23.74], l: [21], h: [41] }, { lo: -12, hi: 41 }, 'all');
assert.ok(Math.abs(net.lo - (-12 - 53 * 0.05)) < 1e-9 && Math.abs(net.hi - (41 + 53 * 0.05)) < 1e-9, JSON.stringify(net));
// Drawings: a channel's ends and edges, a ladder's whole stack (never below 0), a level.
const dw = vm.createContext({ REEL_EXTRAP_BARS: 250, LADDER_LINES: 11,
  ladderStack: (d, dir) => Math.max(0, Math.floor(Number(d[dir]) || 0)),
  reelParseTs: v => Date.parse(String(v).slice(0, 10) + 'T00:00:00Z'), reelBarTimes: bt, timeframe: '4H' });
vm.runInContext(fn('drawShownOn') + fn('reelBarIndexForDate') + fn('ladderKRange') + fn('reelDrawingRange'), dw);
const days = []; for (let i = 0; i < 100; i++) days.push(new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10));
const src = { t: days, c: days.map(() => 1) };
const ch = { kind: 'channel', t1: days[0], p1: 100, t2: days[10], p2: 110, up: 5, dn: -5 };
const r1 = dw.reelDrawingRange([ch], src, 0, 150);
assert.ok(Math.abs(r1.lo - 95) < 1e-9 && Math.abs(r1.hi - 255) < 1e-9, JSON.stringify(r1));
// Eleven lines, 0%..100%, starting FROM p1: p1 (0%) = 20 and p4 (30%) = 50 put 100% at 120.
const lad = { kind: 'ladder', p1: 20, p4: 50 };
assert.deepEqual(JSON.parse(JSON.stringify(dw.reelDrawingRange([lad], src, 0, 99))), { lo: 20, hi: 120 });
assert.deepEqual(JSON.parse(JSON.stringify(dw.reelDrawingRange([{ ...lad, up: 1, down: 1 }], src, 0, 99))), { lo: 0, hi: 220 });
assert.deepEqual(JSON.parse(JSON.stringify(dw.reelDrawingRange([lad, { kind: 'hline', p: 300 }], src, 0, 99))), { lo: 20, hi: 300 });
assert.equal(dw.reelDrawingRange([], src, 0, 99), null);
// A linked drawing switched off for this timeframe does not frame it.
assert.deepEqual(JSON.parse(JSON.stringify(dw.reelDrawingRange([lad, { kind: 'hline', p: 300, link: 'L1', tfs: ['1H'] }], src, 0, 99))), { lo: 20, hi: 120 });
assert.deepEqual(JSON.parse(JSON.stringify(dw.reelDrawingRange([lad, { kind: 'hline', p: 300, link: 'L1', tfs: ['1H', '4H'] }], src, 0, 99))), { lo: 20, hi: 300 });
console.log('stock, crypto, Weekly and Monthly views: ok');

// Sector / industry filter (2026-10-25): stock sectors only, the industry list
// limited to the chosen sector, exact matches.
const sx = vm.createContext({
  escText: v => String(v),
  allData: [
    { sector: 'Technology', industry: 'Semiconductors' }, { sector: 'Technology', industry: 'Semiconductors' },
    { sector: 'Technology', industry: 'Software' }, { sector: 'Healthcare', industry: 'Biotechnology' },
    { sector: 'Crypto', industry: 'Coin' }, { sector: 'Index', industry: 'US Index' },
  ],
});
vm.runInContext(fn('sectorMenuHtml') + fn('sectorMatches') + fn('sectorDropValue'), sx);
const menu = sx.sectorMenuHtml('wl', '', '');
assert.ok(/data-wl-sector="Technology">Technology<i>3<\/i>/.test(menu) && /data-wl-sector="Healthcare"/.test(menu), menu);
assert.ok(!/Crypto|US Index/.test(menu), 'Class covers crypto and indices');
assert.ok(!/data-wl-industry/.test(menu), 'No industry list before a sector is chosen');
const tech = sx.sectorMenuHtml('reel', 'Technology', 'Software');
assert.ok(/data-reel-industry="Semiconductors">Semiconductors<i>2<\/i>/.test(tech) && !/Biotechnology/.test(tech), tech);
assert.ok(/class="fdrop-opt on" data-reel-industry="Software"/.test(tech));
assert.equal(sx.sectorMatches({ sector: 'Technology', industry: 'Software' }, 'Technology', ''), true);
assert.equal(sx.sectorMatches({ sector: 'Technology', industry: 'Software' }, 'Technology', 'Semiconductors'), false);
assert.equal(sx.sectorMatches({ sector: 'Healthcare' }, 'Technology', ''), false);
assert.deepEqual([...sx.sectorDropValue('Technology', 'Software')], ['Software']);
assert.deepEqual([...sx.sectorDropValue('', '')], []);
console.log('sector / industry filter: ok');
