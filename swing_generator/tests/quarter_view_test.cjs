// 1H stocks open on the previous + current quarter (2026-10-17).
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
  instrumentByName: name => ({ STOCK: 'stocks', BTC: 'other', IDX: 'indices' }[name]),
  reelGridScope: scope => scope,
});
vm.runInContext(fn('reelQuarterView'), ctx);

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
const qv = ctx.reelQuarterView(b, 'STOCK');
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
const qj = ctx.reelQuarterView(jan, 'STOCK');
assert.ok(near(jan.t[jan.t.length - (qj.bars - qj.future)], '2026-10-01'));

// Only stocks, only 1H, only without a Range pill.
assert.equal(ctx.reelQuarterView(hourly(Date.UTC(2026, 3, 17), Date.UTC(2026, 9, 16), hours), 'BTC'), null);
assert.equal(ctx.reelQuarterView(hourly(Date.UTC(2026, 3, 17), Date.UTC(2026, 9, 16), hours), 'IDX'), null);
ctx.timeframe = '4H';
assert.equal(ctx.reelQuarterView(hourly(Date.UTC(2026, 3, 17), Date.UTC(2026, 9, 16), hours), 'STOCK'), null);
ctx.timeframe = '1H'; ctx.reel.range = 300;
assert.equal(ctx.reelQuarterView(hourly(Date.UTC(2026, 3, 17), Date.UTC(2026, 9, 16), hours), 'STOCK'), null);

// The overlay fit is capped: the frame grows to at most twice what the bars need.
const pw = vm.createContext({ REEL_OPENING_PRICE_FILL: 0.85, REEL_OV_FIT_CAP: 2 });
vm.runInContext(fn('reelOpeningPriceWindow'), pw);
const bars = { c: [100], l: [95], h: [105] };
const plain = pw.reelOpeningPriceWindow(bars);
const close = pw.reelOpeningPriceWindow(bars, { lo: 92, hi: 104 });
const far = pw.reelOpeningPriceWindow(bars, { lo: 62, hi: 104 });
assert.ok(close.lo < plain.lo && close.lo <= 92, 'a nearby MA is fitted');
assert.ok(Math.abs((far.hi - far.lo) - 2 * (plain.hi - plain.lo)) < 1e-9, 'a far MA stops at the cap');
assert.ok(far.lo > 62, 'the far MA is left off-screen');
console.log('quarter view: ok');
