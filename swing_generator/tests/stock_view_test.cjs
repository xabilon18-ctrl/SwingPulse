// Opening views on every market (2026-10-22): 1H months, Daily years; W/M terms. (4H removed 2026-11-07.)
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
  timeframe: '1H', reel: { ranges: {} }, REEL_MIN_WINDOW_BARS: 20, REEL_FUTURE_FRAC: 0.9,
  window: { SwingPulseModules: { gridGeometry: geometry } }, reelBarTimes: bt,
  instrumentByName: name => ({ STOCK: 'stocks', BTC: 'crypto', IDX: 'indices', EUR: 'other', FX: 'fx' }[name]),
  reelGridScope: scope => scope,
  assetClassOf: scope => ({ crypto: 'Crypto', fx: 'Currency' }[scope] || 'Other'),
});
const table = name => { const a = source.indexOf(`  const ${name} = {`); return source.slice(a, source.indexOf('  };\n', a) + 5).replace('const ', 'var '); };
vm.runInContext(table('REEL_SLOW_VIEW') + table('REEL_FRAME_VIEW') + fn('reelOpenSpec') + fn('reelStockView')
  + 'function reelRange() { return reel.ranges[timeframe] || 0; }'
  + 'var frameLock = null; function reelFrameLock() { return frameLock; }', ctx);

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

