// Ladder line alerts (2026-11-03). Run from saved_work_test.mjs, so CI runs
// it with the sync Worker tests it already lists.
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { ladderAlertLevels, alertLadders, checkAlerts, alertTitle, REPEAT_MS, isCurrencyQuote } from '../src/ladder-alerts.js';
import { readFileSync } from 'node:fs';

// A 0..100 ladder: p1 = 100, p4 = 130 → step u = 10, block 100..200.
const ladder = { kind: 'ladder', p1: 100, p4: 130, alert: true, link: 'L1' };
const lv = ladderAlertLevels(ladder);
assert.equal(lv.length, 51, 'a block has 51 alert lines: every 2%');
assert.deepEqual([lv[0].price, lv[0].pct, lv[0].daily], [100, 0, true]);
assert.deepEqual([lv[1].price, lv[1].pct, lv[1].daily], [102, 2, false], 'the 1H steps are every 2%');
assert.deepEqual([lv[5].price, lv[5].pct, lv[5].daily], [110, 10, true], 'the Daily lines every 10%');
assert.equal(lv.at(-1).price, 200);
const stacked = ladderAlertLevels({ ...ladder, up: 1, down: 1 });
assert.equal(stacked[0].pct, -100); assert.equal(stacked.at(-1).pct, 200, 'stacks carry the numbering on');
assert.ok(ladderAlertLevels({ ...ladder, p1: 10, p4: 40, down: 1 }).every(l => l.price >= 0), 'no line below price 0');
assert.equal(ladderAlertLevels({ ...ladder, reverse: true })[0].pct, 100, 'reversed counts from the top');

// Only ladders with the bell on, a linked copy once.
const blob = { channels: { GOLD: { D: [ladder, { kind: 'ladder', p1: 1, p4: 2 }], '1H': [{ ...ladder }], '4H': [{ ...ladder }] },
                               SILVER: { D: [{ kind: 'channel', alert: true }] } } };
assert.deepEqual(alertLadders(blob).map(x => x.name + ':' + x.id), ['GOLD:L1']);

// A crossing between runs fires; the same line does not fire again for 6h;
// a market with no new data is skipped.
const t0 = Date.parse('2026-11-03T10:00:00Z');
let run = checkAlerts({ users: { zabs: blob }, quotes: { q: { GOLD: { p: 101, t: 'a' } } }, state: {}, now: t0 });
assert.deepEqual(run.alerts, {}, 'the first run only remembers the price (101 is not on a line)');
run = checkAlerts({ users: { zabs: blob }, quotes: { q: { GOLD: { p: 104.5, h: 105, l: 100.5, t: 'b' } } }, state: run.state, now: t0 + 3600e3 });
assert.deepEqual(run.alerts.zabs.map(a => a.pct), [2, 4], '101 → 104.5 (high 105) crosses the 2% and 4% lines');
assert.equal(run.alerts.zabs[0].dir, 'up');
assert.equal(alertTitle(run.alerts.zabs[0]), 'GOLD · 1H 2%');
const again = checkAlerts({ users: { zabs: blob }, quotes: { q: { GOLD: { p: 101, h: 105, l: 101, t: 'c' } } }, state: run.state, now: t0 + 2 * 3600e3 });
assert.deepEqual(again.alerts, {}, 'the same lines do not fire again within 6 hours');
const stale = checkAlerts({ users: { zabs: blob }, quotes: { q: { GOLD: { p: 150, t: 'b' } } }, state: run.state, now: t0 + 3600e3 });
assert.deepEqual(stale.alerts, {}, 'unchanged quote time: no new data, no alert');
const later = checkAlerts({ users: { zabs: blob }, quotes: { q: { GOLD: { p: 110, h: 110, l: 109, t: 'd' } } }, state: again.state, now: t0 + 2 * 3600e3 + REPEAT_MS });
assert.ok(later.alerts.zabs.some(a => a.pct === 10 && a.daily), 'a Daily line alerts, marked Daily');
assert.equal(alertTitle(later.alerts.zabs.find(a => a.pct === 10)), 'GOLD · Daily 10%');

