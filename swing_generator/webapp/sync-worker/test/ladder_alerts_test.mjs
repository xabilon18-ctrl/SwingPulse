// Ladder line alerts (2026-11-03). Run from saved_work_test.mjs, so CI runs
// it with the sync Worker tests it already lists.
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { ladderAlertLevels, alertLadders, checkAlerts, alertTitle, REPEAT_MS } from '../src/ladder-alerts.js';

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

// A ladder drawn on Monthly (home 'M', 2026-11-13): its Daily steps are
// thirds of each Monthly 10% gap, not the 1H fifths.
const monthly = { ...ladder, link: 'L2', home: 'M' };
const mv = ladderAlertLevels(monthly);
assert.equal(mv.length, 31, 'a Monthly block has 31 alert lines: every third of 10%');
assert.deepEqual([mv[1].pct, mv[2].pct, mv[3].pct, mv[3].daily], [3.3, 6.7, 10, true]);
assert.ok(Math.abs(mv[1].price - (100 + 10 / 3)) < 1e-9, 'the first third is a third of the 10% gap up');
let mrun = checkAlerts({ users: { zabs: { channels: { GOLD: { M: [monthly], D: [{ ...monthly }] } } } }, quotes: { q: { GOLD: { p: 101, t: 'a' } } }, state: {}, now: t0 });
mrun = checkAlerts({ users: { zabs: { channels: { GOLD: { M: [monthly], D: [{ ...monthly }] } } } }, quotes: { q: { GOLD: { p: 110.5, h: 111, l: 101, t: 'b' } } }, state: mrun.state, now: t0 + 3600e3 });
assert.deepEqual(mrun.alerts.zabs.map(a => a.pct), [3.3, 6.7, 10], 'a Monthly ladder alerts on its thirds and its 10% line, once (linked copy)');
assert.deepEqual(mrun.alerts.zabs.map(alertTitle), ['GOLD · Daily 3.3%', 'GOLD · Daily 6.7%', 'GOLD · Monthly 10%']);

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
  status = { state: 'failed' };
  r = await notify();
  assert.equal(r.failed + r.sent + r.expired, 3, 'a failed run still reaches every phone');
} finally {
  globalThis.fetch = realFetch;
}
console.log('PASS: ladder line alerts (levels, crossings, repeat guard, owner-only push, inbox)');
