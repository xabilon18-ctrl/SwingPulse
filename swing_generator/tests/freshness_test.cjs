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
assert.equal(f.chart('2026-10-09 10:00','1H',now).label,'Last completed 1H bar');
const forming={t:'2026-10-10 15:00',closes_at:'2026-10-10T16:00:00Z'};
assert.equal(f.chart(forming.t,'1H',Date.parse('2026-10-10T15:05Z'),forming).state,'Still forming');
assert.equal(f.chart(forming.t,'1H',Date.parse('2026-10-10T16:05Z'),forming).state,'Awaiting final update','An old snapshot must never claim it is final');
assert.equal(f.chart('2026-10-10 08:00','1H',now,forming).state,'');
const previousZone=process.env.TZ;
try {
  process.env.TZ='Africa/Johannesburg';
  assert.equal(f.chartTime('2026-10-10 00:00','1H'),'10 Oct 02:00');
  assert.equal(f.chartTime('2026-10-10 00:00','1H',true).replace(',', ''),'Sat 10 Oct 02:00');
  assert.equal(f.chart('2026-10-10 00:00','1H',now).basis,'local');
  assert.ok(f.chart('2026-10-10 00:00','1H',now).detailTime.includes('GMT+2'));
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
// Forex: Sunday 17:00 to Friday 17:00 New York, so 21:00 UTC in summer, 22:00 in winter.
const fx=t=>f.session({assetClass:'Currency',symbol:'EURUSD=X'},Date.parse(t)).closed;
assert.equal(fx('2026-07-12T21:30:00Z'),false,'Summer Sunday 21:30 UTC: forex has reopened');
assert.equal(fx('2026-07-12T20:30:00Z'),true,'Summer Sunday 20:30 UTC: still closed');
assert.equal(fx('2026-07-10T21:30:00Z'),true,'Summer Friday 21:30 UTC: closed');
assert.equal(fx('2026-07-10T20:30:00Z'),false,'Summer Friday 20:30 UTC: open');
assert.equal(fx('2026-01-11T21:30:00Z'),true,'Winter Sunday 21:30 UTC: still closed');
assert.equal(fx('2026-01-11T22:30:00Z'),false,'Winter Sunday 22:30 UTC: open');
assert.equal(fx('2026-01-09T21:30:00Z'),false,'Winter Friday 21:30 UTC: open');
assert.equal(fx('2026-01-09T22:30:00Z'),true,'Winter Friday 22:30 UTC: closed');
assert.equal(fx('2026-07-11T12:00:00Z'),true,'Saturday: closed');
assert.equal(fx('2026-07-14T12:00:00Z'),false,'Tuesday: open');
for (const [tf,word] of [['W','weekly'],['M','monthly']]) {
  const bar=f.chart('2026-10-05',tf,now);
  assert.equal(bar.label,`Last completed ${word} bar`);
  assert.equal(bar.basis,'session date');
  assert.equal(bar.time,'5 Oct');
}
// Cash indices priced from the index itself (2026-11-02): closed outside
// regular hours, labelled with the next open in the device's own time.
{
  const prevTZ=process.env.TZ;
  try {
    process.env.TZ='Africa/Johannesburg';
    const ix=(sym,t,age=3*3600000)=>f.quote(Date.parse(t)-age,{assetClass:'Index',symbol:sym},Date.parse(t));
    // The user's screenshot: Mon 2 Nov 09:38 SAST = 07:38 UTC, Frankfurt on winter time.
    let q=ix('^GDAXI','2026-11-02T07:38:00Z',15*3600000);
    assert.equal(q.state,'closed'); assert.equal(q.label,'Opens 10:00','DAX opens 09:00 CET = 10:00 SAST');
    assert.ok(q.detail.includes('holidays may differ'));
    assert.equal(ix('^FTSE','2026-11-02T07:38:00Z').label,'Opens 10:00','FTSE opens 08:00 GMT = 10:00 SAST');
    assert.equal(ix('^GDAXI','2026-07-13T06:30:00Z').label,'Opens 09:00','Summer: Frankfurt on CEST, opens 09:00 SAST');
    assert.equal(ix('^GDAXI','2026-11-02T09:00:00Z',2*3600000).state,'stale','In session an old quote is still a problem');
    assert.equal(ix('^GDAXI','2026-11-02T09:00:00Z',5*60000).state,'recent');
    assert.equal(ix('^GDAXI','2026-11-02T16:31:00Z').label,'Opens Tue 10:00','After the 17:30 CET close: next weekday');
    assert.equal(ix('^GDAXI','2026-10-31T10:00:00Z').label,'Opens Mon 10:00','Saturday: Monday');
    assert.equal(ix('^GDAXI','2026-10-23T16:00:00Z').label,'Opens Mon 10:00','Friday before the Oct DST change: Monday 09:00 CET is still 10:00 SAST');
    assert.equal(ix('^HSI','2026-11-02T04:30:00Z').label,'Opens 07:00','Hong Kong lunch: reopens 13:00 HKT');
    assert.equal(ix('^HSI','2026-11-02T03:00:00Z',5*60000).state,'recent','Hong Kong morning session');
    assert.equal(f.quote(Date.parse('2026-11-02T03:38:00Z'),{assetClass:'Equity',symbol:'^SOX'},Date.parse('2026-11-02T07:38:00Z')).label,'Opens 16:30','SOX (Equity class) uses the index table too');
    // Futures-priced indices keep printing out of cash hours: no session rule.
    assert.equal(ix('^GSPC','2026-11-02T07:38:00Z').state,'stale');
    assert.equal(ix('^N225','2026-11-02T07:38:00Z').state,'stale');
  } finally { if(prevTZ===undefined) delete process.env.TZ; else process.env.TZ=prevTZ; }
}
console.log('PASS: freshness, cash index sessions, local chart times, day rollover, daylight saving, daily session dates and forex hours');
