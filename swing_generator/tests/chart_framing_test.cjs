const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../webapp/static/js/app.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('  const REEL_PHONE_CARD_PX'), source.indexOf('  function reelFmtPrice')), context);
vm.runInContext(source.slice(source.indexOf('  function reelOpeningPriceWindow'), source.indexOf('  // ── SAVED VIEWS')), context);

const card = { py0: 0, py1: 300 }, full = { py0: 0, py1: 700 };
const bundle = { c: [8400, 7900], l: [8300, 7700], h: [8500, 8000], m: [[8400, 8150], [9000, 8800], [6000, 6500]] };
const a = context.reelScale(bundle, card), b = context.reelScale(bundle, full);
assert.equal(a.lo, b.lo, 'Automatic bounds follow price, not the height of the screen');
assert.equal(a.hi, b.hi);
assert.equal(b.y(7900), 350, 'Current price is centred in the default frame');
assert.ok(b.lo < 7700 && b.hi > 8500, 'Visible swing has breathing room at both ends');
assert.ok((8500 - 7700) / b.span > 0.4, 'Distant averages do not flatten the candles');
assert.equal(b.clipped, true, 'Off-screen native averages still expose their edge indicator');
const noOverlay = context.reelScale({ ...bundle, m: [] }, full);
assert.equal(noOverlay.lo, b.lo);
assert.equal(noOverlay.hi, b.hi);
const saved = context.reelScale(bundle, full, {lo:7000, hi:10000});
assert.equal(saved.lo, 7000, 'Saved/manual price bounds take precedence');
assert.equal(saved.hi, 10000);
assert.equal(saved.inv(saved.y(8123)), 8123, 'Drawing coordinates retain their price mapping');
for (const price of [0.00002, 100, 80000]) {
  const flat = context.reelScale({c:[price],l:[price],h:[price],m:[]},full);
  assert.ok(Number.isFinite(flat.span) && flat.span > 0, 'Flat/short history produces usable bounds');
  assert.equal(flat.y(price),350);
}
console.log('PASS: price-centred framing, distant MAs, saved bounds and flat-history fallback');