// A ladder drawn on Monthly (home 'M', 2026-11-13): chained down, its alert
// lines are its 1H steps, ten per 10% gap (every 1%).
const monthly = { ...ladder, link: 'L2', home: 'M' };
const mv = ladderAlertLevels(monthly);
assert.equal(mv.length, 101, 'a Monthly block has 101 alert lines: every 1%');
assert.deepEqual(mv.slice(0, 11).map(l => [l.pct, l.tier]), [[0, 'own'], [1, 'fine'], [2, 'fine'], [3, 'fine'], [4, 'fine'], [5, 'fine'], [6, 'fine'], [7, 'fine'], [8, 'fine'], [9, 'fine'], [10, 'own']]);
assert.ok(Math.abs(mv[1].price - 101) < 1e-9 && mv[1].tier === 'fine', 'the first 1H step is a tenth of the 10% gap');
const mblob = { channels: { GOLD: { M: [monthly], D: [{ ...monthly }], '1H': [{ ...monthly }] } } };
let mrun = checkAlerts({ users: { zabs: mblob }, quotes: { q: { GOLD: { p: 101.5, t: 'a' } } }, state: {}, now: t0 });
mrun = checkAlerts({ users: { zabs: mblob }, quotes: { q: { GOLD: { p: 103.6, h: 103.7, l: 101.5, t: 'b' } } }, state: mrun.state, now: t0 + 3600e3 });
assert.deepEqual(mrun.alerts.zabs.map(alertTitle), ['GOLD · 1H 2%', 'GOLD · 1H 3%'], 'a Monthly ladder alerts on its 1H 1% steps, once (linked copies)');
mrun = checkAlerts({ users: { zabs: mblob }, quotes: { q: { GOLD: { p: 110.2, h: 110.3, l: 109.8, t: 'c' } } }, state: mrun.state, now: t0 + 2 * 3600e3 });
assert.ok(mrun.alerts.zabs.map(alertTitle).includes('GOLD · Monthly 10%'), 'its own 10% line alerts as Monthly: ' + mrun.alerts.zabs.map(alertTitle));

