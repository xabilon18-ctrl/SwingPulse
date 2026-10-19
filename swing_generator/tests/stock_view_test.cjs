// Stock opening views: 1H quarters, 4H half-years, Daily terms (2026-10-17).
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
vm.runInContext(table('REEL_SLOW_VIEW') + table('REEL_STOCK_VIEW') + table('REEL_CRYPTO_VIEW') + table('REEL_INDEX_VIEW') + table('REEL_FXCOM_VIEW') + table('REEL_INDEX_VIEW') + table('REEL_FXCOM_VIEW') + fn('reelOpenSpec') + fn('reelStockView'), ctx);

// Six months of a stock's 1H bars (7 a weekday, 13:30-19:30 UTC) up to 17 Oct 2026.
const hourly = (from, to, hours) => {
  const t = [];
  for (let d = from; d <= to; d += 864e5) {
    if ([0, 6].includes(new Date(d).getUTCDay())) continue;
    hours.forEach(h => t.push(new Date(d + h * 36e5).toISOString()));
  }
  return { t, c: t.map(() => 1) };
};
const hours = [13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5];
const b = hourly(Date.UTC(2026, 3, 17), Date.UTC(2026, 9, 16), hours);
const qv = ctx.reelStockView(b, 'STOCK');
const n = b.t.length, from = n - (qv.bars - qv.future);
// The window opens at the start of Q3. The grid's quarters are equal parts of
// the year, so the line can fall a day either side of the calendar 1 July.
const near = (iso, day) => Math.abs(Date.parse(iso) - Date.parse(day)) < 2.5 * 864e5;
assert.ok(near(b.t[from], '2026-07-01'), b.t[from]);
// The window ends on the Q1 2027 line, the grid's own: its slot is the last one.
const lines = geometry.timeGrid(b, '1H', { barTimes: bt, getDivision: () => ({ parts: 4, code: 'Q' }) })
  .filter(l => l.quarter);
const q1 = lines.find(l => l.label === 'Q1 2027'), q3 = lines.find(l => l.label === 'Q3' && l.fi > 0);
assert.ok(q1.fi - from > qv.bars - 2 && q1.fi - from <= qv.bars, 'next quarter line at the right edge');
assert.ok(q3.fi - from >= 0 && q3.fi - from < 1, 'previous quarter line at the left edge');
assert.ok(qv.future > 0 && qv.future < qv.bars * 0.9);

// Every day of the quarter maps to the same quarters: a new quarter moves the frame on.
const jan = hourly(Date.UTC(2026, 6, 10), Date.UTC(2027, 0, 8), hours);
const qj = ctx.reelStockView(jan, 'STOCK');
assert.ok(near(jan.t[jan.t.length - (qj.bars - qj.future)], '2026-10-01'));

