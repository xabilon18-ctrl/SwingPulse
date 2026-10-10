const assert=require('node:assert/strict');
const f=require('../webapp/static/js/modules/freshness.js');
const now=Date.parse('2026-10-09T14:00:00Z');
assert.equal(f.timestamp('2026-10-09 13:00'),Date.parse('2026-10-09T13:00Z'));
assert.equal(f.timestamp('bad'),null);
assert.equal(f.quote(now-10000,{assetClass:'Crypto'},now).state,'recent');
assert.equal(f.quote(now-15*60000,{assetClass:'Crypto'},now).state,'delayed');
assert.equal(f.quote(now-2*3600000,{assetClass:'Crypto'},now).state,'stale','Old quote does not imply market closed');
assert.equal(f.quote(null,{},now).state,'unknown');
const weekend=Date.parse('2026-10-10T12:00:00Z');
assert.equal(f.quote(weekend-2*3600000,{assetClass:'Equity',symbol:'AAPL'},weekend).state,'closed');
assert.equal(f.quote(weekend-2*3600000,{assetClass:'Crypto',symbol:'BTC-USD'},weekend).state,'stale');
assert.equal(f.dataset(now-30*60000,false,now).state,'ok');
for (const clock of [now,weekend,Date.parse('2026-10-12T01:00:00Z')]) {
  assert.equal(f.dataset(clock-90*60000,false,clock).state,'ok','Hourly publication allows runtime headroom');
  assert.equal(f.dataset(clock-91*60000,false,clock).state,'stale','Weekdays, weekends and overnight use the same limit');
  assert.ok(!f.dataset(clock-30*60000,false,clock).detail.includes('Between scheduled runs'));
}
assert.equal(f.dataset(now,true,now).state,'failed');
assert.equal(f.chart('2026-10-09 10:00','4H',now).label,'Last completed 4H bar');
console.log('PASS: separate quote, chart and dataset times; delays, known sessions, scheduled-update warnings');
