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
  let portfolioData = null;  // XM account data from Gmail parser
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
  let scannerSort = 'signal';
  let gpViewMode = 'group';   // 'group' | 'region'
  let activeRegionFilter = ''; // when set, scanner filters to all groups in this region
  let detectedMacroMas = [300, 500, 1000, 2000];  // S/R MAs detected from data
  const SCANNER_PAGE_SIZE = 100;   // cards rendered per page (keeps DOM manageable)
  let scannerPage = 1;             // how many pages shown so far
  // ── Radar filter state ──────────────────────────────────────────────────
  const radarState = { search: '', dir: 'all', rsi: 'all',
    collapsed: { prime: false, strong: false, developing: false }, guide: false };
  let radarWired = false;
  let wlFilter = 'all';
  let wlSort = 'signal';
  let activeAlertTab = 'turning';
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
  let timeframe = 'D';      // 'D' = daily, 'W' = weekly
  let trendsData = {};       // instrument_name → [{direction, start, end, days}]
  let selectedTrendInst = null;
  let signalHistory    = JSON.parse(localStorage.getItem('sp-signal-history') || '{}');
  let explanationsData = {};                                                    // instrument_name → AI text
  let instrumentNotes  = JSON.parse(localStorage.getItem(sk('sp-notes')) || '{}'); // instrument_name → note text
  let eventsData       = [];   // historical events (vol spikes + big moves) from all daily CSVs
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
    badge.classList.toggle('sync-badge-unset', !syncUser);
  }

  // ── Signal Performance Tracker ───────────────────────────────────────
  function updateSignalHistory() {
    const today = new Date().toISOString().slice(0, 10);
    let changed = false;
    for (const item of allData) {
      const sig   = item[f('primary_signal')] || '';
      const conf  = item[f('confirmation_status')] || '';
      const key   = `${item.instrument_name}_${timeframe}`;
      const price = parseFloat(item.close) || 0;
      if (sig) {
        const prev = signalHistory[key];
        if (!prev || prev.signal !== sig) {
          signalHistory[key] = { signal: sig, conf, date: today, price, tf: timeframe };
          changed = true;
        }
      } else if (signalHistory[key]) {
        delete signalHistory[key];
        changed = true;
      }
    }
    if (changed) localStorage.setItem('sp-signal-history', JSON.stringify(signalHistory));
  }

  function signalPerf(name) {
    const key  = `${name}_${timeframe}`;
    const rec  = signalHistory[key];
    if (!rec || !rec.price) return null;
    const item = allData.find(d => d.instrument_name === name);
    if (!item) return null;
    const cur = parseFloat(item.close) || 0;
    if (!cur) return null;
    const pct = ((cur - rec.price) / rec.price) * 100;
    const days = Math.round((new Date() - new Date(rec.date)) / 86400000);
    return { pct: pct.toFixed(1), days, date: rec.date, signal: rec.signal };
  }

  // ── Morning Brief ────────────────────────────────────────────────────
  function confluenceScore(item) {
    let score = 0;
    const sig    = item[f('primary_signal')]      || '';
    const conf   = (item[f('confirmation_status')]|| '').toLowerCase();
    const align  = (item[f('tf_alignment')]       || '').toLowerCase();
    const trend  = (item[f('trend_direction')]    || '').toLowerCase();
    const volSpk = item[f('volume_spike_flag')]   === 'yes';
    const squeeze= item[f('ribbon_compression')]  === 'yes';
    const sigConf= (item[f('signal_confidence')] || '').toLowerCase();

    if (sig) score += 3;
    if (conf.includes('buy') || conf.includes('sell')) score += 2;
    if (align.includes('triple')) score += 2;
    if (volSpk)  score += 2;
    if (isFastMa(sig)) score += 2;
    if (sigConf === 'high') score += 1;
    if (squeeze) score += 1;
    if ((conf.includes('buy')  && trend === 'uptrend')  ||
        (conf.includes('sell') && trend === 'downtrend')) score += 1;
    return score;
  }

  function renderMorningBrief() {
    const el = document.getElementById('morningBrief');
    if (!el || !allData.length) return;

    const top = allData
      .filter(d => d[f('primary_signal')])
      .map(d => ({ ...d, _score: confluenceScore(d) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, 5);

    if (!top.length) { el.style.display = 'none'; return; }
    el.style.display = '';

    const today = summaryData.date || new Date().toISOString().slice(0, 10);
    el.innerHTML = `
      <div class="mb-header">
        <span class="mb-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
          Morning Brief
        </span>
        <span class="mb-date">${today}</span>
      </div>
      <div class="mb-list">
        ${top.map(item => {
          const buy  = isBuy(item);
          const sell = isSell(item);
          const dir  = buy ? 'buy' : sell ? 'sell' : 'neutral';
          const sig  = item[f('primary_signal')] || '';
          const align= item[f('tf_alignment')] || '';
          const perf = signalPerf(item.instrument_name);
          const perfHtml = perf
            ? `<span class="mb-perf ${parseFloat(perf.pct) >= 0 ? 'perf-pos' : 'perf-neg'}">${parseFloat(perf.pct) >= 0 ? '+' : ''}${perf.pct}%</span>`
            : '';
          const bars = Math.min(item._score, 8);
          return `<div class="mb-item" data-act="openModal" data-arg="${item.instrument_name}">
            <div class="mb-item-left">
              <span class="mb-name">${item.instrument_name}</span>
              <span class="mb-group">${item.group || ''}</span>
            </div>
            <div class="mb-item-right">
              ${perfHtml}
              <span class="mb-sig tag-${dir}">${sig}</span>
              <div class="mb-score-bars">${Array.from({length:8},(_,i)=>`<span class="mb-bar ${i<bars?'mb-bar-filled mb-bar-'+dir:''}"></span>`).join('')}</div>
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }

  // ── Today's Opportunities ─────────────────────────────────────────────
  function renderTodayOpportunities() {
    const el = document.getElementById('todayOpps');
    if (!el || !allData.length) return;

    const signaled = allData
      .filter(d => d[f('primary_signal')])
      .map(d => ({ ...d, _score: confluenceScore(d) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, 8);

    if (!signaled.length) {
      el.innerHTML = '<div class="opp-empty">No signals found for this timeframe</div>';
      return;
    }

    el.innerHTML = signaled.map(item => {
      const name     = item.instrument_name;
      const buy      = isBuy(item);
      const sell     = isSell(item);
      const dir      = buy ? 'buy' : sell ? 'sell' : 'neutral';
      const sig      = item[f('primary_signal')] || '';
      const sigType  = ALL_SIGNAL_CODES.includes(sig) ? sig : '';
      const sigBadge = `badge-${sigClass(sig)}`;
      const price    = parseFloat(item[f('close')] || item.close) || 0;
      const priceStr = price === 0 ? '--' : price >= 1000
        ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : price.toFixed(price < 10 ? 4 : 2);
      const roc      = parseFloat(item[f('roc')] || item.roc || 0);
      const rocStr   = (roc >= 0 ? '▲ +' : '▼ ') + Math.abs(roc).toFixed(1) + '%';
      const rocDir   = roc >= 0 ? 'up' : 'dn';
      const align    = item[f('tf_alignment')] || '';
      const isTriple = align.includes('Triple') || align.includes('Quad');
      const tripleTag = isTriple ? ` · ${align}` : '';
      const bars     = Math.min(item._score, 8);
      const dirBadge = buy
        ? `<span class="opp-dir-badge opp-dir-buy">BUY</span>`
        : sell ? `<span class="opp-dir-badge opp-dir-sell">SELL</span>` : '';
      const noteInd  = noteIndicator(name);
      const tripleB  = isTriple
        ? `<span class="badge-3tf ${align.includes('Bull') ? 'badge-3tf-bull' : 'badge-3tf-bear'}">3TF</span>`
        : '';
      // Meaningful sparkbar heights: each bar maps to a real data dimension
      const maOrd = parseInt(item[f('ma_order_score')]);
      const sigStr = { p1:100, p2:80, p3:55, p4:35, '':15 }[sigClass(sigType)] || 15;
      const alignStr = align.toLowerCase().includes('triple') ? 100 : align.toLowerCase().includes('double') ? 65 : 35;
      const volH   = item[f('volume_spike_flag')] === 'yes' ? 95 : 25;
      const rocH   = Math.min(Math.round(Math.abs(roc) / 4 * 100), 95);
      const sqzH   = item[f('ribbon_compression')] === 'yes' ? 80 : 35;
      const confH  = { high:100, standard:60, low:28 }[(item[f('signal_confidence')]||'').toLowerCase()] || 20;
      const maH    = !isNaN(maOrd) ? Math.round(maOrd / 16 * 100) : 50;
      const REAL_HEIGHTS = [maH, sigStr, alignStr, volH, rocH || 30, sqzH, confH, Math.round(bars / 8 * 100)];
      const sparkbars = Array.from({ length: 8 }, (_, i) =>
        `<span class="opp-bar${i < bars ? ` opp-bar-filled opp-bar-${dir}` : ''}" style="height:${Math.max(REAL_HEIGHTS[i], 12)}%"></span>`
      ).join('');

      return `<div class="opp-card opp-card-${dir}" data-act="openModal" data-arg="${name}">
        <div class="opp-card-strip"></div>
        <div class="opp-card-body">
          <div class="opp-name">${name}${noteInd}</div>
          <div class="opp-group">${item.group || item.sector || ''}</div>
          <div class="opp-badges"><span class="feed-badge ${sigBadge}">${sigType}</span>${dirBadge}${tripleB}</div>
          <div class="opp-price">${priceStr}</div>
          <div class="opp-change ${rocDir}">${rocStr}${tripleTag}</div>
          <div class="opp-sparkbars">${sparkbars}</div>
        </div>
      </div>`;
    }).join('');
  }

  // ── Push Notifications ───────────────────────────────────────────────
  let swRegistration = null;

  async function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      swRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data && e.data.type === 'SIGNALS_CHECKED') updateSignalHistory();
      });
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

  function checkAndNotifyNewSignals() {
    if (!swRegistration || !allData.length) return;
    if (Notification.permission !== 'granted') return;
    const starred = [...userStarred];
    if (!starred.length) return;
    // Build lastSeen map from signalHistory
    const lastSeen = {};
    for (const [key, rec] of Object.entries(signalHistory)) {
      const name = key.replace(/_[A-Z0-9H]+$/, '');
      lastSeen[name] = { signal: rec.signal, conf: rec.conf };
    }
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
    return localStorage.getItem(sk('sp-push-enabled')) === '1' && Notification.permission === 'granted';
  }

  function updatePushBadgeUI() {
    const btn = document.getElementById('pushToggleBtn');
    if (!btn) return;
    const on = isPushEnabled();
    btn.classList.toggle('push-on', on);
    btn.title = on ? 'Notifications on — tap to disable' : 'Enable signal notifications';
    btn.innerHTML = on
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="3,3"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
  }

  // Default MA periods. Will be overwritten by auto-detection once data loads —
  // this makes the app work correctly across MA scheme changes without code edits.
  let detectedMaPeriods = [10,17,24,31,38,45,52,59,66,73,80,87,94,101,108];
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
      detectedMaPeriods = found.filter(p => p <= 200);   // ribbon MAs
      const macro = found.filter(p => p > 200);
      if (macro.length) detectedMacroMas = macro;
    }
  }

  // ── Timeframe field accessor ────────────────────────────────────────
  // Returns the correct field name for the active timeframe.
  // Weekly columns are prefixed with 'w_' in the data.
  function f(field) {
    if (timeframe === '4H') return 'h4_' + field;
    if (timeframe === 'W')  return 'w_' + field;
    if (timeframe === 'M')  return 'm_' + field;
    return field;
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
    if (tab === 'dashboard')  renderDashboard();
    else if (tab === 'scanner')  renderScanner();
    else if (tab === 'radar')    renderRadar();
    else if (tab === 'trends')   renderTrendsLazy();
    else if (tab === 'watchlist') renderWatchlist();
  }
  // ─────────────────────────────────────────────────────────────────────────

  function effectiveTrend(item) {
    const td = item[f('trend_direction')] || '';
    if (td === 'UPTREND' || td === 'DOWNTREND') return td;
    const cs = (item[f('confirmation_status')] || '').toLowerCase();
    if (cs.includes('uptrend') || cs.includes('rising ribbon')) return 'UPTREND';
    if (cs.includes('downtrend') || cs.includes('declining ribbon')) return 'DOWNTREND';
    return 'NEUTRAL';
  }

  // Compute summary stats client-side from the active timeframe fields
  function computeSummary() {
    const data = getActiveData();
    if (!data.length) return summaryData;

    const total = data.length;
    const trendCounts = {};
    let buyCount = 0, sellCount = 0, watchCount = 0, volumeSpikes = 0;
    const signalTypes = {};
    data.forEach(item => {
      const trend = effectiveTrend(item);
      trendCounts[trend] = (trendCounts[trend] || 0) + 1;

      const status = (item[f('confirmation_status')] || '').toLowerCase();
      if (status.includes('buy')) buyCount++;
      if (status.includes('sell')) sellCount++;

      if (item[f('watch_flag')]) watchCount++;
      if (item[f('volume_spike_flag')] === 'yes') volumeSpikes++;

      const sig = item[f('primary_signal')] || '';
      if (sig) signalTypes[sig] = (signalTypes[sig] || 0) + 1;
    });

    return {
      date: summaryData.date,
      fetched_at: summaryData.fetched_at,
      total,
      trend_counts: trendCounts,
      buy_count: buyCount,
      sell_count: sellCount,
      watch_count: watchCount,
      volume_spikes: volumeSpikes,
      signal_types: signalTypes,
      groups: summaryData.groups || [],
    };
  }

  const TV_ICON = `<svg class="tv-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

  // ── TradingView Helpers ──────────────────────────────────────────────
  function tvUrl(name) {
    const sym = tvMap[name] || name;
    const ivlMap = { 'D': '&interval=D', '4H': '&interval=240', 'W': '&interval=W', 'M': '&interval=M' };
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
    const ivl = timeframe === '4H' ? '240' : timeframe === 'W' ? 'W' : timeframe === 'M' ? 'M' : 'D';
    return `https://s.tradingview.com/widgetembed/?frameElementId=tradingview_widget&symbol=${encodeURIComponent(sym)}&interval=${ivl}&hidesidetoolbar=1&symboledit=0&saveimage=0&toolbarbg=f1f3f6&studies=%5B%5D&theme=${theme}&style=1&timezone=exchange&withdateranges=1&hide_top_toolbar=0&hide_legend=0&allow_symbol_change=0&details=0&calendar=0`;
  }

  // ── Theme ────────────────────────────────────────────────────────────
  const themeToggle = document.getElementById('themeToggle');
  const html = document.documentElement;
  const savedTheme = localStorage.getItem('swingpulse-theme') || 'dark';
  html.setAttribute('data-theme', savedTheme);

  const themeCycle = ['dark', 'midnight', 'light'];
  themeToggle.addEventListener('click', () => {
    const current = html.getAttribute('data-theme') || 'dark';
    const idx = themeCycle.indexOf(current);
    const next = themeCycle[(idx + 1) % themeCycle.length];
    html.setAttribute('data-theme', next);
    localStorage.setItem('swingpulse-theme', next);
    rebuildCharts();
  });

  // ── Timeframe Toggle ─────────────────────────────────────────────────
  const tfToggle = document.getElementById('tfToggle');
  const savedTf = localStorage.getItem('swingpulse-tf') || 'D';
  timeframe = savedTf;
  tfToggle.querySelectorAll('.tf-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tf === timeframe);
  });

  function setTimeframe(tf) {
    if (tf === timeframe) return;

    // Preserve scroll + scanner pagination across TF switch so the user
    // doesn't get bounced to page 1 / scroll 0 every time they toggle.
    const savedScroll = window.scrollY;
    const savedPage   = scannerPage;
    timeframe = tf;
    localStorage.setItem('swingpulse-tf', timeframe);
    tfToggle.querySelectorAll('.tf-btn').forEach(b => b.classList.toggle('active', b.dataset.tf === timeframe));

    renderAll();
    if (savedPage > 1) {
      scannerPage = savedPage;
      buildScannerCards(false, { keepPage: true });
    }
    window.scrollTo(0, savedScroll);
  }

  tfToggle.addEventListener('click', e => {
    const btn = e.target.closest('.tf-btn');
    if (!btn) return;
    setTimeframe(btn.dataset.tf);
  });

  // Debounce helper — avoids re-rendering on every single keystroke
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // Track which lazy tabs need a re-render (set dirty after every data refresh)
  const tabDirty = { trends: true, radar: true };

  function renderAll() {
    renderDashboard();
    renderScanner();
    renderWatchlist();
    // Mark lazy tabs dirty so they re-render on next visit
    tabDirty.trends = true;
    tabDirty.radar  = true;
    // If the user is already on a lazy tab (e.g. background refresh), render it now
    if (currentTab === 'trends') renderTrendsLazy();
    if (currentTab === 'radar')  renderRadarLazy();
  }

  function renderTrendsLazy() {
    if (!tabDirty.trends) return;
    tabDirty.trends = false;
    buildTrendsCards();
  }

  function renderRadarLazy() {
    if (!tabDirty.radar) return;
    tabDirty.radar = false;
    renderRadar();
  }

  // ── Navigation ───────────────────────────────────────────────────────
  const navTabs = document.querySelectorAll('.nav-tab');
  const panes = document.querySelectorAll('.tab-pane');

  function doTabSwitch(btn) {
    const tab = btn.dataset.tab;
    navTabs.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    panes.forEach(p => p.classList.remove('active'));
    document.getElementById('pane-' + tab).classList.add('active');
    currentTab = tab;
    // Lazy-render heavy tabs on first visit (or after data refresh)
    if (tab === 'trends') renderTrendsLazy();
    if (tab === 'radar')  renderRadarLazy();
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
  // ── iPhone Widget Install Sheet ───────────────────────────────────────
  (function wireWidgetSheet() {
    const overlay  = document.getElementById('widgetSheetOverlay');
    const openBtn  = document.getElementById('widgetInstallBtn');
    const closeBtn = document.getElementById('widgetSheetClose');
    const copyBtn  = document.getElementById('widgetCopyBtn');
    const copyLbl  = document.getElementById('widgetCopyLabel');
    const urlEl    = document.getElementById('widgetScriptUrl');
    if (!overlay || !openBtn) return;

    openBtn.addEventListener('click', () => overlay.classList.add('open'));
    if (closeBtn) closeBtn.addEventListener('click', () => overlay.classList.remove('open'));
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });

    if (copyBtn && urlEl) {
      copyBtn.addEventListener('click', () => {
        const url = urlEl.textContent.trim();
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(() => {
            copyBtn.classList.add('copied');
            if (copyLbl) copyLbl.textContent = 'Copied!';
            setTimeout(() => { copyBtn.classList.remove('copied'); if (copyLbl) copyLbl.textContent = 'Copy'; }, 2000);
          }).catch(() => fallbackCopy(url));
        } else {
          fallbackCopy(url);
        }
      });
    }

    function fallbackCopy(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { document.execCommand('copy'); } catch(e) {}
      document.body.removeChild(ta);
      if (copyBtn && copyLbl) {
        copyBtn.classList.add('copied');
        copyLbl.textContent = 'Copied!';
        setTimeout(() => { copyBtn.classList.remove('copied'); copyLbl.textContent = 'Copy'; }, 2000);
      }
    }
  })();

  document.getElementById('refreshBtn').addEventListener('click', async () => {
    const btn = document.getElementById('refreshBtn');
    btn.classList.add('spinning');
    try {
      await loadAll();
    } finally {
      btn.classList.remove('spinning');
    }
  });

  // ── Data Loading ─────────────────────────────────────────────────────
  async function loadAll() {
    try {
      const [sigRes, sumRes, tvRes, aiRes, trendsRes, explRes, evRes, namesRes, btRes, pfRes] = await Promise.all([
        fetch('/api/signals').then(r => r.json()),
        fetch('/api/summary').then(r => r.json()),
        fetch('/api/tv-map').then(r => r.json()).catch(() => ({})),
        fetch('/api/ai-instruments').then(r => r.json()).catch(() => []),
        fetch('/api/trends').then(r => r.json()).catch(() => ({})),
        fetch('/api/explanations').then(r => r.json()).catch(() => ({})),
        fetch('/api/events').then(r => r.json()).catch(() => ({ events: [] })),
        fetch('/api/names').then(r => r.json()).catch(() => ({})),
        fetch('/api/backtest').then(r => r.json()).catch(() => null),
        fetch('/api/portfolio?t=' + Date.now()).then(r => r.json()).catch(() => null),
      ]);
      allData = sigRes.data || [];
      detectMaPeriodsFromData(allData);   // auto-detect from actual data columns
      summaryData = sumRes;
      tvMap = tvRes || {};
      aiSet = new Set(aiRes || []);
      trendsData = trendsRes || {};
      explanationsData = explRes || {};
      eventsData = evRes.events || [];
      namesData = namesRes || {};
      backtestData = btRes;
      portfolioData = pfRes;

      const dateStr = sumRes.date || '--';
      let timeStr = '';
      if (sumRes.fetched_at) {
        const isISO = sumRes.fetched_at.includes('T');
        const d = isISO ? new Date(sumRes.fetched_at) : null;
        if (d && !isNaN(d.getTime())) {
          timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
          timeStr = sumRes.fetched_at.split(' ')[1] || '';
        }
      }
      document.getElementById('dateBadge').textContent = dateStr + (timeStr ? ' \u00B7 ' + timeStr : '');

      // Staleness warning: show banner if data date isn't today
      const _now      = new Date();
      const today     = _now.toISOString().slice(0, 10);
      const dayOfWeek = _now.getUTCDay(); // 0=Sun, 6=Sat
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const staleBanner = document.getElementById('staleBanner');
      const staleText   = document.getElementById('staleBannerText');
      if (staleBanner && dateStr !== '--' && dateStr !== today) {
        // On weekends the pipeline doesn't run — don't alarm the user
        const msg = isWeekend
          ? `Showing ${dateStr} data — markets are closed over the weekend`
          : `Data is from ${dateStr} — next update due within 4 hours`;
        staleText.textContent = msg;
        staleBanner.style.display = '';
      } else if (staleBanner) {
        staleBanner.style.display = 'none';
      }

      updateSignalHistory();
      checkAndNotifyNewSignals();
      renderAll();
    } catch (e) {
      console.error('Failed to load data:', e);
      document.getElementById('dateBadge').textContent = 'Error loading data';
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
    'WTI':     ['crude oil', 'crude', 'wti oil', 'oil futures'],
    'BRENT':   ['crude oil', 'crude', 'brent oil', 'oil futures'],
    'GOLD':    ['xau', 'gold futures'],
    'SILVER':  ['xag', 'silver futures'],
    'NATGAS':  ['natural gas', 'nat gas'],
    'COPPER':  ['copper futures'],
    'WHEAT':   ['wheat futures'],
    'CORN':    ['corn futures'],
    'BITCOIN': ['btc'],
    'ETHEREUM':['eth'],
  };

  function matchesSearch(item, query) {
    if (!query) return true;
    const q = query.toLowerCase().trim();
    const name = (item.instrument_name || '').toUpperCase();
    // AI shortcut — typing "ai" or "artificial" or "artificial intelligence" filters to AI universe
    if (q === 'ai' || 'artificial intelligence'.startsWith(q) && q.length >= 3) return isAI(item.instrument_name);
    // Check aliases first
    const aliases = SEARCH_ALIASES[name] || [];
    if (aliases.some(a => a.includes(q) || q.includes(a))) return true;
    return (
      (item.instrument_name || '').toLowerCase().includes(q) ||
      (namesData[item.instrument_name] || '').toLowerCase().includes(q) ||
      (item.group    || '').toLowerCase().includes(q) ||
      (item.sector   || '').toLowerCase().includes(q) ||
      (item.industry || '').toLowerCase().includes(q)
    );
  }

  // ── Signal code helpers (BP/SP system) ─────────────────────────────
  function sigClass(code) {
    if (!code) return '';
    if (code === 'BP1' || code === 'SP1') return 'p1';
    if (code === 'BP3' || code === 'SP3') return 'p2';
    if (code === 'BP2' || code === 'SP2') return 'p3';
    if (code === 'BP4' || code === 'SP4') return 'p4';
    return '';
  }
  function sigPriority(code) {
    if (code === 'BP1' || code === 'SP1') return 1;
    if (code === 'BP3' || code === 'SP3') return 2;
    if (code === 'BP2' || code === 'SP2') return 3;
    if (code === 'BP4' || code === 'SP4') return 4;
    return 5;
  }
  function isReversal(code) { return code === 'BP1' || code === 'SP1'; }
  function isLongestMa(code) { return code === 'BP3' || code === 'SP3'; }
  function isFastMa(code)    { return code === 'BP2' || code === 'SP2'; }
  function isKeyLevel(code)  { return code === 'BP4' || code === 'SP4'; }

  const ALL_SIGNAL_CODES = ['BP1','SP1','BP2','SP2','BP3','SP3','BP4','SP4'];

  function isBuy(item) {
    return (item[f('confirmation_status')] || '').toLowerCase().includes('buy');
  }
  function isSell(item) {
    return (item[f('confirmation_status')] || '').toLowerCase().includes('sell');
  }
  function isWatch(item) {
    return !!(item[f('watch_flag')]);
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
  // Helper: price position relative to a macro MA for the active timeframe
  function macroMaPos(item, period) {
    const close  = parseFloat(item[f('close')]);
    const maVal  = parseFloat(item[f(`ma_${period}`)]);
    if (!close || isNaN(close) || isNaN(maVal)) return null;
    return { close, maVal, pct: ((close - maVal) / maVal) * 100 };
  }

  // Is price above ALL available macro MAs on the active timeframe?
  function isMacroBull(item) {
    const avail = detectedMacroMas.map(p => macroMaPos(item, p)).filter(Boolean);
    return avail.length > 0 && avail.every(r => r.close > r.maVal);
  }
  // Is price below ALL available macro MAs on the active timeframe?
  function isMacroBear(item) {
    const avail = detectedMacroMas.map(p => macroMaPos(item, p)).filter(Boolean);
    return avail.length > 0 && avail.every(r => r.close < r.maVal);
  }

  function macroMaHtml(item) {
    const pills = detectedMacroMas.map(p => {
      const pos = macroMaPos(item, p);
      if (!pos) return '';
      const { pct } = pos;
      const near  = Math.abs(pct) <= 2;
      const above = pct >= 0;
      const cls   = near ? 'macro-near' : above ? 'macro-above' : 'macro-below';
      const arrow = near ? '~' : above ? '▲' : '▼';
      const label = p >= 1000 ? `MA${p/1000}k` : `MA${p}`;
      return `<span class="macro-ma-pill ${cls}">${arrow}${label} <span class="macro-ma-pct">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span></span>`;
    }).filter(Boolean).join('');
    return pills ? `<div class="macro-ma-row">${pills}</div>` : '';
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
    rows.innerHTML = Object.entries(sigs).map(([sig, s]) => {
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

    if (subEl && backtestData.generated_at) {
      subEl.textContent = `2% stop · 2:1 R:R · updated ${formatGeneratedAt(backtestData.generated_at)}`;
    }
  }

  // ── Portfolio Summary Card ─────────────────────────────────────────────
  function renderPortfolioCard() {
    const card  = document.getElementById('portfolioSummaryCard');
    const stats = document.getElementById('portfolioCardStats');
    if (!card || !stats) return;
    const pf = portfolioData || {};
    const xmPositions = pf.positions || [];
    if (!xmPositions.length) { card.style.display = 'none'; return; }
    card.style.display = '';

    const pfSumm = pf.summary || {};
    const equity = pfSumm.equity || 0;
    const floatPL = pfSumm.floating_pl || 0;
    const sym = 'R';

    const best  = xmPositions.reduce((a, b) => (a.profit || 0) > (b.profit || 0) ? a : b);
    const worst = xmPositions.reduce((a, b) => (a.profit || 0) < (b.profit || 0) ? a : b);

    stats.innerHTML = `
      <div class="port-stat">
        <span class="port-val">${xmPositions.length}</span>
        <span class="port-lbl">Open</span>
      </div>
      <div class="port-stat">
        <span class="port-val ${floatPL >= 0 ? 'port-pos' : 'port-neg'}">${floatPL >= 0 ? '+' : ''}${sym}${Math.abs(floatPL).toLocaleString('en',{minimumFractionDigits:2})}</span>
        <span class="port-lbl">Float P/L</span>
      </div>
      ${best.profit > 0 ? `<div class="port-stat">
        <span class="port-val port-pos">${best.item} +${sym}${best.profit.toFixed(2)}</span>
        <span class="port-lbl">Best</span>
      </div>` : ''}
      ${worst.profit < 0 && worst.item !== best.item ? `<div class="port-stat">
        <span class="port-val port-neg">${worst.item} -${sym}${Math.abs(worst.profit).toFixed(2)}</span>
        <span class="port-lbl">Worst</span>
      </div>` : ''}
    `;
  }

  function renderDashboard() {
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
    allData.forEach(d => { const a = d.tf_alignment || ''; if (a) alignCounts[a] = (alignCounts[a]||0)+1; });
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
    animateCount(document.getElementById('watchCount'), s.watch_count || 0);
    animateCount(document.getElementById('volumeCount'), s.volume_spikes || 0);

    renderTrackRecord();
    // renderTodayOpportunities(); — removed
    renderAlertBanner();
    rebuildCharts();
    renderConfidenceBreakdown();
    renderGroupPulse();
    renderHeatmap();
    renderAlignmentSummary();
    renderCompressionFeed();
    renderSignalFeed();
    renderMacroSrFeed();
    renderAIDashboardCard();
  }

  function renderAIDashboardCard() {
    const el = document.getElementById('aiUniverseCard');
    if (!el) return;

    const aiItems = allData.filter(d => isAI(d.instrument_name));
    if (!aiItems.length) { el.style.display = 'none'; return; }
    el.style.display = '';

    // Trend breakdown
    const up   = aiItems.filter(d => effectiveTrend(d) === 'UPTREND').length;
    const dn   = aiItems.filter(d => effectiveTrend(d) === 'DOWNTREND').length;
    const neu  = aiItems.length - up - dn;
    const upPct = Math.round(up / aiItems.length * 100);
    const dnPct = Math.round(dn / aiItems.length * 100);

    // Signals
    const confOrd = { high: 0, standard: 1, low: 2 };
    const buys    = aiItems.filter(d => isBuy(d));
    const sells   = aiItems.filter(d => isSell(d));
    const watches = aiItems.filter(d => d[f('watch_flag')]);
    const vols    = aiItems.filter(d => d[f('volume_spike_flag')] === 'yes');
    const extended = aiItems.filter(d => {
      const segs = trendsData[d.instrument_name] || [];
      if (!segs.length) return false;
      const cur = segs[0];
      const same = segs.filter(s => s.direction === cur.direction);
      const avg = same.length ? Math.round(same.reduce((a,s) => a+s.days,0)/same.length) : 0;
      return avg && Math.round(cur.days/avg*100) >= 150;
    }).length;

    // ── Sector groups ──
    const AI_SECTORS = {
      'Chips':      new Set(['NVDA','AMD','AVGO','ARM','MRVL','INTC','ON','QCOM','NXPI','STM','MPWR','AMBA','IFX']),
      'Semi Equip': new Set(['ASML','AMAT','LRCX','KLAC','ENTG','TER','TOKYOELEC','BESI','CDNS','SNPS']),
      'Cloud/Mega': new Set(['MSFT','GOOGL','GOOG','META','AMZN','TSLA','AAPL','SOFTBANK']),
      'Software':   new Set(['PLTR','SNOW','DDOG','NET','CRM','NOW','WDAY','INTU','ADBE','ORCL','SAP_DE','CRWD','PANW','ZS','APP']),
      'Hardware':   new Set(['SMCI','DELL','ANET','CSCO','IBM']),
      'Europe/Asia':new Set(['SIE','CAP_FR','DSY','ERICB','EXPN','RELX','LSEG','KEYENCE','FANUC']),
    };

    const sectorHtml = Object.entries(AI_SECTORS).map(([label, members]) => {
      const items = aiItems.filter(d => members.has(d.instrument_name));
      if (!items.length) return '';
      const sUp  = items.filter(d => effectiveTrend(d) === 'UPTREND').length;
      const sDn  = items.filter(d => effectiveTrend(d) === 'DOWNTREND').length;
      const sNeu = items.length - sUp - sDn;
      const sPct = Math.round(sUp / items.length * 100);
      return `<div class="ai-sector-row">
        <span class="ai-sector-name">${label}</span>
        <div class="ai-sector-bar">
          <div class="ai-sector-fill" style="width:${sPct}%"></div>
        </div>
        <span class="ai-sector-counts">
          <span style="color:var(--buy)">${sUp}↑</span>
          <span style="color:var(--sell)">${sDn}↓</span>
          ${sNeu ? `<span style="color:var(--text-muted)">${sNeu}–</span>` : ''}
        </span>
      </div>`;
    }).join('');

    // ── Tile grid — all AI instruments ──
    const sortedItems = [...aiItems].sort((a,b) => {
      const ta = effectiveTrend(a), tb = effectiveTrend(b);
      const order = { UPTREND:0, NEUTRAL:1, DOWNTREND:2 };
      if (order[ta] !== order[tb]) return order[ta] - order[tb];
      // Within same trend: buy signals first
      return (isBuy(b)?1:0) - (isBuy(a)?1:0);
    });

    const tilesHtml = sortedItems.map(item => {
      const td  = effectiveTrend(item);
      const buy = isBuy(item), sell = isSell(item);
      const vol = item[f('volume_spike_flag')] === 'yes';
      const tileCls = buy ? 'ai-tile-buy' : sell ? 'ai-tile-sell' : td === 'UPTREND' ? 'ai-tile-up' : td === 'DOWNTREND' ? 'ai-tile-dn' : 'ai-tile-neu';
      const arrow = td === 'UPTREND' ? '↑' : td === 'DOWNTREND' ? '↓' : '–';
      return `<div class="ai-tile ${tileCls}" data-arg="${item.instrument_name}" title="${item.instrument_name} — ${td}${buy?' · BUY':''}${vol?' · VOL':''}">
        <span class="ai-tile-name">${item.instrument_name}</span>
        <span class="ai-tile-arrow">${arrow}${vol?'⚡':''}</span>
      </div>`;
    }).join('');

    // ── Top signals leaderboard (buy + sell, conf sorted) ──
    const topSignals = [...buys, ...sells]
      .sort((a,b) => (confOrd[a[f('signal_confidence')]||'']??3) - (confOrd[b[f('signal_confidence')]||'']??3))
      .slice(0, el._aiExpanded ? 20 : 5);

    const leaderHtml = topSignals.length
      ? topSignals.map(item => {
          const conf = item[f('signal_confidence')] || '';
          const sig  = item[f('primary_signal')] || '';
          const td   = effectiveTrend(item);
          const buy  = isBuy(item);
          const confCls = conf === 'high' ? 'ai-conf-high' : conf === 'standard' ? 'ai-conf-std' : 'ai-conf-low';
          const vol  = item[f('volume_spike_flag')] === 'yes' ? '<span class="ai-vol-pip">VOL</span>' : '';
          const tdColor = td === 'UPTREND' ? 'var(--buy)' : td === 'DOWNTREND' ? 'var(--sell)' : 'var(--text-muted)';
          return `<div class="ai-inst-row" data-arg="${item.instrument_name}">
            <div class="ai-inst-left">
              <span class="ai-inst-name">${item.instrument_name}</span>
              <span class="ai-inst-group">${item.group||''}</span>
            </div>
            <div class="ai-inst-right">
              ${vol}
              <span class="ai-inst-trend" style="color:${tdColor}">${td==='UPTREND'?'↑':td==='DOWNTREND'?'↓':'–'}</span>
              <span class="ai-inst-sig" style="color:${buy?'var(--buy)':'var(--sell)'}">${sig}</span>
              <span class="ai-conf-pip ${confCls}">${conf||'–'}</span>
            </div>
          </div>`;
        }).join('')
      : `<div class="ai-card-empty">No active signals in AI universe</div>`;

    el.innerHTML = `
      <div class="ai-uc-header">
        <div class="ai-uc-title">
          <span class="ai-uc-icon">⬡</span>
          <span>AI Universe</span>
          <span class="ai-uc-count">${aiItems.length}</span>
        </div>
        <div class="ai-uc-meta">
          <span style="color:var(--buy)">↑ ${up}</span>
          <span style="color:var(--sell)">↓ ${dn}</span>
          <span style="color:var(--text-muted)">– ${neu}</span>
        </div>
      </div>

      <div class="ai-uc-ratio">
        <div class="ai-uc-bar-up" style="flex:${up||0}"></div>
        <div class="ai-uc-bar-neu" style="flex:${neu||0}"></div>
        <div class="ai-uc-bar-dn" style="flex:${dn||0}"></div>
      </div>
      <div class="ai-uc-ratio-lbl">
        <span style="color:var(--buy)">${upPct}% bullish</span>
        <span style="color:var(--sell)">${dnPct}% bearish</span>
      </div>

      <div class="ai-uc-signals">
        <div class="ai-sig-chip ai-sig-buy"><span>${buys.length}</span> Buy</div>
        <div class="ai-sig-chip ai-sig-sell"><span>${sells.length}</span> Sell</div>
        <div class="ai-sig-chip ai-sig-watch"><span>${watches.length}</span> Watch</div>
        <div class="ai-sig-chip ai-sig-vol"><span>${vols.length}</span> Vol</div>
        <div class="ai-sig-chip ai-sig-ext"><span>${extended}</span> Extended</div>
      </div>

      <div class="ai-uc-section-hdr">By Sector</div>
      <div class="ai-sector-list">${sectorHtml}</div>

      <div class="ai-uc-section-hdr">Instrument Map</div>
      <div class="ai-tile-grid">${tilesHtml}</div>

      <div class="ai-uc-list-hdr">
        <span>Active Signals</span>
        ${(buys.length + sells.length) > 5 ? `<button class="ai-expand-btn" id="aiExpandBtn">${el._aiExpanded ? 'Show less' : 'Show all ' + (buys.length+sells.length)}</button>` : ''}
      </div>
      <div class="ai-inst-list">${leaderHtml}</div>
    `;

    el.querySelectorAll('[data-arg]').forEach(r =>
      r.addEventListener('click', () => openModal(r.dataset.arg))
    );
    const expandBtn = el.querySelector('#aiExpandBtn');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        el._aiExpanded = !el._aiExpanded;
        renderAIDashboardCard();
      });
    }
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
    'Commodity':'Commodities','Crypto':'Crypto','Forex':'Forex',
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
    const INDEX_GROUPS = new Set(['Asia Index','CA Index','EU Index','US Index']);
    const dimMap = {};
    for (const item of allData) {
      const raw = item.group || 'Other';
      let key;
      if (gpViewMode === 'region') {
        key = GP_REGION_MAP[raw] || 'Other';
      } else {
        key = INDEX_GROUPS.has(raw) ? 'Indices' : raw;
      }
      if (!dimMap[key]) dimMap[key] = { bull: 0, bear: 0, neutral: 0, signals: 0 };
      const t = effectiveTrend(item);
      if      (t === 'UPTREND')   dimMap[key].bull++;
      else if (t === 'DOWNTREND') dimMap[key].bear++;
      else                        dimMap[key].neutral++;
      if (item[f('primary_signal')]) dimMap[key].signals++;
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
      return `
        <div class="gp-row ${dominant}${isActive}" data-gp-key="${name}">
          <div class="gp-name">${name}${sigDot}</div>
          <div class="gp-bar-wrap">
            <div class="gp-bar-bull" style="width:${bullPct}%"></div>
            <div class="gp-bar-neut" style="width:${neutPct}%"></div>
            <div class="gp-bar-bear" style="width:${bearPct}%"></div>
          </div>
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
      // Reversals first, then longest-MA bounces
      return sigPriority(a[f('primary_signal')]) - sigPriority(b[f('primary_signal')]);
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
      const lbl  = isReversal(sig) ? 'Trend Change' : 'Strong Signal';
      return `<div class="trend-alert-item ${dCls} ${pCls}" data-act="openModal" data-arg="${tick}">
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
        { code: 'M',  field: 'm_trend_direction',  label: 'M'  },
        { code: 'W',  field: 'w_trend_direction',  label: 'W'  },
        { code: 'D',  field: 'trend_direction',    label: 'D'  },
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
    const s = computeSummary();

    // TF badges
    const tfLabel = timeframe === '4H' ? '4H' : timeframe === 'W' ? 'Weekly' : timeframe === 'M' ? 'Monthly' : 'Daily';
    ['chartTfBadge1','chartTfBadge2','chartTfBadge3'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = tfLabel; el.dataset.tf = timeframe; }
    });

    Object.values(charts).forEach(ch => { if (ch && ch.destroy) ch.destroy(); });
    charts = {};
    Chart.defaults.color = c.text;
    Chart.defaults.borderColor = c.grid;

    // ── 1. Market Strength Gauge ─────────────────────────────────────
    renderGauge();

    // ── 2. Signal Breakdown — bucket per signal level (1=reversal, 4=key level) ─
    // Buy column counts BP* signals, Sell column counts SP* signals, grouped by level.
    const sigBuy  = { '1': 0, '2': 0, '3': 0, '4': 0 };
    const sigSell = { '1': 0, '2': 0, '3': 0, '4': 0 };
    allData.forEach(item => {
      const sig = item[f('primary_signal')] || '';
      if (!ALL_SIGNAL_CODES.includes(sig)) return;
      const cls = sigClass(sig);
      const level = cls.replace('p', '');
      if (!['1','2','3','4'].includes(level)) return;
      if (isBuy(item))       sigBuy[level]++;
      else if (isSell(item)) sigSell[level]++;
    });
    // Display labels: BP1/SP1 = "1 (Reversal)", BP3/SP3 = "3 (LongMA)", etc.
    const sigLabels = ['Reversal', 'LongMA', 'FastMA', 'KeyLvl'];
    const sigKeys   = ['1','2','3','4'];
    const barCtx = document.getElementById('signalBar').getContext('2d');
    charts.signalBar = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: sigLabels,
        datasets: [
          { label: 'Buy',  data: sigKeys.map(k => sigBuy[k]),  backgroundColor: 'rgba(16,185,129,.75)', hoverBackgroundColor: 'rgba(16,185,129,1)',  borderRadius: { topLeft:5, topRight:5 }, barPercentage:.55, categoryPercentage:.7 },
          { label: 'Sell', data: sigKeys.map(k => sigSell[k]), backgroundColor: 'rgba(239,68,68,.75)',  hoverBackgroundColor: 'rgba(239,68,68,1)',   borderRadius: { topLeft:5, topRight:5 }, barPercentage:.55, categoryPercentage:.7 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f172a', titleFont: { size: 12, weight: '700' },
            bodyFont: { size: 11 }, padding: 10, cornerRadius: 8,
            callbacks: {
              title: ctx => ctx[0].label + ' Signals',
              label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}`,
              afterBody: ctx => {
                const lbl = ctx[0].label;
                const b = sigBuy[lbl], sv = sigSell[lbl], total = b + sv;
                if (!total) return [];
                const bias = b > sv ? '🟢 Buy bias' : sv > b ? '🔴 Sell bias' : '⚪ Even split';
                return ['', `Total: ${total}`, bias];
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: c.text, font: { size: 11, weight: '700' } }, border: { color: c.grid } },
          y: { beginAtZero: true, grid: { color: c.grid }, ticks: { color: c.muted, font: { size: 10 }, stepSize: 1 }, border: { color: 'transparent' } },
        },
        onClick(e, els) {
          if (!els.length) return;
          const sigType  = sigLabels[els[0].index];
          const isBuyBar = els[0].datasetIndex === 0;
          const hint = document.getElementById('sigBarHint');

          // Flash feedback
          if (hint) {
            hint.textContent = `→ Filtering: ${isBuyBar ? 'Buy' : 'Sell'} ${sigType}`;
            hint.style.color = isBuyBar ? 'var(--buy)' : 'var(--sell)';
            setTimeout(() => { hint.textContent = 'Tap a bar → jump to Scanner tab'; hint.style.color = ''; }, 2000);
          }

          // Apply filter + navigate to scanner
          activeScannerFilter = sigType;
          // Update direction toggle
          const isBuyFilter = sigType === 'buy' || sigType.startsWith('BP');
          const isSellFilter = sigType === 'sell' || sigType.startsWith('SP');
          document.querySelectorAll('.sig-dir-btn').forEach(b => b.classList.remove('active'));
          if (isBuyFilter) document.querySelector('.sig-dir-btn[data-filter="buy"]')?.classList.add('active');
          else if (isSellFilter) document.querySelector('.sig-dir-btn[data-filter="sell"]')?.classList.add('active');
          else document.querySelector('.sig-dir-btn[data-filter="all"]')?.classList.add('active');
          // Activate signal type in sheet if applicable
          document.querySelectorAll('.sig-sheet-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === sigType));
          const sigBtn = document.getElementById('sigTypeBtn');
          if (sigBtn) sigBtn.classList.toggle('active', sigType.match(/^[BS]P\d$/));
          navigateToTab('scanner');
          buildScannerCards();
        },
        animation: { duration: 500 },
      },
    });

    // ── 3. Signals by Sector — clickable drill-down ───────────────────
    const sectorMap = {};
    allData.forEach(item => {
      const grp = item.group || 'Other';
      if (!sectorMap[grp]) sectorMap[grp] = { buy: 0, sell: 0, neutral: 0, items: [] };
      if (isBuy(item))       { sectorMap[grp].buy++;     sectorMap[grp].items.push({ ...item, _dir: 'buy' });  }
      else if (isSell(item)) { sectorMap[grp].sell++;    sectorMap[grp].items.push({ ...item, _dir: 'sell' }); }
      else                   { sectorMap[grp].neutral++; }
    });

    // Sort: groups with most signals first
    const sectorLabels = Object.keys(sectorMap).sort((a, b) => {
      const aScore = sectorMap[a].buy + sectorMap[a].sell;
      const bScore = sectorMap[b].buy + sectorMap[b].sell;
      return bScore - aScore;
    });

    const sectorCtx = document.getElementById('sectorChart').getContext('2d');
    charts.sector = new Chart(sectorCtx, {
      type: 'bar',
      data: {
        labels: sectorLabels,
        datasets: [
          { label: 'Buy',     data: sectorLabels.map(k => sectorMap[k].buy),     backgroundColor: 'rgba(16,185,129,.8)',  hoverBackgroundColor: 'rgba(16,185,129,1)',  borderRadius: 3, barPercentage:.65, categoryPercentage:.7 },
          { label: 'Sell',    data: sectorLabels.map(k => sectorMap[k].sell),    backgroundColor: 'rgba(239,68,68,.75)',  hoverBackgroundColor: 'rgba(239,68,68,1)',   borderRadius: 3, barPercentage:.65, categoryPercentage:.7 },
          { label: 'Neutral', data: sectorLabels.map(k => sectorMap[k].neutral), backgroundColor: 'rgba(71,85,105,.45)', hoverBackgroundColor: 'rgba(71,85,105,.7)',  borderRadius: 3, barPercentage:.65, categoryPercentage:.7 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: {
          legend: { display: true, position: 'bottom', labels: { color: c.text, usePointStyle: true, pointStyleWidth: 8, font: { size: 10 }, padding: 10 } },
          tooltip: {
            backgroundColor: '#0f172a', titleFont: { size: 11, weight: '700' },
            bodyFont: { size: 11 }, padding: 10, cornerRadius: 8,
            callbacks: {
              afterBody: ctx => {
                const grp = sectorLabels[ctx[0].dataIndex];
                const items = sectorMap[grp]?.items || [];
                const buys  = items.filter(i => i._dir === 'buy').map(i => i.instrument_name);
                const sells = items.filter(i => i._dir === 'sell').map(i => i.instrument_name);
                const lines = [];
                if (buys.length)  lines.push('🟢 ' + buys.slice(0,4).join(', ') + (buys.length > 4 ? '…' : ''));
                if (sells.length) lines.push('🔴 ' + sells.slice(0,4).join(', ') + (sells.length > 4 ? '…' : ''));
                return lines.length ? ['', ...lines] : [];
              }
            }
          }
        },
        scales: {
          x: { stacked: true, beginAtZero: true, grid: { color: c.grid }, ticks: { color: c.muted, font: { size: 10 } }, border: { color: 'transparent' } },
          y: { stacked: true, grid: { display: false }, ticks: { color: c.text, font: { size: 10 } }, border: { color: c.grid } },
        },
        onClick(e, els) {
          if (!els.length) return;
          const grp      = sectorLabels[els[0].index];
          const secData  = sectorMap[grp];
          const drill    = document.getElementById('sectorDrill');
          const sdName   = document.getElementById('sdName');
          const sdChips  = document.getElementById('sdChips');
          const sdClose  = document.getElementById('sdClose');

          // Toggle off if same group clicked again
          if (drill.style.display !== 'none' && sdName.dataset.grp === grp) {
            drill.style.display = 'none';
            return;
          }

          sdName.textContent = grp;
          sdName.dataset.grp = grp;

          const activeItems = secData.items;
          if (activeItems.length) {
            sdChips.innerHTML = activeItems.map(item =>
              `<span class="sd-chip sd-chip-${item._dir}" data-act="openModal" data-arg="${item.instrument_name}" data-stop="1">${item.instrument_name} ${item._dir === 'buy' ? '▲' : '▼'}</span>`
            ).join('');
          } else {
            sdChips.innerHTML = '<span style="color:var(--text-muted);font-size:.68rem">No active signals</span>';
          }

          drill.style.display = 'block';
          if (sdClose) sdClose.onclick = () => { drill.style.display = 'none'; };

          // Also navigate to Scanner filtered to this group
          navigateToTab('scanner');
          const groupSel = document.getElementById('scannerGroupFilter');
          if (groupSel) { groupSel.value = mapGroup(grp); updateFilterBadge(); buildScannerCards(); }
        },
        animation: { duration: 450 },
      },
    });
  }

  // ── Heatmap ──────────────────────────────────────────────────────────
  function renderHeatmap() {
    const groups = summaryData.groups || [];
    const filtersEl = document.getElementById('heatmapFilters');
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
    let filtered = activeHeatmapGroup === 'all' ? allData : allData.filter(d => d.group === activeHeatmapGroup);

    // ── Legend filter (only show that signal type) ──
    if (activeHmLegendFilter === 'buy')     filtered = filtered.filter(isBuy);
    else if (activeHmLegendFilter === 'sell')    filtered = filtered.filter(isSell);
    else if (activeHmLegendFilter === 'watch')   filtered = filtered.filter(isWatch);
    else if (activeHmLegendFilter === 'neutral') filtered = filtered.filter(d => !isBuy(d) && !isSell(d) && !isWatch(d));

    // ── Stat card filter (show only matching) ──
    if (activeStatFilter === 'buy')      filtered = filtered.filter(isBuy);
    else if (activeStatFilter === 'sell')     filtered = filtered.filter(isSell);
    else if (activeStatFilter === 'watch')    filtered = filtered.filter(isWatch);
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
      const watch = isWatch(item) ? 'hm-watch' : '';
      const finalCls = watch && cls === 'neutral' ? 'hm-watch' : hmCls;
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
          <button class="hm-detail-btn hm-star-btn star-btn ${userStarred.has(item.instrument_name) ? 'starred' : ''}" data-ticker="${item.instrument_name}" data-act="toggleStar" data-stop="1" title="${userStarred.has(item.instrument_name) ? 'Remove from watchlist' : 'Add to watchlist'}">
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

      const conf = item[f('signal_confidence')] || '';
      const confBadge = conf ? `<span class="badge-confidence conf-${conf}">${conf}</span>` : '';
      const align = item.tf_alignment || '';
      const alignBadge = align ? `<span class="badge-alignment ${alignCls(align)}">${align}</span>` : '';

      // ROC momentum
      const roc = parseFloat(item[f('roc')]);
      const rocStr = !isNaN(roc) ? (roc >= 0 ? '+' : '') + roc.toFixed(1) + '%' : '';
      const rocCls = !isNaN(roc) ? (roc >= 0 ? 'roc-pos' : 'roc-neg') : '';

      // MA order gauge
      const maOrder = parseInt(item[f('ma_order_score')]);
      const maMaxPairs = summaryData.ma_max_pairs || 14;
      const maOrderPct = !isNaN(maOrder) ? Math.round(maOrder / maMaxPairs * 100) : null;
      const maOrderColor = maOrderPct !== null ? (maOrderPct > 60 ? 'var(--buy)' : maOrderPct < 40 ? 'var(--sell)' : 'var(--watch)') : 'var(--border)';

      // Volume spike
      const volSpike = item[f('volume_spike_flag')] === 'yes';

      return `<div class="signal-feed-item feed-${buy ? 'buy' : 'sell'}" data-act="openModal" data-arg="${item.instrument_name}">
        <span class="feed-badge ${badgeCls}">${sig}</span>
        <div class="feed-info">
          <div class="feed-name">${item.instrument_name} ${confBadge} ${alignBadge} ${badge3TF(item)} ${volSpike ? '<span class="badge-confidence" style="background:var(--volume-soft);color:var(--volume)">VOL</span>' : ''}</div>
          <div class="feed-detail">${item[f('confirmation_status')] || ''}</div>
          <div class="feed-meta-row">
            ${rocStr ? `<span class="roc-val ${rocCls}" style="font-size:.68rem">ROC ${rocStr}</span>` : ''}
            ${rsiHtml(item[f('rsi')], {noLabel:false})}
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

    const order = ['Quad Bull', 'Triple Bull', 'Double Bull', 'Mixed', 'Counter-trend', 'Double Bear', 'Triple Bear', 'Quad Bear'];
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
          const trend = item[f('trend_direction')] || 'NEUTRAL';
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

  // ── Macro S/R Event Feed (Dashboard) ──────────────────────────────────
  function renderMacroSrFeed() {
    const card = document.getElementById('macroSrCard');
    const feed = document.getElementById('macroSrFeed');
    const countEl = document.getElementById('macroSrCount');
    if (!card || !feed) return;

    const touched = allData
      .filter(d => d.macro_sr_signal && d.macro_sr_signal !== '')
      .sort((a, b) => {
        const strDiff = (parseInt(b.macro_sr_strength) || 0) - (parseInt(a.macro_sr_strength) || 0);
        if (strDiff !== 0) return strDiff;
        if (a.macro_sr_signal !== b.macro_sr_signal) return a.macro_sr_signal === 'support' ? -1 : 1;
        return 0;
      });

    if (!touched.length) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';
    if (countEl) countEl.textContent = touched.length;

    const supCount       = touched.filter(d => d.macro_sr_signal === 'support').length;
    const resCount       = touched.filter(d => d.macro_sr_signal === 'resistance').length;
    const confluenceCount = touched.filter(d => (parseInt(d.macro_sr_strength) || 0) >= 3).length;

    // Summary pills — clickable to filter scanner
    const summaryEl = document.getElementById('macroSrSummary');
    if (summaryEl) {
      summaryEl.innerHTML =
        `<span class="macro-sr-sum-sup msr-sum-btn" data-msr-filter="macro_sr_sup" title="Show support touches in scanner">▲ ${supCount} support</span>` +
        `<span class="macro-sr-sum-res msr-sum-btn" data-msr-filter="macro_sr_res" title="Show resistance touches in scanner">▼ ${resCount} resist</span>` +
        (confluenceCount ? `<span class="macro-sr-sum-conf msr-sum-btn" data-msr-filter="confluence" title="Show ×3/×4 confluence events in scanner">⚡ ${confluenceCount} confluence</span>` : '');

      summaryEl.querySelectorAll('.msr-sum-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const fil = btn.dataset.msrFilter;
          // Route to scanner with chip filter active
          const chip = document.querySelector(`.sig-ctx-chip[data-filter="${fil === 'confluence' ? 'macro_sr_sup' : fil}"]`);
          if (chip) {
            activeScannerFilter = fil === 'confluence' ? 'macro_sr_sup' : fil;
            document.querySelectorAll('.sig-ctx-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
          }
          navigateToTab('scanner');
          buildScannerCards();
          updateScannerCtxStrip();
        });
      });
    }

    // Feed rows — clicking opens modal
    feed.innerHTML = touched.map(item => {
      const sig    = item.macro_sr_signal;
      const lvl    = item.macro_sr_level || '';
      const str    = parseInt(item.macro_sr_strength) || 0;
      const isSup  = sig === 'support';
      const isConf = str >= 4;
      const isMulti = str >= 3;

      const side = isSup
        ? `<span class="msr-side msr-sup">▲ SUP</span>`
        : `<span class="msr-side msr-res">▼ RES</span>`;

      const lvlBadge = isConf
        ? `<span class="msr-lvl msr-lvl-conf">⚡ ALL 4</span>`
        : isMulti
          ? `<span class="msr-lvl msr-lvl-multi">⚡ ${lvl} ×${str}</span>`
          : `<span class="msr-lvl">${lvl}</span>`;

      const close    = parseFloat(item.close);
      const priceStr = close && !isNaN(close) ? formatPrice(close) : '';
      const align    = item.tf_alignment || '';
      const alignBadge = align ? `<span class="msr-align ${alignCls(align)}">${align}</span>` : '';
      const rowCls   = isConf ? 'msr-row msr-row-conf' : isMulti ? 'msr-row msr-row-multi' : 'msr-row';

      return `<div class="${rowCls}" data-name="${item.instrument_name}">
        <div class="msr-left">
          ${side}
          <span class="msr-name">${item.instrument_name}</span>
          <span class="msr-group">${item.group || ''}</span>
        </div>
        <div class="msr-right">
          ${lvlBadge}
          ${priceStr ? `<span class="msr-price">${priceStr}</span>` : ''}
          ${alignBadge}
        </div>
      </div>`;
    }).join('');

    // Wire row clicks directly — more reliable than data-act delegation
    feed.querySelectorAll('.msr-row').forEach(row => {
      row.addEventListener('click', () => openModal(row.dataset.name));
    });
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
      const dir = order > 8 ? 'Bullish lean' : order < 8 ? 'Bearish lean' : 'Neutral';
      return `<div class="signal-feed-item" data-act="openModal" data-arg="${item.instrument_name}" style="border-left:3px solid var(--volume)">
        <span class="compression-alert">SQUEEZE</span>
        <div class="feed-info">
          <div class="feed-name">${item.instrument_name} ${tvBtn(item.instrument_name, '')}</div>
          <div class="feed-detail">Spread: ${spread ? spread.toFixed(1) : '--'}% | Order: ${isNaN(order) ? '--' : order}/14 | ${dir}</div>
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
  function signalAge(dateStr) {
    if (!dateStr) return { label: '', isToday: false, decayClass: '' };
    const d = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today - d) / 86400000);
    if (diffDays === 0) return { label: 'Today',           isToday: true,  decayClass: 'age-fresh'  };
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
    return a === 'Quad Bull' || a === 'Quad Bear' || a === 'Triple Bull' || a === 'Triple Bear';
  }
  function badge3TF(item) {
    if (!isTripleAligned(item)) return '';
    const a = item.tf_alignment || '';
    const bull = a.includes('Bull');
    const isQuad = a.startsWith('Quad');
    return `<span class="badge-3tf ${bull ? 'badge-3tf-bull' : 'badge-3tf-bear'}">${isQuad ? '4TF✓' : '3TF✓'}</span>`;
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
    const align = item.tf_alignment || '';
    const conf = item[f('signal_confidence')] || '';
    const volSpike = item[f('volume_spike_flag')] === 'yes';
    const compression = item[f('ribbon_compression')] === 'yes';
    const trendRun = parseInt(item[f('trend_run_days')]);
    const maLongest  = (summaryData && summaryData.ma_longest)   || 108;
    const maShortest = (summaryData && summaryData.ma_shortest)  || 10;
    const maFastMax  = (summaryData && summaryData.ma_fast_max)  || 66;
    const sigDesc = {
      BP1: `trend reversal — full ribbon cross up + close above MA${maLongest}`,
      SP1: `trend reversal — full ribbon cross down + close below MA${maLongest}`,
      BP2: `pullback bounce off fast MAs (${maShortest}–${maFastMax}) in uptrend`,
      SP2: `rejection at fast MAs (${maShortest}–${maFastMax}) in downtrend`,
      BP3: `bounce off MA${maLongest} (longest) in uptrend`,
      SP3: `rejection at MA${maLongest} (longest) in downtrend`,
      BP4: 'support bounce at key level in uptrend',
      SP4: 'rejection at key level in downtrend',
    };
    const dirWord = trend === 'UPTREND' ? 'bullish' : trend === 'DOWNTREND' ? 'bearish' : '';
    const parts = [`${sig}${dirWord ? ' ' + dirWord : ''}: ${sigDesc[sig] || 'signal'}`];
    if (!isNaN(trendRun) && trendRun > 0) parts.push(`${trendRun}d ${trend.toLowerCase()}`);
    if (align) parts.push(align);
    if (volSpike) parts.push('volume spike');
    if (compression) parts.push('ribbon compression — breakout watch');
    if (conf === 'high') parts.push('high confidence');
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
    if (!appendPage && !opts.keepPage) scannerPage = 1;  // reset to page 1 when filters change
    const grid = document.getElementById('scannerGrid');
    const summaryEl = document.getElementById('scannerSummary');
    const search = document.getElementById('scannerSearch').value.toLowerCase();
    const group = document.getElementById('scannerGroupFilter').value;
    const sector = document.getElementById('scannerSectorFilter').value;
    const trend = document.getElementById('scannerTrendFilter').value;
    const alignFilter = document.getElementById('scannerAlignFilter').value;
    const confFilter = document.getElementById('scannerConfFilter').value;
    const today = new Date(); today.setHours(0,0,0,0);

    let filtered = allData;
    if (search) filtered = filtered.filter(d => matchesSearch(d, search));
    if (group !== 'all')   filtered = filtered.filter(d => mapGroup(d.group) === group);
    // Region filter — set by clicking a region row on the By Region card
    if (activeRegionFilter) {
      filtered = filtered.filter(d => (GP_REGION_MAP[d.group] || 'Other') === activeRegionFilter);
    }
    if (sector !== 'all')  filtered = filtered.filter(d => d.sector === sector);
    if (trend !== 'all')   filtered = filtered.filter(d => d[f('trend_direction')] === trend);

    // ── Alignment filter ──
    if (alignFilter === 'bull')    filtered = filtered.filter(d => (d.tf_alignment||'').includes('Bull'));
    else if (alignFilter === 'bear')    filtered = filtered.filter(d => (d.tf_alignment||'').includes('Bear'));
    else if (alignFilter === 'counter') filtered = filtered.filter(d => d.tf_alignment === 'Counter-trend');
    else if (alignFilter === 'mixed')   filtered = filtered.filter(d => d.tf_alignment === 'Mixed');

    // ── Confidence filter ──
    if (confFilter === 'high')    filtered = filtered.filter(d => d[f('signal_confidence')] === 'high');
    else if (confFilter === 'highstd') filtered = filtered.filter(d => ['high','standard'].includes(d[f('signal_confidence')]));
    else if (confFilter === 'low') filtered = filtered.filter(d => d[f('signal_confidence')] === 'low');

    // ── RSI zone filter (uses active timeframe RSI) ──
    const rsiSel = document.getElementById('scannerRsiFilter');
    const rsiVal = rsiSel ? rsiSel.value : 'all';
    if (rsiVal !== 'all') {
      filtered = filtered.filter(d => rsiZone(d[f('rsi')]) === rsiVal);
    }

    // ── Macro MA filter (uses active timeframe via f()) ──
    const macroMaSel = document.getElementById('scannerMacroMaFilter');
    const macroMaVal = macroMaSel ? macroMaSel.value : 'all';
    if (macroMaVal !== 'all') {
      filtered = filtered.filter(item => {
        if (macroMaVal === 'above_all') return isMacroBull(item);
        if (macroMaVal === 'below_all') return isMacroBear(item);
        const [side, period] = macroMaVal.split('_');
        const pos = macroMaPos(item, parseInt(period));
        if (!pos) return false;
        if (side === 'above') return pos.close > pos.maVal;
        if (side === 'below') return pos.close < pos.maVal;
        if (side === 'near')  return Math.abs(pos.pct) <= 2;
        return true;
      });
    }

    // ── Chip filter (skip when user is searching by name) ──
    if (!search) {
      if (activeScannerFilter === 'buy')          filtered = filtered.filter(isBuy);
      else if (activeScannerFilter === 'sell')    filtered = filtered.filter(isSell);
      else if (activeScannerFilter === 'macro_bull') filtered = filtered.filter(isMacroBull);
      else if (activeScannerFilter === 'macro_bear') filtered = filtered.filter(isMacroBear);
      else if (activeScannerFilter === 'macro_sr_sup') filtered = filtered.filter(d => d.macro_sr_signal === 'support');
      else if (activeScannerFilter === 'macro_sr_res') filtered = filtered.filter(d => d.macro_sr_signal === 'resistance');
      else if (activeScannerFilter === 'squeeze') filtered = filtered.filter(d => d[f('ribbon_compression')] === 'yes');
      else if (activeScannerFilter === 'keylvl') filtered = filtered.filter(d => d.key_level_touched_today === 'yes');
      else if (activeScannerFilter === 'vol')    filtered = filtered.filter(d => d[f('volume_spike_flag')] === 'yes');
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
          const conf = d[f('signal_confidence')] || '';
          const align = d.tf_alignment || '';
          const t = d[f('trend_direction')] || '';
          const goodConf = conf === 'high' || conf === 'standard';
          const alignedBull = align.includes('Bull') && t === 'UPTREND';
          const alignedBear = align.includes('Bear') && t === 'DOWNTREND';
          return goodConf && (alignedBull || alignedBear);
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
    } else if (scannerSort === 'pct_1w_desc') {
      filtered = [...filtered].sort((a, b) => (parseFloat(b.pct_1w)||0) - (parseFloat(a.pct_1w)||0));
    } else if (scannerSort === 'pct_1w_asc') {
      filtered = [...filtered].sort((a, b) => (parseFloat(a.pct_1w)||0) - (parseFloat(b.pct_1w)||0));
    } else if (scannerSort === 'pct_1m_desc') {
      filtered = [...filtered].sort((a, b) => (parseFloat(b.pct_1m)||0) - (parseFloat(a.pct_1m)||0));
    } else if (scannerSort === 'pct_1m_asc') {
      filtered = [...filtered].sort((a, b) => (parseFloat(a.pct_1m)||0) - (parseFloat(b.pct_1m)||0));
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

    if (summaryEl) {
      summaryEl.innerHTML = filtered.length
        ? `<span class="sig-sum-total" data-sum-filter="all" title="Clear filters">${filtered.length} shown</span>` +
          (buyCount  ? `<span class="sig-sum-item sig-sum-buy" data-sum-filter="buy" title="Show only Buy">${buyCount} Buy</span>` : '') +
          (sellCount ? `<span class="sig-sum-item sig-sum-sell" data-sum-filter="sell" title="Show only Sell">${sellCount} Sell</span>` : '') +
          (sqzCount  ? `<span class="sig-sum-item sig-sum-sqz" data-sum-filter="squeeze" title="Show only Squeeze">${sqzCount} Squeeze</span>` : '') +
          (todayCount ? `<span class="sig-sum-item sig-sum-today" data-sum-filter="today" title="Show only Today">${todayCount} Today</span>` : '') +
          (klCount   ? `<span class="sig-sum-item" data-sum-filter="keylvl" title="Show only Key Level" style="background:var(--watch-soft);color:var(--watch)">${klCount} Key Lvl</span>` : '')
        : '';
    }

    if (!filtered.length) {
      grid.innerHTML = '<div class="scanner-empty">No instruments match</div>';
      return;
    }

    // ── Pagination: only render SCANNER_PAGE_SIZE × scannerPage cards at once ──
    const totalFiltered = filtered.length;
    const pageEnd = scannerPage * SCANNER_PAGE_SIZE;
    const visible = filtered.slice(0, pageEnd);
    const remaining = totalFiltered - visible.length;

    function makeCard(item, i) {
      const t = item[f('trend_direction')] || 'NEUTRAL';
      const sig = item[f('primary_signal')] || '';
      const conf = item[f('signal_confidence')] || '';
      const isBuySignal = isBuy(item);
      const isSellSignal = isSell(item);
      const stripCls = sig ? (isBuySignal ? 'strip-buy' : 'strip-sell') : '';
      const confLabel = conf === 'high' ? ' (HIGH)' : conf === 'low' ? ' (LOW)' : '';
      const stripLabel = sig ? (isBuySignal ? 'BUY ' + sig + confLabel : 'SELL ' + sig + confLabel) : '';
      const runDays = parseInt(item[f('trend_run_days')]) || 0;
      const barWidth = Math.min(runDays / 100 * 100, 100);
      const barColor = t === 'UPTREND' ? 'var(--buy)' : t === 'DOWNTREND' ? 'var(--sell)' : 'var(--neutral)';
      const compression = item[f('ribbon_compression')] === 'yes';
      const align = item.tf_alignment || '';
      const maOrder = parseInt(item[f('ma_order_score')]);
      const maMaxPairs = summaryData.ma_max_pairs || 14;
      const maOrderPct = !isNaN(maOrder) ? Math.round(maOrder / maMaxPairs * 100) : null;
      const roc = parseFloat(item[f('roc')]);
      const rocStr = !isNaN(roc) ? (roc >= 0 ? '+' : '') + roc.toFixed(1) + '%' : '';
      const starred = userStarred.has(item.instrument_name);
      const confBadge = conf ? `<span class="badge-confidence conf-${conf}">${conf}</span>` : '';
      const sigDate = item[f('last_signal_date')] || item[f('date')] || '';
      const age = signalAge(sigDate);
      const pct = pctFromMa(item);
      const macroBull = isMacroBull(item);
      const macroBear = isMacroBear(item);
      const macroSrSig = item.macro_sr_signal || '';
      const macroSrLvl = item.macro_sr_level || '';
      const macroSrStr = parseInt(item.macro_sr_strength) || 0;
      // Cap animation delay so the browser doesn't track hundreds of CSS timers
      const delay = Math.min(i, 30) * 20;

      function perfPill(val, label) {
        const v = parseFloat(val);
        if (isNaN(v)) return '';
        const cls = v >= 0 ? 'perf-pos' : 'perf-neg';
        const str = (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
        return `<span class="perf-pill ${cls}"><span class="perf-label">${label}</span>${str}</span>`;
      }
      const perfRow = [
        perfPill(item.pct_1d, '1D'),
        perfPill(item.pct_1w, '1W'),
        perfPill(item.pct_1m, '1M'),
        perfPill(item.pct_1y, '1Y'),
      ].filter(Boolean).join('');

      // Radar conviction chip — visible on every scanner card so you can rank
      // by conviction without leaving the scanner tab
      const _radarScore = radarConfluenceScore(item);
      const _radarTier  = scoreTier(_radarScore);
      const radarChip = `<span class="scanner-radar-chip radar-tier-${_radarTier}" title="Radar confluence: ${_radarScore}/100 — ${_radarTier}. Open card for breakdown.">${_radarScore}</span>`;

      const _aiScan = isAI(item.instrument_name);
      return `<div class="scanner-card pop-in${_aiScan ? ' ai-card' : ''}" style="animation-delay:${delay}ms" data-act="openModal" data-arg="${item.instrument_name}">
        ${stripLabel ? `<div class="scanner-signal-strip ${stripCls}">${stripLabel}</div>` : ''}
        <div class="scanner-top">
          <div>
            <div class="scanner-name">${item.instrument_name}${noteIndicator(item.instrument_name)}${compression ? ' <span class="compression-alert">SQZ</span>' : ''}${item[f('volume_spike_flag')] === 'yes' ? ' <span class="vol-spike-indicator">VOL</span>' : ''}</div>
            ${instName(item.instrument_name) ? `<div class="inst-fullname">${instName(item.instrument_name)}</div>` : ''}
            ${_aiScan ? '<div><span class="ai-label">Artificial Intelligence</span></div>' : ''}
            <div class="scanner-group">${item.group || ''}${item.sector ? ' / ' + item.sector : ''}</div>
          </div>
          <div class="scanner-actions">
            ${radarChip}
            ${tvBtn(item.instrument_name, '')}
            ${shareBtn(item.instrument_name)}
            <button class="star-btn ${starred ? 'starred' : ''}" data-ticker="${item.instrument_name}" title="${starred ? 'Remove from watchlist' : 'Add to watchlist'}" data-act="toggleStar" data-stop="1">★</button>
          </div>
        </div>
        <div class="scanner-price" style="color:${isBuySignal ? 'var(--buy)' : isSellSignal ? 'var(--sell)' : 'inherit'}">${formatPrice(item[f('close')])}${pct !== null ? ` <span class="roc-val ${pct >= 0 ? 'roc-pos' : 'roc-neg'}" style="font-size:.7rem">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span>` : ''}${rocStr ? ` <span class="roc-val ${roc >= 0 ? 'roc-pos' : 'roc-neg'}" style="font-size:.7rem">${rocStr}</span>` : ''}</div>
        ${(() => { const p = signalPerf(item.instrument_name); return p ? `<div class="scanner-since-sig ${parseFloat(p.pct)>=0?'perf-pos':'perf-neg'}" title="Since ${p.signal} signal on ${p.date}">Since ${p.signal}: ${parseFloat(p.pct)>=0?'+':''}${p.pct}% · ${p.days}d</div>` : ''; })()}
        ${perfRow ? `<div class="perf-row">${perfRow}</div>` : ''}
        ${(() => {
          // Build prioritized badge list — trend tag always shown, then top 4 by priority
          const extras = [];
          const push = (p, html) => { if (html) extras.push({ p, html }); };
          push(100, sig ? `<span class="sig-badge ${sigClass(sig)}">${sig}</span>` : '');
          // Macro SR confluence is the most actionable rare signal — surface above conf/align
          if (macroSrSig === 'support') {
            if (macroSrStr >= 4)      push(98, `<span class="scanner-tag macro-sr-badge macro-sr-confluence-sup" title="ALL 4 macro MAs tested as support simultaneously">⚡ CONFLUENCE SUP</span>`);
            else if (macroSrStr >= 3) push(95, `<span class="scanner-tag macro-sr-badge macro-sr-multi-sup" title="${macroSrStr} macro MAs tested as support simultaneously">⚡ SUP ×${macroSrStr}</span>`);
            else                      push(70, `<span class="scanner-tag macro-sr-badge macro-sr-touch-sup" title="Today's low tested ${macroSrLvl} as support">SUP ${macroSrLvl}</span>`);
          }
          if (macroSrSig === 'resistance') {
            if (macroSrStr >= 4)      push(98, `<span class="scanner-tag macro-sr-badge macro-sr-confluence-res" title="ALL 4 macro MAs tested as resistance simultaneously">⚡ CONFLUENCE RES</span>`);
            else if (macroSrStr >= 3) push(95, `<span class="scanner-tag macro-sr-badge macro-sr-multi-res" title="${macroSrStr} macro MAs tested as resistance simultaneously">⚡ RES ×${macroSrStr}</span>`);
            else                      push(70, `<span class="scanner-tag macro-sr-badge macro-sr-touch-res" title="Today's high tested ${macroSrLvl} as resistance">RES ${macroSrLvl}</span>`);
          }
          push(85, confBadge);
          push(80, align ? `<span class="scanner-tag badge-alignment ${alignCls(align)}">${align}</span>` : '');
          push(75, badge3TF(item));
          push(65, macroBull ? '<span class="scanner-tag macro-sr-badge macro-sr-bull" title="Price above all macro MAs">MACRO BULL</span>' : '');
          push(65, macroBear ? '<span class="scanner-tag macro-sr-badge macro-sr-bear" title="Price below all macro MAs">MACRO BEAR</span>' : '');
          push(60, item[f('volume_spike_flag')] === 'yes' ? '<span class="scanner-tag" style="background:var(--volume-soft);color:var(--volume)">VOL SPIKE</span>' : '');
          push(55, compression ? '<span class="scanner-tag" style="background:var(--volume-soft);color:var(--volume)">SQUEEZE</span>' : '');
          push(50, item.key_level_touched_today === 'yes' ? '<span class="scanner-tag" style="background:var(--watch-soft);color:var(--watch)">KEY LVL</span>' : '');
          push(40, age.label ? `<span class="sig-age ${age.decayClass}">${age.label}</span>` : '');
          push(35, trendMaturityBadge(item));
          push(30, runDays > 0 ? `<span class="scanner-tag" style="background:var(--accent-glow);color:var(--accent)">${runDays}d run</span>` : '');
          extras.sort((a, b) => b.p - a.p);
          const MAX = 4;
          const visible = extras.slice(0, MAX).map(b => b.html).join('');
          const overflow = extras.length > MAX
            ? `<span class="scanner-tag scanner-overflow" title="Open card to see all signals">+${extras.length - MAX}</span>`
            : '';
          return `<div class="scanner-meta">
            <span class="scanner-tag ${trendTag(t)}">${t}</span>
            ${visible}${overflow}
          </div>`;
        })()}
        ${maOrderPct !== null ? `<div class="ma-order-gauge">
          <span style="font-size:.6rem;color:var(--text-muted)">MA Order</span>
          <div class="ma-order-track"><div class="ma-order-fill" style="width:${maOrderPct}%;background:${maOrderPct > 60 ? 'var(--buy)' : maOrderPct < 40 ? 'var(--sell)' : 'var(--watch)'}"></div></div>
          <span style="font-size:.6rem">${maOrder}/${maMaxPairs}</span>
        </div>` : ''}
        ${rsiHtml(item[f('rsi')], {noLabel:false})}
        ${macroMaHtml(item)}
        <div class="scanner-mini-bar" style="background:var(--border)">
          <div class="scanner-mini-bar-inner" style="width:${barWidth}%;background:${barColor}"></div>
        </div>
      </div>`;
    }

    const cardsHtml = visible.map((item, i) => makeCard(item, i)).join('');
    const loadMoreHtml = remaining > 0
      ? `<div class="scanner-load-more" id="scannerLoadMore">
           <button class="scanner-load-more-btn">Show ${Math.min(remaining, SCANNER_PAGE_SIZE)} more <span style="opacity:.6">(${remaining} remaining)</span></button>
         </div>`
      : '';

    if (appendPage) {
      // Remove old "load more" row before appending
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

  document.getElementById('scannerSearch').addEventListener('input', debounce(() => buildScannerCards(), 150));
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
    buildScannerCards();
  });

  // ── Context chips (Best, Today, Squeeze, Key Lvl, Vol Spike) ──
  document.querySelector('.sig-ctx-row').addEventListener('click', e => {
    const chip = e.target.closest('.sig-ctx-chip');
    if (!chip || chip.id === 'sigMoreFiltersBtn' || chip.id === 'sigTypeBtn') return;
    const wasActive = chip.classList.contains('active');
    // Deactivate all context chips (except filters btn & signal btn)
    document.querySelectorAll('.sig-ctx-chip:not(#sigMoreFiltersBtn):not(#sigTypeBtn)').forEach(c => c.classList.remove('active'));
    // Also reset direction toggle to All
    document.querySelectorAll('.sig-dir-btn').forEach(b => b.classList.remove('active'));
    if (wasActive) {
      // Toggle off → back to All
      document.querySelector('.sig-dir-btn[data-filter="all"]').classList.add('active');
      activeScannerFilter = 'all';
    } else {
      chip.classList.add('active');
      document.querySelector('.sig-dir-btn[data-filter="all"]').classList.add('active');
      activeScannerFilter = chip.dataset.filter;
    }
    buildScannerCards();
  });

  // ── Summary stat pills → tap to apply the matching filter ──
  // Reuses the existing chip/toggle wiring by triggering their click handlers.
  document.getElementById('scannerSummary').addEventListener('click', e => {
    const pill = e.target.closest('[data-sum-filter]');
    if (!pill) return;
    const filter = pill.dataset.sumFilter;
    // 'buy'/'sell'/'all' live on the direction toggle; the rest are context chips
    const target = document.querySelector(`.sig-dir-btn[data-filter="${filter}"]`)
                || document.querySelector(`.sig-ctx-chip[data-filter="${filter}"]`);
    if (target) target.click();
  });

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
    const selects = ['scannerGroupFilter','scannerSectorFilter','scannerTrendFilter','scannerAlignFilter','scannerConfFilter','scannerMacroMaFilter','scannerRsiFilter'];
    let count = selects.filter(id => document.getElementById(id).value !== 'all').length;
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
    const upCount    = starred.filter(d => d[f('trend_direction')] === 'UPTREND').length;
    if (statsEl) {
      statsEl.innerHTML = starred.length
        ? `<span class="sig-sum-total">${starred.length} starred</span>` +
          (withSignal ? `<span class="sig-sum-item sig-sum-buy">${withSignal} signal</span>` : '') +
          (upCount    ? `<span class="sig-sum-item" style="background:rgba(16,185,129,.15);color:var(--buy)">${upCount} uptrend</span>` : '')
        : '';
    }

    // Empty watchlist
    if (!starred.length) {
      listEl.innerHTML = `<div class="wl-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".3"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <p>Tap ★ on any instrument in the Scanner tab to track it here</p>
      </div>`;
      return;
    }

    // Apply filter
    let filtered = starred;
    if (wlFilter === 'buy')     filtered = filtered.filter(isBuy);
    else if (wlFilter === 'sell')    filtered = filtered.filter(isSell);
    else if (wlFilter === 'signal')  filtered = filtered.filter(d => !!(d[f('primary_signal')]));
    else if (wlFilter === 'uptrend') filtered = filtered.filter(d => d[f('trend_direction')] === 'UPTREND');

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
      filtered = [...filtered].sort((a, b) => (tOrd[a[f('trend_direction')]] ?? 1) - (tOrd[b[f('trend_direction')]] ?? 1));
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
      const t    = item[f('trend_direction')] || 'NEUTRAL';
      const sig  = item[f('primary_signal')] || '';
      const conf = item[f('signal_confidence')] || '';
      const buy  = isBuy(item), sell = isSell(item);
      const roc  = parseFloat(item[f('roc')]);
      const rocStr = !isNaN(roc) ? (roc >= 0 ? '+' : '') + roc.toFixed(1) + '%' : '';
      const age  = signalAge(item.signal_date || item.date || '');
      const align = item.tf_alignment || '';
      const stripCls   = sig ? (buy ? 'strip-buy' : 'strip-sell') : '';
      const stripLabel = sig ? (buy ? 'BUY ' + sig : 'SELL ' + sig) : '';
      const hasAlert = !!(item[f('potential_turning_point_flag')] || item[f('watch_flag')] ||
                          item.key_level_touched_today === 'yes' || item[f('volume_spike_flag')] === 'yes');
      const _aiWl = isAI(item.instrument_name);
      return `<div class="wl-card${_aiWl ? ' ai-card' : ''}" data-act="openModal" data-arg="${item.instrument_name}">
        ${stripLabel ? `<div class="scanner-signal-strip ${stripCls}">${stripLabel}</div>` : ''}
        <div class="wl-card-top">
          <div class="wl-card-left">
            <span class="wl-card-name">${item.instrument_name} ${noteIndicator(item.instrument_name)}</span>
            ${instName(item.instrument_name) ? `<span class="inst-fullname">${instName(item.instrument_name)}</span>` : ''}
            ${_aiWl ? '<span class="ai-label">Artificial Intelligence</span>' : ''}
            <span class="wl-card-group">${item.group || ''}${item.sector ? ' · ' + item.sector : ''}</span>
          </div>
          <div class="wl-card-right">
            <span class="wl-card-price">${formatPrice(item[f('close')])}${rocStr ? ` <span class="roc-val ${roc >= 0 ? 'roc-pos' : 'roc-neg'}">${rocStr}</span>` : ''}</span>
            ${(() => { const p = signalPerf(item.instrument_name); return p ? `<span class="wl-signal-perf ${parseFloat(p.pct)>=0?'perf-pos':'perf-neg'}" title="Since ${p.signal} signal on ${p.date}">${parseFloat(p.pct)>=0?'+':''}${p.pct}% · ${p.days}d</span>` : ''; })()}
            <div class="scanner-actions">
              ${tvBtn(item.instrument_name, '')}
              ${shareBtn(item.instrument_name)}
              <button class="star-btn starred" data-ticker="${item.instrument_name}" title="Remove from watchlist" data-act="toggleStar" data-stop="1">★</button>
            </div>
          </div>
        </div>
        <div class="wl-card-badges">
          <span class="scanner-tag ${trendTag(t)}">${t}</span>
          ${align ? `<span class="scanner-tag badge-alignment ${alignCls(align)}">${align}</span>` : ''}
          ${conf ? `<span class="badge-confidence conf-${conf}">${conf}</span>` : ''}
          ${badge3TF(item)}
          ${age.label ? `<span class="sig-age ${age.decayClass}">${age.label}</span>` : ''}
          ${hasAlert ? `<span class="scanner-tag" style="background:var(--accent-glow);color:var(--accent)">⚡ Alert</span>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  function renderWlAlerts() {
    const allData = getActiveData(); // respect AI filter
    const listEl = document.getElementById('wlAlertsList');
    if (!listEl) return;

    const turning = allData.filter(d => d[f('potential_turning_point_flag')]);
    const watch   = allData.filter(d => d[f('watch_flag')]);
    const keylvl  = allData.filter(d => d.key_level_touched_today === 'yes');
    const vol     = allData.filter(d => d[f('volume_spike_flag')] === 'yes');

    // Update count badges
    const updBadge = (id, arr) => { const e = document.getElementById(id); if (e) e.textContent = arr.length ? `(${arr.length})` : ''; };
    updBadge('cntTurning', turning); updBadge('cntWatch', watch);
    updBadge('cntKeyLvl', keylvl);  updBadge('cntVol', vol);

    const datasets = { turning, watch, keylvl, vol };
    const active   = datasets[activeAlertTab] || turning;
    const emptyMsg = { turning: 'No turning points today', watch: 'No watch flags today',
                       keylvl: 'No key level touches today', vol: 'No volume spikes today' };

    if (!active.length) {
      listEl.innerHTML = `<div class="wl-empty">${emptyMsg[activeAlertTab]}</div>`;
      return;
    }

    listEl.innerHTML = active.map(item => {
      const t       = item[f('trend_direction')] || 'NEUTRAL';
      const sig     = item[f('primary_signal')] || '';
      const buy     = isBuy(item), sell = isSell(item);
      const starred = userStarred.has(item.instrument_name);
      let detail = '';
      if (activeAlertTab === 'turning') detail = item[f('potential_turning_point_flag')];
      else if (activeAlertTab === 'watch')  detail = item[f('watch_flag')];
      else if (activeAlertTab === 'keylvl') detail = `${item.key_level_type || ''} @ ${formatPrice(item.key_level_price)}`;
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
          <button class="star-btn ${starred ? 'starred' : ''}" data-ticker="${item.instrument_name}" title="${starred ? 'Remove' : 'Add to watchlist'}" data-act="toggleStar" data-stop="1">★</button>
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

  let trSheetFilter = 'all';   // 'all' | 'BP1' | 'SP1' | 'BP2' | 'SP2' | 'BP3' | 'SP3' | 'BP4' | 'SP4'

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
    modal.addEventListener('touchstart', e => {
      swipeStartY = e.touches[0].clientY;
    }, { passive: true });
    modal.addEventListener('touchend', e => {
      const dy = e.changedTouches[0].clientY - swipeStartY;
      if (dy > 80) closeModal();
    }, { passive: true });
  })();

  function closeModal() {
    overlay.classList.remove('open');
    if (charts.modal)   { charts.modal.destroy();  delete charts.modal; }
    if (charts.modalLw) { charts.modalLw.remove(); delete charts.modalLw; }
  }

  async function openModal(name) {
    const item = allData.find(d => d.instrument_name === name);
    if (!item) return;

    const similar     = findSimilarSetups(item);
    const explanation = explanationsData[name] || '';
    const existingNote= (instrumentNotes[name] || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const buy = isBuy(item);
    const sell = isSell(item);
    const sig = item[f('primary_signal')] || '';
    const conf = item[f('signal_confidence')] || '';
    const sigColor = buy ? 'var(--buy)' : sell ? 'var(--sell)' : 'var(--neutral)';
    const levels = parseKeyLevels(item.key_levels_all);
    const close = parseFloat(item[f('close')]);
    const maPrefix = timeframe === 'M' ? 'm_ma_' : timeframe === 'W' ? 'w_ma_' : timeframe === '4H' ? 'h4_ma_' : 'ma_';
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
      ? _rBd.lines.map(l => `<div class="mh-rs-line"><span class="mh-rs-lbl">${l.label}</span><span class="mh-rs-pts">+${l.points}</span></div>`).join('')
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
              <button class="mh-star star-btn ${userStarred.has(item.instrument_name) ? 'starred' : ''}" data-ticker="${item.instrument_name}" data-act="toggleStar" data-stop="1" title="${userStarred.has(item.instrument_name) ? 'Remove from watchlist' : 'Add to watchlist'}">★</button>
              <div class="mh-name">${item.instrument_name}</div>
            </div>
            <div class="mh-group-lbl">${item.group || ''}${item.sector ? ' · ' + item.sector : ''}</div>
          </div>
          <div class="mh-sig-wrap">
            ${sig ? `<div class="mh-sig-badge${buy ? ' buy' : sell ? ' sell' : ''}">${buy ? 'BUY' : 'SELL'} ${sig}${item[f('volume_spike_flag')] === 'yes' ? ' <span class="vol-plus-chip">VOL+</span>' : ''}</div>` : ''}
            ${conf ? `<div class="mh-sig-conf">${conf} confidence</div>` : ''}
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
        <button class="mh-tab" data-panel="chart">Chart</button>
        <button class="mh-tab" data-panel="analysis">Analysis</button>
        <button class="mh-tab" data-panel="notes">Notes</button>
      </div>

      <!-- ===== OVERVIEW PANEL ===== -->
      <div class="mh-panel" id="mhPanel-overview">
        <div class="mg-grid">
          <div class="mg-tile">
            <div class="mg-label">Trend</div>
            <div class="mg-val${item[f('trend_direction')]==='UPTREND' ? ' buy' : item[f('trend_direction')]==='DOWNTREND' ? ' sell' : ''}">${item[f('trend_direction')] || 'N/A'}</div>
          </div>
          <div class="mg-tile">
            <div class="mg-label">Run ${timeframe==='M'?'Mo':timeframe==='W'?'Wk':'Days'}</div>
            <div class="mg-val">${item[f('trend_run_days')] || 0}</div>
          </div>
          <div class="mg-tile">
            <div class="mg-label">MA Position</div>
            <div class="mg-val" style="color:${ribbonColor}">${ribbonPct}%</div>
          </div>
          <div class="mg-tile">
            <div class="mg-label">Alignment</div>
            <div class="mg-val accent" style="font-size:.7rem;line-height:1.2">${item.tf_alignment || 'N/A'}</div>
          </div>
          <div class="mg-tile">
            <div class="mg-label">MA Order</div>
            <div class="mg-val">${item[f('ma_order_score')] || '--'}/${summaryData.ma_max_pairs || 14}</div>
          </div>
          <div class="mg-tile">
            <div class="mg-label">Momentum</div>
            <div class="mg-val ${parseFloat(item[f('roc')])>=0?'buy':'sell'}">${item[f('roc')] ? (parseFloat(item[f('roc')])>=0?'+':'')+parseFloat(item[f('roc')]).toFixed(1)+'%' : '--'}</div>
          </div>
          <div class="mg-tile">
            <div class="mg-label">RSI(14)</div>
            <div class="mg-val rsi-${rsiZone(item[f('rsi')])}">${item[f('rsi')] ? parseFloat(item[f('rsi')]).toFixed(1) : '--'}</div>
          </div>
        </div>

        ${radarBreakdownHtml}

        ${renderInstrumentTrackRecord(item.instrument_name)}

        <div class="mh-section">
          <div class="mh-section-title">MA Ribbon${item[f('ribbon_compression')]==='yes'?' <span class="compression-alert">SQUEEZE</span>':''}</div>
          <div class="ribbon-gauge">
            <div class="ribbon-gauge-track">
              <div class="ribbon-gauge-fill" style="width:${ribbonPct}%;background:${ribbonColor}"></div>
            </div>
            <div class="ribbon-gauge-labels">
              <span style="color:var(--sell)">Below all</span>
              <span style="color:${ribbonColor};font-weight:700">${ribbonPct}% · ${item[f('ribbon_spread')]||'--'}% spread</span>
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
              const sAge  = signalAge(s[f('last_signal_date')] || s[f('date')] || '');
              const sPerf = signalPerf(s.instrument_name);
              return `<div class="sim-card" data-act="openModal" data-arg="${s.instrument_name}" data-stop="1">
                <div class="sim-card-top"><span class="sim-card-name">${s.instrument_name}</span>${sSig?`<span class="feed-badge badge-${sigClass(sSig) || 'p4'}">${sSig}</span>`:''}</div>
                <div class="sim-card-group">${s.group||''}</div>
                <div class="sim-card-badges">
                  ${sAlign?`<span class="badge-alignment ${alignCls(sAlign)}" style="font-size:.58rem;padding:1px 5px">${sAlign}</span>`:''}
                  ${sConf?`<span class="badge-confidence conf-${sConf}" style="font-size:.58rem">${sConf}</span>`:''}
                  ${badge3TF(s)}${sAge.label?`<span class="sig-age ${sAge.decayClass}" style="font-size:.58rem">${sAge.label}</span>`:''}
                </div>
                <div class="sim-card-bottom"><span class="sim-card-price">${formatPrice(s[f('close')])}</span>${sPerf?`<span class="wl-signal-perf ${parseFloat(sPerf.pct)>=0?'perf-pos':'perf-neg'}" style="font-size:.58rem">${parseFloat(sPerf.pct)>=0?'+':''}${sPerf.pct}%</span>`:''}</div>
              </div>`;
            }).join('')}
          </div>
        </div>` : ''}
      </div>

      <!-- ===== CHART PANEL ===== -->
      <div class="mh-panel mh-panel-hidden" id="mhPanel-chart">
        ${timeframe === 'D' ? `
        <div class="modal-section">
          <div class="modal-section-title">Daily Chart · 100 days &nbsp;<span class="vol-spike-legend"><span class="vol-spike-dot"></span>Volume spike</span></div>
          <div class="modal-chart-wrap lw-chart-wrap lw-chart-wrap--tall" id="lwChartContainer"></div>
        </div>` : `
        <div class="modal-section">
          <div class="modal-section-title">MA Ribbon (${timeframe==='M'?'250 months':timeframe==='W'?'250 weeks':'250 periods'})</div>
          <div class="modal-chart-wrap"><canvas id="modalChart"></canvas></div>
        </div>`}
      </div>

      <!-- ===== ANALYSIS PANEL ===== -->
      <div class="mh-panel mh-panel-hidden" id="mhPanel-analysis">
        <div class="mh-section">
          <div class="mh-section-title">Signal Status</div>
          <div class="modal-status-card ${buy?'status-buy':sell?'status-sell':'status-neutral'}">
            <div class="status-main">${item[f('confirmation_status')]||'No confirmed signal'}${conf?` <span class="badge-confidence conf-${conf}">${conf}</span>`:''}</div>
            ${item[f('last_signal_type')]?`<div class="status-sub">Last: <strong>${item[f('last_signal_type')]}</strong> on ${item[f('last_signal_date')]} (${item[f('last_signal_days_ago')]}${timeframe==='M'?'m':timeframe==='W'?'w':'d'} ago)</div>`:''}
            ${item[f('volume_spike_flag')]==='yes'&&sig?`<div class="status-sub" style="color:var(--volume)">Volume spike on signal bar</div>`:''}
          </div>
        </div>

        <div class="mg-grid">
          <div class="mg-tile"><div class="mg-label">Open</div><div class="mg-val">${formatPrice(item[f('open')])}</div></div>
          <div class="mg-tile"><div class="mg-label">High</div><div class="mg-val buy">${formatPrice(item[f('high')])}</div></div>
          <div class="mg-tile"><div class="mg-label">Low</div><div class="mg-val sell">${formatPrice(item[f('low')])}</div></div>
        </div>

        <div class="mh-section">
          <div class="mh-section-title">RSI(14) · All Timeframes</div>
          <div class="rsi-tf-grid">
            ${rsiBarRow('Monthly', item.m_rsi)}
            ${rsiBarRow('Weekly',  item.w_rsi)}
            ${rsiBarRow('Daily',   item.rsi)}
            ${rsiBarRow('4-Hour',  item.h4_rsi)}
          </div>
        </div>

        ${item[f('volume')]?`<div class="mh-section">
          <div class="mh-section-title">Volume</div>
          <div class="modal-status-card status-neutral">
            <div class="status-main">${timeframe==='M'?'This month':timeframe==='W'?'This week':'Today'}: <strong>${parseInt(item[f('volume')]).toLocaleString()}</strong> &nbsp;|&nbsp; Avg: ${parseInt(item[f('volume_average')]||0).toLocaleString()}${item[f('volume_spike_flag')]==='yes'?' &nbsp;<span style="color:var(--volume);font-weight:700">SPIKE</span>':''}</div>
          </div>
        </div>`:''}

        ${levels.length?`<div class="mh-section">
          <div class="mh-section-title">Key Levels (${levels.length})</div>
          <div class="modal-levels">
            ${levels.slice(0,15).map(lv=>`<div class="level-row"><span class="level-type ${lv.type}">${lv.type}</span><span class="level-price">${formatPrice(lv.price)}</span><span class="level-touches">x${lv.touches}</span><span class="level-date">${lv.date}</span></div>`).join('')}
          </div>
        </div>`:''}
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
    let mhChartLoaded = false;
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
        if (panel === 'chart' && !mhChartLoaded) {
          mhChartLoaded = true;
          loadModalChart(item);
        }
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
  }

  function parseKeyLevels(str) {
    if (!str) return [];
    return str.split(' | ').map(part => {
      const m = part.match(/(top|bottom)@([\d.]+)\[x(\d+)\|([^\]]+)\]/);
      if (!m) return null;
      return { type: m[1], price: parseFloat(m[2]), touches: parseInt(m[3]), date: m[4] };
    }).filter(Boolean);
  }

  // Volume spike detection: volume > 25-day rolling average
  function computeVolumeSpikes(bars, lookback = 25) {
    return bars.map((bar, i) => {
      const win = bars.slice(Math.max(0, i - lookback + 1), i + 1);
      const avg = win.reduce((s, b) => s + b.volume, 0) / win.length;
      return { ...bar, volumeAvg: avg, isSpike: bar.volume > avg };
    });
  }

  // Lazy-load Chart.js the first time the chart panel is opened
  function ensureChartJs() {
    if (window.Chart) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function loadModalChart(item) {
    // ── Daily: candlestick + volume spikes via Lightweight Charts ────────
    if (timeframe === 'D') {
      const container = document.getElementById('lwChartContainer');
      if (!container || !window.LightweightCharts) return;
      try {
        // Wait one animation frame so the panel transitions from display:none
        // and the container has real dimensions before Lightweight Charts reads them
        await new Promise(r => requestAnimationFrame(r));

        const res = await fetch('/api/history/' + encodeURIComponent(item.instrument_name));
        if (!res.ok) return;
        const json = await res.json();
        const allBars = json.data || [];
        if (!allBars.length) return;

        const bars    = allBars.slice(-100);
        const spiked  = computeVolumeSpikes(bars);
        const isDark  = (document.documentElement.getAttribute('data-theme') || 'dark') !== 'light';
        const textCol = isDark ? '#94a3b8' : '#334155';

        const chart = LightweightCharts.createChart(container, {
          autoSize: true,
          layout: { background: { color: 'transparent' }, textColor: textCol },
          grid:    { vertLines: { color: 'rgba(148,163,184,.07)' }, horzLines: { color: 'rgba(148,163,184,.07)' } },
          crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
          rightPriceScale: { borderColor: 'rgba(148,163,184,.15)', scaleMargins: { top: 0.05, bottom: 0.22 } },
          timeScale: { borderColor: 'rgba(148,163,184,.15)', timeVisible: true },
        });

        // ── Candlesticks — amber body on spike days ──
        const candleSeries = chart.addCandlestickSeries({
          upColor: '#10b981', downColor: '#ef4444',
          borderUpColor: '#10b981', borderDownColor: '#ef4444',
          wickUpColor: '#6b7280', wickDownColor: '#6b7280',
        });
        candleSeries.setData(spiked.map(b => ({
          time:  b.date,
          open:  b.open, high: b.high, low: b.low, close: b.close,
          ...(b.isSpike ? { color: '#f59e0b', borderColor: '#f59e0b', wickColor: '#f59e0b' } : {}),
        })));

        // ── MA ribbon fan — render ALL detected MAs as thin lines ──
        // Hue gradient from cool (short MAs, fast) to warm (long MAs, slow)
        const maKeys = bars.length
          ? Object.keys(bars[bars.length - 1])
              .filter(k => /^ma_\d+$/.test(k))
              .sort((a, b) => parseInt(a.split('_')[1]) - parseInt(b.split('_')[1]))
          : [];
        if (maKeys.length) {
          const lastIdx = maKeys.length - 1;
          maKeys.forEach((key, i) => {
            const period = key.split('_')[1];
            const data = bars
              .filter(b => b[key] != null)
              .map(b => ({ time: b.date, value: b[key] }));
            if (data.length < 2) return;
            // Hue 220 (blue) → 0 (red) across the ribbon
            const t = lastIdx > 0 ? i / lastIdx : 0;
            const hue = Math.round(220 - 220 * t);
            const isAnchor = i === 0 || i === lastIdx || i === Math.floor(lastIdx / 2);
            const color = `hsl(${hue}, 70%, ${isAnchor ? 60 : 55}%)`;
            const line = chart.addLineSeries({
              color,
              lineWidth: isAnchor ? 1.4 : 1,
              priceLineVisible: false,
              lastValueVisible: isAnchor,
              title: isAnchor ? `MA${period}` : '',
            });
            line.setData(data);
          });
        }

        // ── Key support / resistance levels ──
        parseKeyLevels(item.key_levels_all).slice(0, 10).forEach(lv => {
          candleSeries.createPriceLine({
            price: lv.price,
            color: lv.type === 'top' ? 'rgba(239,68,68,.5)' : 'rgba(16,185,129,.5)',
            lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed,
            title: lv.type === 'top' ? `R×${lv.touches}` : `S×${lv.touches}`,
          });
        });

        // ── Signal marker ──
        const lsd = item['last_signal_date'], lst = item['last_signal_type'] || item['primary_signal'] || '';
        if (lsd && lst) {
          const sigBar = bars.find(b => b.date >= lsd);
          if (sigBar) {
            candleSeries.setMarkers([{
              time: sigBar.date,
              position: isBuy(item) ? 'belowBar' : 'aboveBar',
              color:    isBuy(item) ? '#10b981' : '#ef4444',
              shape:    isBuy(item) ? 'arrowUp'  : 'arrowDown',
              text:     lst,
            }]);
          }
        }

        // ── Volume histogram — amber bars on spike days ──
        const volSeries = chart.addHistogramSeries({
          priceFormat: { type: 'volume' },
          priceScaleId: 'vol_scale',
        });
        chart.priceScale('vol_scale').applyOptions({ scaleMargins: { top: 0.78, bottom: 0 }, visible: false });
        volSeries.setData(spiked.map(b => ({
          time:  b.date,
          value: b.volume,
          color: b.isSpike ? 'rgba(245,158,11,.75)' : 'rgba(148,163,184,.22)',
        })));

        chart.timeScale().fitContent();
        charts.modalLw = chart;
      } catch (e) { console.warn('D chart error:', e); }
      return;
    }

    // ── All other timeframes: MA Ribbon via Chart.js ──────────────────────
    await ensureChartJs();
    const c = getThemeColors();
    try {
      const res = await fetch('/api/history/' + encodeURIComponent(item.instrument_name));
      if (!res.ok) return;
      const json = await res.json();
      const hist = json.data || [];
      if (!hist.length) return;

      const labels = hist.map(h => h.date);
      const closes = hist.map(h => h.close);

      // Pick 3 representative MAs from whatever periods are in the data
      const _ps = detectedMaPeriods;
      const maKeys = _ps.length >= 3
        ? [_ps[0], _ps[Math.floor((_ps.length - 1) / 2)], _ps[_ps.length - 1]]
        : _ps;
      const maDatasets = maKeys.map((p, idx) => ({
        label: 'MA ' + p,
        data: hist.map(h => h['ma_' + p] || null),
        borderColor: [c.accent, c.watch, c.volume][idx],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
        tension: 0.3,
      }));

      const ctx = document.getElementById('modalChart');
      if (!ctx) return;
      if (charts.modal) charts.modal.destroy();

      charts.modal = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Close',
              data: closes,
              borderColor: c.text,
              borderWidth: 2,
              pointRadius: 0,
              fill: { target: 'origin', above: 'rgba(99,102,241,.06)' },
              tension: 0.2,
            },
            ...maDatasets,
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: true, position: 'top', labels: { padding: 8, usePointStyle: true, pointStyleWidth: 8, font: { size: 10 } } },
            tooltip: { backgroundColor: 'rgba(0,0,0,.85)', titleFont: { size: 11 }, bodyFont: { size: 11 }, padding: 10, cornerRadius: 8 },
          },
          scales: {
            x: { display: true, grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 9 }, maxRotation: 0 } },
            y: { display: true, grid: { color: c.grid }, ticks: { font: { size: 10 } } },
          },
          animation: { duration: 400 },
        },
      });
    } catch (e) {
      console.warn('Chart load failed:', e);
    }
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
      const established = d[f('established_trend')] || d[f('trend_direction')] || '';
      const runDays    = currentSeg ? currentSeg.days : (parseInt(d[f('trend_run_days')]) || 0);
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

      // Mini history strip
      const histTotal = d.histSegs.reduce((a,s) => a+s.days, 0);
      const histHtml  = d.histSegs.length >= 2
        ? `<div class="tc-hist-strip">${d.histSegs.map(s => {
            const pct = histTotal ? (s.days/histTotal*100).toFixed(1) : '12.5';
            const hc  = s.direction === 'UPTREND' ? 'var(--buy)' : 'var(--sell)';
            return `<div class="tc-hist-seg" style="flex:${s.days};background:${hc}" title="${s.direction === 'UPTREND' ? '↑' : '↓'} ${s.days}d"></div>`;
          }).join('')}</div>` : '';

      const _aiTrend = isAI(d.name);

      return `<div class="trend-card${_aiTrend ? ' ai-card' : ''}" data-name="${d.name}"${extAttr} style="--tc:${color};${delay}">
        <div class="tc-header">
          <div class="tc-name-wrap">
            <span class="tc-name">${d.name}</span>
            ${_aiTrend ? '<span class="ai-label">Artificial Intelligence</span>' : ''}
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
        ${d.avgCurrent ? `<div class="tc-meta-row">
          <span class="tc-mat" style="color:${matColor}">${matIcon} ${d.maturity}</span>
          <span class="tc-avg">avg ${d.avgCurrent}d &middot; <span style="color:${matColor}">${d.pctOfAvg}%</span></span>
        </div>
        <div class="tc-mat-bar"><div class="tc-mat-fill" style="width:${matFill.toFixed(1)}%"></div></div>` : ''}
        ${histHtml}
        ${d.hasData ? `<div class="tc-ratio-bar">
          <div class="tc-rb-up" style="width:${d.upPct}%"></div>
          <div class="tc-rb-down" style="width:${100-d.upPct}%"></div>
        </div>
        <div class="tc-ratio-lbl"><span style="color:var(--buy)">${d.upPct}% ↑</span><span style="color:var(--sell)">${100-d.upPct}% ↓</span></div>` : ''}
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
      b.title = nowStarred ? 'Remove from watchlist' : 'Add to watchlist';
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
    const ivlMap = { 'D': 'D', '4H': '240', 'W': 'W', 'M': 'M' };
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
    const trend   = item[f('trend_direction')] || '';
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

  // Initial UI state for push button (after SW registers)
  setTimeout(updatePushBadgeUI, 500);

  window.SP = { openModal, toggleStar, openTvPicker, navigateToTab, shareCard, showUserPicker, openTrackRecord, closeTrackAndOpen, togglePush };

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
    const grpSel   = document.getElementById('scannerGroupFilter');
    const trendSel = document.getElementById('scannerTrendFilter');
    const alignSel = document.getElementById('scannerAlignFilter');
    const macroEl = document.getElementById('scannerMacroMaFilter');
    const grp   = grpSel?.value   !== 'all' ? grpSel.value   : '';
    const trend = trendSel?.value !== 'all' ? trendSel.value : '';
    const align = alignSel?.value !== 'all' ? alignSel.value : '';
    const macro = macroEl?.value !== 'all' ? macroEl.value : '';

    if (!grp && !trend && !align && !macro && !activeRegionFilter) {
      strip.style.display = 'none';
      strip.innerHTML = '';
      return;
    }

    const pills = [];
    if (activeRegionFilter) pills.push(`<span class="ctx-pill ctx-pill-group">Region: <strong>${activeRegionFilter}</strong></span>`);
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
    if (macro) {
      const macroLbl = macroEl.options[macroEl.selectedIndex]?.text || macro;
      pills.push(`<span class="ctx-pill ctx-pill-macro">Level: <strong>${macroLbl}</strong></span>`);
    }

    strip.style.display = 'flex';
    strip.innerHTML = pills.join('') +
      `<button class="ctx-clear-btn" id="ctxClearBtn">✕ Reset</button>`;

    document.getElementById('ctxClearBtn')?.addEventListener('click', () => {
      if (grpSel)   grpSel.value   = 'all';
      if (trendSel) trendSel.value = 'all';
      if (alignSel) alignSel.value = 'all';
      if (macroEl)  macroEl.value  = 'all';
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

  // Re-sync when user returns to the tab (catches changes made on another device)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && syncUser) syncPull();
  });

  // ── Radar Tab — Confluence Entry Finder ────────────────────────────────

  function tfCounts(item) {
    const tfs = [
      item.m_trend_direction  || 'NEUTRAL',
      item.w_trend_direction  || 'NEUTRAL',
      item.trend_direction    || 'NEUTRAL',
      item.h4_trend_direction || 'NEUTRAL',
    ];
    const bull = tfs.filter(t => t === 'UPTREND').length;
    const bear = tfs.filter(t => t === 'DOWNTREND').length;
    return { bull, bear, tfs };
  }

  // ── Single source of truth for the confluence score ───────────────────
  // Returns { isBullish, lines: [{label, points}] }. Both radarConfluenceScore()
  // (sum → 0-100) and radarScoreBreakdown() (the modal panel) read from this,
  // so the number and its explanation can never drift apart.
  function radarScoreFactors(item) {
    const { bull, bear, tfs } = tfCounts(item);
    const isBullish = bull >= bear;
    const lines = [];

    // 1. TF alignment (max 34) — Monthly+Weekly carry more weight as regime setters
    const tfWeights = [11, 11, 8, 4];   // M, W, D, 4H
    const targetTf  = isBullish ? 'UPTREND' : 'DOWNTREND';
    let tfPoints = 0;
    tfs.forEach((t, i) => { if (t === targetTf) tfPoints += tfWeights[i]; });
    if (tfPoints) lines.push({ label: `Aligned timeframes (${isBullish ? 'bull' : 'bear'})`, points: tfPoints });

    // 2. Signal type (max 15) — BP1/SP1 reversal is highest conviction
    const sig = item.primary_signal || item.w_primary_signal || item.m_primary_signal || '';
    const buySig  = sig === 'BP1' || sig === 'BP2' || sig === 'BP3' || sig === 'BP4';
    const sellSig = sig === 'SP1' || sig === 'SP2' || sig === 'SP3' || sig === 'SP4';
    const hasAlignedSig = (isBullish && buySig) || (!isBullish && sellSig);
    if (hasAlignedSig) {
      lines.push({ label: `${sig} ${(sig === 'BP1' || sig === 'SP1') ? 'reversal signal' : 'signal'}`,
                   points: (sig === 'BP1' || sig === 'SP1') ? 15 : 10 });
    } else if (item.watch_flag) {
      lines.push({ label: 'Watch flag', points: 5 });
    }

    // 3. Signal confidence (max 10)
    const conf = (item.signal_confidence || '').toLowerCase();
    if (conf === 'high')          lines.push({ label: 'High confidence',     points: 10 });
    else if (conf === 'standard') lines.push({ label: 'Standard confidence', points: 6 });
    else if (conf === 'low')      lines.push({ label: 'Low confidence',      points: 3 });

    // 4. Ribbon squeeze (max 10) — coiled-spring setup before a breakout
    let sqPoints = 0; const sqTfs = [];
    if (item.ribbon_compression   === 'yes') { sqPoints += 5; sqTfs.push('D'); }
    if (item.w_ribbon_compression === 'yes') { sqPoints += 3; sqTfs.push('W'); }
    if (item.m_ribbon_compression === 'yes') { sqPoints += 2; sqTfs.push('M'); }
    if (sqPoints) lines.push({ label: `Ribbon squeeze (${sqTfs.join('+')})`, points: Math.min(sqPoints, 10) });

    // 5. Key-level confluence (max 9) — price testing a real, well-tested S/R level
    if (item.key_level_touched_today === 'yes') {
      let klPoints = 3;
      const touches = parseInt(item.key_level_touch_count) || 0;
      if      (touches >= 100) klPoints += 6;
      else if (touches >= 50)  klPoints += 4;
      else if (touches >= 20)  klPoints += 2;
      lines.push({ label: `Key level held ${touches}×, tested today`, points: klPoints });
    }

    // 6. MA-order quality (max 8) — clean, textbook ribbon stacking in the trade direction
    const maOrder = parseInt(item[f('ma_order_score')]);
    const maMax   = summaryData.ma_max_pairs || 14;
    if (!isNaN(maOrder) && maMax > 0) {
      const stackPct = maOrder / maMax;                       // 1 = perfectly bullish-stacked
      const aligned  = isBullish ? stackPct : (1 - stackPct); // direction-aware
      const pts = Math.round(aligned * 8);
      if (pts > 0) lines.push({ label: `MA ribbon ${isBullish ? 'stacked' : 'inverted'} ${maOrder}/${maMax}`, points: pts });
    }

    // 7. Macro MA position vs daily close (max 12)
    const dailyClose = parseFloat(item.close);
    const macroMas   = detectedMacroMas
      .map(p => ({ period: p, val: parseFloat(item[`ma_${p}`]) }))
      .filter(r => !isNaN(r.val) && !isNaN(dailyClose));
    if (macroMas.length > 0) {
      const onSide = isBullish
        ? macroMas.filter(r => dailyClose > r.val).length
        : macroMas.filter(r => dailyClose < r.val).length;
      const pts = Math.round((onSide / macroMas.length) * 12);
      if (pts > 0) lines.push({
        label: `${onSide}/${macroMas.length} macro MAs ${isBullish ? 'below' : 'above'} price`,
        points: pts,
      });
    }

    // 8. RSI timing (max 9) — 4H entry timing against the higher-TF trend
    const h4Rsi = parseFloat(item.h4_rsi);
    const dRsi  = parseFloat(item.rsi);
    if (isBullish) {
      if (!isNaN(h4Rsi) && h4Rsi < 30)      lines.push({ label: `4H RSI ${h4Rsi.toFixed(0)} (oversold)`,     points: 9 });
      else if (!isNaN(h4Rsi) && h4Rsi < 50) lines.push({ label: `4H RSI ${h4Rsi.toFixed(0)} (room to run)`,  points: 5 });
      else if (!isNaN(dRsi)  && dRsi  < 50) lines.push({ label: `Daily RSI ${dRsi.toFixed(0)}`,              points: 3 });
    } else {
      if (!isNaN(h4Rsi) && h4Rsi > 70)      lines.push({ label: `4H RSI ${h4Rsi.toFixed(0)} (overbought)`,   points: 9 });
      else if (!isNaN(h4Rsi) && h4Rsi > 50) lines.push({ label: `4H RSI ${h4Rsi.toFixed(0)} (room to fall)`, points: 5 });
      else if (!isNaN(dRsi)  && dRsi  > 50) lines.push({ label: `Daily RSI ${dRsi.toFixed(0)}`,              points: 3 });
    }

    // 9. Macro S/R touch (max 6) — price genuinely testing a macro MA level today
    if (isBullish && item.macro_sr_signal === 'support') {
      lines.push({ label: 'Macro MA support touch', points: 4 });
      if ((parseInt(item.macro_sr_strength) || 0) >= 3) lines.push({ label: 'Multi-MA confluence support', points: 2 });
    } else if (!isBullish && item.macro_sr_signal === 'resistance') {
      lines.push({ label: 'Macro MA resistance touch', points: 4 });
      if ((parseInt(item.macro_sr_strength) || 0) >= 3) lines.push({ label: 'Multi-MA confluence resistance', points: 2 });
    }

    // 10. Signal freshness (max 4) — recent signals are actionable, stale ones have already moved
    const daysAgo = parseInt(item.last_signal_days_ago);
    if (!isNaN(daysAgo)) {
      if      (daysAgo <= 1) lines.push({ label: `Signal fresh (${daysAgo}d ago)`,  points: 4 });
      else if (daysAgo <= 4) lines.push({ label: `Signal recent (${daysAgo}d ago)`, points: 2 });
      else if (daysAgo <= 9) lines.push({ label: `Signal ${daysAgo}d ago`,          points: 1 });
    }

    // 11. Volume (max 6) — daily spike + a more meaningful higher-TF spike
    if (item.volume_spike_flag === 'yes') lines.push({ label: 'Volume spike (daily)', points: 3 });
    if (item.w_volume_spike_flag === 'yes' || item.m_volume_spike_flag === 'yes') {
      lines.push({ label: `Volume spike (${item.w_volume_spike_flag === 'yes' ? 'weekly' : 'monthly'})`, points: 3 });
    }

    return { isBullish, lines };
  }

  function radarConfluenceScore(item) {
    const { lines } = radarScoreFactors(item);
    const total = lines.reduce((sum, l) => sum + l.points, 0);
    return Math.min(total, 100);
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

  function renderRadar() {
    const allData = getActiveData(); // respect AI filter
    const el = document.getElementById('pane-radar');
    if (!el || !allData.length) return;
    wireRadarOnce(el);

    // ── score all instruments and sort descending ─────────────────────────
    const scored = allData.map(item => ({ item, score: radarConfluenceScore(item) }));
    scored.sort((a, b) => b.score - a.score);
    const primeAll      = scored.filter(s => s.score >= 75);
    const strongAll     = scored.filter(s => s.score >= 50 && s.score < 75);
    const developingAll = scored.filter(s => s.score >= 25 && s.score < 50);

    // ── apply filters ─────────────────────────────────────────────────────
    const q = radarState.search.toLowerCase().trim();
    function passFilter({ item }) {
      if (q && !matchesSearch(item, q)) return false;
      if (radarState.dir !== 'all') {
        const { bull, bear } = tfCounts(item);
        const isBullish = bull >= bear;
        if (radarState.dir === 'long'  && !isBullish) return false;
        if (radarState.dir === 'short' &&  isBullish) return false;
      }
      if (radarState.rsi !== 'all') {
        if (rsiZone(item.rsi) !== radarState.rsi) return false;
      }
      return true;
    }
    const prime      = primeAll.filter(passFilter);
    const strong     = strongAll.filter(passFilter);
    const developing = developingAll.filter(passFilter);

    // ── card builder ──────────────────────────────────────────────────────
    function radarCard({ item, score }) {
      const { bull, bear, tfs } = tfCounts(item);
      const isBullish = bull >= bear;
      const tier   = scoreTier(score);
      const sig    = item.primary_signal || item.w_primary_signal || item.m_primary_signal || '';
      const conf   = (item.signal_confidence || '').toLowerCase();
      const sq     = item.ribbon_compression === 'yes';
      const name   = instName(item.instrument_name) || item.instrument_name;

      const dotCls   = t => t === 'UPTREND' ? 'radar-dot-bull' : t === 'DOWNTREND' ? 'radar-dot-bear' : 'radar-dot-neutral';
      const tfLabels = ['M', 'W', 'D', '4H'];
      const dotsHtml = tfs.map((t, i) => `<span class="radar-tf-dot ${dotCls(t)}"><span class="radar-tf-lbl">${tfLabels[i]}</span></span>`).join('');

      const dirBadge  = isBullish ? '<span class="radar-dir-badge radar-long">LONG</span>' : '<span class="radar-dir-badge radar-short">SHORT</span>';
      const sigBadge  = sig  ? `<span class="feed-badge badge-${sigClass(sig) || 'p4'}">${sig}</span>` : '';
      const confBadge = conf ? `<span class="badge-confidence conf-${conf}">${conf}</span>` : '';
      const sqBadge   = sq   ? '<span class="radar-sq-badge">SQZ</span>' : '';

      // Macro MA position badge — always use raw daily fields regardless of active TF
      const dailyClose = parseFloat(item.close);
      const macroMas   = detectedMacroMas
        .map(p => ({ period: p, val: parseFloat(item[`ma_${p}`]) }))
        .filter(r => !isNaN(r.val) && !isNaN(dailyClose));
      const macroBull  = macroMas.length > 0 && macroMas.every(r => dailyClose > r.val);
      const macroBear  = macroMas.length > 0 && macroMas.every(r => dailyClose < r.val);
      const macroBadge = macroBull ? '<span class="radar-macro-badge radar-macro-bull">▲ Macro</span>'
                       : macroBear ? '<span class="radar-macro-badge radar-macro-bear">▼ Macro</span>' : '';

      // Macro S/R touch badge — only show when it aligns with direction
      const srSig   = item.macro_sr_signal || '';
      const srLvl   = item.macro_sr_level  || '';
      const srStr   = parseInt(item.macro_sr_strength) || 0;
      const srMatch = (isBullish && srSig === 'support') || (!isBullish && srSig === 'resistance');
      const srBadge = srMatch
        ? `<span class="radar-sr-badge">${srStr >= 3 ? '⚡ ' : ''}${srSig === 'support' ? 'SR SUP' : 'SR RES'}${srLvl ? ' ' + srLvl : ''}</span>`
        : '';

      const volBadge = item.volume_spike_flag === 'yes'
        ? '<span class="radar-sq-badge" style="background:var(--volume-soft);color:var(--volume)">VOL</span>' : '';

      const rsiPips = [
        item.m_rsi  ? `<span class="rsi-tf-pip rsi-${rsiZone(item.m_rsi)}">M ${parseFloat(item.m_rsi).toFixed(0)}</span>`   : '',
        item.w_rsi  ? `<span class="rsi-tf-pip rsi-${rsiZone(item.w_rsi)}">W ${parseFloat(item.w_rsi).toFixed(0)}</span>`   : '',
        item.rsi    ? `<span class="rsi-tf-pip rsi-${rsiZone(item.rsi)}">D ${parseFloat(item.rsi).toFixed(0)}</span>`       : '',
        item.h4_rsi ? `<span class="rsi-tf-pip rsi-${rsiZone(item.h4_rsi)}">4H ${parseFloat(item.h4_rsi).toFixed(0)}</span>` : '',
      ].filter(Boolean).join('');

      const _aiRadar = isAI(item.instrument_name);
      return `<div class="radar-card${_aiRadar ? ' ai-card' : ''}" data-act="openModal" data-arg="${item.instrument_name}">
        <div class="radar-card-top">
          ${dirBadge}
          <div class="radar-card-name">
            <span class="radar-inst">${name}</span>
            <span class="radar-group">${item.group || ''}${item.sector ? ' · ' + item.sector : ''}</span>
            ${_aiRadar ? '<span class="ai-label">Artificial Intelligence</span>' : ''}
          </div>
          <div class="radar-score-wrap">
            <span class="radar-score-num radar-tier-${tier}">${score}</span>
          </div>
          <div class="radar-tf-dots">${dotsHtml}</div>
        </div>
        <div class="radar-score-bar-wrap">
          <div class="radar-score-bar-fill tier-${tier}" style="width:${score}%"></div>
        </div>
        <div class="radar-card-bot">${sigBadge}${confBadge}${sqBadge}${macroBadge}${srBadge}${volBadge}</div>
        ${rsiPips ? `<div class="radar-rsi-row">${rsiPips}</div>` : ''}
      </div>`;
    }

    // ── section builder ───────────────────────────────────────────────────
    function radarSection(key, title, subtitle, items, totalCount, sectionCls) {
      const collapsed = radarState.collapsed[key];
      const chevron = `<svg class="radar-chevron ${collapsed ? 'collapsed' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>`;
      const isFiltered = items.length !== totalCount;
      const countLabel = isFiltered ? `${items.length} of ${totalCount}` : `${items.length}`;
      const header = `
        <div class="radar-section-header radar-section-${sectionCls}" data-radar-collapse="${key}">
          <div class="radar-section-text">
            <div class="radar-section-title">${title}</div>
            <div class="radar-section-sub">${subtitle}</div>
          </div>
          <span class="radar-section-count">${countLabel}</span>
          ${chevron}
        </div>`;
      const body = collapsed ? '' : (
        items.length
          ? `<div class="radar-cards">${items.map(radarCard).join('')}</div>`
          : `<div class="radar-empty-section">No setups match your filters</div>`
      );
      return `<div class="radar-section">${header}${body}</div>`;
    }

    // ── RSI guide panel ───────────────────────────────────────────────────
    const guideHtml = radarState.guide ? `
      <div class="radar-guide-panel">
        <div class="radar-guide-title">RSI(14) · How to read it</div>
        <p class="radar-guide-intro">RSI measures momentum strength on a 0–100 scale. Use it to time entries — not to trade against the trend.</p>
        <div class="radar-guide-zones">
          <div class="radar-guide-zone">
            <span class="rsi-badge rsi-oversold">&lt; 30 · OS</span>
            <div class="radar-guide-zone-text">
              <strong>Oversold</strong> — sellers exhausted, bounce likely.<br>
              <span class="radar-guide-tip">Best for LONG entries. Look for 4H going OS while D+W uptrend holds.</span>
            </div>
          </div>
          <div class="radar-guide-zone">
            <span class="rsi-badge rsi-bearish">30–50 · Bear</span>
            <div class="radar-guide-zone-text">
              <strong>Bearish zone</strong> — below midpoint, momentum weak.<br>
              <span class="radar-guide-tip">Wait for RSI to reclaim 50 before going long. Good for SHORT setups.</span>
            </div>
          </div>
          <div class="radar-guide-zone">
            <span class="rsi-badge rsi-bullish">50–70 · Bull</span>
            <div class="radar-guide-zone-text">
              <strong>Bullish zone</strong> — above midpoint, buyers in control.<br>
              <span class="radar-guide-tip">Best for LONG entries in established uptrends. Trend continuation zone.</span>
            </div>
          </div>
          <div class="radar-guide-zone">
            <span class="rsi-badge rsi-overbought">&gt; 70 · OB</span>
            <div class="radar-guide-zone-text">
              <strong>Overbought</strong> — rally extended, pullback risk.<br>
              <span class="radar-guide-tip">Best for SHORT entries. Look for 4H going OB while D+W downtrend holds.</span>
            </div>
          </div>
        </div>
        <div class="radar-guide-tips">
          <div class="radar-guide-tip-row">💡 <strong>Ideal BUY:</strong> 4H oversold → D bullish → W/M uptrend. Enter as 4H turns up from OS.</div>
          <div class="radar-guide-tip-row">💡 <strong>Ideal SELL:</strong> 4H overbought → D bearish → W/M downtrend. Enter as 4H turns down from OB.</div>
          <div class="radar-guide-tip-row">📖 <strong>Top-down read:</strong> M+W set the regime → D sets the swing → 4H gives exact entry timing.</div>
        </div>
      </div>` : '';

    // ── controls ──────────────────────────────────────────────────────────
    const dBtn = v => `<button class="radar-dir-btn${radarState.dir===v?' active':''}" data-radar-dir="${v}">${v==='all'?'All':v==='long'?'Long':'Short'}</button>`;
    const rBtn = (v, lbl) => `<button class="radar-rsi-btn${radarState.rsi===v?' active':''}" data-radar-rsi="${v}">${lbl}</button>`;

    // ── render ────────────────────────────────────────────────────────────
    el.innerHTML = `
      <div class="radar-controls">
        <div class="radar-search-wrap">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="radar-search-input" id="radarSearch" type="text" placeholder="Search instruments…" value="${radarState.search.replace(/"/g,'&quot;')}">
        </div>
        <div class="radar-filter-row">
          <div class="radar-dir-toggle">
            ${dBtn('all')}${dBtn('long')}${dBtn('short')}
          </div>
          <button class="radar-guide-btn${radarState.guide?' active':''}" data-radar-guide="1">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><circle cx="12" cy="16" r=".5" fill="currentColor"/></svg>
            RSI Guide
          </button>
        </div>
        <div class="radar-rsi-row-filters">
          ${rBtn('all','All')}${rBtn('oversold','OS &lt;30')}${rBtn('bearish','Bear 30–50')}${rBtn('bullish','Bull 50–70')}${rBtn('overbought','OB &gt;70')}
        </div>
      </div>
      ${guideHtml}
      ${radarSection('prime',      'PRIME',      'Score 75+ · Highest confluence — act now',   prime,      primeAll.length,      'prime')}
      ${radarSection('strong',     'STRONG',     'Score 50–74 · Good setup — plan your entry', strong,     strongAll.length,     'strong')}
      ${radarSection('developing', 'DEVELOPING', 'Score 25–49 · Building — watch and wait',    developing, developingAll.length, 'developing')}
    `;

    if (radarState.search) {
      const inp = document.getElementById('radarSearch');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }
  }

  function wireRadarOnce(el) {
    if (radarWired) return;
    radarWired = true;
    let searchTimer;
    el.addEventListener('input', e => {
      if (e.target.id === 'radarSearch') {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { radarState.search = e.target.value; renderRadar(); }, 200);
      }
    });
    el.addEventListener('click', e => {
      // Section collapse
      const colHdr = e.target.closest('[data-radar-collapse]');
      if (colHdr) {
        const key = colHdr.dataset.radarCollapse;
        radarState.collapsed[key] = !radarState.collapsed[key];
        renderRadar(); return;
      }
      // Direction filter
      const dirBtn = e.target.closest('[data-radar-dir]');
      if (dirBtn) {
        radarState.dir = dirBtn.dataset.radarDir;
        renderRadar(); return;
      }
      // RSI zone filter
      const rsiBtn = e.target.closest('[data-radar-rsi]');
      if (rsiBtn) {
        radarState.rsi = rsiBtn.dataset.radarRsi;
        renderRadar(); return;
      }
      // RSI guide toggle
      if (e.target.closest('[data-radar-guide]')) {
        radarState.guide = !radarState.guide;
        renderRadar(); return;
      }
    });
  }

  // ── (Portfolio code removed — replaced by Radar tab) ──────────────────

  function renderPortfolioStats() {
    const acctEl = document.getElementById('pfAcctSummary');
    const pillsEl = document.getElementById('pfStatsPills');
    const countEl = document.getElementById('openTradeCount');
    if (!acctEl) return;

    // Account summary from XM email (portfolioData)
    const pf = portfolioData || {};
    const pfSumm = pf.summary || {};
    const pfAcct = pf.account || {};
    const xmPositions = (pf.positions || []);
    const deals = (pf.deals || []);
    const acctId = pfAcct.account_no || '';
    const equity = pfSumm.equity || 0;
    const balance = pfSumm.balance || 0;
    const floatPL = pfSumm.floating_pl || 0;
    const margin = pfSumm.margin || 0;
    const hasData = equity > 0 || balance > 0;

    acctEl.innerHTML = `
      <div class="pf-acct-title">XM Account${acctId ? ' · ' + acctId : ''}${pf.date ? ' <span style="font-weight:400;color:var(--txt3);font-size:.75rem">(' + pf.date + ')</span>' : ''}</div>
      <div class="pf-acct-grid">
        <div>
          <div class="pf-acct-label">Equity</div>
          <div class="pf-acct-val pf-acct-equity">${hasData ? 'R' + equity.toLocaleString('en', {minimumFractionDigits:2}) : '--'}</div>
        </div>
        <div>
          <div class="pf-acct-label">Floating P/L</div>
          <div class="pf-acct-val ${floatPL >= 0 ? 'pf-acct-pos' : 'pf-acct-neg'}">${hasData ? (floatPL >= 0 ? '+' : '') + 'R' + floatPL.toLocaleString('en', {minimumFractionDigits:2}) : '--'}</div>
        </div>
        <div>
          <div class="pf-acct-label">Balance</div>
          <div class="pf-acct-val">${hasData ? 'R' + balance.toLocaleString('en', {minimumFractionDigits:2}) : '--'}</div>
        </div>
        <div>
          <div class="pf-acct-label">Margin</div>
          <div class="pf-acct-val">${hasData ? 'R' + margin.toLocaleString('en', {minimumFractionDigits:2}) : '--'}</div>
        </div>
      </div>
    `;

    // Stats Pills — XM positions only
    const openCount = xmPositions.length;
    const longCount = xmPositions.filter(p => p.type === 'buy').length;
    const shortCount = xmPositions.filter(p => p.type === 'sell').length;
    const totalPnl = xmPositions.reduce((s, p) => s + (p.profit || 0), 0);
    pillsEl.innerHTML = `
      <div class="pf-pill">
        <div class="pf-pill-num" style="color:var(--buy)">${openCount}</div>
        <div class="pf-pill-lbl">Open</div>
      </div>
      <div class="pf-pill">
        <div class="pf-pill-num" style="color:var(--buy)">${longCount}</div>
        <div class="pf-pill-lbl">Long</div>
      </div>
      <div class="pf-pill">
        <div class="pf-pill-num" style="color:var(--sell)">${shortCount}</div>
        <div class="pf-pill-lbl">Short</div>
      </div>
      <div class="pf-pill">
        <div class="pf-pill-num" style="color:${totalPnl >= 0 ? 'var(--buy)' : 'var(--sell)'}">${hasData ? (totalPnl >= 0 ? '+' : '') + 'R' + Math.abs(totalPnl).toLocaleString('en', {minimumFractionDigits:2}) : '--'}</div>
        <div class="pf-pill-lbl">Float P/L</div>
      </div>
    `;

    // Open trade count badge
    if (countEl) countEl.textContent = openCount ? openCount + ' Active' : '';

    // Render deals list if available
    const dealsHdr = document.getElementById('pfDealsHdr');
    const dealsList = document.getElementById('pfDealsList');
    if (deals.length > 0 && dealsList) {
      if (dealsHdr) dealsHdr.style.display = '';
      const curr = pfAcct.currency || 'ZAR';
      const sym = curr === 'ZAR' ? 'R' : '$';
      dealsList.innerHTML = deals.map(d => {
        const pnl = d.profit || 0;
        const pnlClass = pnl >= 0 ? 'pf-pos-pnl-pos' : 'pf-pos-pnl-neg';
        return `<div class="pf-pos-card">
          <div class="pf-pos-strip ${d.type === 'buy' ? 'long' : 'short'}"></div>
          <div class="pf-pos-body">
            <div class="pf-pos-top">
              <div>
                <div class="pf-pos-name">${d.item}</div>
                <div class="pf-pos-sub">${d.size} lot · ${d.type === 'buy' ? 'Buy' : 'Sell'}</div>
              </div>
              <div class="pf-pos-top-right">
                <span class="pf-pos-meta-val ${pnlClass}">${pnl >= 0 ? '+' : ''}${sym}${Math.abs(pnl).toLocaleString('en', {minimumFractionDigits:2})}</span>
              </div>
            </div>
            <div class="pf-pos-meta">
              <div><div class="pf-pos-meta-label">Open</div><div class="pf-pos-meta-val">${formatPrice(d.price)}</div></div>
              <div><div class="pf-pos-meta-label">Close</div><div class="pf-pos-meta-val">${formatPrice(d.close_price)}</div></div>
              <div><div class="pf-pos-meta-label">Time</div><div class="pf-pos-meta-val">${(d.open_time || '').slice(5, 16).replace('.', '/')}</div></div>
            </div>
          </div>
        </div>`;
      }).join('');
    } else if (dealsList) {
      dealsList.innerHTML = '';
      if (dealsHdr) dealsHdr.style.display = 'none';
    }
  }


  function renderOpenTrades() {
    const listEl   = document.getElementById('openTradesList');
    const countEl  = document.getElementById('openTradeCount');
    if (!listEl) return;

    const xmPositions = (portfolioData && portfolioData.positions) || [];

    if (countEl) countEl.textContent = xmPositions.length || '';

    if (!xmPositions.length) {
      listEl.innerHTML = `<div class="trade-empty">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".3"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
        <p>No open positions. Run the portfolio update to fetch your XM positions.</p>
      </div>`;
      return;
    }

    const curr = (portfolioData.account && portfolioData.account.currency) || 'ZAR';
    const sym = curr === 'ZAR' ? 'R' : '$';
    listEl.innerHTML = xmPositions.map(pos => {
      const isLong = pos.type === 'buy';
      const side = isLong ? 'long' : 'short';
      const pnl = pos.profit || 0;
      const swap = pos.swap || 0;
      const pnlClass = pnl >= 0 ? 'pf-pos-pnl-pos' : 'pf-pos-pnl-neg';
      const pnlSign = pnl >= 0 ? '+' : '';
      const openDate = pos.open_time ? pos.open_time.slice(5, 10).replace('.', '/') : '';

      let planInfo = '';
      if (pos.sl > 0 || pos.tp > 0) {
        const parts = [];
        if (pos.sl > 0) parts.push('SL ' + formatPrice(pos.sl));
        if (pos.tp > 0) parts.push('TP ' + formatPrice(pos.tp));
        planInfo = '<div class="pf-pos-plan">' + parts.join(' · ') + '</div>';
      }

      return `<div class="pf-pos-card">
        <div class="pf-pos-strip ${side}"></div>
        <div class="pf-pos-body">
          <div class="pf-pos-top">
            <div>
              <div class="pf-pos-name">${pos.item}</div>
              <div class="pf-pos-sub">${pos.size} lot · ${openDate}</div>
            </div>
            <div class="pf-pos-top-right">
              <span class="pf-pos-dir ${side}">${isLong ? 'Long' : 'Short'}</span>
            </div>
          </div>
          <div class="pf-pos-meta">
            <div>
              <div class="pf-pos-meta-label">Entry</div>
              <div class="pf-pos-meta-val">${formatPrice(pos.price)}</div>
            </div>
            <div>
              <div class="pf-pos-meta-label">Market</div>
              <div class="pf-pos-meta-val">${formatPrice(pos.market_price)}</div>
            </div>
            <div>
              <div class="pf-pos-meta-label">P/L</div>
              <div class="pf-pos-meta-val ${pnlClass}">${pnlSign}${sym}${Math.abs(pnl).toLocaleString('en', {minimumFractionDigits:2})}</div>
            </div>
          </div>
          ${planInfo}
          ${swap !== 0 ? '<div class="pf-pos-signal-row"><span class="pf-signal-tag neutral">Swap ' + (swap >= 0 ? '+' : '') + sym + Math.abs(swap).toFixed(2) + '</span></div>' : ''}
        </div>
      </div>`;
    }).join('');

  }

})();
