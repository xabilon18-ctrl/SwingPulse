/* SwingPulse Service Worker — Push Notifications */
const R2_BASE = 'SW_R2_BASE_URL';  // replaced by publish.py per profile

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ── Notification click: focus or open the app ────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  // The notification has always carried what it was about; nothing ever read
  // it, so every tap landed on the dashboard and left you to find the thing
  // yourself. An open client is told where to go; a cold start is asked to.
  const data = e.notification.data || {};
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) {
          client.postMessage({ type: 'OPEN_TARGET', ticker: data.ticker || '' });
          return client.focus();
        }
      }
      const q = data.ticker ? `/?open=${encodeURIComponent(data.ticker)}` : '/';
      return clients.openWindow(q);
    })
  );
});

// ── Push event: fires when Worker sends an empty VAPID push ─────────────────
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    // Pipeline health first: the CI failure step flips status.json to
    // 'failed' and fans out a push — surface that instead of signal news.
    try {
      const sr = await fetch(`${R2_BASE}/status.json?t=${Date.now()}`, { cache: 'no-store' });
      if (sr.ok) {
        const st = await sr.json();
        if (st.state === 'failed' && Date.now() - Date.parse(st.at) < 12 * 3600e3) {
          await self.registration.showNotification('SwingPulse — update FAILED', {
            body:  'The scheduled data run failed. Signals may be stale — check GitHub Actions.',
            icon:  '/static/icon-192.png',
            badge: '/static/icon-192.png',
            tag:   'sp-run-failed',
          });
          return;
        }
      }
    } catch {}

    // Stars were removed 2026-09-24 (user decision), and with them the
    // per-instrument alerts; the event calendar and its evening-before
    // warnings went 2026-10-21. A push must ALWAYS show something — iOS
    // revokes a web-push subscription that receives pushes without a
    // notification — so the plain update notice stays.
    await self.registration.showNotification('SwingPulse', {
      body:  'SwingPulse updated — tap to open.',
      icon:  '/static/icon-192.png',
      badge: '/static/icon-192.png',
      tag:   'sp-generic',
    });
  })());
});
