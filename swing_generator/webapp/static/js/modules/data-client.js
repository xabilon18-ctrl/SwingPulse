/* Bounded data requests, shared by the app and saved-work controls. */
(function (root) {
  'use strict';
  async function request(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { cache: 'no-cache', ...options, signal: controller.signal });
      if (!response.ok) { const e = new Error('Request failed (' + response.status + ')'); e.status = response.status; throw e; }
      return await response.json();
    } finally { clearTimeout(timeout); }
  }
  async function fetchJson(url, fallback) { try { return await request(url); } catch (_) { return fallback; } }
  const api = Object.freeze({ request, fetchJson });
  (root.SwingPulseModules ||= {}).dataClient = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
