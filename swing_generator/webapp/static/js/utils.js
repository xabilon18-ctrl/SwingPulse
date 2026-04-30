/* ═══════════════════════════════════════════════════════════════════════════
   SwingPulse — Pure Utility Helpers
   Loaded BEFORE app.js so functions are available on window.SP_UTILS.
   These have no side effects and depend on no app state.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // Format a price with sensible decimals based on magnitude.
  function formatPrice(val) {
    if (!val && val !== 0) return '--';
    const n = parseFloat(val);
    if (isNaN(n)) return '--';
    if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n >= 10)   return n.toFixed(2);
    if (n >= 1)    return n.toFixed(4);
    return n.toFixed(6);
  }

  // Debounce: returns a function that delays calling fn until ms have passed
  // since the last invocation. Useful for input handlers that trigger renders.
  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // Convert a base64url string (VAPID public key format) to a Uint8Array
  // suitable for PushManager.subscribe({ applicationServerKey }).
  function urlBase64ToUint8Array(base64) {
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    const b = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b);
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }

  // Format a percentage with sign + 2dp (e.g. +3.50% / -1.20%).
  function formatPct(val) {
    if (val === null || val === undefined || isNaN(val)) return '--';
    return (val >= 0 ? '+' : '') + parseFloat(val).toFixed(2) + '%';
  }

  // Format an R-multiple with sign + 2dp (e.g. +1.50R / -0.50R).
  function formatR(val) {
    if (val === null || val === undefined || isNaN(val)) return '--';
    return (val > 0 ? '+' : '') + parseFloat(val).toFixed(2) + 'R';
  }

  // Safe HTML-escape so user notes can't break the DOM.
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  window.SP_UTILS = {
    formatPrice,
    debounce,
    urlBase64ToUint8Array,
    formatPct,
    formatR,
    escapeHtml,
  };
})();
