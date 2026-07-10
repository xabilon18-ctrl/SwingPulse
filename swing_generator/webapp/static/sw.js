/* SwingPulse Service Worker — Push Notifications */
const R2_BASE = 'SW_R2_BASE_URL';  // replaced by publish.py per profile

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
  if (!e.data) return;
  if (e.data.type === 'CHECK_SIGNALS') {
    checkForNewSignals(e.data.starred, e.data.lastSeen);
  }
  if (e.data.type === 'CACHE_USER_STATE') {
    // Cache user state in IndexedDB so background push handler can use it
    cacheUserState(e.data.starred, e.data.lastSeen);
  }
});

// ── IDB helpers (stash starred + lastSeen for the push event) ──────────────
function idbOpen() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('sp-push', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('state');
    r.onsuccess = () => resolve(r.result);
    r.onerror   = () => reject(r.error);
  });
}
async function cacheUserState(starred, lastSeen) {
  const db = await idbOpen();
  const tx = db.transaction('state', 'readwrite');
  tx.objectStore('state').put({ starred: starred || [], lastSeen: lastSeen || {} }, 'user');
  return new Promise(r => { tx.oncomplete = r; });
}
async function readUserState() {
  try {
    const db = await idbOpen();
    return await new Promise(resolve => {
      const tx = db.transaction('state', 'readonly');
      const req = tx.objectStore('state').get('user');
      req.onsuccess = () => resolve(req.result || {});
      req.onerror   = () => resolve({});
    });
  } catch { return {}; }
}

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

    const state = await readUserState();
    const starred  = state.starred  || [];
    const lastSeen = state.lastSeen || {};
    if (!starred.length) {
      await self.registration.showNotification('SwingPulse', {
        body:  'New signals — tap to open and check your analyzed charts.',
        icon:  '/static/icon-192.png',
        badge: '/static/icon-192.png',
        tag:   'sp-generic',
      });
      return;
    }
    await checkForNewSignals(starred, lastSeen);
  })());
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
