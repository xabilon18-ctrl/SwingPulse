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
  // Cash indices the Watchlist prices from the INDEX itself (2026-11-02): they
  // print only in their exchange's regular hours, so before the open they read
  // "Opens 10:00" instead of a red "No recent quote". [zone, [[open, close]...]]
  // in local minutes; Hong Kong breaks for lunch. Indices priced from a
  // near-24h future (US500 via ES=F, US100, US30, RUSSELL, NI225) are NOT
  // here — their quote keeps printing outside cash hours. Yahoo carries no
  // usable future for these (measured 2026-11-02, PR #120).
  const EU = [[540, 1050]];
  const HK = [[570, 720], [780, 960]];
  const INDEX_SESSIONS = {
    '^GDAXI': ['Europe/Berlin', EU], '^STOXX50E': ['Europe/Berlin', EU], '^FCHI': ['Europe/Paris', EU],
    '^IBEX': ['Europe/Madrid', EU], '^AEX': ['Europe/Amsterdam', EU], 'FTSEMIB.MI': ['Europe/Rome', EU],
    '^SSMI': ['Europe/Zurich', EU], '^FTSE': ['Europe/London', [[480, 990]]],
    '^SOX': ['America/New_York', [[570, 960]]], '^GSPTSE': ['America/Toronto', [[570, 960]]],
    '^HSI': ['Asia/Hong_Kong', HK], '^HSCE': ['Asia/Hong_Kong', HK], '2822.HK': ['Asia/Hong_Kong', HK],
    '^TWII': ['Asia/Taipei', [[540, 810]]], '^STI': ['Asia/Singapore', [[540, 1020]]],
    '^AXJO': ['Australia/Sydney', [[600, 960]]], '^J200.JO': ['Africa/Johannesburg', [[540, 1020]]],
  };
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function localClock(zone, ms) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
    const get = type => parts.find(p => p.type === type).value;
    return { day: DAYS.indexOf(get('weekday')), minute: +get('hour') * 60 + +get('minute') };
  }
  // The next regular open as an instant. Exchange holidays are not known.
  function nextOpen(zone, spans, now) {
    const at = localClock(zone, now);
    for (let d = 0; d <= 7; d++) {
      const day = (at.day + d) % 7;
      if (day === 0 || day === 6) continue;
      for (const [open] of spans) {
        if (d === 0 && open <= at.minute) continue;
        let ms = Math.floor(now / 60000) * 60000 + (d * 1440 + open - at.minute) * 60000;
        // A daylight-saving change in between moves the wall clock: correct it.
        const drift = localClock(zone, ms).minute - open;
        if (drift) ms -= ((((drift + 720) % 1440) + 1440) % 1440 - 720) * 60000;
        return ms;
      }
    }
    return null;
  }
  function opensLabel(ms, now) {
    const d = new Date(ms), sameDay = d.toDateString() === new Date(now).toDateString();
    const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return 'Opens ' + (sameDay ? '' : d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ') + hm;
  }
  // Only claim a closed session when its regular hours are known. Quote age
  // alone cannot distinguish a closed exchange from a broken price feed.
  function session({ assetClass = '', symbol = '' } = {}, now = Date.now()) {
    // Keyed by ticker alone: SOX lives in the US100 group, so its class is Equity.
    const idx = INDEX_SESSIONS[symbol];
    if (idx) {
      const [zone, spans] = idx, at = localClock(zone, now);
      const open = at.day > 0 && at.day < 6 && spans.some(([a, b]) => at.minute >= a && at.minute < b);
      if (open) return { known: true, closed: false };
      const next = nextOpen(zone, spans, now);
      return { known: true, closed: true, label: next == null ? 'Session closed' : opensLabel(next, now),
        note: 'Session closed · regular hours; holidays may differ' };
    }
    if (assetClass === 'Crypto' || /-USD[T]?$/.test(symbol)) return { known: true, closed: false };
    if (assetClass === 'Currency' || symbol.endsWith('=X')) {
      // Forex trades Sunday 17:00 to Friday 17:00 NEW YORK time. Fixed UTC
      // hours (22:00) were right only in northern winter; in summer the market
      // opens and closes at 21:00 UTC, so the label was an hour off each end.
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
      const day = parts.find(p => p.type === 'weekday').value, hour = +parts.find(p => p.type === 'hour').value;
      return { known: true, closed: day === 'Sat' || day === 'Fri' && hour >= 17 || day === 'Sun' && hour < 17, label: 'Market closed' };
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
  function chartTime(value, tf, weekday = false, zone = false) {
    const ms = timestamp(value);
    if (ms == null) return 'unavailable';
    // Intraday feed timestamps are UTC instants; display them in the device's
    // timezone. A daily bar is a market-session date, not midnight to convert.
    const daily = tf === 'D' || /^\d{4}-\d{2}-\d{2}$/.test(String(value));
    const d = new Date(ms);
    const date = d.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', ...(weekday ? { weekday: 'short' } : {}),
      ...(daily ? { timeZone: 'UTC' } : {}),
    });
    return daily ? date : date + ' ' + d.toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      ...(zone ? { timeZoneName: 'short' } : {}),
    });
  }
  function chart(value, tf, now = Date.now(), forming = null) {
    const provisional = !!forming && forming.t === value;
    const end = provisional ? timestamp(forming.closes_at) : null;
    const state = provisional ? (end != null && now >= end ? 'Awaiting final update' : 'Still forming') : '';
    // Weekly and Monthly bars are dated like Daily ones, by their first day.
    const dated = { D: 'daily', W: 'weekly', M: 'monthly' }[tf];
    return { label: provisional ? tf + ' candle · ' + state : 'Last completed ' + (dated || tf) + ' bar', state,
      time: chartTime(value, tf), detailTime: chartTime(value, tf, false, true),
      basis: dated ? 'session date' : 'local', age: ago(value, now) };
  }
  const api = Object.freeze({ timestamp, age, ago, time, session, quote, dataset, chartTime, chart });
  (root.SwingPulseModules ||= {}).freshness = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
