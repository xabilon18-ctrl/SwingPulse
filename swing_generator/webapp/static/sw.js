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
          client.postMessage({ type: 'OPEN_TARGET', ticker: data.ticker || '', date: data.date || '' });
          return client.focus();
        }
      }
      const q = data.ticker ? `/?open=${encodeURIComponent(data.ticker)}`
              : data.date   ? `/?day=${encodeURIComponent(data.date)}`
              : '/';
      return clients.openWindow(q);
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

    // What is COMING, before what has already fired. The calendar's whole
    // claim is that the warning arrives before the event — but until now that
    // was only true if you happened to open the app on the right morning, so
    // the one failure it was built to prevent was still fully possible with
    // the phone in your pocket. Never fatal: an event feed is a nice-to-have
    // beside a signal alert, exactly as it is in the pipeline.
    try { await notifyUpcomingEvents(starred); } catch (err) {
      console.warn('[SW] event check failed:', err);
    }

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

// ── Scheduled events: warn the evening before ────────────────────────────────
// Calendar days, not the app's trading-day count. An earnings or FOMC date
// never lands on a weekend, so "today or tomorrow" needs no session arithmetic
// here — and a second copy of tradingDaysUntil() in a file that cannot import
// from app.js is exactly the kind of duplicate rule that has cost this codebase
// before. The tag is keyed on the event, so three runs a day raise it once.
async function notifyUpcomingEvents(starred) {
  const res = await fetch(`${R2_BASE}/events.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return;
  const payload = await res.json();
  const events  = payload.events || [];
  if (!events.length) return;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysOff = (str) => {
    const [y, m, d] = String(str).split('-').map(Number);
    return Math.round((new Date(y, m - 1, d) - today) / 86400000);
  };

  const starredSet = new Set(starred || []);
  for (const e of events) {
    const n = daysOff(e.date);
    if (n < 0 || n > 1) continue;
    if (e.type === 'exdiv') continue;         // not a gap risk, same as the banner
    const when = n === 0 ? 'today' : 'tomorrow';

    // A macro row carries `title` and no instrument: it hits everything, so it
    // goes out whether or not anything is starred.
    if (e.title || !e.instrument) {
      await self.registration.showNotification(`🏛 ${e.title || 'Rate decision'} ${when}`, {
        body:  `${e.time ? e.time + '  ·  ' : ''}Moves everything at once — check rate-sensitive positions.`,
        icon:  '/static/icon-192.png',
        badge: '/static/icon-192.png',
        tag:   `sp-event-${e.date}-macro`,
        data:  { date: e.date },
      });
      continue;
    }

    // An earnings date only matters for something you actually hold.
    if (!starredSet.has(e.instrument)) continue;
    await self.registration.showNotification(`📅 ${e.instrument} reports ${when}`, {
      body:  'A scheduled gap you can see coming — check size before the close.',
      icon:  '/static/icon-192.png',
      badge: '/static/icon-192.png',
      tag:   `sp-event-${e.date}-${e.instrument}`,
      data:  { ticker: e.instrument, date: e.date },
    });
  }
}

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
        icon:    '/static/icon-192.png',
        badge:   '/static/icon-192.png',
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
