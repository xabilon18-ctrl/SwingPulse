/* Visible Watchlist quote polling; DOM rendering belongs to the Watchlist. */
(function (root) {
  'use strict';
  function create({ url, getQuotes, getVisibleNames, isActive, onUpdate, onUnavailable, fetcher = (...args) => fetch(...args), timeoutMs = 12000, intervalMs = 30000 }) {
    const quotes = {};
    let busy = false, timer = 0, lastReceivedAt = 0;
    async function poll() {
      if (busy || !isActive()) return false;
      const names = getVisibleNames(), data = getQuotes();
      if (!data || !names.length) return false;
      const symbols = new Set();
      names.forEach(n => { const q = data.q[n]; if (q) { if (q.y) symbols.add(q.y); if (q.yc) symbols.add(q.yc); } });
      if (!symbols.size) return false;
      busy = true;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(url + '?s=' + [...symbols].map(encodeURIComponent).join(','), { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Price feed unavailable');
        const got = await response.json();
        const valid = v => Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]) && v[1] > 0;
        let received = 0;
        names.forEach(n => {
          const q = data.q[n]; if (!q) return;
          const choices = [];
          if (q.y && valid(got && got[q.y])) choices.push({ p: got[q.y][0] - (q.b || 0), t: got[q.y][1] });
          if (q.yc && valid(got && got[q.yc])) choices.push({ p: got[q.yc][0], t: got[q.yc][1] });
          choices.sort((a, b) => b.t - a.t);
          if (choices.length) {
            if (!quotes[n] || choices[0].t >= quotes[n].t) quotes[n] = choices[0];
            received++;
          }
        });
        if (!received) throw new Error('No quotes received');
        lastReceivedAt = Date.now();
        onUpdate(names, lastReceivedAt);
        return true;
      } catch (_) { onUnavailable(names); return false; }
      finally { clearTimeout(timeout); busy = false; }
    }
    function start() { if (!timer) { poll(); timer = setInterval(poll, intervalMs); } }
    function stop() { if (timer) clearInterval(timer); timer = 0; }
    return { quotes, poll, start, stop, get running() { return !!timer; }, get busy() { return busy; }, get lastReceivedAt() { return lastReceivedAt; } };
  }
  const api = Object.freeze({ create });
  (root.SwingPulseModules ||= {}).livePrices = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
