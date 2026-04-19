/* SwingPulse Service Worker — Push Notifications */
const R2_BASE = 'https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ── Notification click: focus or open the app ────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});

// ── Message from main thread ─────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'CHECK_SIGNALS') {
    checkForNewSignals(e.data.starred, e.data.lastSeen);
  }
});

// ── Core check: fetch latest signals, notify on new ones for starred tickers ─
async function checkForNewSignals(starred, lastSeen) {
  if (!starred || starred.length === 0) return;
  try {
    const res = await fetch(`${R2_BASE}/signals.json?t=${Date.now()}`);
    if (!res.ok) return;
    const json = await res.json();
    const signals = json.data || [];
    const starredSet = new Set(starred);

    for (const item of signals) {
      const name = item.instrument_name;
      if (!starredSet.has(name)) continue;

      const current   = item.primary_signal || '';
      const conf      = item.confirmation_status || '';
      const prevSig   = (lastSeen[name] || {}).signal || '';
      const prevConf  = (lastSeen[name] || {}).conf   || '';

      // Notify when a brand-new primary signal fires OR confirmation changes
      if (!current) continue;
      if (current === prevSig && conf === prevConf) continue;

      const isBuy  = conf.toLowerCase().includes('buy');
      const isSell = conf.toLowerCase().includes('sell');
      const emoji  = isBuy ? '📈' : isSell ? '📉' : '⚡';

      await self.registration.showNotification(`${emoji} ${name} — New Signal`, {
        body:    `${current}${conf ? '  ·  ' + conf : ''}  ·  ${item.group || ''}`,
        icon:    '/static/img/icon-192.png',
        badge:   '/static/img/icon-192.png',
        tag:     `sp-signal-${name}`,
        renotify: true,
        data:    { ticker: name },
        vibrate: [200, 100, 200],
      });
    }

    // Tell all open clients to refresh their lastSeen store
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    allClients.forEach(c => c.postMessage({ type: 'SIGNALS_CHECKED' }));
  } catch (err) {
    console.warn('[SW] signal check failed:', err);
  }
}