// Crypto 1H: 30 days of candles, then 35 days of blank future.
const round = [];
for (let ms = Date.UTC(2026, 3, 17); ms <= Date.UTC(2026, 9, 17, 18); ms += 36e5) round.push(new Date(ms).toISOString());
const vc = ctx.reelStockView({ t: round, c: round.map(() => 1) }, 'BTC');
assert.equal(vc.bars - vc.future, 30 * 24 + 1);
assert.equal(vc.future, 35 * 24);
assert.equal(vc.fit, 'upper');
// Crypto 4H: previous + current quarter, as stock 1H. Six 4H bars a day.
ctx.timeframe = '4H';
const r4 = [];
for (let ms = Date.UTC(2025, 9, 18); ms <= Date.UTC(2026, 9, 17, 16); ms += 4 * 36e5) r4.push(new Date(ms).toISOString());
const c4 = ctx.reelStockView({ t: r4, c: r4.map(() => 1) }, 'BTC');
assert.ok(near(r4[r4.length - (c4.bars - c4.future)], '2026-07-01'));
assert.equal(c4.fit, 'all');
// Crypto Daily: last year's line to two year lines ahead (2025 → 2028).
ctx.timeframe = 'D';
const rd = [];
for (let ms = Date.UTC(2021, 9, 1); ms <= Date.UTC(2026, 9, 16); ms += 864e5) rd.push(new Date(ms).toISOString());
const cd = ctx.reelStockView({ t: rd, c: rd.map(() => 1) }, 'BTC');
assert.ok(near(rd[rd.length - (cd.bars - cd.future)], '2025-01-01'));
const frc = geometry.yearFrame({ t: rd }, bt);
assert.ok(Math.abs(rd.length - (cd.bars - cd.future) + cd.bars - 1 - (frc.anchor + 2 * frc.yearBars)) <= 1, 'ends on the 2028 line');
assert.equal(cd.fit, 'allzero');
ctx.timeframe = '1H';
// Index 1H: ~3 weeks before the Q4 line to the Q1 2027 line.
const ix = hourly(Date.UTC(2026, 3, 20), Date.UTC(2026, 9, 16), [13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5]);
const vi = ctx.reelStockView(ix, 'IDX');
const fi0 = ix.t.length - (vi.bars - vi.future);
assert.ok(Math.abs(Date.parse(ix.t[fi0]) - Date.parse('2026-09-10')) < 3 * 864e5, ix.t[fi0]);
const fri = geometry.yearFrame(ix, bt);
assert.ok(Math.abs(fi0 + vi.bars - 1 - (fri.anchor + fri.yearBars)) <= 1, 'ends on the Q1 2027 line');
assert.equal(vi.fit, 'all');
// Index 4H and Daily take the stock frames, fitted to everything.
ctx.timeframe = '4H';
const i4 = ctx.reelStockView(hourly(Date.UTC(2025, 9, 1), Date.UTC(2026, 9, 16), [8, 12, 16]), 'IDX');
assert.equal(i4.fit, 'all');
ctx.timeframe = 'D';
const idd = hourly(Date.UTC(2021, 0, 4), Date.UTC(2026, 9, 16), [0]);
const vid = ctx.reelStockView(idd, 'IDX');
assert.ok(near(idd.t[idd.t.length - (vid.bars - vid.future)], '2025-01-01'));
assert.equal(vid.fit, 'all');
// Forex/commodities: the crypto frames, but Daily never forces 0 onto the scale.
const fxd = ctx.reelStockView({ t: rd, c: rd.map(() => 1) }, 'FX');
assert.ok(near(rd[rd.length - (fxd.bars - fxd.future)], '2025-01-01'));
assert.equal(fxd.fit, 'all');
ctx.timeframe = '1H';
assert.equal(ctx.reelStockView({ t: round, c: round.map(() => 1) }, 'FX').fit, 'upper');
// Only these markets, only these timeframes, only without a Range pill.
assert.equal(ctx.reelStockView(hourly(Date.UTC(2026, 3, 17), Date.UTC(2026, 9, 16), hours), 'EUR'), null);
ctx.timeframe = '15m';
assert.equal(ctx.reelStockView(hourly(Date.UTC(2026, 3, 17), Date.UTC(2026, 9, 16), hours), 'STOCK'), null);

// 4H: previous + current half-year. Two bars a session, a year carried.
ctx.timeframe = '4H';
const h4 = hourly(Date.UTC(2025, 9, 1), Date.UTC(2026, 9, 16), [13.5, 17.5]);
const v4 = ctx.reelStockView(h4, 'STOCK');
const f4 = h4.t.length - (v4.bars - v4.future);
assert.ok(near(h4.t[f4], '2026-01-01'), h4.t[f4]);
const fr4 = geometry.yearFrame(h4, bt);
assert.ok(Math.abs(f4 + v4.bars - 1 - (fr4.anchor + fr4.yearBars)) <= 1, 'ends on the 2027 line');
// In March it is the second half of last year plus the first half of this one.
const m4 = hourly(Date.UTC(2025, 2, 1), Date.UTC(2026, 2, 10), [13.5, 17.5]);
const w4 = ctx.reelStockView(m4, 'STOCK');
assert.ok(near(m4.t[m4.t.length - (w4.bars - w4.future)], '2025-07-01'));
assert.equal(w4.fit, 'wide');

