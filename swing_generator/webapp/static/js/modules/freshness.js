/* Quote, completed-bar and dataset times have separate meanings. */
(function (root) {
  'use strict';
  function timestamp(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? (value < 1e12 ? value * 1000 : value) : null;
    if (typeof value !== 'string' || !value.trim()) return null;
    let text = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) text += 'T00:00:00Z';
    else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(text)) text = text.replace(' ', 'T') + 'Z';
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms : null;
  }
  function age(value, now = Date.now()) { const ms = timestamp(value); return ms == null ? null : Math.max(0, now - ms); }
  function ago(value, now = Date.now()) {
    const elapsed = age(value, now);
    if (elapsed == null) return 'time unavailable';
    if (elapsed < 60000) return 'just now';
    if (elapsed < 3600000) return Math.floor(elapsed / 60000) + 'm ago';
    if (elapsed < 86400000) return Math.floor(elapsed / 3600000) + 'h ago';
    return Math.floor(elapsed / 86400000) + 'd ago';
  }
  function time(value, date = false) {
    const ms = timestamp(value);
    if (ms == null) return 'unavailable';
    return new Date(ms).toLocaleString([], date ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
  }
  // Only claim a closed session when its regular hours are known. Quote age
  // alone cannot distinguish a closed exchange from a broken price feed.
  function session({ assetClass = '', symbol = '' } = {}, now = Date.now()) {
    if (assetClass === 'Crypto' || /-USD[T]?$/.test(symbol)) return { known: true, closed: false };
    if (assetClass === 'Currency' || symbol.endsWith('=X')) {
      const d = new Date(now), day = d.getUTCDay(), hour = d.getUTCHours();
      return { known: true, closed: day === 6 || day === 5 && hour >= 22 || day === 0 && hour < 22, label: 'Market closed' };
    }
    if (assetClass !== 'Equity') return { known: false, closed: false };
    const exchanges = { '.L': ['Europe/London', 480, 990], '.DE': ['Europe/Berlin', 540, 1050], '.PA': ['Europe/Paris', 540, 1050], '.AS': ['Europe/Amsterdam', 540, 1050], '.MI': ['Europe/Rome', 540, 1050], '.MC': ['Europe/Madrid', 540, 1050], '.SW': ['Europe/Zurich', 540, 1050], '.JO': ['Africa/Johannesburg', 540, 1020], '.TO': ['America/Toronto', 570, 960], '.AX': ['Australia/Sydney', 600, 960] };
    const suffix = Object.keys(exchanges).find(key => symbol.endsWith(key));
    const hours = suffix ? exchanges[suffix] : /^[A-Z][A-Z0-9-]*$/.test(symbol) ? ['America/New_York', 570, 960] : null;
    if (!hours) return { known: false, closed: false };
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: hours[0], weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
    const get = type => parts.find(p => p.type === type).value;
    const minute = +get('hour') * 60 + +get('minute');
    return { known: true, closed: ['Sat', 'Sun'].includes(get('weekday')) || minute < hours[1] || minute >= hours[2], label: 'Session closed', note: 'Regular session hours; holidays may differ' };
  }
  function quote(value, info = {}, now = Date.now()) {
    const elapsed = age(value, now), market = session(info, now);
    if (elapsed == null) return { state: 'unknown', label: 'Quote time unavailable', detail: 'No quote timestamp received' };
    const detail = 'Last quote ' + time(value, true) + ' · ' + ago(value, now);
    if (market.closed) return { state: 'closed', label: market.label, detail: detail + (market.note ? ' · ' + market.note : '') };
    if (elapsed >= 60 * 60000) return { state: 'stale', label: 'No recent quote', detail };
    if (elapsed >= 8 * 60000) return { state: 'delayed', label: Math.floor(elapsed / 60000) + 'm delayed', detail };
    return { state: 'recent', label: 'Recent quote', detail };
  }
  function dataset(value, failed = false, now = Date.now()) {
    if (failed) return { state: 'failed', label: 'Data update failed', detail: 'Showing the last available data' };
    const elapsed = age(value, now);
    if (elapsed == null) return { state: 'unknown', label: 'Data update time unavailable', detail: '' };
    // Hourly publication runs around the clock; allow 30 minutes of headroom
    // for fetching, computation and upload before reporting an overdue update.
    const overdue = elapsed > 90 * 60000;
    return { state: overdue ? 'stale' : 'ok', label: 'Data updated ' + ago(value, now), detail: 'Last successful update ' + time(value, true) + (overdue ? ' · Update overdue' : '') };
  }
  function chart(value, tf, now = Date.now()) {
    return { label: 'Last completed ' + (tf === 'D' ? 'daily' : tf) + ' bar', time: time(value, true), age: ago(value, now) };
  }
  const api = Object.freeze({ timestamp, age, ago, time, session, quote, dataset, chart });
  (root.SwingPulseModules ||= {}).freshness = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