// A ladder drawn on Yearly (home 'Y', 2026-11-26): its 1H steps split each
// 10% gap in ten (every 1%), its own lines named Yearly.
const yearly = { ...ladder, link: 'L3', home: 'Y' };
const yv = ladderAlertLevels(yearly);
assert.equal(yv.length, 101, 'a Yearly block has 101 alert lines: ten per 10% gap');
assert.deepEqual(yv.slice(0, 11).map(l => l.pct), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const yblob = { channels: { GOLD: { Y: [yearly], M: [{ ...yearly }], D: [{ ...yearly }], '1H': [{ ...yearly }] } } };
let yrun = checkAlerts({ users: { zabs: yblob }, quotes: { q: { GOLD: { p: 109.8, t: 'a' } } }, state: {}, now: t0 });
yrun = checkAlerts({ users: { zabs: yblob }, quotes: { q: { GOLD: { p: 111.3, h: 111.4, l: 109.8, t: 'b' } } }, state: yrun.state, now: t0 + 3600e3 });
assert.deepEqual(yrun.alerts.zabs.map(alertTitle), ['GOLD · Yearly 10%', 'GOLD · 1H 11%'], 'a Yearly ladder alerts once, its own line named Yearly: ' + yrun.alerts.zabs.map(alertTitle));

// CURRENCY LADDERS (2026-11-27, "10% yearly - M/3, D/6, H/12"): on a
// currency a Yearly ladder's 1H steps are eighteen per 10% gap (0.56%; 1H by
// 18 from the same day);
// a Monthly ladder there keeps ten.
const cv = ladderAlertLevels(yearly, true);
assert.equal(cv.length, 181, 'a currency Yearly block has 181 alert lines: eighteen per 10% gap');
assert.deepEqual(cv.slice(0, 19).map(l => l.pct), [0, 0.6, 1.1, 1.7, 2.2, 2.8, 3.3, 3.9, 4.4, 5, 5.6, 6.1, 6.7, 7.2, 7.8, 8.3, 8.9, 9.4, 10]);
assert.equal(ladderAlertLevels(monthly, true).length, 101, 'a Monthly ladder on a currency keeps ten per gap');
let crun = checkAlerts({ users: { zabs: { channels: { EURUSD: { Y: [yearly] } } } } , quotes: { q: { EURUSD: { p: 109.8, t: 'a', y: 'EURUSD=X' } } }, state: {}, now: t0 });
crun = checkAlerts({ users: { zabs: { channels: { EURUSD: { Y: [yearly] } } } }, quotes: { q: { EURUSD: { p: 111.0, h: 111.0, l: 109.8, t: 'b', y: 'EURUSD=X' } } }, state: crun.state, now: t0 + 3600e3 });
assert.deepEqual(crun.alerts.zabs.map(alertTitle), ['EURUSD · Yearly 10%', 'EURUSD · 1H 10.6%'], 'a currency Yearly ladder alerts on its 0.56% steps: ' + crun.alerts.zabs.map(alertTitle));
// The rule picks out exactly the Currency and Currency Index groups of
// Instruments.txt (by their Yahoo symbol, as quotes.json carries it), plus
// USDX, and nothing else.
const rows = readFileSync(new URL('../../../../Instruments.txt', import.meta.url), 'utf8').split('\n')
  .map(l => l.split('|').map(x => x.trim())).filter(c => c.length >= 5 && /^\d+$/.test(c[0]));
assert.ok(rows.length > 500, 'Instruments.txt read: ' + rows.length);
const wrong = rows.filter(([, y, name, group]) => isCurrencyQuote(name, { y }) !== (group === 'Currency' || group === 'Currency Index' || name === 'USDX'));
assert.deepEqual(wrong.map(r => r[2]), [], 'isCurrencyQuote matches the currency groups exactly');
assert.ok(isCurrencyQuote('USD_IDX', { y: 'CCY_USD' }) && isCurrencyQuote('USDX', { y: 'DX-Y.NYB' }) && !isCurrencyQuote('US500', { y: 'ES=F' }));

// The Worker: /push/notify checks the alerts, stores them for the owner and
// pushes ONLY the owner's phones; a failed run still reaches every phone;
// /push/inbox hands a device its owner's alerts once.
const disk = new Map();
const env = { SYNC_SECRET: 's3cret', VAPID_PRIVATE: 'AAAA',
  USER_DATA: { get: async k => disk.get(k) ?? null, put: async (k, v) => disk.set(k, v), delete: async k => disk.delete(k),
               list: async ({ prefix }) => ({ keys: [...disk.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }) } };
const zabsSub = 'https://web.push.apple.com/zabs-device', hemiSub = 'https://fcm.googleapis.com/hemi-device';
const subKey = (u, e) => { let h = 0; for (let i = 0; i < e.length; i++) h = ((h << 5) - h + e.charCodeAt(i)) | 0; return `push:${u}:${Math.abs(h).toString(36)}`; };
disk.set(subKey('zabs', zabsSub), JSON.stringify({ endpoint: zabsSub }));
disk.set(subKey('hemi', hemiSub), JSON.stringify({ endpoint: hemiSub }));
disk.set('zabs', JSON.stringify(blob));
disk.set('hemi', JSON.stringify({ channels: {} }));
let status = { state: 'ok' }, quotes = { q: { GOLD: { p: 101, t: 'a' } } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (u) => {
  const s = String(u);
  if (s.includes('/status.json')) return new Response(JSON.stringify(status));
  if (s.includes('/quotes.json')) return new Response(JSON.stringify(quotes));
  throw new Error('unexpected fetch ' + s);
};
const notify = () => worker.fetch(new Request('https://worker/push/notify', { method: 'POST', headers: { 'X-Sync-Secret': 's3cret' } }), env).then(r => r.json());
try {
  assert.equal((await worker.fetch(new Request('https://worker/push/notify', { method: 'POST' }), env)).status, 401);
  let r = await notify();
  assert.equal(r.alerts, 0); assert.equal(r.sent + r.failed, 0, 'no alert, no push: the hourly "updated" ping is gone');
  quotes = { q: { GOLD: { p: 104.5, h: 105, l: 100.5, t: 'b' } } };
  r = await notify();
  assert.equal(r.alerts, 2);
  // The test has no real VAPID key, so the push itself fails, but it is
  // attempted for zabs's one phone and not for hemi's.
  assert.equal(r.sent + r.failed + r.expired, 1, 'only the owner\'s phone is pushed');
  const inbox = q => worker.fetch(new Request('https://worker/push/inbox?endpoint=' + encodeURIComponent(q)), env).then(x => x.json());
  assert.deepEqual((await inbox(hemiSub)).alerts, [], 'another user\'s phone sees nothing');
  const got = (await inbox(zabsSub)).alerts;
  assert.deepEqual(got.map(a => a.pct), [2, 4]);
  const zabsTablet = 'https://web.push.apple.com/zabs-tablet';
  disk.set(subKey('zabs', zabsTablet), JSON.stringify({ endpoint: zabsTablet }));
  assert.deepEqual((await inbox(zabsTablet)).alerts.map(a => a.pct), [2, 4], 'every one of the owner\'s devices gets them');
  assert.deepEqual((await inbox('https://example.com/x')).alerts, [], 'an unknown endpoint gets nothing');
  // 'Aa' and 'BB' give the same 32-bit key: a colliding URL is not the device.
  const owned = 'https://web.push.apple.com/Aa', twin = 'https://web.push.apple.com/BB';
  assert.equal(subKey('zabs', owned), subKey('zabs', twin));
  disk.set(subKey('zabs', owned), JSON.stringify({ endpoint: owned }));
  assert.deepEqual((await inbox(owned)).alerts.map(a => a.pct), [2, 4]);
  assert.deepEqual((await inbox(twin)).alerts, [], 'a URL that only shares the key gets nothing');
  disk.delete(subKey('zabs', owned));
  status = { state: 'failed' };
  r = await notify();
  assert.equal(r.failed + r.sent + r.expired, 3, 'a failed run still reaches every phone');
} finally {
  globalThis.fetch = realFetch;
}
console.log('PASS: ladder line alerts (levels, crossings, repeat guard, owner-only push, inbox)');