// Daily, every market (2026-11-16): the whole term with room either side, a
// year and a half before its opening line to a year past its closing line
// (mid-2023 → 2030). Round the clock (crypto) and a session a weekday.
const nearMid = (iso, day) => Math.abs(Date.parse(iso) - Date.parse(day)) < 4 * 864e5;
ctx.timeframe = 'D';
const rd = [];
for (let ms = Date.UTC(2021, 9, 1); ms <= Date.UTC(2026, 9, 16); ms += 864e5) rd.push(new Date(ms).toISOString());
const wd = hourly(Date.UTC(2021, 0, 4), Date.UTC(2026, 9, 16), [0]);
for (const [market, bd] of [['BTC', { t: rd, c: rd.map(() => 1) }], ['FX', { t: rd, c: rd.map(() => 1) }],
  ['EUR', { t: rd, c: rd.map(() => 1) }], ['STOCK', wd], ['IDX', wd]]) {
  delete bd._sv;
  const vd = ctx.reelStockView(bd, market);
  const fd = bd.t.length - (vd.bars - vd.future);
  assert.ok(nearMid(bd.t[fd], '2023-07-02'), market + ' ' + bd.t[fd]);
  const frd = geometry.yearFrame(bd, bt);
  assert.ok(Math.abs(fd + vd.bars - 1 - (frd.anchor + 4 * frd.yearBars)) <= 1, market + ' ends on the 2030 line');
  // The whole 2025 term is inside it: both term lines, with bars before the first.
  assert.ok(frd.anchor - frd.yearBars - fd > frd.yearBars, market + ' room before the 2025 line');
  assert.equal(vd.fit, 'all', market);
}
// A new year inside the term leaves it where it is; a new term moves it on.
const jd = hourly(Date.UTC(2022, 0, 3), Date.UTC(2027, 0, 15), [0]);
const vj = ctx.reelStockView(jd, 'STOCK');
assert.ok(nearMid(jd.t[jd.t.length - (vj.bars - vj.future)], '2023-07-02'));
const nt = hourly(Date.UTC(2024, 0, 2), Date.UTC(2029, 1, 15), [0]);
const vn = ctx.reelStockView(nt, 'STOCK');
assert.ok(nearMid(nt.t[nt.t.length - (vn.bars - vn.future)], '2027-07-02'), 'the 2029 term opens mid-2027');
// "Same frame on every chart" (2026-11-16): the switch's dates replace the
// timeframe's own frame on every market, and a new switch replaces the cache.
for (const [market, bd] of [['BTC', { t: rd, c: rd.map(() => 1) }], ['STOCK', wd]]) {
  ctx.frameLock = { y0: 2024, y1: 2027 };
  const vl = ctx.reelStockView(bd, market);
  const fl = bd.t.length - (vl.bars - vl.future);
  assert.ok(near(bd.t[fl], '2024-01-01'), market + ' locked start ' + bd.t[fl]);
  const frl = geometry.yearFrame(bd, bt);
  assert.ok(Math.abs(fl + vl.bars - 1 - (frl.anchor + frl.yearBars)) <= 1, market + ' locked frame ends on the 2027 line');
  assert.equal(vl.back, 0, market);
  // A frame wholly in the past opens scrolled back to it, with no blank future.
  ctx.frameLock = { y0: 2022, y1: 2024 };
  const vp = ctx.reelStockView(bd, market);
  assert.ok(vp.back > 0 && vp.future === 0, market + ' past frame');
  assert.ok(near(bd.t[bd.t.length - vp.bars - vp.back], '2022-01-01'), market + ' past frame start');
  // A frame starting before the first bar keeps its start (2026-11-16, a
  // young listing framed from 2000 jumped to its first bar on Save): `lead`
  // blank slots before the data, the window as wide as the dates.
  ctx.frameLock = { y0: 2015, y1: 2027 };
  const vb = ctx.reelStockView(bd, market);
  const frb = geometry.yearFrame(bd, bt);
  assert.ok(vb.lead > 0, market + ' lead before the data');
  assert.ok(Math.abs(vb.bars - 12 * frb.yearBars) <= 2, market + ' window spans 2015 to 2027: ' + vb.bars);
  assert.ok(Math.abs(-vb.lead - (frb.anchor - 11 * frb.yearBars)) <= 1, market + ' starts on the 2015 line');
  // The timeframes' own frames still start on the data.
  ctx.frameLock = null;
  assert.equal(ctx.reelStockView(bd, market).lead, 0, market + ' own frame starts on the data');
  // Off again: the timeframe's own frame is back.
  ctx.frameLock = null;
  const vo = ctx.reelStockView(bd, market);
  assert.ok(nearMid(bd.t[bd.t.length - (vo.bars - vo.future)], '2023-07-02'), market + ' own frame back');
}
// "Same frame" per MARKET (2026-11-21, user: the saved view "must then apply
// to that sector or other instruments but not changing the one I am working
// on"; they chose the market as the group and "keep their own"): a frame
// reaches the other charts of its market on its timeframe, never the chart
// it came from, a chart with its own saved view, another market or another
// timeframe. The 2026-11-16 shape (one frame per timeframe) is read as the
// frame of the market it was taken on.
{
  const line = name => { const a = source.indexOf(`  const ${name} = `); return source.slice(a, source.indexOf(';\n', a) + 2); };
  const fx = vm.createContext({
    timeframe: 'D', tfOverlay: {}, savedViews: {},
    GRID_SCOPE_LABELS: { stocks: 1, commodities: 1, crypto: 1, other: 1 },
    instrumentByName: n => ({ GOLD: 'commodities', SILVER: 'commodities', WTI: 'commodities', AAPL: 'stocks', BTC: 'crypto' }[n]),
    reelMarketScope: scope => scope || 'other',
    viewKey: (n, tf) => n + '|' + (tf || fx.timeframe),
  });
  vm.runInContext(line('frameOk') + fn('reelFrames') + fn('reelFrameOf') + line('reelScopeOfName') + fn('reelFrameLock'), fx);
  // Legacy shape: one frame for the whole timeframe, taken on GOLD.
  fx.tfOverlay.frame = { D: { y0: 2023.5, y1: 2030, scope: 'commodities', name: 'GOLD' } };
  assert.equal(fx.reelFrameLock('SILVER').y0, 2023.5, 'another commodity takes the frame');
  assert.equal(fx.reelFrameLock('GOLD'), null, 'the chart it came from is left alone');
  assert.equal(fx.reelFrameLock('AAPL'), null, 'a stock is not framed by a commodity');
  assert.equal(fx.reelFrameLock('BTC'), null, 'nor is crypto');
  assert.equal(fx.reelFrameLock('SILVER', 'M'), null, 'nor another timeframe');
  fx.savedViews['WTI|D'] = { v: 2 };
  assert.equal(fx.reelFrameLock('WTI'), null, 'a chart with its own saved view keeps it');
  // A second market's frame alongside the first.
  fx.tfOverlay.frame.D.stocks = { y0: 2020, y1: 2026, scope: 'stocks', name: 'AAPL' };
  assert.equal(fx.reelFrameLock('SILVER').y0, 2023.5);
  assert.equal(fx.reelFrameLock('AAPL'), null);
  assert.equal(fx.reelFrameOf('stocks').y0, 2020);
  assert.equal(fx.reelFrameLock(''), null);
}
console.log('same frame per market: ok');
// Only these timeframes, only without a Range pill.
ctx.timeframe = '15m';
assert.equal(ctx.reelStockView(hourly(Date.UTC(2026, 3, 17), Date.UTC(2026, 9, 16), hours), 'STOCK'), null);

