/* SwingPulse Service Worker — Push Notifications */
const R2_BASE = 'SW_R2_BASE_URL';  // replaced by publish.py per profile
const SYNC_BASE = 'https://swingpulse-sync.xabilon18.workers.dev';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ── Notification click: focus or open the app ────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  // The notification has always carried what it was about; nothing ever read
  // it, so every tap landed on the dashboard and left you to find the thing
  // yourself. An open client is told where to go; a cold start is asked to.
  const data = e.notification.data || {};
  // A ladder line alert opens its chart on the timeframe of the line.
  if (data.chart) {
    const q = `/?chart=${encodeURIComponent(data.chart)}&tf=${encodeURIComponent(data.tf || 'D')}`;
    e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) {
          client.postMessage({ type: 'OPEN_CHART', chart: data.chart, tf: data.tf || 'D' });
          return client.focus();
        }
      }
      return clients.openWindow(q);
    }));
    return;
  }
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

    // Ladder line alerts (2026-11-03). The push is empty: ask the sync Worker
    // what this device's owner was alerted to in this run.
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub) {
        const r = await fetch(`${SYNC_BASE}/push/inbox?endpoint=${encodeURIComponent(sub.endpoint)}`, { cache: 'no-store' });
        const j = r.ok ? await r.json() : null;
        const list = j && Array.isArray(j.alerts) ? j.alerts : [];
        if (list.length) { await showLadderAlerts(list); return; }
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

// One notification per line, up to SHOW_MAX; the rest summed up in the last.
const SHOW_MAX = 4;
function fmtPrice(x) {
  const v = Number(x);
  return v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 2 : v >= 1 ? 4 : 6 });
}
async function showLadderAlerts(list) {
  const shown = list.slice(0, SHOW_MAX);
  const extra = list.length - shown.length;
  for (let i = 0; i < shown.length; i++) {
    const a = shown[i];
    const what = `${a.daily ? 'Daily' : '1H'} ${a.pct}%`;
    let body = `${a.dir === 'up' ? 'Up' : 'Down'} to ${fmtPrice(a.price)}, through your ${what} line at ${fmtPrice(a.level)}`;
    if (i === shown.length - 1 && extra > 0) body += ` (+${extra} more)`;
    await self.registration.showNotification(`${a.name} · ${what}`, {
      body,
      icon:  '/static/icon-192.png',
      badge: '/static/icon-192.png',
      tag:   `sp-alert-${a.name}-${a.pct}`,
      data:  { chart: a.name, tf: a.daily ? 'D' : '1H' },
    });
  }
}
