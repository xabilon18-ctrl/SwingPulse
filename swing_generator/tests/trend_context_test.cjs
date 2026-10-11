const assert = require('node:assert/strict');
const t = require('../webapp/static/js/modules/trend-context.js');
const gold = { instrument_name: 'GOLD', date: '2026-10-09', close: 4216.299805, ma_500: 3794.025993, trend_direction: 'DOWNTREND', h1_close: 4185.20, h1_ma_500: 4245.18 };
const pound = { instrument_name: 'GBPMXN', date: '2026-10-09', close: 24.311399, ma_500: 24.559292, trend_direction: 'NEUTRAL', h1_close: 24.31, h1_ma_500: 23.49 };
const channels = { workflow:{'4H':{GOLD:{direction:'DOWNTREND'},GBPMXN:{direction:'UPTREND'}}}, tf: { D: { GOLD: 'UPTREND', GBPMXN: 'DOWNTREND' }, '4H': { GOLD: 'DOWNTREND', GBPMXN: 'UPTREND' }, '1H': { GOLD: 'DOWNTREND', GBPMXN: 'UPTREND' } } };
assert.equal(t.main(gold), t.UP, 'Main trend follows the completed Daily close against Daily MA500, not an existing ribbon label');
assert.equal(t.main(pound), t.DOWN);
for (const tf of ['D', '4H', '1H']) {
  assert(t.matches(gold, channels, {main:t.UP,tf}));
  assert(!t.matches(gold, channels, {main:t.DOWN,tf}));
  assert(t.matches(pound, channels, {main:t.DOWN,tf}));
}
assert.equal(t.context(gold, channels).h4Relation, 'minor');
assert.equal(t.context(pound, channels).h4Relation, 'minor');
assert.equal(t.relationship(t.UP,t.UP),'aligned');
assert.equal(t.relationship(t.DOWN,t.DOWN),'aligned');
assert.equal(t.native(gold,'4H',{tf:{D:channels.tf.D}}),t.UNKNOWN,'Missing native data cannot fall back to Daily');
assert.equal(t.relationship(t.UP,t.UNKNOWN),'unknown');
assert.equal(t.main({...gold,close:'',ma_500:100}),t.UNKNOWN);
assert.equal(t.main({...gold,close:100,ma_500:100,established_trend:t.UP}),t.UNKNOWN,'Old ribbon latch is not a confirmed Daily-500 state');
assert.equal(t.main({...gold,close:100,ma_500:100},t.UP),t.UP);
assert.equal(t.main({...gold,close:100,ma_500:100},t.DOWN),t.DOWN);
assert.equal(t.main({...gold,quote:1,forming:{c:1},h1_close:1}),t.UP,'Quotes and forming bars cannot change the confirmed Daily state');
assert.equal(t.distance(105,100),5);
assert.equal(t.distance('',100),null);
assert.equal(t.distance(100,0),null);
assert.equal(t.native(gold,'4H',{tf:{'4H':{GOLD:t.UP}}}),t.UNKNOWN,'Legacy channel classification cannot supply the setup direction');
assert.equal(t.native(gold,'1H',null),t.DOWN,'Completed native hourly values work without channel geometry');
console.log('PASS: Daily main trend, independent chart directions, consistent filters and missing-data handling');
