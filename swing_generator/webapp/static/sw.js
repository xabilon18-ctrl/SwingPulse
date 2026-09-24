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
    // per-instrument alerts: no signal notifications and no earnings notices.
    // Macro events hit everything, so those still go out. A push must ALWAYS
    // show something — iOS revokes a web-push subscription that receives
    // pushes without a notification — so the plain update notice stays.
    try { await notifyUpcomingEvents([]); } catch (err) {
      console.warn('[SW] event check failed:', err);
    }
    await self.registration.showNotification('SwingPulse', {
      body:  'SwingPulse updated — tap to open.',
      icon:  '/static/icon-192.png',
      badge: '/static/icon-192.png',
      tag:   'sp-generic',
    });
  })());
});

// ── Scheduled events: warn the evening before ────────────────────────────────
// Calendar days, not the app's trading-day count. An earnings or FOMC date
// never lands on a weekend, so "today or tomorrow" needs no session arithmetic
// here — and a second copy of tradingDaysUntil() in a file that cannot import
// from app.js is exactly the kind of duplicate rule that has cost this codebase
// before. The tag is keyed on the event, so three runs a day raise it once.
async function notifyUpcomingEvents(starred) {   // [] since stars were removed
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
