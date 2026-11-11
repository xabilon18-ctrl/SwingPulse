/* Formatting helpers: numbers, prices, percentages, dates and HTML-safe text.
   Pure functions (no app state), moved out of app.js on 2026-11-11. app.js
   reads them back as window.SwingPulseModules.format. */
(function (root) {
  'use strict';
  // Whole days between two YYYY-MM-DD strings, both read as UTC midnight so the
  // result can't slip a day in a negative-offset timezone. `asOfStr` omitted
  // falls back to the wall clock. Returns null on an unparseable date.
  function daysBetween(dateStr, asOfStr) {
    const utc = s => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
      return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
    };
    const from = utc(dateStr);
    if (isNaN(from)) return null;
    let to = utc(asOfStr);
    if (isNaN(to)) {
      const n = new Date();
      to = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
    }
    return Math.max(0, Math.round((to - from) / 86400000));
  }

  // Format an RVOL ratio as a compact "1.8×" style string.
  function fmtRvol(r) {
    if (r === null) return '';
    return (r >= 9.95 ? Math.round(r) : r.toFixed(1)) + '×';
  }

  function fmtPvo(v) {
    return (v >= 0 ? '+' : '') + v.toFixed(1);
  }

  // Compact volume: 1,234,567 → "1.2M". Used in the modal's Volume tiles
  // where full thousands-separated numbers don't fit.
  function fmtVol(v) {
    if (!isFinite(v) || v <= 0) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(v >= 1e10 ? 0 : 1) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'K';
    return String(Math.round(v));
  }

  // Price with thousands separators and decimals that suit its size.
  function wlFmtPrice(v) {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v), dec = a >= 1000 ? 1 : a >= 10 ? 2 : a >= 1 ? 4 : 5;
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: a >= 1000 ? 0 : dec, maximumFractionDigits: dec });
  }

  function wlFmtPct(v) {
    if (v == null || !isFinite(v)) return '';
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '%';
  }

  function wlFmtChange(v, ref) {
    if (v == null || !isFinite(v)) return '';
    const a = Math.abs(v), dec = ref >= 1000 ? 1 : ref >= 10 ? 2 : ref >= 1 ? 3 : 5;
    return (v > 0 ? '+' : v < 0 ? '−' : '') + a.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  // Debounce helper — avoids re-rendering on every single keystroke
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /** Escape text bound for innerHTML. Instrument names come from the data
   *  pipeline, not from us — "Procter & Gamble" and friends must not be able
   *  to break the markup they are dropped into. */
  function escText(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatPrice(val) {
    if (!val && val !== 0) return '--';
    const n = parseFloat(val);
    if (isNaN(n)) return '--';
    if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n >= 10)   return n.toFixed(2);
    if (n >= 1)    return n.toFixed(4);
    return n.toFixed(6);
  }

  // Convert backtest.py's generated_at ("YYYY-MM-DD HH:MM UTC") to local time
  function formatGeneratedAt(s) {
    if (!s) return '';
    // Parse "2026-04-30 18:46 UTC" as ISO so JS can convert to local time
    const m = s.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}).*UTC$/);
    if (!m) return s;
    const d = new Date(`${m[1]}T${m[2]}:00Z`);
    if (isNaN(d.getTime())) return s;
    const dateStr = d.toLocaleDateString();
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${dateStr} ${timeStr}`;
  }

  const api = Object.freeze({ daysBetween, fmtRvol, fmtPvo, fmtVol, wlFmtPrice, wlFmtPct, wlFmtChange, debounce, escText, formatPrice, formatGeneratedAt });
  (root.SwingPulseModules ||= {}).format = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