// Daily: the current four-year term, 2025 to 2029.
ctx.timeframe = 'D';
const d = hourly(Date.UTC(2021, 0, 4), Date.UTC(2026, 9, 16), [0]);
const vd = ctx.reelStockView(d, 'STOCK');
const fd = d.t.length - (vd.bars - vd.future);
assert.ok(near(d.t[fd], '2025-01-01'), d.t[fd]);
const frd = geometry.yearFrame(d, bt);
assert.ok(Math.abs(fd + vd.bars - 1 - (frd.anchor + 3 * frd.yearBars)) <= 1, 'ends on the 2029 line');
assert.equal(vd.fit, 'zero');
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
const pw = vm.createContext({ REEL_OPENING_PRICE_FILL: 0.85, REEL_OV_FIT_CAP: 2, REEL_WIDE_PRICE_FILL: 0.55, REEL_ZERO_FIT_FOOT: 0.05, REEL_UPPER_FILL: 0.45, REEL_UPPER_HEAD: 0.08, REEL_ALL_FIT_REACH: 2.5, REEL_ALL_FIT_PAD: 0.05 });
vm.runInContext(fn('reelOpeningPriceWindow'), pw);
const bars = { c: [100], l: [95], h: [105] };
const plain = pw.reelOpeningPriceWindow(bars);
const close = pw.reelOpeningPriceWindow(bars, { lo: 92, hi: 104 });
const far = pw.reelOpeningPriceWindow(bars, { lo: 62, hi: 104 });
assert.ok(close.lo < plain.lo && close.lo <= 92, 'a nearby MA is fitted');
assert.ok(Math.abs((far.hi - far.lo) - 2 * (plain.hi - plain.lo)) < 1e-9, 'a far MA stops at the cap');
assert.ok(far.lo > 62, 'the far MA is left off-screen');
// 4H: centred on the close, the bars at about half the height.
const wide = pw.reelOpeningPriceWindow(bars, null, 'wide');
assert.ok(Math.abs((wide.hi + wide.lo) / 2 - 100) < 1e-9 && Math.abs(wide.hi - 100 - 5 / 0.55) < 1e-9);
// Daily: 0 just above the bottom, the top at twice the highest high.
const zero = pw.reelOpeningPriceWindow(bars, null, 'zero');
assert.equal(zero.hi, 210);
assert.ok(zero.lo < 0 && zero.lo > -15);
// Crypto 1H, measured off DOT: candles 1.02-1.29, W50 up to 1.55, D50 down to 0.93.
const dot = pw.reelOpeningPriceWindow({ c: [1.1115], l: [1.02], h: [1.29] }, { lo: 0.93, hi: 1.55 }, 'upper');
assert.ok(Math.abs(dot.hi - 1.66) < 0.03 && Math.abs(dot.lo - 0.28) < 0.05, JSON.stringify(dot));
// The lowest line sits at about the middle; a far MA is held to one bar-range.
assert.ok(Math.abs((0.93 - dot.lo) / (dot.hi - dot.lo) - 0.47) < 0.03);
const far2 = pw.reelOpeningPriceWindow({ c: [1.1], l: [1.0], h: [1.2] }, { lo: 0.2, hi: 1.2 }, 'upper');
assert.ok(far2.lo > 0.2 && Math.abs((far2.hi - far2.lo) - 0.4 / 0.45) < 1e-9);
// Crypto 4H/Daily 'all': candles, MAs and drawings, 5% margin; a runaway line held to 2.5 ranges.
const btc4 = pw.reelOpeningPriceWindow({ c: [81377], l: [63000], h: [88000] }, { lo: 44000, hi: 141000 }, 'all');
assert.ok(Math.abs(btc4.lo - 39150) < 1 && Math.abs(btc4.hi - 145850) < 1, JSON.stringify(btc4));
const run = pw.reelOpeningPriceWindow({ c: [10], l: [9], h: [11] }, { lo: 9, hi: 1000 }, 'all');
assert.ok(Math.abs(run.hi - (16 + 7 * 0.05)) < 1e-9);
const ethD = pw.reelOpeningPriceWindow({ c: [2412], l: [1400], h: [4950] }, { lo: 1400, hi: 8600 }, 'allzero');
assert.ok(ethD.lo < 0 && Math.abs(ethD.hi - 9030) < 1, JSON.stringify(ethD));
// Drawings: a channel's ends and edges, a ladder's whole stack (never below 0), a level.
const dw = vm.createContext({ REEL_EXTRAP_BARS: 250, LADDER_LINES: 10,
  ladderStack: (d, dir) => Math.max(0, Math.floor(Number(d[dir]) || 0)),
  reelParseTs: v => Date.parse(String(v).slice(0, 10) + 'T00:00:00Z'), reelBarTimes: bt, timeframe: '4H' });
vm.runInContext(fn('drawShownOn') + fn('reelBarIndexForDate') + fn('reelDrawingRange'), dw);
const days = []; for (let i = 0; i < 100; i++) days.push(new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10));
const src = { t: days, c: days.map(() => 1) };
const ch = { kind: 'channel', t1: days[0], p1: 100, t2: days[10], p2: 110, up: 5, dn: -5 };
const r1 = dw.reelDrawingRange([ch], src, 0, 150);
assert.ok(Math.abs(r1.lo - 95) < 1e-9 && Math.abs(r1.hi - 255) < 1e-9, JSON.stringify(r1));
const lad = { kind: 'ladder', p1: 10, p4: 40 };
assert.deepEqual(JSON.parse(JSON.stringify(dw.reelDrawingRange([lad, { kind: 'hline', p: 300 }], src, 0, 99))), { lo: 10, hi: 300 });
assert.equal(dw.reelDrawingRange([], src, 0, 99), null);
// A linked drawing switched off for this timeframe does not frame it.
assert.deepEqual(JSON.parse(JSON.stringify(dw.reelDrawingRange([lad, { kind: 'hline', p: 300, link: 'L1', tfs: ['1H'] }], src, 0, 99))), { lo: 10, hi: 100 });
assert.deepEqual(JSON.parse(JSON.stringify(dw.reelDrawingRange([lad, { kind: 'hline', p: 300, link: 'L1', tfs: ['1H', '4H'] }], src, 0, 99))), { lo: 10, hi: 300 });
console.log('stock, crypto, Weekly and Monthly views: ok');
