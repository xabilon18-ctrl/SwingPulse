// LADDER LINE ALERTS (user, 2026-11-03: "I need an option to set alerts on
// the percentage lines daily and hourly", then: a phone notification, on the
// Daily lines AND the 1H steps). A ladder carries `alert: true` when the user
// switches its bell on. After every data run CI calls /push/notify; the
// Worker then checks each such ladder's lines against the price range since
// the previous run (quotes.json `p`, `h`, `l`) and notifies that user's
// phones. Pure functions here so they can be tested without a Worker.

// A ladder block is 0..100%. Its Daily lines are every 10%; on 1H each Daily
// gap is split into LADDER_SUB steps (app.js LADDER_SUB_BY_TF['1H']), so the
// alert lines are every 100 / (10 * LADDER_SUB) = 2% (2.5% for part of
// 2026-11-04, then back to 2% at the user's request).
export const LADDER_SUB = 5;
// A ladder drawn on Monthly (`home: 'M'`, 2026-11-13) is split on Daily
// instead, each 10% gap in three: its alert lines are the Monthly 10% lines
// and the Daily thirds. Keep equal to app.js LADDER_HOME_SUB.M.D.
export const HOME_SUB = { M: 3 };
const subOf = d => (d && HOME_SUB[d.home]) || LADDER_SUB;
// The same line does not alert again for this long.
export const REPEAT_MS = 6 * 60 * 60 * 1000;
// Safety cap per user per run: a huge move through a wide stack of ladders
// must not bury the phone.
export const MAX_PER_RUN = 12;

const stack = (d, dir) => Math.max(0, Math.floor(Number(d && d[dir]) || 0));

// Every alert line of one ladder: { price, pct, daily }. Mirrors app.js
// ladderLines (p1 = 0%, p4 = 30%, the stored step u = (p4 - p1) / 3, ten
// steps a block, stacks continue the numbering) at the 1H 2% resolution.
export function ladderAlertLevels(d) {
  if (!d || d.kind !== 'ladder') return [];
  const u = (Number(d.p4) - Number(d.p1)) / 3;
  if (!Number.isFinite(u) || !u || !Number.isFinite(Number(d.p1))) return [];
  const sub = subOf(d);
  const per = 10 * sub;                              // lines per block
  const lo = -per * stack(d, 'down'), hi = per * (1 + stack(d, 'up'));
  const out = [];
  for (let j = lo; j <= hi; j++) {
    const price = Number(d.p1) + j * u / sub;
    if (price < 0) continue;
    const pct = Math.round((d.reverse ? per - j : j) * (100 / per) * 10) / 10 + 0;   // + 0: never -0
    out.push({ price, pct, daily: Math.abs(pct / 10 - Math.round(pct / 10)) < 1e-9 });
  }
  return out;
}

// The ladders a user has switched alerts on for: [{ name, id, d }]. A linked
// ladder is copied onto every timeframe; it counts once.
export function alertLadders(blob) {
  const out = [], seen = new Set();
  const channels = blob && typeof blob.channels === 'object' ? blob.channels : {};
  for (const name of Object.keys(channels)) {
    const per = channels[name];
    if (!per || typeof per !== 'object') continue;
    for (const tf of Object.keys(per)) {
      const list = Array.isArray(per[tf]) ? per[tf] : [];
      for (const d of list) {
        if (!d || d.kind !== 'ladder' || !d.alert) continue;
        const id = d.link || `${tf}:${d.p1}:${d.p4}`;
        const k = name + '|' + id;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ name, id, d });
      }
    }
  }
  return out;
}

// One run. users: { user: blob }, quotes: quotes.json, state: the previous
// run's { prev: {name: price}, t: {name: quote time}, fired: {key: ms} }.
// Returns { alerts: { user: [alert] }, state, changed }.
export function checkAlerts({ users, quotes, state, now }) {
  const q = (quotes && quotes.q) || {};
  const prevState = state && typeof state === 'object' ? state : {};
  const prev = { ...(prevState.prev || {}) }, seenT = { ...(prevState.t || {}) };
  const fired = {};
  for (const [k, at] of Object.entries(prevState.fired || {})) if (now - at < REPEAT_MS) fired[k] = at;
  const alerts = {}, watched = new Set();
  for (const user of Object.keys(users || {})) {
    for (const { name, id, d } of alertLadders(users[user])) {
      watched.add(name);
      const quote = q[name];
      if (!quote || !(quote.p > 0)) continue;
      // No new data for this market since the last run (closed, or a run
      // that did not refresh it): nothing can have been crossed.
      if (seenT[name] && seenT[name] === quote.t) continue;
      const before = prev[name];
      const lo = Math.min(quote.l ?? quote.p, before ?? quote.p, quote.p);
      const hi = Math.max(quote.h ?? quote.p, before ?? quote.p, quote.p);
      for (const lv of ladderAlertLevels(d)) {
        if (lv.price < lo || lv.price > hi) continue;
        const key = `${user}|${name}|${id}|${lv.pct}`;
        if (fired[key]) continue;
        const list = alerts[user] || (alerts[user] = []);
        if (list.length >= MAX_PER_RUN) break;
        fired[key] = now;
        list.push({ name, pct: lv.pct, daily: lv.daily, ...(HOME_SUB[d.home] ? { home: d.home } : {}), level: lv.price, price: quote.p,
                    dir: before == null ? (quote.p >= lv.price ? 'up' : 'down') : (before < lv.price ? 'up' : 'down'), at: now });
      }
    }
  }
  // Remember the latest price of every watched market, and only those.
  const nextPrev = {}, nextT = {};
  for (const name of watched) {
    const quote = q[name];
    if (quote && quote.p > 0) { nextPrev[name] = quote.p; nextT[name] = quote.t; }
    else if (prev[name] != null) { nextPrev[name] = prev[name]; nextT[name] = seenT[name]; }
  }
  const next = { prev: nextPrev, t: nextT, fired };
  return { alerts, state: next, changed: JSON.stringify(next) !== JSON.stringify(prevState) };
}

// Notification text, shared by the Worker test and the service worker logic.
export function alertTitle(a) {
  // `daily` marks the ladder's own 10% lines (the name is from Daily ladders).
  const [own, step] = a.home === 'M' ? ['Monthly', 'Daily'] : ['Daily', '1H'];
  return `${a.name} · ${a.daily ? own : step} ${a.pct}%`;
}
