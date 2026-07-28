/* ═══════════════════════════════════════════════════════════════════════════
   SwingPulse — Interactive Trading Dashboard  (TradingView Integration)
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Pure utilities loaded from utils.js (window.SP_UTILS) ────────────
  // Aliased here so the rest of the file can use them as plain locals.
  // If utils.js failed to load, fall back to inline definitions below
  // so app.js still works (defensive).
  const SPU = window.SP_UTILS || {};
  // (formatPrice, debounce, urlBase64ToUint8Array re-defined below as
  //  fallbacks if utils.js didn't load — kept identical to utils.js)

  // ── State ────────────────────────────────────────────────────────────
  let allData = [];
  let summaryData = {};
  let backtestData = null;   // { overall, by_signal, generated_at } from backtest.py
  let ledgerData = null;     // { totals, by_signal, by_code } from signal_ledger.py (live fires)
  let sectorRadarData = null; // { sectors, baseline_days, alert_z } from sector_activity.py
  let instFlavours = {};      // { instrument_name: flavour } — sector-mood conviction layer (validated on real R 2026-07-22)
  let flavourMkt = { market_wide: false }; // top-level market-state from instrument_flavours.json
  let tvMap = {};            // instrument_name → TradingView symbol
  let aiSet = new Set();     // instruments with AI exposure
  let aiFilterActive = false;
  let currentTab = 'dashboard';
  let activeHeatmapGroup = 'all';
  let activeStatFilter = '';      // stat card rearrange filter
  let activeHmLegendFilter = ''; // legend click hard-filter: 'buy','sell','neutral','watch'
  let activeTrendFilter    = ''; // pulse trend filter: 'UPTREND','DOWNTREND','NEUTRAL'
  let activeAlignFilter    = ''; // pulse alignment filter: e.g. 'Triple Bull'
  let activeScannerFilter = 'all';
  // Class chips (Crypto / Indices / Banks / Tech / …). These used to work by
  // writing their term into the search box, which made every other chip filter
  // silently switch off — see the note on the chip handler.
  let scannerCatFilter = '';
  // Dashboard cards that jump into the Signals tab with a search term must drop
  // any class chip first, or the jump lands pre-narrowed for no visible reason.
  function clearCatChip() {
    scannerCatFilter = '';
    document.querySelectorAll('#scannerCatChips .s-cat-chip.active')
      .forEach(c => c.classList.remove('active'));
  }
  let scannerMoodFilter = 'all';   // sector-mood filter (all/confirmed/fighting/calm/distributing/active/churn/mixed/marketwide)
  let scannerSort = 'signal';
  let scannerView = 'list';   // 'list' | 'ranked'
  let gpViewMode = 'region';   // 'group' | 'region'
  let activeRegionFilter = ''; // when set, scanner filters to all groups in this region
  const SCANNER_PAGE_SIZE = 100;   // cards rendered per page (keeps DOM manageable)
  let scannerPage = 1;             // how many pages shown so far
  let wlFilter = 'all';
  let wlSort = 'signal';
  let activeAlertTab = 'keylvl';
  // ── Cross-device Sync ────────────────────────────────────────────────
  const SYNC_WORKER = 'https://swingpulse-sync.xabilon18.workers.dev';
  const SYNC_SECRET = 'swingpulse2026';
  let syncUser = localStorage.getItem('sp-user') || '';

  // Per-user TV layout defaults for this profile — injected by publish.py at build time
  const TV_LAYOUT_DEFAULTS = {
    'zabs': 'ZABS_TV_LAYOUT_ID',
    'hemi': 'HEMI_TV_LAYOUT_ID',
  };
  function userTvLayout() {
    // User's saved layout takes priority; fall back to their profile default
    return localStorage.getItem(sk('sp-tv-layout'))
      || TV_LAYOUT_DEFAULTS[syncUser]
      || '';
  }
  let syncPushTimer = null;

  // Storage key namespaced by active user so Zabs & Hemi never share local state
  function sk(base) { return syncUser ? `${base}__${syncUser}` : base; }

  // Migrate legacy (non-namespaced) data into the user's own bucket on first run
  function migrateUserData() {
    if (!syncUser) return;
    ['swingpulse-starred','sp-notes','sp-open-trades','sp-closed-trades','sp-last-modified'].forEach(base => {
      const legacy = localStorage.getItem(base);
      if (legacy !== null && localStorage.getItem(sk(base)) === null) {
        localStorage.setItem(sk(base), legacy);
      }
    });
  }
  migrateUserData();

  let userStarred = new Set(JSON.parse(localStorage.getItem(sk('swingpulse-starred')) || '[]'));
  let charts = {};
  let timeframe = '4H';
  let openModalName = null;   // instrument whose detail modal is currently open (for tf re-render)
  let trendsData = {};       // instrument_name → [{direction, start, end, days}]
  let selectedTrendInst = null;
  localStorage.removeItem('sp-signal-history');   // retired per-device tracker (2026-07-15)
  let explanationsData = {};                                                    // instrument_name → AI text
  let instrumentNotes  = JSON.parse(localStorage.getItem(sk('sp-notes')) || '{}'); // instrument_name → note text
  let namesData        = {};   // ticker → full display name (e.g. 'NVDA' → 'NVIDIA')

  function syncApplyRemote(remote) {
    // Apply remote data, then re-render affected sections
    if (Array.isArray(remote.starred)) {
      userStarred = new Set(remote.starred);
      localStorage.setItem(sk('swingpulse-starred'), JSON.stringify(remote.starred));
    }
    if (remote.notes && typeof remote.notes === 'object') {
      instrumentNotes = remote.notes;
      localStorage.setItem(sk('sp-notes'), JSON.stringify(instrumentNotes));
    }
    localStorage.setItem(sk('sp-last-modified'), String(remote.lastModified || Date.now()));
  }

  async function syncPull() {
    if (!syncUser) return;
    const badge = document.getElementById('syncUserBadge');
    try {
      const res = await fetch(`${SYNC_WORKER}/sync?user=${syncUser}`, { cache: 'no-store' });
      if (!res.ok) return;
      const remote = await res.json();
      if (!remote || !remote.lastModified) return;
      const localMod = parseInt(localStorage.getItem(sk('sp-last-modified')) || '0');
      if (remote.lastModified > localMod) {
        syncApplyRemote(remote);
        // Full re-render so every tab (signals, scanner, watchlist) reflects synced data
        if (allData.length) renderAll();
        if (badge) { badge.title = `${syncUser} — synced just now`; }
      }
    } catch (_) { /* offline — silent */
      if (badge) badge.title = `${syncUser} — offline, sync pending`;
    }
  }

  function syncPushNow() {
    if (!syncUser) return;
    const payload = JSON.stringify({
      starred:      [...userStarred],
      notes:        instrumentNotes,
      lastModified: Date.now(),
    });
    localStorage.setItem(sk('sp-last-modified'), String(Date.now()));
    fetch(`${SYNC_WORKER}/sync?user=${syncUser}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Sync-Secret': SYNC_SECRET },
      body:    payload,
    }).catch(() => { /* offline — silent */ });
  }

  // Debounce pushes so rapid changes (e.g. starring several instruments) send one request
  function syncPush() {
    clearTimeout(syncPushTimer);
    syncPushTimer = setTimeout(syncPushNow, 800);
  }

  function showUserPicker() {
    const overlay = document.getElementById('userPickerOverlay');
    if (overlay) overlay.style.display = 'flex';
  }

  window.toggleAIFilter = toggleAIFilter;   // exposed for nav button onclick

  window.SP_setUser = function(name) {
    syncUser = name.toLowerCase();
    localStorage.setItem('sp-user', syncUser);
    // Migrate any legacy (non-namespaced) data into this user's bucket
    migrateUserData();
    // Reload user-specific data from their own storage bucket
    userStarred    = new Set(JSON.parse(localStorage.getItem(sk('swingpulse-starred')) || '[]'));
    instrumentNotes = JSON.parse(localStorage.getItem(sk('sp-notes')) || '{}');
    const overlay = document.getElementById('userPickerOverlay');
    if (overlay) overlay.style.display = 'none';
    updateSyncBadge();
    // Pull remote data and do a full re-render so all tabs update immediately
    syncPull().then(() => { if (allData.length) renderAll(); });
  };

  function updateSyncBadge() {
    const badge = document.getElementById('syncUserBadge');
    if (!badge) return;
    badge.textContent = syncUser ? syncUser.charAt(0).toUpperCase() + syncUser.slice(1) : '?';
    badge.title = syncUser ? `Syncing as ${syncUser} — tap to switch user` : 'Tap to set user';
    badge.classList.toggle('sync-name-unset', !syncUser);
  }

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

  // ── Signal Performance ("since fired") ───────────────────────────────
  // Engine-computed: last_signal_price is the fire-bar close, last_signal_date
  // the fire date (up to 20 bars back within the same trend). Same on every device.
  // Age counts from the item's own latest BAR date, not the wall clock — a fire
  // on the newest bar is 0d old however long the calendar has since moved on.
  function signalPerf(item) {
    const sig   = item[f('last_signal_type')] || '';
    const fired = parseFloat(item[f('last_signal_price')]) || 0;
    const cur   = parseFloat(item[f('close')]) || 0;
    const date  = item[f('last_signal_date')] || '';
    if (!sig || !fired || !cur || !date) return null;
    const pct  = ((cur - fired) / fired) * 100;
    const days = daysBetween(date, item[f('date')]);
    return { pct: pct.toFixed(1), days: days === null ? 0 : days, date, signal: sig };
  }

  // ── Push Notifications ───────────────────────────────────────────────
  let swRegistration = null;

  async function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      swRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    } catch(err) {
      console.warn('SW registration failed:', err);
    }
  }

  async function requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  // Notification dedup store — last signal/conf handed to the SW per instrument.
  // Daily TF only (sw.js checkForNewSignals compares item.primary_signal).
  // Per-device by design: each device dedups its own notifications.
  let notifiedSignals = JSON.parse(localStorage.getItem('sp-last-notified') || '{}');

  function updateNotifiedStore() {
    let changed = false;
    for (const item of allData) {
      const name = item.instrument_name;
      const sig  = item.primary_signal || '';
      const conf = item.confirmation_status || '';
      const prev = notifiedSignals[name];
      if (sig) {
        if (!prev || prev.signal !== sig || prev.conf !== conf) {
          notifiedSignals[name] = { signal: sig, conf };
          changed = true;
        }
      } else if (prev) {
        delete notifiedSignals[name];
        changed = true;
      }
    }
    if (changed) localStorage.setItem('sp-last-notified', JSON.stringify(notifiedSignals));
  }

  function checkAndNotifyNewSignals() {
    if (!swRegistration || !allData.length) return;
    if (Notification.permission !== 'granted') return;
    const starred = [...userStarred];
    if (!starred.length) return;
    const lastSeen = notifiedSignals;
    navigator.serviceWorker.ready.then(reg => {
      if (!reg.active) return;
      reg.active.postMessage({ type: 'CHECK_SIGNALS', starred, lastSeen });
      // Also cache state in IDB for the background push handler
      reg.active.postMessage({ type: 'CACHE_USER_STATE', starred, lastSeen });
    });
  }

  // ── Web Push subscribe (background notifications) ─────────────────────
  const VAPID_PUBLIC_KEY = 'BOO2qQLHIMhVkOKGkL2ClLs2RPVz_Lc5y10woA_OaU0FdAoFVYU4ZrWDy-OSzg6-TBgxELpbmKlrsahsdlN4i_w';

  function urlBase64ToUint8Array(base64) {
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    const b = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b);
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }

  async function subscribeToPush() {
    if (!swRegistration || !syncUser) return false;
    if (!('PushManager' in window)) return false;
    try {
      const granted = await requestNotificationPermission();
      if (!granted) return false;
      let sub = await swRegistration.pushManager.getSubscription();
      if (!sub) {
        sub = await swRegistration.pushManager.subscribe({
          userVisibleOnly:      true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }
      // POST to Worker
      const res = await fetch(`${SYNC_WORKER}/push/subscribe?user=${syncUser}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(sub),
      });
      if (res.ok) {
        localStorage.setItem(sk('sp-push-enabled'), '1');
        updatePushBadgeUI();
        return true;
      }
    } catch (e) {
      console.warn('[push] subscribe failed:', e);
    }
    return false;
  }

  async function unsubscribeFromPush() {
    if (!swRegistration || !syncUser) return;
    try {
      const sub = await swRegistration.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      await fetch(`${SYNC_WORKER}/push/subscribe?user=${syncUser}`, { method: 'DELETE' });
      localStorage.removeItem(sk('sp-push-enabled'));
      updatePushBadgeUI();
    } catch (e) {
      console.warn('[push] unsubscribe failed:', e);
    }
  }

  function isPushEnabled() {
    // Notification is undefined in iOS Safari outside an installed PWA
    return localStorage.getItem(sk('sp-push-enabled')) === '1'
      && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  }

  function updatePushBadgeUI() {
    const btn = document.getElementById('pushToggleBtn');
    if (!btn) return;
    const on = isPushEnabled();
    btn.classList.toggle('push-on', on);
    btn.title = 'Notifications';
    // Always the solid bell — the green live dot (.push-on::after) is the
    // on/off indicator; a dashed bell reads as a broken icon at 16px.
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
    const pt = document.getElementById('notifPushToggle');
    if (pt) {
      pt.textContent = on ? 'Push: on' : 'Push: off';
      pt.classList.toggle('push-on', on);
    }
  }

  // Default MA periods. Will be overwritten by auto-detection once data loads —
  // this makes the app work correctly across MA scheme changes without code edits.
  let detectedMaPeriods = [25,50,75,100,125,150,175,200,225,250,275,300,325,350,375,400,425,450,475,500];
  function activeMaPeriods() {
    return detectedMaPeriods;
  }
  function detectMaPeriodsFromData(data) {
    if (!data || !data.length) return;
    const row = data[0];
    const found = Object.keys(row)
      .filter(k => /^ma_\d+$/.test(k))
      .map(k => parseInt(k.slice(3), 10))
      .sort((a, b) => a - b);
    if (found.length) {
      detectedMaPeriods = found.filter(p => p <= 500);   // ribbon MAs (MA25–MA500)
    }
  }

  // ── Timeframe field accessor ────────────────────────────────────────
  // Returns the correct field name for the active timeframe.
  function f(field) {
    if (timeframe === '4H') return 'h4_' + field;
    return field;
  }

  // Relative volume (RVOL): today's volume ÷ rolling-average volume, for the
  // active timeframe. Returns null when volume isn't reported (forex/CFDs) or
  // the average is zero, so callers can simply skip rendering.
  function rvol(item) {
    const v  = parseFloat(item[f('volume')]);
    const av = parseFloat(item[f('volume_average')]);
    if (!isFinite(v) || !isFinite(av) || av <= 0) return null;
    return v / av;
  }

  // Format an RVOL ratio as a compact "1.8×" style string.
  function fmtRvol(r) {
    if (r === null) return '';
    return (r >= 9.95 ? Math.round(r) : r.toFixed(1)) + '×';
  }

  // Percentage Volume Oscillator (PVO), computed in the pipeline per timeframe:
  // (EMA12 − EMA26) of volume as a % of EMA26, with an EMA9 signal line.
  // > 0 = volume running above its longer baseline. Returns null when the
  // instrument reports no volume or the data predates the column.
  function pvo(item) {
    const v = parseFloat(item[f('pvo')]);
    if (!isFinite(v)) return null;
    const s = parseFloat(item[f('pvo_signal')]);
    return { v, s: isFinite(s) ? s : null };
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

  // ── Volume history sparklines ────────────────────────────────────────
  // Daily volume bars vs their 25-bar rolling average, drawn from the
  // per-instrument history feed. Cached per instrument (null = fetch failed
  // or no volume, so we don't retry every render).
  const volHistCache = new Map();

  function rollingAvg(arr, n) {
    const out = new Array(arr.length).fill(NaN);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      sum += arr[i];
      if (i >= n) sum -= arr[i - n];
      out[i] = sum / Math.min(i + 1, n);
    }
    return out;
  }

  async function fetchVolHistory(item) {
    const key = item.instrument_name;
    if (volHistCache.has(key)) return volHistCache.get(key);
    let out = null;
    try {
      const r = await fetch('/api/history/' + encodeURIComponent(item.instrument_name));
      if (r.ok) {
        const j = await r.json();
        const rows = j.data || [];
        const vols = rows.map(d => +d.volume || 0);
        if (vols.some(v => v > 0)) out = {
          vols,
          avgs:   rollingAvg(vols, 25),
          closes: rows.map(d => +d.close || 0),
          dates:  rows.map(d => d.date || ''),
        };
      }
    } catch (e) { /* leave null */ }
    volHistCache.set(key, out);
    return out;
  }

  // Render volume bars + average line as an SVG string (modal chart and
  // mover sparklines). Bars are colored by the day's close direction
  // (buy = up day, sell = down day), full strength above the 25-day average
  // and muted below it, with the average as a dashed line. Falls back to the
  // plain volume palette when closes aren't available.
  function volDetailSvg(vols, avgs, closes, w, h) {
    const max = Math.max(...vols, ...avgs.filter(isFinite)) || 1;
    const bw  = w / vols.length;
    const hasDir = Array.isArray(closes) && closes.some(c => c > 0);
    const bars = vols.map((v, i) => {
      const bh   = Math.max(1, v / max * (h - 4));
      const base = !hasDir ? 'var(--volume)'
                 : (i === 0 || closes[i] >= closes[i - 1]) ? 'var(--buy)' : 'var(--sell)';
      const hot  = isFinite(avgs[i]) && v > avgs[i];
      const fill = hot ? base : `color-mix(in srgb, ${base} 28%, var(--bg-elevated))`;
      return `<rect x="${(i * bw + bw * 0.15).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${bh.toFixed(1)}" rx="1" fill="${fill}"/>`;
    }).join('');
    const pts = avgs.map((a, i) => isFinite(a)
      ? `${(i * bw + bw / 2).toFixed(1)},${Math.min(h - 1, h - a / max * (h - 4)).toFixed(1)}`
      : null).filter(Boolean).join(' ');
    const line = pts ? `<polyline points="${pts}" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1.4" stroke-linejoin="round" stroke-dasharray="4 3"/>` : '';
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${bars}${line}</svg>`;
  }

  // Effective trend: extends the strict UPTREND/DOWNTREND/NEUTRAL classification
  // by using confirmation_status for instruments still in a transitioning state.
  // "Neutral — transitioning (rising ribbon)"  → UPTREND
  // "Neutral — transitioning (declining ribbon)" → DOWNTREND
  // Everything else stays as the raw trend_direction value.
  // ── AI filter helpers ────────────────────────────────────────────────────
  function isAI(name) { return aiSet.has(name); }

  // Returns allData filtered by the global AI toggle (and nothing else)
  function getActiveData() {
    return aiFilterActive ? allData.filter(d => isAI(d.instrument_name)) : allData;
  }

  function toggleAIFilter() {
    aiFilterActive = !aiFilterActive;
    document.getElementById('aiFilterBtn')?.classList.toggle('ai-filter-active', aiFilterActive);
    // Re-render current tab + summary
    computeAndRenderSummary();
    renderCurrentTab();
  }

  function renderCurrentTab() {
    const tab = currentTab;
    if (tab === 'dashboard')   renderDashboard();
    else if (tab === 'scanner')  renderScanner();
    else if (tab === 'trends')   renderTrendsLazy();
    else if (tab === 'watchlist') renderWatchlist();
  }
  // ─────────────────────────────────────────────────────────────────────────

  function effectiveTrend(item) {
    // Neutral oscillation (MA25 chopping + MA100 flattening = potential top/bottom)
    // takes priority: these are classified NEUTRAL regardless of the raw timeframe
    // trend, so they never double-count as Uptrend/Downtrend/Triple Bull.
    // Daily-only field — referenced as an absolute name (not via f()).
    if (item.neutral_oscillation === 'yes') return 'NEUTRAL';
    const td = item[f('trend_direction')] || '';
    if (td === 'UPTREND' || td === 'DOWNTREND') return td;
    const cs = (item[f('confirmation_status')] || '').toLowerCase();
    if (cs.includes('uptrend') || cs.includes('rising ribbon')) return 'UPTREND';
    if (cs.includes('downtrend') || cs.includes('declining ribbon')) return 'DOWNTREND';
    return 'NEUTRAL';
  }

  // ── Sector-mood conviction layer (VALIDATED 2026-07-22 on real backtested R,
  // Phase 0 / 14.5k trades: SELL+sell_thrust +0.15R t2.6, BUY-into-fighting -0.16R
  // t-3.2, SELL+market_wide -0.23R t-3.7; one up-market regime, DAILY ONLY).
  // Data from instrument_flavours.json.
  //
  // Two guards keep the display inside what was actually tested:
  //   • 4H is never graded — Phase 0 ran TF='D' only.
  //   • Only a fire on the item's LATEST BAR is graded. instrument_flavours.json
  //     carries one mood — today's. Phase 0 scored every fire against its OWN
  //     fire-day mood, so grading a 15-bar-old signal against today's sector
  //     weather is a different (untested) claim.
  // 'unknown' = sector too small / too little history to judge (sector_activity.py).
  // It is NOT the same as 'normal' and must never read as a positive all-clear.
  function flavourOf(item) { return instFlavours[item.instrument_name] || 'unknown'; }
  function moodApplies(item) {
    if (timeframe !== 'D') return false;                          // validated on daily only
    const fired = item[f('last_signal_date')] || '';
    return !!fired && fired === (item[f('date')] || '');          // fire is on the newest bar
  }

  // Sector-mood modifier for a fired signal: +1 sector-confirmed, −1 fighting/trap,
  // 0 when the sector has no validated opinion (calm, busy-but-no-edge, unknown,
  // or the guards above rule the layer out). `pips` is kept 0/2/3 for the existing
  // conviction sort, card glow/dim and Mood filter. Returns null when no signal.
  function convictionOf(item) {
    const code = item[f('primary_signal')] || item[f('last_signal_type')] || '';
    if (!code) return null;
    const buy = code.charAt(0) === 'B';
    const neutral = { pips: 2, delta: 0, tone: 'n', note: '', cls: '' };
    if (!moodApplies(item)) return neutral;
    const fl = flavourOf(item);
    if (buy) {
      // FIGHTING bucket (sell_thrust + mixed_thrust + churn): −0.164R, t −3.2, n 731.
      if (fl === 'sell_thrust' || fl === 'mixed_thrust' || fl === 'churn')
        return { pips: 0, delta: -1, tone: 'warn', note: 'sector selling off', cls: 'sc-fighting' };
      return neutral;   // buy_thrust +0.06R t1.5 → no edge; market_wide +0.24R held back as regime-suspect
    }
    // SELL + sell_thrust: +0.152R, t +2.6, n 548.
    if (fl === 'sell_thrust')
      return { pips: 3, delta: 1, tone: 'sell', note: 'whole sector selling', cls: 'sc-confirmed' };
    // SELL + market_wide: −0.228R, t −3.7, n 378, win% 25.
    if (fl === 'market_wide')
      return { pips: 0, delta: -1, tone: 'warn', note: 'market-wide day · sells snap back', cls: 'sc-fighting' };
    return neutral;
  }

  // Plain-language verdict at the top of a card. The backtest confidence tier sets
  // the base; the sector mood ADJUSTS it. It does not override it — Phase 0 measured
  // sector mood as a delta vs the same signal's baseline, so a strong setup in a bad
  // sector must land above a weak setup in a bad sector, not equal to it.
  // Note the ★ tier is reachable only via the sector-confirmed bump, which today
  // exists for SELLs only: no buy-side promotion has cleared the evidence bar
  // (buy_thrust t=+1.5; the big market-wide buy effect is held back as
  // regime-suspect). That asymmetry is the evidence's, not an oversight.
  const VERDICT_TIERS = [
    { label: '★ HIGH-CONVICTION', sub: 'strong edge' },   // 4
    { label: 'STRONG',            sub: 'above-average edge' },
    { label: '',                  sub: 'standard edge' },  // 2 → "BUY SETUP"
    { label: '⚠ LOW-EDGE',        sub: 'weak backtest edge' },
    { label: '⚠ AVOID',           sub: 'weak edge · sector against it' },  // 0
  ];
  function verdictOf(item) {
    const code = item[f('primary_signal')] || item[f('last_signal_type')] || '';
    if (!code) return null;
    const buy = code[0] === 'B';
    const dir = buy ? 'BUY' : 'SELL';
    const conf = (item[f('signal_confidence')] || '').toLowerCase();
    const conv = convictionOf(item);
    const base = conf === 'high' ? 3 : conf === 'low' ? 1 : 2;      // backtest tier
    const delta = conv ? conv.delta : 0;                            // sector mood
    const score = Math.max(0, Math.min(4, base + delta));
    const t = VERDICT_TIERS[4 - score];
    const tone = score <= 1 ? 'warn' : buy ? 'buy' : 'sell';
    return {
      label: t.label ? `${t.label} ${dir}` : `${dir} SETUP`,
      sub: t.sub,
      note: conv && conv.note ? conv.note : '',   // only set when the sector has something to say
      tone,
    };
  }
  function verdictBarHtml(item) {
    const v = verdictOf(item);
    if (!v) return '';
    return `<div class="sc-verdict sc-v-${v.tone}"><span class="sc-v-label">${v.label}</span>`
      + `<span class="sc-v-sub">${v.sub}</span>`
      + (v.note ? `<span class="sc-v-note">${v.note}</span>` : '')
      + `</div>`;
  }

  // Sector-mood filter predicate (the Mood dropdown). Mood terms are intentionally
  // NOT wired into free-text search — see the note in matchesSearch.
  function matchesMoodFilter(item, mood) {
    const fl = flavourOf(item);
    const conv = convictionOf(item);
    switch (mood) {
      case 'confirmed':    return !!(conv && conv.pips === 3);
      case 'fighting':     return !!(conv && conv.pips === 0);
      case 'calm':         return fl === 'normal';
      case 'distributing': return fl === 'sell_thrust';
      case 'active':       return fl === 'buy_thrust';
      case 'churn':        return fl === 'churn';
      case 'mixed':        return fl === 'mixed_thrust';
      case 'marketwide':   return fl === 'market_wide';
      case 'unknown':      return fl === 'unknown';
      default:             return true;
    }
  }

  // Compute summary stats client-side from the active timeframe fields
  function computeSummary() {
    const data = getActiveData();
    if (!data.length) return summaryData;

    const total = data.length;
    const trendCounts = {};
    let buyCount = 0, sellCount = 0, volumeSpikes = 0;
    const signalTypes = {};
    data.forEach(item => {
      const trend = effectiveTrend(item);
      trendCounts[trend] = (trendCounts[trend] || 0) + 1;

      if (item[f('volume_spike_flag')] === 'yes') volumeSpikes++;

      // Count FIRED signals by code prefix — same definition publish.py/server.py
      // use for summary.json (buy_mask = primary_signal.startswith('B')).
      // This used to test confirmation_status.includes('buy'/'sell'), but that
      // field's vocabulary is "Uptrend — above all MAs" / "Above MA500 — watching
      // for pullback entry" — it never contains either word, so both counts were
      // structurally 0 on every run. That silently pinned the Market Pulse gauge's
      // signal-direction component (buy share, 0–30) to its no-signals fallback
      // of 15, permanently. Do NOT use isBuy()/isSell() here: those fall back to
      // the trend when no signal fired, which would count every uptrending
      // instrument as a buy and inflate the share to meaninglessness.
      const sig = item[f('primary_signal')] || '';
      if (sig) {
        signalTypes[sig] = (signalTypes[sig] || 0) + 1;
        if (sig.startsWith('B')) buyCount++;
        else if (sig.startsWith('S')) sellCount++;
      }
    });

    return {
      date: summaryData.date,
      fetched_at: summaryData.fetched_at,
      total,
      trend_counts: trendCounts,
      buy_count: buyCount,
      sell_count: sellCount,
      volume_spikes: volumeSpikes,
      signal_types: signalTypes,
      groups: summaryData.groups || [],
    };
  }

  const TV_ICON = `<svg class="tv-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

  // ── TradingView Helpers ──────────────────────────────────────────────
  function tvUrl(name) {
    const sym = tvMap[name] || name;
    const ivlMap = { 'D': '&interval=D', '4H': '&interval=240' };
    const interval = ivlMap[timeframe] || '&interval=D';
    const layout = userTvLayout();
    return `https://www.tradingview.com/chart/${layout ? layout + '/' : ''}?symbol=${encodeURIComponent(sym)}${interval}`;
  }

  function tvBtn(name, label) {
    return `<button class="tv-link tv-picker-trigger" title="Open ${name} on TradingView" onclick="event.stopPropagation();window.SP.openTvPicker(this,'${name}')">${TV_ICON}${label ? `<span>${label}</span>` : ''}</button>`;
  }

  function tvBtnFull(name) {
    const url = tvUrl(name);
    return `<a href="${url}" target="_blank" rel="noopener" class="tv-btn-full" onclick="event.stopPropagation()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      <span>Open on TradingView</span>
    </a>`;
  }

  function tvWidgetUrl(name) {
    const sym = tvMap[name] || name;
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    const ivl = timeframe === '4H' ? '240' : 'D';
    return `https://s.tradingview.com/widgetembed/?frameElementId=tradingview_widget&symbol=${encodeURIComponent(sym)}&interval=${ivl}&hidesidetoolbar=1&symboledit=0&saveimage=0&toolbarbg=f1f3f6&studies=%5B%5D&theme=${theme}&style=1&timezone=exchange&withdateranges=1&hide_top_toolbar=0&hide_legend=0&allow_symbol_change=0&details=0&calendar=0`;
  }

  // ── Theme — single dark theme ────────────────────────────────────────
  document.documentElement.setAttribute('data-theme', 'dark');
  localStorage.removeItem('swingpulse-theme');

  // ── Timeframe Toggle ─────────────────────────────────────────────────
  // Switch the active timeframe (Daily ↔ 4H) and re-render everything.
  // The f() accessor maps to unprefixed (Daily) or h4_ (4-Hour) columns.
  // Keep the header toggle buttons (and any other tf controls) in sync.
  function syncTfButtons() {
    document.querySelectorAll('.tf-switch-btn').forEach(b => {
      const on = b.dataset.tf === timeframe;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  // Tabs the timeframe toggle does NOT drive. Trends is built from daily trend
  // segments (trends.json), so the switch sat there doing nothing — it now says
  // what timeframe you're actually looking at instead of offering a dead choice.
  const TF_LOCKED_TABS = { trends: 'Daily · trend history is daily-only' };
  function syncTfLock() {
    const note = TF_LOCKED_TABS[currentTab] || '';
    document.body.classList.toggle('tf-locked', !!note);
    const el = document.getElementById('tfSwitchNote');
    if (el) el.textContent = note;
  }

  function setTimeframe(tf) {
    if (tf !== 'D' && tf !== '4H') return;
    if (tf === timeframe) return;
    timeframe = tf;
    try { localStorage.setItem('swingpulse-tf', tf); } catch (e) {}
    syncTfButtons();
    renderAll();  // re-renders dashboard (recomputes summary), scanner, watchlist
    // If an instrument modal is open, rebuild it so its signal data AND the
    // TradingView interval (Daily→D / 4H→240) match the newly selected timeframe.
    if (openModalName && typeof overlay !== 'undefined' && overlay.classList.contains('open')) {
      openModal(openModalName);
    }
  }

  // Restore the persisted timeframe before the first render
  try {
    const _savedTf = localStorage.getItem('swingpulse-tf');
    if (_savedTf === 'D' || _savedTf === '4H') timeframe = _savedTf;
  } catch (e) {}

  // Wire the global header timeframe toggle (4H / Daily)
  document.querySelectorAll('.tf-switch-btn').forEach(b => {
    b.addEventListener('click', () => setTimeframe(b.dataset.tf));
  });
  syncTfButtons();

  // Debounce helper — avoids re-rendering on every single keystroke
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // Track which lazy tabs need a re-render (set dirty after every data refresh)
  const tabDirty = { trends: true };

  function renderAll() {
    renderDashboard();
    renderScanner();
    renderWatchlist();
    updateNotifBell();
    // Mark lazy tabs dirty so they re-render on next visit
    tabDirty.trends = true;
    // If the user is already on the trends tab (e.g. background refresh), render it now
    if (currentTab === 'trends') renderTrendsLazy();
  }

  function renderTrendsLazy() {
    if (!tabDirty.trends) return;
    tabDirty.trends = false;
    buildTrendsCards();
  }

  // ── Navigation ───────────────────────────────────────────────────────
  const navTabs = document.querySelectorAll('.nav-tab');
  const panes = document.querySelectorAll('.tab-pane');

  function doTabSwitch(btn) {
    const tab = btn.dataset.tab;
    navTabs.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    panes.forEach(p => p.classList.remove('active'));
    const paneEl = document.getElementById('pane-' + tab);
    if (!paneEl) { console.warn('No pane for tab:', tab); return; }
    paneEl.classList.add('active');
    currentTab = tab;
    syncTfLock();
    // Lazy-render heavy tabs on first visit (or after data refresh)
    if (tab === 'trends') renderTrendsLazy();
  }

  navTabs.forEach(btn => {
    btn.addEventListener('click', () => doTabSwitch(btn));
  });

  // ── Gauge Info Tooltip ───────────────────────────────────────────────
  (function wireGaugeInfo() {
    const btn     = document.getElementById('gaugeInfoBtn');
    const tooltip = document.getElementById('gaugeTooltip');
    if (!btn || !tooltip) return;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const visible = tooltip.style.display !== 'none';
      tooltip.style.display = visible ? 'none' : '';
    });
    document.addEventListener('click', () => { if (tooltip) tooltip.style.display = 'none'; });
  })();

  // ── Refresh ──────────────────────────────────────────────────────────
  const _refreshBtn = document.getElementById('refreshBtn');
  if (_refreshBtn) _refreshBtn.addEventListener('click', async () => {
    _refreshBtn.classList.add('spinning');
    try {
      await loadAll();
    } finally {
      _refreshBtn.classList.remove('spinning');
    }
  });

  // ── Data Loading ─────────────────────────────────────────────────────
  // Fetch JSON with a hard timeout so one hung endpoint (flaky network,
  // stalled proxy) can't block the whole Promise.all and blank the app.
  const FETCH_TIMEOUT_MS = 15000;
  function fetchJson(url, fallback) {
    const opts = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
      ? { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) } : {};
    return fetch(url, opts).then(r => r.json()).catch(() => fallback);
  }

  async function loadAll() {
    try {
      const [sigRes, sumRes, tvRes, aiRes, trendsRes, explRes, namesRes, btRes, ldgRes, srRes, flRes] = await Promise.all([
        fetchJson('/api/signals', { data: [] }),
        fetchJson('/api/summary', {}),
        fetchJson('/api/tv-map', {}),
        fetchJson('/api/ai-instruments', []),
        fetchJson('/api/trends', {}),
        fetchJson('/api/explanations', {}),
        fetchJson('/api/names', {}),
        fetchJson('/api/backtest', null),
        fetchJson('/api/ledger', null),
        fetchJson('/api/sector-radar', null),
        fetchJson('/api/instrument-flavours', null),
      ]);
      allData = sigRes.data || [];
      detectMaPeriodsFromData(allData);   // auto-detect from actual data columns
      summaryData = sumRes;
      tvMap = tvRes || {};
      aiSet = new Set(aiRes || []);
      trendsData = trendsRes || {};
      explanationsData = explRes || {};
      namesData = namesRes || {};
      backtestData = btRes;
      ledgerData = ldgRes && ldgRes.totals ? ldgRes : null;
      sectorRadarData = srRes && Array.isArray(srRes.sectors) && srRes.sectors.length ? srRes : null;
      instFlavours = (flRes && flRes.instruments) ? flRes.instruments : {};
      flavourMkt = (flRes && typeof flRes.market_wide === 'boolean') ? flRes : { market_wide: false };

      const dateStr = sumRes.date || '--';
      let timeStr = '';
      if (sumRes.fetched_at) {
        // Accept both "2026-07-02T19:54:00Z" (published) and "2026-07-02 19:54" (local dev)
        const d = new Date(sumRes.fetched_at.includes('T') ? sumRes.fetched_at : sumRes.fetched_at.replace(' ', 'T'));
        if (!isNaN(d.getTime())) {
          // hour12 pinned so a device's 24-hour clock setting can't change the header format
          timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        } else {
          timeStr = sumRes.fetched_at.split(' ')[1] || '';
        }
      }
      document.getElementById('dateBadge').textContent = dateStr + (timeStr ? ' \u00B7 ' + timeStr : '');

      // Staleness warning: compare data AGE against the CI schedule, not the
      // calendar date — data from yesterday 22:00 is fine at 05:00 today.
      // Crons (UTC): Mon–Fri 10:35,14:35 · Sat+Sun 08:00 (crypto). RUN_HOURS_*
      // below are the expected LANDING hours (cron + GitHub queue delay) — keep
      // in sync with .github/workflows/publish.yml.
      const staleBanner = document.getElementById('staleBanner');
      const staleText   = document.getElementById('staleBannerText');
      let fetchedTime = null;
      if (sumRes.fetched_at && sumRes.fetched_at.includes('T')) {
        const fd = new Date(sumRes.fetched_at);
        if (!isNaN(fd.getTime())) fetchedTime = fd.getTime();
      }
      // Most recent scheduled run that should have finished by now
      function lastDueRunUTC(nowMs) {
        const RUN_HOURS_WEEKDAY = [11, 15]; // crons 10:35/14:35 UTC land ~1h later
        const RUN_HOURS_WEEKEND = [8];      // Sat+Sun crypto run
        const GRACE_MS  = 2.5 * 3600e3; // worst-case cold-cache run ~90 min + slack
        const cutoff = nowMs - GRACE_MS;
        for (let back = 0; back < 8; back++) {
          const d = new Date(nowMs - back * 86400e3);
          const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
          const hours = weekend ? RUN_HOURS_WEEKEND : RUN_HOURS_WEEKDAY;
          for (let i = hours.length - 1; i >= 0; i--) {
            const run = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hours[i]);
            if (run <= cutoff) return run;
          }
        }
        return null;
      }
      if (staleBanner && staleText) {
        const nowMs = Date.now();
        const due   = lastDueRunUTC(nowMs);
        let msg = '';
        if (fetchedTime !== null) {
          if (due !== null && fetchedTime < due) {
            const ageH   = Math.round((nowMs - fetchedTime) / 3600e3);
            const ageStr = ageH < 48 ? `${ageH}h` : `${Math.round(ageH / 24)} days`;
            msg = `Data is ${ageStr} old (${dateStr}) — the scheduled update hasn't arrived yet`;
          }
        } else if (dateStr !== '--') {
          // Fallback when fetched_at is missing: old calendar-date check
          const _now  = new Date();
          const today = [_now.getFullYear(), String(_now.getMonth()+1).padStart(2,'0'), String(_now.getDate()).padStart(2,'0')].join('-');
          if (dateStr !== today) {
            msg = `Data is from ${dateStr} — an update may be overdue`;
          }
        }
        // Coverage — instruments in the list that produced no data at all.
        // main.py has always named these in its run log, but nobody reads a
        // 700-line CI log: 16 (incl. AXA, Roche, Marsh) had been fetching
        // nothing for months while the app quietly published 725 of 741.
        const missN = parseInt(sumRes.missing_count) || 0;
        if (!msg && missN > 0) {
          const names = Array.isArray(sumRes.missing) ? sumRes.missing.slice(0, 6).join(', ') : '';
          msg = `${missN} instrument${missN > 1 ? 's' : ''} have no data`
              + (names ? ` — ${names}${missN > 6 ? '…' : ''}` : '');
        }

        staleText.textContent = msg;
        staleBanner.style.display = msg ? '' : 'none';
      }

      updateNotifiedStore();
      checkAndNotifyNewSignals();
      renderAll();
    } catch (e) {
      console.error('Failed to load data:', e);
      document.getElementById('dateBadge').textContent = 'Error loading data';
      const grid = document.getElementById('scannerGrid');
      if (grid) grid.innerHTML = '<div style="padding:40px 20px;text-align:center;color:var(--sell);font-weight:600">Failed to load data — check your connection and refresh</div>';
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /** Return full display name for a ticker (e.g. 'NVDA' → 'NVIDIA').
   *  Returns '' if no name is available or name equals the ticker itself. */
  function instName(ticker) {
    const n = namesData[ticker] || '';
    // Don't show if it's identical to the ticker (no value added)
    if (!n || n.toUpperCase() === (ticker || '').toUpperCase()) return '';
    return n;
  }

  // Universal search matcher — checks ticker, full name, group, sector, industry
  // Common name aliases so users can search natural terms (e.g. "crude oil" → WTI)
  const SEARCH_ALIASES = {
    'WTI':      ['crude oil', 'crude', 'wti oil', 'oil futures'],
    'BRENT':    ['crude oil', 'crude', 'brent oil', 'oil futures'],
    'GOLD':     ['xau', 'gold futures'],
    'SILVER':   ['xag', 'silver futures'],
    'NATGAS':   ['natural gas', 'nat gas', 'ngas'],
    'COPPER':   ['copper futures'],
    'WHEAT':    ['wheat futures'],
    'CORN':     ['corn futures'],
    'BTCUSD':   ['btc', 'bitcoin'],
    'ETHUSD':   ['eth', 'ethereum'],
  };

  // Category keyword → group/sector match used by the chip row and free-text search
  const CATEGORY_ALIASES = {
    'crypto':       ['crypto'],
    'commodities':  ['commodity'],
    'us100':        ['us100'],
    'us30':         ['us30'],
    'us500':        ['us500'],
    'ger40':        ['ger40'],
    'uk100':        ['uk100'],
    'fra40':        ['fra40'],
    'it40':         ['it40'],
    'spain35':      ['spain35'],
    'can60':        ['can60'],
    'aex':          ['aex'],
    'smi20':        ['smi20'],
    'asx200':       ['asx200'],
    'japan':        ['japan'],
    'jse':          ['jse'],
    'indices':      ['index'],
    'semi':         ['semiconductor', 'ai chip', 'chip packaging', 'chip testing', 'fpga', 'analog', 'rf semiconductor', 'silicon carbide', 'ai connectivity', 'ai vision chip', 'audio semiconductor', 'semiconductor material'],
    'ai':           ['ai theme', 'ai semi', 'ai infra', 'ai energy', 'us100 us100', 'nyse nyse'],
    'blockchain':   ['blockchain'],
    'space':        ['space'],
    'quantum':      ['quantum'],
    'robotics':     ['robotics'],
    'banks':        ['banks'],
    'energy':       ['energy'],
    'healthcare':   ['healthcare'],
    'tech':         [
      'technology',                                 // sector=Technology across all index groups
      'ai theme', 'ai semi', 'ai infra', 'ai energy',  // AI sub-groups (non-tech-sector instruments)
      'blockchain', 'space', 'quantum', 'robotics', // themed groups (blockchain=fin services, space/robotics=industrials)
      'xm index',                                   // XM tech indices
      'nyse nyse',                                  // NYSE group AI/tech stocks (sector=NYSE not Technology)
      'us100 us100',                                // US100 AI-themed additions (sector=US100 not Technology)
    ],
    'luxury':       ['luxury'],
    'auto':         ['auto manufacturers'],
    'miners':       ['mining', 'gold mining'],
  };

  function matchesSearch(item, query) {
    if (!query) return true;
    const q = query.toLowerCase().trim();
    const name = (item.instrument_name || '').toUpperCase();
    // Category alias check — "crypto", "indices", "banks", etc.
    for (const [cat, targets] of Object.entries(CATEGORY_ALIASES)) {
      if (q === cat || cat.startsWith(q) && q.length >= 3) {
        const haystack = ((item.group || '') + ' ' + (item.sector || '') + ' ' + (item.industry || '')).toLowerCase();
        if (targets.some(t => haystack.includes(t))) return true;
      }
    }
    // Instrument-level aliases
    const aliases = SEARCH_ALIASES[name] || [];
    if (aliases.some(a => a.includes(q) || q.includes(a))) return true;
    // NOTE: sector-mood terms are deliberately NOT searchable. They used to be,
    // via prefix matching, but mood words describe most of the universe at once —
    // "cal" (→ calm) returned 661 of 741 instruments, "act" (→ active) 102. Search
    // must narrow. The Mood pill is the way to filter by mood.
    return (
      (item.instrument_name || '').toLowerCase().includes(q) ||
      (namesData[item.instrument_name] || '').toLowerCase().includes(q) ||
      (item.group    || '').toLowerCase().includes(q) ||
      (item.sector   || '').toLowerCase().includes(q) ||
      (item.industry || '').toLowerCase().includes(q)
    );
  }

  // ── Signal code helpers (B/S system) ───────────────────────────────
  function sigClass(code) {
    if (!code) return '';
    if (code === 'B1' || code === 'S1') return 'p1';
    if (code === 'B2' || code === 'S2') return 'p2';
    if (code === 'B3' || code === 'S3') return 'p3';
    if (code === 'B4' || code === 'S4') return 'p4';
    return '';
  }
  function sigPriority(code) {
    if (code === 'B1' || code === 'S1') return 1;
    if (code === 'B2' || code === 'S2') return 2;
    if (code === 'B3' || code === 'S3') return 3;
    if (code === 'B4' || code === 'S4') return 4;
    return 5;
  }
  function isReversal(code)  { return code === 'B1'  || code === 'S1'; }
  function isFastMa(code)    { return code === 'B2'  || code === 'S2'; }
  function isMidMa(code)     { return code === 'B3'  || code === 'S3'; }
  function isLongestMa(code) { return code === 'B4'  || code === 'S4'; }

  const ALL_SIGNAL_CODES = ['B1','S1','B2','S2','B3','S3','B4','S4'];

  function isBuy(item) {
    const sig = item[f('primary_signal')];
    if (sig) return sig.startsWith('B');
    return (item[f('confirmation_status')] || '').toLowerCase().includes('uptrend');
  }
  function isSell(item) {
    const sig = item[f('primary_signal')];
    if (sig) return sig.startsWith('S');
    return (item[f('confirmation_status')] || '').toLowerCase().includes('downtrend');
  }
  function signalClass(item) {
    if (isBuy(item)) return 'buy';
    if (isSell(item)) return 'sell';
    return 'neutral';
  }
  function trendClass(trend) {
    if (trend === 'UPTREND') return 'trend-up';
    if (trend === 'DOWNTREND') return 'trend-down';
    return 'trend-neutral';
  }
  function trendTag(trend) {
    if (trend === 'UPTREND') return 'tag-up';
    if (trend === 'DOWNTREND') return 'tag-down';
    return 'tag-neutral';
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
  // ── RSI helpers ─────────────────────────────────────────────────────────
  function rsiZone(val) {
    const v = parseFloat(val);
    if (isNaN(v)) return '';
    if (v >= 70) return 'overbought';
    if (v >= 50) return 'bullish';
    if (v >= 30) return 'bearish';
    return 'oversold';
  }
  function rsiZoneLabel(val) {
    const z = rsiZone(val);
    if (z === 'overbought') return 'OB';
    if (z === 'bullish')    return 'Bull';
    if (z === 'bearish')    return 'Bear';
    if (z === 'oversold')   return 'OS';
    return '';
  }
  // Compact inline badge: "RSI 62 Bull"
  function rsiHtml(rsiVal, opts = {}) {
    const v = parseFloat(rsiVal);
    if (isNaN(v)) return '';
    const zone  = rsiZone(v);
    const label = opts.noLabel ? '' : ` <span class="rsi-zone-lbl">${rsiZoneLabel(v)}</span>`;
    return `<span class="rsi-badge rsi-${zone}">RSI ${v.toFixed(0)}${label}</span>`;
  }
  // Wide bar row for the multi-TF panel
  function rsiBarRow(label, rsiVal) {
    const v = parseFloat(rsiVal);
    if (isNaN(v)) return '';
    const zone  = rsiZone(v);
    const pct   = Math.round(v);
    const color = zone === 'overbought' ? 'var(--sell)' : zone === 'bullish' ? 'var(--buy)' : zone === 'bearish' ? 'var(--sell)' : 'var(--buy)';
    return `<div class="rsi-tf-row">
      <span class="rsi-tf-label">${label}</span>
      <div class="rsi-bar-track">
        <div class="rsi-bar-ob-line"></div>
        <div class="rsi-bar-os-line"></div>
        <div class="rsi-bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <span class="rsi-tf-val rsi-${zone}">${v.toFixed(1)}</span>
    </div>`;
  }

  function pctFromMa(item) {
    const close = parseFloat(item[f('close')]);
    if (!close || isNaN(close)) return null;
    const periods = activeMaPeriods();
    const maxP = periods[periods.length - 1];
    const maVal = parseFloat(item[f('ma_' + maxP)]);
    if (!maVal || isNaN(maVal)) return null;
    return ((close - maVal) / maVal) * 100;
  }

  // Price position vs the full MA ribbon (min..max of all MAs, active TF).
  // Uptrend + inside = REACTION (pullback into support); downtrend + inside =
  // RALLY (counter-trend bounce into resistance) — Gann phase terms.
  // 0.3% buffer: price must be clearly outside the ribbon to count as outside,
  // so boundary hovers classify as 'inside' instead of flickering day-to-day.
  function ribbonPos(item) {
    const close = parseFloat(item[f('close')]);
    if (!close || isNaN(close)) return null;
    let lo = Infinity, hi = -Infinity;
    activeMaPeriods().forEach(p => {
      const v = parseFloat(item[f('ma_' + p)]);
      if (!isNaN(v) && v > 0) { if (v < lo) lo = v; if (v > hi) hi = v; }
    });
    if (!isFinite(lo) || !isFinite(hi)) return null;
    if (close > hi * 1.003) return 'above';
    if (close < lo * 0.997) return 'below';
    return 'inside';
  }

  function ribbonPhase(item, t) {
    if (ribbonPos(item) !== 'inside') return '';
    return t === 'UPTREND' ? 'REACTION' : t === 'DOWNTREND' ? 'RALLY' : '';
  }

  // Setup panel — shared by the scanner cards and the instrument modal:
  // line 1 = market state (trend + ribbon phase), line 2 = signal event +
  // since-fire performance. Trend and signal never share an element, so
  // counter-trend signals stay visible.
  const SIG_CTX = { B1: 'broke above ribbon', S1: 'broke below ribbon', B2: 'recovered MA25', S2: 'lost MA25', B3: 'bounced at MA250', S3: 'rejected at MA250', B4: 'bounced at MA500', S4: 'rejected at MA500' };
  // opts.showConf — append the confidence tier to the signal chip. Off on the
  // scanner card, where the verdict bar directly above already states the edge
  // ("SELL SETUP · standard edge" then "S2 SELL · Today · standard" said it
  // twice). On in the modal, which has no verdict bar.
  function setupPanelHtml(item, opts = {}) {
    const showConf = opts.showConf !== false;
    const t = effectiveTrend(item);
    const sig = item[f('primary_signal')] || '';
    const buySig = isBuy(item);
    const lastSigType = item[f('last_signal_type')] || '';
    const lastIsBuy = lastSigType.startsWith('B');
    const lastSigAge = signalAge(item[f('last_signal_date')] || '', item[f('date')]).label;
    const conf = (item[f('signal_confidence')] || '').toLowerCase();
    const pos = ribbonPos(item);
    const phase = ribbonPhase(item, t);
    let posNote = pos === 'inside' ? 'price in ribbon' : pos === 'above' ? 'price above ribbon' : pos === 'below' ? 'price below ribbon' : '';
    if (phase === 'REACTION') posNote = 'in MAs — watch B2 / B3 / B4';
    if (phase === 'RALLY')    posNote = 'in MAs — watch S2 / S3 / S4';
    const stGlyph = t === 'UPTREND' ? '▲' : t === 'DOWNTREND' ? '▼' : '—';
    const stCls   = t === 'UPTREND' ? 'sc-state-up' : t === 'DOWNTREND' ? 'sc-state-dn' : 'sc-state-neu';
    const stateLine = `<div class="sc-setup-state ${stCls}">${stGlyph} ${t}${phase ? ` <span class="sc-phase">· ${phase}</span>` : ''}${posNote ? ` <span class="sc-hint">${posNote}</span>` : ''}</div>`;

    let sigChip;
    if (sig) {
      sigChip = `<span class="sc-sig-chip ${buySig ? 'sc-sig-buy' : 'sc-sig-sell'}">${sig} ${buySig ? 'BUY' : 'SELL'}${lastSigAge ? ' · ' + lastSigAge.replace(' ago', '') : ''}${showConf && conf ? ' · ' + conf : ''}</span>`;
    } else if (lastSigType) {
      sigChip = `<span class="sc-sig-chip sc-sig-aged"><b class="${lastIsBuy ? 'sc-code-buy' : 'sc-code-sell'}">${lastSigType}</b>${lastSigAge ? ' · ' + lastSigAge : ''}${SIG_CTX[lastSigType] ? ` · <span class="sc-ctx">${SIG_CTX[lastSigType]}</span>` : ''}</span>`;
    } else {
      sigChip = '<span class="sc-sig-chip sc-sig-aged">no recent signal</span>';
    }
    // Suppressed at 0 days: the fire is on the newest bar we hold, so "since" is
    // structurally +0.0% and says nothing. It appears once a bar has closed on it.
    const sp = signalPerf(item);
    const sinceHtml = (sp && sp.days > 0) ? `<span class="sc-since ${parseFloat(sp.pct) >= 0 ? 'perf-pos' : 'perf-neg'}" title="Since ${sp.signal} on ${sp.date} (${sp.days}d)">${parseFloat(sp.pct) >= 0 ? '+' : ''}${sp.pct}% since</span>` : '';

    return `<div class="sc-setup ${t === 'UPTREND' ? 'sc-setup-up' : t === 'DOWNTREND' ? 'sc-setup-dn' : 'sc-setup-neu'}">
      ${stateLine}
      <div class="sc-setup-event">${sigChip}${sinceHtml}</div>
    </div>`;
  }

  function animateCount(el, target) {
    const start = parseInt(el.textContent) || 0;
    const diff = target - start;
    if (diff === 0) { el.textContent = target; return; }
    const steps = 20;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      el.textContent = Math.round(start + (diff * step / steps));
      if (step >= steps) { el.textContent = target; clearInterval(timer); }
    }, 30);
  }
  function getThemeColors() {
    const style = getComputedStyle(document.documentElement);
    return {
      buy: style.getPropertyValue('--buy').trim(),
      sell: style.getPropertyValue('--sell').trim(),
      watch: style.getPropertyValue('--watch').trim(),
      volume: style.getPropertyValue('--volume').trim(),
      accent: style.getPropertyValue('--accent').trim(),
      neutral: style.getPropertyValue('--neutral').trim(),
      text: style.getPropertyValue('--text-secondary').trim(),
      muted: style.getPropertyValue('--text-muted').trim(),
      bg: style.getPropertyValue('--bg-card').trim(),
      grid: style.getPropertyValue('--border').trim(),
    };
  }

  // ── Dashboard ────────────────────────────────────────────────────────
  // ── Layer 3: per-instrument track record snippet (used inside modal) ──
  function renderInstrumentTrackRecord(name) {
    if (!backtestData || !backtestData.by_instrument) return '';
    const data = backtestData.by_instrument[name];
    if (!data || !data.overall || !data.overall.total_trades) return '';
    const o = data.overall;
    if (o.total_trades < 3) return ''; // hide if barely any sample
    const sigs = data.by_signal || {};
    const cls = o.avg_r >= 0 ? 'tr-pos' : 'tr-neg';
    const sigsHtml = Object.entries(sigs).map(([sig, s]) => `
      <div class="ir-sig-pill">
        <span class="ir-sig-name">${sig}</span>
        <span class="ir-sig-stats">${s.total_trades} · ${s.win_rate}% · <strong class="${s.avg_r >= 0 ? 'tr-pos' : 'tr-neg'}">${s.avg_r > 0 ? '+' : ''}${s.avg_r}R</strong></span>
      </div>
    `).join('');
    return `
      <div class="mh-section">
        <div class="mh-section-title">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
          Track Record on ${name}
        </div>
        <div class="ir-overall">
          <span><strong>${o.total_trades}</strong> trades</span>
          <span><strong>${o.win_rate}%</strong> win rate</span>
          <span class="${cls}"><strong>${o.avg_r > 0 ? '+' : ''}${o.avg_r}R</strong> avg</span>
        </div>
        <div class="ir-sigs">${sigsHtml}</div>
      </div>
    `;
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

  // ── Signal Track Record (from backtest.json) ──────────────────────────
  function renderTrackRecord() {
    const card    = document.getElementById('trackRecordCard');
    const overall = document.getElementById('trOverall');
    const rows    = document.getElementById('trRows');
    const subEl   = document.getElementById('trSubtitle');
    if (!card || !overall || !rows) return;
    if (!backtestData || !backtestData.overall || !backtestData.overall.total_trades) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';

    const o = backtestData.overall;
    const oCls = o.avg_r >= 0 ? 'tr-pos' : 'tr-neg';
    overall.innerHTML = `
      <div class="tr-overall-row">
        <div class="tr-stat">
          <span class="tr-stat-val">${o.total_trades}</span>
          <span class="tr-stat-lbl">Trades</span>
        </div>
        <div class="tr-stat">
          <span class="tr-stat-val">${o.win_rate}%</span>
          <span class="tr-stat-lbl">Win rate</span>
        </div>
        <div class="tr-stat">
          <span class="tr-stat-val ${oCls}">${o.avg_r > 0 ? '+' : ''}${o.avg_r}R</span>
          <span class="tr-stat-lbl">Avg R</span>
        </div>
        <div class="tr-stat">
          <span class="tr-stat-val ${o.profit_factor >= 1 ? 'tr-pos' : 'tr-neg'}">${o.profit_factor}</span>
          <span class="tr-stat-lbl">PF</span>
        </div>
      </div>
    `;

    const sigs = backtestData.by_signal || {};
    const btRows = Object.entries(sigs).map(([sig, s]) => {
      const cls = s.avg_r >= 0 ? 'tr-pos' : 'tr-neg';
      const sigCls = `sig-${sigClass(sig) || 'p4'}`;
      return `<div class="tr-row">
        <span class="tr-sig-badge ${sigCls}">${sig}</span>
        <span class="tr-row-trades">${s.total_trades}</span>
        <span class="tr-row-wr">${s.win_rate}%</span>
        <span class="tr-row-r ${cls}">${s.avg_r > 0 ? '+' : ''}${s.avg_r}R</span>
        <span class="tr-row-pf ${s.profit_factor >= 1 ? 'tr-pos' : 'tr-neg'}">PF ${s.profit_factor}</span>
      </div>`;
    }).join('');

    // Live record — actual production fires, graded by signal_ledger.py with
    // the same ATR-stop simulation the backtest uses.
    //
    // A code is only shown once enough of its fires have MATURED (`counted` —
    // the full 30-bar/60-bar window elapsed). Resolved-but-immature fires are
    // deliberately excluded: a 1R stop resolves in days, a 2R target takes
    // weeks, so averaging everything that has closed so far reports only the
    // fast losers. This card used to do that, and it made every code look
    // catastrophic (B1 −1.078R off fires that were days old).
    let liveHtml = '';
    if (ledgerData && ledgerData.totals && ledgerData.totals.fires) {
      const t = ledgerData.totals;
      const MIN_COUNTED = 10;   // below this a code's avgR is noise, not a result
      // Pre-maturity-gate payload (a UI deploy can land before the next data
      // run). Its avgR figures are the biased ones this card was built to stop
      // showing, and its per-code `counted` is missing, so say so and stop.
      if (t.counted === undefined) {
        rows.innerHTML = btRows +
          `<div class="tr-live-head">Live fires${t.since ? ` since ${t.since}` : ''} — ${t.fires} recorded</div>` +
          `<div class="tr-live-empty">Live grades are being recomputed on the next data run — they only count a fire once its full outcome window has passed.</div>`;
        if (subEl && backtestData.generated_at) {
          const p0 = backtestData.params || {};
          subEl.textContent = `${p0.stop_model ? `${p0.stop_model} stop · ${p0.target_r || 2}:1 R:R` : '2% stop · 2:1 R:R'}`
            + `${p0.since && p0.since !== 'full history' ? ` · since ${p0.since}` : ''}`
            + ` · updated ${formatGeneratedAt(backtestData.generated_at)}`;
        }
        return;
      }
      const all = Object.entries(ledgerData.by_code || {});
      const ready   = all.filter(([, s]) => (s.counted || 0) >= MIN_COUNTED)
                         .sort((a, b) => ((b[1].avg_r ?? -99) - (a[1].avg_r ?? -99)));
      const pending = all.filter(([, s]) => (s.counted || 0) < MIN_COUNTED && s.fires);
      const maturingTotal = t.maturing != null
        ? t.maturing
        : pending.reduce((n, [, s]) => n + (s.maturing || 0), 0);

      liveHtml = `
        <div class="tr-live-head">Live fires${t.since ? ` since ${t.since}` : ''} — ${t.fires} recorded · ${t.counted != null ? t.counted : 0} counted · ${maturingTotal} maturing · ${t.open} open</div>
        ${ready.length ? ready.map(([code, s]) => {
          const r = s.avg_r ?? 0;
          const cls = r >= 0 ? 'tr-pos' : 'tr-neg';
          const bt = sigs[code];
          const btStr = bt ? `BT ${bt.avg_r > 0 ? '+' : ''}${bt.avg_r}R` : '';
          const approxNote = s.approx ? ` · ${s.approx} on an inferred entry bar` : '';
          return `<div class="tr-row">
            <span class="tr-sig-badge sig-${sigClass(code) || 'p4'}">${code}</span>
            <span class="tr-row-trades" title="Fires whose full outcome window has elapsed, out of all fires recorded${approxNote}">${s.counted}/${s.fires}</span>
            <span class="tr-row-wr">${s.win_rate != null ? s.win_rate + '%' : '--'}</span>
            <span class="tr-row-r ${cls}">${r > 0 ? '+' : ''}${s.avg_r != null ? s.avg_r : '--'}R</span>
            <span class="tr-row-pf tr-live-bt" title="Backtested expectancy for this code (10y) — is live matching it?">${btStr}</span>
          </div>`;
        }).join('') : ''}
        ${pending.length ? `<div class="tr-live-empty">${ready.length ? 'Still maturing: ' : 'Nothing has matured yet — '}${pending.map(([c, s]) => `${c} ${s.counted || 0}/${MIN_COUNTED}`).join(' · ')}. A signal only counts once its full window (${t.window ? `${t.window.D || 30} daily bars, ${t.window['4H'] || 60} 4H bars` : '30 daily bars'}) has passed, so winners aren't left out.</div>` : ''}
      `;
    }
    rows.innerHTML = btRows + liveHtml;

    if (subEl && backtestData.generated_at) {
      const p = backtestData.params || {};
      const stopStr = p.stop_model ? `${p.stop_model} stop · ${p.target_r || 2}:1 R:R` : '2% stop · 2:1 R:R';
      const sinceStr = p.since && p.since !== 'full history' ? ` · since ${p.since}` : '';
      subEl.textContent = `${stopStr}${sinceStr} · updated ${formatGeneratedAt(backtestData.generated_at)}`;
    }
  }

  // Sector-mood market state (validated Phase 0): sit-out warning on market-wide churn
  // days, otherwise a stock-picking-OK note when there are fresh fires.
  function renderMarketState() {
    const el = document.getElementById('marketStateBanner');
    if (!el) return;
    const fires = getActiveData().filter(it => it[f('primary_signal')]);
    const confirmed = fires.filter(it => { const c = convictionOf(it); return c && c.pips === 3; }).length;
    const fighting  = fires.filter(it => { const c = convictionOf(it); return c && c.pips === 0; }).length;
    if (flavourMkt.market_wide) {
      el.innerHTML = `<div class="market-state sit"><div class="ms-ic">🌐</div><div>`
        + `<div class="ms-t">Sit-out day — market-wide churn</div>`
        + `<div class="ms-s">Every sector is firing at once (options-expiry / rebalance). Signals are unreliable today and <b>sells often snap back up</b> (−0.23R vs normal). Best to hold, not chase. <span class="ms-prov">validated · 2024–26</span></div></div></div>`;
    } else if (fires.length) {
      el.innerHTML = `<div class="market-state ok"><div class="ms-ic">✓</div><div>`
        + `<div class="ms-t">Stock-picking conditions</div>`
        + `<div class="ms-s">Sectors are moving on their own, not all together — a normal day to pick setups.${confirmed ? ` <b>${confirmed} sector-confirmed</b> setup${confirmed > 1 ? 's' : ''} today.` : ''}${fighting ? ` ${fighting} fighting-sector fire${fighting > 1 ? 's' : ''} dimmed.` : ''} <span class="ms-prov" title="Sector-mood grades were backtested on 2024–26 real trades">grades validated · 2024–26</span></div></div></div>`;
    } else {
      el.innerHTML = '';
    }
  }

  function renderDashboard() {
    renderMarketState();
    const s = computeSummary();
    const total = s.total || 1;

    const tc = s.trend_counts || {};
    const up = tc.UPTREND || 0;
    const down = tc.DOWNTREND || 0;
    const neutral = tc.NEUTRAL || 0;
    const pulseEl = document.getElementById('pulseSentiment');
    const mpBanner = document.getElementById('marketPulse');

    // Remove old sentiment classes
    mpBanner.classList.remove('mp-bullish', 'mp-bearish', 'mp-mixed');

    if (up > down * 1.5) {
      pulseEl.textContent = 'Bullish';
      pulseEl.className = 'pulse-value bullish';
      mpBanner.classList.add('mp-bullish');
    } else if (down > up * 1.5) {
      pulseEl.textContent = 'Bearish';
      pulseEl.className = 'pulse-value bearish';
      mpBanner.classList.add('mp-bearish');
    } else {
      pulseEl.textContent = 'Mixed';
      pulseEl.className = 'pulse-value mixed';
      mpBanner.classList.add('mp-mixed');
    }
    document.getElementById('pulseUptrend').textContent = up + ' uptrend';
    document.getElementById('pulseDowntrend').textContent = down + ' downtrend';
    document.getElementById('pulseNeutral').textContent = neutral + ' neutral';

    // Dominant alignment
    const alignCounts = {};
    allData.forEach(d => {
      if (effectiveTrend(d) === 'NEUTRAL') return;  // neutral takes priority over alignment (no Triple Bull conflict)
      const a = d.tf_alignment || ''; if (a) alignCounts[a] = (alignCounts[a]||0)+1;
    });
    const domAlign = Object.entries(alignCounts).sort((a,b)=>b[1]-a[1])[0];
    const pulseAlignEl = document.getElementById('pulseAlignment');
    if (pulseAlignEl && domAlign) {
      pulseAlignEl.textContent = domAlign[0] + ' (' + domAlign[1] + ')';
      pulseAlignEl.className = 'pulse-alignment ' + alignCls(domAlign[0]);
    } else if (pulseAlignEl) {
      pulseAlignEl.textContent = '--';
    }

    // Update new MP card alignment row
    const mpBdAlign = document.getElementById('mpBdAlign');
    if (mpBdAlign && domAlign) {
      const alignName  = domAlign[0];
      const alignCount = domAlign[1];
      const isBull = alignName.includes('Bull');
      const isBear = alignName.includes('Bear');
      const color  = isBull ? 'var(--buy)' : isBear ? 'var(--sell)' : 'var(--accent)';
      mpBdAlign.dataset.filterAlign = alignName;
      const dot = document.getElementById('mpAlignDot');
      const lbl = document.getElementById('mpAlignLbl');
      const val = document.getElementById('mpAlignVal');
      if (dot) dot.style.background = color;
      if (lbl) { lbl.textContent = alignName; lbl.style.color = color; }
      if (val) { val.textContent = alignCount; val.style.color = color; }
    }

    // Stat card counts kept in hidden spans for potential JS references
    animateCount(document.getElementById('buyCount'), s.buy_count || 0);
    animateCount(document.getElementById('sellCount'), s.sell_count || 0);
    animateCount(document.getElementById('volumeCount'), s.volume_spikes || 0);

    renderTrackRecord();
    renderAlertBanner();
    rebuildCharts();
    renderConfidenceBreakdown();
    renderGroupPulse();
    renderVolumePulse();
    renderSectorRadar();
    renderHeatmap();
    renderAlignmentSummary();
    renderCompressionFeed();
    renderSignalFeed();
    renderThemesCard();
  }

  // ── Tech Themes Dashboard Card ─────────────────────────────────────────
  // `extra` lists theme members whose Instruments.txt group is an index
  // (US100/NYSE/US500/AEX/Japan…) rather than the theme group itself.
  const TECH_THEMES = [
    { label:'Artificial Intelligence', group:'AI Theme',
      extra:['PLTR','APP','NOW','SNOW','DDOG','NET'] },
    { label:'Blockchain',              group:'Blockchain' },
    { label:'Space Exploration',       group:'Space'      },
    { label:'Quantum Computing',       group:'Quantum'    },
    { label:'Robotics',                group:'Robotics',
      extra:['ISRG','FANUC','KEYENCE','ABBN'] },
    { label:'AI Energy',               group:'AI Energy',
      extra:['CEG'] },
    { label:'AI Semiconductors',       group:'AI Semi',
      extra:['NVDA','AMD','AVGO','ARM','MRVL','INTC','MU','QCOM','NXPI','ON',
             'TSM','STM','MPWR','AMBA','IFX','ASML','AMAT','LRCX','KLAC',
             'ENTG','TER','TOKYOELEC','BESI','CDNS','SNPS'] },
    { label:'AI Infrastructure',       group:'AI Infra',
      extra:['SMCI','DELL','ANET','CSCO','EQIX'] },
    { label:'XM Indices',              group:'XM Index'   },
  ];
  TECH_THEMES.forEach(t => { t.extraSet = new Set(t.extra || []); });

  const _themeExpanded = new Set();

  function renderThemesCard() {
    const el = document.getElementById('techThemesCard');
    if (!el) return;

    const rows = TECH_THEMES.map(theme => {
      const items  = allData.filter(d => d.group === theme.group || theme.extraSet.has(d.instrument_name));
      const bulls  = items.filter(d => effectiveTrend(d) === 'UPTREND').length;
      const bears  = items.filter(d => effectiveTrend(d) === 'DOWNTREND').length;
      const total  = items.length;
      const buySigs  = items.filter(d => isBuy(d));
      const sellSigs = items.filter(d => isSell(d));
      const sigCount = buySigs.length + sellSigs.length;

      if (!total) return `
        <div class="th-row th-empty">
          <span class="th-label">${theme.label}</span>
          <span class="th-nodata">no data — run pipeline</span>
        </div>`;

      const bullPct = Math.round(bulls / total * 100);
      const bearPct = Math.round(bears / total * 100);
      const neutPct = 100 - bullPct - bearPct;
      const dom = bullPct > bearPct + 15 ? 'th-bull' : bearPct > bullPct + 15 ? 'th-bear' : 'th-neu';
      const open = _themeExpanded.has(theme.group);

      const instrRows = open ? [...items]
        .sort((a,b) => {
          const order = { UPTREND:0, NEUTRAL:1, DOWNTREND:2 };
          return (order[effectiveTrend(a)]??1) - (order[effectiveTrend(b)]??1);
        })
        .map(item => {
          const td  = effectiveTrend(item);
          const sig = item[f('primary_signal')] || '';
          const conf = item[f('signal_confidence')] || '';
          const vol = item[f('volume_spike_flag')] === 'yes';
          const arrow = td === 'UPTREND' ? '↑' : td === 'DOWNTREND' ? '↓' : '–';
          const trendCls = td === 'UPTREND' ? 'th-i-up' : td === 'DOWNTREND' ? 'th-i-dn' : 'th-i-neu';
          const sigCls = isBuy(item) ? 'th-sig-buy' : isSell(item) ? 'th-sig-sell' : '';
          return `<div class="th-instrument" data-arg="${item.instrument_name}">
            <span class="th-i-name">${item.instrument_name}</span>
            <span class="th-i-arrow ${trendCls}">${arrow}${vol ? '<span class="th-vol">V</span>' : ''}</span>
            ${sig ? `<span class="th-i-sig ${sigCls}">${sig}${conf === 'high' ? ' ★' : ''}</span>` : ''}
          </div>`;
        }).join('') : '';

      return `
        <div class="th-row ${dom}" data-th-group="${theme.group}">
          <div class="th-top">
            <span class="th-label">${theme.label}</span>
            <div class="th-bar-wrap">
              <div class="th-bar-bull" style="width:${bullPct}%"></div>
              <div class="th-bar-neut" style="width:${neutPct}%"></div>
              <div class="th-bar-bear" style="width:${bearPct}%"></div>
            </div>
            <div class="th-stats">
              <span class="th-pct-bull">${bullPct}%↑</span>
              <span class="th-pct-bear">${bearPct}%↓</span>
              ${sigCount ? `<span class="th-sig-count">${sigCount}</span>` : ''}
            </div>
            <span class="th-chevron">${open ? '▲' : '▼'}</span>
          </div>
          ${open ? `<div class="th-instruments">${instrRows}</div>` : ''}
        </div>`;
    }).join('');

    el.innerHTML = `
      <div class="card-header">
        <h3>Tech Themes</h3>
        <span style="font-size:.68rem;color:var(--text-muted)">tap to expand</span>
      </div>
      <div class="th-list">${rows}</div>`;

    el.querySelectorAll('.th-row[data-th-group]').forEach(row => {
      row.querySelector('.th-top')?.addEventListener('click', () => {
        const g = row.dataset.thGroup;
        _themeExpanded.has(g) ? _themeExpanded.delete(g) : _themeExpanded.add(g);
        renderThemesCard();
      });
    });

    el.querySelectorAll('.th-instrument[data-arg]').forEach(row => {
      row.addEventListener('click', e => {
        e.stopPropagation();
        window.SP?.openModal?.(row.dataset.arg);
      });
    });
  }

  // ── Group Market Pulse ─────────────────────────────────────────────────
  const GP_REGION_MAP = {
    'CA Index':'Americas','CAN60':'Americas','NYSE':'Americas',
    'US Index':'Americas','US100':'Americas','US30':'Americas',
    'US30/US100':'Americas','US500':'Americas',
    'AEX':'Europe','EU Index':'Europe','FRA40':'Europe','GER40':'Europe',
    'IT40':'Europe','OBX':'Europe','OMX30':'Europe','OMXC25':'Europe',
    'SMI20':'Europe','SPAIN35':'Europe','UK100':'Europe',
    'Asia Index':'Asia-Pacific','ASX200':'Asia-Pacific','Japan':'Asia-Pacific',
    'JSE':'Africa',
    'Commodity':'Commodities','Crypto':'Crypto',
    'AI Theme':'Themes','Blockchain':'Themes','Space':'Themes',
    'Quantum':'Themes','Robotics':'Themes','AI Energy':'Themes',
    'AI Semi':'Themes','AI Infra':'Themes','XM Index':'Themes',
  };

  function renderGroupPulse() {
    const body      = document.getElementById('groupPulseBody');
    const riskBadge = document.getElementById('groupPulseRisk');
    const toggle    = document.getElementById('gpViewToggle');
    const title     = document.getElementById('groupPulseTitle');
    if (!body) return;

    if (toggle) {
      toggle.textContent = gpViewMode === 'region' ? 'Group' : 'Region';
      toggle.classList.toggle('gp-view-active', gpViewMode === 'region');
    }
    if (title) title.textContent = gpViewMode === 'region' ? 'By Region' : 'By Group';

    // ── Aggregate bull/bear/neutral per group or region ───────────────────
    // INDEX_GROUPS is defined at module scope (below Scanner section) — reuse it
    const dimMap = {};
    for (const item of allData) {
      const raw = item.group || 'Other';
      let key;
      if (gpViewMode === 'region') {
        key = GP_REGION_MAP[raw] || 'Other';
      } else {
        key = INDEX_GROUPS.has(raw) ? 'Indices' : raw;
      }
      if (!dimMap[key]) dimMap[key] = { bull: 0, bear: 0, neutral: 0, signals: 0, rvolSum: 0, rvolN: 0 };
      const t = effectiveTrend(item);
      if      (t === 'UPTREND')   dimMap[key].bull++;
      else if (t === 'DOWNTREND') dimMap[key].bear++;
      else                        dimMap[key].neutral++;
      if (item[f('primary_signal')]) dimMap[key].signals++;
      const rv = rvol(item);
      if (rv !== null) { dimMap[key].rvolSum += rv; dimMap[key].rvolN++; }
    }

    // Sort: most bullish first
    const entries = Object.entries(dimMap).sort((a, b) => {
      const pctA = a[1].bull / (a[1].bull + a[1].bear + a[1].neutral || 1);
      const pctB = b[1].bull / (b[1].bull + b[1].bear + b[1].neutral || 1);
      return pctB - pctA;
    });

    // ── Overall risk badge ────────────────────────────────────────────────
    const totBull   = allData.filter(d => effectiveTrend(d) === 'UPTREND').length;
    const totBear   = allData.filter(d => effectiveTrend(d) === 'DOWNTREND').length;
    const totAll    = allData.length || 1;
    const isRiskOn  = (totBull / totAll) > 0.55;
    const isRiskOff = (totBear / totAll) > 0.55;
    if (riskBadge) {
      riskBadge.textContent = isRiskOn ? '▲ Risk-On' : isRiskOff ? '▼ Risk-Off' : '◆ Mixed';
      riskBadge.className   = 'gp-risk-badge ' + (isRiskOn ? 'gp-risk-on' : isRiskOff ? 'gp-risk-off' : 'gp-risk-mixed');
    }

    // ── Active filter for row highlight ───────────────────────────────────
    const activeGroupVal = document.getElementById('scannerGroupFilter')?.value || 'all';
    const activeKey      = gpViewMode === 'region' ? activeRegionFilter : activeGroupVal;

    body.innerHTML = entries.map(([name, c]) => {
      const total   = c.bull + c.bear + c.neutral || 1;
      const bullPct = Math.round(c.bull / total * 100);
      const bearPct = Math.round(c.bear / total * 100);
      const neutPct = 100 - bullPct - bearPct;
      const dominant = bullPct > bearPct + 15 ? 'gp-row-bull'
                     : bearPct > bullPct + 15  ? 'gp-row-bear'
                     : 'gp-row-mixed';
      const isActive = activeKey === name ? ' gp-row-selected' : '';
      const sigDot   = c.signals > 0 ? `<span class="gp-sig-dot" title="${c.signals} active buy/sell signal${c.signals>1?'s':''} in this group">${c.signals}</span>` : '';
      const avgRvol  = c.rvolN ? c.rvolSum / c.rvolN : null;
      const rvolCell = avgRvol === null
        ? `<span class="gp-rvol gp-rvol-na" title="No volume reported for this group">—</span>`
        : `<span class="gp-rvol ${avgRvol >= 1 ? 'gp-rvol-hot' : ''}" title="Average daily volume vs each instrument's own average across this group (${c.rvolN} with volume)">${fmtRvol(avgRvol)}</span>`;
      return `
        <div class="gp-row ${dominant}${isActive}" data-gp-key="${name}">
          <div class="gp-name">${name}${sigDot}</div>
          <div class="gp-bar-wrap">
            <div class="gp-bar-bull" style="width:${bullPct}%"></div>
            <div class="gp-bar-neut" style="width:${neutPct}%"></div>
            <div class="gp-bar-bear" style="width:${bearPct}%"></div>
          </div>
          ${rvolCell}
          <div class="gp-stats">
            <span class="gp-bull">${bullPct}%↑</span>
            <span class="gp-bear">${bearPct}%↓</span>
          </div>
        </div>`;
    }).join('');

    // ── Row click → filter scanner ──────────────────────────────────────
    body.querySelectorAll('.gp-row[data-gp-key]').forEach(row => {
      row.addEventListener('click', () => {
        const key = row.dataset.gpKey;
        if (gpViewMode === 'region') {
          // Region click: toggle the region filter, clear any single-group filter
          activeRegionFilter = (activeRegionFilter === key) ? '' : key;
          const sel = document.getElementById('scannerGroupFilter');
          if (sel) sel.value = 'all';
        } else {
          // Group click: toggle the group dropdown, clear any region filter
          const sel = document.getElementById('scannerGroupFilter');
          if (sel) sel.value = sel.value === key ? 'all' : key;
          activeRegionFilter = '';
        }
        updateScannerCtxStrip?.();
        navigateToTab('scanner');
        buildScannerCards();
        renderGroupPulse();
      });
    });

    // ── Toggle button ─────────────────────────────────────────────────────
    if (toggle && !toggle._gpBound) {
      toggle._gpBound = true;
      toggle.addEventListener('click', () => {
        gpViewMode = gpViewMode === 'group' ? 'region' : 'group';
        renderGroupPulse();
      });
    }
  }

  // ── Volume Pulse card — RVOL + PVO rolled up by market / industry ──────
  // Market = broad asset class (assetClassOf), Industry = Instruments.txt
  // industry column, Movers = top instruments by RVOL on the active TF.
  let vpMode = localStorage.getItem('swingpulse-vp-mode') || 'market';
  let vpShowAll = false;
  const VP_ROW_CAP = 12;

  function renderVolumePulse() {
    const body = document.getElementById('volumePulseBody');
    if (!body) return;

    document.querySelectorAll('#vpToggle .vp-mode-btn').forEach(btn => {
      btn.classList.toggle('vp-active', btn.dataset.vp === vpMode);
      if (!btn._vpBound) {
        btn._vpBound = true;
        btn.addEventListener('click', () => {
          vpMode = btn.dataset.vp;
          vpShowAll = false;
          try { localStorage.setItem('swingpulse-vp-mode', vpMode); } catch (e) {}
          renderVolumePulse();
        });
      }
    });

    // ── Summary strip: market-wide volume picture (shown in all modes) ──
    // Pressure bar weights each instrument by its RVOL, so it reads as
    // "where is today's unusual volume concentrated — rising or falling names".
    let sumHtml = '';
    {
      let n = 0, rvSum = 0, spikes = 0, hot = 0, pvoUp = 0, pvoN = 0, upW = 0, dnW = 0;
      for (const item of allData) {
        const rv = rvol(item);
        if (rv === null) continue;
        n++; rvSum += rv;
        if (rv >= 1.5) hot++;
        if (item[f('volume_spike_flag')] === 'yes') spikes++;
        const pv = pvo(item);
        if (pv) { pvoN++; if (pv.v >= 0) pvoUp++; }
        const o = parseFloat(item[f('open')]), c = parseFloat(item[f('close')]);
        if (isFinite(o) && isFinite(c) && o > 0) { if (c >= o) upW += rv; else dnW += rv; }
      }
      if (n) {
        const avgRv  = rvSum / n;
        const upPct  = (upW + dnW) ? Math.round(upW / (upW + dnW) * 100) : null;
        const expPct = pvoN ? Math.round(pvoUp / pvoN * 100) : null;
        sumHtml = `
        <div class="vp-summary">
          <div class="vp-sum-tiles">
            <div class="vp-sum-tile" title="Average RVOL across the ${n} instruments reporting volume"><div class="vp-sum-lbl">Avg RVOL</div><div class="vp-sum-val ${avgRv >= 1 ? 'vp-hot' : ''}">${fmtRvol(avgRv)}</div></div>
            <div class="vp-sum-tile" title="Instruments trading above their ${VP_LOOKBACK_LABEL()} average volume"><div class="vp-sum-lbl">Spikes</div><div class="vp-sum-val">${spikes}</div></div>
            <div class="vp-sum-tile" title="Instruments at 1.5× or more of their average volume"><div class="vp-sum-lbl">≥1.5×</div><div class="vp-sum-val ${hot ? 'vp-hot' : ''}">${hot}</div></div>
            <div class="vp-sum-tile" title="Share of instruments with a rising volume oscillator (PVO ≥ 0)"><div class="vp-sum-lbl">PVO+</div><div class="vp-sum-val ${expPct !== null && expPct >= 50 ? 'vp-sum-up' : ''}">${expPct !== null ? expPct + '%' : '—'}</div></div>
          </div>
          ${upPct !== null ? `
          <div class="mh-vol-pressure" title="RVOL-weighted share of today's volume in instruments trading up vs down (close vs open, ${timeframe} bars)">
            <div class="mh-vp-track"><div class="mh-vp-up" style="width:${upPct}%"></div></div>
            <div class="mh-vp-lbls">
              <span style="color:var(--buy)">▲ ${upPct}% of volume in rising names</span>
              <span style="color:var(--sell)">${100 - upPct}% falling ▼</span>
            </div>
          </div>` : ''}
        </div>`;
      }
    }

    // ── Movers: top instruments by RVOL ─────────────────────────────────
    if (vpMode === 'movers') {
      const movers = allData
        .map(item => ({ item, rv: rvol(item) }))
        .filter(x => x.rv !== null)
        .sort((a, b) => b.rv - a.rv)
        .slice(0, VP_ROW_CAP);
      if (!movers.length) { body.innerHTML = '<div class="vp-empty">No volume data yet</div>'; return; }
      const rvMax = Math.max(1.5, movers[0].rv);
      body.innerHTML = sumHtml + movers.map(({ item, rv }) => {
        const pv = pvo(item);
        const spike = item[f('volume_spike_flag')] === 'yes';
        return `
          <div class="vp-row" data-act="openModal" data-arg="${item.instrument_name}">
            <div class="vp-name">${item.instrument_name}${spike ? '<span class="vp-spike-dot" title="Volume spike">VOL</span>' : ''}
              <span class="vp-sub">${item.industry || item.group || ''}</span></div>
            <div class="vp-bar-wrap vp-spark-slot"><div class="vp-bar ${rv >= 1 ? 'vp-bar-hot' : ''}" style="width:${Math.min(100, rv / rvMax * 100)}%"></div></div>
            <span class="vp-rvol ${rv >= 1 ? 'vp-hot' : ''}">${fmtRvol(rv)}</span>
            <span class="vp-pvo ${pv ? (pv.v >= 0 ? 'vp-pvo-up' : 'vp-pvo-down') : ''}">${pv ? fmtPvo(pv.v) : '—'}</span>
          </div>`;
      }).join('') + `<div class="vp-legend">RVOL = today ÷ ${VP_LOOKBACK_LABEL()} avg · PVO = volume oscillator % · spark: 24d volume — green up / red down day</div>`;
      hydrateMoverSparks(body, movers.map(m => m.item));
      return;
    }

    // ── Market / Industry: aggregate per bucket ──────────────────────────
    const buckets = {};
    for (const item of allData) {
      const rv = rvol(item);
      if (rv === null) continue;                       // no volume reported
      const key = vpMode === 'market'
        ? assetClassOf(item)
        : (item.industry || item.sector || 'Other');
      if (!buckets[key]) buckets[key] = { n: 0, rvSum: 0, pvoSum: 0, pvoN: 0, spikes: 0 };
      const b = buckets[key];
      b.n++; b.rvSum += rv;
      if (item[f('volume_spike_flag')] === 'yes') b.spikes++;
      const pv = pvo(item);
      if (pv) { b.pvoSum += pv.v; b.pvoN++; }
    }

    const entries = Object.entries(buckets)
      .map(([name, b]) => ({ name, n: b.n, rv: b.rvSum / b.n, spikes: b.spikes,
                             pvo: b.pvoN ? b.pvoSum / b.pvoN : null }))
      .sort((a, b) => b.rv - a.rv);
    if (!entries.length) { body.innerHTML = '<div class="vp-empty">No volume data yet</div>'; return; }

    const shown = vpShowAll ? entries : entries.slice(0, VP_ROW_CAP);
    const rvMax = Math.max(1.5, entries[0].rv);
    body.innerHTML = sumHtml + shown.map(e => `
      <div class="vp-row" data-vp-key="${e.name}">
        <div class="vp-name">${e.name}${e.spikes ? `<span class="vp-spike-dot" title="${e.spikes} volume spike${e.spikes > 1 ? 's' : ''}">${e.spikes}</span>` : ''}
          <span class="vp-sub">${e.n} instrument${e.n > 1 ? 's' : ''}</span></div>
        <div class="vp-bar-wrap"><div class="vp-bar ${e.rv >= 1 ? 'vp-bar-hot' : ''}" style="width:${Math.min(100, e.rv / rvMax * 100)}%"></div></div>
        <span class="vp-rvol ${e.rv >= 1 ? 'vp-hot' : ''}">${fmtRvol(e.rv)}</span>
        <span class="vp-pvo ${e.pvo !== null ? (e.pvo >= 0 ? 'vp-pvo-up' : 'vp-pvo-down') : ''}">${e.pvo !== null ? fmtPvo(e.pvo) : '—'}</span>
      </div>`).join('')
      + (entries.length > VP_ROW_CAP && !vpShowAll
          ? `<button class="vp-more-btn" id="vpMoreBtn">Show all ${entries.length}</button>` : '')
      + `<div class="vp-legend">Avg RVOL per ${vpMode} · PVO = avg volume oscillator %</div>`;

    document.getElementById('vpMoreBtn')?.addEventListener('click', () => {
      vpShowAll = true;
      renderVolumePulse();
    });

    // Row click → scanner filtered to that market / industry
    body.querySelectorAll('.vp-row[data-vp-key]').forEach(row => {
      row.addEventListener('click', () => {
        const key = row.dataset.vpKey;
        if (vpMode === 'market') {
          const sel = document.getElementById('scannerClassFilter');
          if (sel) sel.value = key;
        } else {
          const inp = document.getElementById('scannerSearch');
          if (inp) inp.value = key;
          clearCatChip();
        }
        updateScannerCtxStrip?.();
        navigateToTab('scanner');
        buildScannerCards();
      });
    });
  }

  function VP_LOOKBACK_LABEL() { return timeframe === '4H' ? '25-bar' : '25-day'; }

  // ── Sector Activity Radar — anomaly monitor, quiet on normal days ──
  // Axis value = z of today's activity rate vs the sector's OWN trailing
  // baseline (daily TF fires + RVOL>=2 spikes, per member). Display gate is
  // stricter than the data's hot flag: z>=2 OR hot for 2+ days, so a single
  // borderline 1.5σ day stays quiet.
  // Quiet days collapse to the header row alone; on alert days every spoke
  // carries its z value (hot = tilt color, 1σ..alert = dim "warming" tier).
  const SR_ABBR = {
    'Technology': 'Tech', 'Financial Services': 'Fin', 'Consumer Cyclical': 'ConsCyc',
    'Industrials': 'Indust', 'Crypto': 'Crypto', 'Healthcare': 'Health',
    'Consumer Defensive': 'ConsDef', 'Utilities': 'Util', 'Basic Materials': 'Matls',
    'Communication Services': 'Comms', 'Energy': 'Energy', 'Real Estate': 'RealEst',
    'Index': 'Indices', 'Commodities': 'Commod',
  };

  function renderSectorRadar() {
    const card = document.getElementById('sectorRadarCard');
    const body = document.getElementById('sectorRadarBody');
    const badge = document.getElementById('sectorRadarBadge');
    if (!card || !body) return;
    const d = sectorRadarData;
    if (!d) { card.style.display = 'none'; return; }
    card.style.display = '';

    const alertZ = d.alert_z || 1.5;
    const secs = d.sectors.filter(s => s.members >= (d.min_members || 8));
    secs.sort((a, b) => b.members - a.members);   // stable axis order
    const N = secs.length;
    const zc = s => Math.max(0, Math.min(3, s.z === null ? 0 : s.z));
    const shown = s => s.hot && (s.z >= 2 || s.elevated_days >= 2);
    const warming = s => !shown(s) && s.z !== null && s.z >= 1;   // building, not yet at alert
    const tiltCol = s => s.tilt === 'buy' ? 'var(--buy)' : s.tilt === 'sell' ? 'var(--sell)' : 'var(--accent)';
    const tiltGlyph = s => s.tilt === 'buy' ? '▲' : s.tilt === 'sell' ? '▼' : '◆';
    const zdesc = (a, b) => (b.z === null ? -9 : b.z) - (a.z === null ? -9 : a.z);
    const hotSecs  = secs.filter(shown).sort(zdesc);     // most active first
    const warmSecs = secs.filter(warming).sort(zdesc);   // ≥1σ, building but not yet at alert
    const baseSecs = secs.filter(s => !shown(s) && !warming(s)).sort(zdesc);
    const active = hotSecs.length + warmSecs.length;

    if (badge) {
      badge.textContent = hotSecs.length
        ? `${hotSecs.length} hot`
        : warmSecs.length
          ? `${warmSecs.length} building`
          : `✓ all ${N} at baseline`;
      badge.classList.toggle('sr-hot-badge', hotSecs.length > 0);
      badge.classList.toggle('sr-warm-badge', hotSecs.length === 0 && warmSecs.length > 0);
      badge.classList.toggle('sr-quiet-badge', active === 0);
    }

    // User preference (2026-07-21): the radar ALWAYS stays expanded. Even on a
    // dead-flat day the full polygon renders — spokes near center, every sector
    // labelled with its z, baseline chips below. It never collapses to the
    // header row (the badge still reads "✓ all N at baseline" on a quiet day).
    card.classList.remove('sr-collapsed');

    // ── radar polygon SVG — every spoke labeled with its z ──
    const CX = 230, CY = 178, R = 118;
    const pt = (i, r) => {
      const a = (-90 + i * 360 / N) * Math.PI / 180;
      return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
    };
    let axes = '', stems = '', spokes = '';
    const polyPts = [];
    secs.forEach((s, i) => {
      const [ax, ay] = pt(i, R);
      axes += `<line x1="${CX}" y1="${CY}" x2="${ax.toFixed(1)}" y2="${ay.toFixed(1)}" stroke="#1c1c17"/>`;
      const [px, py] = pt(i, zc(s) / 3 * R);
      polyPts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
      const isHot = shown(s), isWarm = warming(s);
      const col = tiltCol(s);
      let node;
      if (isHot) {
        stems += `<line x1="${CX}" y1="${CY}" x2="${px.toFixed(1)}" y2="${py.toFixed(1)}" stroke="${col}" stroke-width="3" stroke-linecap="round" opacity=".9"/>`;
        node = `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4.5" fill="${col}"/>`;
      } else if (isWarm) {
        stems += `<line x1="${CX}" y1="${CY}" x2="${px.toFixed(1)}" y2="${py.toFixed(1)}" stroke="${col}" stroke-width="2.4" stroke-linecap="round" opacity=".55"/>`;
        node = `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5" fill="${col}" opacity=".75"/>`;
      } else {
        stems += `<line x1="${CX}" y1="${CY}" x2="${px.toFixed(1)}" y2="${py.toFixed(1)}" stroke="#34342f" stroke-width="2" stroke-linecap="round"/>`;
        node = `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.2" fill="#4a4a46"/>`;
      }
      const [lx, ly] = pt(i, R + 16);
      const anchor = lx > CX + 12 ? 'start' : lx < CX - 12 ? 'end' : 'middle';
      const lbl = SR_ABBR[s.sector] || s.sector;
      const zStr = s.z === null ? '' : s.z.toFixed(1);
      let label;
      if (isHot) {
        label = `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${anchor}" font-size="11" font-weight="600" fill="${col}">${lbl} ${tiltGlyph(s)}${zStr}</text>`;
      } else if (isWarm) {
        label = `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${anchor}" font-size="11" fill="${col}" opacity=".8">${lbl} ${tiltGlyph(s)}${zStr}</text>`;
      } else {
        label = `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${anchor}" font-size="10.5" fill="var(--text-muted)">${lbl}${zStr ? ` <tspan fill="#8c8c96">${zStr}</tspan>` : ''}</text>`;
      }
      // Whole spoke (node + label) is a tap target → Signals filtered to this
      // sector. Generous transparent hit-circle over the label makes it usable
      // on touch without overlapping neighbours.
      spokes += `<g class="sr-spoke" data-sr-sector="${s.sector}" style="cursor:pointer" role="button" tabindex="0" aria-label="${s.sector} — open in Signals">`
        + `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="20" fill="transparent"/>${node}${label}</g>`;
    });
    const ring = (z, extra) =>
      `<circle cx="${CX}" cy="${CY}" r="${(z / 3 * R).toFixed(1)}" fill="none" ${extra}/>`;
    const svg = `
      <svg class="sr-radar-svg" viewBox="0 0 460 352" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sector activity radar">
        ${ring(1, 'stroke="#242420"')}${ring(2, 'stroke="#242420"')}${ring(3, 'stroke="#1d1d19"')}
        ${ring(alertZ, 'stroke="#8a6519" stroke-dasharray="4 4"')}
        <text x="${CX + (alertZ / 3 * R) * 0.72 + 14}" y="${CY - (alertZ / 3 * R) * 0.72}" font-size="10.5" fill="#8a6519">alert ${alertZ}σ</text>
        <text x="${CX + 4}" y="${Math.round(CY - R / 3 + 11)}" font-size="9" fill="#4a4a46">1σ</text>
        <text x="${CX + 4}" y="${Math.round(CY - 2 * R / 3 + 11)}" font-size="9" fill="#4a4a46">2σ</text>
        ${axes}
        <polygon points="${polyPts.join(' ')}" fill="rgba(251,191,36,.05)" stroke="#55554e" stroke-width="1.2"/>
        ${stems}${spokes}
      </svg>`;

    // ── hot / building sector cards + baseline line ──
    const cards = hotSecs.map(s => `
      <div class="sr-hot-card" data-sr-sector="${s.sector}" style="border-color:${tiltCol(s)}">
        <div class="sr-hot-head" style="color:${tiltCol(s)}">
          <span>${s.sector.toUpperCase()}${s.tilt === 'buy' ? ' ▲ buy-tilted' : s.tilt === 'sell' ? ' ▼ sell-tilted' : s.tilt === 'mixed' ? ' ◆ mixed' : ' ◆ vol only'}</span>
          <span>z ${s.z.toFixed(1)}</span>
        </div>
        <div class="sr-hot-sub">elevated ${s.elevated_days} day${s.elevated_days === 1 ? '' : 's'} · ${s.buys} buy${s.buys === 1 ? '' : 's'} · ${s.sells} sell${s.sells === 1 ? '' : 's'} · ${s.vol_spikes} vol spike${s.vol_spikes === 1 ? '' : 's'}</div>
        <div class="sr-hot-meta">${s.members} members · rate ${s.rate.toFixed(2)}${s.mean_rate !== null ? ' vs mean ' + s.mean_rate.toFixed(2) : ''} · ${s.date}</div>
      </div>`).join('');
    // Building sectors (≥1σ, below alert) — dimmer, so a quiet-ish day still shows movement
    const warmCards = warmSecs.map(s => `
      <div class="sr-warm-card" data-sr-sector="${s.sector}" style="border-left-color:${tiltCol(s)}">
        <div class="sr-warm-head">
          <span>${s.sector.toUpperCase()} · building${s.tilt === 'buy' ? ' ▲ buy-tilted' : s.tilt === 'sell' ? ' ▼ sell-tilted' : s.tilt === 'mixed' ? ' ◆ mixed' : ''}</span>
          <span>z ${s.z.toFixed(1)}</span>
        </div>
        <div class="sr-hot-meta">${s.buys} buy${s.buys === 1 ? '' : 's'} · ${s.sells} sell${s.sells === 1 ? '' : 's'} · ${s.vol_spikes} vol spike${s.vol_spikes === 1 ? '' : 's'} · ${s.members} members · ${s.date}</div>
      </div>`).join('');
    // Baseline sectors (<1σ) — compact clickable chips, still activity-ranked
    const baseChips = baseSecs.length ? `
      <div class="sr-base-head">${baseSecs.length === N ? 'All ' + N + ' sectors' : baseSecs.length + ' sector' + (baseSecs.length === 1 ? '' : 's')} at baseline (z &lt; 1σ) · tap to scan</div>
      <div class="sr-chips">${baseSecs.map(s => {
        const zStr = s.z === null ? '–' : s.z.toFixed(1);
        return `<button class="sr-chip" data-sr-sector="${s.sector}">${SR_ABBR[s.sector] || s.sector} <span class="sr-chip-z">${zStr}</span></button>`;
      }).join('')}</div>` : '';

    body.innerHTML = svg + `<div class="sr-cards">${cards}${warmCards}${baseChips}</div>`
      + `<div class="sr-legend">z vs own ${d.baseline_days || 20}-day baseline · <span style="color:var(--buy)">●</span> buy-tilted · <span style="color:var(--sell)">●</span> sell-tilted · <span style="color:var(--accent)">●</span> mixed / vol-only · dim = building (1σ+) · grey = at baseline · tap any sector → Signals</div>`;

    // Any sector element (spoke, hot/building card, baseline chip) → Signals
    // filtered to that sector, ranked activity-first (signal-bearing on top).
    const srGoToSector = sector => {
      const inp = document.getElementById('scannerSearch');
      if (inp) inp.value = sector;
      clearCatChip();
      scannerSort = 'signal';
      const sortSel = document.getElementById('scannerSort');
      if (sortSel) sortSel.value = 'signal';
      updateScannerCtxStrip?.();
      navigateToTab('scanner');
      buildScannerCards();
    };
    body.querySelectorAll('[data-sr-sector]').forEach(el => {
      el.addEventListener('click', () => srGoToSector(el.dataset.srSector));
      if (el.tagName.toLowerCase() === 'g') {   // keyboard access for SVG spokes
        el.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); srGoToSector(el.dataset.srSector); }
        });
      }
    });
  }

  // Swap each mover row's plain RVOL bar for a daily volume-vs-average
  // sparkline once its history arrives (cached, so re-renders are instant).
  function hydrateMoverSparks(body, items) {
    items.forEach(item => {
      fetchVolHistory(item).then(hist => {
        if (!hist) return;
        if (vpMode !== 'movers' || !body.isConnected) return;   // view changed mid-fetch
        const row = body.querySelector(`.vp-row[data-arg="${CSS.escape(item.instrument_name)}"]`);
        const slot = row?.querySelector('.vp-spark-slot');
        if (!slot) return;
        const N = Math.min(24, hist.vols.length);
        slot.classList.add('vp-spark-live');
        slot.innerHTML = volDetailSvg(hist.vols.slice(-N), hist.avgs.slice(-N), (hist.closes || []).slice(-N), 120, 26);
      });
    });
  }

  // ── BP1/SP1 + BP3/SP3 Trend Change Alert Banner ───────────────────────
  function renderAlertBanner() {
    const banner = document.getElementById('trendAlertBanner');
    const scroll = document.getElementById('trendAlertScroll');
    const countEl = document.getElementById('trendAlertCount');
    if (!banner || !scroll) return;

    const alerts = allData.filter(d => {
      const sig = d[f('primary_signal')];
      return isReversal(sig) || isLongestMa(sig);
    }).sort((a, b) => {
      // Reversals first, then longest-MA bounces; within a group, proven edge first
      const p = sigPriority(a[f('primary_signal')]) - sigPriority(b[f('primary_signal')]);
      if (p !== 0) return p;
      const ord = { high: 0, standard: 1, '': 1, low: 2 };
      return (ord[(a[f('signal_confidence')] || '').toLowerCase()] ?? 1)
           - (ord[(b[f('signal_confidence')] || '').toLowerCase()] ?? 1);
    });

    // Update signal sheet buttons with dot indicator
    ALL_SIGNAL_CODES.forEach(sig => {
      const btn = document.querySelector(`.sig-sheet-btn[data-filter="${sig}"]`);
      if (!btn) return;
      const hasIt = allData.some(d => d[f('primary_signal')] === sig);
      btn.classList.toggle('has-signals', hasIt);
    });

    if (!alerts.length) { banner.style.display = 'none'; return; }

    banner.style.display = '';
    countEl.textContent = alerts.length;

    scroll.innerHTML = alerts.map(item => {
      const sig  = item[f('primary_signal')];
      const buy  = isBuy(item);
      const tick = item.instrument_name || '';
      const name = instName(tick);
      const dir  = buy ? '▲' : '▼';
      const dCls = buy ? 'tci-buy' : 'tci-sell';
      const pCls = isReversal(sig) ? 'tci-p1' : 'tci-p2';
      const conf = (item[f('signal_confidence')] || '').toLowerCase();
      const lbl  = conf === 'low' ? 'Low Edge'
                 : isReversal(sig) ? 'Trend Change' : 'Strong Signal';
      const lowCls = conf === 'low' ? ' tci-lowconf' : '';
      const lowTip = conf === 'low' ? ' title="This signal code has negative backtested expectancy on this timeframe/asset class"' : '';
      return `<div class="trend-alert-item ${dCls} ${pCls}${lowCls}" data-act="openModal" data-arg="${tick}"${lowTip}>
        <span class="tci-badge">${sig}</span>
        <span class="tci-dir">${dir}</span>
        <span class="tci-name">
          <span class="tci-ticker">${tick}</span>
          ${name ? `<span class="tci-fullname">${name}</span>` : ''}
        </span>
        <span class="tci-label">${lbl}</span>
      </div>`;
    }).join('');
  }

  // ── Confidence Breakdown (Dashboard) ──────────────────────────────────
  let activeConfLevel = '';  // currently shown confidence level

  function renderConfidenceBreakdown() {
    const el = document.getElementById('confidenceBreakdown');
    if (!el) return;

    // Count by confidence level
    const counts = { high: 0, standard: 0, low: 0, none: 0 };
    const byLevel = { high: [], standard: [], low: [], none: [] };
    allData.forEach(d => {
      const conf = d[f('signal_confidence')] || '';
      const level = (conf === 'high' || conf === 'standard' || conf === 'low') ? conf : 'none';
      counts[level]++;
      byLevel[level].push(d);
    });
    const total = allData.length || 1;

    const segData = [
      { key: 'high', label: 'High', cls: 'conf-seg-high', count: counts.high },
      { key: 'standard', label: 'Std', cls: 'conf-seg-standard', count: counts.standard },
      { key: 'low', label: 'Low', cls: 'conf-seg-low', count: counts.low },
      { key: 'none', label: 'None', cls: 'conf-seg-none', count: counts.none },
    ];

    el.innerHTML = `
      <div class="conf-stacked-bar">
        ${segData.filter(s => s.count > 0).map(s =>
          `<div class="${s.cls}" style="width:${(s.count / total * 100).toFixed(1)}%" data-conf="${s.key}" title="${s.label}: ${s.count}">${s.count > 0 ? s.count : ''}</div>`
        ).join('')}
      </div>
      <div class="conf-inst-list" id="confInstList"></div>
    `;

    // Click segments to show/hide lists
    el.querySelectorAll('.conf-stacked-bar > div').forEach(seg => {
      seg.addEventListener('click', () => {
        const level = seg.dataset.conf;
        if (activeConfLevel === level) {
          activeConfLevel = '';
        } else {
          activeConfLevel = level;
        }
        renderConfInstList(byLevel);
      });
    });

    // Default: show high-confidence instruments if any
    if (counts.high > 0) {
      activeConfLevel = 'high';
    } else {
      activeConfLevel = '';
    }
    renderConfInstList(byLevel);
  }

  function renderConfInstList(byLevel) {
    const container = document.getElementById('confInstList');
    if (!container) return;

    if (!activeConfLevel || !byLevel[activeConfLevel] || !byLevel[activeConfLevel].length) {
      container.innerHTML = '';
      return;
    }

    const items = byLevel[activeConfLevel];
    const levelLabels = { high: 'High Confidence', standard: 'Standard Confidence', low: 'Low Confidence', none: 'No Confidence Rating' };
    container.innerHTML = `
      <div style="font-size:.72rem;font-weight:700;padding:4px 0;color:var(--text-muted);border-bottom:1px solid var(--border);margin-bottom:4px">${levelLabels[activeConfLevel]} (${items.length})</div>
      ${items.map(item => {
        const sig = item[f('primary_signal')] || '';
        const buy = isBuy(item);
        const sell = isSell(item);
        const sigBadge = sig ? `<span class="feed-badge badge-${sigClass(sig)}" style="font-size:.55rem;padding:1px 5px">${sig}</span>` : '';
        return `<div class="conf-inst-row" data-act="openModal" data-arg="${item.instrument_name}">
          <span style="font-weight:600">${item.instrument_name} ${sigBadge}</span>
          <span style="color:var(--text-muted)">${item.group || ''}</span>
        </div>`;
      }).join('')}
    `;
  }

  // ── Stat Card → Heatmap Filter + Section Lift ───────────────────────
  // Store the heatmap's original position once the DOM is ready so we can
  // restore it when the filter is cleared.
  let hmOriginalNextSibling = null;
  let hmOriginalParent = null;

  function liftHeatmap() {
    const hm = document.getElementById('heatmapCard');
    const statCards = document.querySelector('.stat-cards');
    if (!hm || !statCards) return;
    // Save original position the first time
    if (!hmOriginalParent) {
      hmOriginalParent = hm.parentNode;
      hmOriginalNextSibling = hm.nextSibling;
    }
    // Move heatmap to appear immediately after stat cards
    statCards.insertAdjacentElement('afterend', hm);
    hm.classList.add('heatmap-lifted');
  }

  function dropHeatmap() {
    const hm = document.getElementById('heatmapCard');
    if (!hm || !hmOriginalParent) return;
    // Restore to original position
    hmOriginalParent.insertBefore(hm, hmOriginalNextSibling);
    hm.classList.remove('heatmap-lifted');
  }

  // Stat card heatmap filter removed — stat cards no longer in DOM

  // ── Tab navigation helper ─────────────────────────────────────────────
  function navigateToTab(tabName) {
    // 'radar' and 'flow' tabs are now gone — redirect to their new homes
    if (tabName === 'radar') tabName = 'scanner';
    if (tabName === 'flow')  tabName = 'dashboard';
    const btn = document.querySelector(`.nav-tab[data-tab="${tabName}"]`);
    if (btn) btn.click();
  }

  // ── Strength score (0–100) ────────────────────────────────────────────
  function computeStrengthScore() {
    const total = allData.length || 1;
    const s = computeSummary();
    const tc = s.trend_counts || {};
    const up   = tc.UPTREND   || 0;
    const down = tc.DOWNTREND || 0;
    const buy  = s.buy_count  || 0;
    const sell = s.sell_count || 0;
    // Trend component (0–50): normalise net trend to 0–50
    const trendPts = Math.round(((up - down) / total + 1) / 2 * 50);
    // Signal direction (0–30): buy ratio of active signals
    const sigTotal = buy + sell;
    const sigPts = sigTotal > 0 ? Math.round((buy / sigTotal) * 30) : 15;
    // Bonus (0–20): triple-aligned + vol spikes
    const tripleCount = allData.filter(d => isTripleAligned(d)).length;
    const volCount    = s.volume_spikes || 0;
    const bonusPts    = Math.min(Math.round((tripleCount + volCount) / total * 30), 20);
    return Math.min(Math.max(trendPts + sigPts + bonusPts, 0), 100);
  }

  // ── Gauge renderer ───────────────────────────────────────────────────
  function renderGauge() {
    const score   = computeStrengthScore();
    const s       = computeSummary();
    const tc      = s.trend_counts || {};

    // Needle: -90deg = score 0, +90deg = score 100
    const angle   = -90 + (score / 100) * 180;
    const needle  = document.getElementById('gaugeNeedle');
    const arc     = document.getElementById('gaugeArc');
    const scoreEl = document.getElementById('gaugeScoreText');
    const labelEl = document.getElementById('gaugeLabel');
    if (!needle) return;

    needle.setAttribute('transform', `rotate(${angle} 100 105)`);
    // Arc dashoffset: full arc ≈ 267px
    arc.setAttribute('stroke-dashoffset', String(Math.round((1 - score / 100) * 267)));

    const color = score >= 76 ? 'var(--buy)' : score >= 51 ? 'var(--accent)' : score >= 26 ? 'var(--watch)' : 'var(--sell)';
    const zoneLabel = score >= 76 ? 'Bullish' : score >= 51 ? 'Strong' : score >= 26 ? 'Mixed' : 'Weak';
    scoreEl.textContent = score;
    scoreEl.style.fill = color;
    if (labelEl) labelEl.textContent = zoneLabel + ' market conditions';

    // New breakdown: Uptrend / Downtrend / Neutral
    const gbUp      = document.getElementById('gbUp');
    const gbDown    = document.getElementById('gbDown');
    const gbNeutral = document.getElementById('gbNeutral');
    // Legacy compat (hidden spans)
    const gbBuy  = document.getElementById('gbBuy');
    const gbSell = document.getElementById('gbSell');
    if (gbUp)      gbUp.textContent      = tc.UPTREND   || 0;
    if (gbDown)    gbDown.textContent    = tc.DOWNTREND || 0;
    if (gbNeutral) gbNeutral.textContent = tc.NEUTRAL   || 0;
    if (gbBuy)     gbBuy.textContent     = s.buy_count  || 0;
    if (gbSell)    gbSell.textContent    = s.sell_count || 0;

    // Gradient score bar at bottom of card
    const fill = document.getElementById('mpScoreFill');
    if (fill) fill.style.width = score + '%';

    // 4-TF buy/sell/neutral grid — see all timeframes at a glance
    const tfGrid = document.getElementById('mpTfGrid');
    if (tfGrid && allData.length) {
      const tfs = [
        { code: 'D',  field: 'trend_direction',    label: 'Daily' },
        { code: '4H', field: 'h4_trend_direction', label: '4H' },
      ];
      tfGrid.innerHTML = tfs.map(({ code, field, label }) => {
        let up = 0, dn = 0, nu = 0;
        allData.forEach(d => {
          const t = d[field] || 'NEUTRAL';
          if (t === 'UPTREND') up++;
          else if (t === 'DOWNTREND') dn++;
          else nu++;
        });
        const total = up + dn + nu || 1;
        const upPct = (up / total) * 100;
        const dnPct = (dn / total) * 100;
        const nuPct = (nu / total) * 100;
        const isActive = timeframe === code;
        return `<div class="mp-tf-row${isActive ? ' active' : ''}" data-mp-tf="${code}">
          <span class="mp-tf-lbl">${label}</span>
          <div class="mp-tf-bar">
            <span class="mp-tf-bar-seg mp-tf-up"   style="width:${upPct}%"></span>
            <span class="mp-tf-bar-seg mp-tf-neut" style="width:${nuPct}%"></span>
            <span class="mp-tf-bar-seg mp-tf-down" style="width:${dnPct}%"></span>
          </div>
          <span class="mp-tf-stats"><span style="color:var(--buy)">▲${up}</span> <span style="color:var(--sell)">▼${dn}</span></span>
        </div>`;
      }).join('');
    }
  }

  function rebuildCharts() {
    const c = getThemeColors();

    Object.values(charts).forEach(ch => { if (ch && ch.destroy) ch.destroy(); });
    charts = {};
    Chart.defaults.color = c.text;
    Chart.defaults.borderColor = c.grid;

    renderGauge();
  }

  // ── Heatmap ──────────────────────────────────────────────────────────
  function renderHeatmap() {
    const filtersEl = document.getElementById('heatmapFilters');
    if (!filtersEl) return;   // heatmap removed from dashboard
    const groups = summaryData.groups || [];
    filtersEl.innerHTML = '<button class="heatmap-filter-btn active" data-group="all">All</button>' +
      groups.map(g => `<button class="heatmap-filter-btn" data-group="${g}">${g}</button>`).join('');
    filtersEl.querySelectorAll('.heatmap-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        filtersEl.querySelectorAll('.heatmap-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeHeatmapGroup = btn.dataset.group;
        buildHeatmapCells();
      });
    });

    buildHeatmapCells();
  }

  function buildHeatmapCells() {
    const grid = document.getElementById('heatmapGrid');
    if (!grid) return;  // heatmap card was removed from the dashboard — no-op (avoids null.innerHTML that aborted the row-tap → scanner handler)
    let filtered = activeHeatmapGroup === 'all' ? allData : allData.filter(d => d.group === activeHeatmapGroup);

    // ── Legend filter (only show that signal type) ──
    if (activeHmLegendFilter === 'buy')     filtered = filtered.filter(isBuy);
    else if (activeHmLegendFilter === 'sell')    filtered = filtered.filter(isSell);
    else if (activeHmLegendFilter === 'neutral') filtered = filtered.filter(d => !isBuy(d) && !isSell(d));

    // ── Stat card filter (show only matching) ──
    if (activeStatFilter === 'buy')      filtered = filtered.filter(isBuy);
    else if (activeStatFilter === 'sell')     filtered = filtered.filter(isSell);
    else if (activeStatFilter === 'volume')   filtered = filtered.filter(d => d[f('volume_spike_flag')] === 'yes');
    else if (activeStatFilter === 'squeeze')  filtered = filtered.filter(d => d[f('ribbon_compression')] === 'yes');
    else if (activeStatFilter === 'highconf') filtered = filtered.filter(d => d[f('signal_confidence')] === 'high' || d[f('signal_confidence')] === 'standard');

    // ── Trend direction filter (uses effectiveTrend so transitioning instruments are included) ──
    if (activeTrendFilter) filtered = filtered.filter(d => effectiveTrend(d) === activeTrendFilter);

    // ── Alignment filter ──
    if (activeAlignFilter) filtered = filtered.filter(d => (d.tf_alignment || '') === activeAlignFilter);

    // ── Update legend active state ──
    document.querySelectorAll('.legend-item[data-legend-filter]').forEach(el => {
      el.classList.toggle('legend-active', el.dataset.legendFilter === activeHmLegendFilter);
    });

    // ── Update trend pill active states ──
    ['pulseUptrend','pulseDowntrend','pulseNeutral'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const map = { pulseUptrend: 'UPTREND', pulseDowntrend: 'DOWNTREND', pulseNeutral: 'NEUTRAL' };
      el.classList.toggle('pulse-stat-active', activeTrendFilter === map[id]);
    });
    const alignEl = document.getElementById('pulseAlignment');
    if (alignEl) alignEl.classList.toggle('pulse-stat-active', !!activeAlignFilter);

    // ── Active states on new MP card rows ──
    const bdTrendMap = { mpBdUp: 'UPTREND', mpBdDown: 'DOWNTREND', mpBdNeutral: 'NEUTRAL' };
    Object.entries(bdTrendMap).forEach(([id, trend]) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('mp-bd-active', activeTrendFilter === trend);
    });
    const bdAlign = document.getElementById('mpBdAlign');
    if (bdAlign) bdAlign.classList.toggle('mp-bd-active', !!activeAlignFilter && activeAlignFilter === (bdAlign.dataset.filterAlign || ''));

    // ── Clear-filter chip in heatmap header ──
    const clearChip = document.getElementById('hmTrendClear');
    if (clearChip) {
      const activeLabel = activeTrendFilter
        ? activeTrendFilter.charAt(0) + activeTrendFilter.slice(1).toLowerCase()
        : activeAlignFilter || '';
      if (activeLabel) {
        clearChip.textContent = activeLabel + ' ×';
        clearChip.style.display = 'inline-flex';
        clearChip.onclick = () => {
          activeTrendFilter = '';
          activeAlignFilter = '';
          buildHeatmapCells();
        };
      } else {
        clearChip.style.display = 'none';
        clearChip.onclick = null;
      }
    }

    // Cap heatmap at 200 cells to keep the Dashboard responsive
    const HM_CAP = 200;
    const hmFiltered = filtered.length > HM_CAP ? filtered.slice(0, HM_CAP) : filtered;
    const hmOverflow = filtered.length > HM_CAP
      ? `<div class="hm-overflow-note">${filtered.length - HM_CAP} more — use group filter to narrow</div>`
      : '';

    grid.innerHTML = hmFiltered.map((item, i) => {
      const cls = signalClass(item);
      const hmCls = 'hm-' + cls;
      const primary = item[f('primary_signal')] ? 'hm-primary' : '';
      const sig = item[f('primary_signal')] || '';
      const finalCls = hmCls;
      const alignColor = (item.tf_alignment || '').includes('Bull') ? 'var(--buy)' : (item.tf_alignment || '').includes('Bear') ? 'var(--sell)' : 'var(--watch)';
      const squeeze = item[f('ribbon_compression')] === 'yes';
      const triple = isTripleAligned(item);
      const hmDelay = Math.min(i, 25) * 15;  // cap at 375 ms
      return `<div class="heatmap-cell ${finalCls} ${primary} pop-in" style="animation-delay:${hmDelay}ms"
                   data-ticker="${item.instrument_name}">
        ${squeeze ? '<div class="hm-squeeze-dot"></div>' : ''}
        ${triple ? '<div class="hm-3tf-dot"></div>' : ''}
        <span class="cell-name">${item.instrument_name}</span>
        ${sig ? `<span class="cell-signal">${sig}</span>` : ''}
        <div class="heatmap-cell-actions">
          ${tvBtn(item.instrument_name, '')}
          <button class="hm-detail-btn" data-act="openModal" data-arg="${item.instrument_name}" data-stop="1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          </button>
          <button class="hm-detail-btn hm-star-btn star-btn ${userStarred.has(item.instrument_name) ? 'starred' : ''}" data-ticker="${item.instrument_name}" data-act="toggleStar" data-stop="1" title="${userStarred.has(item.instrument_name) ? 'Unmark as analyzed' : 'Mark as analyzed'}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="${userStarred.has(item.instrument_name) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </button>
        </div>
        <div class="hm-align-bar" style="background:${alignColor}"></div>
      </div>`;
    }).join('') + hmOverflow;
  }

  // ── Signal Feed (Dashboard) ──────────────────────────────────────────
  function renderSignalFeed() {
    const feed = document.getElementById('signalFeed');
    const signaled = allData.filter(d => d[f('primary_signal')]);

    if (!signaled.length) {
      feed.innerHTML = '<div class="feed-empty">No active signals today</div>';
      return;
    }

    signaled.sort((a, b) => sigPriority(a[f('primary_signal')]) - sigPriority(b[f('primary_signal')]));

    feed.innerHTML = signaled.map(item => {
      const buy = isBuy(item);
      const sig = item[f('primary_signal')];
      let badgeCls = '';
      const sCls = sigClass(sig);
      if (sCls) {
        badgeCls = buy ? `badge-${sCls}` : (sCls === 'p1' ? 'badge-sell-p1' : 'badge-sell-p2');
      }

      // ROC momentum
      const roc = parseFloat(item[f('roc')]);
      const rocStr = !isNaN(roc) ? (roc >= 0 ? '+' : '') + roc.toFixed(1) + '%' : '';
      const rocCls = !isNaN(roc) ? (roc >= 0 ? 'roc-pos' : 'roc-neg') : '';

      // MA order gauge
      const maOrder = parseInt(item[f('ma_order_score')]);
      const maMaxPairs = summaryData.ma_max_pairs || 19;
      const maOrderPct = !isNaN(maOrder) ? Math.round(maOrder / maMaxPairs * 100) : null;
      const maOrderColor = maOrderPct !== null ? (maOrderPct > 60 ? 'var(--buy)' : maOrderPct < 40 ? 'var(--sell)' : 'var(--watch)') : 'var(--border)';

      // Volume spike
      const volSpike = item[f('volume_spike_flag')] === 'yes';

      return `<div class="signal-feed-item feed-${buy ? 'buy' : 'sell'}" data-act="openModal" data-arg="${item.instrument_name}">
        <div class="feed-info">
          <div class="feed-name">${item.instrument_name} ${volSpike ? '<span class="badge-confidence" style="background:var(--volume-soft);color:var(--volume)">VOL</span>' : ''}</div>
          <div class="feed-detail">${item[f('confirmation_status')] || ''}</div>
          <div class="feed-meta-row">
            ${rocStr ? `<span class="roc-val ${rocCls}" style="font-size:.68rem">ROC ${rocStr}</span>` : ''}
            ${maOrderPct !== null ? `<span class="feed-ma-gauge"><span class="feed-ma-track"><span class="feed-ma-fill" style="width:${maOrderPct}%;background:${maOrderColor}"></span></span><span style="font-size:.58rem;color:var(--text-muted)">${maOrder}/${maMaxPairs}</span></span>` : ''}
          </div>
        </div>
        ${tvBtn(item.instrument_name, '')}
        <span class="feed-group">${item.group || ''}</span>
      </div>`;
    }).join('');
  }

  // ── Alignment Summary (Dashboard) ────────────────────────────────────
  let activeAlignment = '';   // currently expanded alignment label

  function renderAlignmentSummary() {
    const el = document.getElementById('alignmentSummary');
    if (!el) return;

    // Group instruments by alignment
    const groups = {};
    allData.forEach(item => {
      const a = item.tf_alignment || 'Unknown';
      if (!groups[a]) groups[a] = [];
      groups[a].push(item);
    });

    const order = ['Aligned Bull', 'Mixed', 'Counter-trend', 'Aligned Bear'];
    const labels = order.filter(k => groups[k]);

    const colorVar = label =>
      label.includes('Bull') ? '--buy' : label.includes('Bear') ? '--sell' : label === 'Counter-trend' ? '--volume' : '--watch';

    el.innerHTML = `
      <div class="alignment-grid">
        ${labels.map(label => {
          const active = activeAlignment === label;
          return `<div class="alignment-item ${active ? 'alignment-active' : ''}" data-align="${label}" role="button" tabindex="0">
            <div class="alignment-item-count" style="color:var(${colorVar(label)})">${groups[label].length}</div>
            <div class="alignment-item-label">${label}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="alignment-instruments" id="alignmentInstruments"></div>
    `;

    // Click handlers
    el.querySelectorAll('.alignment-item').forEach(item => {
      item.addEventListener('click', () => {
        const label = item.dataset.align;
        if (activeAlignment === label) {
          activeAlignment = '';
        } else {
          activeAlignment = label;
        }
        el.querySelectorAll('.alignment-item').forEach(i => i.classList.toggle('alignment-active', i.dataset.align === activeAlignment));
        renderAlignmentInstruments(groups);
      });
    });

    renderAlignmentInstruments(groups);
  }

  function renderAlignmentInstruments(groups) {
    const container = document.getElementById('alignmentInstruments');
    if (!container) return;

    if (!activeAlignment || !groups[activeAlignment]) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }

    container.style.display = '';
    const items = groups[activeAlignment];
    container.innerHTML = `
      <div class="alignment-inst-header">${activeAlignment} <span style="color:var(--text-muted)">(${items.length})</span></div>
      <div class="alignment-inst-list">
        ${items.map(item => {
          const sig = item[f('primary_signal')] || '';
          const buy = isBuy(item);
          const sell = isSell(item);
          const sigBadge = sig ? `<span class="feed-badge badge-${sigClass(sig) || 'p4'}">${sig}</span>` : '';
          const conf = item[f('signal_confidence')] || '';
          const confBadge = conf ? `<span class="badge-confidence conf-${conf}">${conf}</span>` : '';
          const roc = parseFloat(item[f('roc')]);
          const rocStr = !isNaN(roc) ? (roc >= 0 ? '+' : '') + roc.toFixed(1) + '%' : '';
          const trend = effectiveTrend(item);
          const compression = item[f('ribbon_compression')] === 'yes';
          return `<div class="alignment-inst-row ${buy ? 'feed-buy' : sell ? 'feed-sell' : ''}" data-act="openModal" data-arg="${item.instrument_name}">
            <div class="alignment-inst-name">
              ${item.instrument_name} ${tvBtn(item.instrument_name, '')}
              ${sigBadge} ${confBadge}
              ${compression ? '<span class="compression-alert" style="font-size:.55rem">SQUEEZE</span>' : ''}
            </div>
            <div class="alignment-inst-meta">
              <span class="scanner-tag ${trendTag(trend)}" style="font-size:.6rem;padding:1px 6px">${trend}</span>
              ${rocStr ? `<span class="roc-val ${roc >= 0 ? 'roc-pos' : 'roc-neg'}" style="font-size:.7rem">${rocStr}</span>` : ''}
              <span style="font-size:.7rem;color:var(--text-muted)">${formatPrice(item[f('close')])}</span>
            </div>
          </div>`;
        }).join('')}
      </div>
    `;
  }

  // ── Compression Feed (Dashboard) ─────────────────────────────────────
  function renderCompressionFeed() {
    const card = document.getElementById('compressionCard');
    const feed = document.getElementById('compressionFeed');
    if (!card || !feed) return;
    const compressed = allData.filter(d => d[f('ribbon_compression')] === 'yes');
    if (!compressed.length) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';
    feed.innerHTML = compressed.map(item => {
      const spread = parseFloat(item[f('ribbon_spread')]);
      const order = parseInt(item[f('ma_order_score')]);
      const maxPairs = summaryData.ma_max_pairs || 19;
      const mid = maxPairs / 2;
      const dir = order > mid ? 'Bullish lean' : order < mid ? 'Bearish lean' : 'Neutral';
      return `<div class="signal-feed-item" data-act="openModal" data-arg="${item.instrument_name}" style="border-left:3px solid var(--volume)">
        <span class="compression-alert">SQUEEZE</span>
        <div class="feed-info">
          <div class="feed-name">${item.instrument_name} ${tvBtn(item.instrument_name, '')}</div>
          <div class="feed-detail">Spread: ${spread ? spread.toFixed(1) : '--'}% | Order: ${isNaN(order) ? '--' : order}/${maxPairs} | ${dir}</div>
        </div>
        <span class="feed-group">${item.group || ''}</span>
      </div>`;
    }).join('');
  }

  // ── Alignment helper ─────────────────────────────────────────────────
  function alignCls(label) {
    if (label.includes('Bull')) return 'align-bull';
    if (label.includes('Bear')) return 'align-bear';
    if (label === 'Counter-trend') return 'align-counter';
    return 'align-mixed';
  }

  // ── Signals Tab ──────────────────────────────────────────────────────
  // ── Signal age helper (Feature 6: visual decay) ─────────────────────
  // Age is measured against the DATA's own latest bar (asOfStr), not the wall
  // clock — a signal that fired on the newest bar we hold must read "Today" even
  // if the calendar has since rolled over. Otherwise every fresh fire showed
  // "1d ago" alongside a structurally-0.0% "since fired" (no new bar had closed).
  // Both dates are parsed as UTC midnight so the diff can't slip a day in a
  // negative-offset timezone.
  function signalAge(dateStr, asOfStr) {
    if (!dateStr) return { label: '', isToday: false, decayClass: '' };
    const diffDays = daysBetween(dateStr, asOfStr);
    if (diffDays === null) return { label: '', isToday: false, decayClass: '' };
    // A fire on the newest bar is "Today" only if that bar IS today's date;
    // when the feed is behind, say "Latest bar" rather than claim it's today.
    if (diffDays === 0) {
      const fresh = !asOfStr || daysBetween(asOfStr) === 0;
      return { label: fresh ? 'Today' : 'Latest bar', isToday: true, decayClass: 'age-fresh' };
    }
    if (diffDays === 1) return { label: '1d ago',          isToday: false, decayClass: 'age-1d'     };
    if (diffDays <= 3)  return { label: diffDays + 'd ago', isToday: false, decayClass: 'age-aging'  };
    if (diffDays <= 7)  return { label: diffDays + 'd ago', isToday: false, decayClass: 'age-old'    };
    return                     { label: diffDays + 'd ago', isToday: false, decayClass: 'age-stale'  };
  }

  // ── Instrument Notes ─────────────────────────────────────────────────
  function noteIndicator(name) {
    const note = instrumentNotes[name];
    if (!note) return '';
    return `<span class="note-indicator" title="${note.replace(/"/g,'&quot;')}">✏</span>`;
  }

  // ── Feature 4: Multi-TF Alignment badge ─────────────────────────────
  function isTripleAligned(item) {
    const a = item.tf_alignment || '';
    return a === 'Aligned Bull' || a === 'Aligned Bear';
  }
  function badge3TF(item) {
    if (!isTripleAligned(item)) return '';
    const a = item.tf_alignment || '';
    const bull = a.includes('Bull');
    return `<span class="badge-3tf ${bull ? 'badge-3tf-bull' : 'badge-3tf-bear'}">2TF✓</span>`;
  }

  // Trend maturity badge based on trend run days
  function trendMaturityBadge(item) {
    const days = parseInt(item[f('trend_run_days')]);
    if (isNaN(days) || days < 1) return '';
    let label, cls;
    if      (days <= 7)  { label = '🌱 Young';     cls = 'maturity-young'; }
    else if (days <= 21) { label = '📈 Developing'; cls = 'maturity-developing'; }
    else if (days <= 60) { label = '🏔 Mature';     cls = 'maturity-mature'; }
    else                 { label = '⚠️ Extended';   cls = 'maturity-extended'; }
    return `<span class="sig-badge ${cls}" title="${days} days in trend">${label}</span>`;
  }

  // ── Feature 9: Similar Setups ────────────────────────────────────────
  function similarityScore(a, b) {
    let s = 0;
    if (a[f('primary_signal')] && a[f('primary_signal')] === b[f('primary_signal')]) s += 4;
    if (a.tf_alignment && a.tf_alignment === b.tf_alignment) s += 3;
    if (a[f('trend_direction')] && a[f('trend_direction')] === b[f('trend_direction')]) s += 2;
    if (isBuy(a) && isBuy(b)) s += 1;
    if (isSell(a) && isSell(b)) s += 1;
    if (a[f('volume_spike_flag')] === 'yes' && b[f('volume_spike_flag')] === 'yes') s += 1;
    if (a.group && a.group === b.group) s += 1;
    return s;
  }
  function findSimilarSetups(item) {
    const sig       = item[f('primary_signal')] || '';
    const buyItem   = isBuy(item);
    const sellItem  = isSell(item);
    if (!sig) return [];
    return allData
      .filter(d => {
        if (d.instrument_name === item.instrument_name) return false;
        if (buyItem  && !isBuy(d))  return false;
        if (sellItem && !isSell(d)) return false;
        return !!(d[f('primary_signal')]);
      })
      .map(d => ({ ...d, _sim: similarityScore(item, d) }))
      .sort((a, b) => b._sim - a._sim)
      .slice(0, 3);
  }

  function buildSignalDesc(item) {
    const sig = item[f('primary_signal')] || '';
    if (!sig) return '';
    const trend = item[f('established_trend')] || item[f('trend_direction')] || '';
    const conf = item[f('signal_confidence')] || '';
    const volSpike = item[f('volume_spike_flag')] === 'yes';
    const compression = item[f('ribbon_compression')] === 'yes';
    const trendRun = parseInt(item[f('trend_run_days')]);
    const maLongest  = (summaryData && summaryData.ma_longest)   || 500;
    const maShortest = (summaryData && summaryData.ma_shortest)  || 25;
    const sigDesc = {
      B1: `trend reversal — price crossed above all MAs (MA${maShortest}–MA${maLongest})`,
      S1: `trend reversal — price crossed below all MAs (MA${maShortest}–MA${maLongest})`,
      B2: `pullback recovery — price crossed back above MA${maShortest}`,
      S2: `rally rejection — price crossed back below MA${maShortest}`,
      B3: `mid-ribbon bounce off MA250`,
      S3: `mid-ribbon rejection at MA250`,
      B4: `anchor bounce off MA${maLongest}`,
      S4: `anchor rejection at MA${maLongest}`,
    };
    // Direction from the signal code itself — established_trend lags one bar
    // on B1/S1 reversals, which used to label a fresh B1 "bearish".
    const dirWord = sig.startsWith('B') ? 'bullish' : sig.startsWith('S') ? 'bearish' : '';
    const parts = [`${sig}${dirWord ? ' ' + dirWord : ''}: ${sigDesc[sig] || 'signal'}`];
    if (!isNaN(trendRun) && trendRun > 0) parts.push(`${trendRun}d ${trend.toLowerCase()}`);
    if (volSpike) parts.push('volume spike');
    if (compression) parts.push('ribbon compression — breakout watch');
    if (conf === 'high') parts.push('high confidence — backtested edge');
    else if (conf === 'low') parts.push('low confidence — historically weak edge');
    return parts.join(' · ') + '.';
  }

  // ── Scanner Tab (merged Signals + Scanner) ────────────────────────────

  // Merge all "*Index" groups into a single "Indices" option
  const INDEX_GROUPS = new Set(['Asia Index', 'CA Index', 'EU Index', 'US Index']);
  function mapGroup(g) { return INDEX_GROUPS.has(g) ? 'Indices' : g; }

  function renderScanner() {
    const allData = getActiveData(); // respect AI filter
    const rawGroups = summaryData.groups || [];
    const groups = [...new Set(rawGroups.map(mapGroup))].sort();
    const groupSelect = document.getElementById('scannerGroupFilter');
    groupSelect.innerHTML = '<option value="all">All Groups</option>' +
      groups.map(g => `<option value="${g}">${g}</option>`).join('');

    const sectors = [...new Set(allData.map(d => d.sector).filter(Boolean))].sort();
    const sectorSelect = document.getElementById('scannerSectorFilter');
    sectorSelect.innerHTML = '<option value="all">All Sectors</option>' +
      sectors.map(s => `<option value="${s}">${s}</option>`).join('');

    updateScannerCtxStrip();
    buildScannerCards();
  }

  function buildScannerCards(appendPage = false, opts = {}) {
    try {
      _buildScannerCardsInner(appendPage, opts);
      if (typeof updateFilterPills === 'function') updateFilterPills();
    } catch (err) {
      console.error('buildScannerCards crashed:', err);
      const grid = document.getElementById('scannerGrid');
      if (grid) grid.innerHTML = '<div class="scanner-empty">Error loading signals — try refreshing</div>';
    }
  }

  // Mirror of instruments.py asset_class_of(): collapse groups into the broad
  // classes used by the confidence map (Forex kept for old data compatibility).
  function assetClassOf(d) {
    const g = (d.group || '').trim();
    if (g === 'Crypto' || g === 'Blockchain') return 'Crypto';
    if (g === 'Forex') return 'Forex';
    if (g === 'Commodity') return 'Commodity';
    if (g.endsWith('Index')) return 'Index';
    return 'Equity';
  }

  function _buildScannerCardsInner(appendPage = false, opts = {}) {
    if (!appendPage && !opts.keepPage) scannerPage = 1;  // reset to page 1 when filters change
    const grid = document.getElementById('scannerGrid');
    const summaryEl = document.getElementById('scannerSummary');
    const search = document.getElementById('scannerSearch').value.toLowerCase();
    const assetClass = document.getElementById('scannerClassFilter')?.value || 'all';
    const group = document.getElementById('scannerGroupFilter').value;
    const sector = document.getElementById('scannerSectorFilter').value;
    const trend = document.getElementById('scannerTrendFilter').value;
    const alignFilter = document.getElementById('scannerAlignFilter').value;
    const today = new Date(); today.setHours(0,0,0,0);

    let filtered = allData;
    if (search) filtered = filtered.filter(d => matchesSearch(d, search));
    // Class chip — same matcher the term used to get when it was typed into the
    // search box, but as its own filter, so it composes with everything below
    // instead of suppressing it.
    if (scannerCatFilter) filtered = filtered.filter(d => matchesSearch(d, scannerCatFilter));
    if (assetClass !== 'all') filtered = filtered.filter(d => assetClassOf(d) === assetClass);
    if (group !== 'all')   filtered = filtered.filter(d => mapGroup(d.group) === group);
    // Region filter — set by clicking a region row on the By Region card
    if (activeRegionFilter) {
      filtered = filtered.filter(d => (GP_REGION_MAP[d.group] || 'Other') === activeRegionFilter);
    }
    if (sector !== 'all')  filtered = filtered.filter(d => d.sector === sector);
    if (trend !== 'all')   filtered = filtered.filter(d => effectiveTrend(d) === trend);

    // ── Alignment filter ── (neutral-oscillation instruments are excluded from
    // directional Bull/Bear alignment so they stay solely in the Neutral bucket)
    if (alignFilter === 'bull')    filtered = filtered.filter(d => (d.tf_alignment||'').includes('Bull') && effectiveTrend(d) !== 'NEUTRAL');
    else if (alignFilter === 'bear')    filtered = filtered.filter(d => (d.tf_alignment||'').includes('Bear') && effectiveTrend(d) !== 'NEUTRAL');
    else if (alignFilter === 'counter') filtered = filtered.filter(d => d.tf_alignment === 'Counter-trend');
    else if (alignFilter === 'mixed')   filtered = filtered.filter(d => d.tf_alignment === 'Mixed');

    // ── RSI zone filter (uses active timeframe RSI) ──
    const rsiSel = document.getElementById('scannerRsiFilter');
    const rsiVal = rsiSel ? rsiSel.value : 'all';
    if (rsiVal !== 'all') {
      filtered = filtered.filter(d => rsiZone(d[f('rsi')]) === rsiVal);
    }

    // ── Sector-mood filter ──
    if (scannerMoodFilter !== 'all') {
      filtered = filtered.filter(d => matchesMoodFilter(d, scannerMoodFilter));
    }

    // ── Chip filter (skip when user is searching by name) ──
    if (!search) {
      if (activeScannerFilter === 'buy')          filtered = filtered.filter(isBuy);
      else if (activeScannerFilter === 'sell')    filtered = filtered.filter(isSell);
      else if (activeScannerFilter === 'squeeze') filtered = filtered.filter(d => d[f('ribbon_compression')] === 'yes');
      else if (activeScannerFilter === 'keylvl') filtered = filtered.filter(d => d.key_level_touched_today === 'yes');
      else if (activeScannerFilter === 'vol')    filtered = filtered.filter(d => d[f('volume_spike_flag')] === 'yes');
      else if (activeScannerFilter === 'analyzed')   filtered = filtered.filter(d => userStarred.has(d.instrument_name));
      else if (activeScannerFilter === 'unanalyzed') filtered = filtered.filter(d => !userStarred.has(d.instrument_name));
      else if (activeScannerFilter === 'radar_prime')  filtered = filtered.filter(d => radarConfluenceScore(d) >= 75);
      else if (activeScannerFilter === 'radar_strong') filtered = filtered.filter(d => { const s = radarConfluenceScore(d); return s >= 50 && s < 75; });
      else if (activeScannerFilter === 'today') {
        filtered = filtered.filter(d => {
          const sd = new Date(d[f('last_signal_date')] || d[f('date')] || '');
          sd.setHours(0,0,0,0);
          return sd.getTime() === today.getTime();
        });
      } else if (activeScannerFilter === 'best') {
        filtered = filtered.filter(d => {
          const align = d.tf_alignment || '';
          const t = effectiveTrend(d);
          const alignedBull = align.includes('Bull') && t === 'UPTREND';
          const alignedBear = align.includes('Bear') && t === 'DOWNTREND';
          return alignedBull || alignedBear;
        });
      } else if (activeScannerFilter !== 'all') {
        // Match exact signal code (e.g. BP1, SP2)
        filtered = filtered.filter(d => d[f('primary_signal')] === activeScannerFilter);
      }
    }

    // ── Sort ──
    // When filtering by Radar tier, always rank by score high→low — the tier
    // itself only matters relative to the score, so sort by it regardless of
    // the dropdown selection.
    const forceScoreSort = activeScannerFilter === 'radar_prime' || activeScannerFilter === 'radar_strong';
    if (forceScoreSort || scannerSort === 'radar_score') {
      const cache = new Map();
      const scoreOf = d => { let v = cache.get(d); if (v === undefined) { v = radarConfluenceScore(d); cache.set(d, v); } return v; };
      filtered = [...filtered].sort((a, b) => scoreOf(b) - scoreOf(a));
    } else if (scannerSort === 'signal') {
      filtered = [...filtered].sort((a, b) => {
        const aHas = !!(a[f('primary_signal')]);
        const bHas = !!(b[f('primary_signal')]);
        if (aHas !== bHas) return bHas - aHas;
        const confOrder = { high: 0, standard: 1, low: 2, '': 3 };
        return (confOrder[a[f('signal_confidence')]||'']||3) - (confOrder[b[f('signal_confidence')]||'']||3);
      });
    } else if (scannerSort === 'date_desc') {
      filtered = [...filtered].sort((a, b) => {
        const da = a[f('last_signal_date')] || a[f('date')] || '';
        const db = b[f('last_signal_date')] || b[f('date')] || '';
        return db.localeCompare(da);
      });
    } else if (scannerSort === 'conviction') {
      // Sector-mood grade: confirmed (3) > standard (2) > fighting (0) > no signal (-1)
      const rank = it => { const c = convictionOf(it); return c ? c.pips : -1; };
      filtered = [...filtered].sort((a, b) => rank(b) - rank(a));
    } else if (scannerSort === 'conf_desc') {
      const confOrder = { high: 0, standard: 1, low: 2, '': 3 };
      filtered = [...filtered].sort((a, b) => (confOrder[a[f('signal_confidence')]||'']||3) - (confOrder[b[f('signal_confidence')]||'']||3));
    } else if (scannerSort === 'roc_desc') {
      filtered = [...filtered].sort((a, b) => (parseFloat(b[f('roc')])||0) - (parseFloat(a[f('roc')])||0));
    } else if (scannerSort === 'roc_asc') {
      filtered = [...filtered].sort((a, b) => (parseFloat(a[f('roc')])||0) - (parseFloat(b[f('roc')])||0));
    } else if (scannerSort === 'order_desc') {
      filtered = [...filtered].sort((a, b) => (parseInt(b[f('ma_order_score')])||0) - (parseInt(a[f('ma_order_score')])||0));
    } else if (scannerSort === 'run_desc') {
      filtered = [...filtered].sort((a, b) => (parseInt(b[f('trend_run_days')])||0) - (parseInt(a[f('trend_run_days')])||0));
    } else if (scannerSort === 'pct_1d_desc') {
      filtered = [...filtered].sort((a, b) => (parseFloat(b.pct_1d)||0) - (parseFloat(a.pct_1d)||0));
    } else if (scannerSort === 'pct_1d_asc') {
      filtered = [...filtered].sort((a, b) => (parseFloat(a.pct_1d)||0) - (parseFloat(b.pct_1d)||0));
    } else if (scannerSort === 'pct_1y_desc') {
      filtered = [...filtered].sort((a, b) => (parseFloat(b.pct_1y)||0) - (parseFloat(a.pct_1y)||0));
    } else if (scannerSort === 'pct_1y_asc') {
      filtered = [...filtered].sort((a, b) => (parseFloat(a.pct_1y)||0) - (parseFloat(b.pct_1y)||0));
    }

    // ── Summary bar ──
    const buyCount  = filtered.filter(isBuy).length;
    const sellCount = filtered.filter(isSell).length;
    const sqzCount  = filtered.filter(d => d[f('ribbon_compression')] === 'yes').length;
    const klCount   = filtered.filter(d => d.key_level_touched_today === 'yes').length;
    const todayCount = filtered.filter(d => {
      const sd = new Date(d[f('last_signal_date')] || d[f('date')] || '');
      sd.setHours(0,0,0,0);
      return sd.getTime() === today.getTime();
    }).length;

    // Update count header
    const countEl = document.getElementById('sigActiveCount');
    if (countEl) {
      const signaled = filtered.filter(d => d[f('primary_signal')]).length;
      countEl.textContent = `${signaled} signals · ${filtered.length} shown`;
    }

    // The count lives in the sticky header (#sigActiveCount) only — this strip
    // repeated "725 shown" one line below it.
    if (summaryEl) summaryEl.innerHTML = '';

    if (!filtered.length) {
      grid.innerHTML = '<div class="scanner-empty">No instruments match</div>';
      return;
    }

    const makeCard = (item, i) => {
      const t = effectiveTrend(item);
      const _aiScan  = isAI(item.instrument_name);
      const runDays = parseInt(item[f('trend_run_days')]) || 0;
      const barColor = t === 'UPTREND' ? 'var(--buy)' : t === 'DOWNTREND' ? 'var(--sell)' : 'var(--neutral)';
      const compression = item[f('ribbon_compression')] === 'yes';
      const ribbonSpread = parseFloat(item[f('ribbon_spread')]);
      const align = item.tf_alignment || '';
      const maOrder = parseInt(item[f('ma_order_score')]);
      const maMaxPairs = summaryData.ma_max_pairs || 19;
      const maOrderPct = !isNaN(maOrder) ? Math.round(maOrder / maMaxPairs * 100) : null;
      const roc = parseFloat(item[f('roc')]);
      const rocStr = !isNaN(roc) ? (roc >= 0 ? '+' : '') + roc.toFixed(1) + '%' : '';
      const starred = userStarred.has(item.instrument_name);
      const pct = pctFromMa(item);
      const conv = convictionOf(item);   // sector-mood grade (validated Phase 0); null when no signal
      // Cap animation delay so the browser doesn't track hundreds of CSS timers
      const delay = Math.min(i, 30) * 20;

      // Stats row: three uniform tiles (1D / 1Y / VOL)
      const statTile = (label, val) => {
        const v = parseFloat(val);
        if (isNaN(v)) return `<div class="sc-stat"><div class="sc-stat-lbl">${label}</div><div class="sc-stat-val sc-stat-na">—</div></div>`;
        return `<div class="sc-stat"><div class="sc-stat-lbl">${label}</div><div class="sc-stat-val ${v >= 0 ? 'perf-pos' : 'perf-neg'}">${(v >= 0 ? '+' : '') + v.toFixed(2)}%</div></div>`;
      };
      const rv = rvol(item);
      const volTile = rv === null
        ? '<div class="sc-stat"><div class="sc-stat-lbl">VOL</div><div class="sc-stat-val sc-stat-na">—</div></div>'
        : `<div class="sc-stat" title="Today's volume vs its ${timeframe === '4H' ? '4H' : 'daily'} rolling average — ${fmtRvol(rv)} of normal"><div class="sc-stat-lbl">VOL</div><div class="sc-stat-val sc-stat-vol">${fmtRvol(rv)}</div></div>`;

      return `<div class="scanner-card pop-in${_aiScan ? ' ai-card' : ''}${conv && conv.cls ? ' ' + conv.cls : ''}" style="animation-delay:${delay}ms" data-act="openModal" data-arg="${item.instrument_name}">
        <div class="scanner-top">
          <div>
            <div class="scanner-name">${item.instrument_name}${noteIndicator(item.instrument_name)}</div>
            ${instName(item.instrument_name) ? `<div class="inst-fullname">${instName(item.instrument_name)}</div>` : ''}
            <div class="scanner-group">${item.group || ''}${item.sector ? ' / ' + item.sector : ''}${_aiScan ? ' <span class="ai-chip-mini">AI</span>' : ''}</div>
          </div>
          <div class="scanner-actions">
            ${tvBtn(item.instrument_name, '')}
            ${shareBtn(item.instrument_name)}
            <button class="star-btn ${starred ? 'starred' : ''}" data-ticker="${item.instrument_name}" title="${starred ? 'Unmark as analyzed' : 'Mark as analyzed'}" data-act="toggleStar" data-stop="1">★</button>
          </div>
        </div>
        <div class="scanner-price">${formatPrice(item[f('close')])}${pct !== null ? ` <span class="roc-val ${pct >= 0 ? 'roc-pos' : 'roc-neg'}" style="font-size:.7rem" title="Distance from MA500"><span class="pm-lbl">MA500</span>${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span>` : ''}${rocStr ? ` <span class="roc-val ${roc >= 0 ? 'roc-pos' : 'roc-neg'}" style="font-size:.7rem" title="Rate of change"><span class="pm-lbl">ROC</span>${rocStr}</span>` : ''}</div>
        ${verdictBarHtml(item)}
        ${setupPanelHtml(item, { showConf: false })}
        <div class="sc-stats">${statTile('1D', item.pct_1d)}${statTile('1Y', item.pct_1y)}${volTile}</div>
        ${(() => {
          // Build prioritized badge list — trend tag always shown, then top 4 by priority
          const extras = [];
          const push = (p, html) => { if (html) extras.push({ p, html }); };
          push(60, item[f('volume_spike_flag')] === 'yes' ? '<span class="scanner-tag" style="background:var(--volume-soft);color:var(--volume)">VOL SPIKE</span>' : '');
          push(55, compression ? `<span class="scanner-tag" style="background:var(--volume-soft);color:var(--volume)">SQUEEZE${!isNaN(ribbonSpread) ? ' ' + ribbonSpread.toFixed(1) + '%' : ''}</span>` : '');
          push(35, trendMaturityBadge(item));
          push(30, runDays > 0 ? `<span class="scanner-tag" style="background:var(--accent-glow);color:var(--accent)">${runDays}d run</span>` : '');
          extras.sort((a, b) => b.p - a.p);
          const MAX = 4;
          const visible = extras.slice(0, MAX).map(b => b.html).join('');
          const overflow = extras.length > MAX
            ? `<span class="scanner-tag scanner-overflow" title="Open card to see all signals">+${extras.length - MAX}</span>`
            : '';
          return (visible || overflow) ? `<div class="scanner-meta">${visible}${overflow}</div>` : '';
        })()}
        ${maOrderPct !== null ? `<div class="ma-order-gauge" title="${maOrder} of ${maMaxPairs} MA pairs in bullish order">
          <span class="sc-ma-lbl">MA ORDER</span>
          <div class="ma-order-segs">${Array.from({ length: maMaxPairs }, (_, si) =>
            `<span class="ma-order-seg${si < maOrder ? ' on' : ''}"${si < maOrder ? ` style="background:${barColor}"` : ''}></span>`).join('')}</div>
          <span style="font-size:.6rem">${maOrder}/${maMaxPairs}</span>
        </div>` : ''}
      </div>`;
    };

    // ── RANKED VIEW: group signal cards into Prime / Strong / Developing tiers ──
    const tierHeader = (label, count, tierCls) =>
      `<div class="scanner-tier-header ${tierCls}">
        <span class="scanner-tier-label">${label}</span>
        <span class="scanner-tier-count">${count}</span>
        <span class="scanner-tier-line"></span>
      </div>`;

    if (scannerView === 'ranked') {
      const scoreCache = new Map();
      const scoreOf = d => { let v = scoreCache.get(d); if (v === undefined) { v = radarConfluenceScore(d); scoreCache.set(d, v); } return v; };
      const sorted = [...filtered].sort((a, b) => scoreOf(b) - scoreOf(a));
      const prime      = sorted.filter(d => scoreOf(d) >= 75);
      const strong     = sorted.filter(d => { const s = scoreOf(d); return s >= 50 && s < 75; });
      const developing = sorted.filter(d => scoreOf(d) < 50);

      let html = '';
      if (prime.length)      html += tierHeader('Prime', prime.length,      'tier-prime')      + prime.map((d, i) => makeCard(d, i)).join('');
      if (strong.length)     html += tierHeader('Strong', strong.length,    'tier-strong')     + strong.map((d, i) => makeCard(d, i)).join('');
      if (developing.length) html += tierHeader('Developing', developing.length, 'tier-developing') + developing.map((d, i) => makeCard(d, i)).join('');
      grid.innerHTML = html;
      return;
    }

    // ── LIST VIEW: paginated ──
    const totalFiltered = filtered.length;
    const pageEnd   = scannerPage * SCANNER_PAGE_SIZE;
    const pageStart = appendPage ? (scannerPage - 1) * SCANNER_PAGE_SIZE : 0;
    const newItems  = filtered.slice(pageStart, pageEnd);
    const remaining = totalFiltered - pageEnd;

    const cardsHtml = newItems.map((item, i) => makeCard(item, pageStart + i)).join('');
    const loadMoreHtml = remaining > 0
      ? `<div class="scanner-load-more" id="scannerLoadMore">
           <button class="scanner-load-more-btn">Show ${Math.min(remaining, SCANNER_PAGE_SIZE)} more <span style="opacity:.6">(${remaining} remaining)</span></button>
         </div>`
      : '';

    if (appendPage) {
      const old = document.getElementById('scannerLoadMore');
      if (old) old.remove();
      grid.insertAdjacentHTML('beforeend', cardsHtml + loadMoreHtml);
    } else {
      grid.innerHTML = cardsHtml + loadMoreHtml;
    }

    // Wire up load-more button
    const loadMoreBtn = document.getElementById('scannerLoadMore');
    if (loadMoreBtn) {
      loadMoreBtn.querySelector('button').addEventListener('click', () => {
        scannerPage++;
        buildScannerCards(true);  // append next page
      });
    }
  }

  // ── List / Ranked view toggle ──
  (function wireViewToggle() {
    const toggleEl = document.querySelector('.sig-view-toggle');
    if (!toggleEl) return;
    toggleEl.addEventListener('click', e => {
      const btn = e.target.closest('.sig-view-btn');
      if (!btn) return;
      const view = btn.dataset.view;
      if (view === scannerView) return;
      scannerView = view;
      toggleEl.querySelectorAll('.sig-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
      buildScannerCards();
    });
  })();

  (function() {
    const searchEl = document.getElementById('scannerSearch');
    const clearBtn = document.getElementById('scannerSearchClear');
    const chipRow  = document.getElementById('scannerCatChips');

    // Show/hide clear button on input. Category chips are NO LONGER cleared
    // here — they hold their own state now and compose with the search box.
    searchEl.addEventListener('input', debounce(() => {
      clearBtn.style.display = searchEl.value.length > 0 ? '' : 'none';
      buildScannerCards();
    }, 150));

    // Clear button click
    clearBtn.addEventListener('click', () => {
      searchEl.value = '';
      clearBtn.style.display = 'none';
      buildScannerCards();
      searchEl.focus();
    });

    // Category chip clicks
    chipRow.addEventListener('click', e => {
      const chip = e.target.closest('.s-cat-chip');
      if (!chip) return;
      const wasActive = chip.classList.contains('active');
      chipRow.querySelectorAll('.s-cat-chip').forEach(c => c.classList.remove('active'));
      // Own state — these used to write into the search box, which made the
      // scanner treat "picked a class" as "typing a name" and silently skip
      // the whole chip-filter block (Buy/Sell/Today/Squeeze/Key Lvl/Vol/Radar/
      // Analyzed). Picking Crypto turned all of those off without a word.
      scannerCatFilter = wasActive ? '' : (chip.dataset.cat || '');
      if (!wasActive) chip.classList.add('active');
      buildScannerCards();
    });
  })();

  // ── Grouped filter pills (dropdown behavior + Mood filter) ──
  const MOOD_LABELS = {
    all: '', confirmed: 'Confirmed', fighting: 'Fighting', calm: 'Calm',
    distributing: 'Distributing', active: 'Active', churn: 'Churn',
    mixed: 'Mixed', marketwide: 'Market-wide', unknown: 'No read',
  };
  function updateFilterPills() {
    const catActive   = !!document.querySelector('#scannerCatChips .s-cat-chip.active');
    const classActive = (document.getElementById('scannerClassFilter')?.value || 'all') !== 'all';
    const ctxActive   = !['all', 'buy', 'sell'].includes(activeScannerFilter);
    document.getElementById('pillClass')?.classList.toggle('has-active', catActive || classActive);
    document.getElementById('pillFilters')?.classList.toggle('has-active', ctxActive);
    const moodPill = document.getElementById('pillMood');
    if (moodPill) {
      moodPill.classList.toggle('has-active', scannerMoodFilter !== 'all');
      const val = moodPill.querySelector('.fp-val');
      if (val) val.textContent = scannerMoodFilter !== 'all' ? ' · ' + MOOD_LABELS[scannerMoodFilter] : '';
    }
  }

  const moodOpts = document.getElementById('scannerMoodOpts');
  if (moodOpts) {
    moodOpts.addEventListener('click', e => {
      const btn = e.target.closest('.mood-opt');
      if (!btn) return;
      moodOpts.querySelectorAll('.mood-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      scannerMoodFilter = btn.dataset.mood;
      document.getElementById('pillMood')?.removeAttribute('open');
      buildScannerCards();
    });
  }

  // Picking a chip inside Class / Filters closes that dropdown (Signal opens a sheet, keep open)
  document.getElementById('scannerCatChips')?.addEventListener('click', e => {
    if (e.target.closest('.s-cat-chip')) document.getElementById('pillClass')?.removeAttribute('open');
  });
  document.querySelector('#pillFilters .sig-ctx-row')?.addEventListener('click', e => {
    const chip = e.target.closest('.sig-ctx-chip');
    if (chip && chip.id !== 'sigTypeBtn') document.getElementById('pillFilters')?.removeAttribute('open');
  });

  // Only one pill open at a time; click outside closes any open pill
  document.querySelectorAll('.filter-pill').forEach(d => {
    d.addEventListener('toggle', () => {
      if (d.open) document.querySelectorAll('.filter-pill').forEach(o => { if (o !== d) o.removeAttribute('open'); });
    });
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.filter-pill')) {
      document.querySelectorAll('.filter-pill[open]').forEach(d => d.removeAttribute('open'));
    }
  });

  // Advanced filter selects — applied via Apply button in bottom sheet
  document.getElementById('scannerSort').addEventListener('change', e => { scannerSort = e.target.value; });
  // ── Direction toggle (All / Buy / Sell) ──
  document.getElementById('scannerFilterChips').addEventListener('click', e => {
    const btn = e.target.closest('.sig-dir-btn');
    if (!btn) return;
    document.querySelectorAll('.sig-dir-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeScannerFilter = btn.dataset.filter;
    // Clear context chip active states when switching direction
    document.querySelectorAll('.sig-ctx-chip').forEach(c => {
      if (c.id !== 'sigMoreFiltersBtn') c.classList.remove('active');
    });
    resetRadarChip();
    buildScannerCards();
  });

  // ── Radar chip — cycles off → Prime ≥75 → Strong ≥50 → off ──
  const radarChip = document.getElementById('radarChip');
  const radarLabel = radarChip ? radarChip.querySelector('.radar-label') : null;
  function resetRadarChip() {
    if (!radarChip) return;
    radarChip.classList.remove('prime', 'strong');
    if (radarLabel) radarLabel.textContent = 'Radar';
  }
  if (radarChip) {
    radarChip.addEventListener('click', () => {
      // Deactivate other context chips
      document.querySelectorAll('.sig-ctx-chip:not(#sigMoreFiltersBtn):not(#sigTypeBtn):not(#radarChip):not(#analyzedChip)').forEach(c => c.classList.remove('active'));
      if (typeof resetAnalyzedChip === 'function') resetAnalyzedChip();
      document.querySelectorAll('.sig-dir-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('.sig-dir-btn[data-filter="all"]').classList.add('active');
      if (activeScannerFilter === 'radar_prime') {
        radarChip.classList.remove('prime'); radarChip.classList.add('strong');
        radarLabel.textContent = 'Strong ≥50';
        activeScannerFilter = 'radar_strong';
      } else if (activeScannerFilter === 'radar_strong') {
        resetRadarChip();
        activeScannerFilter = 'all';
      } else {
        radarChip.classList.add('prime');
        radarLabel.textContent = 'Prime ≥75';
        activeScannerFilter = 'radar_prime';
      }
      buildScannerCards();
    });
  }

  // ── Analyzed chip — cycles off → Analyzed → Unanalyzed → off ──
  const analyzedChip = document.getElementById('analyzedChip');
  const analyzedLabel = analyzedChip ? analyzedChip.querySelector('.analyzed-label') : null;
  function resetAnalyzedChip() {
    if (!analyzedChip) return;
    analyzedChip.classList.remove('on', 'off');
    if (analyzedLabel) analyzedLabel.textContent = 'Analyzed';
  }
  if (analyzedChip) {
    analyzedChip.addEventListener('click', () => {
      document.querySelectorAll('.sig-ctx-chip:not(#sigMoreFiltersBtn):not(#sigTypeBtn):not(#radarChip):not(#analyzedChip)').forEach(c => c.classList.remove('active'));
      resetRadarChip();
      document.querySelectorAll('.sig-dir-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('.sig-dir-btn[data-filter="all"]').classList.add('active');
      if (activeScannerFilter === 'analyzed') {
        analyzedChip.classList.remove('on'); analyzedChip.classList.add('off');
        analyzedLabel.textContent = 'Unanalyzed';
        activeScannerFilter = 'unanalyzed';
      } else if (activeScannerFilter === 'unanalyzed') {
        resetAnalyzedChip();
        activeScannerFilter = 'all';
      } else {
        analyzedChip.classList.add('on');
        analyzedLabel.textContent = 'Analyzed';
        activeScannerFilter = 'analyzed';
      }
      buildScannerCards();
    });
  }

  // ── Context chips (Best, Today, Squeeze, Key Lvl, Vol Spike, Macro S/R) ──
  document.querySelector('.sig-ctx-row').addEventListener('click', e => {
    const chip = e.target.closest('.sig-ctx-chip');
    if (!chip || chip.id === 'sigMoreFiltersBtn' || chip.id === 'sigTypeBtn' || chip.id === 'radarChip' || chip.id === 'analyzedChip') return;
    const wasActive = chip.classList.contains('active');
    // Deactivate all context chips (except filters btn, signal btn, radar chip, analyzed chip)
    document.querySelectorAll('.sig-ctx-chip:not(#sigMoreFiltersBtn):not(#sigTypeBtn):not(#radarChip):not(#analyzedChip)').forEach(c => c.classList.remove('active'));
    resetRadarChip();
    resetAnalyzedChip();
    // Also reset direction toggle to All
    document.querySelectorAll('.sig-dir-btn').forEach(b => b.classList.remove('active'));
    if (wasActive) {
      document.querySelector('.sig-dir-btn[data-filter="all"]').classList.add('active');
      activeScannerFilter = 'all';
    } else {
      chip.classList.add('active');
      document.querySelector('.sig-dir-btn[data-filter="all"]').classList.add('active');
      activeScannerFilter = chip.dataset.filter;
    }
    buildScannerCards();
  });

  // (The #scannerSummary strip no longer renders pills — its only content was a
  // second copy of the header count, and "clear filters" is the All button in
  // the pill row right above it. Its delegated click handler went with it.)

  // ── Signal type bottom sheet ──
  const sigTypeBtn = document.getElementById('sigTypeBtn');
  const sigTypeSheet = document.getElementById('sigTypeSheet');
  const sigOverlay = document.getElementById('sigSheetOverlay');

  function openSheet(sheet) {
    sigOverlay.classList.add('open');
    sheet.classList.add('open');
  }
  function closeSheets() {
    sigOverlay.classList.remove('open');
    document.querySelectorAll('.sig-sheet.open').forEach(s => s.classList.remove('open'));
  }
  sigOverlay.addEventListener('click', closeSheets);

  sigTypeBtn.addEventListener('click', () => openSheet(sigTypeSheet));

  sigTypeSheet.addEventListener('click', e => {
    const btn = e.target.closest('.sig-sheet-btn');
    if (!btn) return;
    // Toggle active state
    document.querySelectorAll('.sig-sheet-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeScannerFilter = btn.dataset.filter;
    // Update signal button label
    sigTypeBtn.classList.add('active');
    // Reset direction toggle and context chips
    document.querySelectorAll('.sig-dir-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.sig-dir-btn[data-filter="all"]').classList.add('active');
    document.querySelectorAll('.sig-ctx-chip:not(#sigMoreFiltersBtn):not(#sigTypeBtn)').forEach(c => c.classList.remove('active'));
    closeSheets();
    buildScannerCards();
  });

  document.getElementById('sigSheetClear').addEventListener('click', () => {
    document.querySelectorAll('.sig-sheet-btn').forEach(b => b.classList.remove('active'));
    sigTypeBtn.classList.remove('active');
    activeScannerFilter = 'all';
    closeSheets();
    buildScannerCards();
  });

  // ── Advanced filters bottom sheet ──
  const sigMoreBtn = document.getElementById('sigMoreFiltersBtn');
  const sigAdvSheet = document.getElementById('sigAdvSheet');

  sigMoreBtn.addEventListener('click', () => openSheet(sigAdvSheet));

  // Update filter badge count
  function updateFilterBadge() {
    const selects = ['scannerClassFilter','scannerGroupFilter','scannerSectorFilter','scannerTrendFilter','scannerAlignFilter','scannerRsiFilter'];
    let count = selects.filter(id => {
      const el = document.getElementById(id);
      return el && el.value !== 'all';
    }).length;
    if (document.getElementById('scannerSort').value !== 'signal') count++;
    const badge = document.getElementById('sigFilterBadge');
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = '';
      sigMoreBtn.classList.add('active');
    } else {
      badge.style.display = 'none';
      sigMoreBtn.classList.remove('active');
    }
  }

  // Apply on every change — Done button just closes the sheet
  function applyAdvFilters() {
    // Using the advanced filter sheet = explicit filter intent; clear the
    // implicit region filter so the two don't fight each other.
    activeRegionFilter = '';
    updateFilterBadge();
    updateScannerCtxStrip();
    buildScannerCards();
  }
  sigAdvSheet.addEventListener('change', e => {
    if (e.target.matches('select, input')) applyAdvFilters();
  });
  document.getElementById('sigAdvApply').addEventListener('click', () => {
    applyAdvFilters();
    closeSheets();
  });

  // ── Watchlist tab controls ───────────────────────────────────────────
  document.getElementById('wlSort').addEventListener('change', e => { wlSort = e.target.value; renderWlMyList(); });
  document.getElementById('wlFilterChips').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('#wlFilterChips .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    wlFilter = chip.dataset.filter;
    renderWlMyList();
  });
  document.getElementById('alertFilterChips').addEventListener('click', e => {
    const chip = e.target.closest('[data-alert]');
    if (!chip) return;
    document.querySelectorAll('#alertFilterChips [data-alert]').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    activeAlertTab = chip.dataset.alert;
    renderWlAlerts();
  });
  // Star buttons use inline data-act="toggleStar" data-stop="1"
  // to prevent the parent card's openModal from firing.

  // ── Watchlist Tab ────────────────────────────────────────────────────
  function renderWatchlist() {
    renderWlMyList();
    renderWlAlerts();
  }

  function renderWlMyList() {
    const allData = getActiveData(); // respect AI filter
    const listEl  = document.getElementById('wlMyList');
    const statsEl = document.getElementById('wlStats');
    if (!listEl) return;

    const starred = allData.filter(d => userStarred.has(d.instrument_name));

    // Stats bar
    const withSignal = starred.filter(d => d[f('primary_signal')]).length;
    const upCount    = starred.filter(d => effectiveTrend(d) === 'UPTREND').length;
    if (statsEl) {
      statsEl.innerHTML = starred.length
        ? `<span class="sig-sum-total">${starred.length} analyzed</span>` +
          (withSignal ? `<span class="sig-sum-item sig-sum-buy">${withSignal} signal</span>` : '') +
          (upCount    ? `<span class="sig-sum-item" style="background:rgba(16,185,129,.15);color:var(--buy)">${upCount} uptrend</span>` : '')
        : '';
    }

    // Empty watchlist
    if (!starred.length) {
      listEl.innerHTML = `<div class="wl-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".3"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <p>Tap ★ on any instrument after you've analyzed its chart to track it here</p>
      </div>`;
      return;
    }

    // Apply filter
    let filtered = starred;
    if (wlFilter === 'buy')     filtered = filtered.filter(isBuy);
    else if (wlFilter === 'sell')    filtered = filtered.filter(isSell);
    else if (wlFilter === 'signal')  filtered = filtered.filter(d => !!(d[f('primary_signal')]));
    else if (wlFilter === 'uptrend') filtered = filtered.filter(d => effectiveTrend(d) === 'UPTREND');

    // Sort
    const confOrder = { high: 3, standard: 2, low: 1, '': 0 };
    if (wlSort === 'signal') {
      filtered = [...filtered].sort((a, b) => {
        const aHas = !!(a[f('primary_signal')]), bHas = !!(b[f('primary_signal')]);
        if (aHas !== bHas) return bHas - aHas;
        return (confOrder[b[f('signal_confidence')] || ''] || 0) - (confOrder[a[f('signal_confidence')] || ''] || 0);
      });
    } else if (wlSort === 'trend') {
      const tOrd = { UPTREND: 0, NEUTRAL: 1, DOWNTREND: 2 };
      filtered = [...filtered].sort((a, b) => (tOrd[effectiveTrend(a)] ?? 1) - (tOrd[effectiveTrend(b)] ?? 1));
    } else if (wlSort === 'age') {
      filtered = [...filtered].sort((a, b) => (b[f('last_signal_date')] || '').localeCompare(a[f('last_signal_date')] || ''));
    } else if (wlSort === 'alpha') {
      filtered = [...filtered].sort((a, b) => a.instrument_name.localeCompare(b.instrument_name));
    }

    if (!filtered.length) {
      listEl.innerHTML = '<div class="wl-empty">No instruments match this filter</div>';
      return;
    }

    listEl.innerHTML = filtered.map(item => {
      const t    = effectiveTrend(item);
      const sig  = item[f('primary_signal')] || '';
      const buy  = isBuy(item), sell = isSell(item);
      const roc  = parseFloat(item[f('roc')]);
      const rocStr = !isNaN(roc) ? (roc >= 0 ? '+' : '') + roc.toFixed(1) + '%' : '';
      const lastSigType = item[f('last_signal_type')] || '';
      const age  = signalAge(item[f('last_signal_date')] || '', item[f('date')]);
      const phase = ribbonPhase(item, t);
      const hasAlert = !!(item.key_level_touched_today === 'yes' || item[f('volume_spike_flag')] === 'yes');
      const _aiWl = isAI(item.instrument_name);
      return `<div class="wl-card${_aiWl ? ' ai-card' : ''}" data-act="openModal" data-arg="${item.instrument_name}">
        <div class="wl-card-top">
          <div class="wl-card-left">
            <span class="wl-card-name">${item.instrument_name} ${noteIndicator(item.instrument_name)}</span>
            ${instName(item.instrument_name) ? `<span class="inst-fullname">${instName(item.instrument_name)}</span>` : ''}
            <span class="wl-card-group">${item.group || ''}${item.sector ? ' · ' + item.sector : ''}${_aiWl ? ' <span class="ai-chip-mini">AI</span>' : ''}</span>
          </div>
          <div class="wl-card-right">
            <span class="wl-card-price">${formatPrice(item[f('close')])}${rocStr ? ` <span class="roc-val ${roc >= 0 ? 'roc-pos' : 'roc-neg'}">${rocStr}</span>` : ''}</span>
            ${(() => { const p = signalPerf(item); return (p && p.days > 0) ? `<span class="wl-signal-perf ${parseFloat(p.pct)>=0?'perf-pos':'perf-neg'}" title="Since ${p.signal} signal on ${p.date}">${parseFloat(p.pct)>=0?'+':''}${p.pct}% · ${p.days}d</span>` : ''; })()}
            <div class="scanner-actions">
              ${tvBtn(item.instrument_name, '')}
              ${shareBtn(item.instrument_name)}
              <button class="star-btn starred" data-ticker="${item.instrument_name}" title="Unmark as analyzed" data-act="toggleStar" data-stop="1">★</button>
            </div>
          </div>
        </div>
        <div class="wl-card-badges">
          <span class="scanner-tag ${trendTag(t)}">${t}</span>
          ${phase ? `<span class="scanner-tag" style="background:var(--accent-glow);color:var(--accent)">${phase}</span>` : ''}
          ${lastSigType && age.label ? `<span class="sig-age ${age.decayClass}"><b class="${lastSigType.startsWith('B') ? 'sc-code-buy' : 'sc-code-sell'}">${lastSigType}</b> ${age.label}</span>` : ''}
          ${hasAlert ? `<span class="scanner-tag" style="background:var(--accent-glow);color:var(--accent)">⚡ Alert</span>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  function renderWlAlerts() {
    const allData = getActiveData(); // respect AI filter
    const listEl = document.getElementById('wlAlertsList');
    if (!listEl) return;

    const keylvl  = allData.filter(d => d.key_level_touched_today === 'yes');
    const vol     = allData.filter(d => d[f('volume_spike_flag')] === 'yes');

    // Update count badges
    const updBadge = (id, arr) => { const e = document.getElementById(id); if (e) e.textContent = arr.length ? `(${arr.length})` : ''; };
    updBadge('cntKeyLvl', keylvl);  updBadge('cntVol', vol);

    const datasets = { keylvl, vol };
    const active   = datasets[activeAlertTab] || keylvl;
    const emptyMsg = { keylvl: 'No key level touches today', vol: 'No volume spikes today' };

    if (!active.length) {
      listEl.innerHTML = `<div class="wl-empty">${emptyMsg[activeAlertTab]}</div>`;
      return;
    }

    listEl.innerHTML = active.map(item => {
      const t       = effectiveTrend(item);
      const sig     = item[f('primary_signal')] || '';
      const buy     = isBuy(item), sell = isSell(item);
      const starred = userStarred.has(item.instrument_name);
      let detail = '';
      if (activeAlertTab === 'keylvl') detail = `${item.key_level_type || ''} @ ${formatPrice(item.key_level_price)} · ${item.key_level_touch_count || 0} touches`;
      else if (activeAlertTab === 'vol') {
        const v = parseInt(item[f('volume')] || 0), a = parseInt(item[f('volume_average')] || 0);
        detail = `Vol: ${v.toLocaleString()} (avg: ${a.toLocaleString()})`;
      }
      return `<div class="wl-alert-item" data-act="openModal" data-arg="${item.instrument_name}">
        <div class="wl-alert-left">
          <span class="wl-alert-name">${item.instrument_name}</span>
          <span class="wl-alert-detail">${detail}</span>
        </div>
        <div class="wl-alert-right">
          <span class="scanner-tag ${trendTag(t)}" style="font-size:.6rem;padding:2px 5px">${t.charAt(0)}</span>
          ${sig ? `<span class="scanner-tag ${buy ? 'tag-up' : sell ? 'tag-down' : 'tag-neutral'}" style="font-size:.6rem;padding:2px 5px">${sig.slice(0,5)}</span>` : ''}
          ${tvBtn(item.instrument_name, '')}
          <button class="star-btn ${starred ? 'starred' : ''}" data-ticker="${item.instrument_name}" title="${starred ? 'Unmark as analyzed' : 'Mark as analyzed'}" data-act="toggleStar" data-stop="1">★</button>
        </div>
      </div>`;
    }).join('');
  }

  // ── Instrument Modal ─────────────────────────────────────────────────
  const overlay = document.getElementById('modalOverlay');
  const modalBody = document.getElementById('modalBody');

  document.getElementById('modalClose').addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  // ── Track Record Detail Sheet (Layer 2) ──────────────────────────────
  const trackOverlay = document.getElementById('trackOverlay');
  const trackBody    = document.getElementById('trackModalBody');
  function closeTrackSheet() {
    if (trackOverlay) trackOverlay.classList.remove('open');
  }
  function openTrackRecord() {
    if (!backtestData || !trackOverlay || !trackBody) return;
    renderTrackRecordSheet();
    trackOverlay.classList.add('open');
  }
  if (trackOverlay) {
    document.getElementById('trackClose').addEventListener('click', closeTrackSheet);
    trackOverlay.addEventListener('click', e => { if (e.target === trackOverlay) closeTrackSheet(); });
  }

  let trSheetFilter = 'all';   // 'all' | 'B1' | 'S1' | 'B4' | 'S4'

  function renderTrackRecordSheet() {
    if (!backtestData || !trackBody) return;
    const o = backtestData.overall;
    const sigs = backtestData.by_signal || {};
    const insts = backtestData.by_instrument || {};
    const curve = backtestData.equity_curve || [];

    // Top performing instruments (by avg_r, min 5 trades)
    const ranked = Object.entries(insts)
      .map(([name, d]) => ({ name, ...d.overall }))
      .filter(s => s.total_trades >= 5)
      .sort((a, b) => b.avg_r - a.avg_r);
    const top5    = ranked.slice(0, 5);
    const bottom5 = ranked.slice(-5).reverse();

    // Equity curve as inline SVG (compact, no library needed)
    const curveSvg = renderEquitySvg(curve, trSheetFilter);

    trackBody.innerHTML = `
      <div class="trs-header">
        <div class="trs-title">Signal Track Record</div>
        <div class="trs-subtitle">${o.total_trades} trades · ${o.win_rate}% win rate · ${o.avg_r > 0 ? '+' : ''}${o.avg_r}R avg · PF ${o.profit_factor}</div>
        <div class="trs-rules">Rules: 2% stop · 2:1 R:R · 30-bar time stop · 0.05% slippage</div>
      </div>

      <div class="trs-section">
        <div class="trs-section-title">Equity curve (R-multiples)</div>
        ${curveSvg}
      </div>

      <div class="trs-section">
        <div class="trs-filter-row">
          <button class="trs-chip ${trSheetFilter === 'all' ? 'active' : ''}" data-trf="all">All</button>
          ${Object.keys(sigs).map(s =>
            `<button class="trs-chip ${trSheetFilter === s ? 'active' : ''}" data-trf="${s}">${s}</button>`
          ).join('')}
        </div>
        <div class="trs-section-title">Per-signal stats</div>
        <div class="trs-sig-table">
          <div class="trs-sig-row trs-sig-head">
            <span>Signal</span><span>N</span><span>Win%</span><span>Avg R</span><span>PF</span><span>Final R</span><span>Max DD</span>
          </div>
          ${Object.entries(sigs).map(([sig, s]) => `
            <div class="trs-sig-row">
              <span class="trs-sig-badge sig-${sig.toLowerCase()}">${sig}</span>
              <span>${s.total_trades}</span>
              <span>${s.win_rate}%</span>
              <span class="${s.avg_r >= 0 ? 'tr-pos' : 'tr-neg'}">${s.avg_r > 0 ? '+' : ''}${s.avg_r}</span>
              <span class="${s.profit_factor >= 1 ? 'tr-pos' : 'tr-neg'}">${s.profit_factor}</span>
              <span class="${s.final_r >= 0 ? 'tr-pos' : 'tr-neg'}">${s.final_r > 0 ? '+' : ''}${s.final_r}</span>
              <span class="tr-neg">-${s.max_drawdown_r}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="trs-section">
        <div class="trs-section-title">🏆 Top 5 instruments (avg R)</div>
        <div class="trs-inst-list">
          ${top5.map(s => `<div class="trs-inst-row" data-act="closeTrackAndOpen" data-arg="${s.label}">
            <span class="trs-inst-name">${s.label}</span>
            <span class="trs-inst-trades">${s.total_trades} trades</span>
            <span class="trs-inst-wr">${s.win_rate}%</span>
            <span class="trs-inst-r tr-pos">+${s.avg_r}R</span>
          </div>`).join('') || '<div class="trs-empty">Not enough data yet</div>'}
        </div>
      </div>

      <div class="trs-section">
        <div class="trs-section-title">📉 Bottom 5 instruments (avg R)</div>
        <div class="trs-inst-list">
          ${bottom5.map(s => `<div class="trs-inst-row" data-act="closeTrackAndOpen" data-arg="${s.label}">
            <span class="trs-inst-name">${s.label}</span>
            <span class="trs-inst-trades">${s.total_trades} trades</span>
            <span class="trs-inst-wr">${s.win_rate}%</span>
            <span class="trs-inst-r ${s.avg_r >= 0 ? 'tr-pos' : 'tr-neg'}">${s.avg_r > 0 ? '+' : ''}${s.avg_r}R</span>
          </div>`).join('') || '<div class="trs-empty">Not enough data yet</div>'}
        </div>
      </div>

      <div class="trs-footer">Generated ${formatGeneratedAt(backtestData.generated_at)}</div>
    `;

    // Wire filter chips
    trackBody.querySelectorAll('.trs-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        trSheetFilter = btn.dataset.trf;
        renderTrackRecordSheet();
      });
    });
  }

  function renderEquitySvg(curve, filter) {
    if (!curve || !curve.length) return '<div class="trs-empty">No equity data</div>';
    // Reuse curve as-is (filter is applied at the data prep level if needed in future)
    const W = 320, H = 100, PAD = 8;
    const rs = curve.map(c => c.r);
    const min = Math.min(0, ...rs);
    const max = Math.max(0, ...rs);
    const span = Math.max(max - min, 1);
    const dx = (W - PAD*2) / Math.max(curve.length - 1, 1);
    const yOf = r => H - PAD - ((r - min) / span) * (H - PAD*2);
    const points = curve.map((c, i) => `${PAD + i * dx},${yOf(c.r)}`).join(' ');
    const zeroY = yOf(0);
    const finalR = curve[curve.length - 1].r;
    const finalCls = finalR >= 0 ? 'var(--buy)' : 'var(--sell)';
    return `
      <svg viewBox="0 0 ${W} ${H}" class="trs-equity-svg" preserveAspectRatio="none">
        <line x1="${PAD}" y1="${zeroY}" x2="${W - PAD}" y2="${zeroY}" stroke="var(--border)" stroke-dasharray="2,3"/>
        <polyline points="${points}" fill="none" stroke="${finalCls}" stroke-width="2" stroke-linejoin="round"/>
      </svg>
      <div class="trs-equity-meta">
        <span>Start: 0R</span>
        <span>End: <strong style="color:${finalCls}">${finalR > 0 ? '+' : ''}${finalR}R</strong></span>
        <span>${curve.length} trades</span>
      </div>
    `;
  }

  function closeTrackAndOpen(name) {
    closeTrackSheet();
    setTimeout(() => openModal(name), 300);
  }

  // Swipe-down to close modal
  (function wireModalSwipe() {
    const modal = document.getElementById('instrumentModal');
    if (!modal) return;
    let swipeStartY = 0;
    let swipeStartScrollTop = 0;
    const modalBody = document.getElementById('modalBody');
    modal.addEventListener('touchstart', e => {
      swipeStartY = e.touches[0].clientY;
      swipeStartScrollTop = modalBody ? modalBody.scrollTop : 0;
    }, { passive: true });
    modal.addEventListener('touchend', e => {
      const dy = e.changedTouches[0].clientY - swipeStartY;
      // Only close if: swiping down ≥120px AND the body was at the top when gesture started
      if (dy > 120 && swipeStartScrollTop < 10) closeModal();
    }, { passive: true });
  })();

  function closeModal() {
    openModalName = null;
    overlay.classList.remove('open');
  }

  async function openModal(name) {
    const item = allData.find(d => d.instrument_name === name);
    if (!item) return;
    openModalName = name;

    const similar     = findSimilarSetups(item);
    const explanation = explanationsData[name] || '';
    const existingNote= (instrumentNotes[name] || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const buy = isBuy(item);
    const sell = isSell(item);
    const sig = item[f('primary_signal')] || '';
    const conf = item[f('signal_confidence')] || '';
    const confCtx = item[f('confidence_context')] || '';   // edge-audit context modifiers
    const sigColor = buy ? 'var(--buy)' : sell ? 'var(--sell)' : 'var(--neutral)';
    const close = parseFloat(item[f('close')]);
    const maPrefix = timeframe === '4H' ? 'h4_ma_' : 'ma_';
    const periods = activeMaPeriods();
    const maPills = periods.map(p => {
      const val = parseFloat(item[maPrefix + p]);
      if (isNaN(val)) return '';
      const above = close > val;
      return `<span class="ma-pill ${above ? 'above' : 'below'}">${p}: ${formatPrice(val)}</span>`;
    }).join('');

    const tvChartUrl = tvUrl(item.instrument_name);

    // Count MAs above/below for ribbon gauge
    let masAbove = 0, masBelow = 0;
    periods.forEach(p => {
      const v = parseFloat(item[maPrefix + p]);
      if (!isNaN(v)) { if (close > v) masAbove++; else masBelow++; }
    });
    const ribbonPct = Math.round((masAbove / (masAbove + masBelow || 1)) * 100);
    const ribbonColor = ribbonPct > 70 ? 'var(--buy)' : ribbonPct < 30 ? 'var(--sell)' : 'var(--watch)';

    // Price change (today's candle)
    const priceChange = (!isNaN(close) && !isNaN(parseFloat(item[f('open')])) && parseFloat(item[f('open')]) > 0)
      ? ((close - parseFloat(item[f('open')])) / parseFloat(item[f('open')]) * 100) : null;
    const changeStr = priceChange !== null ? (priceChange >= 0 ? '+' : '') + priceChange.toFixed(2) + '%' : '';
    const changeClass = priceChange !== null ? (priceChange >= 0 ? 'pos' : 'neg') : '';

    // Analysis text
    const autoAnalysis = buildSignalDesc(item);
    const analysisText = explanation || autoAnalysis;

    // Radar conviction breakdown — shows why a card scores what it does
    const _rScore   = radarConfluenceScore(item);
    const _rTier    = scoreTier(_rScore);
    const _rTierLbl = _rTier === 'prime' ? 'Prime' : _rTier === 'strong' ? 'Strong' : 'Developing';
    const _rBd      = radarScoreBreakdown(item);
    const _rDirLbl  = _rBd.isBullish ? 'Long bias' : 'Short bias';
    const _rLinesHtml = _rBd.lines.length
      ? _rBd.lines.map(l => `<div class="mh-rs-line"><span class="mh-rs-lbl">${l.label}</span><span class="mh-rs-pts${l.points < 0 ? ' mh-rs-neg' : ''}">${l.points < 0 ? '' : '+'}${l.points}</span></div>`).join('')
      : '<div class="mh-rs-line mh-rs-empty">No confluence factors active.</div>';
    const radarBreakdownHtml = `
      <div class="mh-radar-score">
        <div class="mh-rs-header">
          <div class="mh-rs-title">
            <span class="mh-rs-num radar-tier-${_rTier}">${_rScore}</span>
            <span class="mh-rs-tier radar-tier-${_rTier}">${_rTierLbl}</span>
            <span class="mh-rs-dir">${_rDirLbl}</span>
          </div>
          <div class="mh-rs-bar"><div class="mh-rs-bar-fill tier-${_rTier}" style="width:${_rScore}%"></div></div>
        </div>
        <div class="mh-rs-lines">${_rLinesHtml}</div>
      </div>`;

    modalBody.innerHTML = `
      <!-- ===== HERO ===== -->
      <div class="mh-hero${buy ? ' mh-hero-buy' : sell ? ' mh-hero-sell' : ''}">
        <div class="mh-top">
          <div class="mh-name-group">
            <div class="mh-name-row">
              <button class="mh-star star-btn ${userStarred.has(item.instrument_name) ? 'starred' : ''}" data-ticker="${item.instrument_name}" data-act="toggleStar" data-stop="1" title="${userStarred.has(item.instrument_name) ? 'Unmark as analyzed' : 'Mark as analyzed'}">★</button>
              <div class="mh-name">${item.instrument_name}</div>
            </div>
            ${instName(item.instrument_name) ? `<div class="inst-fullname">${instName(item.instrument_name)}</div>` : ''}
            <div class="mh-group-lbl">${item.group || ''}${item.sector ? ' · ' + item.sector : ''}</div>
          </div>
          <div class="mh-sig-wrap">
            ${item[f('volume_spike_flag')] === 'yes' && sig ? '<span class="vol-plus-chip">VOL+</span>' : ''}
          </div>
        </div>
        <div class="mh-price-row">
          <div class="mh-price">${formatPrice(item[f('close')])}</div>
          <div class="mh-price-meta">
            ${changeStr ? `<span class="mh-change ${changeClass}">${priceChange >= 0 ? '▲' : '▼'} ${changeStr}</span>` : ''}
            <a href="${tvChartUrl}" target="_blank" rel="noopener" class="mh-tv-link" onclick="event.stopPropagation()">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              TradingView
            </a>
          </div>
        </div>
      </div>

      <!-- ===== TABS ===== -->
      <div class="mh-tabs" id="mhTabs">
        <button class="mh-tab active" data-panel="overview">Overview</button>
        <button class="mh-tab" data-panel="analysis">Analysis</button>
        <button class="mh-tab" data-panel="notes">Notes</button>
      </div>

      <!-- ===== OVERVIEW PANEL ===== -->
      <div class="mh-panel" id="mhPanel-overview">
        ${setupPanelHtml(item)}

        ${radarBreakdownHtml}

        ${confCtx && conf ? `<div class="mh-conf-ctx">
          <span class="badge-confidence conf-${conf}">${conf}</span>
          <span class="mh-conf-ctx-why">adjusted for backtested edge — ${confCtx}</span>
        </div>` : ''}

        ${renderInstrumentTrackRecord(item.instrument_name)}

        <div class="mh-section">
          <div class="mh-section-title">MA Ribbon${item[f('ribbon_compression')]==='yes'?' <span class="compression-alert">SQUEEZE</span>':''}</div>
          <div class="ribbon-gauge">
            <div class="ribbon-gauge-track">
              <div class="ribbon-gauge-fill" style="width:${ribbonPct}%;background:${ribbonColor}"></div>
            </div>
            <div class="ribbon-gauge-labels">
              <span style="color:var(--sell)">Below all</span>
              <span style="color:${ribbonColor};font-weight:700">${ribbonPct}% · ${item[f('ribbon_spread')]||'--'}% spread <span style="font-weight:400;font-size:.7rem;color:var(--text-muted)">(${masAbove+masBelow}/${periods.length} MAs)</span></span>
              <span style="color:var(--buy)">Above all</span>
            </div>
          </div>
        </div>

        ${analysisText ? `<div class="mh-section">
          <div class="mh-section-title">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l2 2"/></svg>
            Analysis
            <span class="ai-model-badge">Auto</span>
          </div>
          <div class="ai-strip" style="margin:0;border-radius:10px;border-top:1px solid rgba(79,158,255,.14)">
            <div class="ai-strip-text">${analysisText}</div>
          </div>
        </div>` : ''}

        <div class="mh-section">
          <div class="mh-section-title">MA Values</div>
          <div class="modal-ma-ribbon">${maPills}</div>
        </div>

        ${similar.length ? `<div class="mh-section">
          <div class="mh-section-title">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Similar Setups Now
          </div>
          <div class="sim-setups-grid">
            ${similar.map(s => {
              const sBuy  = isBuy(s);
              const sSig  = s[f('primary_signal')] || '';
              const sAlign= s.tf_alignment || '';
              const sConf = s[f('signal_confidence')] || '';
              const sAge  = signalAge(s[f('last_signal_date')] || s[f('date')] || '', s[f('date')]);
              const sPerf = signalPerf(s);
              return `<div class="sim-card" data-act="openModal" data-arg="${s.instrument_name}" data-stop="1">
                <div class="sim-card-top"><span class="sim-card-name">${s.instrument_name}</span>${sSig?`<span class="feed-badge badge-${sigClass(sSig) || 'p4'}">${sSig}</span>`:''}</div>
                <div class="sim-card-group">${s.group||''}</div>
                <div class="sim-card-badges">
                  ${sAlign?`<span class="badge-alignment ${alignCls(sAlign)}" style="font-size:.58rem;padding:1px 5px">${sAlign}</span>`:''}
                  ${sConf?`<span class="badge-confidence conf-${sConf}" style="font-size:.58rem">${sConf}</span>`:''}
                  ${badge3TF(s)}${sAge.label?`<span class="sig-age ${sAge.decayClass}" style="font-size:.58rem">${sAge.label}</span>`:''}
                </div>
                <div class="sim-card-bottom"><span class="sim-card-price">${formatPrice(s[f('close')])}</span>${(sPerf && sPerf.days > 0)?`<span class="wl-signal-perf ${parseFloat(sPerf.pct)>=0?'perf-pos':'perf-neg'}" style="font-size:.58rem">${parseFloat(sPerf.pct)>=0?'+':''}${sPerf.pct}%</span>`:''}</div>
              </div>`;
            }).join('')}
          </div>
        </div>` : ''}
      </div>

      <!-- ===== ANALYSIS PANEL ===== -->
      <div class="mh-panel mh-panel-hidden" id="mhPanel-analysis">
        <div class="mh-section">
          <div class="mh-section-title">Signal Status</div>
          <div class="modal-status-card ${buy?'status-buy':sell?'status-sell':'status-neutral'}">
            <div class="status-main">${item[f('confirmation_status')]||'No confirmed signal'}</div>
            ${item[f('last_signal_type')]?`<div class="status-sub">Last: <strong>${item[f('last_signal_type')]}</strong> on ${item[f('last_signal_date')]} (${item[f('last_signal_days_ago')]}d ago)</div>`:''}
            ${item[f('volume_spike_flag')]==='yes'&&sig?`<div class="status-sub" style="color:var(--volume)">Volume spike on signal bar</div>`:''}
          </div>
        </div>

        <div class="mg-grid">
          <div class="mg-tile"><div class="mg-label">Open</div><div class="mg-val">${formatPrice(item[f('open')])}</div></div>
          <div class="mg-tile"><div class="mg-label">High</div><div class="mg-val buy">${formatPrice(item[f('high')])}</div></div>
          <div class="mg-tile"><div class="mg-label">Low</div><div class="mg-val sell">${formatPrice(item[f('low')])}</div></div>
        </div>

        ${item[f('volume')]?(() => {
          const v  = parseFloat(item[f('volume')]);
          const av = parseFloat(item[f('volume_average')] || 0);
          const rv = rvol(item);
          const pv = pvo(item);
          const rvCls = rv === null ? '' : rv >= 1.5 ? ' vol' : rv >= 1 ? ' buy' : '';
          const pvoLine = pv ? `<div class="status-sub">Oscillator (PVO): <strong>${fmtPvo(pv.v)}</strong>${pv.s !== null
            ? ` &nbsp;·&nbsp; signal ${fmtPvo(pv.s)} &nbsp;·&nbsp; <span style="color:${pv.v >= pv.s ? 'var(--buy)' : 'var(--sell)'};font-weight:700">${pv.v >= pv.s ? 'volume expanding' : 'volume contracting'}</span>`
            : ''}</div>` : '';
          return `<div class="mh-section">
          <div class="mh-section-title">Volume${item[f('volume_spike_flag')]==='yes' ? ' <span class="vol-plus-chip">SPIKE</span>' : ''}</div>
          <div class="mh-vol-grid">
            <div class="mg-tile"><div class="mg-label">Today</div><div class="mg-val" title="${isFinite(v) ? Math.round(v).toLocaleString() : ''}">${fmtVol(v)}</div></div>
            <div class="mg-tile" title="Average over the last 25 ${timeframe === '4H' ? '4H bars' : 'days'}"><div class="mg-label">Avg (25)</div><div class="mg-val" title="${av ? Math.round(av).toLocaleString() : ''}">${fmtVol(av)}</div></div>
            <div class="mg-tile"><div class="mg-label">RVOL</div><div class="mg-val${rvCls}">${rv !== null ? fmtRvol(rv) : '—'}</div></div>
            <div class="mg-tile"><div class="mg-label">PVO</div><div class="mg-val ${pv ? (pv.v >= 0 ? 'buy' : 'sell') : ''}">${pv ? fmtPvo(pv.v) : '—'}</div></div>
          </div>
          <div class="modal-status-card status-neutral">
            ${pvoLine}
            <div class="mh-vol-chart" id="mhVolChart"></div>
            <div class="mh-vol-extra" id="mhVolExtra"></div>
          </div>
        </div>`;})():''}

      </div>

      <!-- ===== NOTES PANEL ===== -->
      <div class="mh-panel mh-panel-hidden" id="mhPanel-notes">
        <div class="mh-section">
          <div class="mh-section-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            My Notes
          </div>
          <div class="notes-section">
            <textarea id="noteInput" class="notes-textarea" placeholder="Add trade notes, entry ideas, levels to watch…" maxlength="500">${existingNote}</textarea>
            <div class="notes-footer">
              <span class="notes-save-hint" id="noteSaveHint"></span>
              <span class="notes-char-count" id="noteCharCount">${existingNote.length} / 500</span>
            </div>
          </div>
        </div>
      </div>
    `;
    overlay.classList.add('open');

    // Wire modal tabs
    const mhTabBar = document.getElementById('mhTabs');
    if (mhTabBar) {
      mhTabBar.addEventListener('click', e => {
        const tab = e.target.closest('.mh-tab');
        if (!tab) return;
        const panel = tab.dataset.panel;
        mhTabBar.querySelectorAll('.mh-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('#instrumentModal .mh-panel').forEach(p => {
          p.classList.toggle('mh-panel-hidden', p.id !== 'mhPanel-' + panel);
        });
      });
    }


    // Wire note textarea auto-save
    const noteInput = document.getElementById('noteInput');
    if (noteInput) {
      noteInput.addEventListener('input', (() => {
        let timer;
        return () => {
          clearTimeout(timer);
          const hint = document.getElementById('noteSaveHint');
          const cc   = document.getElementById('noteCharCount');
          const len  = noteInput.value.length;
          if (cc) cc.textContent = len + ' / 500';
          if (hint) { hint.textContent = 'Saving…'; hint.className = 'notes-save-hint'; }
          timer = setTimeout(() => {
            const text = noteInput.value.trim();
            if (text) instrumentNotes[name] = text;
            else       delete instrumentNotes[name];
            localStorage.setItem(sk('sp-notes'), JSON.stringify(instrumentNotes));
            syncPush();
            if (hint) { hint.textContent = 'Saved ✓'; hint.className = 'notes-save-hint saved'; }
            setTimeout(() => { if (hint) hint.textContent = ''; }, 1800);
          }, 500);
        };
      })());
    }

    renderModalVolChart(item);
  }

  // Async: fill the modal's Volume section with a daily volume-vs-average
  // chart, an up/down-day volume pressure bar and peak-day stats once
  // history arrives. The modal may close or re-render (TF switch) while
  // fetching, so re-grab the target before injecting.
  async function renderModalVolChart(item) {
    if (!document.getElementById('mhVolChart')) return;
    const hist = await fetchVolHistory(item);
    const target = document.getElementById('mhVolChart');
    if (!target || !hist || openModalName !== item.instrument_name) return;
    const N      = Math.min(60, hist.vols.length);
    const vols   = hist.vols.slice(-N);
    const avgs   = hist.avgs.slice(-N);
    const closes = (hist.closes || []).slice(-N);
    const dates  = (hist.dates  || []).slice(-N);
    const hasDir = closes.some(c => c > 0);
    target.innerHTML = volDetailSvg(vols, avgs, closes, 640, 150) +
      `<div class="mh-vol-legend">${hasDir
        ? '<span style="color:var(--buy)">■</span> up day &nbsp;<span style="color:var(--sell)">■</span> down day &nbsp;·&nbsp; bright = above avg'
        : '<span style="color:var(--volume)">■</span> above avg'} &nbsp;·&nbsp; dashed line = 25-day avg &nbsp;·&nbsp; last ${N} daily bars</div>`;

    const extra = document.getElementById('mhVolExtra');
    if (!extra) return;
    // Where the volume went: share of window volume on up-close vs down-close days
    let upV = 0, dnV = 0;
    if (hasDir) {
      for (let i = 1; i < N; i++) {
        if      (closes[i] > closes[i - 1]) upV += vols[i];
        else if (closes[i] < closes[i - 1]) dnV += vols[i];
      }
    }
    const tot   = upV + dnV;
    const upPct = tot ? Math.round(upV / tot * 100) : null;
    const peakI = vols.indexOf(Math.max(...vols));
    let peakDate = '';
    if (dates[peakI]) {
      const d = new Date(dates[peakI]);
      if (!isNaN(d)) peakDate = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    }
    const aboveN = vols.filter((v, i) => isFinite(avgs[i]) && v > avgs[i]).length;
    extra.innerHTML = (upPct !== null ? `
      <div class="mh-vol-pressure" title="Share of the last ${N} days' total volume traded on up-close vs down-close days">
        <div class="mh-vp-track"><div class="mh-vp-up" style="width:${upPct}%"></div></div>
        <div class="mh-vp-lbls">
          <span style="color:var(--buy)">▲ ${upPct}% of volume on up days</span>
          <span style="color:var(--sell)">${100 - upPct}% on down days ▼</span>
        </div>
      </div>` : '') +
      `<div class="status-sub">Peak: <strong>${fmtVol(vols[peakI])}</strong>${peakDate ? ' on ' + peakDate : ''} &nbsp;·&nbsp; ${aboveN}/${N} days above the 25-day average</div>`;
  }

  // ── Trends Tab — Instrument Card Grid ────────────────────────────────
  function buildTrendsCards() {
    const allData = getActiveData(); // respect AI filter
    const grid = document.getElementById('trendsCardGrid');
    if (!grid) return;
    const search   = (document.getElementById('trendsSearch')?.value || '').toLowerCase();
    const groupSel = document.getElementById('trendsGroupFilter');
    const groupVal = groupSel?.value || 'all';
    const sortVal  = document.getElementById('trendsListSort')?.value || 'run_desc';

    // Populate group filter on first call
    if (groupSel && groupSel.options.length <= 1) {
      [...new Set(allData.map(d => d.group).filter(Boolean))].sort().forEach(g => {
        const opt = document.createElement('option');
        opt.value = g; opt.textContent = g;
        groupSel.appendChild(opt);
      });
    }

    // Build items with pre-computed trend stats
    let items = allData.map(d => {
      const segs       = trendsData[d.instrument_name] || [];
      const currentSeg = segs[0] || null;
      const upSegs     = segs.filter(s => s.direction === 'UPTREND');
      const dnSegs     = segs.filter(s => s.direction === 'DOWNTREND');
      const avgUp      = upSegs.length ? Math.round(upSegs.reduce((a,s) => a+s.days,0) / upSegs.length) : 0;
      const avgDown    = dnSegs.length ? Math.round(dnSegs.reduce((a,s) => a+s.days,0) / dnSegs.length) : 0;
      const totalDays  = segs.reduce((a,s) => a+s.days, 0);
      const upDays     = upSegs.reduce((a,s) => a+s.days, 0);
      const upPct      = totalDays ? Math.round(upDays/totalDays*100) : 50;
      // Trend history is DAILY-only data — the card's direction must come from
      // the same daily segment its run/since/% are read from, NOT the active-TF
      // established_trend (a 4H downtick was painting a red badge on a
      // multi-year daily up-run, and Extended compared the run against the
      // wrong side's average).
      const established = currentSeg ? currentSeg.direction
                        : (d['established_trend'] || d['trend_direction'] || '');
      const runDays    = currentSeg ? currentSeg.days : (parseInt(d['trend_run_days']) || 0);
      const isUp       = established === 'UPTREND';
      const isDown     = established === 'DOWNTREND';
      const avgCurrent = isUp ? avgUp : isDown ? avgDown : 0;
      const pctOfAvg   = avgCurrent ? Math.round(runDays / avgCurrent * 100) : 0;
      const maturity   = pctOfAvg >= 150 ? 'Extended' : pctOfAvg >= 80 ? 'Mature' : pctOfAvg >= 40 ? 'Developing' : 'Young';
      const move       = currentSeg?.pct_move ?? null;
      const signal     = d[f('signal_type')] || d[f('signal')] || '';
      const close      = parseFloat(d[f('close')]) || null;
      const volSpike   = d[f('volume_spike_flag')] === 'yes';
      // Last 8 segments for the history strip (segs is newest-first; reverse for L→R display)
      const histSegs   = segs.slice(0, 8).reverse();
      return { name: d.instrument_name, group: d.group||'', established, runDays,
               avgCurrent, pctOfAvg, maturity, upPct, currentSeg, move, hasData: segs.length > 0,
               signal, close, volSpike, histSegs };
    });

    // Filter
    if (search) {
      const matched = new Set(allData.filter(d => matchesSearch(d, search)).map(d => d.instrument_name));
      items = items.filter(d => matched.has(d.name));
    }
    if (groupVal !== 'all') items = items.filter(d => d.group === groupVal);

    // Sort
    if      (sortVal === 'run_desc')   items.sort((a,b) => b.runDays - a.runDays);
    else if (sortVal === 'run_asc')    items.sort((a,b) => a.runDays - b.runDays);
    else if (sortVal === 'up_age_desc') items.sort((a,b) => {
      const aD = a.established==='UPTREND' ? a.runDays : -1;
      const bD = b.established==='UPTREND' ? b.runDays : -1;
      return bD - aD;
    });
    else if (sortVal === 'up_age_asc') items.sort((a,b) => {
      const aD = a.established==='UPTREND' ? a.runDays : Infinity;
      const bD = b.established==='UPTREND' ? b.runDays : Infinity;
      return aD - bD;
    });
    else if (sortVal === 'dn_age_desc') items.sort((a,b) => {
      const aD = a.established==='DOWNTREND' ? a.runDays : -1;
      const bD = b.established==='DOWNTREND' ? b.runDays : -1;
      return bD - aD;
    });
    else if (sortVal === 'dn_age_asc') items.sort((a,b) => {
      const aD = a.established==='DOWNTREND' ? a.runDays : Infinity;
      const bD = b.established==='DOWNTREND' ? b.runDays : Infinity;
      return aD - bD;
    });
    else if (sortVal === 'up_first')   items.sort((a,b) => (b.established==='UPTREND')-(a.established==='UPTREND'));
    else if (sortVal === 'down_first') items.sort((a,b) => (b.established==='DOWNTREND')-(a.established==='DOWNTREND'));
    else if (sortVal === 'alpha')      items.sort((a,b) => a.name.localeCompare(b.name));

    grid.innerHTML = items.map((d, idx) => {
      const isUp   = d.established === 'UPTREND';
      const isDown = d.established === 'DOWNTREND';
      const color       = isUp ? 'var(--buy)' : isDown ? 'var(--sell)' : 'var(--neutral)';
      const badgeCls    = isUp ? 'tc-badge-up' : isDown ? 'tc-badge-down' : 'tc-badge-neutral';
      const badgeTxt    = isUp ? '↑ Uptrend' : isDown ? '↓ Downtrend' : 'Neutral';
      const matColor    = d.pctOfAvg >= 150 ? 'var(--sell)' : d.pctOfAvg >= 80 ? 'var(--watch)' : 'var(--buy)';
      const matIcon     = d.pctOfAvg >= 150 ? '⚠' : d.pctOfAvg >= 80 ? '◑' : '●';
      const since       = d.currentSeg ? `since ${d.currentSeg.start}` : '';
      const moveStr     = d.move !== null ? `<span class="tc-move" style="color:${d.move>=0?'var(--buy)':'var(--sell)'}">${d.move>=0?'+':''}${d.move}%</span>` : '';
      const extAttr     = d.maturity === 'Extended' ? ' data-extended' : '';
      const delay       = `animation-delay:${(idx * 0.022).toFixed(3)}s`;
      const matFill     = d.avgCurrent ? Math.min(d.pctOfAvg, 150) / 1.5 : 0; // 0–100% of bar

      // Signal badge
      const sig = (d.signal || '').toLowerCase();
      const isBuy  = sig.includes('buy');
      const isSell = sig.includes('sell');
      const isWatch= sig.includes('watch');
      const sigColor = isBuy ? 'var(--buy)' : isSell ? 'var(--sell)' : isWatch ? 'var(--watch)' : 'var(--text-muted)';
      const sigLabel = isBuy ? '▲ Buy' : isSell ? '▼ Sell' : isWatch ? '◆ Watch' : 'No signal';
      const priceStr = d.close ? `<span class="tc-price">${d.close < 10 ? d.close.toFixed(3) : d.close < 1000 ? d.close.toFixed(2) : d.close.toFixed(0)}</span>` : '';
      const volDot   = d.volSpike ? `<span class="tc-vol-dot" title="Volume spike">VOL</span>` : '';

      // Mini history strip + year axis + caption (strip spans today − histTotal → today)
      const histTotal = d.histSegs.reduce((a,s) => a+s.days, 0);
      let histHtml = '';
      if (d.histSegs.length >= 2 && histTotal > 0) {
        const segsHtml = d.histSegs.map(s => {
          const hc = s.direction === 'UPTREND' ? 'var(--buy)' : 'var(--sell)';
          return `<div class="tc-hist-seg" style="flex:${s.days};background:${hc}" title="${s.direction === 'UPTREND' ? '↑' : '↓'} ${s.days}d"></div>`;
        }).join('');
        const MS_D = 86400000;
        const hEnd = Date.now();
        const hStart = hEnd - histTotal * MS_D;
        let ticks = '';
        for (let y = new Date(hStart).getFullYear() + 1; y <= new Date(hEnd).getFullYear(); y++) {
          const p = (new Date(y, 0, 1).getTime() - hStart) / (histTotal * MS_D) * 100;
          if (p < 4 || p > 96) continue;
          ticks += `<span class="tc-hist-year" style="left:${p.toFixed(1)}%">${histTotal > 2200 ? '’' + String(y).slice(2) : y}</span>`;
        }
        const axis = ticks
          ? `<div class="tc-hist-axis">${ticks}</div>`
          : `<div class="tc-hist-axis"><span class="tc-hist-year" style="left:0;transform:none">${new Date(hStart).toISOString().slice(0, 7)}</span><span class="tc-hist-year" style="left:auto;right:0;transform:none">now</span></div>`;
        const spanStr = histTotal >= 330
          ? (histTotal / 365.25).toFixed(1).replace(/\.0$/, '') + 'y'
          : Math.max(1, Math.round(histTotal / 30.4)) + 'mo';
        const capTxt = d.hasData
          ? `<span style="color:${d.upPct >= 50 ? 'var(--buy)' : 'var(--sell)'};font-weight:600">${d.upPct}%</span> of the last ${spanStr} in uptrend`
          : '';
        const matChip = d.avgCurrent
          ? `<span class="tc-mat-chip" style="color:${matColor};border-color:${matColor}">${matIcon} ${d.maturity} — ${(d.pctOfAvg / 100).toFixed(1)}× the ${d.avgCurrent}d avg</span>`
          : '';
        histHtml = `<div class="tc-hist-strip">${segsHtml}</div>${axis}${(capTxt || matChip) ? `<div class="tc-hist-cap">${capTxt}${capTxt && matChip ? ' · ' : ''}${matChip}</div>` : ''}`;
      }

      const _aiTrend = isAI(d.name);

      return `<div class="trend-card${_aiTrend ? ' ai-card' : ''}" data-name="${d.name}"${extAttr} style="--tc:${color};${delay}">
        <div class="tc-header">
          <div class="tc-name-wrap">
            <span class="tc-name">${d.name}</span>
            ${_aiTrend ? '<span class="ai-chip-mini">AI</span>' : ''}
            <span class="tc-group">${d.group}</span>
          </div>
          <span class="tc-badge ${badgeCls}">${badgeTxt}</span>
        </div>
        <div class="tc-body">
          <div class="tc-days" style="color:${color}">${d.runDays || '—'}<span class="tc-days-unit">d</span></div>
          <div class="tc-since">${since}</div>
          ${moveStr}
        </div>
        <div class="tc-signal-row">
          <span class="tc-sig-label" style="color:${sigColor}">${sigLabel}</span>
          <div style="display:flex;align-items:center;gap:5px">${volDot}${priceStr}</div>
        </div>
        ${!histHtml && d.avgCurrent ? `<div class="tc-meta-row">
          <span class="tc-mat" style="color:${matColor}">${matIcon} ${d.maturity}</span>
          <span class="tc-avg">avg ${d.avgCurrent}d &middot; <span style="color:${matColor}">${d.pctOfAvg}%</span></span>
        </div>
        <div class="tc-mat-bar"><div class="tc-mat-fill" style="width:${matFill.toFixed(1)}%"></div></div>` : ''}
        ${histHtml}
      </div>`;
    }).join('');

    // Click → show detail
    grid.querySelectorAll('.trend-card').forEach(card => {
      card.addEventListener('click', () => {
        selectedTrendInst = card.dataset.name;
        grid.style.display = 'none';
        const panel = document.getElementById('trendsDetailPanel');
        panel.style.display = 'block';
        panel.scrollTop = 0;
        renderTrendDetail(card.dataset.name);
      });
    });
  }

  function renderTrendDetail(name) {
    const main = document.getElementById('trendsDetailPanel');
    const segments = trendsData[name] || [];
    const item = allData.find(d => d.instrument_name === name);

    const backBtn = `<button class="trends-back-btn" id="trendsBackBtn">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      All instruments
    </button>`;

    const goBack = () => {
      document.getElementById('trendsDetailPanel').style.display = 'none';
      document.getElementById('trendsCardGrid').style.display = 'grid';
    };

    if (!segments.length) {
      main.innerHTML = backBtn + `<div class="trends-empty-state"><p>No trend history available for ${name}</p></div>`;
      document.getElementById('trendsBackBtn').addEventListener('click', () => {
        goBack();
      });
      return;
    }

    const established = item ? (item[f('established_trend')] || item[f('trend_direction')] || 'NEUTRAL') : 'NEUTRAL';
    const estCls = established === 'UPTREND' ? 'up' : established === 'DOWNTREND' ? 'down' : 'neutral';
    const estColor = established === 'UPTREND' ? 'var(--buy)' : established === 'DOWNTREND' ? 'var(--sell)' : 'var(--neutral)';

    // Core stats
    const upTrends   = segments.filter(s => s.direction === 'UPTREND');
    const downTrends = segments.filter(s => s.direction === 'DOWNTREND');
    const longestUp   = upTrends.length   ? Math.max(...upTrends.map(s => s.days))   : 0;
    const longestDown = downTrends.length ? Math.max(...downTrends.map(s => s.days)) : 0;
    const avgUp   = upTrends.length   ? Math.round(upTrends.reduce((a, s)   => a + s.days, 0) / upTrends.length)   : 0;
    const avgDown = downTrends.length ? Math.round(downTrends.reduce((a, s) => a + s.days, 0) / downTrends.length) : 0;
    const maxDays = Math.max(...segments.map(s => s.days), 1);

    // Trend ratio (% of total days in uptrend)
    const totalDays = segments.reduce((a, s) => a + s.days, 0);
    const upDays    = upTrends.reduce((a, s) => a + s.days, 0);
    const upPct     = totalDays ? Math.round(upDays / totalDays * 100) : 0;
    const downPct   = 100 - upPct;

    // Current trend context
    const currentSeg = segments[0];
    const isCurrentUp = currentSeg.direction === 'UPTREND';
    const avgCurrent  = isCurrentUp ? avgUp : avgDown;
    const longestCurrent = isCurrentUp ? longestUp : longestDown;
    const pctOfAvg = avgCurrent ? Math.round(currentSeg.days / avgCurrent * 100) : 0;
    const maturity = pctOfAvg >= 150 ? 'Extended' : pctOfAvg >= 80 ? 'Mature' : pctOfAvg >= 40 ? 'Developing' : 'Young';
    const maturityColor = pctOfAvg >= 150 ? 'var(--sell)' : pctOfAvg >= 80 ? 'var(--watch)' : 'var(--buy)';
    const maturityIcon = pctOfAvg >= 150 ? '⚠' : pctOfAvg >= 80 ? '◑' : '●';
    const currentPct = currentSeg.pct_move != null ? currentSeg.pct_move : null;

    main.innerHTML = `
      ${backBtn}

      <div class="trend-detail-header">
        <div class="trend-detail-name">${name} ${tvBtn(name, '')}</div>
        <div class="trend-detail-meta">
          <span class="est-trend ${estCls}">${established === 'UPTREND' ? 'Uptrend' : established === 'DOWNTREND' ? 'Downtrend' : 'Neutral'}</span>
          <span>${item ? [item.group, item.sector].filter(Boolean).join(' · ') : ''}</span>
        </div>
      </div>

      <!-- Current Trend Context -->
      <div class="trend-context-card" style="border-color:${estColor}20;background:${estColor}08">
        <div class="ctx-main">
          <div class="ctx-label">Current Trend</div>
          <div class="ctx-days" style="color:${estColor}">${currentSeg.days} days</div>
          <div class="ctx-since">${currentSeg.direction === 'UPTREND' ? '↑ Uptrend' : '↓ Downtrend'} since ${currentSeg.start}</div>
          ${currentPct !== null ? `<div class="ctx-move" style="color:${currentPct >= 0 ? 'var(--buy)' : 'var(--sell)'}">${currentPct >= 0 ? '+' : ''}${currentPct}% move</div>` : ''}
        </div>
        <div class="ctx-compare">
          <div class="ctx-compare-row"><span class="ctx-cmp-label">Historical avg</span><span class="ctx-cmp-val">${avgCurrent}d</span></div>
          <div class="ctx-compare-row"><span class="ctx-cmp-label">Longest ever</span><span class="ctx-cmp-val">${longestCurrent}d</span></div>
          <div class="ctx-compare-row"><span class="ctx-cmp-label">vs average</span><span class="ctx-cmp-val">${pctOfAvg}%</span></div>
          <div class="ctx-maturity" style="color:${maturityColor}">${maturityIcon} ${maturity}</div>
        </div>
      </div>

      <!-- Trend Ratio Bar -->
      <div class="trend-ratio-wrap">
        <div class="trend-ratio-labels">
          <span style="color:var(--buy)">↑ Uptrend ${upPct}%</span>
          <span style="color:var(--text-muted);font-size:.7rem">${totalDays} total days tracked</span>
          <span style="color:var(--sell)">↓ Downtrend ${downPct}%</span>
        </div>
        <div class="trend-ratio-bar">
          <div class="trb-up" style="width:${upPct}%"></div>
          <div class="trb-down" style="width:${downPct}%"></div>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="trend-stats">
        <div class="trend-stat-card">
          <div class="stat-value" style="color:var(--buy)">${longestUp}d</div>
          <div class="stat-label">Longest Up</div>
        </div>
        <div class="trend-stat-card">
          <div class="stat-value" style="color:var(--sell)">${longestDown}d</div>
          <div class="stat-label">Longest Down</div>
        </div>
        <div class="trend-stat-card">
          <div class="stat-value" style="color:var(--buy)">${avgUp}d</div>
          <div class="stat-label">Avg Up</div>
        </div>
        <div class="trend-stat-card">
          <div class="stat-value" style="color:var(--sell)">${avgDown}d</div>
          <div class="stat-label">Avg Down</div>
        </div>
        <div class="trend-stat-card">
          <div class="stat-value">${upTrends.length}</div>
          <div class="stat-label">Up Count</div>
        </div>
        <div class="trend-stat-card">
          <div class="stat-value">${downTrends.length}</div>
          <div class="stat-label">Down Count</div>
        </div>
      </div>

      <!-- Timeline -->
      <h4 class="trend-section-title">Trend Timeline</h4>
      <div class="trend-timeline">
        ${segments.map((seg, i) => {
          const isUp = seg.direction === 'UPTREND';
          const cls = isUp ? 'seg-up' : 'seg-down';
          const isCurrent = i === 0;
          const barPct = Math.round((seg.days / maxDays) * 100);
          const pct = seg.pct_move != null ? seg.pct_move : null;
          const pctColor = isUp ? 'var(--buy)' : 'var(--sell)';
          return `<div class="trend-segment ${cls}${isCurrent ? ' seg-current' : ''}">
            <div class="trend-seg-top">
              <div class="trend-seg-left">
                <span class="trend-seg-dir">${isUp ? '↑ Uptrend' : '↓ Downtrend'}${isCurrent ? '<span class="seg-current-badge">current</span>' : ''}</span>
                <span class="trend-seg-dates">${seg.start} → ${seg.end}</span>
              </div>
              <div class="trend-seg-right">
                ${pct !== null ? `<span class="trend-seg-pct" style="color:${pctColor}">${pct >= 0 ? '+' : ''}${pct}%</span>` : ''}
                <span class="trend-seg-days-val">${seg.days}d</span>
              </div>
            </div>
            <div class="trend-seg-bar"><div class="trend-seg-bar-fill" style="width:${barPct}%;background:${isUp ? 'var(--buy)' : 'var(--sell)'}"></div></div>
          </div>`;
        }).join('')}
      </div>
    `;

    // Wire back button (rendered fresh in innerHTML)
    document.getElementById('trendsBackBtn').addEventListener('click', goBack);
  }

  document.getElementById('trendsSearch').addEventListener('input', debounce(() => buildTrendsCards(), 150));
  document.getElementById('trendsGroupFilter').addEventListener('change', () => buildTrendsCards());
  document.getElementById('trendsListSort').addEventListener('change', () => buildTrendsCards());

  // ── Public API ───────────────────────────────────────────────────────
  function toggleStar(btn) {
    const ticker = btn.dataset.ticker;
    const nowStarred = !userStarred.has(ticker);
    if (nowStarred) {
      userStarred.add(ticker);
      // First star → ask for notification permission
      if (userStarred.size === 1) requestNotificationPermission();
    } else {
      userStarred.delete(ticker);
    }
    // Update all star buttons for this ticker on the page
    document.querySelectorAll(`.star-btn[data-ticker="${ticker}"]`).forEach(b => {
      b.classList.toggle('starred', nowStarred);
      b.title = nowStarred ? 'Unmark as analyzed' : 'Mark as analyzed';
      const svg = b.querySelector('svg');
      if (svg) svg.setAttribute('fill', nowStarred ? 'currentColor' : 'none');
    });
    localStorage.setItem(sk('swingpulse-starred'), JSON.stringify([...userStarred]));
    syncPush();
    renderWlMyList();
  }

  function openTvPicker(btn, name) {
    // Remove any existing picker (toggle off if same button tapped again)
    const existing = document.getElementById('tvPicker');
    if (existing) { existing.remove(); return; }

    const webUrl = tvUrl(name);
    // Build tradingview:// deep link with exchange and symbol as separate params
    const tvSym  = tvMap[name] || name;
    const ivlMap = { 'D': 'D', '4H': '240' };
    const ivl    = ivlMap[timeframe] || 'D';
    const layoutId = userTvLayout();
    let appUrl;
    if (tvSym.includes(':')) {
      const [exchange, symbol] = tvSym.split(':');
      appUrl = `tradingview://chart${layoutId ? '/' + layoutId : ''}?symbol=${symbol}&exchange=${exchange}&interval=${ivl}`;
    } else {
      appUrl = `tradingview://chart${layoutId ? '/' + layoutId : ''}?symbol=${tvSym}&interval=${ivl}`;
    }

    const picker = document.createElement('div');
    picker.id    = 'tvPicker';
    picker.className = 'tv-picker';
    picker.innerHTML = `
      <div class="tv-picker-label">${name}</div>
      <button class="tv-picker-btn" onclick="window.open('${webUrl}','_blank');document.getElementById('tvPicker')?.remove()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        Open in Web
      </button>
      <button class="tv-picker-btn" onclick="window.location.href='${appUrl}';document.getElementById('tvPicker')?.remove()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
        Open in App
      </button>`;

    // Position: below the button, clamped to viewport
    const rect = btn.getBoundingClientRect();
    const pickerW = 160;
    let left = rect.left;
    if (left + pickerW > window.innerWidth - 8) left = window.innerWidth - pickerW - 8;
    let top = rect.bottom + 6;
    if (top + 110 > window.innerHeight) top = rect.top - 116;

    picker.style.cssText = `position:fixed;top:${top}px;left:${left}px;`;
    document.body.appendChild(picker);

    // Close on outside click
    setTimeout(() => document.addEventListener('click', () => document.getElementById('tvPicker')?.remove(), { once: true }), 0);
  }

  // ── Events Tab — Big Volume & Big Moves Tracker ──────────────────────
  // ── Volume Tab — Multi-Timeframe Volume Tracker ─────────────────────
  // ── Trends Tab — Historical Summary Bar ─────────────────────────────
  function renderTrendsSummary() {
    const el = id => document.getElementById(id);
    if (!el('trhUpCount')) return;

    let upCount = 0, downCount = 0;
    let upDaysSum = 0, downDaysSum = 0;
    let upPctSum = 0, downPctSum = 0;

    for (const segs of Object.values(trendsData)) {
      if (!Array.isArray(segs)) continue;
      for (const seg of segs) {
        if (seg.direction === 'UPTREND') {
          upCount++;
          upDaysSum += seg.days || 0;
          upPctSum  += Math.abs(seg.pct_move || 0);
        } else if (seg.direction === 'DOWNTREND') {
          downCount++;
          downDaysSum += seg.days || 0;
          downPctSum  += Math.abs(seg.pct_move || 0);
        }
      }
    }

    const avgUpDays   = upCount   ? Math.round(upDaysSum / upCount)   : 0;
    const avgDownDays = downCount ? Math.round(downDaysSum / downCount): 0;
    const avgUpPct    = upCount   ? (upPctSum / upCount).toFixed(1)    : '0.0';
    const avgDownPct  = downCount ? (downPctSum / downCount).toFixed(1): '0.0';

    el('trhUpCount').textContent    = upCount.toLocaleString();
    el('trhDownCount').textContent  = downCount.toLocaleString();
    el('trhAvgUpDays').textContent  = avgUpDays + 'd';
    el('trhAvgDownDays').textContent= avgDownDays + 'd';
    el('trhAvgUpPct').textContent   = '+' + avgUpPct + '%';
    el('trhAvgDownPct').textContent = '-' + avgDownPct + '%';
  }


  // ── Share card ────────────────────────────────────────────────────────
  const SHARE_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`;

  function shareBtn(name) {
    if (!navigator.share) return ''; // only show on devices that support Web Share API
    return `<button class="share-btn" title="Share ${name}" data-act="shareCard" data-arg="${name}" data-stop="1">${SHARE_ICON}</button>`;
  }

  function shareCard(name) {
    const item = allData.find(d => d.instrument_name === name);
    if (!item) return;

    const tv      = tvUrl(name);
    const fn      = instName(name);
    const title   = fn ? `${name} · ${fn}` : name;
    const price   = formatPrice(item[f('close')]);
    const roc     = parseFloat(item[f('roc')]);
    const rocStr  = !isNaN(roc) ? (roc >= 0 ? '+' : '') + roc.toFixed(1) + '%' : '';
    const trend   = effectiveTrend(item);
    const run     = parseInt(item[f('trend_run_days')]);
    const sig     = item[f('primary_signal')] || '';
    const conf    = item[f('confirmation_status')] || '';
    const align   = item[f('tf_alignment')] || '';
    const sigConf = item[f('signal_confidence')] || '';
    const volSpk  = item[f('volume_spike_flag')] === 'yes';

    const trendEmoji = trend === 'UPTREND' ? '📈' : trend === 'DOWNTREND' ? '📉' : '➡️';
    const dirLabel   = conf.toLowerCase().includes('buy') ? '🟢 Buy' : conf.toLowerCase().includes('sell') ? '🔴 Sell' : '';

    let lines = [];
    lines.push(`⚡ *${title}*`);
    lines.push('───────────────');

    if (sig && dirLabel) lines.push(`${dirLabel} · ${sig}${align ? ' · ' + align : ''}`);
    else if (trend) lines.push(`${trendEmoji} ${trend.charAt(0) + trend.slice(1).toLowerCase()}${!isNaN(run) && run > 0 ? ` · ${run}d run` : ''}`);

    lines.push(`💰 ${price}${rocStr ? '  ' + rocStr + ' (5d)' : ''}`);

    if (sig && trend) lines.push(`${trendEmoji} ${trend.charAt(0) + trend.slice(1).toLowerCase()}${!isNaN(run) && run > 0 ? ` · ${run}d run` : ''}`);
    if (sigConf === 'high') lines.push(`🎯 High Confidence`);
    if (volSpk) lines.push(`📊 Volume Spike`);

    lines.push('───────────────');
    lines.push(`🔗 TradingView: ${tv}`);
    lines.push(`\nvia SwingPulse`);

    if (navigator.share) {
      navigator.share({
        title: `SwingPulse · ${title}`,
        text: lines.join('\n'),
      }).catch(() => {});
    }
  }

  // ── Delegated event handling (replaces inline onclick=) ────────────────
  // Elements use data-act="methodName" [data-arg="value"] [data-stop="1"]
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const fn  = window.SP && window.SP[act];
    if (typeof fn !== 'function') return;
    if (el.dataset.stop === '1') e.stopPropagation();
    if ('arg' in el.dataset) fn(el.dataset.arg, el);
    else fn(el);
  });

  async function togglePush() {
    if (isPushEnabled()) {
      await unsubscribeFromPush();
    } else {
      const ok = await subscribeToPush();
      if (!ok) alert('Could not enable notifications. Make sure you allowed permission.');
    }
  }

  // ── Notifications popup (bell) ───────────────────────────────────────
  // Today's notifications = every instrument with an active daily signal.
  function notifItems() {
    return allData
      .filter(d => d.primary_signal)
      .sort((a, b) => sigPriority(a.primary_signal) - sigPriority(b.primary_signal));
  }

  function updateNotifBell() {
    const btn = document.getElementById('pushToggleBtn');
    if (!btn) return;
    const n = notifItems().length;
    btn.classList.toggle('has-signals', n > 0);
    if (n > 0) btn.dataset.count = n; else delete btn.dataset.count;
  }

  function renderNotifPanel() {
    const list = document.getElementById('notifPopupList');
    if (!list) return;
    const items = notifItems();
    if (!items.length) {
      list.innerHTML = '<div class="notif-empty">No signals fired today</div>';
      return;
    }
    list.innerHTML = items.map(item => {
      const sig  = item.primary_signal;
      const buy  = sig.startsWith('B');
      const conf = item.signal_confidence || '';
      const vol  = item.volume_spike_flag === 'yes';
      return `<div class="notif-item" data-act="openModal" data-arg="${item.instrument_name}">
        <span class="notif-sig ${buy ? 'notif-buy' : 'notif-sell'}">${sig}</span>
        <div class="notif-body">
          <span class="notif-name">${item.instrument_name}${conf === 'high' ? ' ★' : ''}${vol ? ' <span class="notif-vol">VOL</span>' : ''}</span>
          <span class="notif-detail">${item.confirmation_status || ''}</span>
        </div>
        <span class="notif-group">${item.group || ''}</span>
      </div>`;
    }).join('');
  }

  function toggleNotifPanel() {
    const popup = document.getElementById('notifPopup');
    if (!popup) return;
    const open = popup.style.display !== 'none';
    if (open) { popup.style.display = 'none'; return; }
    renderNotifPanel();
    // Refresh the push row only — rewriting the bell's innerHTML here would
    // detach the clicked SVG and break the outside-click guard below.
    const pt = document.getElementById('notifPushToggle');
    if (pt) {
      const on = isPushEnabled();
      pt.textContent = on ? 'Push: on' : 'Push: off';
      pt.classList.toggle('push-on', on);
    }
    popup.style.display = '';
  }

  // Close popup on outside click or when a notification opens its modal
  document.addEventListener('click', e => {
    const popup = document.getElementById('notifPopup');
    if (!popup || popup.style.display === 'none') return;
    if (e.target.closest('.notif-item')) { popup.style.display = 'none'; return; }
    if (!e.target.closest('#notifPopup') && !e.target.closest('#pushToggleBtn')) {
      popup.style.display = 'none';
    }
  });

  // Initial UI state for push button (after SW registers)
  setTimeout(updatePushBadgeUI, 500);

  // ── Flow Tab — Indices Aggregate Volume ──────────────────────────────
  (function initFlowTab() {
    let flowChart   = null;
    let flowRegion  = 'All';

    // Format large volume numbers compactly
    function fmtVol(v) {
      if (!v || v === 0) return '—';
      if (v >= 1e12) return (v / 1e12).toFixed(1) + 'T';
      if (v >= 1e9)  return (v / 1e9).toFixed(1)  + 'B';
      if (v >= 1e6)  return (v / 1e6).toFixed(1)  + 'M';
      return v.toLocaleString();
    }

    function renderFlow() {
      fetchFlowData(flowRegion);
    }

    async function fetchFlowData(region) {
      try {
        const res  = await fetch('/api/flow?group=Indices&region=' + region + '&days=252');
        const json = await res.json();

        let data, stats;
        if (json.Indices) {
          // Pre-built JSON (Cloudflare Pages) — filter client-side
          data = (json.Indices[region] || []).slice(-252);
          const vols   = data.map(d => d.volume).filter(v => v > 0);
          const recent = data.slice(-30).map(d => d.volume).filter(v => v > 0);
          stats = {
            current:     data.length ? data[data.length - 1].volume : 0,
            avg_30d:     recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : 0,
            window_high: vols.length ? Math.max(...vols) : 0,
            window_low:  vols.length ? Math.min(...vols) : 0,
            mean:        vols.length ? Math.round(vols.reduce((a, b) => a + b, 0) / vols.length) : 0,
          };
        } else {
          // Flask API response (local dev server)
          data  = json.data  || [];
          stats = json.stats || {};
        }
        drawFlowChart(data, stats);
      } catch (e) {
        console.error('Flow fetch error', e);
      }
    }

    function drawFlowChart(data, stats) {
      const canvas = document.getElementById('flowChart');
      if (!canvas) return;

      // Destroy existing chart instance
      if (flowChart) { flowChart.destroy(); flowChart = null; }

      // Pad right with empty bars (2 months ≈ 42 trading days)
      const EMPTY_BARS = 42;
      const labels   = data.map(d => d.date);
      const volumes  = data.map(d => d.volume);
      const meanVol  = stats.mean || (volumes.length ? Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length) : 0);

      // Pad right with nulls
      for (let i = 0; i < EMPTY_BARS; i++) { labels.push(''); volumes.push(null); }

      // Today boundary = index of last real data point
      const todayIdx = data.length - 1;

      flowChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Volume',
              data: volumes,
              borderColor: '#6366f1',
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 4,
              tension: 0.3,
              fill: false,
              spanGaps: false,
            },
            {
              label: 'Mean',
              data: Array(labels.length).fill(meanVol),
              borderColor: 'rgba(255,255,255,0.18)',
              borderWidth: 1,
              borderDash: [4, 4],
              pointRadius: 0,
              pointHoverRadius: 0,
              tension: 0,
              fill: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 300 },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(15,20,40,0.95)',
              titleColor: '#e2e8f0',
              bodyColor: '#94a3b8',
              borderColor: '#1e2d4a',
              borderWidth: 1,
              callbacks: {
                label: ctx => ctx.datasetIndex === 0 && ctx.raw !== null
                  ? ' ' + fmtVol(ctx.raw)
                  : null,
              },
            },
            // Today marker as a vertical annotation using afterDraw
          },
          scales: {
            x: {
              ticks: {
                color: '#64748b',
                font: { size: 10 },
                maxTicksLimit: 8,
                maxRotation: 0,
              },
              grid: { color: 'rgba(255,255,255,0.04)' },
            },
            y: {
              position: 'right',
              ticks: {
                color: '#64748b',
                font: { size: 10 },
                callback: v => fmtVol(v),
              },
              grid: { color: 'rgba(255,255,255,0.06)' },
            },
          },
        },
        plugins: [{
          id: 'todayLine',
          afterDraw(chart) {
            const ctx2 = chart.ctx;
            const xScale = chart.scales.x;
            const xPos = xScale.getPixelForValue(todayIdx);
            const { top, bottom } = chart.chartArea;
            ctx2.save();
            ctx2.setLineDash([3, 5]);
            ctx2.strokeStyle = 'rgba(255,255,255,0.18)';
            ctx2.lineWidth = 1;
            ctx2.beginPath();
            ctx2.moveTo(xPos, top);
            ctx2.lineTo(xPos, bottom);
            ctx2.stroke();
            ctx2.restore();
          },
        }],
      });

      // Update stat row
      const vals = [stats.current, stats.avg_30d, stats.window_high, stats.window_low];
      vals.forEach((v, i) => {
        const el = document.getElementById('fsStat' + i);
        if (el) el.textContent = fmtVol(v);
      });
    }

    // Wire filter chips
    const chips = document.getElementById('flowChips');
    if (chips) {
      chips.addEventListener('click', e => {
        const chip = e.target.closest('.flow-chip');
        if (!chip) return;
        chips.querySelectorAll('.flow-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        flowRegion = chip.dataset.region;
        fetchFlowData(flowRegion);
      });
    }

    // Expose renderFlow so renderCurrentTab() can call it
    window._renderFlow = renderFlow;
  })();

  window.SP = { openModal, toggleStar, openTvPicker, navigateToTab, shareCard, showUserPicker, openTrackRecord, closeTrackAndOpen, togglePush, toggleNotifPanel };

  // ── Init ─────────────────────────────────────────────────────────────
  // Wire legend filters once (static HTML elements — no re-registration on timeframe change)
  document.querySelectorAll('.legend-item[data-legend-filter]').forEach(el => {
    el.addEventListener('click', () => {
      const val = el.dataset.legendFilter;
      activeHmLegendFilter = activeHmLegendFilter === val ? '' : val;
      buildHeatmapCells();
    });
  });

  // 4-TF grid: clicking a row switches the active timeframe
  const mpTfGrid = document.getElementById('mpTfGrid');
  if (mpTfGrid) {
    mpTfGrid.addEventListener('click', e => {
      const row = e.target.closest('[data-mp-tf]');
      if (!row) return;
      setTimeframe(row.dataset.mpTf);
    });
  }

  // Wire trend + alignment filters via mp-breakdown container → navigate to scanner
  const mpBreakdown = document.getElementById('mpBreakdown');
  if (mpBreakdown) {
    mpBreakdown.addEventListener('click', e => {
      const row = e.target.closest('.mp-filter-row');
      if (!row) return;
      const trend = row.dataset.filterTrend;
      const align = row.dataset.filterAlign;  // e.g. "Triple Bull", "Counter-trend"
      const trendSel = document.getElementById('scannerTrendFilter');
      const alignSel = document.getElementById('scannerAlignFilter');
      if (!trendSel || !alignSel) return;

      if (trend) {
        // Toggle: clicking the active trend resets it
        trendSel.value = trendSel.value === trend ? 'all' : trend;
        alignSel.value = 'all';
      } else if (align) {
        // Map alignment label → scanner select value
        let alignVal = 'all';
        if (align.includes('Bull'))         alignVal = 'bull';
        else if (align.includes('Bear'))    alignVal = 'bear';
        else if (align === 'Counter-trend') alignVal = 'counter';
        else if (align === 'Mixed')         alignVal = 'mixed';
        // Toggle
        alignSel.value = alignSel.value === alignVal ? 'all' : alignVal;
        trendSel.value = 'all';
      }

      // Also keep heatmap filter in sync for when user scrolls back to dashboard
      activeTrendFilter = trendSel.value !== 'all' ? trendSel.value : '';
      activeAlignFilter = '';
      buildHeatmapCells();

      updateScannerCtxStrip();
      navigateToTab('scanner');
      buildScannerCards();
    });
  }

  // ── Scanner context strip: shows active dashboard filter + reset button ──
  function updateScannerCtxStrip() {
    const strip = document.getElementById('scannerCtxStrip');
    if (!strip) return;
    const clsSel   = document.getElementById('scannerClassFilter');
    const grpSel   = document.getElementById('scannerGroupFilter');
    const trendSel = document.getElementById('scannerTrendFilter');
    const alignSel = document.getElementById('scannerAlignFilter');
    const cls   = clsSel?.value   !== 'all' ? clsSel.value   : '';
    const grp   = grpSel?.value   !== 'all' ? grpSel.value   : '';
    const trend = trendSel?.value !== 'all' ? trendSel.value : '';
    const align = alignSel?.value !== 'all' ? alignSel.value : '';

    if (!cls && !grp && !trend && !align && !activeRegionFilter) {
      strip.style.display = 'none';
      strip.innerHTML = '';
      return;
    }

    const pills = [];
    if (activeRegionFilter) pills.push(`<span class="ctx-pill ctx-pill-group">Region: <strong>${activeRegionFilter}</strong></span>`);
    if (cls)   pills.push(`<span class="ctx-pill ctx-pill-group">Class: <strong>${cls}</strong></span>`);
    if (grp)   pills.push(`<span class="ctx-pill ctx-pill-group">Group: <strong>${grp}</strong></span>`);
    if (trend) {
      const lbl = trend === 'UPTREND' ? 'Uptrend' : trend === 'DOWNTREND' ? 'Downtrend' : 'Neutral';
      const cls = trend === 'UPTREND' ? 'ctx-pill-bull' : trend === 'DOWNTREND' ? 'ctx-pill-bear' : 'ctx-pill-neut';
      pills.push(`<span class="ctx-pill ${cls}">Trend: <strong>${lbl}</strong></span>`);
    }
    if (align) {
      const lbl = { bull:'Bull Aligned', bear:'Bear Aligned', counter:'Counter-trend', mixed:'Mixed' }[align] || align;
      pills.push(`<span class="ctx-pill ctx-pill-align">Alignment: <strong>${lbl}</strong></span>`);
    }
    strip.style.display = 'flex';
    strip.innerHTML = pills.join('') +
      `<button class="ctx-clear-btn" id="ctxClearBtn">✕ Reset</button>`;

    document.getElementById('ctxClearBtn')?.addEventListener('click', () => {
      if (clsSel)   clsSel.value   = 'all';
      if (grpSel)   grpSel.value   = 'all';
      if (trendSel) trendSel.value = 'all';
      if (alignSel) alignSel.value = 'all';
      activeTrendFilter = '';
      activeAlignFilter = '';
      activeRegionFilter = '';
      buildHeatmapCells();
      renderGroupPulse();
      updateScannerCtxStrip();
      buildScannerCards();
    });
  }

  registerSW();
  updateSyncBadge();
  if (!syncUser) showUserPicker();
  // Initial load — pull watchlist sync after data is ready
  loadAll().then(() => { if (syncUser) syncPull(); });

  // ── Auto-refresh every 4 hours (matches CI pipeline cadence) ────────
  // Silently re-fetches all data in the background; if the page is hidden
  // we skip and let the next visibilitychange trigger a reload instead.
  const AUTO_REFRESH_MS = 4 * 60 * 60 * 1000; // 4 hours
  setInterval(async () => {
    if (document.visibilityState === 'hidden') return; // skip while backgrounded
    await loadAll(); if (syncUser) await syncPull();
  }, AUTO_REFRESH_MS);

  // ── Self-update: reload when a newer build has been deployed ───────────
  // An installed PWA keeps the page in memory and never refetches the HTML on
  // reopen, so it runs stale code until force-killed. We poll a tiny
  // version.json (stamped fresh on every UI deploy) and hard-reload when the
  // deployed build id differs from the one baked into the running page.
  const RUNNING_BUILD = (window.__BUILD_ID__ || '').trim();
  let _updateChecking = false;
  let _lastUpdateCheck = 0;
  async function checkForAppUpdate() {
    // Skip in local dev (placeholder never replaced) or if build is unknown
    if (!RUNNING_BUILD || RUNNING_BUILD.indexOf('__BUILDSTAMP__') !== -1) return;
    if (_updateChecking) return;
    if (Date.now() - _lastUpdateCheck < 30000) return; // throttle to 30s
    _updateChecking = true;
    _lastUpdateCheck = Date.now();
    try {
      const res = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const { build } = await res.json();
      if (build && String(build) !== RUNNING_BUILD) {
        // Loop guard: if we already reloaded for this build and still run old
        // code (CDN lag), don't reload again — wait for the next deploy.
        if (sessionStorage.getItem('sp-reload-build') === String(build)) return;
        sessionStorage.setItem('sp-reload-build', String(build));
        // Query-string navigation instead of reload(): iOS PWAs can serve the
        // cached shell on reload(), but a new URL forces a fresh HTML fetch.
        window.location.replace('/?b=' + build);
      }
    } catch (_) { /* offline or missing — ignore */ }
    finally { _updateChecking = false; }
  }
  checkForAppUpdate(); // check once on launch

  // Show this build's deploy time in the bell popup — lets any device prove
  // which UI build it is actually running (build id = deploy unix seconds).
  (() => {
    const el = document.getElementById('notifUiBuild');
    if (!el) return;
    const b = parseInt(RUNNING_BUILD, 10);
    el.textContent = (isFinite(b) && b > 1e9)
      ? 'UI ' + new Date(b * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
      : 'UI dev';
  })();

  // Re-sync when user returns to the tab (catches changes made on another device)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    checkForAppUpdate();          // reload if a newer build shipped while backgrounded
    if (syncUser) syncPull();
  });

  // ── Single source of truth for the confluence score ───────────────────
  // Returns { isBullish, lines: [{label, points}] }. Both radarConfluenceScore()
  // (sum → 0-100) and radarScoreBreakdown() (the modal panel) read from this,
  // so the number and its explanation can never drift apart.
  function radarScoreFactors(item) {
    // SINGLE-TIMEFRAME SCORE: every factor reads the ACTIVE timeframe's own
    // data (Daily or 4H, via f()). Timeframes are scored independently — no
    // cross-TF blending, so the 4H view is a pure 4H read and vice versa.

    // Direction: ribbon majority on the active TF (same metric as the gauge) so
    // bias label and gauge never contradict. close < MA25 alone marks DOWNTREND
    // even when 85% of MAs are below price (pullback in uptrend) — ribbon
    // majority is the honest read.
    const _close = parseFloat(item[f('close')]);
    const _periods = activeMaPeriods();
    let _masAbove = 0, _masTotal = 0;
    if (!isNaN(_close)) {
      _periods.forEach(p => {
        const v = parseFloat(item[f('ma_' + p)]);
        if (!isNaN(v)) { _masTotal++; if (_close > v) _masAbove++; }
      });
    }
    const isBullish = _masTotal > 0 ? _masAbove * 2 >= _masTotal
                                    : item[f('trend_direction')] !== 'DOWNTREND';

    const lines = [];

    // 0. Ribbon rollover (max 35) — TOP structural factor. Drivers (MA25/100,
    //     weighted) + lagging MA200 cutting through anchors (MA300/400/500)
    //     confirms a trend change, backing B1 (bull flip) / S1 (bear flip).
    const rollDir   = item[f('rollover_dir')] || 'none';
    const rollScore = parseInt(item[f('rollover_score')]) || 0;
    const rollMax   = parseInt(item[f('rollover_max')]) || 15;
    const rollStage = parseInt(item[f('rollover_stage')]) || 0;
    const rollAligned = (isBullish && rollDir === 'bull') || (!isBullish && rollDir === 'bear');
    if (rollAligned && rollScore > 0 && rollMax > 0) {
      const pts   = Math.round((rollScore / rollMax) * 35);
      const stageLbl = rollStage >= 3 ? 'full flip' : rollStage === 2 ? 'deepening' : 'starting';
      lines.push({ label: `Ribbon rollover ${rollScore}/${rollMax} (${isBullish ? 'bull' : 'bear'} ${stageLbl})`, points: pts });
    }

    // 1. Signal type (max 25) — the active TF's own signal. B1/S1 top authority;
    //    B4/S4 anchor bounce next.
    const sig = item[f('primary_signal')] || '';
    const buySig  = sig && sig.startsWith('B');
    const sellSig = sig && sig.startsWith('S');
    const hasAlignedSig = (isBullish && buySig) || (!isBullish && sellSig);
    if (hasAlignedSig) {
      const sigPts = isReversal(sig) ? 25 : isLongestMa(sig) ? 15 : 10;
      lines.push({ label: `${sig} ${isReversal(sig) ? 'reversal signal' : isLongestMa(sig) ? 'anchor MA signal' : 'signal'}`,
                   points: sigPts });
    }

    // 2. Signal confidence (max 10) — backtested expectancy of this signal code
    //    on this timeframe + asset class (confidence_map.json). 'low' means the
    //    code historically LOSES money there, so it subtracts.
    const conf = (item[f('signal_confidence')] || '').toLowerCase();
    if (conf === 'high')          lines.push({ label: 'High confidence — backtested edge', points: 10 });
    else if (conf === 'standard') lines.push({ label: 'Standard confidence', points: 5 });
    else if (conf === 'low')      lines.push({ label: 'Low confidence — negative backtest expectancy', points: -10 });

    // 3. Ribbon squeeze (max 10) — coiled-spring setup on the active TF
    if (item[f('ribbon_compression')] === 'yes') {
      lines.push({ label: `Ribbon squeeze (${timeframe})`, points: 10 });
    }

    // 4. Key-level confluence (max 9) — price testing a real, well-tested S/R
    //    level. Key levels are price-based (daily columns), valid on both views.
    if (item.key_level_touched_today === 'yes') {
      let klPoints = 3;
      const touches = parseInt(item.key_level_touch_count) || 0;
      if      (touches >= 100) klPoints += 6;
      else if (touches >= 50)  klPoints += 4;
      else if (touches >= 20)  klPoints += 2;
      lines.push({ label: `Key level held ${touches}×, tested today`, points: klPoints });
    }

    // 5. MA-order quality (max 8) — clean, textbook ribbon stacking in the trade direction
    const maOrder = parseInt(item[f('ma_order_score')]);
    const maMax   = summaryData.ma_max_pairs || 19;
    if (!isNaN(maOrder) && maMax > 0) {
      const stackPct = maOrder / maMax;                       // 1 = perfectly bullish-stacked
      const aligned  = isBullish ? stackPct : (1 - stackPct); // direction-aware
      const pts = Math.round(aligned * 8);
      if (pts > 0) lines.push({ label: `MA ribbon ${isBullish ? 'stacked' : 'inverted'} ${maOrder}/${maMax}`, points: pts });
    }

    // 6. RSI timing (max 9) — entry timing on the active TF only
    const tfRsi = parseFloat(item[f('rsi')]);
    if (!isNaN(tfRsi)) {
      if (isBullish) {
        if      (tfRsi < 30) lines.push({ label: `${timeframe} RSI ${tfRsi.toFixed(0)} (oversold)`,    points: 9 });
        else if (tfRsi < 50) lines.push({ label: `${timeframe} RSI ${tfRsi.toFixed(0)} (room to run)`, points: 5 });
      } else {
        if      (tfRsi > 70) lines.push({ label: `${timeframe} RSI ${tfRsi.toFixed(0)} (overbought)`,   points: 9 });
        else if (tfRsi > 50) lines.push({ label: `${timeframe} RSI ${tfRsi.toFixed(0)} (room to fall)`, points: 5 });
      }
    }

    // 7. Signal freshness (max 4) — recent signals are actionable, stale ones have already moved
    const daysAgo = parseInt(item[f('last_signal_days_ago')]);
    if (!isNaN(daysAgo)) {
      if      (daysAgo <= 1) lines.push({ label: `Signal fresh (${daysAgo}d ago)`,  points: 4 });
      else if (daysAgo <= 4) lines.push({ label: `Signal recent (${daysAgo}d ago)`, points: 2 });
      else if (daysAgo <= 9) lines.push({ label: `Signal ${daysAgo}d ago`,          points: 1 });
    }

    // 8. Volume (max 6) — spike on the active TF
    const _volSpike = timeframe === '4H' ? item.h4_volume_spike_flag : item.volume_spike_flag;
    if (_volSpike === 'yes') lines.push({ label: `Volume spike (${timeframe})`, points: 6 });

    return { isBullish, lines };
  }

  function radarConfluenceScore(item) {
    const { lines } = radarScoreFactors(item);
    const total = lines.reduce((sum, l) => sum + l.points, 0);
    return Math.max(0, Math.min(total, 100));
  }

  function scoreTier(score) {
    if (score >= 75) return 'prime';
    if (score >= 50) return 'strong';
    return 'developing';
  }

  // Itemised breakdown for the "Why this score?" panel — same factors as the score
  function radarScoreBreakdown(item) {
    return radarScoreFactors(item);
  }

  // renderRadar() removed — Radar is now the "Ranked" view inside Signals.
  // Scoring functions (radarConfluenceScore, radarScoreFactors) are still used by scanner cards.


})();