// No Weekly frame: its chart was removed on 2026-11-16.
ctx.timeframe = 'W';
const wk = [];
for (let ms = Date.UTC(2006, 0, 2); ms <= Date.UTC(2026, 9, 12); ms += 7 * 864e5) wk.push(new Date(ms).toISOString().slice(0, 10));
assert.equal(ctx.reelStockView({ t: wk, c: wk.map(() => 1) }, 'STOCK'), null, 'no Weekly frame');
// Monthly opens on ALL its history, to the 2029 line.
ctx.timeframe = 'M';
const mo = [];
for (let y = 2006; y <= 2026; y++) for (let m = 0; m < 12 && (y < 2026 || m < 9); m++) mo.push(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10));
const vm1 = ctx.reelStockView({ t: mo, c: mo.map(() => 1) }, 'EUR');
assert.equal(mo[mo.length - (vm1.bars - vm1.future)], mo[0]);
const frm = geometry.yearFrame({ t: mo }, bt);
assert.ok(Math.abs(mo.length - (vm1.bars - vm1.future) + vm1.bars - 1 - (frm.anchor + 3 * frm.yearBars)) <= 1, 'Monthly ends on the 2029 line');
// Chart range is per timeframe (2026-10-28): set on 1H it replaces 1H's
// frame only; Monthly keeps its own.
ctx.timeframe = '1H'; ctx.reel.ranges = { '1H': 300 };
assert.equal(ctx.reelStockView(hourly(Date.UTC(2026, 3, 17), Date.UTC(2026, 9, 16), hours), 'STOCK'), null);
ctx.timeframe = 'M';
assert.ok(ctx.reelStockView({ t: mo, c: mo.map(() => 1) }, 'EUR'), 'a 1H range leaves the Monthly frame');

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
// Daily 'all': candles, MAs and drawings, 5% margin; a runaway line held to 2.5 ranges.
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
  reelParseTs: v => Date.parse(String(v).slice(0, 10) + 'T00:00:00Z'), reelBarTimes: bt, timeframe: 'D' });
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
assert.deepEqual(JSON.parse(JSON.stringify(dw.reelDrawingRange([lad, { kind: 'hline', p: 300, link: 'L1', tfs: ['1H', 'D'] }], src, 0, 99))), { lo: 20, hi: 300 });
console.log('stock, crypto and Monthly views: ok');

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
vm.runInContext(fn('sectorLists') + fn('sectorMatches') + fn('sectorDropValue'), sx);
assert.deepEqual(JSON.parse(JSON.stringify(sx.sectorLists('Technology'))), {sectors: [['Healthcare', 1], ['Technology', 3]], industries: [['Semiconductors', 2], ['Software', 1]]});
assert.equal(sx.sectorMatches({ sector: 'Technology', industry: 'Software' }, 'Technology', ''), true);
assert.equal(sx.sectorMatches({ sector: 'Technology', industry: 'Software' }, 'Technology', 'Semiconductors'), false);
assert.equal(sx.sectorMatches({ sector: 'Healthcare' }, 'Technology', ''), false);
assert.deepEqual([...sx.sectorDropValue('Technology', 'Software')], ['Software']);
assert.deepEqual([...sx.sectorDropValue('', '')], []);
console.log('sector / industry filter: ok');
