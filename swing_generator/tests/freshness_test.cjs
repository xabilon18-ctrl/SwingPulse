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
const previousZone=process.env.TZ;
try {
  process.env.TZ='Africa/Johannesburg';
  assert.equal(f.chartTime('2026-10-10 00:00','4H'),'10 Oct 02:00');
  assert.equal(f.chartTime('2026-10-10 00:00','4H',true).replace(',', ''),'Sat 10 Oct 02:00');
  assert.equal(f.chart('2026-10-10 00:00','4H',now).basis,'local');
  assert.ok(f.chart('2026-10-10 00:00','4H',now).detailTime.includes('GMT+2'));
  process.env.TZ='America/New_York';
  assert.equal(f.chartTime('2026-10-10 00:00','1H'),'9 Oct 20:00','Date changes with local timezone');
  assert.equal(f.chartTime('2026-03-08 06:00','1H'),'8 Mar 01:00');
  assert.equal(f.chartTime('2026-03-08 07:00','1H'),'8 Mar 03:00','Local clock follows daylight saving');
  assert.equal(f.chartTime('2026-10-10','D'),'10 Oct','Daily session dates do not shift to the previous day');
  assert.equal(f.chart('2026-10-10','D',now).basis,'session date');
  assert.equal(f.chartTime('bad','1H'),'unavailable');
} finally {
  if(previousZone===undefined) delete process.env.TZ; else process.env.TZ=previousZone;
}
console.log('PASS: freshness, local chart times, day rollover, daylight saving and daily session dates');
