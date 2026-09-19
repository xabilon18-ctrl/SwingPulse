/* ═══════════════════════════════════════════════════════════════════════════
   SwingPulse — Interactive Trading Dashboard  (TradingView Integration)
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────
  let allData = [];
  let summaryData = {};
  let backtestData = null;   // { overall, by_signal, generated_at } from backtest.py
  let ledgerData = null;     // { totals, by_signal, by_code } from signal_ledger.py (live fires)
  // Radar payloads keyed by timeframe. sector_radar.json is 3.4 KB, so both
  // are fetched at boot and the switch is a re-point, not a round trip.
  // 4H has NO radar of its own — there is only ~2 years of hourly cache, too
  // little to build a baseline from — so it reads the daily one and the card
  // says so rather than letting a daily reading pass for a 4H one.
  let sectorRadarByTf = { D: null, '3D': null, W: null };
  // Chart-shape lookalikes + families (shape_similarity.py). DESCRIPTIVE, not
  // predictive: it says which charts have moved alike, which is how the app can
  // warn that five "separate" buys are one bet. Never feeds confidence.
  let shapeSim = { neighbours: {}, families: [], family_of: {} };
  // Sector rotation wheel + market ranking + its paper record (rotation.py).
  let rotationData = null;
  let rotationPaper = null;
  let leadersShowAll = false;
  let sectorRadarData = null; // the active timeframe's radar (see syncRadarTf)
  const RADAR_TF_FOR = tf => (tf === 'W' ? 'W' : tf === '3D' ? '3D' : 'D');
  // Timeframes with no radar of their own — mirrors config.INTRADAY_PREFIXES.
  const INTRADAY_TFS = new Set();   // none since 1H and 4H were removed (2026-09-11)
  let instFlavours = {};      // { instrument_name: flavour } — sector-mood conviction layer (validated on real R 2026-07-22)
  let flavourMkt = { market_wide: false }; // top-level market-state from instrument_flavours.json
  let tvMap = {};            // instrument_name → TradingView symbol
  let aiSet = new Set();     // instruments with AI exposure
  let aiFilterActive = false;
  let currentTab = 'dashboard';
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
  // ── Move filter (period return) ──
  // The four period returns ship unprefixed from the pipeline (config.py
  // OUTPUT_COLUMNS: pct_1d/pct_1w/pct_1m/pct_1y) and are DAILY-close based on
  // every timeframe — there is no h4_pct_*, so these never go through f().
  // Direction and size are separate axes on purpose: "any 10%+ move" and "any
  // move up" are both things you want, and folding them into one list of
  // up2/up5/down2/… buttons would have needed 12 rows to say the same thing.
  const MOVE_PERIODS = { pct_1d: '1D', pct_1w: '1W', pct_1m: '1M', pct_1y: '1Y' };
  let scannerMovePeriod = 'pct_1d';   // which return the Move filter reads
  let scannerMoveDir = 'all';         // 'all' | 'up' | 'down'
  let scannerMoveMin = 0;             // minimum |move| in %, 0 = any size
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
  let syncUser = localStorage.getItem('sp-user') || '';

  // Sync auth. This file is PUBLIC — it used to carry a hard-coded
  // `SYNC_SECRET` literal, the one credential the Worker
  // accepted, so anyone who opened the site could overwrite a user's starred
  // list and notes or fan out push notifications to their phones. Reads
  // needed nothing at all. Now each user has a password they type once per
  // device; what leaves the browser is sha256("swingpulse:user:password"), and
  // the Worker stores only a hash OF THAT. Nothing reusable is in the bundle.
  // The CI push trigger keeps its own server-side secret (GitHub → Worker).
  async function syncTokenFor(user, password) {
    if (!crypto.subtle) return '';        // http:// LAN dev — no secure context
    const buf = await crypto.subtle.digest(
      'SHA-256', new TextEncoder().encode(`swingpulse:${user}:${password}`));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function syncToken()   { return syncUser ? (localStorage.getItem(sk('sp-sync-token')) || '') : ''; }
  function syncHeaders(extra) {
    const t = syncToken();
    return t ? { ...(extra || {}), 'Authorization': `Bearer ${t}` } : (extra || {});
  }

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
    ['swingpulse-starred','sp-notes','sp-channels','sp-open-trades','sp-closed-trades','sp-last-modified'].forEach(base => {
      const legacy = localStorage.getItem(base);
      if (legacy !== null && localStorage.getItem(sk(base)) === null) {
        localStorage.setItem(sk(base), legacy);
      }
    });
  }
  migrateUserData();

  let userStarred = new Set(JSON.parse(localStorage.getItem(sk('swingpulse-starred')) || '[]'));
  let charts = {};
  // ── The timeframe table — ONE definition, ordered fast to slow ────────
  // Mirrors config.TIMEFRAMES on the Python side. Every per-timeframe fact
  // lives on the row: the column prefix f() applies, the button label, the
  // TradingView interval, and the word for one bar. Before Weekly these were
  // scattered as ~12 separate `timeframe === '4H' ? a : b` ternaries, which is
  // a shape that silently answers "Daily" for any third timeframe.
  const TIMEFRAMES = [
    // 10m is CHART ONLY, and the fastest row in the table. `chartOnly` is what
    // tells the rest of the app that no m10_ column exists on a row — D, 3D and
    // W all have their own columns, so on this one a prefixed read returns
    // nothing at all, and anything reading one must borrow the signal timeframe
    // instead of silently answering "" / NEUTRAL. (The flag arrived with
    // Monthly, which held this slot until 2026-09-14.)
    { code: '10m', prefix: 'm10_', label: '10m', tv: '10', bar: '10-minute bars', barShort: '25-bar', chartOnly: true },
    // 4H is BACK as of 2026-09-17, at the user's request — and back as a CHART
    // ONLY, like 10m. The signals stay gone (see SIGNAL_TFS below and the
    // 2026-09-11 finding: 71.7% agreement with Daily, 82% of its fires never
    // confirmed), so no h4_ column exists on a row and `chartOnly` is what keeps
    // the trend/stack filters from reading one. Its calendar grid is QUARTERS —
    // REEL_TIME_GRID, which kept the entry through the removal.
    { code: '4H', prefix: 'h4_', label: '4H', tv: '240', bar: '4-hour bars', barShort: '25-bar', chartOnly: true },
    { code: 'D',  prefix: '',    label: 'Daily',  tv: 'D',   bar: 'days',    barShort: '25-day'  },
    { code: '3D', prefix: 'd3_', label: '3D',     tv: '3D',  bar: '3-day bars', barShort: '25-bar' },
    { code: 'W',  prefix: 'w_',  label: 'Weekly', tv: 'W',   bar: 'weeks',   barShort: '25-week' },
  ];
  const TF_BY_CODE = Object.fromEntries(TIMEFRAMES.map(t => [t.code, t]));
  const isTf = c => Object.prototype.hasOwnProperty.call(TF_BY_CODE, c);
  const tfMeta = () => TF_BY_CODE[timeframe] || TF_BY_CODE.D;

  let timeframe = 'D';
  // Which timeframes each tab may show (2026-09-11). Buy/sell signals exist on
  // Daily and Weekly only: 1H/4H/3D signals never beat a random entry taken the
  // same day, and 4H/3D mostly repeat Daily, so those three are CHART VIEWS.
  // Charts offers all five (10m · 4H · Daily · 3D · Weekly), the signal tabs
  // offer D/W, Trends is Daily data.
  // Charts and the signal tabs remember their timeframe separately, so zooming
  // a chart to 4H never turns the Signals tab into 4H.
  const SIGNAL_TFS = new Set(['D', 'W']);
  const TAB_TFS = { charts: TIMEFRAMES.map(t => t.code), trends: ['D'] };
  const tabTfs = tab => TAB_TFS[tab] || [...SIGNAL_TFS];
  const tfPrefs = { signals: 'D', charts: 'D' };
  // Run fn with the signal timeframe active when the current one is a chart
  // view. fn MUST be synchronous: the swap is undone before anything else can
  // render, so no other code ever sees the borrowed timeframe.
  function withSignalTf(fn) {
    const saved = timeframe;
    if (!SIGNAL_TFS.has(timeframe)) timeframe = tfPrefs.signals;
    try { return fn(); } finally { timeframe = saved; }
  }
  let openModalName = null;   // instrument whose detail modal is currently open (for tf re-render)
  let eventsData = { events: [], sources: {} };  // scheduled events (events.json)
  // Which dropdown segment is open. Persisted like stars, notes and the
  // scanner filters are — it used to reset to Today on every reload, so anyone
  // living in the calendar re-tapped it every single time.
  const NOTIF_TAB_KEY = 'swingpulse-notif-tab';
  let notifTab = (() => {
    try { return localStorage.getItem(NOTIF_TAB_KEY) === 'calendar' ? 'calendar' : 'today'; }
    catch { return 'today'; }
  })();
  let calMonth   = null;     // Date pinned to the 1st of the month on screen
  let calSelected = null;    // 'YYYY-MM-DD' of the open day sheet, or null
  let trendsData = {};       // instrument_name → [{direction, start, end, days}]
  let selectedTrendInst = null;
  localStorage.removeItem('sp-signal-history');   // retired per-device tracker (2026-07-15)
  let explanationsData = {};                                                    // instrument_name → AI text
  let instrumentNotes  = JSON.parse(localStorage.getItem(sk('sp-notes')) || '{}'); // instrument_name → note text
  let namesData        = {};   // ticker → full display name (e.g. 'NVDA' → 'NVIDIA')
  // Hand-drawn trend channels, ONE PER INSTRUMENT — deliberately not per
  // timeframe. A channel is anchored in (date, price), and a date and a price
  // mean the same thing on 1H as on Weekly, so the same channel is a trend
  // read on every tab. Draw it once on the timeframe where the structure is
  // clearest and it shows up on the rest.
  //   { [instrument]: { [timeframe]: [ { t1, p1, t2, p2, up, dn, locked }, ... ] } }
  // A LIST per chart, so more than one channel can sit on the same instrument
  // and timeframe.
  // Keyed by timeframe as well as instrument: a channel belongs to the chart it
  // was drawn on. Sharing one across every timeframe was the first design and
  // it was wrong in use — the same lines turned up on 1H where they meant
  // nothing, and there was no way to keep a Weekly channel without also
  // carrying it everywhere else.
  // t*/p* anchor a SPINE that is never drawn and never moves when an edge does.
  // `up` and `dn` are independent price offsets from it to the upper and lower
  // edge, which is what lets one side be dragged without disturbing the other.
  // Both edges share the spine's slope, so they stay parallel — that is what
  // makes it a channel rather than two loose lines. The midline is computed as
  // (up+dn)/2 from the spine, so it is exactly halfway between the edges
  // wherever they are, rather than assumed to be. `locked` means finished: it
  // still draws, but grows no handles and cannot be entered for editing until
  // unlocked, so no stray touch moves it.
  // Channels written before the midline model carried {p1,p2,w}: p* on the
  // LOWER line with w the signed offset to the other one. Converting on read
  // keeps every channel already drawn — the geometry is identical, the anchor
  // simply moves to the middle of it.
  // Three shapes have existed. Each converts to the current one with identical
  // geometry, so no drawn channel is ever lost or moved:
  //   {p1,p2,w}    — p* on the lower line, w the offset to the other
  //   {p1,p2,half} — p* on the midline, edges mirrored at +/- half
  //   {p1,p2,up,dn} — current: p* a spine, edges offset independently
  function migrateChannel(ch) {
    if (!ch || typeof ch !== 'object') return null;
    // Drawings other than channels carry their own kind and need no conversion.
    if (ch.kind && ch.kind !== 'channel') return ch;
    if (typeof ch.up === 'number' && typeof ch.dn === 'number') {
      if (!ch.kind) ch.kind = 'channel';
      return ch;
    }
    if (typeof ch.half === 'number') {
      return { t1: ch.t1, p1: ch.p1, t2: ch.t2, p2: ch.p2,
               up: Math.abs(ch.half), dn: -Math.abs(ch.half), locked: !!ch.locked };
    }
    if (typeof ch.w === 'number') {
      const h = Math.abs(ch.w) / 2;
      return { t1: ch.t1, p1: ch.p1 + ch.w / 2, t2: ch.t2, p2: ch.p2 + ch.w / 2,
               up: h, dn: -h, locked: !!ch.locked };
    }
    return null;
  }

  // Legacy stores were flat — one channel per instrument, shown on everything.
  // There is no record of which chart it was drawn on, so it is copied to every
  // timeframe: nothing a reader has drawn disappears, nothing moves, and from
  // the first edit onward each timeframe goes its own way. Clearing the ones
  // you do not want is a tap per chart.
  // Read from the timeframe table rather than restated — a hand-copied list is
  // exactly how 3D got added to one place and not another last week.
  const CHANNEL_TFS = TIMEFRAMES.map(t => t.code);

  function expandChannelStore(raw) {
    const out = {};
    for (const name of Object.keys(raw || {})) {
      const v = raw[name];
      if (!v || typeof v !== 'object') continue;
      if (v.t1 || typeof v.p1 === 'number') {          // flat = pre-timeframe
        const m = migrateChannel(v);
        if (!m) continue;
        out[name] = {};
        for (const tf of CHANNEL_TFS) out[name][tf] = [{ ...m }];
      } else {
        const per = {};
        for (const tf of Object.keys(v)) {
          // A single object is the pre-list shape; a list is current.
          const src  = v[tf];
          const list = (Array.isArray(src) ? src : [src])
            .map(migrateChannel).filter(Boolean);
          // An EMPTY ARRAY is kept, where it used to be dropped. It is now
          // meaningful: "this chart's channels were deleted", as against "this
          // chart has none yet", which is what seeds an untouched chart with two.
          if (list.length || Array.isArray(src)) per[tf] = list;
        }
        if (Object.keys(per).length) out[name] = per;
      }
    }
    return out;
  }

  let instChannels = (() => {
    try { return expandChannelStore(JSON.parse(localStorage.getItem(sk('sp-channels')) || '{}')); }
    catch (_) { return {}; }
  })();

  // ── Drawing sync: one edit time per chart ──────────────────────────
  // Drawings used to sync as ONE blob, last writer wins. So a device that had
  // not pulled yet — a laptop left open, a phone woken from the background —
  // pushed its old copy the moment you touched anything, and the drawing just
  // made on the other device was overwritten on the server and then pulled back
  // off the device that drew it. Now every (instrument, timeframe) carries the
  // time it was last edited, and two copies are merged chart by chart: the
  // newer edit wins, a deletion is a newer edit with nothing in it.
  const chKey = (name, tf) => name + '|' + tf;
  let channelMod = (() => {
    try { return JSON.parse(localStorage.getItem(sk('sp-channels-mod')) || '{}') || {}; }
    catch (_) { return {}; }
  })();
  // What each chart looked like when last saved or merged, so channelSave can
  // tell which charts THIS device changed without every caller saying so.
  let channelSnap = {};

  // Undo / redo (2026-09-15). Per CHART (instrument|timeframe), in memory for
  // this visit. Entries are the whole chart's drawing list as JSON, so any
  // change — add, drag, colour, lock, duplicate, delete — undoes as one step.
  const drawUndo = new Map(), drawRedo = new Map();
  const DRAW_HISTORY_MAX = 50;
  let drawHistoryMuted = false;
  function drawHistoryPush(map, k, json) {
    const st = map.get(k) || [];
    st.push(json);
    if (st.length > DRAW_HISTORY_MAX) st.shift();
    map.set(k, st);
  }

  function channelSnapAll() {
    channelSnap = {};
    for (const name of Object.keys(instChannels))
      for (const tf of Object.keys(instChannels[name] || {}))
        channelSnap[chKey(name, tf)] = JSON.stringify(instChannels[name][tf]);
  }
  channelSnapAll();

  function channelStampChanges() {
    const now = Date.now();
    const cur = {};
    for (const name of Object.keys(instChannels))
      for (const tf of Object.keys(instChannels[name] || {}))
        cur[chKey(name, tf)] = JSON.stringify(instChannels[name][tf]);
    for (const k of new Set([...Object.keys(cur), ...Object.keys(channelSnap)]))
      if (cur[k] !== channelSnap[k]) {
        channelMod[k] = now;
        // Every saved change is one undo step for that chart — the state it
        // replaced goes on the chart's undo stack and its redo stack is spent.
        if (!drawHistoryMuted) {
          drawHistoryPush(drawUndo, k, channelSnap[k] == null ? null : channelSnap[k]);
          drawRedo.delete(k);
        }
      }
    channelSnap = cur;
    try { localStorage.setItem(sk('sp-channels-mod'), JSON.stringify(channelMod)); } catch (_) {}
  }

  // Merge a remote copy into this device's drawings. Returns true if anything
  // on screen changed. `remoteNewer` only breaks a tie between two copies that
  // were never timestamped (drawings made before this shipped) — it is the old
  // whole-blob rule, applied to those charts alone.
  function channelMergeRemote(remote, remoteNewer) {
    if (!remote || !remote.channels || typeof remote.channels !== 'object') return false;
    const rCh  = expandChannelStore(remote.channels);
    const rMod = (remote.channelsMod && typeof remote.channelsMod === 'object') ? remote.channelsMod : {};
    let editingName = null;
    try { editingName = reel.editing; } catch (_) {}
    const keys = new Set(Object.keys(rMod).concat(Object.keys(channelMod)));
    for (const obj of [instChannels, rCh])
      for (const name of Object.keys(obj))
        for (const tf of Object.keys(obj[name] || {})) keys.add(chKey(name, tf));
    let changed = false;
    for (const k of keys) {
      const cut = k.lastIndexOf('|');
      const name = k.slice(0, cut), tf = k.slice(cut + 1);
      if (!name || !tf) continue;
      // Never swap a chart out from under a drawing that is open for editing
      // here — its handles hold the objects being dragged. It saves on release,
      // and that save is the newer edit.
      if (name === editingName) continue;
      const lm = +channelMod[k] || 0, rm = +rMod[k] || 0;
      const localList  = instChannels[name] && instChannels[name][tf];
      const remoteList = rCh[name] && rCh[name][tf];
      const takeRemote = rm > lm || (rm === 0 && lm === 0 && remoteNewer && remoteList);
      if (!takeRemote) continue;
      if (JSON.stringify(localList || null) !== JSON.stringify(remoteList || null)) {
        if (remoteList) {
          // Including an EMPTY one — that is another device saying these
          // channels were deleted, and dropping the key here would re-seed them.
          if (!instChannels[name]) instChannels[name] = {};
          instChannels[name][tf] = remoteList;
        } else if (instChannels[name]) {
          delete instChannels[name][tf];
          if (!Object.keys(instChannels[name]).length) delete instChannels[name];
        }
        changed = true;
        // Another device changed this chart; an undo here would put back a
        // state that no longer exists anywhere else.
        drawUndo.delete(k); drawRedo.delete(k);
      }
      if (rm > lm) channelMod[k] = rm;
    }
    channelSnapAll();
    try {
      localStorage.setItem(sk('sp-channels'), JSON.stringify(instChannels));
      localStorage.setItem(sk('sp-channels-mod'), JSON.stringify(channelMod));
    } catch (_) {}
    return changed;
  }

  // Every channel on one instrument on the CHART CURRENTLY SHOWN.
  //
  // A chart with nothing stored answers with its SEEDS — the two channels every
  // chart opens with (see reelSeedChannels). A stored EMPTY list is not the same
  // thing and does not seed: that is a chart whose channels were deleted.
  function channelsFor(name) {
    const per = instChannels[name];
    const stored = per && per[timeframe];
    if (stored) return stored;
    return channelSeeds.get(name + '|' + timeframe) || [];
  }

  // ── The two channels every chart starts with (2026-09-18) ───────────────
  // Held HERE, in memory, and not in instChannels — a chart you merely scrolled
  // past must not write drawings into storage. That store syncs to every device
  // and every write to it is an undo step, so seeding on sight would fill the
  // sync blob with drawings nobody drew and make Undo step through charts the
  // reader never touched. The seeds are committed the moment a chart is edited,
  // through setActiveIdx — the one call every edit passes through — and from
  // then on they are ordinary drawings: draggable, lockable, deletable, undoable
  // and synced. Cleared per publish, since a new bundle is a new window to fit.
  const channelSeeds = new Map();

  function channelSeedsFor(name, b) {
    const k = name + '|' + timeframe;
    if (channelSeeds.has(k)) return channelSeeds.get(k);
    const per = instChannels[name];
    if (per && per[timeframe]) return per[timeframe];      // stored wins, seeds never built
    const seeds = reelSeedChannels(b);
    channelSeeds.set(k, seeds);
    return seeds;
  }

  // Every props-row action that edits the drawings on a chart. The dispatcher
  // commits the seeds before running any of them (see the note there).
  const DRAW_MUTATING_ACTS = new Set([
    'channel-add', 'draw-lock', 'draw-dup', 'draw-bold', 'draw-labels',
    'draw-delete', 'draw-color', 'draw-undo', 'draw-redo',
  ]);

  // Commit this chart's seeds into the store, by REFERENCE — a drag already
  // holding one of these objects keeps working on the copy that is now saved.
  function channelSeedCommit(name) {
    const k = name + '|' + timeframe;
    const seeds = channelSeeds.get(k);
    if (!seeds) return;
    channelSeeds.delete(k);
    if (!seeds.length) return;
    if (instChannels[name] && instChannels[name][timeframe]) return;
    if (!instChannels[name]) instChannels[name] = {};
    instChannels[name][timeframe] = seeds;
  }

  // Which one Lock and Clear act on, and which one draws its handles solid:
  // the last one added or dragged. Kept per (instrument, timeframe) so moving
  // between charts does not carry a selection that means nothing there.
  function activeIdx(name) {
    const list = channelsFor(name);
    if (!list.length) return -1;
    const k = name + '|' + timeframe;
    const i = reel.activeCh.get(k);
    return (typeof i === 'number' && i >= 0 && i < list.length) ? i : list.length - 1;
  }

  // Selecting a drawing is the first act of every edit — a handle grab and a tap
  // both land here — so this is where seeds stop being defaults and become this
  // chart's own drawings.
  function setActiveIdx(name, i) {
    channelSeedCommit(name);
    reel.activeCh.set(name + '|' + timeframe, i);
  }

  function activeChannel(name) {
    const i = activeIdx(name);
    return i < 0 ? null : channelsFor(name)[i];
  }

  function addChannelFor(name, ch) {
    if (!instChannels[name]) instChannels[name] = {};
    if (!Array.isArray(instChannels[name][timeframe])) instChannels[name][timeframe] = [];
    instChannels[name][timeframe].push(ch);
    setActiveIdx(name, instChannels[name][timeframe].length - 1);
  }

  // Remove only the ACTIVE channel — clearing the whole chart because you meant
  // to delete one of two would be the expensive mistake here.
  function clearChannelFor(name) {
    const per = instChannels[name];
    if (!per || !Array.isArray(per[timeframe])) return;
    const i = activeIdx(name);
    if (i < 0) return;
    per[timeframe].splice(i, 1);
    reel.activeCh.delete(name + '|' + timeframe);
    // The key STAYS, holding an empty list, where it used to be deleted: an
    // absent key now means "never touched" and seeds two channels, so deleting
    // the last one would have brought both straight back on the next repaint.
  }

  function syncApplyRemote(remote) {
    // Apply remote data, then re-render affected sections.
    // An EMPTY remote list never replaces a populated local one. remote.starred
    // used to be applied on the strength of its timestamp alone, so one device
    // pushing [] wiped every other device on its next pull. If the remote is
    // genuinely empty the local list is the better copy, and the next push
    // restores it; the cost of being wrong here is a stale star, against losing
    // the whole list the other way.
    if (Array.isArray(remote.starred) && (remote.starred.length || !userStarred.size)) {
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
    if (!syncUser || !syncToken()) return;
    const badge = document.getElementById('syncUserBadge');
    try {
      const res = await fetch(`${SYNC_WORKER}/sync?user=${syncUser}`,
                              { cache: 'no-store', headers: syncHeaders() });
      if (res.status === 401) { syncPasswordRejected(); return; }
      if (!res.ok) return;
      const remote = await res.json();
      if (!remote || !remote.lastModified) return;
      const localMod = parseInt(localStorage.getItem(sk('sp-last-modified')) || '0');
      // Drawings merge chart by chart on EVERY pull, whatever the blob's own
      // timestamp says — see channelMergeRemote.
      const drawingsChanged = channelMergeRemote(remote, remote.lastModified > localMod);
      if (drawingsChanged && !(remote.lastModified > localMod)) {
        try { reelRepaintVisible(); } catch (_) {}
      }
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

  // `intentional` means the user just changed their stars by tapping a star.
  // Only such a push is allowed to send an empty list; anything else (a note
  // edit, a background flush) OMITS the key entirely and the Worker keeps what
  // it already has. Without this, editing a note on a device whose list had not
  // loaded yet uploaded [] over the real list — and the Worker had no history.
  async function syncPushNow(intentional) {
    if (!syncUser) return;
    // Always record locally — a device with no sync password still works, it
    // just keeps its stars to itself.
    localStorage.setItem(sk('sp-last-modified'), String(Date.now()));
    if (!syncToken()) return;

    // Read before writing, so drawings made on another device since this one
    // last pulled are merged in rather than overwritten by this device's copy.
    // Offline, nothing is sent — the next push after reconnecting does it.
    try {
      const got = await fetch(`${SYNC_WORKER}/sync?user=${syncUser}`,
                              { cache: 'no-store', headers: syncHeaders() });
      if (got.status === 401) { syncPasswordRejected(); return; }
      if (got.ok && channelMergeRemote(await got.json(), false)) {
        try { reelRepaintVisible(); } catch (_) {}
      }
    } catch (_) { return; }

    const stars = [...userStarred];
    const payload = { notes: instrumentNotes, channels: instChannels,
                      channelsMod: channelMod, lastModified: Date.now() };
    if (stars.length || intentional) payload.starred = stars;
    const clearing = intentional && !stars.length ? '&allowEmpty=1' : '';
    fetch(`${SYNC_WORKER}/sync?user=${syncUser}${clearing}`, {
      method:  'PUT',
      headers: syncHeaders({ 'Content-Type': 'application/json' }),
      body:    JSON.stringify(payload),
    }).then(res => {
      if (res.status === 401) syncPasswordRejected();
      // 409 = the Worker refused a destructive write. Not an error the user
      // caused and not one they can fix, so it is logged, not surfaced.
      else if (res.status === 409) console.warn('[sync] refused an empty starred list — server copy kept');
    }).catch(() => { /* offline — silent */ });
  }

  // Debounce pushes so rapid changes (e.g. starring several instruments) send one request
  function syncPush(intentional) {
    clearTimeout(syncPushTimer);
    syncPushTimer = setTimeout(() => syncPushNow(intentional), 800);
  }

  // ── Sync password step (shown after picking a user on a new device) ──────
  function upShowStep(step, msg) {
    const who  = document.getElementById('upStepWho');
    const pass = document.getElementById('upStepPass');
    if (!who || !pass) return;
    who.style.display  = step === 'pass' ? 'none'  : 'block';
    pass.style.display = step === 'pass' ? 'block' : 'none';
    const label = document.getElementById('upPassWho');
    if (label) label.textContent = syncUser ? syncUser.charAt(0).toUpperCase() + syncUser.slice(1) : '';
    upPassMsg(msg || '');
    if (step === 'pass') {
      const inp = document.getElementById('upPassInput');
      if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 60); }
    }
  }
  function upPassMsg(text, ok) {
    const el = document.getElementById('upPassMsg');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = ok ? 'var(--buy)' : 'var(--sell)';
  }

  // The stored password no longer works (changed on another device, or the
  // account was claimed by someone else). Drop it and ask again.
  function syncPasswordRejected() {
    if (!syncUser) return;
    localStorage.removeItem(sk('sp-sync-token'));
    showUserPicker();
    upShowStep('pass', 'Sync password needed again — please re-enter it.');
  }

  window.SP_submitSyncPassword = async function() {
    const inp = document.getElementById('upPassInput');
    const pw  = (inp && inp.value || '').trim();
    if (pw.length < 4) { upPassMsg('At least 4 characters.'); return; }
    const token = await syncTokenFor(syncUser, pw);
    if (!token) { upPassMsg('Sync needs a secure (https) connection.'); return; }
    upPassMsg('Checking…', true);
    let res;
    try {
      res = await fetch(`${SYNC_WORKER}/sync/auth?user=${syncUser}`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${token}` },
      });
    } catch (_) { upPassMsg("Can't reach sync right now — try again later."); return; }
    if (res.status === 429) { upPassMsg('Too many tries. Wait an hour and retry.'); return; }
    if (res.status === 401) { upPassMsg(`That's not the sync password for ${syncUser}.`); return; }
    if (!res.ok)            { upPassMsg('Sync said no (' + res.status + '). Try again later.'); return; }
    let claimed = false;
    try { claimed = !!(await res.json()).claimed; } catch (_) {}
    localStorage.setItem(sk('sp-sync-token'), token);
    hideUserPicker();
    updateSyncBadge();
    if (claimed) console.info('[sync] password set for', syncUser);
    syncPull().then(() => { if (allData.length) renderAll(); });
  };

  function showUserPicker() {
    const overlay = document.getElementById('userPickerOverlay');
    if (overlay) overlay.style.display = 'flex';
    upShowStep('who');
  }
  function hideUserPicker() {
    const overlay = document.getElementById('userPickerOverlay');
    if (overlay) overlay.style.display = 'none';
  }
  // Backdrop tap dismisses too (clicks on the sheet itself must not).
  (function wireUserPickerDismiss() {
    const overlay = document.getElementById('userPickerOverlay');
    if (!overlay) return;
    overlay.addEventListener('click', e => { if (e.target === overlay) hideUserPicker(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && overlay.style.display !== 'none') hideUserPicker();
    });
  })();

  window.toggleAIFilter = toggleAIFilter;   // exposed for nav button onclick

  window.SP_setUser = function(name) {
    syncUser = name.toLowerCase();
    localStorage.setItem('sp-user', syncUser);
    // Migrate any legacy (non-namespaced) data into this user's bucket
    migrateUserData();
    // Reload user-specific data from their own storage bucket
    userStarred    = new Set(JSON.parse(localStorage.getItem(sk('swingpulse-starred')) || '[]'));
    instrumentNotes = JSON.parse(localStorage.getItem(sk('sp-notes')) || '{}');
    try { instChannels = expandChannelStore(JSON.parse(localStorage.getItem(sk('sp-channels')) || '{}')); }
    catch (_) { instChannels = {}; }
    try { channelMod = JSON.parse(localStorage.getItem(sk('sp-channels-mod')) || '{}') || {}; }
    catch (_) { channelMod = {}; }
    channelSnapAll();
    updateSyncBadge();
    // A device that has never synced this user needs the password once; after
    // that the token is stored and this step never shows again.
    if (!syncToken()) { upShowStep('pass'); return; }
    hideUserPicker();
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
    // A tapped notification says what it was about. Nothing used to read that,
    // so every tap landed on the dashboard and left you to go find the thing.
    navigator.serviceWorker.addEventListener('message', ev => {
      const d = ev.data || {};
      if (d.type !== 'OPEN_TARGET') return;
      openFromNotification(d.ticker, d.date);
    });
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
        headers: syncHeaders({ 'Content-Type': 'application/json' }),
        body:    JSON.stringify(sub),
      });
      if (res.status === 401) { syncPasswordRejected(); return false; }
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
      await fetch(`${SYNC_WORKER}/push/subscribe?user=${syncUser}`,
                  { method: 'DELETE', headers: syncHeaders() });
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
    btn.title = 'Notifications and calendar';
    // A calendar, not a bell: most of what lives behind this button is now in
    // the future. The green live dot (.push-on::after) still means push is on.
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/></svg>';
    const pt = document.getElementById('notifPushToggle');
    if (pt) {
      pt.textContent = on ? 'Push: on' : 'Push: off';
      pt.classList.toggle('push-on', on);
    }
  }

  // Default MA periods. Will be overwritten by auto-detection once data loads —
  // this makes the app work correctly across MA scheme changes without code edits.
  let detectedMaPeriods = [50, 250, 500];
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
      detectedMaPeriods = found.filter(p => p <= 500);   // ribbon MAs (MA50–MA500)
    }
  }

  // ── Timeframe field accessor ────────────────────────────────────────
  // Returns the correct field name for the active timeframe.
  function f(field) {
    return tfMeta().prefix + field;
  }

  // Relative volume (RVOL): today's volume ÷ rolling-average volume, for the
  // active timeframe. Returns null when volume isn't reported (forex/CFDs) or
  // the average is zero, so callers can simply skip rendering.
  //
  // v233: a volume of ZERO is "not reported", not "nothing traded". Yahoo
  // serves a good price with 0 volume on cash indices routinely — ^IBEX did it
  // on 52 of 60 sessions — and returning 0 here rendered a confident "0.0×"
  // across whole groups (SPAIN35 all 19 names, UK100 median 0.00× on the
  // 07-31 payload). Treated as missing it falls through to the same "—" the
  // never-report instruments already show.
  function rvol(item) {
    const v  = parseFloat(item[f('volume')]);
    const av = parseFloat(item[f('volume_average')]);
    if (!isFinite(v) || !isFinite(av) || av <= 0 || v <= 0) return null;
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

  // Reads the DAILY chart bundle — always daily, whatever timeframe the app is
  // on, because these sparklines are defined as daily volume vs its 25-day
  // average. This used to fetch `history/<name>.json`, a feed whose builder had
  // been dead code since the Lightweight Charts view was removed: it served
  // whatever was last written to it, which by 2026-08 was two months stale.
  async function fetchVolHistory(item) {
    const key = item.instrument_name;
    if (volHistCache.has(key)) return volHistCache.get(key);
    let out = null;
    try {
      const data = await reelLoadChunk(key, 'D');
      const b = data && data[key];
      const vols = (b && b.v) ? b.v.map(v => +v || 0) : [];
      if (vols.some(v => v > 0)) out = {
        vols,
        avgs:   rollingAvg(vols, 25),
        closes: (b.c || []).map(v => +v || 0),
        dates:  b.t || [],
      };
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
    // Neutral oscillation (MA50 chopping + MA250 flattening = potential top/bottom)
    // takes priority: these are classified NEUTRAL regardless of the raw timeframe
    // trend, so they never double-count as Uptrend/Downtrend/Aligned Bull.
    //
    // GATED TO DAILY (2026-09-02). The flag is computed from DAILY bars only —
    // `ma_fast_cross_count >= 3` over the last 30 daily bars with a flat daily MA250
    // slope (indicators.add_neutral_oscillation) — and there is no h4_ or w_
    // counterpart. It was nonetheless applied on every timeframe, so a fortnight
    // of day-to-day chop could overrule a 4H or Weekly ribbon read. On Weekly
    // that is exactly backwards: a decade-scale ribbon exists to ignore daily
    // noise, and 22 instruments were reading NEUTRAL on Weekly purely because
    // their DAILY bars were choppy (508 UPTREND in the payload, 486 on screen).
    // Measured on the 2026-09-02 run — 36 instruments carry the flag, and it was
    // overriding 25 4H rows and 23 Weekly rows on top of its 16 legitimate Daily
    // ones. Same discipline as moodApplies(): a read only applies on the
    // timeframe it was measured on.
    if (timeframe === 'D' && item.neutral_oscillation === 'yes') return 'NEUTRAL';
    const td = item[f('trend_direction')] || '';
    return (td === 'UPTREND' || td === 'DOWNTREND') ? td : 'NEUTRAL';
    // NB there used to be a confirmation_status keyword fallback here, for
    // "Neutral — transitioning (rising/declining ribbon)" statuses. signals.py
    // stopped emitting those, so by 2026-07-30 the only strings it still caught
    // were "Pullback below MA500 — uptrend intact" and "Rally above MA500 —
    // downtrend intact" (57 rows on the 07-28 run). Those come from the
    // in_uptrend/in_downtrend LATCH, which only clears on a full-ribbon B1/S1
    // cross — so the fallback was quietly overriding the ribbon-position read
    // in trend_direction with a regime flag that can be months stale. Trend
    // direction is decided in indicators.add_trend; do not second-guess it here.
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

  // "Fired on the newest bar we hold for THIS instrument" — the single
  // definition of a fresh fire. Per-instrument on purpose: feeds run at
  // different times and some names lag (a stale instrument's newest bar is not
  // today's date), so comparing against a global run date would call a
  // three-day-old fire "today". This is also what the card badge reads as
  // "Today"/"Latest bar" via signalAge(fireDate, itemDate).
  function firedOnLatestBar(item) {
    const fired = item[f('last_signal_date')] || '';
    return !!fired && fired === (item[f('date')] || '');
  }

  function moodApplies(item) {
    if (timeframe !== 'D') return false;                          // validated on daily only
    return firedOnLatestBar(item);
  }

  // Sector-mood modifier for a fired signal: +1 sector-confirmed, −1 fighting/trap,
  // 0 when the sector has no validated opinion (calm, busy-but-no-edge, unknown,
  // or the guards above rule the layer out). `pips` is kept 0/2/3 for the existing
  // conviction sort, card glow/dim and Mood filter. Returns null when no signal.
  function convictionOf(item) {
    // Retired 2026-09-11: the sector-mood grade was measured on the same trades
    // it graded. Kept as a null so the old callers (card glow/dim, Mood filter,
    // conviction sort) all fall through to 'no opinion'.
    return null;
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

  // What fired, in plain words (2026-09-11). This used to GRADE the signal —
  // ★ HIGH-CONVICTION / STRONG / LOW-EDGE / AVOID, from the backtest confidence
  // tier plus the sector mood. Neither survived a fair test: entries did no
  // better than random ones taken the same day in other markets, and the tiers
  // were fitted on the same trades they claimed to predict. A sell reads as a
  // warning for longs, because shorts lost after costs under every exit tested.
  const SIG_PLAIN = {
    B1: 'closed above all three MAs',        S1: 'closed below all three MAs',
    B2: 'dipped under MA50, closed back above', S2: 'rose over MA50, closed back below',
    B3: 'touched MA250, closed above',       S3: 'touched MA250, closed below',
    B4: 'touched MA500, closed above',       S4: 'touched MA500, closed below',
  };
  function verdictOf(item) {
    const code = item[f('primary_signal')] || item[f('last_signal_type')] || '';
    if (!code) return null;
    const buy = code[0] === 'B';
    return {
      label: `${code} · ${SIG_PLAIN[code] || (buy ? 'buy event' : 'sell event')}`,
      sub: buy ? '' : 'trend weakening · a warning for longs, not a short',
      note: '',
      tone: buy ? 'buy' : 'warn',
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

  // ── Shared card vocabulary ────────────────────────────────────────────────
  // The Signals card, the Analyzed row and the Trends card describe the SAME
  // instrument, and until now each said it differently: three spellings of the
  // identity block, two hand-copies of the action buttons, and the verdict —
  // the app's actual headline judgement — visible on exactly one of the three.
  //
  // These are deliberately NOT one identical card. The tabs answer different
  // questions (what should I look at / what have I studied / how long has this
  // run), so density SHOULD differ. What must not differ is the vocabulary: the
  // same fact renders as the same element everywhere, and each fact has one
  // implementation. Same reason `asset_class` moved into the pipeline and
  // `verdictOf` is shared — two implementations of one rule in two places is
  // how the buy/sell bug lived for a year.

  function cardIdentityHtml(item, opts = {}) {
    const { tag = 'div', isAi = false, sep = ' / ' } = opts;
    const full = instName(item.instrument_name);
    const meta = [item.group || '', item.sector || ''].filter(Boolean).join(sep);
    const o = tag, c = tag;
    return `<${o} class="card-name">${item.instrument_name}${noteIndicator(item.instrument_name)}</${c}>`
      + (full ? `<${o} class="inst-fullname">${full}</${c}>` : '')
      + `<${o} class="card-group">${meta}${isAi ? ' <span class="ai-chip-mini">AI</span>' : ''}`
      + `${eventChipHtml(item.instrument_name)}</${c}>`;
  }

  // Jump to this instrument on the Charts tab. Every list — Signals, Analyzed,
  // Trends, the watchlist — is a list of instruments you eventually want to LOOK
  // at, and until now the only way through was the modal, which shows numbers
  // rather than the chart.
  function chartBtn(name) {
    return `<button class="chart-jump-btn" title="See ${name} on the chart"`
      + ` data-act="openChartFor" data-arg="${name}" data-stop="1">${EXPAND_ICON}</button>`;
  }

  function cardActionsHtml(name, opts = {}) {
    const { starred = false } = opts;
    return `<div class="scanner-actions">${chartBtn(name)}${tvBtn(name, '')}${shareBtn(name)}`
      + `<button class="star-btn ${starred ? 'starred' : ''}" data-ticker="${name}"`
      + ` title="${starred ? 'Unmark as analyzed' : 'Mark as analyzed'}"`
      + ` data-act="toggleStar" data-stop="1">★</button></div>`;
  }

  // What is scheduled for this instrument, at chip density. ONE definition,
  // rendered by the shared card identity block (scanner / Analyzed / Trends)
  // and by the instrument modal, so "AAPL reports in 2 sessions" is the same
  // element wherever it appears — the v237 rule.
  //
  // Instrument-specific only. A rate decision hits all 798 rows, so putting it
  // on a card would print the identical chip 798 times; that one belongs to the
  // dashboard banner and the modal, where there is room to say what it means.
  // The modal is where the decision gets made, so it gets sentences rather
  // than a chip: what is scheduled for THIS instrument, and separately what is
  // scheduled for everything. Both rows open the calendar on that date.
  // This screen used to show the ribbon, the MA pills, the confidence tier and
  // the radar breakdown, and never once mention that the company reports on
  // Thursday — the single fact most likely to change the size of the trade.
  // "Looks like" — the charts that have moved most like this one. Tapping one
  // opens it, because the whole point is to go and compare them.
  function modalShapeHtml(item) {
    const name = item.instrument_name;
    const nb = shapeNeighbours(name);
    if (!nb.length) return '';
    const fam = shapeFamily(name);
    const rows = nb.slice(0, 6).map(n =>
      `<button class="ms-row" data-act="openModal" data-arg="${n.name}" data-stop="1">`
      + `<span class="ms-name">${n.name}</span>`
      + `<span class="ms-grp">${(allData.find(d => d.instrument_name === n.name) || {}).group || ''}</span>`
      + `<span class="ms-corr">${(n.corr * 100).toFixed(0)}%</span></button>`
    ).join('');
    return `<div class="mh-shape">
      <div class="mh-shape-head">Looks like${fam ? ` <span class="ms-fam">${fam.label}</span>` : ''}</div>
      <div class="ms-rows">${rows}</div>
      <button class="ms-compare" data-act="showSimilarCharts" data-arg="${name}">See these as charts →</button>
      <div class="ms-foot">Similarity over the last ${shapeSim.window_bars || 520} ${tfMeta().label} bars — the same bars this chart draws — with the market's common drift removed. Describes what has already happened, not a forecast.</div>
    </div>`;
  }

  function modalEventHtml(item) {
    const own = nextEventFor(item.instrument_name, EVENT_CHIP_DAYS);
    const mkt = nextMarketEvent(EVENT_CHIP_DAYS);
    if (!own && !mkt) return '';

    const row = (date, tone, head, sub) =>
      `<div class="mh-ev-row ${tone}" role="button" tabindex="0"
            data-act="openCalendar" data-arg="${date}" data-stop="1">
         <span class="mh-ev-head">${head}</span>
         <span class="mh-ev-sub">${sub}</span>
       </div>`;

    let out = '';
    if (own) {
      const kind = EVENT_KINDS[own.ev.type] || own.ev.type;
      const near = own.ev.type !== 'exdiv' && own.days <= 2;
      out += row(own.ev.date, near ? 'mh-ev-near' : '',
        `${kind} ${whenLabel(own.days)}`,
        own.ev.type === 'exdiv'
          ? 'Goes ex-dividend — expect a gap of roughly the dividend, which is not a signal.'
          : 'A scheduled gap you can see coming. Size the position before the close, not after.');
    }
    if (mkt) {
      out += row(mkt.ev.date, mkt.days <= 2 ? 'mh-ev-near' : '',
        `${evLabel(mkt.ev)} ${whenLabel(mkt.days)}`,
        `${mkt.ev.time ? mkt.ev.time + '. ' : ''}Market-wide — it moves this whether or not it is rate-sensitive.`);
    }
    return `<div class="mh-events">${out}</div>`;
  }

  function eventChipHtml(name) {
    const hit = nextEventFor(name, EVENT_CHIP_DAYS);
    if (!hit) return '';
    const { ev, days } = hit;
    const kind = EVENT_KINDS[ev.type] || ev.type;
    // Ex-dividend is context, never an alarm — it does not gap you.
    const near = ev.type !== 'exdiv' && days <= 2;
    return `<span class="card-event${near ? ' card-event-near' : ''}"`
         + ` title="${kind} on ${ev.date}">${kind} ${whenLabel(days)}</span>`;
  }

  // The verdict at chip density, for surfaces where the full bar would bury the
  // list it sits in. Same verdictOf() call, same tone classes, same words — a
  // second opinion computed a second way is the failure mode being avoided.
  function verdictChipHtml(item) {
    const v = verdictOf(item);
    if (!v) return '';
    return `<span class="sc-verdict-chip sc-v-${v.tone}" title="${v.sub}">${v.label}</span>`;
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
    const interval = '&interval=' + tfMeta().tv;
    const layout = userTvLayout();
    return `https://www.tradingview.com/chart/${layout ? layout + '/' : ''}?symbol=${encodeURIComponent(sym)}${interval}`;
  }

  function tvBtn(name, label) {
    return `<button class="tv-link tv-picker-trigger" title="Open ${name} on TradingView" onclick="event.stopPropagation();window.SP.openTvPicker(this,'${name}')">${TV_ICON}${label ? `<span>${label}</span>` : ''}</button>`;
  }



  // ── Theme — single dark theme ────────────────────────────────────────
  document.documentElement.setAttribute('data-theme', 'dark');
  localStorage.removeItem('swingpulse-theme');

  // ── Timeframe Toggle ─────────────────────────────────────────────────
  // Switch the active timeframe (Daily ↔ 4H) and re-render everything.
  // The f() accessor maps to unprefixed (Daily) or h4_ (4-Hour) columns.
  // Keep the header toggle buttons (and any other tf controls) in sync.
  function syncTfButtons() {
    const allowed = new Set(tabTfs(currentTab));
    document.querySelectorAll('.tf-switch-btn').forEach(b => {
      b.hidden = !allowed.has(b.dataset.tf);
      const on = b.dataset.tf === timeframe;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  // Tabs the timeframe toggle does NOT drive. Trends is built from daily trend
  // segments (trends.json), so the switch sat there doing nothing — it now says
  // what timeframe you're actually looking at instead of offering a dead choice.
  const TF_LOCKED_TABS = { trends: 'Daily · trend history is daily-only' };
  // Point sectorRadarData at the active timeframe's payload, and say on the
  // card which period it covers.
  //
  // This label is not decoration. The radar is the ONE dashboard component that
  // does not follow the timeframe switch — 4H has no radar at all, and before
  // the weekly one existed the daily radar rendered unchanged on every tab. So
  // on the Weekly tab every number around it showed last Friday while the radar
  // showed today, with nothing on screen saying so. Now the radar either
  // matches the tab (D, W) or admits that it doesn't (4H).
  function syncRadarTf() {
    const want = RADAR_TF_FOR(timeframe);
    sectorRadarData = sectorRadarByTf[want] || sectorRadarByTf.D || null;
    const el = document.getElementById('sectorRadarPeriod');
    if (!el) return;
    const actual = sectorRadarByTf[want] ? want : (sectorRadarByTf.D ? 'D' : null);
    if (!actual) { el.textContent = ''; el.title = ''; return; }
    // An intraday tab has no radar of its own, so the daily one showing there
    // is a MISMATCH however well the key lines up. Tested against the set,
    // not against '4H' by name — that literal silently answered "matches"
    // for 1H the moment a second intraday timeframe existed.
    const matches = actual === RADAR_TF_FOR(timeframe) && !INTRADAY_TFS.has(timeframe);
    el.textContent = actual === 'W' ? 'This week'
                   : actual === '3D' ? 'This 3-day bar'
                   : 'Today';
    el.classList.toggle('is-mismatch', !matches);
    const _periodEnd = tf => ((sectorRadarByTf[tf] && sectorRadarByTf[tf].sectors[0] || {}).date || '');
    el.title = actual === 'W'
      ? 'Weekly sector activity for the week ending ' + _periodEnd('W') +
        ' — fixed until the next week closes.'
      : actual === '3D'
      ? 'Sector activity for the 3-day bar ending ' + _periodEnd('3D') +
        ' — fixed until the next 3-day bar closes.'
      : (matches
          ? 'Daily sector activity, updated every run.'
          : `Daily sector activity. There is no ${timeframe} radar — the radar scores `
            + `each sector against its own 20-period baseline and only D, 3D and W `
            + `have one — so this is today\u2019s daily reading.`);
  }

  function syncTfLock() {
    const note = TF_LOCKED_TABS[currentTab] || '';
    document.body.classList.toggle('tf-locked', !!note);
    const el = document.getElementById('tfSwitchNote');
    if (el) el.textContent = note;
  }

  // A reader's choice: only timeframes this tab can show, remembered per side.
  function setTimeframe(tf, anchorName) {
    if (!isTf(tf) || !tabTfs(currentTab).includes(tf)) return;
    if (currentTab === 'charts') tfPrefs.charts = tf;
    else if (currentTab !== 'trends') tfPrefs.signals = tf;
    try {
      localStorage.setItem('swingpulse-tf', tfPrefs.signals);
      localStorage.setItem('swingpulse-chart-tf', tfPrefs.charts);
    } catch (e) {}
    applyTimeframe(tf, anchorName);
  }

  // `anchorName` — the chart to stay on. Given when the switch came from the
  // chart's own timeframe pill, which knows exactly which instrument it is on.
  function applyTimeframe(tf, anchorName) {
    if (!isTf(tf)) return;
    if (tf === timeframe) return;
    // Which chart the reader is on, captured BEFORE anything re-renders:
    // renderAll() rebuilds the reel and resets its scroll, so asking afterwards
    // always answered "the first card".
    const reelAnchor = (currentTab === 'charts') ? (anchorName || reelVisibleName()) : null;

    timeframe = tf;
    // Bar offsets do not carry across timeframes — "40 bars back" is a fortnight
    // on 1H and most of a year on Weekly. The CHANNEL does carry across, which
    // is the whole point of anchoring it to dates rather than to bars.
    reelResetPan();
    reel.editing = null;
    syncTfButtons();
    syncRadarTf();   // radar payload is per-timeframe; re-point before renderAll
    renderAll();  // re-renders dashboard (recomputes summary), scanner, watchlist
    // The reel is per-timeframe all the way down — different bundles, different
    // ribbon periods, different signal row. Redraw it on the same instrument
    // rather than bouncing the reader to the top of 700 charts.
    if (currentTab === 'charts') { tabDirty.charts = false; reelRebuildKeepingPlace(reelAnchor); }
    // If an instrument modal is open, rebuild it so its signal data AND the
    // TradingView interval (Daily→D / 4H→240) match the newly selected timeframe.
    if (openModalName && typeof overlay !== 'undefined' && overlay.classList.contains('open')) {
      openModal(openModalName);
    }
  }

  // Restore the persisted timeframe before the first render
  try {
    const _savedTf = localStorage.getItem('swingpulse-tf');
    const _savedChartTf = localStorage.getItem('swingpulse-chart-tf');
    // A saved 1H/4H/3D (from before those became chart views) opens on Daily;
    // Charts keeps it, since that is where it still means something.
    if (SIGNAL_TFS.has(_savedTf)) tfPrefs.signals = _savedTf;
    tfPrefs.charts = isTf(_savedChartTf) ? _savedChartTf : (isTf(_savedTf) ? _savedTf : 'D');
  } catch (e) {}
  timeframe = tfPrefs.signals;   // the app opens on the Dashboard

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
  const tabDirty = { trends: true, charts: true };

  function renderAll() {
    renderDashboard();
    renderScanner();
    renderWatchlist();
    updateNotifBell();
    // Mark lazy tabs dirty so they re-render on next visit
    tabDirty.trends = true;
    tabDirty.charts = true;
    // If the user is already on the trends tab (e.g. background refresh), render it now
    if (currentTab === 'trends') renderTrendsLazy();
    if (currentTab === 'charts') renderChartsLazy();
  }

  function renderTrendsLazy() {
    if (!tabDirty.trends) return;
    tabDirty.trends = false;
    buildTrendsCards();
  }

  function renderChartsLazy() {
    if (!tabDirty.charts) return;
    tabDirty.charts = false;
    buildReel();
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
    // Each tab shows its own timeframe (TAB_TFS): Charts restores the one last
    // used there, the signal tabs theirs, and Trends is always Daily — it used
    // to only relabel itself "Daily" while every badge and price on it stayed 4H.
    const _wantTf = tab === 'charts' ? tfPrefs.charts : tab === 'trends' ? 'D' : tfPrefs.signals;
    if (_wantTf !== timeframe) applyTimeframe(_wantTf);
    syncTfButtons();
    // Start every tab at the top. The panes share the document's scroll
    // offset, so tapping through from halfway down the Dashboard used to drop
    // you into the middle of the signal list — worst from a Sector Radar tap,
    // where the whole point is to look at what it filtered to.
    // 'instant', NOT 'auto': per spec 'auto' defers to the CSS scroll-behavior
    // property, and html{} sets `scroll-behavior: smooth` — so 'auto' silently
    // started an ANIMATED scroll. Any caller that re-rendered the pane right
    // after (srGoToSector rebuilds the whole card list) killed that animation
    // mid-flight and left you stranded halfway down. 'instant' forces the jump.
    try { window.scrollTo({ top: 0, behavior: 'instant' }); }
    catch (_) { document.scrollingElement.scrollTop = 0; }
    // Lazy-render heavy tabs on first visit (or after data refresh)
    if (tab === 'trends') renderTrendsLazy();
    if (tab === 'charts') renderChartsLazy();
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

  // ── Manual CI run ────────────────────────────────────────────────────
  // The refresh button below re-downloads what CI last PUBLISHED. When the
  // stale banner is up that is precisely the wrong thing: it fetches the same
  // stale file again and looks like it worked. This starts an actual pipeline
  // run — the same workflow_dispatch as the Actions tab's "Run workflow".
  //
  // No GitHub token is in this file and none can be: the bundle is public, and
  // a credential in it is readable by anyone who opens the site (the mistake
  // the old hard-coded SYNC_SECRET made). The browser proves only WHO it is,
  // with the same per-user bearer sync uses; the token lives on the Worker.
  //
  // WORTH KNOWING, and the UI says so: data_fetcher's 20-hour freshness gate
  // means a run started within 20h of the last download does NOT re-fetch
  // prices — it recomputes from cache and completes with identical signals.
  // Useful after a failed run or a code change; not a "get fresh prices now"
  // button. That gate is load-bearing for the finished-sessions rule, so this
  // works around it by being honest rather than by forcing a download.
  let _runPoll = null;
  let _runState = { phase: 'idle', text: '' };   // idle|working|watching|done|error

  function setRunState(phase, text) {
    _runState = { phase, text };
    document.querySelectorAll('[data-run-btn]').forEach(btn => {
      btn.textContent = text || 'Run now';
      btn.classList.toggle('is-busy', phase === 'working' || phase === 'watching');
      btn.classList.toggle('is-error', phase === 'error');
      btn.disabled = (phase === 'working' || phase === 'watching');
    });
  }

  function stopRunPoll() {
    if (_runPoll) { clearInterval(_runPoll); _runPoll = null; }
  }

  // Did the last run WORK? The button alone could not answer that: it flashed
  // "Done — loading" for a moment and went back to idle, so ten minutes later
  // the screen looked identical whether the run had succeeded, failed, or never
  // started. A run is the one thing here you kick off and walk away from, so
  // the outcome has to persist rather than being a state the button passes
  // through. Same source as everything else — the /run/status payload.
  function ago(iso) {
    const t = Date.parse(iso || '');
    if (isNaN(t)) return '';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }

  function renderRunStatus(r) {
    const el = document.getElementById('runStatusLine');
    if (!el) return;
    if (!r || !r.ok) {
      // Signed out, or GitHub unreachable. Say which — "no status" reads as
      // "nothing has run", which is a different and more alarming claim.
      el.className = 'nrr-status';
      el.textContent = (!syncUser || !syncToken())
        ? 'Sign in to see run status'
        : 'Run status unavailable';
      return;
    }
    if (r.status === 'queued' || r.status === 'in_progress') {
      el.className = 'nrr-status is-running';
      el.textContent = `${r.status === 'queued' ? 'Queued' : 'Running'}`
                     + `${r.started ? ' · started ' + ago(r.started) : ''}`;
      return;
    }
    if (r.status === 'none') {
      el.className = 'nrr-status';
      el.textContent = 'No runs yet';
      return;
    }
    // Completed. `event` distinguishes a run you started from the schedule,
    // which matters when you are asking "did MY run work".
    const who = r.event === 'workflow_dispatch' ? 'Manual run' : 'Scheduled run';
    if (r.conclusion === 'success') {
      el.className = 'nrr-status is-ok';
      el.textContent = `✓ ${who} succeeded · ${ago(r.started)}`;
    } else {
      el.className = 'nrr-status is-bad';
      el.textContent = `✕ ${who} ${r.conclusion || 'ended'} · ${ago(r.started)}`;
    }
  }

  // Read the latest run and paint the line. Safe to call when signed out.
  async function refreshRunStatus() {
    if (!syncUser || !syncToken()) { renderRunStatus(null); return; }
    try {
      const res = await fetch(`${SYNC_WORKER}/run/status?user=${syncUser}`,
                              { headers: syncHeaders() });
      renderRunStatus(res.ok ? await res.json() : null);
    } catch { renderRunStatus(null); }
  }

  // Poll until the run leaves queued/in_progress. Capped: a hung poll on a
  // phone left open all day is a battery cost for no information, and the run
  // is on GitHub whether or not this tab is watching it.
  // `since` is the moment we asked for a run. GitHub's dispatch returns 204
  // with no run id and the run does not appear in the list immediately, so the
  // first poll after a dispatch usually returns the PREVIOUS run — which is
  // completed/success. Without this guard the button flashed "Done — loading",
  // reloaded, and reported the last cron's result as if it were yours: a
  // success message for work that had not started. Any run that began before
  // we asked is somebody else's, so keep waiting for one that did not.
  // Called with no argument from checkRunOnLoad, where the run in flight IS
  // the one to watch however long ago it started.
  function watchRun(since) {
    stopRunPoll();
    const startedWatching = Date.now();
    const MAX_WATCH_MS = 20 * 60 * 1000;      // a run is ~9 min; this is slack
    // GitHub's run_started_at and the phone's clock are different clocks.
    const SKEW_MS = 90 * 1000;
    const tick = async () => {
      if (Date.now() - startedWatching > MAX_WATCH_MS) {
        stopRunPoll();
        setRunState('idle', 'Run now');
        return;
      }
      try {
        const res = await fetch(`${SYNC_WORKER}/run/status?user=${syncUser}`,
                                { headers: syncHeaders() });
        if (!res.ok) return;                   // transient; the next tick retries
        const r = await res.json();
        if (!r.ok) return;

        if (since) {
          const began = r.started ? Date.parse(r.started) : 0;
          // Ours has not shown up yet — this is the run before it.
          if (!began || began < since - SKEW_MS) {
            setRunState('watching', 'Queued…');
            return;
          }
        }

        renderRunStatus(r);
        if (r.status === 'queued')      { setRunState('watching', 'Queued…'); return; }
        if (r.status === 'in_progress') { setRunState('watching', 'Running…'); return; }
        stopRunPoll();
        if (r.conclusion === 'success') {
          setRunState('done', 'Done — loading');
          await loadAll();                     // the whole point: pick the new data up
          setRunState('idle', 'Run now');
        } else {
          // The button returns to idle so it can be retried; the outcome stays
          // on the status line rather than vanishing with the button state.
          setRunState('error', 'Run failed');
          setTimeout(() => setRunState('idle', 'Run now'), 6000);
        }
      } catch { /* offline — the next tick retries */ }
    };
    _runPoll = setInterval(tick, 15000);
    tick();
  }

  async function triggerRun() {
    // Signed out there is no identity to authorise with, so this cannot fire a
    // request — but it must not be a dead end either. It said "Sign in first"
    // and then sat there, naming the problem and offering no way to act on it,
    // which is the same complaint as an affordance nobody can find. Open the
    // thing it is asking for: straight to the password step if the user is
    // already chosen, the picker if not.
    if (!syncUser || !syncToken()) {
      // The panel would otherwise sit on top of the picker it just opened.
      const _p = document.getElementById('notifPopup');
      if (_p) _p.style.display = 'none';
      showUserPicker();
      if (syncUser) upShowStep('pass', 'Sign in to start a data run.');
      setRunState('idle', 'Run now');
      return;
    }
    setRunState('working', 'Starting…');
    // Captured BEFORE the dispatch: everything older than this is another run.
    const askedAt = Date.now();
    let res, body = {};
    try {
      res  = await fetch(`${SYNC_WORKER}/run?user=${syncUser}`,
                         { method: 'POST', headers: syncHeaders() });
      body = await res.json().catch(() => ({}));
    } catch {
      setRunState('error', 'Offline');
      setTimeout(() => setRunState('idle', 'Run now'), 4000);
      return;
    }

    if (res.status === 401) { syncPasswordRejected(); setRunState('error', 'Sign in again'); return; }
    // Already running — that one IS the run, whenever it started, so no
    // since-guard: waiting for a newer one would wait for ever.
    if (res.status === 409) { watchRun(); return; }
    if (res.status === 429) {
      const mins = Math.ceil((body.retry_in_s || 0) / 60);
      setRunState('error', mins > 0 ? `Wait ${mins} min` : 'Too soon');
      setTimeout(() => setRunState('idle', 'Run now'), 5000);
      return;
    }
    if (res.status === 501) {
      // The Worker has no GitHub token. A generic failure here would send you
      // looking at your password, so name the actual missing thing.
      setRunState('error', 'Not set up');
      alert('The Worker has no GitHub token yet.\n\n'
          + 'Add one with:\n'
          + '  cd swing_generator/webapp/sync-worker\n'
          + '  npx wrangler secret put GH_TOKEN\n\n'
          + 'Use a fine-grained token scoped to xabilon18-ctrl/SwingPulse with '
          + 'Actions: read and write.');
      setTimeout(() => setRunState('idle', 'Run now'), 1000);
      return;
    }
    if (!res.ok) {
      setRunState('error', 'Failed');
      console.warn('[run] dispatch failed', res.status, body);
      setTimeout(() => setRunState('idle', 'Run now'), 5000);
      return;
    }
    watchRun(askedAt);
  }

  // If a run is already going when the app opens, show it rather than offering
  // a button that would only 409.
  function checkRunOnLoad() {
    if (!syncUser || !syncToken()) { renderRunStatus(null); return; }
    fetch(`${SYNC_WORKER}/run/status?user=${syncUser}`, { headers: syncHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(r => {
        renderRunStatus(r);
        if (r && r.ok && (r.status === 'queued' || r.status === 'in_progress')) watchRun();
      })
      .catch(() => renderRunStatus(null));
  }

  document.addEventListener('click', e => {
    if (e.target.closest('[data-run-btn]')) { e.stopPropagation(); triggerRun(); }
  });

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

  // Retry loop that runs only while the stale/failed banner is showing, so the
  // warning resolves itself instead of lingering until the next 4-hourly
  // refresh. Cleared the moment a load comes back fresh.
  let _staleRetryTimer = null;
  function scheduleStaleRetry(isStale) {
    if (!isStale) {
      if (_staleRetryTimer) { clearInterval(_staleRetryTimer); _staleRetryTimer = null; }
      return;
    }
    if (_staleRetryTimer) return;              // already retrying
    _staleRetryTimer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      loadAll();                                // clears the timer when fresh
    }, 10 * 60 * 1000);                         // every 10 minutes
  }

  async function loadAll() {
    try {
      const [sigRes, sumRes, statusRes, tvRes, aiRes, trendsRes, explRes, namesRes, btRes, ldgRes, srRes, srwRes, sr3Res, flRes, evRes, shRes, rotRes, rotPaperRes] = await Promise.all([
        fetchJson('/api/signals', { data: [] }),
        fetchJson('/api/summary', {}),
        fetchJson('/api/status', {}),
        fetchJson('/api/tv-map', {}),
        fetchJson('/api/ai-instruments', []),
        fetchJson('/api/trends', {}),
        fetchJson('/api/explanations', {}),
        fetchJson('/api/names', {}),
        fetchJson('/api/backtest', null),
        fetchJson('/api/ledger', null),
        fetchJson('/api/sector-radar', null),
        fetchJson('/api/sector-radar-w', null),
        fetchJson('/api/sector-radar-3d', null),
        fetchJson('/api/instrument-flavours', null),
        fetchJson('/api/events', null),
        fetchJson('/api/shape-similarity', null),
        fetchJson('/api/rotation', null),
        fetchJson('/api/rotation-paper', null),
      ]);
      allData = sigRes.data || [];
      detectMaPeriodsFromData(allData);   // auto-detect from actual data columns
      summaryData = sumRes;
      // Before renderAll() below rebuilds the reel out of them. The chart
      // bundles are the one feed loadAll does not re-fetch here — they are
      // pulled per chunk as cards scroll into view — so this is where a new
      // publish has to reach them. See reelInvalidateCache.
      reelInvalidateCache(sumRes.fetched_at || '');
      tvMap = tvRes || {};
      aiSet = new Set(aiRes || []);
      trendsData = trendsRes || {};
      explanationsData = explRes || {};
      namesData = namesRes || {};
      backtestData = btRes;
      ledgerData = ldgRes && ldgRes.totals ? ldgRes : null;
      const _okRadar = r => (r && Array.isArray(r.sectors) && r.sectors.length) ? r : null;
      sectorRadarByTf = { D: _okRadar(srRes), '3D': _okRadar(sr3Res), W: _okRadar(srwRes) };
      syncRadarTf();
      instFlavours = (flRes && flRes.instruments) ? flRes.instruments : {};
      flavourMkt = (flRes && typeof flRes.market_wide === 'boolean') ? flRes : { market_wide: false };
      eventsData = (evRes && Array.isArray(evRes.events)) ? evRes : { events: [], sources: {} };
      shapeSim = (shRes && (shRes.by_tf || shRes.neighbours)) ? shRes
                 : { neighbours: {}, families: [], family_of: {} };
      resetEventIndexes();   // both indexes are derived from the two lines above
      rotationData = (rotRes && rotRes.wheel && rotRes.leaders) ? rotRes : null;
      rotationPaper = (rotPaperRes && Array.isArray(rotPaperRes.nav)) ? rotPaperRes : null;

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
      // Freshness. This used to reconstruct the CI schedule in the browser —
      // RUN_HOURS_WEEKDAY = [11,15] as the expected LANDING hours (cron + an
      // assumed queue delay) plus 2.5h grace — and warn whenever the data
      // predated the run that "should" have finished. Two problems: it had to
      // be hand-kept in sync with publish.yml, and the assumed delay was
      // fiction. GitHub queues these crons 1.5–3h; on 2026-07-27 the 10:35 run
      // did not start until 13:26 and landed ~13:32, two minutes past the
      // banner's 13:30 cutoff, so a perfectly healthy pipeline was reported
      // late. The weekend margin was worse: cron 08:00, observed start 10:00,
      // cutoff 10:30.
      //
      // Now the pipeline speaks for itself. summary.json's `fetched_at` is
      // stamped on every SUCCESSFUL publish (same value as status.json's `at`),
      // so freshness is just "how long since the last success" — no schedule
      // knowledge, nothing to keep in sync.
      //
      // The threshold is set from MEASURED gaps between successful runs, not
      // from the cron times. Over 30 runs (07-15..07-30) the largest legitimate
      // gap was 27.4h — Sun 07-26 10:00 to Mon 07-27 13:26, i.e. the weekend
      // 08:00 cron landing early and Monday's 10:35 landing three hours late.
      // Weeknights are only ~20h. 32h clears that ceiling with room for a bad
      // queue on both sides, so a healthy pipeline never trips it. (A first
      // attempt at 26h would have false-alarmed every Monday morning.)
      //
      // This is deliberately a BACKSTOP for "CI never fired at all" — a run
      // that fails is caught immediately and separately by status.json, which
      // the CI failure step flips to state:'failed'. Previously only the
      // service worker ever read that.
      const STALE_AFTER_H = 32;
      const staleBanner = document.getElementById('staleBanner');
      const staleText   = document.getElementById('staleBannerText');
      let fetchedTime = null;
      if (sumRes.fetched_at && sumRes.fetched_at.includes('T')) {
        const fd = new Date(sumRes.fetched_at);
        if (!isNaN(fd.getTime())) fetchedTime = fd.getTime();
      }
      if (staleBanner && staleText) {
        const nowMs = Date.now();
        let msg = '';
        if (statusRes && statusRes.state === 'failed') {
          // The CI failure step flips status.json — this is a REAL problem and
          // is the only case worth interrupting for.
          msg = 'The last data update failed — signals may be out of date';
        } else if (fetchedTime !== null) {
          const ageH = (nowMs - fetchedTime) / 3600e3;
          if (ageH > STALE_AFTER_H) {
            const n = Math.round(ageH);
            const ageStr = n < 48 ? `${n}h` : `${Math.round(n / 24)} days`;
            msg = `Data is ${ageStr} old (${dateStr}) — no successful update in over a day`;
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
        // The run button belongs HERE, on the banner that says the data is old,
        // rather than in a settings screen you would have to go looking for.
        // Hidden when signed out, where it could only ever fail.
        const _sRun = document.getElementById('staleRunBtn');
        if (_sRun) _sRun.style.display = (msg && syncUser && syncToken()) ? '' : 'none';
        // The banner must not sit there once the data arrives. loadAll only
        // re-runs every 4h (or on visibilitychange), so a tab left open would
        // keep showing a warning long after the pipeline recovered. While it is
        // up, retry on a short timer and let a successful reload clear it.
        scheduleStaleRetry(!!msg);
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

  /** Escape text bound for innerHTML. Instrument names come from the data
   *  pipeline, not from us — "Procter & Gamble" and friends must not be able
   *  to break the markup they are dropped into. */
  function escText(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

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
    // Registry entry for the Currency Class chip. Strictly redundant — the
    // group, sector AND asset class are all literally 'Currency', so the
    // generic group/sector tail below already returns the same 57 rows — but
    // every other data-cat has an entry here and a chip whose term is absent
    // from this map reads as unsupported.
    'currency':     ['currency'],
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
  const SIG_CTX = { B1: 'broke above ribbon', S1: 'broke below ribbon', B2: 'recovered MA50', S2: 'lost MA50', B3: 'bounced at MA250', S3: 'rejected at MA250', B4: 'bounced at MA500', S4: 'rejected at MA500' };
  // No confidence tier on the chip since 2026-09-11 (see verdictOf); a sell is a WARNING.
  // ── One trend sentence (2026-09-11) ─────────────────────────────────────
  // The same words on every card that describes a trend: the REGIME (the
  // established trend and how long it has run) and where price is RIGHT NOW
  // against the ribbon. Those two disagree on ~9% of uptrend days, and exactly
  // then the odds the trend is still intact 3 months later fall from ~72% to
  // 34–41% — so the "now" half is the half worth reading. On Daily the regime
  // comes from the Trends tab's own segments, so card and tab always agree.
  function trendSentence(item) {
    const pre = tfMeta().prefix;
    const close = parseFloat(item[pre + 'close']);
    if (!isFinite(close)) return null;
    let dir = '', age = '';
    if (timeframe === 'D') {
      const seg = (trendsData[item.instrument_name] || [])[0];
      if (seg && (seg.direction === 'UPTREND' || seg.direction === 'DOWNTREND')) {
        dir = seg.direction;
        age = `${Number(seg.days).toLocaleString('en-US')} days`;
      }
    }
    // No age off Daily: trend_run_days counts bars on the trend side of the
    // ribbon, not the latch's age, so a years-old weekly uptrend read "1 week".
    if (!dir) dir = item[pre + 'established_trend'] || '';
    const mas = Object.keys(item)
      .filter(k => k.startsWith(pre + 'ma_') && /^\d+$/.test(k.slice(pre.length + 3)))
      .map(k => ({ p: +k.slice(pre.length + 3), v: parseFloat(item[k]) }))
      .filter(m => isFinite(m.v))
      .sort((a, b) => a.p - b.p);
    const names = list => list.map(m => 'MA' + m.p).join(' & ');
    const below = mas.filter(m => close < m.v);
    const above = mas.filter(m => close >= m.v);
    let head, now = '', against = false;
    if (dir === 'UPTREND') {
      head = 'Uptrend' + (age ? ' ' + age : '');
      against = below.length > 0;
      if (mas.length) now = !against ? `above all ${mas.length} MAs`
                          : below.length === mas.length ? `now below all ${mas.length} MAs` : `now below ${names(below)}`;
    } else if (dir === 'DOWNTREND') {
      head = 'Downtrend' + (age ? ' ' + age : '');
      against = above.length > 0;
      if (mas.length) now = !against ? `below all ${mas.length} MAs`
                          : above.length === mas.length ? `now above all ${mas.length} MAs` : `now above ${names(above)}`;
    } else {
      head = 'No established trend';
      if (mas.length) now = above.length === mas.length ? `above all ${mas.length} MAs`
                          : below.length === mas.length ? `below all ${mas.length} MAs`
                          : `above ${names(above)}`;
    }
    return { dir, against, head, now,
             glyph: dir === 'UPTREND' ? '▲' : dir === 'DOWNTREND' ? '▼' : '—',
             text: now ? `${head} · ${now}` : head };
  }

  // ── "Worth the cost?" (2026-09-11) ──────────────────────────────────────
  // The stop the backtest and ledger grade with is 2×ATR(14). When that is a
  // small share of price, financing and spread are a big share of the risk:
  // stops under ~3.0% on Daily and ~6.8% on Weekly lost money after costs in
  // testing — on random entries as much as on signals, so it is a cost fact,
  // not a signal claim. Shown only where something fired.
  const COST_TIGHT = { D: { pct: 3.0, r: '−0.22R' }, W: { pct: 6.8, r: '−0.21R' } };
  function stopPctOf(item) {
    const a = parseFloat(item[f('atr_pct')]);
    return isFinite(a) && a > 0 ? a * 2 : null;
  }
  function costTight(item) {
    const rule = COST_TIGHT[timeframe], s = stopPctOf(item);
    return !!(rule && s != null && item[f('primary_signal')] && s < rule.pct);
  }
  function costLineHtml(item) {
    const rule = COST_TIGHT[timeframe], s = stopPctOf(item);
    if (!rule || s == null || !item[f('primary_signal')]) return '';
    const stop = s.toFixed(s < 10 ? 1 : 0);
    return s < rule.pct
      ? `<div class="sc-cost sc-cost-tight" title="In testing (2013–26) stops this tight lost money after financing and spread, on random entries as much as on signals.">Stop 2×ATR ≈ ${stop}% of price · tight: after financing and spread, trades like this averaged ${rule.r}</div>`
      : `<div class="sc-cost">Stop 2×ATR ≈ ${stop}% of price · wide enough that costs stay a small share of the risk</div>`;
  }

  function setupPanelHtml(item, opts = {}) {
    const t = effectiveTrend(item);
    const sig = item[f('primary_signal')] || '';
    const buySig = isBuy(item);
    const lastSigType = item[f('last_signal_type')] || '';
    const lastIsBuy = lastSigType.startsWith('B');
    const lastSigAge = signalAge(item[f('last_signal_date')] || '', item[f('date')]).label;
    // One trend sentence (trendSentence): the regime and where price is now.
    // It replaced "▲ UPTREND · REACTION in MAs — watch B2 / B3 / B4", which
    // nudged toward entries that test no better than random (2026-09-11).
    const ts = trendSentence(item);
    const stCls = !ts ? 'sc-state-neu' : ts.against ? 'sc-state-pull'
                : ts.dir === 'UPTREND' ? 'sc-state-up' : ts.dir === 'DOWNTREND' ? 'sc-state-dn' : 'sc-state-neu';
    const stateLine = ts
      ? `<div class="sc-setup-state ${stCls}">${ts.glyph} ${ts.head}${ts.now ? ` <span class="sc-hint">· ${ts.now}</span>` : ''}</div>`
      : `<div class="sc-setup-state sc-state-neu">— ${t}</div>`;

    let sigChip;
    if (sig) {
      sigChip = `<span class="sc-sig-chip ${buySig ? 'sc-sig-buy' : 'sc-sig-warn'}">${sig} ${buySig ? 'BUY' : 'WARNING'}${lastSigAge ? ' · ' + lastSigAge.replace(' ago', '') : ''}</span>`;
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
      ${costLineHtml(item)}
    </div>${maStackHtml(item)}`;
  }

  // ── MA stack strip ────────────────────────────────────────────────────────
  // Where the fast / mid / anchor ribbon lines sit relative to each other, on
  // the active timeframe. CONTEXT, NOT A CALL: measured 2026-09-03 over 40,476
  // cross events, the 50x250 cross wins 47-53% of the time and trails
  // buy-and-hold on every timeframe as an entry; as an exit a control that
  // simply held longer, with no cross in it, matched it. So this renders in the
  // muted greys the card uses for facts, never in --buy/--sell, which mean "act".
  const STACK_GAP_TIGHT  = 0.5;   // % — below this the pair is about to cross
  const STACK_FRESH_BARS = 10;    // bars — below this the flip is still news

  function stackRead(item) {
    const state = item[f('stack_state')] || '';
    if (!state) return null;
    const gapRaw  = item[f('stack_gap_pct')];
    const flipRaw = item[f('stack_flip_bars')];
    const gap  = (gapRaw  === '' || gapRaw  == null) ? null : parseFloat(gapRaw);
    const flip = (flipRaw === '' || flipRaw == null) ? null : parseInt(flipRaw, 10);
    return {
      state,
      pair:  item[f('stack_pair')] || '',
      gap:   Number.isFinite(gap)  ? gap  : null,
      flip:  Number.isFinite(flip) ? flip : null,
      tight: Number.isFinite(gap)  && gap  <= STACK_GAP_TIGHT,
      fresh: Number.isFinite(flip) && flip <= STACK_FRESH_BARS,
    };
  }

  // The three rungs, placed at the real heights of the three lines so the glyph
  // shows ORDER and TIGHTNESS at once — rungs that bunch are about to cross.
  // Heights come from the ma_* values already on the row; the pair label names
  // the instrument's own periods, which on a session-normalised ribbon are not
  // 50/250/500 (SOX reads 15x73 on 1H), so the periods are parsed from it.
  function stackGlyph(item, read) {
    const per = (read.pair || '').split('x').map(n => parseInt(n, 10));
    let lines = [];
    if (per.length === 2 && per.every(Number.isFinite)) {
      // pair names two of the three; the third is whichever ribbon line is the
      // fast/mid/anchor position not already named. Fall back to the ordered
      // ma_* keys present on the row.
      // NB the ribbon prefix is taken from tfMeta(), not from f(): f() maps a
      // payload COLUMN name onto the active timeframe, and 'ma_' is a name
      // fragment rather than a column. Passing one through f() reads as a
      // ghost column to tools/shape_audit.py, correctly.
      const maPre = tfMeta().prefix + 'ma_';
      const keys = Object.keys(item)
        .filter(k => k.startsWith(maPre) && item[k] !== '' && item[k] != null)
        .map(k => [parseInt(k.slice(maPre.length), 10), parseFloat(item[k])])
        .filter(([p, v]) => Number.isFinite(p) && Number.isFinite(v))
        .sort((a, b) => a[0] - b[0]);
      if (keys.length >= 3) {
        const fast = keys[1], mid = keys.length > 9 ? keys[9] : keys[Math.floor(keys.length / 2)], anch = keys[keys.length - 1];
        lines = [['fast', fast[1]], ['mid', mid[1]], ['anchor', anch[1]]];
      }
    }
    if (lines.length !== 3) return '';
    const vals = lines.map(l => l[1]);
    const hi = Math.max(...vals), lo = Math.min(...vals);
    const span = hi - lo;
    const y = v => span > 0 ? (3 + 14 * (hi - v) / span) : 10;
    const COLOR = { fast: 'var(--accent)', mid: 'var(--text-secondary)', anchor: 'var(--neutral)' };
    const rungs = lines.map(([role, v]) =>
      `<rect x="4" y="${y(v).toFixed(1)}" width="14" height="2" rx="1" fill="${COLOR[role]}"></rect>`
    ).join('');
    return `<svg class="sc-stack-glyph" width="22" height="20" viewBox="0 0 22 20" aria-hidden="true">${rungs}</svg>`;
  }

  function maStackHtml(item) {
    const read = stackRead(item);
    if (!read) return '';
    const cls = read.state === 'BULL' ? 'is-bull' : read.state === 'BEAR' ? 'is-bear' : 'is-mixed';
    const gapHtml = read.gap == null ? '' :
      `<span class="sc-stack-gap${read.tight ? ' is-tight' : ''}">${read.pair} <em>${read.gap.toFixed(2)}%</em></span>`;
    const ageHtml = read.flip == null ? '' :
      `<span class="sc-stack-age">${read.flip}b</span>`;
    const title = `MA stack on ${tfMeta().label}: ${read.state}`
      + (read.gap != null ? ` · closest pair ${read.pair} ${read.gap.toFixed(2)}% apart` : '')
      + (read.flip != null ? ` · last swapped ${read.flip} bars ago` : '');
    return `<div class="sc-stack${read.fresh ? ' is-fresh' : ''}" title="${title}">`
      + stackGlyph(item, read)
      + `<span class="sc-stack-state ${cls}">${read.state}</span>${gapHtml}${ageHtml}</div>`;
  }

  // ── Chart shape: lookalikes and concentration ─────────────────────────────
  // shape_similarity.py measures which charts have MOVED ALIKE over the last
  // 520 daily bars, after the market's common drift is removed. Two uses, and
  // the second is the one that matters:
  //
  //   1. "Looks like" — the charts most similar to this one.
  //   2. Concentration — when several names on screen are the same shape, they
  //      are one bet wearing different tickers. Measured example: SA40 and GOLD
  //      run at +0.94 after de-drifting, because the JSE Top 40 is mining-heavy.
  //
  // It is descriptive only. It says nothing about what happens next and must
  // never be read as an edge.
  // The grouping for the CHART CURRENTLY SHOWN. Lookalikes are computed per
  // timeframe because 520 bars is a different amount of calendar on each: two
  // years of Daily, ten of Weekly. Serving the daily grouping on every tab was
  // the original fault — measured 2026-09-08, families correlating 0.91 on
  // Daily fell to 0.68 on 3D and 0.69 on Weekly, worst pairs -0.71 and -0.69,
  // i.e. charts moving OPPOSITE ways while labelled lookalikes.
  //
  // Falls back to the top-level (daily) block, which the file still carries, so
  // an older payload keeps working rather than emptying the feature out.
  function shapeSet() {
    return (shapeSim.by_tf && shapeSim.by_tf[timeframe]) || shapeSim;
  }

  function shapeNeighbours(name) {
    const set = shapeSet();
    return (set.neighbours && set.neighbours[name]) || [];
  }

  function shapeFamily(name) {
    const set = shapeSet();
    const id = set.family_of ? set.family_of[name] : undefined;
    return (id === undefined || !set.families) ? null : set.families[id] || null;
  }

  // Group a set of instruments by shape family. Returns only families with more
  // than one member PRESENT — a family of one on screen is not a concentration.
  function shapeClusters(items) {
    const by = new Map();
    items.forEach(d => {
      const fam = shapeFamily(d.instrument_name);
      if (!fam) return;
      if (!by.has(fam.id)) by.set(fam.id, { fam, names: [] });
      by.get(fam.id).names.push(d.instrument_name);
    });
    return [...by.values()].filter(g => g.names.length > 1)
                           .sort((a, b) => b.names.length - a.names.length);
  }

  // One line, only when it would change what you do: several of the things in
  // front of you are the same trade. Silent otherwise — a warning that fires on
  // every screen is one nobody reads.
  // Threshold is a SHARE of what is on screen, not a headcount. Tested against
  // real screens on 2026-09-03: a headcount rule (>=6) fired on the full
  // 798-instrument list, where the biggest family is 26 names — 3.3%, which is
  // not a concentrated screen by any reading. Share-only gets it right:
  //   everything (798)      top family 3.3%  -> silent
  //   today's daily fires   3 of 42,  7.1%   -> silent
  //   Crypto only           21 of 64, 32.8%  -> fires
  //   Commodity only        4 of 18,  22.2%  -> fires
  const CONC_MIN_MEMBERS = 3;
  const CONC_MIN_SHARE   = 0.20;

  function concentrationNoteHtml(items) {
    const groups = shapeClusters(items);
    if (!groups.length || !items.length) return '';
    const top = groups[0];
    if (top.names.length < CONC_MIN_MEMBERS) return '';
    if (top.names.length / items.length < CONC_MIN_SHARE) return '';
    const shown = top.names.slice(0, 4).join(', ');
    const more = top.names.length > 4 ? ` +${top.names.length - 4} more` : '';
    return `<div class="shape-conc" title="Measured over ${shapeSim.window_bars || 520} ${tfMeta().label} bars, market drift removed">`
      + `<b>${top.names.length} of these ${items.length} move together</b>`
      + `<span class="shape-conc-names">${shown}${more} · ${top.fam.label}</span>`
      + `<span class="shape-conc-note">Sized as separate positions, this is one bet ${top.names.length} times.</span>`
      + `</div>`;
  }

  // Filter predicate, shared by the Signals sheet and the Charts tab so the two
  // cannot drift into different definitions of "near cross".
  function matchesStackFilter(item, mode) {
    if (!mode || mode === 'all') return true;
    const read = stackRead(item);
    if (!read) return false;
    if (mode === 'bull' || mode === 'bear' || mode === 'mixed') return read.state === mode.toUpperCase();
    if (mode === 'near')  return read.tight;
    if (mode === 'fresh') return read.fresh;
    return true;
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
          subEl.textContent = `${p0.stop_model ? `${p0.stop_model} stop · ${p0.target_r || 2}:1 R:R` : '2×ATR14 stop · 2:1 R:R'}`
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
        ${pending.length ? `<div class="tr-live-empty">${ready.length ? 'Still maturing: ' : 'Nothing has matured yet — '}${pending.map(([c, s]) => `${c} ${s.counted || 0}/${MIN_COUNTED}`).join(' · ')}. A signal only counts once its full window (${t.window ? `${t.window.D || 30} daily bars, ${t.window['4H'] || 60} 4H bars, ${t.window.W || 13} weekly bars` : '30 daily bars'}) has passed, so winners aren't left out.</div>` : ''}
      `;
    }
    rows.innerHTML = btRows + liveHtml;

    if (subEl && backtestData.generated_at) {
      const p = backtestData.params || {};
      const stopStr = p.stop_model ? `${p.stop_model} stop · ${p.target_r || 2}:1 R:R` : '2×ATR14 stop · 2:1 R:R';
      const sinceStr = p.since && p.since !== 'full history' ? ` · since ${p.since}` : '';
      subEl.textContent = `${stopStr}${sinceStr} · updated ${formatGeneratedAt(backtestData.generated_at)}`;
    }
  }

  // Sector-mood market state (validated Phase 0): sit-out warning on market-wide churn
  // days, otherwise a stock-picking-OK note when there are fresh fires.
  function renderMarketState() {
    const el = document.getElementById('marketStateBanner');
    if (!el) return;
    // Retired 2026-09-11: the sit-out and "grades validated" banners were the
    // sector-mood layer, fitted on the trades it graded.
    el.innerHTML = '';
  }

  function renderDashboard() {
    renderEventBanner();
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
    renderGroupPulse();
    renderVolumePulse();
    renderRotation();
    renderSectorRadar();
    renderLeaders();
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
    'Commodity':'Commodities','Crypto':'Crypto','Currency':'Currencies',
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

  function VP_LOOKBACK_LABEL() { return tfMeta().barShort; }

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

  // ── Sector rotation wheel (rotation.json) ─────────────────────────────────
  // DESCRIBES where money has been moving between sectors. It never names a
  // "next" sector: tested 2013-26, sectors in Improving reached Leading within
  // 4 weeks 57-62% of the time but did not beat the average sector afterwards,
  // and the order of leaders did not repeat (1 of 19 later changes called).
  const ROT_ZONES = ['Leading', 'Improving', 'Weakening', 'Lagging'];
  const ROT_COL = { Leading: 'var(--accent)', Improving: 'var(--volume)',
                    Weakening: 'var(--text-secondary)', Lagging: 'var(--neutral)' };
  const ROT_ABBR = { 'Basic Materials': 'Materials', 'Communication Services': 'Comms',
    'Consumer Cyclical': 'Cons. cyclical', 'Consumer Defensive': 'Cons. defensive',
    'Financial Services': 'Financials', 'Real Estate': 'Real estate' };
  const rotShort = s => ROT_ABBR[s] || s;
  function rotDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00Z');
    return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  function rotationWheelSvg(sectors) {
    const W = 340, H = 270, CX = W / 2, CY = H / 2, HX = CX - 22, HY = CY - 20;
    const pts = sectors.flatMap(s => s.trail || []);
    // Scale to the 90th percentile, not the maximum: one sector running hot
    // (crypto) would otherwise squash every other dot into the middle.
    const q90 = arr => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(0.9 * (a.length - 1))] : 1; };
    const sMax = Math.max(0.5, q90(pts.map(p => Math.abs(p[0]))));
    const dMax = Math.max(0.5, q90(pts.map(p => Math.abs(p[1]))));
    const X = v => CX + Math.max(-1, Math.min(1, v / sMax)) * HX;
    const Y = v => CY - Math.max(-1, Math.min(1, v / dMax)) * HY;
    let out = `<svg class="rot-wheel" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sector rotation wheel: each sector plotted by strength against the average sector (right is stronger) and direction (up is strengthening), with an 8-week tail.">`
      + `<rect x="${CX}" y="0" width="${CX}" height="${CY}" fill="var(--accent)" opacity=".07"/>`
      + `<rect x="0" y="0" width="${CX}" height="${CY}" fill="var(--volume)" opacity=".08"/>`
      + `<rect x="${CX}" y="${CY}" width="${CX}" height="${CY}" fill="var(--text-secondary)" opacity=".03"/>`
      + `<line x1="${CX}" y1="0" x2="${CX}" y2="${H}" stroke="var(--border)"/><line x1="0" y1="${CY}" x2="${W}" y2="${CY}" stroke="var(--border)"/>`
      + `<text x="8" y="15" class="rot-q" fill="var(--volume)">IMPROVING</text>`
      + `<text x="${W - 8}" y="15" class="rot-q" text-anchor="end" fill="var(--accent)">LEADING</text>`
      + `<text x="8" y="${H - 7}" class="rot-q" fill="var(--text-muted)">LAGGING</text>`
      + `<text x="${W - 8}" y="${H - 7}" class="rot-q" text-anchor="end" fill="var(--text-secondary)">WEAKENING</text>`;
    // Labels place in priority order: Leading, Improving and Weakening first
    // and always shown; a Lagging label that would still collide is dropped —
    // nine lagging sectors bunch together, and the zone list under the wheel
    // names every sector anyway. Widths are estimated at 6px a character, rows 13px
    // apart (a 10px label's box is ~12px tall, so 11px still touched).
    const important = s => s.zone === 'Leading' || s.zone === 'Improving' || s.zone === 'Weakening';
    const drawn = sectors.filter(s => s.trail && s.trail.length && s.zone)
      .map(s => ({ s, x: X(s.strength), y: Y(s.direction) }))
      .sort((a, b) => (important(b.s) - important(a.s)) || (a.y - b.y));
    drawn.forEach(({ s }) => {
      out += `<polyline points="${s.trail.map(p => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ')}" fill="none" stroke="${ROT_COL[s.zone]}" stroke-width="1.4" opacity=".45" stroke-linejoin="round"/>`;
    });
    drawn.forEach(({ s, x, y }) => {
      out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${ROT_COL[s.zone]}" stroke="var(--bg-card)" stroke-width="1.5"><title>${escText(s.name)}: ${s.zone} · strength ${s.strength} · direction ${s.direction}</title></circle>`;
    });
    const placed = [];
    const clash = (x, y, w) => placed.some(p => x < p.x + p.w + 3 && p.x < x + w + 3 && Math.abs(p.y - y) < 13);
    drawn.forEach(({ s, x, y }) => {
      const label = rotShort(s.name);
      const lw = label.length * 6;
      const lx = x + 7 + lw > W - 4 ? x - 7 - lw : x + 7;
      let ly = y + 3.5;
      for (let n = 0; n < 6 && clash(lx, ly, lw); n++) ly += 13;
      ly = Math.max(12, Math.min(H - 16, ly));
      if (clash(lx, ly, lw) && !important(s)) return;
      placed.push({ x: lx, y: ly, w: lw });
      const strong = s.zone === 'Leading' || s.zone === 'Improving';
      out += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="rot-lbl${strong ? ' rot-lbl-strong' : ''}">${escText(label)}</text>`;
    });
    return out + '</svg>';
  }

  function renderRotation() {
    const card = document.getElementById('rotationCard');
    const body = document.getElementById('rotationBody');
    if (!card || !body) return;
    const d = rotationData;
    const w = d && d.wheel;
    if (!w || !Array.isArray(w.sectors) || !w.sectors.length) { card.style.display = 'none'; return; }
    card.style.display = '';
    const t = d.thermometer || {};
    const wk = document.getElementById('rotationWeek');
    if (wk) wk.textContent = 'week to ' + rotDate(w.week);
    const byZone = z => w.sectors.filter(s => s.zone === z).sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0));
    const zoneRow = z => {
      const list = byZone(z);
      if (!list.length) return '';
      return `<div class="rot-zone"><span class="rot-zone-lbl rot-z-${z.toLowerCase()}">${z}</span>`
        + list.map(s => `<button class="rot-chip" data-rot-sector="${escText(s.name)}">${escText(rotShort(s.name))}</button>`).join('')
        + `</div>`;
    };
    const before = (w.previous || []).map(p => `${escText(rotShort(p.name))} <span class="rot-dim">${rotDate(p.from)}–${rotDate(p.to)}</span>`).join(' · ');
    const thermoWord = t.zone === 'Washout' ? 'Washout, a broad sell-off' : t.zone === 'Stretched' ? 'Stretched, most markets already up' : 'Normal';
    body.innerHTML = `
      <div class="rot-top">
        ${w.active ? `<div class="rot-active"><span class="rot-active-lbl">Active now</span><span class="rot-active-name">${escText(w.active.name)}</span><span class="rot-active-since">since ${rotDate(w.active.since)} · ${w.active.weeks} wk${w.active.weeks === 1 ? '' : 's'}</span></div>` : ''}
        ${before ? `<div class="rot-before">Before: ${before}</div>` : ''}
        ${t.pct_above_200d != null ? `<div class="rot-thermo">${t.pct_above_200d}% of markets above their 200-day average · ${thermoWord} (${t.pct_4w_ago}% four weeks ago)</div>` : ''}
      </div>
      ${rotationWheelSvg(w.sectors)}
      <div class="rot-zones">${ROT_ZONES.map(zoneRow).join('')}</div>
      <p class="rot-note">Where money has been moving, not where it goes next. Each dot is a sector against the average sector; tails show the last 8 weeks. In testing (2013–26), sectors in Improving reached Leading within 4 weeks 57–62% of the time but did not beat the average sector afterwards, and the order of leaders did not repeat. Tap a sector to see its markets.</p>`;
    body.querySelectorAll('[data-rot-sector]').forEach(el =>
      el.addEventListener('click', () => srGoToSector(el.dataset.rotSector)));
  }

  // ── Market ranking + paper record (rotation.json, rotation_paper.json) ────
  // The one ranking that beat an equal-weight basket both before and after
  // 2022 in testing. The paper record is marked forward from its first run and
  // never backfilled, so it shows the ranking on data it has not seen.
  function leadersSparkSvg(nav) {
    const W = 300, H = 36;
    const vals = nav.flatMap(p => [p.port, p.basket]);
    const lo = Math.min(...vals), hi = Math.max(...vals), span = (hi - lo) || 1;
    const x = i => 2 + (i / Math.max(1, nav.length - 1)) * (W - 4);
    const y = v => H - 3 - ((v - lo) / span) * (H - 6);
    const line = key => nav.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
    return `<svg class="lead-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">`
      + `<polyline points="${line('basket')}" fill="none" stroke="var(--text-muted)" stroke-width="1.5"/>`
      + `<polyline points="${line('port')}" fill="none" stroke="var(--accent)" stroke-width="2"/></svg>`;
  }

  function renderLeaders() {
    const card = document.getElementById('leadersCard');
    const body = document.getElementById('leadersBody');
    if (!card || !body) return;
    const d = rotationData && rotationData.leaders;
    if (!d || !Array.isArray(d.list) || !d.list.length) { card.style.display = 'none'; return; }
    card.style.display = '';
    const asOf = document.getElementById('leadersAsOf');
    if (asOf) asOf.textContent = 'as of ' + rotDate(rotationData.as_of);
    const byName = new Map(allData.map(it => [it.instrument_name, it]));
    const pct = v => v == null ? '—' : (v >= 0 ? '+' : '') + (Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1)) + '%';
    const rows = (leadersShowAll ? d.list : d.list.slice(0, 10)).map(r => {
      const code = (byName.get(r.name) || {}).primary_signal || '';
      const sigTag = code ? `<span class="lead-tag ${code[0] === 'B' ? 'sig-b' : 'sig-s'}" title="Fired on the latest Daily bar">${code}</span>` : '';
      const newTag = r.new ? '<span class="lead-tag new" title="Entered the ranking since the last re-rank">NEW</span>' : '';
      const high = r.below_high == null ? '' : r.below_high < 0.5 ? 'at its high' : `${r.below_high.toFixed(0)}% below high`;
      const bits = [escText(rotShort(r.sector)), r.cls === 'Crypto' ? 'very volatile' : '', high, r.mom_3m != null ? '3m ' + pct(r.mom_3m) : '']
        .filter(Boolean).join(' · ');
      return `<div class="lead-row" data-act="openModal" data-arg="${escText(r.name)}" role="button" tabindex="0">`
        + `<span class="lead-rank">${r.rank}</span>`
        + `<div class="lead-main"><div class="lead-l1"><span class="lead-name">${escText(r.name)}</span>${newTag}${sigTag}</div><div class="lead-l2">${bits}</div></div>`
        + `<span class="lead-move" title="Move from 12 months ago to 1 month ago">${pct(r.mom_12_1)}</span></div>`;
    }).join('');
    const hiddenList = d.hidden || [];
    const hidden = hiddenList.slice(0, 6).map(h => escText(h.name)).join(', ');
    const P = rotationPaper;
    let paper = '';
    if (P && Array.isArray(P.nav) && P.nav.length) {
      const last = P.nav[P.nav.length - 1];
      const pr = last.port - 100, br = last.basket - 100;
      const sign = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
      paper = `<div class="lead-paper">
        <div class="lead-paper-lbl">Paper record · since ${rotDate(P.started)}</div>
        <div class="lead-paper-row"><span>Ranking <b class="${pr >= 0 ? 'perf-pos' : 'perf-neg'}">${sign(pr)}</b></span><span>Average basket <b>${sign(br)}</b></span></div>
        ${P.nav.length >= 2 ? leadersSparkSvg(P.nav) : ''}
        <div class="lead-paper-sub">Not real trades. The top ${(P.holdings || d.list).length} held at equal weight from ${rotDate(P.started)}, after financing and spread, re-ranked every 20 sessions${P.next_rerank_in != null ? ` (next in ${P.next_rerank_in})` : ''}. Never backfilled.</div>
      </div>`;
    }
    body.innerHTML = `
      <p class="lead-intro">Markets with the strongest steady climb over the past year, not counting the last month. At most two per sector.</p>
      <div class="lead-list">${rows}</div>
      ${d.list.length > 10 ? `<button class="lead-more" id="leadersMore">${leadersShowAll ? 'Show top 10' : `Show all ${d.list.length}`}</button>` : ''}
      ${hidden ? `<p class="lead-hidden">Left out by the two-per-sector cap: ${hidden}${hiddenList.length > 6 ? '…' : ''}. They move with names already listed.</p>` : ''}
      ${paper}
      <p class="rot-note">In testing (2013–26) this ranking beat an average basket both before and after 2022, but in lumps: 2021 and 2022 lost. It is not a buy signal. Use it to choose which markets to study, and keep it to two per sector.</p>`;
    const more = document.getElementById('leadersMore');
    if (more) more.addEventListener('click', () => { leadersShowAll = !leadersShowAll; renderLeaders(); });
  }

  // Jump to Signals searched to a sector. Shared by the Sector Radar and the
  // rotation wheel (it used to live inside renderSectorRadar).
  function srGoToSector(sector) {
    const inp = document.getElementById('scannerSearch');
    if (inp) inp.value = sector;
    clearCatChip();
    scannerSort = 'signal';
    const sortSel = document.getElementById('scannerSort');
    if (sortSel) sortSel.value = 'signal';
    updateScannerCtxStrip?.();
    navigateToTab('scanner');
    buildScannerCards();
    // Re-assert the top AFTER the cards exist. navigateToTab scrolls while the
    // scanner still holds the previous card set; rebuilding changes the document
    // height, and scroll anchoring can pull the viewport back down.
    try { window.scrollTo({ top: 0, behavior: 'instant' }); }
    catch (_) { document.scrollingElement.scrollTop = 0; }
  }

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
    // Sized for a phone: the SVG scales to the card width, so a SMALLER viewBox
    // renders everything LARGER. 460→418 wide plus bigger type is ~+25% on the
    // labels at 375px. Label anchors use a shorter horizontal radius than
    // vertical (LR_X < LR_Y) — the left/right labels are the ones that run out
    // of room, and pulling them in buys the width the bigger type needs.
    const CX = 209, CY = 162, R = 108;
    const LR_X = R + 10, LR_Y = R + 15;   // label placement radii
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
        stems += `<line x1="${CX}" y1="${CY}" x2="${px.toFixed(1)}" y2="${py.toFixed(1)}" stroke="${col}" stroke-width="3.4" stroke-linecap="round" opacity=".9"/>`;
        node = `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5" fill="${col}"/>`;
      } else if (isWarm) {
        stems += `<line x1="${CX}" y1="${CY}" x2="${px.toFixed(1)}" y2="${py.toFixed(1)}" stroke="${col}" stroke-width="2.7" stroke-linecap="round" opacity=".55"/>`;
        node = `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" fill="${col}" opacity=".75"/>`;
      } else {
        stems += `<line x1="${CX}" y1="${CY}" x2="${px.toFixed(1)}" y2="${py.toFixed(1)}" stroke="#34342f" stroke-width="2.2" stroke-linecap="round"/>`;
        node = `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.5" fill="#4a4a46"/>`;
      }
      const la = (-90 + i * 360 / N) * Math.PI / 180;
      const lx = CX + LR_X * Math.cos(la), ly = CY + LR_Y * Math.sin(la);
      const anchor = lx > CX + 12 ? 'start' : lx < CX - 12 ? 'end' : 'middle';
      const lbl = SR_ABBR[s.sector] || s.sector;
      const zStr = s.z === null ? '' : s.z.toFixed(1);
      let label;
      if (isHot) {
        label = `<text x="${lx.toFixed(1)}" y="${(ly + 4.5).toFixed(1)}" text-anchor="${anchor}" font-size="13" font-weight="600" fill="${col}">${lbl} ${tiltGlyph(s)}${zStr}</text>`;
      } else if (isWarm) {
        label = `<text x="${lx.toFixed(1)}" y="${(ly + 4.5).toFixed(1)}" text-anchor="${anchor}" font-size="13" fill="${col}" opacity=".8">${lbl} ${tiltGlyph(s)}${zStr}</text>`;
      } else {
        label = `<text x="${lx.toFixed(1)}" y="${(ly + 4.5).toFixed(1)}" text-anchor="${anchor}" font-size="12.5" fill="var(--text-muted)">${lbl}${zStr ? ` <tspan fill="#8c8c96">${zStr}</tspan>` : ''}</text>`;
      }
      // Whole spoke (node + label) is a tap target → Signals filtered to this
      // sector. Generous transparent hit-circle over the label makes it usable
      // on touch without overlapping neighbours.
      spokes += `<g class="sr-spoke" data-sr-sector="${s.sector}" style="cursor:pointer" role="button" tabindex="0" aria-label="${s.sector} — open in Signals">`
        + `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="21" fill="transparent"/>${node}${label}</g>`;
    });
    const ring = (z, extra) =>
      `<circle cx="${CX}" cy="${CY}" r="${(z / 3 * R).toFixed(1)}" fill="none" ${extra}/>`;
    const svg = `
      <svg class="sr-radar-svg" viewBox="0 0 418 324" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sector activity radar">
        ${ring(1, 'stroke="#242420"')}${ring(2, 'stroke="#242420"')}${ring(3, 'stroke="#1d1d19"')}
        ${ring(alertZ, 'stroke="#8a6519" stroke-dasharray="4 4"')}
        <text x="${CX + (alertZ / 3 * R) * 0.72 + 12}" y="${CY - (alertZ / 3 * R) * 0.72}" font-size="11.5" fill="#8a6519">alert ${alertZ}σ</text>
        <text x="${CX + 4}" y="${Math.round(CY - R / 3 + 11)}" font-size="10" fill="#4a4a46">1σ</text>
        <text x="${CX + 4}" y="${Math.round(CY - 2 * R / 3 + 11)}" font-size="10" fill="#4a4a46">2σ</text>
        ${axes}
        <polygon points="${polyPts.join(' ')}" fill="rgba(251,191,36,.05)" stroke="#55554e" stroke-width="1.2"/>
        ${stems}${spokes}
      </svg>`;

    // ── hot / building sector cards + baseline line ──
    const cards = hotSecs.map(s => `
      <div class="sr-hot-card" data-sr-sector="${s.sector}" style="border-color:${tiltCol(s)}">
        <div class="sr-hot-head" style="color:${tiltCol(s)}">
          <span>${s.sector.toUpperCase()}${s.tilt === 'buy' ? ' ▲ buy-tilted' : s.tilt === 'sell' ? ' ▼ sell-tilted' : s.tilt === 'mixed' ? ' ◆ mixed' : ' ◆ vol only'}</span>
          <span class="sr-z-tap" data-sr-info="${s.sector}" role="button" tabindex="0" title="How this z is calculated" aria-label="${s.sector} — how this z is calculated">z ${s.z.toFixed(1)}<i class="sr-i" aria-hidden="true">i</i></span>
        </div>
        <div class="sr-hot-sub">elevated ${s.elevated_days} day${s.elevated_days === 1 ? '' : 's'} · ${s.buys} buy${s.buys === 1 ? '' : 's'} · ${s.sells} sell${s.sells === 1 ? '' : 's'} · ${s.vol_spikes} vol spike${s.vol_spikes === 1 ? '' : 's'}</div>
        <div class="sr-hot-meta">${s.members} members · rate ${s.rate.toFixed(2)}${s.mean_rate !== null ? ' vs mean ' + s.mean_rate.toFixed(2) : ''} · ${s.date}</div>
      </div>`).join('');
    // Building sectors (≥1σ, below alert) — dimmer, so a quiet-ish day still shows movement
    const warmCards = warmSecs.map(s => `
      <div class="sr-warm-card" data-sr-sector="${s.sector}" style="border-left-color:${tiltCol(s)}">
        <div class="sr-warm-head">
          <span>${s.sector.toUpperCase()} · building${s.tilt === 'buy' ? ' ▲ buy-tilted' : s.tilt === 'sell' ? ' ▼ sell-tilted' : s.tilt === 'mixed' ? ' ◆ mixed' : ''}</span>
          <span class="sr-z-tap" data-sr-info="${s.sector}" role="button" tabindex="0" title="How this z is calculated" aria-label="${s.sector} — how this z is calculated">z ${s.z.toFixed(1)}<i class="sr-i" aria-hidden="true">i</i></span>
        </div>
        <div class="sr-hot-meta">${s.buys} buy${s.buys === 1 ? '' : 's'} · ${s.sells} sell${s.sells === 1 ? '' : 's'} · ${s.vol_spikes} vol spike${s.vol_spikes === 1 ? '' : 's'} · ${s.members} members · ${s.date}</div>
      </div>`).join('');
    // Baseline sectors (<1σ) — compact clickable chips, still activity-ranked
    const baseChips = baseSecs.length ? `
      <div class="sr-base-head">${baseSecs.length === N ? 'All ' + N + ' sectors' : baseSecs.length + ' sector' + (baseSecs.length === 1 ? '' : 's')} at baseline (z &lt; 1σ) · tap to scan</div>
      <div class="sr-chips">${baseSecs.map(s => {
        const zStr = s.z === null ? '–' : s.z.toFixed(1);
        return `<button class="sr-chip" data-sr-sector="${s.sector}">${SR_ABBR[s.sector] || s.sector} <span class="sr-chip-z" data-sr-info="${s.sector}" role="button" tabindex="0" title="How this z is calculated" aria-label="${s.sector} — how this z is calculated">${zStr}</span></button>`;
      }).join('')}</div>` : '';

    body.innerHTML = svg + `<div class="sr-cards">${cards}${warmCards}${baseChips}</div>`
      + `<div class="sr-legend">z vs own ${d.baseline_days || 20}-day baseline · <span style="color:var(--buy)">●</span> buy-tilted · <span style="color:var(--sell)">●</span> sell-tilted · <span style="color:var(--accent)">●</span> mixed / vol-only · dim = building (1σ+) · grey = at baseline · tap a sector → Signals · tap its z → how it's scored</div>`;

    // Any sector element (spoke, hot/building card, baseline chip) → Signals
    // filtered to that sector, ranked activity-first (signal-bearing on top).
    body.querySelectorAll('[data-sr-info]').forEach(el => {
      // The z readout sits INSIDE the chip/card, which navigates to Signals on
      // click. Without stopPropagation the modal would open AND the tab would
      // switch underneath it.
      el.addEventListener('click', e => { e.stopPropagation(); openSectorInfo(el.dataset.srInfo); });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); e.stopPropagation(); openSectorInfo(el.dataset.srInfo);
        }
      });
    });
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
      // Reversals first, then MA500 touches, then A–Z. It used to put "proven
      // edge" first by confidence tier; the tiers are in-sample (2026-09-11).
      const p = sigPriority(a[f('primary_signal')]) - sigPriority(b[f('primary_signal')]);
      if (p !== 0) return p;
      return (a.instrument_name || '').localeCompare(b.instrument_name || '');
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
      const lbl  = isReversal(sig) ? 'Trend change' : 'MA500 touch';
      const lowCls = '';
      const lowTip = '';
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
      const tfs = TIMEFRAMES.filter(t => SIGNAL_TFS.has(t.code)).map(t => ({
        code: t.code, field: t.prefix + 'trend_direction', label: t.label,
      }));
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

      // Volume spike
      const volSpike = item[f('volume_spike_flag')] === 'yes';

      return `<div class="signal-feed-item feed-${buy ? 'buy' : 'sell'}" data-act="openModal" data-arg="${item.instrument_name}">
        <div class="feed-info">
          <div class="feed-name">${item.instrument_name} ${volSpike ? '<span class="badge-confidence" style="background:var(--volume-soft);color:var(--volume)">VOL</span>' : ''}</div>
          <div class="feed-detail">${item[f('confirmation_status')] || ''}</div>
          <div class="feed-meta-row">
            ${rocStr ? `<span class="roc-val ${rocCls}" style="font-size:.68rem">ROC ${rocStr}</span>` : ''}
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
      const maxPairs = summaryData.ma_max_pairs || 2;   // 3-MA ribbon -> 2 adjacent pairs
      const mid = maxPairs / 2;
      const dir = order > mid ? 'Bullish lean' : order < mid ? 'Bearish lean' : 'Neutral';
      return `<div class="signal-feed-item" data-act="openModal" data-arg="${item.instrument_name}" style="border-left:3px solid var(--volume)">
        <span class="compression-alert">SQUEEZE</span>
        <div class="feed-info">
          <div class="feed-name">${item.instrument_name} ${tvBtn(item.instrument_name, '')}</div>
          <div class="feed-detail">Spread: ${spread ? spread.toFixed(1) : '--'}%</div>
        </div>
        <span class="feed-group">${item.group || ''}</span>
      </div>`;
    }).join('');
  }


  // ── Sector Info Modal ────────────────────────────────────────────────
  // Breakdown of how one radar spoke was computed. Everything here already
  // ships in sector_radar.json / sector_activity.json — no new pipeline work.
  const sectorOverlay = document.getElementById('sectorOverlay');
  const sectorBody    = document.getElementById('sectorModalBody');
  let sectorActivity  = null;    // { updated_at, rows: [{date,sector,...}] }
  let sectorActivityTried = false;

  function closeSectorInfo() { if (sectorOverlay) sectorOverlay.classList.remove('open'); }
  if (sectorOverlay) {
    document.getElementById('sectorClose').addEventListener('click', closeSectorInfo);
    sectorOverlay.addEventListener('click', e => { if (e.target === sectorOverlay) closeSectorInfo(); });
  }

  // 572K file — fetched ONCE PER TIMEFRAME, on first info tap, never during boot.
  // Cached per tf rather than in one slot: the sparkline in this modal has to
  // match the radar above it, and flipping timeframe with a single cached blob
  // would have drawn daily bars under a weekly z-score.
  const sectorActivityByTf = {};
  async function ensureSectorActivity() {
    const tf = RADAR_TF_FOR(timeframe);
    if (tf in sectorActivityByTf) {
      sectorActivity = sectorActivityByTf[tf];
      return sectorActivity;
    }
    const r = await fetchJson(tf === 'W'  ? '/api/sector-activity-w'
                            : tf === '3D' ? '/api/sector-activity-3d'
                                          : '/api/sector-activity', null);
    sectorActivityByTf[tf] = (r && Array.isArray(r.rows)) ? r : null;
    sectorActivity = sectorActivityByTf[tf];
    return sectorActivity;
  }

  async function openSectorInfo(sector) {
    if (!sectorOverlay || !sectorBody) return;
    sectorBody.innerHTML = '<div class="sr-modal-loading">Loading…</div>';
    sectorOverlay.classList.add('open');
    await ensureSectorActivity();
    renderSectorInfo(sector);
  }

  // 30-day sparkline of the sector's own activity rate, with its mean drawn in.
  function sectorSparkline(rows, meanRate) {
    if (!rows || rows.length < 2) {
      return '<div class="sr-modal-nohist">No history available for this sector yet.</div>';
    }
    const W = 460, H = 96, PAD = 6;
    const vals = rows.map(r => r.rate);
    const peak = Math.max(...vals, meanRate || 0, 0.0001);
    const x = i => PAD + i * (W - PAD * 2) / Math.max(1, rows.length - 1);
    const y = v => H - PAD - (v / peak) * (H - PAD * 2);
    const bars = rows.map((r, i) => {
      const bw = Math.max(2, (W - PAD * 2) / rows.length - 2);
      const bh = Math.max(0, H - PAD - y(r.rate));
      const last = i === rows.length - 1;
      return `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${y(r.rate).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="${last ? 'var(--accent)' : '#3a3a36'}"><title>${r.date} — rate ${r.rate.toFixed(3)} (${r.buys}B ${r.sells}S ${r.vol_spikes}V)</title></rect>`;
    }).join('');
    const my = y(meanRate || 0);
    const meanLine = meanRate
      ? `<line x1="${PAD}" y1="${my.toFixed(1)}" x2="${W - PAD}" y2="${my.toFixed(1)}" stroke="var(--volume)" stroke-width="1.2" stroke-dasharray="4 3"/>`
      : '';
    return `<svg class="sr-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Activity over the last ${rows.length} days">${bars}${meanLine}</svg>
      <div class="sr-spark-key"><span><i style="background:var(--accent)"></i>today</span>
        <span><i style="background:var(--volume)"></i>${(meanRate || 0).toFixed(3)} average</span>
        <span class="sr-spark-span">${rows[0].date} → ${rows[rows.length - 1].date}</span></div>`;
  }

  function renderSectorInfo(sector) {
    const d = sectorRadarData;
    const s = d && d.sectors ? d.sectors.find(x => x.sector === sector) : null;
    if (!s) { sectorBody.innerHTML = '<div class="sr-modal-nohist">No radar data for this sector.</div>'; return; }

    const alertZ  = d.alert_z || 1.5;
    const baseDays = d.baseline_days || 20;
    const minMem  = d.min_members || 8;
    const events  = (s.buys || 0) + (s.sells || 0) + (s.vol_spikes || 0);
    const isHot   = s.hot && (s.z >= 2 || s.elevated_days >= 2);
    const isWarm  = !isHot && s.z !== null && s.z >= 1;
    const state   = isHot ? 'HOT' : isWarm ? 'BUILDING' : 'AT BASELINE';
    const stateCls= isHot ? 'sr-st-hot' : isWarm ? 'sr-st-warm' : 'sr-st-base';
    const tiltTxt = s.tilt === 'buy' ? '▲ buy-tilted' : s.tilt === 'sell' ? '▼ sell-tilted'
                  : s.tilt === 'mixed' ? '◆ mixed' : '◆ no tilt';
    const tiltCol = s.tilt === 'buy' ? 'var(--buy)' : s.tilt === 'sell' ? 'var(--sell)' : 'var(--accent)';
    const zStr    = s.z === null ? '–' : (s.z > 0 ? '+' : '') + s.z.toFixed(2);

    const rows = sectorActivity
      ? sectorActivity.rows.filter(r => r.sector === sector).slice(-30)
      : null;

    const shownCount = d.sectors.filter(x => x.members >= minMem).length;

    sectorBody.innerHTML = `
      <div class="sr-modal-head">
        <h2>${sector}</h2>
        <div class="sr-modal-badges">
          <span class="sr-st ${stateCls}">${state}</span>
          <span class="sr-tilt" style="color:${tiltCol}">${tiltTxt}</span>
        </div>
      </div>

      <div class="sr-modal-sec">
        <h4>Today <span class="sr-modal-date">${s.date || ''}</span></h4>
        <div class="sr-stat-grid">
          <div><b>${s.members}</b><span>instruments</span></div>
          <div><b style="color:var(--buy)">${s.buys}</b><span>new buy${s.buys === 1 ? '' : 's'}</span></div>
          <div><b style="color:var(--sell)">${s.sells}</b><span>new sell${s.sells === 1 ? '' : 's'}</span></div>
          <div><b style="color:var(--volume)">${s.vol_spikes}</b><span>vol spike${s.vol_spikes === 1 ? '' : 's'}</span></div>
        </div>
        <p class="sr-modal-eq"><b>${events}</b> event${events === 1 ? '' : 's'} across <b>${s.members}</b> instruments
          = activity rate <b>${s.rate.toFixed(3)}</b></p>
      </div>

      <div class="sr-modal-sec">
        <h4>How that becomes the spoke</h4>
        <table class="sr-calc">
          <tr><td>Today's rate</td><td>${s.rate.toFixed(3)}</td></tr>
          <tr><td>Normal for this sector <span class="sr-dim">(avg of last ${baseDays} days)</span></td>
              <td>${s.mean_rate === null ? '–' : s.mean_rate.toFixed(3)}</td></tr>
          <tr class="sr-calc-hl"><td>Difference, in standard deviations</td><td>z = ${zStr}</td></tr>
          <tr><td>Flags hot at</td><td>z ≥ ${alertZ}</td></tr>
          <tr><td>Consecutive elevated days</td><td>${s.elevated_days || 0}</td></tr>
          <tr><td>Baseline built from</td><td>${s.history_days} days</td></tr>
        </table>
      </div>

      <div class="sr-modal-sec">
        <h4>Last ${rows ? rows.length : 0} days</h4>
        ${sectorSparkline(rows, s.mean_rate)}
      </div>

      <div class="sr-modal-sec sr-modal-warn">
        <h4>What this is not telling you</h4>
        <ul>
          <li>It measures <b>signal fires and volume spikes — not price</b>. A sector can be up 3% and still read flat here.</li>
          <li>Each sector is scored against <b>its own</b> baseline. A busy sector's normal is higher than a quiet one's — that's why this is a z-score and not a raw count.</li>
          <li><b>Daily timeframe only.</b> The 4H toggle at the top of the app does not change this card.</li>
          <li>Sectors with fewer than ${minMem} members are excluded from the radar (${shownCount} of ${d.sectors.length} shown today).</li>
        </ul>
      </div>`;
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
    else                 { label = '🕰 Long-running'; cls = 'maturity-mature'; }   // not a warning: long trends end LEAST often
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
    const volSpike = item[f('volume_spike_flag')] === 'yes';
    const compression = item[f('ribbon_compression')] === 'yes';
    const trendRun = parseInt(item[f('trend_run_days')]);
    const maLongest  = (summaryData && summaryData.ma_longest)   || 500;
    const maShortest = (summaryData && summaryData.ma_shortest)  || 50;
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
    const dirWord = sig.startsWith('B') ? 'buy' : sig.startsWith('S') ? 'warning' : '';
    const parts = [`${sig}${dirWord ? ' ' + dirWord : ''}: ${sigDesc[sig] || 'signal'}`];
    if (!isNaN(trendRun) && trendRun > 0) parts.push(`${trendRun}d ${trend.toLowerCase()}`);
    if (volSpike) parts.push('volume spike');
    // No "breakout watch" and no confidence tier (2026-09-11): a quiet market
    // measured no lean up or down, and the tiers were fitted in-sample.
    if (compression) parts.push('moving averages bunched together');
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

  // Asset class comes from the pipeline (`asset_class`, added 2026-07-29) —
  // instruments.py asset_class_of() is the one implementation. The fallback
  // below is the old hand-copy, kept ONLY so a payload published before that
  // column existed still filters; delete it once no such payload can be served.
  // Do not "improve" the fallback: if the rule changes, change it in Python.
  // What the Class chip filters on. Deliberately NOT assetClassOf: the pipeline
  // maps Rates -> Index on purpose, because the confidence map and backtest
  // buckets are keyed by class and a brand-new class would look up nothing and
  // silently drop every rate signal to the untiered fallback (instruments.py).
  // But Instruments.txt has promised since the group was added that Rates gets
  // its own chip, and it never did — the five treasury/vol instruments filtered
  // as "Index" and could only be found under Group. One rule for scoring, one
  // for browsing, and they are allowed to differ as long as each says so.
  function browseClassOf(d) {
    if ((d.group || '').trim() === 'Rates') return 'Rates';
    return assetClassOf(d);
  }

  function assetClassOf(d) {
    if (d.asset_class) return d.asset_class;
    const g = (d.group || '').trim();
    if (g === 'Crypto' || g === 'Blockchain') return 'Crypto';
    if (g === 'Currency') return 'Currency';
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

    let filtered = allData;
    if (search) filtered = filtered.filter(d => matchesSearch(d, search));
    // Class chip — same matcher the term used to get when it was typed into the
    // search box, but as its own filter, so it composes with everything below
    // instead of suppressing it.
    if (scannerCatFilter) filtered = filtered.filter(d => matchesSearch(d, scannerCatFilter));
    if (assetClass !== 'all') filtered = filtered.filter(d => browseClassOf(d) === assetClass);
    if (group !== 'all')   filtered = filtered.filter(d => mapGroup(d.group) === group);
    // Region filter — set by clicking a region row on the By Region card
    if (activeRegionFilter) {
      filtered = filtered.filter(d => (GP_REGION_MAP[d.group] || 'Other') === activeRegionFilter);
    }
    if (sector !== 'all')  filtered = filtered.filter(d => d.sector === sector);
    if (trend !== 'all')   filtered = filtered.filter(d => effectiveTrend(d) === trend);
    // MA stack — reads the ACTIVE timeframe through f(), like every other
    // per-timeframe filter here.
    const stackSel = document.getElementById('scannerStackFilter');
    const stackVal = stackSel ? stackSel.value : 'all';
    if (stackVal !== 'all') filtered = filtered.filter(d => matchesStackFilter(d, stackVal));

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

    // ── Move filter (period return) ──
    // Deliberately OUTSIDE the `if (!search)` chip block below: like Class and
    // Mood it composes with everything else, so searching a name does not
    // silently switch it off.
    if (scannerMoveDir !== 'all' || scannerMoveMin > 0) {
      filtered = filtered.filter(d => {
        const v = parseFloat(d[scannerMovePeriod]);
        if (isNaN(v)) return false;   // no return for this period — can't judge it
        if (scannerMoveDir === 'up' && v < 0) return false;
        if (scannerMoveDir === 'down' && v > 0) return false;
        return Math.abs(v) >= scannerMoveMin;
      });
    }

    // ── Chip filter (skip when user is searching by name) ──
    if (!search) {
      if (activeScannerFilter === 'buy')          filtered = filtered.filter(isBuy);
      else if (activeScannerFilter === 'sell')    filtered = filtered.filter(isSell);
      else if (activeScannerFilter === 'squeeze') filtered = filtered.filter(d => d[f('ribbon_compression')] === 'yes');
      else if (activeScannerFilter === 'keylvl') filtered = filtered.filter(d => d.key_level_touched_today === 'yes');
      else if (activeScannerFilter === 'vol')    filtered = filtered.filter(d => d[f('volume_spike_flag')] === 'yes');
      // Sessions, not calendar days — the same window the chip label names.
      else if (activeScannerFilter === 'event')      filtered = filtered.filter(d => !!nextEventFor(d.instrument_name, 7));
      else if (activeScannerFilter === 'noevent')    filtered = filtered.filter(d => !nextEventFor(d.instrument_name, 7));
      else if (activeScannerFilter === 'analyzed')   filtered = filtered.filter(d => userStarred.has(d.instrument_name));
      else if (activeScannerFilter === 'unanalyzed') filtered = filtered.filter(d => !userStarred.has(d.instrument_name));
      else if (activeScannerFilter === 'radar_prime')  filtered = filtered.filter(d => radarConfluenceScore(d) >= 75);
      else if (activeScannerFilter === 'radar_strong') filtered = filtered.filter(d => { const s = radarConfluenceScore(d); return s >= 50 && s < 75; });
      else if (activeScannerFilter === 'today') {
        // Was: parse the date and compare against the DEVICE's midnight — so on
        // a weekend, or any time the feed ran behind, the chip returned nothing
        // while the cards right below it read "Today". Now it uses the same
        // test the cards do: the fire is on this instrument's newest bar.
        filtered = filtered.filter(firedOnLatestBar);
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
        // Then newest fire first (was the confidence tier, retired 2026-09-11).
        return (b[f('last_signal_date')] || '').localeCompare(a[f('last_signal_date')] || '');
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
    } else if (/^pct_1[dwmy]_(desc|asc)$/.test(scannerSort)) {
      // One branch for all four periods — the day/year pair used to be written
      // out twice each, and adding week and month by the same hand-copy would
      // have made eight near-identical sorts to keep in step.
      const asc = scannerSort.endsWith('_asc');
      const col = scannerSort.slice(0, asc ? -4 : -5); // pct_1d_desc → pct_1d
      const dir = asc ? 1 : -1;
      filtered = [...filtered].sort((a, b) =>
        dir * ((parseFloat(a[col]) || 0) - (parseFloat(b[col]) || 0)));
    }

    // (The buy/sell/squeeze/key-level/today tallies that used to live here fed
    // the #scannerSummary pills, which were removed in v226 — they were five
    // full passes over the filtered list computing numbers nobody rendered.)

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
      const maMaxPairs = summaryData.ma_max_pairs || 2;   // 3-MA ribbon -> 2 adjacent pairs
      const maOrderPct = !isNaN(maOrder) ? Math.round(maOrder / maMaxPairs * 100) : null;
      const roc = parseFloat(item[f('roc')]);
      const rocStr = !isNaN(roc) ? (roc >= 0 ? '+' : '') + roc.toFixed(1) + '%' : '';
      const starred = userStarred.has(item.instrument_name);
      const pct = pctFromMa(item);
      const conv = convictionOf(item);   // sector-mood grade (validated Phase 0); null when no signal
      // Cap animation delay so the browser doesn't track hundreds of CSS timers
      const delay = Math.min(i, 30) * 20;

      // Stats row: five uniform tiles (1D / 1W / 1M / 1Y / VOL).
      // One decimal, not two — at five tiles across a 280px card a "-45.07%"
      // wraps, and it matches the ROC / MA500 chips right above. Past ±100%
      // the decimal is dropped too: "+221.5%" measured 52px in a 51px tile at
      // 375px wide, and a year is quite capable of a four-figure crypto move.
      const statTile = (label, val, title) => {
        const v = parseFloat(val);
        const t = title ? ` title="${title}"` : '';
        if (isNaN(v)) return `<div class="sc-stat"${t}><div class="sc-stat-lbl">${label}</div><div class="sc-stat-val sc-stat-na">—</div></div>`;
        const txt = (v >= 0 ? '+' : '') + v.toFixed(Math.abs(v) >= 100 ? 0 : 1) + '%';
        return `<div class="sc-stat"${t}><div class="sc-stat-lbl">${label}</div><div class="sc-stat-val ${v >= 0 ? 'perf-pos' : 'perf-neg'}">${txt}</div></div>`;
      };
      const rv = rvol(item);
      const volTile = rv === null
        ? '<div class="sc-stat"><div class="sc-stat-lbl">VOL</div><div class="sc-stat-val sc-stat-na">—</div></div>'
        : `<div class="sc-stat" title="Today's volume vs its ${tfMeta().label.toLowerCase()} rolling average — ${fmtRvol(rv)} of normal"><div class="sc-stat-lbl">VOL</div><div class="sc-stat-val sc-stat-vol">${fmtRvol(rv)}</div></div>`;

      return `<div class="scanner-card pop-in${_aiScan ? ' ai-card' : ''}${conv && conv.cls ? ' ' + conv.cls : ''}${costTight(item) ? ' sc-cost-dim' : ''}" style="animation-delay:${delay}ms" data-act="openModal" data-arg="${item.instrument_name}">
        <div class="scanner-top">
          <div>${cardIdentityHtml(item, { isAi: _aiScan, sep: ' / ' })}</div>
          ${cardActionsHtml(item.instrument_name, { starred })}
        </div>
        <div class="scanner-price">${formatPrice(item[f('close')])}${pct !== null ? ` <span class="roc-val ${pct >= 0 ? 'roc-pos' : 'roc-neg'}" style="font-size:.7rem" title="Distance from MA500"><span class="pm-lbl">MA500</span>${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span>` : ''}${rocStr ? ` <span class="roc-val ${roc >= 0 ? 'roc-pos' : 'roc-neg'}" style="font-size:.7rem" title="Rate of change"><span class="pm-lbl">ROC</span>${rocStr}</span>` : ''}</div>
        ${verdictBarHtml(item)}
        ${setupPanelHtml(item, { showConf: false })}
        <div class="sc-stats">${statTile('1D', item.pct_1d, 'Move over the last daily bar')}${statTile('1W', item.pct_1w, 'Move over the last 5 trading days')}${statTile('1M', item.pct_1m, 'Move over the last 21 trading days')}${statTile('1Y', item.pct_1y, 'Move over the last 252 trading days')}${volTile}</div>
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
      // Concentration note above the cards: when several of the things you are
      // looking at are the same shape, they are one bet. Computed over the
      // FILTERED set, not the whole book, so it answers "is this screen
      // concentrated" rather than "is the market".
      grid.innerHTML = concentrationNoteHtml(filtered) + cardsHtml + loadMoreHtml;
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
  // Sort pill. Every one of these already existed in the advanced sheet's Sort
  // dropdown — three taps deep behind the sliders icon, which is where the
  // day/year sorts had been sitting unused. The pill and the sheet's <select>
  // are two views of the same `scannerSort`, kept in sync both ways.
  const SORT_LABELS = {
    signal: '', pct_1y_desc: 'Year ↓', pct_1y_asc: 'Year ↑',
    pct_1m_desc: 'Month ↓', pct_1m_asc: 'Month ↑',
    pct_1w_desc: 'Week ↓', pct_1w_asc: 'Week ↑',
    pct_1d_desc: 'Day ↓', pct_1d_asc: 'Day ↑', conviction: 'Conviction',
    radar_score: 'Radar', date_desc: 'Newest', conf_desc: 'Confidence',
    roc_desc: 'ROC ↓', roc_asc: 'ROC ↑', order_desc: 'MA order', run_desc: 'Run',
  };
  // Move pill label: "1W ▲ 5%+" / "1M ▼ any" / "1D 10%+" (either direction)
  function moveFilterLabel() {
    if (scannerMoveDir === 'all' && !scannerMoveMin) return '';
    const arrow = scannerMoveDir === 'up' ? ' ▲' : scannerMoveDir === 'down' ? ' ▼' : '';
    const size  = scannerMoveMin ? ' ' + scannerMoveMin + '%+' : ' any';
    return MOVE_PERIODS[scannerMovePeriod] + arrow + size;
  }
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
    const movePill = document.getElementById('pillMove');
    if (movePill) {
      const lbl = moveFilterLabel();
      movePill.classList.toggle('has-active', !!lbl);
      const val = movePill.querySelector('.fp-val');
      if (val) val.textContent = lbl ? ' · ' + lbl : '';
      movePill.querySelectorAll('.move-per-opt').forEach(b =>
        b.classList.toggle('active', b.dataset.period === scannerMovePeriod));
      movePill.querySelectorAll('.move-dir-opt').forEach(b =>
        b.classList.toggle('active', b.dataset.dir === scannerMoveDir));
      movePill.querySelectorAll('.move-min-opt').forEach(b =>
        b.classList.toggle('active', parseFloat(b.dataset.min) === scannerMoveMin));
    }
    const sortPill = document.getElementById('pillSort');
    if (sortPill) {
      sortPill.classList.toggle('has-active', scannerSort !== 'signal');
      const val = sortPill.querySelector('.fp-val');
      if (val) val.textContent = scannerSort !== 'signal' ? ' · ' + (SORT_LABELS[scannerSort] || '') : '';
      sortPill.querySelectorAll('.sort-opt').forEach(b =>
        b.classList.toggle('active', b.dataset.sort === scannerSort));
    }
  }

  const sortOpts = document.getElementById('scannerSortOpts');
  if (sortOpts) {
    sortOpts.addEventListener('click', e => {
      const btn = e.target.closest('.sort-opt');
      if (!btn) return;
      scannerSort = btn.dataset.sort;
      // Keep the advanced sheet's <select> showing the same thing
      const sel = document.getElementById('scannerSort');
      if (sel) sel.value = scannerSort;
      document.getElementById('pillSort')?.removeAttribute('open');
      buildScannerCards();
    });
  }

  // Move pill — period / direction / size are three independent choices, so the
  // dropdown stays OPEN on click (unlike Mood and Sort, which are one pick and
  // done). updateFilterPills() repaints the active states.
  const moveOpts = document.getElementById('scannerMoveOpts');
  if (moveOpts) {
    moveOpts.addEventListener('click', e => {
      const btn = e.target.closest('.move-per-opt, .move-dir-opt, .move-min-opt');
      if (!btn) return;
      if (btn.dataset.period !== undefined)  scannerMovePeriod = btn.dataset.period;
      else if (btn.dataset.dir !== undefined) scannerMoveDir = btn.dataset.dir;
      else scannerMoveMin = parseFloat(btn.dataset.min) || 0;
      buildScannerCards();
    });
  }
  document.getElementById('scannerMoveClear')?.addEventListener('click', () => {
    scannerMovePeriod = 'pct_1d';
    scannerMoveDir = 'all';
    scannerMoveMin = 0;
    document.getElementById('pillMove')?.removeAttribute('open');
    buildScannerCards();
  });

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
      document.querySelectorAll('.sig-ctx-chip:not(#sigMoreFiltersBtn):not(#sigTypeBtn):not(#radarChip):not(#analyzedChip):not(#eventChip)').forEach(c => c.classList.remove('active'));
      if (typeof resetAnalyzedChip === 'function') resetAnalyzedChip();
      if (typeof resetEventChip === 'function') resetEventChip();
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
      document.querySelectorAll('.sig-ctx-chip:not(#sigMoreFiltersBtn):not(#sigTypeBtn):not(#radarChip):not(#analyzedChip):not(#eventChip)').forEach(c => c.classList.remove('active'));
      resetRadarChip();
      resetEventChip();
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

  // ── Event chip — cycles off → Event soon → No event → off ──
  // A signal that fires the session before a report is a different trade from
  // the same signal on a clear week, and until now the scanner had no way to
  // separate the two. Both directions matter: "what is about to gap" and "what
  // can I hold without a scheduled surprise in it".
  const eventChip  = document.getElementById('eventChip');
  const eventLabel = eventChip ? eventChip.querySelector('.event-label') : null;
  function resetEventChip() {
    if (!eventChip) return;
    eventChip.classList.remove('on', 'off');
    if (eventLabel) eventLabel.textContent = 'Event';
  }
  if (eventChip) {
    eventChip.addEventListener('click', () => {
      document.querySelectorAll('.sig-ctx-chip:not(#sigMoreFiltersBtn):not(#sigTypeBtn):not(#radarChip):not(#analyzedChip):not(#eventChip)').forEach(c => c.classList.remove('active'));
      resetRadarChip();
      resetAnalyzedChip();
      document.querySelectorAll('.sig-dir-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('.sig-dir-btn[data-filter="all"]').classList.add('active');
      if (activeScannerFilter === 'event') {
        eventChip.classList.remove('on'); eventChip.classList.add('off');
        eventLabel.textContent = 'No event';
        activeScannerFilter = 'noevent';
      } else if (activeScannerFilter === 'noevent') {
        resetEventChip();
        activeScannerFilter = 'all';
      } else {
        eventChip.classList.add('on');
        eventLabel.textContent = 'Event \u22647d';
        activeScannerFilter = 'event';
      }
      buildScannerCards();
    });
  }

  // ── Context chips (Best, Today, Squeeze, Key Lvl, Vol Spike, Macro S/R) ──
  document.querySelector('.sig-ctx-row').addEventListener('click', e => {
    const chip = e.target.closest('.sig-ctx-chip');
    if (!chip || chip.id === 'sigMoreFiltersBtn' || chip.id === 'sigTypeBtn' || chip.id === 'radarChip' || chip.id === 'analyzedChip' || chip.id === 'eventChip') return;
    const wasActive = chip.classList.contains('active');
    // Deactivate all context chips (except filters btn, signal btn, radar chip, analyzed chip)
    document.querySelectorAll('.sig-ctx-chip:not(#sigMoreFiltersBtn):not(#sigTypeBtn):not(#radarChip):not(#analyzedChip):not(#eventChip)').forEach(c => c.classList.remove('active'));
    resetRadarChip();
    resetAnalyzedChip();
    resetEventChip();
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
    // The cycling chips hold their state in .on/.off, not .active, so the line
    // above never cleared them: Radar/Analyzed/Event stayed lit while the
    // filter they represented had just been replaced by a signal type.
    resetRadarChip();
    resetAnalyzedChip();
    resetEventChip();
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
    const selects = ['scannerClassFilter','scannerGroupFilter','scannerSectorFilter','scannerTrendFilter','scannerAlignFilter','scannerRsiFilter','scannerStackFilter'];
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
        return (b[f('last_signal_date')] || '').localeCompare(a[f('last_signal_date')] || '');
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
          <div class="wl-card-left">${cardIdentityHtml(item, { tag: 'span', isAi: _aiWl, sep: ' · ' })}</div>
          <div class="wl-card-right">
            <span class="wl-card-price">${formatPrice(item[f('close')])}${rocStr ? ` <span class="roc-val ${roc >= 0 ? 'roc-pos' : 'roc-neg'}">${rocStr}</span>` : ''}</span>
            ${(() => { const p = signalPerf(item); return (p && p.days > 0) ? `<span class="wl-signal-perf ${parseFloat(p.pct)>=0?'perf-pos':'perf-neg'}" title="Since ${p.signal} signal on ${p.date}">${parseFloat(p.pct)>=0?'+':''}${p.pct}% · ${p.days}d</span>` : ''; })()}
            ${cardActionsHtml(item.instrument_name, { starred: true })}
          </div>
        </div>
        <div class="wl-card-badges">
          ${verdictChipHtml(item)}
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
        <div class="trs-rules">Rules: 2×ATR14 stop · 2:1 R:R · 30-bar time stop · 0.05% slippage</div>
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

  // Signals live on Daily and Weekly only. A sheet opened from a chart view
  // (1H/4H/3D) shows the signal timeframe the reader last used, never a 4H/3D
  // signal. openModalAt has no await in it, so withSignalTf is safe here.
  function openModal(name) {
    return withSignalTf(() => openModalAt(name));
  }

  function openModalAt(name) {
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
    const maPrefix = tfMeta().prefix + 'ma_';
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
            ${modalEventHtml(item)}
            ${modalShapeHtml(item)}
          </div>
          <div class="mh-sig-wrap">
            ${item[f('volume_spike_flag')] === 'yes' && sig ? '<span class="vol-plus-chip">VOL+</span>' : ''}
          </div>
        </div>
        <div class="mh-price-row">
          <div class="mh-price">${formatPrice(item[f('close')])}</div>
          <div class="mh-price-meta">
            ${changeStr ? `<span class="mh-change ${changeClass}">${priceChange >= 0 ? '▲' : '▼'} ${changeStr}</span>` : ''}
            <button class="mh-tv-link mh-chart-link" data-act="openChartFor" data-arg="${item.instrument_name}" data-stop="1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
              Chart
            </button>
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
              const sAge  = signalAge(s[f('last_signal_date')] || s[f('date')] || '', s[f('date')]);
              const sPerf = signalPerf(s);
              return `<div class="sim-card" data-act="openModal" data-arg="${s.instrument_name}" data-stop="1">
                <div class="sim-card-top"><span class="sim-card-name">${s.instrument_name}</span>${sSig?`<span class="feed-badge badge-${sigClass(sSig) || 'p4'}">${sSig}</span>`:''}</div>
                <div class="sim-card-group">${s.group||''}</div>
                <div class="sim-card-badges">
                  ${sAge.label?`<span class="sig-age ${sAge.decayClass}" style="font-size:.58rem">${sAge.label}</span>`:''}
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
            <div class="mg-tile" title="Average over the last 25 ${tfMeta().bar}"><div class="mg-label">Avg (25)</div><div class="mg-val" title="${av ? Math.round(av).toLocaleString() : ''}">${fmtVol(av)}</div></div>
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
      const maturity   = pctOfAvg >= 150 ? 'Long-running' : pctOfAvg >= 80 ? 'Mature' : pctOfAvg >= 40 ? 'Developing' : 'Young';
      const move       = currentSeg?.pct_move ?? null;
      // `signal_type` and `signal` are NOT columns — never have been. The
      // payload carries `primary_signal` (today's fire) and `last_signal_type`
      // (the most recent one). Both reads returned undefined on every row, so
      // every Trends card's badge read a muted "No signal" for all 736
      // instruments regardless of what fired. Third instance of the same family
      // as the Market Pulse gauge (v225) and shareCard (v235).
      const signal     = d[f('primary_signal')] || '';
      const close      = parseFloat(d[f('close')]) || null;
      const volSpike   = d[f('volume_spike_flag')] === 'yes';
      // Last 8 segments for the history strip (segs is newest-first; reverse for L→R display)
      const histSegs   = segs.slice(0, 8).reverse();
      return { name: d.instrument_name, group: d.group||'', established, runDays,
               avgCurrent, pctOfAvg, maturity, upPct, currentSeg, move, hasData: segs.length > 0,
               signal, close, volSpike, histSegs,
               // The raw row, so the card can call the SHARED helpers
               // (verdictChipHtml et al) instead of growing its own second
               // spelling of facts the other two cards already render.
               raw: d };
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
      const matIcon     = d.pctOfAvg >= 150 ? '◆' : d.pctOfAvg >= 80 ? '◑' : '●';
      const since       = d.currentSeg ? `since ${d.currentSeg.start}` : '';
      const moveStr     = d.move !== null ? `<span class="tc-move" style="color:${d.move>=0?'var(--buy)':'var(--sell)'}">${d.move>=0?'+':''}${d.move}%</span>` : '';
      // No red pulse: trends this long ended within 60 bars 16-17.5% of the time,
      // young ones 36-39% (measured 2026-09-11). Length is not exhaustion.
      const extAttr     = '';
      const delay       = `animation-delay:${(idx * 0.022).toFixed(3)}s`;
      const matFill     = d.avgCurrent ? Math.min(d.pctOfAvg, 150) / 1.5 : 0; // 0–100% of bar

      // Signal badge
      // Direction from the CODE (B1..B4 / S1..S4), matching publish.py and
      // server.py's buy_mask — not from prose. The old test looked for the
      // words 'buy'/'sell'/'watch' inside a value that is a code, so it could
      // never have matched even once d.signal was populated. There is no
      // 'watch' code (watch_flag is a dead column), so that branch is gone.
      const sig = d.signal || '';
      const isBuy  = sig.startsWith('B');
      const isSell = sig.startsWith('S');
      const sigColor = isBuy ? 'var(--buy)' : isSell ? 'var(--sell)' : 'var(--text-muted)';
      const sigLabel = isBuy ? `▲ Buy · ${sig}` : isSell ? `▼ Sell · ${sig}` : 'No signal';
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
            ${eventChipHtml(d.name)}
          </div>
          <span class="tc-badge ${badgeCls}">${badgeTxt}</span>
        </div>
        <div class="tc-body">
          <div class="tc-days" style="color:${color}">${d.runDays || '—'}<span class="tc-days-unit">d</span></div>
          <div class="tc-since">${since}</div>
          ${moveStr}
        </div>
        ${(() => { const ts = d.raw ? trendSentence(d.raw) : null; return ts && ts.now ? `<div class="tc-now${ts.against ? ' tc-now-against' : ''}">Now: ${ts.now}</div>` : ''; })()}
        <div class="tc-signal-row">
          <span class="tc-sig-label" style="color:${sigColor}">${sigLabel}</span>
          <div style="display:flex;align-items:center;gap:5px">${volDot}${priceStr}</div>
        </div>
        ${d.raw ? `<div class="tc-verdict-row">${verdictChipHtml(d.raw)}</div>` : ''}
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
    const maturity = pctOfAvg >= 150 ? 'Long-running' : pctOfAvg >= 80 ? 'Mature' : pctOfAvg >= 40 ? 'Developing' : 'Young';
    const maturityColor = pctOfAvg >= 150 ? 'var(--text-secondary)' : pctOfAvg >= 80 ? 'var(--watch)' : 'var(--buy)';
    const maturityIcon = pctOfAvg >= 150 ? '◆' : pctOfAvg >= 80 ? '◑' : '●';
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
  // Takes the star BUTTON (lists, modal) or an instrument NAME (the chart reel).
  // It only ever read btn.dataset.ticker, and the reel passes a name — so the
  // ★ on every chart card threw and never starred anything (found 2026-09-15).
  function toggleStar(btn) {
    const ticker = typeof btn === 'string' ? btn : btn.dataset.ticker;
    if (!ticker) return;
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
    // ...and the chart reel's stars, on the cards and in full screen.
    document.querySelectorAll('[data-act="star"][data-name]').forEach(b => {
      if (b.dataset.name === ticker) b.classList.toggle('on', nowStarred);
    });
    if (typeof reelSyncStarPill === 'function') reelSyncStarPill();
    localStorage.setItem(sk('swingpulse-starred'), JSON.stringify([...userStarred]));
    syncPush(true);   // the user just changed stars — an empty result is meant
    renderWlMyList();
    renderEventBanner();   // banner is starred-scoped; keep it in step
    updateNotifBell();
  }

  function openTvPicker(btn, name) {
    // Remove any existing picker (toggle off if same button tapped again)
    const existing = document.getElementById('tvPicker');
    if (existing) { existing.remove(); return; }

    const webUrl = tvUrl(name);
    // Build tradingview:// deep link with exchange and symbol as separate params
    const tvSym  = tvMap[name] || name;
    const ivl    = tfMeta().tv;
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



  // ── Share card ────────────────────────────────────────────────────────
  // Tool glyphs — drawn rather than lettered so three of them fit a phone row.
  const TOOL_CHANNEL = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="16" x2="21" y2="6"/><line x1="3" y1="21" x2="21" y2="11"/><line x1="3" y1="18.5" x2="21" y2="8.5" stroke-dasharray="2 3" opacity=".65"/></svg>`;
  const TOOL_TREND   = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="19" x2="21" y2="5"/><circle cx="4.5" cy="18" r="1.8" fill="currentColor" stroke="none"/><circle cx="19.5" cy="6" r="1.8" fill="currentColor" stroke="none"/></svg>`;
  const TOOL_HLINE   = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="12" x2="21" y2="12"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg>`;
  const TOOL_VLINE   = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="3" x2="12" y2="21"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg>`;
  const TOOL_LADDER  = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="4" x2="21" y2="4" stroke-dasharray="1.5 3"/><line x1="3" y1="9.3" x2="21" y2="9.3" stroke-dasharray="1.5 3"/><line x1="3" y1="14.6" x2="21" y2="14.6" stroke-dasharray="1.5 3"/><line x1="3" y1="20" x2="21" y2="20" stroke-dasharray="1.5 3"/></svg>`;

  const TOOL_ENTRY  = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="9" y1="12" x2="22" y2="12"/><path d="M3 9l6 6M9 9l-6 6" opacity=".55"/></svg>`;
  const ICON_BACK   = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6l-6 6 6 6"/><path d="M4 12h11a5 5 0 0 1 5 5v1"/></svg>`;
  const ICON_UNDO   = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>`;
  const ICON_REDO   = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>`;
  const ICON_COPY   = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>`;
  const ICON_LOCK   = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
  const ICON_UNLOCK = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>`;
  const ICON_TRASH  = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 20 7"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>`;

  // Colours a drawing can take (2026-09-15). All chosen to read on the WHITE
  // plot ground; the first is the default ink every drawing had before colour
  // existed. A stored colour not on this list is ignored rather than injected
  // into markup — the value arrives through sync.
  const DRAW_COLORS = ['#14140f', '#dc2626', '#2563eb', '#16a34a', '#ea580c', '#9333ea'];
  const drawColor = d => (d && DRAW_COLORS.includes(d.color)) ? d.color : DRAW_COLORS[0];

  // The Draw bar: a PROPERTIES row for the selected drawing above the four
  // tools. Card and full screen used to carry two hand-copied toolbars; one
  // builder now serves both.
  function reelToolbarHtml(name, edit) {
    return `<div class="reel-toolbar" data-tools${edit ? '' : ' hidden'}>
        <div class="reel-props" data-props${edit && channelsFor(name).length ? '' : ' hidden'}>${reelPropsHtml(name)}</div>
        <div class="reel-tools-row">
          <button class="reel-tool reel-hist" data-act="draw-undo" data-name="${name}" aria-label="Undo" title="Undo"${drawCanStep(name, -1) ? '' : ' disabled'}>${ICON_UNDO}</button>
          <button class="reel-tool reel-hist" data-act="draw-redo" data-name="${name}" aria-label="Redo" title="Redo"${drawCanStep(name, 1) ? '' : ' disabled'}>${ICON_REDO}</button>
          <span class="reel-props-sep"></span>
          <button class="reel-tool" data-act="channel-add" data-kind="channel" data-name="${name}" title="Channel" aria-label="Add channel">${TOOL_CHANNEL}</button>
          <button class="reel-tool" data-act="channel-add" data-kind="trend" data-name="${name}" title="Trend line" aria-label="Add trend line">${TOOL_TREND}</button>
          <button class="reel-tool" data-act="channel-add" data-kind="hline" data-name="${name}" title="Horizontal line" aria-label="Add horizontal line">${TOOL_HLINE}</button>
          <button class="reel-tool" data-act="channel-add" data-kind="vline" data-name="${name}" title="Vertical line" aria-label="Add vertical line">${TOOL_VLINE}</button>
          <button class="reel-tool" data-act="channel-add" data-kind="ladder" data-name="${name}" title="10 price lines" aria-label="Add 10 evenly spaced price lines">${TOOL_LADDER}</button>
          <button class="reel-tool" data-act="channel-add" data-kind="entry" data-name="${name}" title="Entry" aria-label="Mark an entry">${TOOL_ENTRY}</button>
        </div>
      </div>`;
  }

  function drawCanStep(name, dir) {
    const st = (dir < 0 ? drawUndo : drawRedo).get(chKey(name, timeframe));
    return !!(st && st.length);
  }

  // Properties of the ONE selected drawing — colour, lock, delete. Every button
  // acts on that drawing only; tap another line to move the bar to it.
  function reelPropsHtml(name) {
    const d = activeChannel(name);
    if (!d) return '';
    const cur = drawColor(d);
    const sw = DRAW_COLORS.map(c =>
      `<button class="reel-tool reel-swatch${c === cur ? ' on' : ''}" data-act="draw-color" data-color="${c}" data-name="${name}" aria-label="Colour" style="--sw:${c}"><i></i></button>`).join('');
    // The 10-line ladder alone gets a "%" switch: show or hide its 10%–100%
    // labels (user, 2026-09-15). On = labels showing, the default.
    const pct = d.kind === 'ladder'
      ? `<button class="reel-tool reel-tool-pct${d.hideLabels ? '' : ' on'}" data-act="draw-labels" data-name="${name}" aria-pressed="${!d.hideLabels}" aria-label="${d.hideLabels ? 'Show percentages' : 'Hide percentages'}" title="${d.hideLabels ? 'Show %' : 'Hide %'}">%</button>`
      : '';
    // A BOLD switch on entry markers (user, 2026-09-15) and on horizontal and
    // vertical lines (user, 2026-09-19).
    const bold = DRAW_BOLDABLE.has(d.kind)
      ? `<button class="reel-tool reel-tool-pct${d.bold ? ' on' : ''}" data-act="draw-bold" data-name="${name}" aria-pressed="${!!d.bold}" aria-label="${d.bold ? 'Normal weight' : 'Make bold'}" title="Bold">B</button>`
      : '';
    return sw
      + `<span class="reel-props-sep"></span>`
      + pct + bold
      + `<button class="reel-tool" data-act="draw-dup" data-name="${name}" aria-label="Duplicate this drawing" title="Duplicate">${ICON_COPY}</button>`
      + `<button class="reel-tool${d.locked ? ' on' : ''}" data-act="draw-lock" data-name="${name}" aria-label="${d.locked ? 'Unlock this drawing' : 'Lock this drawing'}" title="${d.locked ? 'Unlock' : 'Lock'}">${d.locked ? ICON_LOCK : ICON_UNLOCK}</button>`
      + `<button class="reel-tool reel-tool-del" data-act="draw-delete" data-name="${name}" aria-label="Delete this drawing" title="Delete">${ICON_TRASH}</button>`;
  }

  const EXPAND_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;

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
    const volSpk  = item[f('volume_spike_flag')] === 'yes';

    const trendEmoji = trend === 'UPTREND' ? '📈' : trend === 'DOWNTREND' ? '📉' : '➡️';
    // Direction comes from the SIGNAL CODE, not from prose. This used to test
    // conf.toLowerCase().includes('buy'), but confirmation_status reads
    // "Uptrend — above all MAs" / "Trend breakout — B1: ..." and contains
    // neither 'buy' nor 'sell' in any of its 18 phrasings — so dirLabel was
    // always '', the `if (sig && dirLabel)` line below could never fire, and a
    // shared card silently lost its direction + code line AND printed the
    // trend line twice (once from the else-branch, once from `if (sig &&
    // trend)`). Same bug v225 fixed in computeSummary(); this was its second
    // call site and it was missed. Prefix test matches publish.py/server.py's
    // buy_mask = primary_signal.startswith('B') exactly — one definition.
    const dirLabel   = sig.startsWith('B') ? '🟢 Buy' : sig.startsWith('S') ? '🟠 Warning' : '';

    let lines = [];
    lines.push(`⚡ *${title}*`);
    lines.push('───────────────');

    if (sig && dirLabel) lines.push(`${dirLabel} · ${sig}`);
    else if (trend) lines.push(`${trendEmoji} ${trend.charAt(0) + trend.slice(1).toLowerCase()}${!isNaN(run) && run > 0 ? ` · ${run}d run` : ''}`);

    lines.push(`💰 ${price}${rocStr ? '  ' + rocStr + ' (5d)' : ''}`);

    if (sig && trend) lines.push(`${trendEmoji} ${trend.charAt(0) + trend.slice(1).toLowerCase()}${!isNaN(run) && run > 0 ? ` · ${run}d run` : ''}`);
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
  function runAct(el, e) {
    const act = el.dataset.act;
    const fn  = window.SP && window.SP[act];
    if (typeof fn !== 'function') return;
    if (el.dataset.stop === '1') e.stopPropagation();
    if ('arg' in el.dataset) fn(el.dataset.arg, el);
    else fn(el);
  }

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (el) runAct(el, e);
  });

  // Anything given role="button" and a tabindex takes keyboard focus and is
  // announced as a button, so it has to behave like one — Enter and Space. The
  // event banner and the calendar's day rows were focusable and dead: an
  // affordance nobody can use is the same problem as one nobody can find.
  // Real <button> elements are skipped; the browser already synthesises a click.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const el = e.target.closest && e.target.closest('[data-act]');
    if (!el || el.tagName === 'BUTTON' || el.tagName === 'A') return;
    if (el.getAttribute('role') !== 'button') return;
    e.preventDefault();
    runAct(el, e);
  });

  async function togglePush() {
    if (isPushEnabled()) {
      await unsubscribeFromPush();
    } else {
      const ok = await subscribeToPush();
      if (!ok) alert('Could not enable notifications. Make sure you allowed permission.');
    }
  }

  // ── Event calendar ───────────────────────────────────────────────────
  // events.json carries scheduled dates the price engine cannot know: earnings
  // and ex-dividend, from the same yfinance feed the bars come from. Macro
  // dates (FOMC/CPI/ECB/SARB) are NOT in the feed — see events.py; the calendar
  // says so rather than quietly showing an equities-only month as complete.

  const EVENTS_ICS_URL = '/events.ics';   // rewritten to the R2 URL by publish.py
  const DOW_LABELS  = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
  // ONE word per event type, used by the legend, the day sheet and the card
  // chips alike. 'macro' used to leak to the screen here while the legend said
  // "Rates" and the banner said "rate decision" — three names for one thing, in
  // the week after Forex/FX/Currency were collapsed into one for the same
  // reason. The .ics titles come from publish.build_ics, not from here.
  const EVENT_KINDS = { earnings: 'Earnings', exdiv: 'Ex-dividend', macro: 'Rates' };
  // How far ahead the dashboard banner looks, in TRADING days (see tradingDaysUntil):
  // far enough to act before the gap, near enough that it is not permanently
  // on screen. Calendar days would have made a Monday event "in 3 days" on a
  // Friday, when it is really the next session.
  const EVENT_BANNER_DAYS = 3;
  // A card chip is quieter than the banner and can look further out — an
  // earnings date inside two weeks changes position size even when it is not
  // yet the thing to act on today.
  const EVENT_CHIP_DAYS = 14;

  // 'YYYY-MM-DD' for a Date, in LOCAL time. Deliberately not toISOString(),
  // which converts to UTC first and lands on the previous day for anyone east
  // of Greenwich — SAST is UTC+2, so every date would have been off by one
  // before 02:00. Same class of bug as the v224 signal-age fix.
  function ymd(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function parseYmd(str) {
    const [y, m, d] = String(str).split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  // Whole days from today to a date string, local midnight to local midnight.
  function daysUntil(dateStr) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((parseYmd(dateStr) - today) / 86400000);
  }

  // Sessions, not calendar days. An event on Monday is ONE session away on a
  // Friday, not three — and the whole point of the window is "can I still act
  // before this lands". Weekends only: a public-holiday table would have to be
  // per-exchange and would go stale silently, which is the same bar macro dates
  // had to clear. Negative for past dates, so callers can still test n < 0.
  function tradingDaysUntil(dateStr) {
    const raw = daysUntil(dateStr);
    if (raw === 0) return 0;
    const step = raw > 0 ? 1 : -1;
    const d = new Date(); d.setHours(0, 0, 0, 0);
    let n = 0;
    for (let i = 0; i < Math.abs(raw); i++) {
      d.setDate(d.getDate() + step);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) n += step;
    }
    return n;
  }

  // An event either points at an instrument you can hold, or it is a named
  // event that hits everything (a rate decision). `title` marks the second
  // kind — see events.py. Both helpers tolerate a payload published before the
  // split, where a macro row carried its name in `instrument`.
  function evLabel(e) {
    return e.title || e.instrument || '';
  }
  function evInstrument(e) {
    if (e.type === 'macro' || e.title) return null;
    return e.instrument || null;
  }

  function eventsByDate() {
    const map = {};
    (eventsData.events || []).forEach(e => {
      (map[e.date] || (map[e.date] = [])).push(e);
    });
    return map;
  }

  // Name -> its upcoming events, nearest first. Built once per data load and
  // read by every card chip; the alternative is a scan of allData (798 rows)
  // per row rendered, which the day sheet used to do 20 times to fetch a group.
  let _eventsByInstrument = null;
  let _instrumentsByName  = null;

  function eventsForInstrument(name) {
    if (!_eventsByInstrument) {
      _eventsByInstrument = {};
      (eventsData.events || []).forEach(e => {
        const inst = evInstrument(e);
        if (!inst) return;
        (_eventsByInstrument[inst] || (_eventsByInstrument[inst] = [])).push(e);
      });
      Object.values(_eventsByInstrument)
            .forEach(list => list.sort((a, b) => a.date.localeCompare(b.date)));
    }
    return _eventsByInstrument[name] || [];
  }

  function instrumentByName(name) {
    if (!_instrumentsByName) {
      _instrumentsByName = {};
      allData.forEach(d => { _instrumentsByName[d.instrument_name] = d; });
    }
    return _instrumentsByName[name] || null;
  }

  // Both indexes are derived from allData/eventsData, so any load that
  // replaces either has to drop them.
  function resetEventIndexes() { _eventsByInstrument = null; _instrumentsByName = null; }

  // The next thing scheduled for this instrument inside `days` sessions, or
  // null. Ex-dividend is included here (unlike the banner) because on a card
  // it is context, not an alarm.
  function nextEventFor(name, days) {
    const list = eventsForInstrument(name);
    for (const e of list) {
      const n = tradingDaysUntil(e.date);
      if (n < 0) continue;
      if (n > days) return null;
      return { ev: e, days: n };
    }
    return null;
  }

  // The nearest market-wide event (a rate decision) inside `days` sessions.
  // Cached per render pass rather than per card — it is the same answer for
  // every instrument on screen.
  function nextMarketEvent(days) {
    const soon = (eventsData.events || [])
      .filter(e => !evInstrument(e) && tradingDaysUntil(e.date) >= 0
                                    && tradingDaysUntil(e.date) <= days)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!soon.length) return null;
    return { ev: soon[0], days: tradingDaysUntil(soon[0].date) };
  }

  // "today" / "tomorrow" / "in 3 sessions" — one phrasing everywhere an event
  // countdown is spoken, so the banner and the card chips cannot disagree.
  function whenLabel(n) {
    return n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} sessions`;
  }

  // Starred first, then earnings before ex-dividend, then alphabetical — the
  // rows you care about are at the top of the sheet without a second control.
  function sortEvents(list) {
    const rank = { macro: 0, earnings: 1, exdiv: 2 };
    const star = e => { const i = evInstrument(e); return i ? userStarred.has(i) : false; };
    return list.slice().sort((a, b) =>
      (star(b) - star(a))
      || ((rank[a.type] ?? 9) - (rank[b.type] ?? 9))
      || evLabel(a).localeCompare(evLabel(b)));
  }

  // Upcoming events within `days`, nearest first. Starred-only when the user
  // has a list; everything otherwise, so an empty star list still shows news
  // rather than an empty calendar.
  function upcomingEvents(days) {
    const mine = userStarred.size > 0;
    return (eventsData.events || [])
      .filter(e => {
        const n = tradingDaysUntil(e.date);
        if (n < 0 || n > days) return false;
        if (e.type === 'exdiv') return false;   // not a gap risk; calendar only
        const inst = evInstrument(e);
        // A market-wide event has no instrument to star — it hits everything,
        // so the starred-list scope never filters it out.
        if (!inst) return true;
        return mine ? userStarred.has(inst) : true;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function renderEventBanner() {
    const el = document.getElementById('eventBanner');
    if (!el) return;
    const soon = upcomingEvents(EVENT_BANNER_DAYS);
    if (!soon.length) { el.innerHTML = ''; return; }

    const first = soon[0];
    const when  = whenLabel(tradingDaysUntil(first.date));

    // A market-wide event outranks earnings and is worded differently — it hits
    // everything you hold, so it is never "a company reporting".
    const macro = soon.filter(e => !evInstrument(e));
    let lead, body, extraAct = '';
    if (macro.length) {
      const m = macro[0];
      lead = `${evLabel(m)} ${whenLabel(tradingDaysUntil(m.date))}`;
      body = `${m.time ? `<b>${m.time}</b>. ` : ''}Moves everything at once, not one
              position — rate-sensitive instruments first.`;
      // "rate-sensitive instruments first" was advice with nowhere to go. The
      // five Rates instruments landed the same week the FOMC feed did and the
      // two had no connection; this is it.
      extraAct = `<button type="button" class="eb-act" data-act="openRatesBoard" data-stop="1">
                    Rates board →</button>`;
    } else {
      const names = [...new Set(soon.map(e => evInstrument(e)).filter(Boolean))];
      const shown = names.slice(0, 4).map(x => `<b>${x}</b>`).join(', ');
      const more  = names.length > 4 ? ` and ${names.length - 4} more` : '';
      const scope = userStarred.size > 0 ? ' from your starred list' : '';
      lead = names.length === 1
        ? `${names[0]} reports ${when}`
        : `${names.length} companies report in the next ${EVENT_BANNER_DAYS} sessions`;
      body = `${shown}${more}${scope}. An earnings date is the one scheduled gap
              you can see coming — check size before the close.`;
    }

    el.innerHTML =
      `<div class="event-banner" role="button" tabindex="0" data-act="openCalendar"
            data-arg="${(macro[0] || first).date}" aria-label="Open calendar">
        <div class="eb-ic">📅</div>
        <div>
          <div class="eb-t">${lead}</div>
          <div class="eb-s">${body}</div>
          ${extraAct}
        </div>
      </div>`;
  }

  // The feed covers a fixed window (-7/+120 days, events.py). The grid swipes
  // for ever, so a month past the horizon rendered as a blank one — identical
  // on screen to "nothing is scheduled", which is a different statement.
  function calWindow() {
    const w = eventsData.window || {};
    return { from: w.from || null, to: w.to || null };
  }
  function monthOutsideWindow(monthDate) {
    const { from, to } = calWindow();
    if (!from || !to) return false;
    const first = ymd(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));
    const last  = ymd(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0));
    return last < from || first > to;   // no overlap with the covered range
  }

  function calGridHtml(monthDate, byDate) {
    const year  = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const first = new Date(year, month, 1);
    // Monday-first: JS getDay() is Sunday=0, so Sunday must become column 7.
    const lead  = (first.getDay() + 6) % 7;
    const days  = new Date(year, month + 1, 0).getDate();
    const today = ymd(new Date());

    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<div class="cal-cell pad"></div>';
    for (let d = 1; d <= days; d++) {
      const date = ymd(new Date(year, month, d));
      const evs  = byDate[date] || [];
      const dow  = (new Date(year, month, d).getDay() + 6) % 7;
      const cls  = ['cal-cell'];
      if (dow >= 5) cls.push('wknd');
      if (evs.length) cls.push('has-events');
      if (date === today) cls.push('today');
      if (date === calSelected) cls.push('sel');
      // At most three dots: the cell is ~41px at 320px and a fourth clips.
      const kinds = [...new Set(evs.map(e => e.type))].slice(0, 3);
      const dots  = kinds.map(k => `<i class="cal-dot ${k}"></i>`).join('');
      cells += evs.length
        ? `<button type="button" class="${cls.join(' ')}" data-act="calDay" data-arg="${date}"
             aria-label="${d} ${MONTH_NAMES[month]}, ${evs.length} event${evs.length > 1 ? 's' : ''}">
             ${d}<span class="cal-dots">${dots}</span></button>`
        : `<div class="${cls.join(' ')}">${d}<span class="cal-dots"></span></div>`;
    }
    return cells;
  }

  function daySheetHtml(date, byDate) {
    const evs = sortEvents(byDate[date] || []);
    if (!evs.length) return '';
    const d = parseYmd(date);
    const label = `${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][(d.getDay()+6)%7]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
    const rows = evs.map(e => {
      const inst = evInstrument(e);
      const star = inst ? userStarred.has(inst) : false;
      const grp  = inst ? ((instrumentByName(inst) || {}).group || '') : '';
      const kind = EVENT_KINDS[e.type] || e.type;
      // A macro row carries a time where the minute matters; an earnings row
      // never does, by design (events.py). Show both facts rather than letting
      // the time displace the type name, which is how "macro" used to reach
      // the screen on a FRED row that had no time.
      const meta = [grp, e.time].filter(Boolean).join(' · ');
      // Clickable exactly when the row points at something you can hold — the
      // same rule the rest of the app follows, and the reason macro rows moved
      // their name out of `instrument`. A rate decision has no card to open.
      const open = inst
        ? ` role="button" tabindex="0" data-act="openModal" data-arg="${inst}"`
        : '';
      return `<div class="cal-ev ${e.type}${inst ? ' cal-ev-open' : ''}"${open}>
        <div class="cal-ev-top">
          <span class="cal-ev-name">${evLabel(e)}${star ? ' <span class="cal-ev-star">★</span>' : ''}</span>
          <span class="cal-ev-kind">${kind}</span>
        </div>
        ${meta ? `<div class="cal-ev-meta">${meta}</div>` : ''}
      </div>`;
    }).join('');
    const starred = evs.filter(e => { const i = evInstrument(e); return i && userStarred.has(i); }).length;
    return `<div class="cal-sheet">
      <div class="cal-sheet-head">
        <span class="cal-sheet-date">${label}</span>
        <button type="button" class="cal-sheet-close" data-act="calClose">Close</button>
      </div>
      ${starred ? `<div class="cal-ev-meta" style="margin-bottom:8px">${starred} on your starred list</div>` : ''}
      ${rows}
      <div class="cal-sheet-acts">
        <button type="button" class="cal-act" data-act="calIcs" data-arg="${date}">Add this day to calendar</button>
      </div>
    </div>`;
  }

  function renderCalendar() {
    const body = document.getElementById('notifCalendarBody');
    if (!body) return;
    if (!calMonth) { const n = new Date(); calMonth = new Date(n.getFullYear(), n.getMonth(), 1); }

    const byDate = eventsByDate();
    const total  = (eventsData.events || []).length;
    if (!total) {
      body.innerHTML = '<div class="notif-empty">No event feed yet — it lands with the next data run.</div>';
      return;
    }

    const prev = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
    const next = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
    const short = d => MONTH_NAMES[d.getMonth()].slice(0, 3);
    const outside = monthOutsideWindow(calMonth);
    const w = calWindow();
    const pretty = iso => { const d = parseYmd(iso); return `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0,3)}`; };
    const wFrom = w.from ? pretty(w.from) : '';
    const wTo   = w.to   ? pretty(w.to)   : '';

    body.innerHTML =
      `<div class="cal-head">
        <span class="cal-month">${MONTH_NAMES[calMonth.getMonth()]} ${calMonth.getFullYear()}</span>
        <span class="cal-nav">
          <button type="button" class="cal-nav-btn" data-act="calPrev" aria-label="Previous month">‹</button>
          <button type="button" class="cal-nav-btn" data-act="calNext" aria-label="Next month">›</button>
        </span>
      </div>
      <div class="cal-quarter">
        <button type="button" class="cal-q" data-act="calPrev">${short(prev)}</button>
        <b>${short(calMonth)}</b>
        <button type="button" class="cal-q" data-act="calNext">${short(next)}</button>
        <span class="cal-q-hint">swipe</span>
      </div>
      <div class="cal-dow">${DOW_LABELS.map(d => `<div>${d}</div>`).join('')}</div>
      <div class="cal-grid${outside ? ' cal-grid-out' : ''}" id="calGrid">${calGridHtml(calMonth, byDate)}</div>
      ${outside ? `<div class="cal-out-note">Past the end of the feed — it carries
        ${wFrom} to ${wTo}. An empty month here means "not fetched yet", not
        "nothing scheduled".</div>` : ''}
      ${calSelected ? daySheetHtml(calSelected, byDate) : ''}
      <div class="cal-legend">
        <span><i class="cal-dot macro" style="background:var(--accent)"></i>Rates</span>
        <span><i class="cal-dot earnings" style="background:var(--volume)"></i>Earnings</span>
        <span><i class="cal-dot exdiv" style="background:var(--text-muted)"></i>Ex-dividend</span>
      </div>
      <div class="cal-gap">${calGapNote()}</div>`;
  }

  // The calendar states its own gaps rather than presenting a partial month as
  // complete. Driven by events.json's `sources`, so it can never claim a feed
  // that did not actually load.
  function calGapNote() {
    const src = eventsData.sources || {};
    // Each flag is now set by the feed it names (events.py). It used to be one
    // `macro` flag covering two different sources, so a FRED-only result made
    // this note announce the Fed calendar over a month holding no FOMC dates.
    // `src.macro` is read as a fallback so a payload published before the split
    // still renders truthfully rather than claiming nothing loaded.
    const fomc = src.fomc || src.macro;
    const bits = [];
    if (fomc) bits.push('<b>FOMC decision dates</b> are included, from the Fed\u2019s own calendar.');
    else      bits.push('<b>No rate decisions loaded</b> \u2014 the Fed calendar did not answer on the last run.');
    if (!src.fred) bits.push('CPI, PCE and the jobs report are not in yet \u2014 they need a free FRED API key.');
    if (!src.speeches) bits.push('<b>Speeches are not here and may never be:</b> the Fed publishes a speech when it is delivered, not before.');
    const stale = eventsAgeNote();
    if (stale) bits.push(stale);
    return bits.join(' ');
  }

  // A calendar can go stale on its own. write_events deliberately leaves the
  // previous file in place when the fetch fails, so the pipeline can stay green
  // and the prices an hour old while these dates are a week old — and nothing
  // on screen looked any different. The stale banner only reasons about prices.
  const EVENTS_STALE_AFTER_H = 48;   // two ordinary runs' worth of slack
  function eventsAgeNote() {
    const gen = eventsData.generated_at;
    if (!gen) return '';
    const t = Date.parse(gen);
    if (isNaN(t)) return '';
    const hrs = (Date.now() - t) / 3600000;
    if (hrs < EVENTS_STALE_AFTER_H) return '';
    const days = Math.floor(hrs / 24);
    return `<b>These dates are ${days === 1 ? 'a day' : days + ' days'} old.</b>
            The event fetch has not landed since then \u2014 a date added or moved
            since will not be here.`;
  }

  // One-off .ics for a single day, built in the browser. The standing
  // subscription is the published feed (calSubscribe) — this is for taking one
  // date with you without subscribing to all of them.
  // SLICED from the published feed, never rebuilt. This function used to
  // compose its own VEVENTs, which meant two pieces of code named the same
  // event: publish.build_ics special-cases a rate decision, this one did not,
  // so subscribing gave you "FOMC decision" and the day download gave you
  // "FOMC decision — macro". build_ics is now the only place an event is
  // titled, and this takes the blocks it wants out of the file it produced.
  function sliceIcs(feed, date) {
    const compact = date.replace(/-/g, '');
    const head = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SwingPulse//Events//EN',
                  'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    const blocks = [];
    let cur = null;
    // Unfold RFC 5545 continuation lines first: a folded DTSTART would not
    // match, and a folded SUMMARY would be split across array entries.
    const lines = String(feed).replace(/\r\n[ \t]/g, '').split(/\r?\n/);
    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') { cur = [line]; continue; }
      if (!cur) continue;
      cur.push(line);
      if (line === 'END:VEVENT') {
        if (cur.some(l => l.startsWith('DTSTART') && l.includes(compact))) blocks.push(cur);
        cur = null;
      }
    }
    if (!blocks.length) return null;
    return head.concat(...blocks, ['END:VCALENDAR']).join('\r\n') + '\r\n';
  }

  async function downloadIcs(date) {
    let text = null;
    try {
      const res = await fetch(EVENTS_ICS_URL, { cache: 'no-store' });
      if (res.ok) text = sliceIcs(await res.text(), date);
    } catch (err) {
      console.warn('[cal] feed fetch failed:', err);
    }
    if (!text) {
      // Deliberately no local fallback: a second builder is what produced two
      // different names for one event. Better to say the feed is unreachable.
      alert('Could not reach the calendar feed just now — try Subscribe instead.');
      return;
    }
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `swingpulse-${date}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // webcal:// is the scheme iOS Calendar and macOS listen for; the feed itself
  // is plain https. A real <a href> rather than a scripted navigation: iOS
  // handles the scheme far more reliably from a link, and it makes the URL
  // long-pressable so it can be copied into any other calendar app.
  function webcalUrl() {
    return new URL(EVENTS_ICS_URL, window.location.href).href.replace(/^https?:/, 'webcal:');
  }
  function subscribeToEvents() { window.location.href = webcalUrl(); }

  // Horizontal swipe across the grid moves a month — the arrows are small and
  // a calendar is a thing people swipe. Bound once to the container, which
  // survives renderCalendar()'s innerHTML rewrite; the grid inside does not.
  (function wireCalendarSwipe() {
    const body = document.getElementById('notifCalendarBody');
    if (!body) return;
    let x0 = null, y0 = null;
    body.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) { x0 = null; return; }
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    }, { passive: true });
    body.addEventListener('touchend', e => {
      if (x0 === null) return;
      const t  = e.changedTouches[0];
      const dx = t.clientX - x0, dy = t.clientY - y0;
      x0 = null;
      // Horizontal-dominant and past a real threshold, so scrolling the day
      // sheet vertically never flips the month by accident.
      if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      calShiftMonth(dx < 0 ? 1 : -1);
    }, { passive: true });
    // Trackpad / mouse-wheel horizontal scroll, for the desktop view.
    let wheelLock = 0;
    body.addEventListener('wheel', e => {
      if (Math.abs(e.deltaX) < 30 || Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
      const now = Date.now();
      if (now - wheelLock < 400) return;
      wheelLock = now;
      calShiftMonth(e.deltaX > 0 ? 1 : -1);
    }, { passive: true });
  })();

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
    // TWO counts, deliberately not one sum. It used to add today's fires to the
    // upcoming events and show the total, which on a busy day read "137" and
    // told you nothing — and gave no clue which of the two segments below it
    // the number belonged to. Gold badge = fired today; violet pip = scheduled
    // inside the banner window. The pip is the half that must still appear on a
    // quiet signal day, since the whole point of the calendar is that the count
    // rises BEFORE the event.
    const sigs = notifItems().length;
    const evs  = upcomingEvents(EVENT_BANNER_DAYS).length;
    btn.classList.toggle('has-signals', (sigs + evs) > 0);
    if (sigs > 0) btn.dataset.count  = sigs; else delete btn.dataset.count;
    if (evs  > 0) btn.dataset.events = evs;  else delete btn.dataset.events;
    btn.setAttribute('aria-label',
      `Notifications and calendar — ${sigs} fired today, ${evs} scheduled soon`);
    // The segments carry their own counts too, so opening the panel says which
    // number was which without having to read both lists.
    const segT = document.getElementById('notifSegToday');
    const segC = document.getElementById('notifSegCal');
    if (segT) segT.textContent = sigs ? `Today ${sigs}` : 'Today';
    if (segC) segC.textContent = evs  ? `Calendar ${evs}` : 'Calendar';
  }

  function renderNotifPanel() {
    const list = document.getElementById('notifPopupList');
    if (!list) return;
    const items = notifItems();
    // This panel is daily whichever timeframe the app is on — push works off
    // the daily fire, so the two match on purpose (CLAUDE.md Important Rule 1).
    // It said so nowhere, though: flipping to 4H changed every count on screen
    // except this one, silently. The Trends tab already handles the same
    // situation by naming it, so this does too.
    const tfNote = timeframe === 'D'
      ? ''
      : '<div class="notif-tf-note">Daily · signal alerts are daily-only</div>';
    if (!items.length) {
      list.innerHTML = tfNote + '<div class="notif-empty">No signals fired today</div>';
      return;
    }
    list.innerHTML = tfNote + items.map(item => {
      const sig  = item.primary_signal;
      const buy  = sig.startsWith('B');
      const conf = item.signal_confidence || '';
      const vol  = item.volume_spike_flag === 'yes';
      return `<div class="notif-item" data-act="openModal" data-arg="${item.instrument_name}">
        <span class="notif-sig ${buy ? 'notif-buy' : 'notif-sell'}">${sig}</span>
        <div class="notif-body">
          <span class="notif-name">${item.instrument_name}${vol ? ' <span class="notif-vol">VOL</span>' : ''}</span>
          <span class="notif-detail">${item.confirmation_status || ''}</span>
        </div>
        <span class="notif-group">${item.group || ''}</span>
      </div>`;
    }).join('');
  }

  // Show whichever segment is active and render only that one.
  function renderNotifBody() {
    const list = document.getElementById('notifPopupList');
    const cal  = document.getElementById('notifCalendarBody');
    if (!list || !cal) return;
    const onCal = notifTab === 'calendar';
    list.style.display = onCal ? 'none' : '';
    cal.style.display  = onCal ? '' : 'none';
    const footer = document.getElementById('notifCalFooter');
    const subLink = document.getElementById('calSubscribeLink');
    if (footer) footer.style.display = onCal && (eventsData.events || []).length ? '' : 'none';
    if (subLink) subLink.href = webcalUrl();
    document.querySelectorAll('.notif-seg-btn').forEach(b => {
      const on = b.dataset.notifTab === notifTab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (onCal) renderCalendar(); else renderNotifPanel();
    // The run row lives below both segments, so its status is refreshed
    // whenever the panel opens rather than only on page load — a run started
    // an hour ago on another device should not read as "no runs yet".
    refreshRunStatus();
  }

  function toggleNotifPanel() {
    const popup = document.getElementById('notifPopup');
    if (!popup) return;
    const open = popup.style.display !== 'none';
    if (open) { popup.style.display = 'none'; return; }
    renderNotifBody();
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

  document.addEventListener('click', e => {
    const seg = e.target.closest('.notif-seg-btn');
    if (!seg) return;
    notifTab = seg.dataset.notifTab === 'calendar' ? 'calendar' : 'today';
    try { localStorage.setItem(NOTIF_TAB_KEY, notifTab); } catch {}
    renderNotifBody();
  });

  // Close popup on outside click or when a notification opens its modal
  document.addEventListener('click', e => {
    const popup = document.getElementById('notifPopup');
    if (!popup || popup.style.display === 'none') return;
    if (e.target.closest('.notif-seg-btn')) return;   // switching view, not leaving
    // A handler that ran before this one may have re-rendered the thing that was
    // clicked — the calendar's month arrows and month chips both rebuild
    // #notifCalendarBody's innerHTML, which DETACHES the clicked button. On a
    // detached node closest('#notifPopup') is null, so the test below read a
    // click on the arrow as a click outside the popup and closed it: the month
    // advanced and the calendar vanished in the same frame. Swipe was unaffected
    // because a touch gesture never fires click, which is exactly why it worked
    // while the arrows appeared dead. If the target is gone from the document,
    // the click was ours.
    if (!e.target.isConnected) return;
    if (e.target.closest('.notif-item')) { popup.style.display = 'none'; return; }
    if (!e.target.closest('#notifPopup') && !e.target.closest('#pushToggleBtn')) {
      popup.style.display = 'none';
    }
  });

  // Initial UI state for push button (after SW registers)
  setTimeout(updatePushBadgeUI, 500);
  // A run may already be going (a cron, or one started from another device) —
  // show it rather than offering a button that could only 409. Delayed so the
  // sync token is restored from localStorage first.
  setTimeout(checkRunOnLoad, 1500);

  // Calendar actions, wired through the same data-act dispatcher as everything
  // else so the grid can be re-rendered wholesale without rebinding handlers.
  function calShiftMonth(delta) {
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + delta, 1);
    calSelected = null;
    renderCalendar();
  }
  const calPrev = () => calShiftMonth(-1);
  const calNext = () => calShiftMonth(1);
  const calDay  = (date) => { calSelected = (calSelected === date) ? null : date; renderCalendar(); };
  const calClose = () => { calSelected = null; renderCalendar(); };
  const calIcs  = (date) => downloadIcs(date);
  const calSubscribe = () => subscribeToEvents();
  // "rate-sensitive instruments first" used to be advice with no destination.
  // The five Rates instruments and the FOMC feed landed the same week and had
  // no connection; this is it. Uses the Class chip, which now carries Rates as
  // its own value (browseClassOf) rather than hiding them inside Index.
  function openRatesBoard() {
    const popup = document.getElementById('notifPopup');
    if (popup) popup.style.display = 'none';
    const cls = document.getElementById('scannerClassFilter');
    if (cls) cls.value = 'Rates';
    const grp = document.getElementById('scannerGroupFilter');
    if (grp) grp.value = 'all';
    activeRegionFilter = '';
    activeScannerFilter = 'all';
    updateScannerCtxStrip?.();
    updateFilterPills?.();
    navigateToTab('scanner');
    buildScannerCards();
  }

  // Where a tapped notification lands. An instrument opens its card; a
  // market-wide date opens the calendar on that day. Retried once because a
  // cold start reaches this before allData exists.
  function openFromNotification(ticker, date) {
    const go = () => {
      if (ticker && allData.some(d => d.instrument_name === ticker)) { openModal(ticker); return true; }
      if (date) { openCalendar(date); return true; }
      return false;
    };
    if (!go()) setTimeout(go, 2500);
  }

  // From the dashboard banner: open the dropdown straight onto that date.
  function openCalendar(date) {
    const popup = document.getElementById('notifPopup');
    if (!popup) return;
    notifTab = 'calendar';
    if (date) {
      const d = parseYmd(date);
      calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      calSelected = date;
    }
    popup.style.display = '';
    renderNotifBody();
  }

  // Cold start from a notification tap: the SW could not post to a client that
  // did not exist yet, so it put the target in the URL instead. Consumed once
  // and stripped, so a reload does not reopen it.
  (function landFromQuery() {
    const q = new URLSearchParams(window.location.search);
    const open = q.get('open'), day = q.get('day');
    if (!open && !day) return;
    history.replaceState({}, '', window.location.pathname);
    setTimeout(() => openFromNotification(open || '', day || ''), 1200);
  })();

  window.SP = { openModal, toggleStar, openTvPicker, navigateToTab, shareCard, showUserPicker, hideUserPicker, openTrackRecord, closeTrackAndOpen, togglePush, toggleNotifPanel,
                calPrev, calNext, calDay, calClose, calIcs, calSubscribe, openCalendar,
                showSimilarCharts, clearSimilarCharts, openChartFor,
                openRatesBoard };

  // ── Init ─────────────────────────────────────────────────────────────
  // Wire legend filters once (static HTML elements — no re-registration on timeframe change)
  document.querySelectorAll('.legend-item[data-legend-filter]').forEach(el => {
    el.addEventListener('click', () => {
      const val = el.dataset.legendFilter;
      activeHmLegendFilter = activeHmLegendFilter === val ? '' : val;
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
  // A desktop browser left open behind another window never goes "hidden", so
  // visibilitychange alone meant a laptop could sit on stale drawings all day.
  let _lastFocusPull = 0;
  window.addEventListener('focus', () => {
    if (!syncUser || Date.now() - _lastFocusPull < 15000) return;
    _lastFocusPull = Date.now();
    syncPull();
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
    // bias label and gauge never contradict. close < MA50 alone marks DOWNTREND
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

    // 0. Ribbon rollover (max 35) — TOP structural factor. The fast line
    //     (MA50, double-weighted because it leads) and the mid line (MA250)
    //     cutting through the lines above them confirms a trend change,
    //     backing B1 (bull flip) / S1 (bear flip). Scored in
    //     indicators.add_ribbon_analytics; rollover_max is 5 on the 3-MA
    //     ribbon, and the points below are a FRACTION of it, so the 35-point
    //     weight is unchanged by the ribbon being narrower.
    const rollDir   = item[f('rollover_dir')] || 'none';
    const rollScore = parseInt(item[f('rollover_score')]) || 0;
    const rollMax   = parseInt(item[f('rollover_max')]) || 5;   // 3-MA ribbon max weight
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

    // 2. Signal confidence — REMOVED 2026-09-11. The tiers were fitted on the
    //    trades they claimed to predict, and nothing shows this score any more.

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
    const maMax   = summaryData.ma_max_pairs || 2;   // 3-MA ribbon -> 2 adjacent pairs
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
    const _volSpike = item[f('volume_spike_flag')];
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




  // ══════════════════════════════════════════════════════════════════════
  // Charts reel — full-screen scrollable candle charts
  // ══════════════════════════════════════════════════════════════════════
  // One instrument per screen, snap-scrolled. Data comes from the compact
  // chart feed (webapp/chart_feed.py): columnar OHLC + the MA ribbon, bundled
  // ~10 instruments per file so scrolling costs one fetch per 10 cards.
  //
  // The timeframe is the app-wide one. Charts is deliberately absent from
  // TF_LOCKED_TABS, so the topbar 4H/Daily switch redraws the reel.

  const REEL_BARS_FALLBACK = 140;

  const reel = {
    scope:  'all',
    cat:    '',
    trend:  'all',
    stack:  'all',
    similarTo: '',          // instrument whose lookalikes the reel is showing
    sort:   'signal',
    search: '',
    range:  0,               // trailing bars to draw; 0 = the whole window
    pan:    new Map(),       // name → bars scrolled BACK from the newest bar (0 = at the right edge)
    tzoom:  new Map(),       // name → bars visible; the time-scale drag's override of the Range pill
    lockY:  new Map(),       // name → {lo,hi} price bounds held still while panning
    editing: null,           // instrument whose channels are being edited, or null
    activeCh: new Map(),     // "name|tf" → index of the channel Lock/Clear act on
    index:  null,            // { chunk_size, bars, chunks: {name: chunkId} }
    chunks: new Map(),       // "D:3" → { name: bundle }
    inflight: new Map(),     // "D:3" → Promise
    list:   [],              // filtered+sorted rows, in reel order
    drawn:  new Set(),       // names whose SVG is currently in the DOM
    io:     null,
  };

  // ── Data access ──────────────────────────────────────────────────────

  // The publish whose bundles this page is holding — summary.fetched_at, set by
  // reelInvalidateCache below. It goes on the URL as well as in the cache key:
  // chunks are served `public, max-age=900`, and the `?v=` the publisher bakes
  // into these URLs only moves on a UI DEPLOY, which the data pipeline never
  // does. Between deploys the URL was a constant, so a fetch issued minutes
  // after a publish could still be answered from the browser's own 15-minute
  // copy. Stamping the publish on index and chunks alike keeps them the matched
  // pair they have to be, and makes a new publish a new URL.
  let reelDataVersion = '';

  function reelStamp(url) {
    return url + (url.indexOf('?') < 0 ? '?' : '&') + 'd=' + encodeURIComponent(reelDataVersion);
  }

  // Drop every cached chart bundle when a new publish lands.
  //
  // reel.chunks and reel.index are memoised for the life of the PAGE, and
  // nothing ever dropped them. That is right between publishes and wrong across
  // one: loadAll() re-fetches every other feed — on its 4-hourly timer, on the
  // stale-banner retry, on a tab becoming visible — and then calls renderAll(),
  // which rebuilds the reel from these same cached bundles. So the charts
  // redrew the data the page had at LAUNCH for as long as it stayed open, and
  // an installed PWA stays open for days.
  //
  // Daily, 3-Day and Weekly hid this: their newest bar only moves once a
  // session, so a launch snapshot was usually right by accident. 10m is rebuilt
  // by every run, roughly an hour apart, so it was always the launch snapshot
  // and never moved — which is exactly how it was reported.
  function reelInvalidateCache(stamp) {
    stamp = String(stamp || '');
    if (!stamp || stamp === reelDataVersion) return;
    reelDataVersion = stamp;
    reel.chunks.clear();
    reel.inflight.clear();
    reel.index = null;
    reelIndexPromise = null;
  }

  function reelChunkUrl(tf, cid) {
    return reelStamp('/api/chart/' + tf + '/' + cid);
  }

  let reelIndexPromise = null;
  function reelLoadIndex() {
    // Memoise the PROMISE, not just the result: the first two cards paint
    // concurrently and both would sail past an `if (reel.index)` check while
    // the first fetch was still in flight.
    if (reel.index) return Promise.resolve(reel.index);
    if (!reelIndexPromise) {
      // Captured, not re-read in the callback: a publish can land while this is
      // in flight, and an index that describes the previous one must not be
      // seeded into a cache that has already been cleared for the new one.
      const ver = reelDataVersion;
      reelIndexPromise = fetchJson(reelStamp('/api/chart-index'),
        { chunk_size: 10, bars: REEL_BARS_FALLBACK, chunks: {} })
        .then(idx => { if (ver === reelDataVersion) reel.index = idx; return idx; });
    }
    return reelIndexPromise;
  }

  // Fetch the bundle file holding `name`, memoised per (timeframe, chunk).
  // `tf` defaults to the active timeframe; the volume sparklines pass 'D'
  // explicitly because they are daily by definition.
  async function reelLoadChunk(name, tf) {
    tf = tf || timeframe;
    const idx = await reelLoadIndex();
    const cid = idx.chunks ? idx.chunks[name] : undefined;
    if (cid === undefined) return null;

    const key = tf + ':' + cid;
    if (reel.chunks.has(key)) return reel.chunks.get(key);
    if (reel.inflight.has(key)) return reel.inflight.get(key);

    // Same capture as reelLoadIndex: if a publish lands mid-fetch, this response
    // belongs to the previous one. Hand it to the caller that asked, but do not
    // re-seed the cache reelInvalidateCache has just emptied.
    const ver = reelDataVersion;
    const p = fetch(reelChunkUrl(tf, cid))
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        const data = (j && j.data) || {};
        if (ver === reelDataVersion) reel.chunks.set(key, data);
        reel.inflight.delete(key);
        return data;
      })
      .catch(() => {
        // Cache the failure as empty so a dead chunk doesn't refetch on every
        // scroll tick. A refresh clears it.
        if (ver === reelDataVersion) reel.chunks.set(key, {});
        reel.inflight.delete(key);
        return {};
      });

    reel.inflight.set(key, p);
    return p;
  }

  // ── Chart rendering ──────────────────────────────────────────────────

  // Geometry, derived from the card's real aspect ratio.
  // A fixed viewBox would letterbox hard: the card is roughly 0.8 wide-to-tall
  // on a phone, so a 1.6 viewBox would waste half the card on empty bands.
  // preserveAspectRatio="none" would fill it but stretch the text and strokes,
  // so instead the viewBox height follows the box we were given.
  function reelLayout(host) {
    const W  = 1000;
    const cw = host.clientWidth  || 360;
    const ch = host.clientHeight || 440;
    // Floor only guards against a degenerate box mid-layout — set it near the
    // real card aspect and a wide desktop card letterboxes instead of filling.
    const H  = Math.max(200, Math.min(1800, Math.round(W * ch / Math.max(1, cw))));
    const gutW  = 128;                       // price labels live here (24-unit text since 2026-09-15)
    const axisH = 34;                        // date row
    const stripH = 34;                       // trend strip + its label (reelTrendStripSvg)
    return {
      W, H,
      x0: 4, x1: W - gutW,
      py0: 14, py1: H - axisH - 14 - stripH,
      gut: W - gutW + 10,
      stripY: H - axisH - stripH + 4,
    };
  }

  // How far the ribbon may stretch the price scale before we stop following
  // it. Measured over the universe: the median instrument's ribbon widens the
  // range 1.25x, but 15% go past 2x and the worst is 7.3x — at which point the
  // bars are a 1-pixel smear and the chart has stopped being a chart. Past
  // this cap the ribbon clips and an edge tag says how far off-panel it sits.
  const RIBBON_SCALE_CAP = 2.2;

  // Empty bar-widths held back on the right, between the newest bar and the
  // price scale.
  const REEL_RIGHT_PAD_BARS = 10;

  // ...but as a SHARE of the window once the window gets small. The pad is
  // counted in bars, so a flat 10 is a tenth of a 100-bar view and HALF of a
  // 20-bar one — zoom the time scale in and the chart would hand more and more
  // of the panel to blank space, which is the opposite of zooming in. Windows
  // of 100 bars and up are unaffected.
  function reelRightPadBars(winBars) {
    return Math.min(REEL_RIGHT_PAD_BARS, Math.max(2, Math.round(winBars * 0.1)));
  }

  function reelScale(b, L, locked) {
    // A locked scale is the price window the reader was already looking at when
    // they grabbed the chart. Panning must not re-fit the axis underneath them —
    // that is a vertical zoom, and it is what "the view should remain" rules out.
    if (locked) {
      const span = (locked.hi - locked.lo) || 1;
      return {
        lo: locked.lo, hi: locked.hi, span,
        clipped: false, maLo: NaN, maHi: NaN,
        y:   v => L.py1 - ((v - locked.lo) / span) * (L.py1 - L.py0),
        inv: y => locked.lo + ((L.py1 - y) / (L.py1 - L.py0)) * span,
      };
    }
    const lows  = b.l.filter(v => v != null);
    const highs = b.h.filter(v => v != null);
    if (!lows.length || !highs.length) return null;

    const pLo = Math.min(...lows), pHi = Math.max(...highs);
    const pRange = (pHi - pLo) || (pHi * 0.02) || 1;

    let mLo = Infinity, mHi = -Infinity;
    for (const series of b.m) {
      for (const v of series) {
        if (v == null) continue;
        if (v < mLo) mLo = v;
        if (v > mHi) mHi = v;
      }
    }
    const hasMa = isFinite(mLo);

    let lo = pLo, hi = pHi;
    if (hasMa) {
      lo = Math.min(lo, mLo);
      hi = Math.max(hi, mHi);
      if ((hi - lo) > pRange * RIBBON_SCALE_CAP) {
        // Keep the bars legible, clip the ribbon, and centre the price.
        const pad = pRange * (RIBBON_SCALE_CAP - 1) / 2;
        lo = pLo - pad;
        hi = pHi + pad;
      }
    }
    const pad = (hi - lo) * 0.04;
    lo -= pad; hi += pad;

    const span = (hi - lo) || 1;
    return {
      lo, hi, span,
      clipped: hasMa && (mLo < lo || mHi > hi),
      maLo: mLo, maHi: mHi,
      y:   v => L.py1 - ((v - lo) / span) * (L.py1 - L.py0),
      // Inverse of y — a drag hands us a pixel and needs the price back.
      inv: y => lo + ((L.py1 - y) / (L.py1 - L.py0)) * span,
    };
  }

  function reelFmtPrice(v) {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 10000) return Math.round(v).toLocaleString('en-US');
    if (a >= 1000) return v.toFixed(0);
    if (a >= 10)   return v.toFixed(2);
    if (a >= 0.1)  return v.toFixed(4);
    return v.toPrecision(4);
  }

  // Round gridline levels — 1/2/5 x 10^n, the steps a price axis is read in.
  function reelTicks(lo, hi, want) {
    const raw  = (hi - lo) / Math.max(1, want);
    const mag  = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    const out  = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
    return out;
  }

  // Trim a bundle to its last `bars` bars. The ribbon is stored decimated with
  // its own bar indices (b.mi), so those are filtered and rebased rather than
  // sliced by the same count — slicing them naively would slide the ribbon
  // sideways against the price.
  function reelSlice(b, bars, offset) {
    const n    = b.c.length;
    const want = (!bars || bars >= n) ? n : bars;
    // `offset` scrolls the window BACK through history. It is clamped here
    // rather than at the drag site so every caller gets the same window and
    // the drag cannot walk the chart off the end of the data.
    const off  = Math.min(Math.max(0, Math.round(offset || 0)), Math.max(0, n - want));
    if (want >= n && !off) return b;
    const to   = n - off;
    const from = Math.max(0, to - want);
    const keep = [];
    const mi   = b.mi || b.m[0].map((_, j) => Math.min(j * (b.ms || 1), n - 1));
    for (let j = 0; j < mi.length; j++) if (mi[j] >= from && mi[j] < to) keep.push(j);
    return {
      t: b.t.slice(from, to), o: b.o.slice(from, to), h: b.h.slice(from, to),
      l: b.l.slice(from, to), c: b.c.slice(from, to),
      p: b.p, ms: b.ms,
      mi: keep.map(j => mi[j] - from),
      m:  b.m.map(series => keep.map(j => series[j])),
      _from: from, _n: n,
      // The whole bundle, so dates map to x against ALL of history rather than
      // against whatever happens to be on screen (see reelBarIndexForDate).
      _src: b,
    };
  }

  // How many bars the visible window holds, for a given bundle. A per-card
  // override set by the time-scale drag wins over the Range pill.

  // What a card OPENS on, when nothing else says otherwise. The bundle now
  // carries far more than this (chart_feed.BARS_BY_TF) so the time scale has
  // somewhere to zoom out to and history to pan back through — but the first
  // view has to stay the two-year read these charts are built around, or every
  // card would open compressed to fit five years it was not asked for.
  const REEL_DEFAULT_WINDOW_BARS = 520;

  // Floor on the time window. Lowered 20 -> 10 on 2026-09-09: 20 bars still
  // stopped short of the "what did the last fortnight actually do" read the
  // zoom is for. Ten is where a daily chart is two trading weeks and the bars
  // are about as wide as they are tall.
  const REEL_MIN_WINDOW_BARS = 10;

  // How far OUT a card may zoom. The whole bundle everywhere except 10m, which
  // stops at ONE MONTH AND TEN DAYS of calendar (user, 2026-09-19): the bundle
  // carries two months, but past about forty days the candles are a smear
  // on every instrument, so that is the widest view that is still a chart.
  // Measured off the bundle's own timestamps, so it is the same span of
  // calendar on an equity (~1,000 bars) and on BTC (~5,800). Memoised on the
  // bundle like reelBarTimes; a new publish brings new bundle objects.
  const REEL_TEN_MIN_MAX_SPAN = { months: 1, days: 10 };
  // How many of the bundle's newest bars fall inside a calendar span ending at
  // its last bar. Timestamps, not a bar count, so the span is the same amount
  // of CALENDAR on an equity and on a 24h instrument.
  function reelBarsInSpan(bundle, months, days) {
    const n = bundle.c.length;
    if (n < 2) return n;
    const bt   = reelBarTimes(bundle);
    const last = new Date(bt[n - 1]);
    const cut  = Date.UTC(last.getUTCFullYear(), last.getUTCMonth() - months,
                          last.getUTCDate() - days, last.getUTCHours(), last.getUTCMinutes());
    let k = n - 1;
    while (k > 0 && bt[k - 1] >= cut) k--;
    return Math.max(REEL_MIN_WINDOW_BARS, n - k);
  }

  function reelMaxBars(bundle) {
    const n = bundle.c.length;
    if (timeframe !== '10m' || n < 2) return n;
    if (bundle._maxBars) return bundle._maxBars;
    return (bundle._maxBars = reelBarsInSpan(bundle, REEL_TEN_MIN_MAX_SPAN.months,
                                             REEL_TEN_MIN_MAX_SPAN.days));
  }

  // The window a card opens on — what a zoom override is cleared back to.
  //
  // 10m opens on ONE CALENDAR MONTH and 4H on ONE CALENDAR YEAR, every time the
  // timeframe is switched to (user, 2026-09-19: "the 10 min chart has to show
  // me a full month on every switch, 4h full year"). This reverses the 120-bar
  // 10m window of 2026-09-17 by the user's explicit call: a month of 10m is
  // ~800 bars on an equity and ~4,300 on BTC, so candles there are sub-pixel
  // and read as a line — zoom in (drag the time axis) to see them. 4H is ~500
  // bars on an equity and ~2,190 on a 24h instrument (the whole bundle).
  function reelDefaultBars(bundle) {
    const n = bundle.c.length;
    if (timeframe === '10m' || timeframe === '4H') {
      if (bundle._defBars) return bundle._defBars;
      const span = timeframe === '10m' ? [1, 0] : [12, 0];
      return (bundle._defBars = Math.min(n, reelBarsInSpan(bundle, span[0], span[1])));
    }
    return Math.min(n, REEL_DEFAULT_WINDOW_BARS);
  }

  function reelWindowBars(bundle, name) {
    const n = bundle.c.length;
    // The time-scale drag is per-card and beats the Range pill, which is a
    // filter-bar default for every card at once. Clamped here rather than only
    // where it is set, so a stale entry from a wider bundle can never ask for
    // more bars than this one has.
    const z = reel.tzoom.get(name);
    if (z) return Math.max(REEL_MIN_WINDOW_BARS, Math.min(Math.round(z), reelMaxBars(bundle)));
    const w = reel.range;
    if (w && w < n) return w;
    // 10m and 4H open on a calendar span — see reelDefaultBars.
    return reelDefaultBars(bundle);
  }

  function reelPanOf(name) { return reel.pan.get(name) || 0; }

  // How far PAST the newest bar you may scroll, as a share of the window. The
  // empty space is the point: a channel is a projection, and you cannot read a
  // projection that stops at today's bar.
  // Raised 0.5 -> 0.9 on 2026-09-09 so the daily chart can actually be scrolled
  // to the 2027 and 2028 year lines. Half a window is about a year of trading
  // days, which stops short of 2028 — and a year line you cannot reach is not
  // on the chart in any useful sense.
  const REEL_FUTURE_FRAC = 0.9;

  function reelSetPan(name, v, bundle) {
    const n    = bundle.c.length;
    const want = reelWindowBars(bundle, name);
    const max  = Math.max(0, n - want);                    // back through history
    const min  = -Math.round(want * REEL_FUTURE_FRAC);     // forward into blank space
    const next = Math.min(Math.max(min, Math.round(v)), max);
    if (next === reelPanOf(name)) return false;
    if (next) reel.pan.set(name, next); else reel.pan.delete(name);
    return true;
  }

  // A range change or a timeframe switch invalidates every pan offset — the
  // window is a different width, so "12 bars back" means something else.
  function reelResetPan() { reel.pan.clear(); reel.lockY.clear(); reel.tzoom.clear(); }

  // A drag MOVES THE WINDOW. It never resizes it: the amount of chart on screen
  // is the Range pill's business, and a drag that silently re-zoomed made
  // panning feel like the chart was jumping around under the finger. At "Full
  // window" the whole bundle is already drawn, so there is nothing to pan to
  // and a drag correctly does nothing — pick a Range to make room.

  // ── Trend channel ────────────────────────────────────────────────────
  // Anchored in (date, price), never in pixels or bar indices: that is what
  // lets ONE channel be a trend read on every timeframe. A bar index means
  // something different on 1H than on Weekly; a date does not.

  // Bar labels are '2026-09-08' on D/3D/W and '2026-09-08 14:00' on 1H/4H
  // (chart_feed's date_fmt). Parsing only the date collapsed every intraday bar
  // on a day to one timestamp, which flattened the whole x mapping on 1H and
  // 4H — a channel drawn on Daily landed in the wrong place there, or nowhere.
  function reelParseTs(v) {
    const m = String(v).trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/);
    return m ? Date.parse(m[1] + 'T' + (m[2] || '00:00') + ':00Z') : NaN;
  }

  function reelBarTimes(b) {
    if (b._bt) return b._bt;
    b._bt = b.t.map(reelParseTs);
    return b._bt;
  }

  // Fractional bar index for a date, EXTRAPOLATING outside the window so a
  // channel drawn on Weekly still has a slope when you look at it on 1H, where
  // both its anchors may sit years off the left edge.
  // How many bars the extrapolation's bar spacing is averaged over. It was the
  // last TEN, which on a daily chart is two weeks and so swings with where the
  // weekends fall — enough to tilt a projected channel from one day to the next.
  const REEL_EXTRAP_BARS = 250;

  // WINDOW-RELATIVE, but measured against the whole bundle. Until 2026-09-15 it
  // measured against the visible slice only, so an anchor that had scrolled
  // off-screen was EXTRAPOLATED from the ten bars at the window's edge — and
  // those ten bars change on every pan step. That is why a channel slid in and
  // out of place as the chart moved. Against the full bundle an anchor inside
  // history is interpolated exactly, and only a future anchor is projected,
  // from a spacing that no pan can change.
  function reelBarIndexForDate(b, dateStr) {
    if (b._src) {
      const fi = reelBarIndexForDate(b._src, dateStr);
      return fi == null ? null : fi - b._from;
    }
    const bt = reelBarTimes(b);
    const n  = bt.length;
    const t  = reelParseTs(dateStr);
    if (!isFinite(t) || !n) return null;
    if (n === 1) return 0;
    if (t <= bt[0]) {
      const k = Math.min(n - 1, REEL_EXTRAP_BARS);
      const per = (bt[k] - bt[0]) / k;
      return per > 0 ? (t - bt[0]) / per : 0;
    }
    if (t >= bt[n - 1]) {
      const k = Math.max(0, n - 1 - REEL_EXTRAP_BARS);
      const per = (bt[n - 1] - bt[k]) / Math.max(1, n - 1 - k);
      return per > 0 ? (n - 1) + (t - bt[n - 1]) / per : n - 1;
    }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (bt[mid] <= t) lo = mid; else hi = mid; }
    const span = bt[hi] - bt[lo];
    return span > 0 ? lo + (t - bt[lo]) / span : lo;
  }

  function reelDateForBarIndex(b, fi) {
    if (b._src) return reelDateForBarIndex(b._src, fi + b._from);
    const n = b.t.length;
    if (!n) return null;
    // Past the newest bar there is no label to snap to. This used to clamp to
    // the last bar, so a handle dropped out in the blank space ahead of price
    // was saved at TODAY's date with the pointer's price — the line re-tilted
    // the moment it was released. Project a timestamp instead, with exactly the
    // spacing reelBarIndexForDate projects with, so the round trip is exact.
    if (fi > n - 1 + 0.5) {
      const bt = reelBarTimes(b);
      const k = Math.max(0, n - 1 - REEL_EXTRAP_BARS);
      const per = (bt[n - 1] - bt[k]) / Math.max(1, n - 1 - k);
      if (per > 0 && isFinite(bt[n - 1])) {
        const d = new Date(bt[n - 1] + (fi - (n - 1)) * per);
        if (!isNaN(d)) return d.toISOString().slice(0, 16).replace('T', ' ');
      }
    }
    const i = Math.round(Math.min(Math.max(0, fi), n - 1));
    return String(b.t[i]);          // full label — hour-precise when drawn on 1H/4H
  }

  // A starting channel that already sits on the chart, so the first drag is an
  // adjustment rather than a construction. Anchored a fifth in from each edge
  // of the visible window, on the closes there, and opened to the deepest
  // excursion between them — which is the channel you were going to draw.
  function reelDefaultChannel(b) {
    const n = b.c.length;
    if (n < 8) return null;
    const i1 = Math.floor(n * 0.2), i2 = Math.floor(n * 0.8);
    const p1 = b.c[i1], p2 = b.c[i2];
    if (p1 == null || p2 == null) return null;
    const m = (p2 - p1) / (i2 - i1);
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const lo = b.l[i], hi = b.h[i];
      if (lo == null || hi == null) continue;
      const base = p1 + m * (i - i1);
      if (hi - base >  worst) worst = hi - base;
      if (lo - base < -worst) worst = -(lo - base);
    }
    const half = (worst || Math.abs(p1) * 0.04) / 2;
    // The spine sits on the run between the two closes, with the edges opened
    // out either side of it, so a new channel starts centred on the move.
    return {
      kind: 'channel',
      t1: String(b.t[i1]), p1: p1 + half,
      t2: String(b.t[i2]), p2: p2 + half,
      up: half, dn: -half,
    };
  }

  // TWO channels on every chart and every timeframe (user request, 2026-09-18).
  //
  // Fitted to the VISIBLE window at first paint, exactly as a hand-added channel
  // is (channelAdd passes the same slice), so a seeded channel and a drawn one
  // start life identically. Panning afterwards does not refit either of them.
  //
  // Each channel belongs to a SWING LEG, not to a slice of the window. Read off
  // the user's own ALL_AX 4H chart (2026-09-18): one channel on the fall from the
  // January high to the April low, the other on the rally off that low which is
  // still running. So: the developing leg, and the completed one before it.
  //
  // Where the legs come from, read off the user's own ALL_AX / GOLD / US100
  // charts rather than invented: the window's HIGHEST HIGH and LOWEST LOW are
  // the boundary, and the big move between them is a leg. What decides whether
  // the move SINCE that last extreme is a leg of its own or just a pullback
  // inside the one before it is how much of that leg it has given back.
  //
  // Measured on the 4H bundles the user drew on (2026-09-18), move since the
  // last extreme as a share of the leg before it:
  //     ALL_AX 30%   GOLD 44%   BTCUSD 21%   ->  pullback, the leg still stands
  //     US100  60%                           ->  a new leg, and it is the one running
  // The user's ALL_AX channels are the 30% case: one channel on the rise from
  // the March low to the August high, with that -10% pullback held INSIDE it,
  // and the other on the fall that came before. A zigzag was tried first and got
  // this wrong — it broke the rise into two at the August high, which is exactly
  // what the user had not done.
  //
  // RETRACE_NEW_LEG is therefore the whole rule, and 0.5 is the classic place to
  // put it: give back half of a move and it is no longer a pullback in it.
  const RETRACE_NEW_LEG = 0.5;
  const MIN_LEG_BARS    = 8;        // shorter than this is a wick, not a leg

  // [developing, previous] as [i1, i2] index pairs, or fewer when the window
  // does not hold them.
  function reelSwingLegs(b) {
    const n = b.c.length;
    const hi = b.h || b.c, lo = b.l || b.c;
    let iHi = -1, iLo = -1;
    for (let i = 0; i < n; i++) {
      if (hi[i] != null && (iHi < 0 || hi[i] > hi[iHi])) iHi = i;
      if (lo[i] != null && (iLo < 0 || lo[i] < lo[iLo])) iLo = i;
    }
    if (iHi < 0 || iLo < 0 || iHi === iLo) return [];
    const A = Math.min(iHi, iLo), B = Math.max(iHi, iLo);
    const pA = A === iLo ? lo[A] : hi[A];
    const pB = B === iHi ? hi[B] : lo[B];
    const span = Math.abs(pB - pA);
    const last = b.c[n - 1];
    const frac = span && last != null ? Math.abs(last - pB) / span : 0;

    // Given back half the leg: the tail IS the leg now running, and the move
    // between the two extremes is the one before it.
    if (frac >= RETRACE_NEW_LEG && (n - 1 - B) >= MIN_LEG_BARS) return [[B, n - 1], [A, B]];

    // Otherwise the move between the extremes is still the developing leg, and
    // the previous one runs from the opposite extreme before it.
    let j = A;
    for (let i = 0; i <= A; i++) {
      if (A === iLo) { if (hi[i] != null && hi[i] > hi[j]) j = i; }
      else           { if (lo[i] != null && lo[i] < lo[j]) j = i; }
    }
    const legs = [[A, B]];
    if (A - j >= MIN_LEG_BARS) legs.push([j, A]);
    // Nothing before it — the leg starts at the left edge, as it does on a chart
    // that has run one way the whole window. The pullback since the last extreme
    // is then the second channel: it is the only other structure on the chart,
    // and two channels is what was asked for.
    else if ((n - 1 - B) >= MIN_LEG_BARS) legs.push([B, n - 1]);
    return legs;
  }

  // A channel fitted to bars [i1, i2], built the way the user draws one
  // (2026-09-18: "the trend line is parallel to the 500ma and it also include
  // price and the first top or bottom is the midway of the trend"):
  //   - SLOPE is the MA500's slope over the leg (least squares through the
  //     slowest ribbon series), so the channel runs parallel to the anchor;
  //   - the MIDLINE passes through the leg's first extreme — the low an up leg
  //     starts from, the high a down leg starts from;
  //   - the rails sit the SAME distance either side, far enough out to hold
  //     every high and low of the leg.
  // Price is what the rails contain; the ribbon is no longer forced inside.
  // Falls back to the slope of the closes when the leg holds too few MA500
  // samples (short history, or a leg shorter than the ribbon's sampling).
  function reelChannelForLeg(b, i1, i2) {
    if (i2 - i1 < MIN_LEG_BARS) return null;
    const n = b.c.length;
    const hi = b.h || b.c, lo = b.l || b.c;
    const lsSlope = pts => {
      if (pts.length < 2) return null;
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
      const k = pts.length, den = k * sxx - sx * sx;
      return den ? (k * sxy - sx * sy) / den : null;
    };
    const slow = (b.m && b.m.length) ? b.m[b.m.length - 1] : null;
    const mi = b.mi || ((b.m && b.m[0]) ? b.m[0].map((_, j) => Math.min(j * (b.ms || 1), n - 1)) : []);
    const maPts = [];
    if (slow) for (let j = 0; j < slow.length; j++) {
      const i = mi[j];
      if (i != null && i >= i1 && i <= i2 && slow[j] != null) maPts.push([i, slow[j]]);
    }
    let m = maPts.length >= 3 ? lsSlope(maPts) : null;
    if (m == null) {
      const cPts = [];
      for (let i = i1; i <= i2; i++) if (b.c[i] != null) cPts.push([i, b.c[i]]);
      m = lsSlope(cPts);
    }
    if (m == null) return null;
    const upLeg = (b.c[i2] != null && b.c[i1] != null) ? b.c[i2] >= b.c[i1] : m >= 0;
    const pivot = upLeg ? lo[i1] : hi[i1];
    if (pivot == null) return null;
    const at = i => pivot + m * (i - i1);
    let w = 0;
    for (let i = i1; i <= i2; i++) {
      const base = at(i);
      if (hi[i] != null) w = Math.max(w, Math.abs(hi[i] - base));
      if (lo[i] != null) w = Math.max(w, Math.abs(lo[i] - base));
    }
    if (!(w > 0)) return null;
    // EXTENDED across the whole panel, both ways, like a hand-drawn channel
    // (user, 2026-09-18: "make sure the channels are extended") — no clip flags.
    return { kind: 'channel', t1: String(b.t[i1]), p1: at(i1),
                              t2: String(b.t[i2]), p2: at(i2), up: w, dn: -w };
  }

  // TWO channels on every chart and every timeframe (user request, 2026-09-18):
  // the developing leg and the one before it. Falls back to the old
  // window/last-third pair when the window holds fewer than two legs — a chart
  // that has run one way the whole time still gets two channels rather than one
  // or none, and dragging one is how the reader tells it what they see.
  function reelSeedChannels(b) {
    const n = b && b.c ? b.c.length : 0;
    if (n < 24) return [];
    const out = [];
    for (const [i1, i2] of reelSwingLegs(b)) {
      // The FIRST leg back is the developing one: it runs to the last bar, so
      // the pullback since its extreme sits inside it — but never past today.
      const ch = reelChannelForLeg(b, i1, out.length === 0 ? n - 1 : i2);
      if (ch) out.push(ch);
      if (out.length === 2) break;
    }
    if (out.length === 2) return out;                   // [developing, previous]
    // A window with no legs to find (flat, or too short) still gets its pair,
    // fitted the old way — whole window and last third.
    const cut  = Math.floor(n * 2 / 3);
    const tail = { c: b.c.slice(cut), l: b.l.slice(cut),
                   h: b.h.slice(cut), t: b.t.slice(cut) };
    const pair = [reelDefaultChannel(b), reelDefaultChannel(tail)];
    return pair.every(Boolean) ? pair : out;
  }

  // ── The other two tools ──────────────────────────────────────────────
  // Both start fitted to what is on screen, for the same reason the channel
  // does: the first drag should be an adjustment, not a construction.

  function reelDefaultTrend(b) {
    const n = b.c.length;
    if (n < 8) return null;
    const i1 = Math.floor(n * 0.2), i2 = Math.floor(n * 0.8);
    if (b.c[i1] == null || b.c[i2] == null) return null;
    return { kind: 'trend', t1: String(b.t[i1]), p1: b.c[i1],
                            t2: String(b.t[i2]), p2: b.c[i2] };
  }

  // Ten price lines, evenly spaced (user spec, 2026-09-11). Stored as two
  // anchors — line 1 and line 4 — because those are the two the reader drags:
  // every line sits at p1 + k × (p4 − p1) / 3, so the set stays even whichever
  // handle moves. Starts spanning the visible range, lowest low to highest high.
  const LADDER_LINES = 10;
  function reelDefaultLadder(b) {
    const lows = b.l.filter(v => v != null), highs = b.h.filter(v => v != null);
    if (!lows.length || !highs.length) return null;
    const lo = Math.min(...lows), hi = Math.max(...highs);
    if (!(hi > lo)) return null;
    const step = (hi - lo) / (LADDER_LINES - 1);
    return { kind: 'ladder', p1: lo, p4: lo + 3 * step };
  }

  function reelDefaultHLine(b) {
    const n = b.c.length;
    for (let i = n - 1; i >= 0; i--) if (b.c[i] != null) return { kind: 'hline', p: b.c[i] };
    return null;
  }

  // Vertical line: three quarters of the way across the window, on a bar.
  function reelDefaultVLine(b) {
    const n = b.c.length;
    if (!n) return null;
    return { kind: 'vline', t: String(b.t[Math.floor((n - 1) * 0.75)]) };
  }

  // Entry marker: starts ON a candle — three quarters of the way across the
  // window, at that bar's close — and runs a short way to the right.
  function reelDefaultEntry(b) {
    const n = b.c.length;
    if (n < 4) return null;
    let i = Math.floor(n * 0.75);
    while (i > 0 && b.c[i] == null) i--;
    if (b.c[i] == null) return null;
    const len = Math.max(4, Math.round(n * 0.1));
    const t2 = reelDateForBarIndex(b, i + len);
    return t2 ? { kind: 'entry', t: String(b.t[i]), p: b.c[i], t2 } : null;
  }

  function reelDefaultDrawing(kind, b) {
    if (kind === 'entry') return reelDefaultEntry(b);
    if (kind === 'trend') return reelDefaultTrend(b);
    if (kind === 'hline') return reelDefaultHLine(b);
    if (kind === 'vline') return reelDefaultVLine(b);
    if (kind === 'ladder') return reelDefaultLadder(b);
    return reelDefaultChannel(b);
  }

  function channelSave() {
    channelStampChanges();
    try { localStorage.setItem(sk('sp-channels'), JSON.stringify(instChannels)); } catch (_) {}
    syncPush();
  }

  // Open (or close) the drawing tools on one card.
  //
  // It does NOT place anything. Until 2026-09-12 a first tap dropped a default
  // CHANNEL on the chart before you had chosen a tool — so asking to see the
  // tools left you with a channel to delete, and the button named one of the
  // four tools by picking it for you. Now the tap only opens the tool row
  // (`[data-tools]`, shown by reelSyncChannelButtons while reel.editing is this
  // card); a drawing appears when you tap the tool you actually want, which is
  // channelAdd's job.
  function channelToggleEdit(name, host) {
    // Locked is a real gate, not a label. Unlocking goes STRAIGHT into editing:
    // you only unlock in order to change something, and making that two taps
    // read as "I cannot adjust the channel any more".
    // (The old "tap Unlock to edit" shortcut is gone: each drawing now carries
    // its own lock in the properties row, so this button only opens and closes
    // Draw mode and never changes a drawing.)
    if (reel.editing === name) { reel.editing = null; channelSave(); }
    else reel.editing = name;
    if (host) reelRepaint(host);
    reelSyncChannelButtons();
  }

  // Lock finishes the channel: it stays drawn and stays put, and no touch can
  // move it until it is unlocked. This is the "I am happy with it" step, which
  // is a different statement from "I have stopped editing for now".
  // Add a SECOND (or third) channel to the same chart. Offset from the default
  // so it does not land exactly on top of the one already there — two channels
  // drawn on the same pixels look like one and cannot be told apart to drag.
  function channelAdd(name, host, kind) {
    const ctx = host && host._reelCtx;
    if (!ctx) return;
    const def = reelDefaultDrawing(kind || 'channel', ctx.b);
    if (!def) return;
    const n = channelsFor(name).length;
    if (n) {
      // Offset from whatever is already there — two drawings on the same pixels
      // look like one and cannot be told apart to drag.
      const shift = (ctx.sc.hi - ctx.sc.lo) * 0.12 * n;
      if (def.kind === 'hline' || def.kind === 'entry') def.p -= shift;
      else if (def.kind === 'vline') {
        const fi = reelBarIndexForDate(ctx.b, def.t);
        const dt = fi == null ? null : reelDateForBarIndex(ctx.b, Math.round(fi - ctx.b.c.length * 0.08 * n));
        if (dt) def.t = dt;
      }
      else if (def.kind === 'ladder') { def.p1 -= shift; def.p4 -= shift; }
      else { def.p1 -= shift; def.p2 -= shift; }
    }
    addChannelFor(name, def);
    reel.editing = name;
    channelSave();
    if (host) reelRepaint(host);
    reelSyncChannelButtons();
  }

  function channelSetLocked(name, locked, host) {
    const ch = activeChannel(name);
    if (!ch) return;
    ch.locked = !!locked;
    // Draw mode stays open: locking ONE drawing says nothing about the others.
    channelSave();
    if (host) reelRepaint(host);
    reelSyncChannelButtons();
  }

  function channelClear(name, host) {
    clearChannelFor(name);
    // Stay in Draw mode while other drawings remain — deleting one is not
    // "I am finished with the chart".
    // Draw mode stays open even when the last one goes, so Undo is still there
    // to bring it back.
    channelSave();
    if (host) reelRepaint(host);
    reelSyncChannelButtons();
  }

  // ONE place decides what the channel controls say — the card HTML and the
  // live update both read it, so the two cannot drift apart. Every label is what
  // the button will DO, not what state it is in.
  // The Draw button leads with a pencil (user, 2026-09-15). Built in one place
  // because the label is rewritten live — setting textContent would strip it.
  const ICON_PENCIL = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3l4 4L8 20l-5 1 1-5z"/><path d="M14 6l4 4"/></svg>`;
  function channelBtnHtml(name) {
    return ICON_PENCIL + `<span>${channelBtnLabel(name)}</span>`;
  }

  function channelBtnLabel(name) {
    const ch = activeChannel(name);
    if (reel.editing === name)  return 'Done';
    // Short on purpose: 'Edit channel' wrapped the footer onto two lines beside
    // Details and TradingView, which moved the chart every time one appeared.
    // 'Drawing', not 'Channel' (2026-09-12): the button opens FOUR tools —
    // channel, trend line, level and the 10 price lines — so naming it after one
    // of them described a quarter of what it does.
    return ch ? 'Edit' : 'Drawing';
  }

  function reelSyncChannelButtons() {
    chartFullSyncButtons();
    document.querySelectorAll('#chartReel .reel-card').forEach(card => {
      const name = card.dataset.name;
      const ch   = activeChannel(name);
      const nCh  = channelsFor(name).length;
      const tools = card.querySelector('[data-tools]');
      if (tools) tools.hidden = reel.editing !== name;
      const btn  = card.querySelector('[data-act="channel"]');
      if (btn) {
        btn.innerHTML = channelBtnHtml(name);
        btn.classList.toggle('on', reel.editing === name);
      }
      reelSyncProps(card, name);
      // Edit mode is modal, so the card shows only the controls that belong to
      // it. Five buttons do not fit a phone footer — TradingView was clipped —
      // and Details/TradingView are the wrong thing to hit mid-drag anyway.
      card.classList.toggle('ch-editing', reel.editing === name);
    });
  }

  // Rebuild the properties row for whichever drawing is selected now.
  function reelSyncProps(root, name) {
    const u = root && root.querySelector('[data-act="draw-undo"]');
    const r = root && root.querySelector('[data-act="draw-redo"]');
    if (u) u.disabled = !drawCanStep(name, -1);
    if (r) r.disabled = !drawCanStep(name, 1);
    const props = root && root.querySelector('[data-props]');
    if (!props) return;
    const show = reel.editing === name && channelsFor(name).length > 0;
    props.hidden = !show;
    if (show) props.innerHTML = reelPropsHtml(name);
  }

  // The narrowest a channel may be, in viewBox units. Dragging the width handle
  // onto the base line would otherwise put both edges AND the midline on the
  // same pixels — three lines drawn on top of each other, which reads as one
  // line and cannot be grabbed apart again.
  const CH_MIN_SPAN = 20;

  function reelChannelsSvg(list, b, L, sc, bw, editing, activeI) {
    if (!list || !list.length) return '';
    // Each drawing is its own group: its colour is a custom property on the
    // group (every drawing class already reads --reel-ch-color), and the
    // selected one is marked so you can see what the properties row acts on.
    //
    // ONLY the selected drawing is editable (user, 2026-09-15): it alone grows
    // handles. The rest draw as plain lines that a tap selects, so dragging
    // near one drawing can never move another that happens to sit close by.
    return list.map((d, i) => {
      const sel = editing && i === activeI;
      return `<g class="reel-draw${sel ? ' is-sel' : ''}" style="--reel-ch-color:${drawColor(d)}">`
        + reelDrawingSvg(d, b, L, sc, bw, sel, i, sel) + '</g>';
    }).join('');
  }

  // One entry point for every tool. Each kind renders its own geometry but they
  // share the handle shape, the active/idle styling and the min-size rules, so
  // a new tool is a case here rather than a parallel implementation.
  function reelDrawingSvg(d, b, L, sc, bw, editing, idx, isActive) {
    if (!d) return '';
    if (d.kind === 'trend') return reelTrendSvg(d, b, L, sc, bw, editing, idx, isActive);
    if (d.kind === 'hline') return reelHLineSvg(d, b, L, sc, bw, editing, idx, isActive);
    if (d.kind === 'vline') return reelVLineSvg(d, b, L, sc, bw, editing, idx, isActive);
    if (d.kind === 'ladder') return reelLadderSvg(d, b, L, sc, bw, editing, idx, isActive);
    if (d.kind === 'entry')  return reelEntrySvg(d, b, L, sc, bw, editing, idx, isActive);
    return reelChannelSvg(d, b, L, sc, bw, editing, idx, isActive);
  }

  // Shared handle markup: a visible dot plus an invisible ~30px grab target.
  function reelHandle(L, x, y, id, idx, isActive) {
    if (!(x >= L.x0 - 2 && x <= L.x1 + 2)) return '';
    const cls = isActive ? 'reel-ch-h' : 'reel-ch-h is-idle';
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" class="${cls}" data-h="${id}" data-ci="${idx}"/>` +
           `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="42" class="reel-ch-grab" data-h="${id}" data-ci="${idx}"/>`;
  }

  // MOVE handle (2026-09-15): a square, so it cannot be mistaken for the round
  // shape handles. Dragging it carries the WHOLE drawing — every date shifts by
  // the same number of bars and every price by the same amount — so nothing
  // about its shape changes.
  function reelMoveHandle(L, x, y, idx, isActive) {
    if (!(x >= L.x0 - 2 && x <= L.x1 + 2)) return '';
    const cls = isActive ? 'reel-ch-h reel-ch-move' : 'reel-ch-h reel-ch-move is-idle';
    return `<rect x="${(x - 12).toFixed(1)}" y="${(y - 12).toFixed(1)}" width="24" height="24" rx="4" class="${cls}" data-h="m" data-ci="${idx}"/>` +
           `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="42" class="reel-ch-grab" data-h="m" data-ci="${idx}"/>`;
  }

  // Where a move handle sits along a line from (xa,ya) to (xb,yb): its middle,
  // pulled into the panel so a drawing you can see is always one you can move.
  function reelMoveSpot(L, xa, ya, xb, yb, bias) {
    const pad = 60;
    let mx = (xa + xb) / 2 + (bias || 0);
    mx = Math.min(Math.max(mx, L.x0 + pad), L.x1 - pad);
    const t = Math.abs(xb - xa) > 0.5 ? (mx - xa) / (xb - xa) : 0;
    return { x: mx, y: ya + (yb - ya) * t };
  }

  const DRAW_DATE_KEYS  = ['t', 't1', 't2'];
  const DRAW_BOLDABLE   = new Set(['entry', 'hline', 'vline']);
  const DRAW_PRICE_KEYS = ['p', 'p1', 'p2', 'p4'];

  // Write `orig` shifted by dBars and dP into `target`. Offsets that are not
  // positions (a channel's up/dn) are left alone, which is what keeps the shape.
  function reelShiftDrawing(target, orig, dBars, dP, b) {
    if (dBars) {
      for (const k of DRAW_DATE_KEYS) {
        if (typeof orig[k] !== 'string') continue;
        const fi = reelBarIndexForDate(b, orig[k]);
        const dt = fi == null ? null : reelDateForBarIndex(b, fi + dBars);
        if (dt) target[k] = dt;
      }
    } else {
      for (const k of DRAW_DATE_KEYS) if (typeof orig[k] === 'string') target[k] = orig[k];
    }
    for (const k of DRAW_PRICE_KEYS) if (typeof orig[k] === 'number') target[k] = orig[k] + dP;
  }

  // Undo (dir -1) or redo (dir +1) the last change on THIS chart.
  function drawHistoryStep(name, host, dir) {
    const k = chKey(name, timeframe);
    const from = dir < 0 ? drawUndo : drawRedo;
    const to   = dir < 0 ? drawRedo : drawUndo;
    const st = from.get(k);
    if (!st || !st.length) return;
    const target = st.pop();
    drawHistoryPush(to, k, channelSnap[k] == null ? null : channelSnap[k]);
    const list = target ? JSON.parse(target) : null;
    if (list && list.length) {
      if (!instChannels[name]) instChannels[name] = {};
      instChannels[name][timeframe] = list;
    } else if (instChannels[name]) {
      delete instChannels[name][timeframe];
      if (!Object.keys(instChannels[name]).length) delete instChannels[name];
    }
    reel.activeCh.delete(k);
    drawHistoryMuted = true;
    try { channelSave(); } finally { drawHistoryMuted = false; }
    if (host) reelRepaint(host);
    reelSyncChannelButtons();
  }

  // Duplicate the selected drawing with every measurement intact, dropped a
  // little below the original so the two can be told apart, and select the copy.
  function channelDuplicate(name, host) {
    const d = activeChannel(name);
    const ctx = host && host._reelCtx;
    if (!d || !ctx) return;
    const copy = JSON.parse(JSON.stringify(d));
    delete copy.locked;                      // a fresh copy is there to be moved
    reelShiftDrawing(copy, d, 0, -(ctx.sc.hi - ctx.sc.lo) * 0.08, ctx.b);
    addChannelFor(name, copy);
    reel.editing = name;
    channelSave();
    reelRepaint(host);
    reelSyncChannelButtons();
  }

  // An invisible fat line laid over a drawing's own geometry, so the DRAWING is
  // a tap target. Its visible stroke is 2.6 viewBox units of dotted line — about
  // a millimetre on a phone — which you cannot reliably hit, so before this the
  // only way to choose which drawing Lock/Unlock/Clear acted on was to grab one
  // of its handles. 40 units is ~14px on a phone card.
  function reelHitLine(x1, y1, x2, y2, idx) {
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="reel-ch-hit" data-di="${idx}"/>`;
  }

  // NO lock badge on the chart (user, 2026-09-15). A locked drawing shows it
  // only in the properties row, where its lock button reads as on.

  // Trend line — two anchors, extended across the panel the way the channel's
  // edges are, so it reads as a line you can project rather than a segment.
  function reelTrendSvg(d, b, L, sc, bw, editing, idx, isActive) {
    const i1 = reelBarIndexForDate(b, d.t1), i2 = reelBarIndexForDate(b, d.t2);
    if (i1 == null || i2 == null) return '';
    const xAt = fi => L.x0 + fi * bw + bw / 2;
    let x1 = xAt(i1), x2 = xAt(i2);
    const y1 = sc.y(d.p1), y2 = sc.y(d.p2);
    if (Math.abs(x2 - x1) < 0.5) x2 = x1 + 0.5;
    const slope = (y2 - y1) / (x2 - x1);
    const yAtX = x => y1 + slope * (x - x1);
    const yA = yAtX(L.x0), yB = yAtX(L.x1);
    const panelH = L.py1 - L.py0;
    if (Math.min(yA, yB) > L.py1 + panelH * 0.15 || Math.max(yA, yB) < L.py0 - panelH * 0.15) {
      const above = Math.max(yA, yB) < L.py0;
      return `<text x="${L.x1 - 6}" y="${above ? L.py0 + 34 : L.py1 - 24}" class="reel-clip-tag" text-anchor="end">line ${above ? '↑' : '↓'} off-scale</text>`;
    }
    const line = `<line x1="${L.x0}" y1="${yA.toFixed(1)}" x2="${L.x1}" y2="${yB.toFixed(1)}" class="reel-ch reel-ch-edge"/>`
               + reelHitLine(L.x0, yA, L.x1, yB, idx);
    let handles = '';
    if (editing && !d.locked) {
      handles = reelHandle(L, x1, y1, 'a', idx, isActive) + reelHandle(L, x2, y2, 'b', idx, isActive);
      const mv = reelMoveSpot(L, x1, y1, x2, y2);
      handles += reelMoveHandle(L, mv.x, mv.y, idx, isActive);
      if (!handles) handles = `<text x="${((L.x0 + L.x1) / 2).toFixed(1)}" y="${(L.py0 + 22).toFixed(1)}" class="reel-ch-note" text-anchor="middle">Handles are outside this range — zoom out to adjust</text>`;
    }
    return line + handles;
  }

  // Horizontal price line — one price, spanning the panel. The label sits in
  // the gutter with the axis ticks, because that is where a level is read.
  function reelHLineSvg(d, b, L, sc, bw, editing, idx, isActive) {
    const y = sc.y(d.p);
    const panelH = L.py1 - L.py0;
    if (y > L.py1 + panelH * 0.15 || y < L.py0 - panelH * 0.15) {
      const above = y < L.py0;
      return `<text x="${L.x1 - 6}" y="${above ? L.py0 + 34 : L.py1 - 24}" class="reel-clip-tag" text-anchor="end">level ${above ? '↑' : '↓'} off-scale</text>`;
    }
    const line = `<line x1="${L.x0}" y1="${y.toFixed(1)}" x2="${L.x1}" y2="${y.toFixed(1)}" class="reel-ch reel-ch-edge${d.bold ? ' is-bold' : ''}"/>`
               + reelHitLine(L.x0, y, L.x1, y, idx);
    const tag  = `<text x="${L.gut}" y="${(y + 6).toFixed(1)}" class="reel-axis reel-ch-lvl">${reelFmtPrice(d.p)}</text>`;
    const handles = (editing && !d.locked)
      ? reelHandle(L, L.x0 + (L.x1 - L.x0) * 0.5, y, 'p', idx, isActive) : '';
    return line + tag + handles;
  }

  // A vertical line on one bar (user, 2026-09-19). Stored as a DATE, so it
  // lands on the same moment on every timeframe; the date is printed at the
  // top of the line. One handle, halfway down, drags it sideways bar by bar.
  function reelVLineSvg(d, b, L, sc, bw, editing, idx, isActive) {
    const fi = reelBarIndexForDate(b, d.t);
    if (fi == null) return '';
    const x = L.x0 + fi * bw + bw / 2;
    if (x < L.x0 || x > L.x1) {
      const left = x < L.x0;
      return `<text x="${left ? L.x0 + 6 : L.x1 - 6}" y="${L.py0 + 58}" class="reel-clip-tag" text-anchor="${left ? 'start' : 'end'}">line ${left ? '←' : '→'} off-screen</text>`;
    }
    const line = `<line x1="${x.toFixed(1)}" y1="${L.py0}" x2="${x.toFixed(1)}" y2="${L.py1}" class="reel-ch reel-ch-edge${d.bold ? ' is-bold' : ''}"/>`
               + reelHitLine(x, L.py0, x, L.py1, idx);
    const nearRight = x > L.x1 - (L.x1 - L.x0) * 0.2;
    const tag = `<text x="${(x + (nearRight ? -8 : 8)).toFixed(1)}" y="${(L.py0 + 20).toFixed(1)}" class="reel-axis reel-ch-lvl" text-anchor="${nearRight ? 'end' : 'start'}">${reelEndStopLabel(d.t)}</text>`;
    const handles = (editing && !d.locked)
      ? reelHandle(L, x, L.py0 + (L.py1 - L.py0) * 0.5, 't', idx, isActive) : '';
    return line + tag + handles;
  }

  // Ten price lines — dotted like the calendar lines, always evenly spaced,
  // adjusted from line 1 and line 4. Each line is numbered and priced at the
  // right-hand end of the plot, clear of the axis ticks in the gutter.
  function reelLadderSvg(d, b, L, sc, bw, editing, idx, isActive) {
    const step = (d.p4 - d.p1) / 3;
    if (!isFinite(step) || step === 0) return '';
    let out = '', drawn = 0;
    for (let k = 0; k < LADDER_LINES; k++) {
      const p = d.p1 + k * step, y = sc.y(p);
      if (y < L.py0 || y > L.py1) continue;
      // The two ENDS of the ladder are the bold lines, matching their bold 10%
      // and 100% labels (user, 2026-09-15). Line 4 used to be heavy because it
      // carries a handle; the handle marks it well enough on its own.
      const key = k === 0 || k === LADDER_LINES - 1;
      out += `<line x1="${L.x0}" y1="${y.toFixed(1)}" x2="${L.x1}" y2="${y.toFixed(1)}" class="reel-ladder${key ? ' reel-ladder-key' : ''}"/>`
           + reelHitLine(L.x0, y, L.x1, y, idx)
           // LEFT end, as a percentage of the ladder — 10% on line 1 up to 100%
           // on line 10 (user, 2026-09-15). The price used to sit at the right
           // end, where it crowded the axis it duplicated.
           + (d.hideLabels ? '' : `<text x="${(L.x0 + 8).toFixed(1)}" y="${(y - 7).toFixed(1)}" class="reel-ladder-lbl${k === 0 || k === LADDER_LINES - 1 ? ' reel-ladder-lbl-end' : ''}">${(k + 1) * 10}%</text>`);
      drawn++;
    }
    if (!drawn) {
      const above = Math.max(sc.y(d.p1), sc.y(d.p1 + 9 * step)) < L.py0;
      return `<text x="${L.x1 - 6}" y="${above ? L.py0 + 34 : L.py1 - 24}" class="reel-clip-tag" text-anchor="end">10 lines ${above ? '↑' : '↓'} off-scale</text>`;
    }
    let handles = '';
    if (editing && !d.locked) {
      const hx = L.x0 + (L.x1 - L.x0) * 0.35;
      const y1 = sc.y(d.p1), y4 = sc.y(d.p4);
      if (y1 >= L.py0 && y1 <= L.py1) handles += reelHandle(L, hx, y1, 'l1', idx, isActive);
      if (y4 >= L.py0 && y4 <= L.py1) handles += reelHandle(L, hx, y4, 'l4', idx, isActive);
      const ym = sc.y(d.p1 + 4 * step);
      if (ym >= L.py0 && ym <= L.py1) handles += reelMoveHandle(L, L.x0 + (L.x1 - L.x0) * 0.65, ym, idx, isActive);
      if (!handles) handles = `<text x="${((L.x0 + L.x1) / 2).toFixed(1)}" y="${(L.py0 + 22).toFixed(1)}" class="reel-ch-note" text-anchor="middle">Lines 1 and 4 are outside this range — zoom out to adjust</text>`;
    }
    return out + handles;
  }

  // Entry marker (2026-09-15). A SHORT solid line from the entry candle to a
  // chosen end, with a see-through × on the candle itself. Two handles: the
  // × moves the whole marker (it snaps to a bar, the price follows the finger),
  // and the far end makes the line longer or shorter. Colour and bold come
  // from the properties row like every other drawing.
  function reelEntrySvg(d, b, L, sc, bw, editing, idx, isActive) {
    const i1 = reelBarIndexForDate(b, d.t), i2 = reelBarIndexForDate(b, d.t2);
    if (i1 == null || i2 == null) return '';
    const xAt = fi => L.x0 + fi * bw + bw / 2;
    const x1 = xAt(i1), x2 = Math.max(xAt(i2), x1 + 2);
    const y = sc.y(d.p);
    if (y < L.py0 - 20 || y > L.py1 + 20 || x2 < L.x0 || x1 > L.x1) return '';
    const cls = 'reel-entry' + (d.bold ? ' is-bold' : '');
    const r = d.bold ? 13 : 10;   // half-size of the ×
    const line = `<line x1="${x1.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y.toFixed(1)}" class="${cls}"/>`;
    const cross = `<path d="M${(x1 - r).toFixed(1)} ${(y - r).toFixed(1)}L${(x1 + r).toFixed(1)} ${(y + r).toFixed(1)}M${(x1 + r).toFixed(1)} ${(y - r).toFixed(1)}L${(x1 - r).toFixed(1)} ${(y + r).toFixed(1)}" class="${cls} reel-entry-x"/>`;
    const hit = reelHitLine(x1 - r, y, x2, y, idx);
    let handles = '';
    if (editing && !d.locked) {
      handles = reelHandle(L, x1, y, 'e', idx, isActive) + reelHandle(L, x2, y, 'r', idx, isActive);
    }
    return line + cross + hit + handles;
  }

  function reelChannelSvg(ch, b, L, sc, bw, editing, idx, isActive) {
    if (!ch) return '';
    const i1 = reelBarIndexForDate(b, ch.t1);
    const i2 = reelBarIndexForDate(b, ch.t2);
    if (i1 == null || i2 == null) return '';
    const xAt = fi => L.x0 + fi * bw + bw / 2;
    let x1 = xAt(i1), x2 = xAt(i2);
    const y1 = sc.y(ch.p1), y2 = sc.y(ch.p2);
    if (Math.abs(x2 - x1) < 0.5) x2 = x1 + 0.5;    // guard a vertical midline
    const slope = (y2 - y1) / (x2 - x1);
    const yAtX  = x => y1 + slope * (x - x1);
    // The price scale is linear, so a price offset is a CONSTANT pixel offset —
    // the edges stay parallel without recomputing per x. Each edge gets its own
    // because each moves on its own.
    const dUp  = sc.y(ch.p1 + ch.up) - sc.y(ch.p1);   // negative: up the screen
    const dDn  = sc.y(ch.p1 + ch.dn) - sc.y(ch.p1);   // positive: down
    const dMid = (dUp + dDn) / 2;                     // halfway, by measurement

    // A channel normally spans the whole panel — a projection is what it is for.
    // A SEEDED one is bounded instead (`clipL` / `clipR`, set by
    // reelChannelForLeg): two auto-placed channels at full width put six long
    // dotted lines across the price in the same ink as the ribbon, and the user's
    // report was exactly that — "the trend covers all the MAs and price". Bounded,
    // each one sits over the leg it describes. Seeds stopped setting the flags
    // on 2026-09-18 (the user wants them extended); the clip stays for any
    // channel stored with them.
    const xLegL = Math.min(x1, x2), xLegR = Math.max(x1, x2);
    let XA = ch.clipL ? Math.max(L.x0, xLegL) : L.x0;
    let XB = ch.clipR ? Math.min(L.x1, xLegR) : L.x1;
    if (!(XB - XA > 1)) { XA = L.x0; XB = L.x1; }     // degenerate: draw it all
    const yA = yAtX(XA), yB = yAtX(XB);

    // Off-scale guard. A channel drawn on Weekly, seen on 1H, is being
    // PROJECTED forward months past its anchors — legitimately, that is what a
    // trend channel is for — but if price has since left the projection the
    // lines land far outside the panel and there is nothing to see. Rather
    // than draw invisible geometry, say where it went, the way the clipped
    // ribbon already does.
    const panelH = L.py1 - L.py0;
    const lo = Math.min(yA + dUp, yB + dUp, yA + dDn, yB + dDn);
    const hi = Math.max(yA + dUp, yB + dUp, yA + dDn, yB + dDn);
    if (lo > L.py1 + panelH * 0.15 || hi < L.py0 - panelH * 0.15) {
      const above = hi < L.py0;
      return `<text x="${L.x1 - 6}" y="${above ? L.py0 + 34 : L.py1 - 24}" class="reel-clip-tag" text-anchor="end">channel ${above ? '↑' : '↓'} off-scale</text>`;
    }
    const seg = (off, cls) =>
      `<line x1="${XA.toFixed(1)}" y1="${(yA + off).toFixed(1)}" x2="${XB.toFixed(1)}" y2="${(yB + off).toFixed(1)}" class="${cls}"/>`;

    const band = `<polygon class="reel-ch-band" points="${XA.toFixed(1)},${(yA + dUp).toFixed(1)} ${XB.toFixed(1)},${(yB + dUp).toFixed(1)} ${XB.toFixed(1)},${(yB + dDn).toFixed(1)} ${XA.toFixed(1)},${(yA + dDn).toFixed(1)}"/>`;

    let handles = '';
    if (editing && !ch.locked) {
      // TWO circles per handle. The viewBox is 1000 wide against a ~370px card,
      // so a unit is about a third of a pixel: the r=13 dot that looks right is
      // a 9px target, which is half a fingertip. The invisible r=42 circle over
      // it is ~30px — an actual thumb — and carries the same data-h, so the hit
      // test does not care which one you land on.
      // data-ci carries WHICH channel the handle belongs to, so one pointer
      // handler serves any number of them.
      const hcls = isActive ? 'reel-ch-h' : 'reel-ch-h is-idle';
      const hx = (x, y, id) => (x >= L.x0 - 2 && x <= L.x1 + 2)
        ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" class="${hcls}" data-h="${id}" data-ci="${idx}"/>` +
          `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="42" class="reel-ch-grab" data-h="${id}" data-ci="${idx}"/>`
        : '';
      // Four: both ENDS of the midline, and both EDGES. Each edge moves on its
      // own. The end handles sit ON the midline — the spine is not drawn, and a
      // handle floating on an invisible line is not a thing you can aim at.
      //
      // The END handles are pinned to their dates, so they legitimately go
      // off-screen and you pan to reach them. The EDGE handles are not: their x
      // is arbitrary, and putting them at the midpoint of the two anchors left
      // them unreachable whenever that midpoint fell outside the window — a
      // channel plainly visible on Daily with no way to widen it. They are
      // clamped into the panel instead, so whenever the channel can be seen it
      // can be adjusted.
      const pad = 60;
      const mx = Math.min(Math.max((x1 + x2) / 2, L.x0 + pad), L.x1 - pad);
      const my = yAtX(mx);
      handles = hx(x1, y1 + dMid, 'a') + hx(x2, y2 + dMid, 'b')
              + hx(mx, my + dUp, 'u') + hx(mx, my + dDn, 'd');
      // Move handle on the midline, a step to the side of the edge handles so
      // the three never sit on top of one another in a narrow channel.
      if (handles) {
        const side = (mx + 130 <= L.x1 - 60) ? 130 : -130;
        const mvx = mx + side;
        handles += reelMoveHandle(L, mvx, yAtX(mvx) + dMid, idx, isActive);
      }
      // Zoom in past both anchors and there is nothing left on screen to grab —
      // the channel still draws in the right place (it is anchored to dates and
      // prices, not to the window), it just cannot be adjusted from here. Say
      // which control brings the handles back rather than leaving it a puzzle.
      if (!handles) {
        handles = `<text x="${((L.x0 + L.x1) / 2).toFixed(1)}" y="${(L.py0 + 22).toFixed(1)}" class="reel-ch-note" text-anchor="middle">Handles are outside this range — zoom out to adjust</text>`;
      }
    }

    // A locked channel says so on the chart, so "why will this not move" has an
    // answer without hunting through the footer.

    return band
      + seg(dUp,  'reel-ch reel-ch-edge')
      + seg(dDn,  'reel-ch reel-ch-edge')
      + seg(dMid, 'reel-ch reel-ch-mid')
      // Tap targets over all three lines, so a channel can be made the active
      // drawing by touching any part of it rather than only its handles.
      + reelHitLine(XA, yA + dUp,  XB, yB + dUp,  idx)
      + reelHitLine(XA, yA + dDn,  XB, yB + dDn,  idx)
      + reelHitLine(XA, yA + dMid, XB, yB + dMid, idx)
      + handles;
  }

  // Vertical time lines. Calendar boundaries, not evenly-spaced ticks: a line
  // every N bars tells you nothing, whereas "this is where 2025 started" is a
  // fact you navigate by. Which boundary depends on how much calendar the
  // timeframe shows — a year line on a 1H chart covering six weeks would never
  // appear, and quarter lines on a Weekly chart covering ten years would be a
  // picket fence. So: years on D, half-years on 1H / 4H, MONTHS on 10m.
  //
  // 10m is MONTHS, at the user's call (2026-09-14, and again 2026-09-19 over
  // the day grid that replaced it on 09-17). Since 2026-09-19 the card opens on
  // a whole calendar month (reelDefaultBars), so a month line is on screen at
  // the 1st every time. Day lines are gone rather than kept faint underneath.
  //
  // The window's own first and last bars stay as end-stops (see the axis code)
  // for a range that crosses no boundary at all — which on 10m is most windows,
  // so on 10m the end-stops carry the day, the month and the time.
  //
  // Label collisions are handled in the caller, which is the only place that
  // knows where a line lands in x.
  //
  // 3D and Weekly are OFF at the user's request (2026-09-08). Those charts span
  // six and ten years, so a year line lands every few centimetres and the grid
  // stops being a reference and starts being a fence across the price. A
  // timeframe absent from this table draws no lines at all, and its window's
  // first and last dates come back as the axis instead.
  // 4H is HALVES since 2026-09-19 (user request): the year cut into two equal
  // parts, where it was four. Same construction as before, one parameter.
  const REEL_TIME_GRID = { '10m': 'month', '1H': 'half', '4H': 'half',
                           'D': 'year', '3D': 'admin', 'W': 'admin' };

  // How many equal parts a 'half'-mode year is cut into.
  const REEL_YEAR_PARTS = 2;

  // US administrations, by inauguration day. On the slow timeframes one screen
  // is four years (3D) to ten (W), and on that scale the calendar year is a
  // fence every few centimetres that marks nothing — which is why the year grid
  // was taken off 3D and Weekly in the first place. A change of administration
  // is a regime boundary a swing trader actually reads a chart against, so that
  // is what those two get instead.
  //
  // The last entry is the END of the current term, not the start of a named
  // one: who takes office in 2029 is not known, and a line that pretends to
  // know would be worse than no line.
  const REEL_ADMIN_TERMS = [
    { date: '2017-01-20', label: 'Trump I' },
    { date: '2021-01-20', label: 'Biden' },
    { date: '2025-01-20', label: 'Trump II' },
    { date: '2029-01-20', label: 'Trump II ends' },
  ];

  // How many years past the last bar to keep drawing year lines for. The window
  // holds empty space to the right and pans further into it, and a channel
  // projected into that space is unreadable without a date against it.
  const REEL_FUTURE_YEARS = 4;

  // Same idea one scale down, for the 10m grid: how many MONTH boundaries past
  // the last bar to project. Two, so the next month's line is there when the
  // window is zoomed out far enough to reach it; the ones that land off the
  // panel are dropped by the x-clamp. They sit at UTC midnight on the 1st,
  // which on a session-bound instrument is a few bars before the session that
  // opens the month — a date reference, not a bar that exists.
  const REEL_FUTURE_MONTHS = 2;

  // The axis end-stop: the window's own first and last bar, used when the grid
  // crossed too few boundaries to be the axis by itself. A DATE alone is the
  // right answer on every timeframe whose bar is a day or longer — and the wrong
  // one on 10m, where 120 bars is under a day on a 24h instrument: both ends
  // then read "2026-09-16" and the axis says nothing at all. Intraday gets the
  // time, which is the part that actually varies inside such a window, and the
  // month — with month-only grid lines the end-stops are usually the only date
  // on a 10m chart ("Thu 17 Sept 14:30").
  function reelEndStopLabel(ts) {
    const str = String(ts);
    if (timeframe !== '10m') return str.slice(0, 10);
    const hm = str.slice(11, 16);
    return hm ? reelDayLabel(str) + ' ' + hm : str.slice(0, 10);
  }

  // "Jan 2026" / "Jul 2026" — a year-part line's label. The MONTH is the name,
  // not "H2" or "Q3": the line marks one of the equal parts the year is cut
  // into, and the month it starts on is the thing you read a date against.
  function reelYearPartLabel(y, k, parts) {
    const d = new Date(Date.UTC(y, k * 12 / parts, 1));
    return isNaN(d) ? String(y)
      : d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) + ' ' + y;
  }

  // "1 Sep" — a month line's label, on the first bar the new month traded.
  function reelMonthStartLabel(ts) {
    const d = new Date(String(ts).slice(0, 10) + 'T00:00:00Z');
    return isNaN(d) ? String(ts).slice(0, 7)
      : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  // "Tue 16 Sept" — the 10m end-stop's date. The weekday earns its width on an
  // intraday chart: it is what tells you at a glance which gap is a weekend and
  // which is just a night.
  function reelDayLabel(ts) {
    const d = new Date(String(ts).slice(0, 10) + 'T00:00:00Z');
    return isNaN(d) ? String(ts).slice(5, 10)
      : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  function reelTimeGrid(b, tf) {
    const mode = REEL_TIME_GRID[tf];
    const n = b.t ? b.t.length : 0;
    if (!mode || !n) return [];

    // ── The half grid: A YEAR CUT INTO EQUAL PARTS (REEL_YEAR_PARTS) ──────
    // Two since 2026-09-19; it was four (quarters) from 2026-09-18.
    // Not the calendar's quarters. Those cannot land evenly however the bars are
    // fixed: Q1 is 90 days with three US market holidays in it and Q4 is 92 with
    // two, so on a bar-indexed axis they differ by several percent and the eye
    // reads that as a mistake. This takes the two year boundaries around each
    // year, measures the distance between them IN BARS, and drops three lines at
    // the exact quarter points of it — so every gap inside a year is identical by
    // construction, and the year lines themselves still sit on 1 January.
    //
    // A line is therefore within a day or two of the calendar quarter rather than
    // on it, which is the trade the user asked for (2026-09-18) and is why the
    // labels name the MONTH the line falls in rather than claiming "Q2".
    //
    // Measured off the WHOLE bundle, not the visible slice, so panning cannot
    // move a line; `from` maps it back onto the slice being drawn. The projection
    // past the last bar uses the bundle's average ms/bar for the reason the day
    // grid does — reelBarIndexForDate reads the last ten bars, which on a 4H
    // frame are four hours apart, and would project as though the market never
    // closed.
    if (mode === 'half') {
      const src = b._src || b, from = b._from || 0, sn = src.t.length;
      if (sn < 2) return [];
      const bt = reelBarTimes(src);
      const perMs = (bt[sn - 1] - bt[0]) / (sn - 1);
      if (!(perMs > 0)) return [];
      const idxForMs = ms => {
        if (ms <= bt[0])      return (ms - bt[0]) / perMs - from;
        if (ms >= bt[sn - 1]) return (sn - 1) + (ms - bt[sn - 1]) / perMs - from;
        let lo = 0, hi = sn - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (bt[mid] <= ms) lo = mid; else hi = mid; }
        const span = bt[hi] - bt[lo];
        return lo + (span ? (ms - bt[lo]) / span : 0) - from;
      };
      const y0 = new Date(bt[0]).getUTCFullYear();
      const y1 = new Date(bt[sn - 1]).getUTCFullYear() + 1;   // +1 covers the blank space
      const lastFi = (sn - 1) - from;
      const out = [];
      for (let y = y0; y <= y1; y++) {
        const a = idxForMs(Date.UTC(y, 0, 1)), z = idxForMs(Date.UTC(y + 1, 0, 1));
        if (!isFinite(a) || !isFinite(z) || z <= a) continue;
        for (let k = 0; k < REEL_YEAR_PARTS; k++) {
          const fi = a + k * (z - a) / REEL_YEAR_PARTS;
          out.push({ fi, label: reelYearPartLabel(y, k, REEL_YEAR_PARTS), future: fi > lastFi });
        }
      }
      return out;
    }

    // Administration boundaries are DATES, not bars — most of them fall on a
    // weekend or a holiday and so are not a bar at all. reelBarIndexForDate
    // interpolates between the bars either side and extrapolates past the last
    // one, which is what puts the 2029 line out in the empty space.
    if (mode === 'admin') {
      return REEL_ADMIN_TERMS
        .map(t => {
          const fi = reelBarIndexForDate(b, t.date);
          return fi == null ? null : { fi, label: t.label, admin: true };
        })
        .filter(Boolean);
    }

    const out  = [];
    let prev = null;
    for (let i = 0; i < n; i++) {
      const str = String(b.t[i]);
      const y = +str.slice(0, 4), m = +str.slice(5, 7);
      if (!y || !m) continue;
      const key = mode === 'month' ? str.slice(0, 7) : String(y);
      // The FIRST bar of the new period is the boundary. i===0 is skipped: the
      // left edge is not a crossing, it is just where the window happens to start.
      if (prev !== null && key !== prev.key) {
        // A month line sits on the first bar the new month traded, labelled
        // "1 Sep" — or "2 Sep" when the 1st was not a trading day, because it
        // names the bar the line is on.
        const month = mode === 'month';
        out.push({ fi: i, month, label: month ? reelMonthStartLabel(str) : String(y) });
      }
      prev = { key };
    }

    // The month the chart has not reached yet, projected into the blank space to
    // the right (REEL_FUTURE_FRAC allows 0.9 of a window of it).
    //
    // NB this does NOT use reelBarIndexForDate. That extrapolates from the
    // spacing of the LAST TEN BARS, which on an intraday frame is ten minutes
    // apart — it therefore projects as though the market traded around the
    // clock and put the next month boundary 2,343 bars past the last bar on
    // AAPL, against a reachable 702. The line existed and could never be
    // scrolled to. Averaged over the WHOLE bundle a bar is 53.3 minutes of
    // calendar time on AAPL (overnight gaps and weekends included) and the same
    // boundary lands 440 bars out, which is reachable — while on BTC, which
    // really does trade around the clock, the two agree at 10.0 min/bar. That
    // is the whole difference: a session-bound instrument's bars represent far
    // more calendar time than their own spacing suggests.
    // Both projections below measure off the WHOLE bundle (b._src), not the
    // visible slice, so a pan cannot move a future line.
    const src = b._src || b, from = b._from || 0, sn = src.t.length;
    if (mode === 'month') {
      const bt    = reelBarTimes(src);
      const perMs = sn > 1 ? (bt[sn - 1] - bt[0]) / (sn - 1) : 0;
      const last  = new Date(bt[sn - 1]);
      if (perMs > 0 && !isNaN(last)) {
        for (let k = 1; k <= REEL_FUTURE_MONTHS; k++) {
          const d  = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + k, 1));
          const fi = (sn - 1) + (d.getTime() - bt[sn - 1]) / perMs - from;
          if (!isFinite(fi)) continue;
          out.push({ fi, future: true, month: true, label: reelMonthStartLabel(d.toISOString()) });
        }
      }
    }

    // Years the chart has not reached yet — 2027, 2028 and so on. There are no
    // bars there, so these are projected from the spacing of the last ten and
    // dropped by the x-clamp when they fall off the panel.
    if (mode === 'year') {
      const lastY = +String(src.t[sn - 1]).slice(0, 4);
      for (let y = lastY + 1; y <= lastY + REEL_FUTURE_YEARS; y++) {
        const fi = reelBarIndexForDate(b, y + '-01-01');
        if (fi != null) out.push({ fi, label: String(y), future: true });
      }
    }
    return out;
  }

  // ── Trend strip (2026-09-11, approved from the AVGO preview) ─────────────
  // A thin bar under the price: green while the established trend is up, red
  // while it is down, lighter on bars where price sat on the wrong side of the
  // fast average — a pullback inside the trend. It says how long a trend has
  // run, never which way the next move goes. It reads the Trends tab's DAILY
  // segment history, which is kept in dates — so it maps onto any timeframe's
  // bars by date.
  //
  // EVERY TIMEFRAME since 2026-09-15. It was Daily-only, and the plot still
  // reserves the strip's band on every timeframe, so flicking 10m → Daily → 3D
  // showed a strip, then an empty gap, then a strip: "there and not there".
  // Off Daily it is labelled as the DAILY trend, because that is what it is;
  // the lighter pullback shading still uses the chart's own fast average.
  function reelTrendStripSvg(b, L, xOf, bw, item, bundle) {
    const n = b.c.length;
    if (!n || L.stripY == null) return '';
    const day = s => String(s).slice(0, 10);
    const longDate = d => new Date(d + 'T00:00:00Z')
      .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    const segs = trendsData[item.instrument_name] || [];            // newest first
    if (!segs.length) return '';
    const dirAt = t => {
      const d = day(t);
      if (segs[0].end && d > segs[0].end) return segs[0].direction;
      for (const g of segs) if (g.start <= d && (!g.end || d <= g.end)) return g.direction;
      return '';
    };
    const curDir = segs[0].direction;
    const since  = segs[0].start;
    if (curDir !== 'UPTREND' && curDir !== 'DOWNTREND') return '';

    // Fast average at every bar. The ribbon ships sampled every b.ms bars, so
    // interpolate between samples — close enough to shade a pullback.
    const mi = b.mi || b.m[0].map((_, j) => Math.min(j * (b.ms || 1), n - 1));
    const fastSeries = b.m[0] || [];
    const fast = new Array(n).fill(null);
    for (let j = 0, i = 0; i < n; i++) {
      while (j + 1 < mi.length && mi[j + 1] <= i) j++;
      const a = fastSeries[j], c = fastSeries[j + 1];
      if (a == null || mi[j] > i) continue;
      fast[i] = (c != null && j + 1 < mi.length && mi[j + 1] > mi[j])
        ? a + (c - a) * (i - mi[j]) / (mi[j + 1] - mi[j]) : a;
    }
    const keyAt = i => {
      const d = dirAt(b.t[i]);
      if (d !== 'UPTREND' && d !== 'DOWNTREND') return '';
      const f = fast[i], c = b.c[i];
      const pull = f != null && c != null && (d === 'UPTREND' ? c < f : c > f);
      return d + (pull ? ':p' : ':s');
    };
    let out = '', key = '', start = 0;
    const flush = end => {
      if (!key) return;
      const [d, s] = key.split(':');
      out += `<rect x="${(xOf(start) - bw / 2).toFixed(1)}" y="${L.stripY}" width="${((end - start) * bw).toFixed(1)}" height="14" `
           + `fill="${d === 'UPTREND' ? 'var(--buy)' : 'var(--sell)'}" fill-opacity="${s === 'p' ? .28 : .8}"/>`;
    };
    for (let i = 0; i < n; i++) {
      const k = keyAt(i);
      if (k !== key) { flush(i); key = k; start = i; }
    }
    flush(n);
    if (!out) return '';
    const word = (timeframe === 'D' ? '' : 'Daily ') + (curDir === 'UPTREND' ? 'uptrend' : 'downtrend');
    const legend = `lighter = ${curDir === 'UPTREND' ? 'below' : 'above'} MA${b.p[0]}`;
    const Word = word.charAt(0).toUpperCase() + word.slice(1);
    const text = since ? `${Word} since ${longDate(since)} · ${legend}` : legend;
    return out + `<text x="${L.x0 + 4}" y="${L.stripY - 5}" class="reel-strip-lbl">${text}</text>`;
  }

  // Build the whole chart as one SVG string.
  function reelChartSvg(bundle, item, host) {
    // The window is a fixed number of SLOTS. Panning forward past the newest bar
    // fills the tail of it with nothing rather than making the bars wider, so
    // bar width — the thing that makes a chart look zoomed — never changes.
    const _winBars = reelWindowBars(bundle, item.instrument_name);
    const _pan     = reelPanOf(item.instrument_name);
    const _future  = Math.max(0, -_pan);
    const b  = reelSlice(bundle, Math.max(2, _winBars - _future), Math.max(0, _pan));
    const L  = reelLayout(host);
    // Price scale. It fits the visible slice, EXCEPT while this card is being
    // panned: then it is pinned to the bounds captured when the drag began, so
    // scrolling back through history does not re-fit the axis under the reader.
    // Re-fitting is what made a sideways drag look like a zoom — the bars kept
    // their x and changed their y. Double-tap restores the fit.
    const sc = reelScale(b, L, reel.lockY.get(item.instrument_name));
    if (!sc) return '<div class="reel-nodata">No price data</div>';

    const n  = b.c.length;
    // Leave a margin of empty bars between the last bar and the price axis,
    // the way a real chart does — price pinned to the scale is hard to read,
    // and the ribbon needs somewhere to run to.
    const bw = (L.x1 - L.x0) / (_winBars + reelRightPadBars(_winBars));
    const xOf = i => L.x0 + i * bw + bw / 2;

    // ── Price axis ──
    // LABELS ONLY since 2026-09-11. The horizontal gridlines that used to run
    // across the panel at the round numbers are gone at the user's request:
    // reelTicks re-picks its levels every time the price window changes, so
    // panning or zooming made lines appear and disappear under the price —
    // movement that reads as the chart doing something when nothing happened.
    // The numbers still sit in the gutter, which is where a level is read.
    const ticks = reelTicks(sc.lo, sc.hi, L.H > 700 ? 8 : 6);
    const grid = ticks.map(v =>
      `<text x="${L.gut}" y="${(sc.y(v) + 6).toFixed(1)}" class="reel-axis">${reelFmtPrice(v)}</text>`
    ).join('');

    // ── MA ribbon ──
    // Dotted, and each line coloured by its OWN slope: falling red, rising
    // neutral. That colouring is the trend read — a ribbon that has rolled
    // over goes red from the fast edge inward, and you see it without reading
    // a single label. Split into runs of constant direction so each run is one
    // polyline; the MAs are smooth, so there are only a handful of runs each.
    // Three lines since 2026-09-09: MA50, MA250, MA500.
    //
    // Points are sampled every b.ms bars (chart_feed decimates the ribbon);
    // b.mi carries the bar index of each sample so the x mapping stays exact.
    const nMa  = b.p.length;
    const mIdx = b.mi || b.m[0].map((_, j) => Math.min(j * (b.ms || 1), n - 1));

    // The three MAs the signal rules actually name — the fast edge (MA50, where
    // B2/S2 fire), mid-ribbon (MA250, B3/S3) and the anchor (MA500, B4/S4).
    // Since 2026-09-09 those three ARE the ribbon, so all three draw heavy.
    //
    // Picked by POSITION, not by the number: a 4H ribbon on a session-
    // normalised instrument has its periods scaled (see _h4_ma_periods), and a
    // short-history instrument has the tail of the ribbon truncated, so
    // `period === 250` is not a test that survives either case. Mid-ribbon is
    // whichever period sits closest to half the slowest one.
    const slowest = b.p[nMa - 1];
    let midIdx = 0, midGap = Infinity;
    for (let k = 0; k < nMa; k++) {
      const gap = Math.abs(b.p[k] - slowest / 2);
      if (gap < midGap) { midGap = gap; midIdx = k; }
    }

    let ribbon = '';
    for (let k = nMa - 1; k >= 0; k--) {          // slowest first, fast on top
      const series = b.m[k];
      const isAnchor = k === nMa - 1;
      const isKey    = isAnchor || k === 0 || k === midIdx;
      // Weights raised 2026-09-09 with the cut to three lines. 3.4 / 1.9 was
      // sized to keep three named lines findable inside twenty; with nothing
      // else on the panel the dots can carry real weight, and the slope colour
      // — the actual trend read — is only legible once they do.
      // Sized against the PHONE render, which is where these are actually
      // read: the reel card is ~370pt wide, so a weight that looks ample in a
      // desktop viewport still comes out hairline on the device.
      //
      // All three lines carry the SAME weight, deliberately. An earlier pass
      // tapered them (anchor heaviest, fast edge lightest) to keep a sense of
      // depth, but with only three lines the taper just made the fast edge —
      // the one B2/S2 actually fire on — the hardest of the three to see. The
      // period labels and the slope colour carry the distinction instead.
      // The 2.4 branch is dead on a 3-MA ribbon (all three are 'key'); it
      // survives for a wider ribbon, should one ever come back.
      const wid  = isKey ? 7.0 : 2.4;
      const dash = isKey ? `${wid * 0.46} ${wid * 1.7}` : `${wid * 0.6} ${wid * 2.4}`;

      let run = [], runDown = null;
      const flush = () => {
        if (run.length >= 2) {
          const col = runDown ? 'var(--sell)' : 'var(--reel-ma-up)';
          ribbon += `<polyline points="${run.join(' ')}" fill="none" stroke="${col}" stroke-width="${wid}" stroke-opacity="${isKey ? .95 : .8}" stroke-linecap="round" stroke-dasharray="${dash}"/>`;
        }
        run = [];
      };

      let prev = null;
      for (let j = 0; j < series.length; j++) {
        const v = series[j];
        if (v == null) { flush(); prev = null; runDown = null; continue; }
        const pt = xOf(mIdx[j]).toFixed(1) + ',' + sc.y(v).toFixed(1);
        if (prev == null) { run = [pt]; prev = v; continue; }
        const down = v < prev;
        if (runDown === null) runDown = down;
        else if (down !== runDown) {
          // Direction flipped: close the run at this point, reopen from it so
          // the line has no gap where the colour changes.
          run.push(pt); flush(); run = [pt]; runDown = down;
          prev = v; continue;
        }
        run.push(pt);
        prev = v;
      }
      flush();
    }

    // ── OHLC bars ──
    // One neutral colour. Direction is the ribbon's job here, not the bars'.
    // Price has to stay findable against the ribbon, so the bars keep a
    // minimum weight even when 520 of them share the width.
    // ONE path, not three <line> elements per bar. Every bar shares a colour
    // and a stroke width, so there is nothing to gain from separate elements
    // and a great deal to lose: at 520 bars that was ~1,560 DOM nodes and
    // ~168 KB of markup, rebuilt from scratch on EVERY frame of a drag.
    // Measured on the live app: 14 ms median just to re-parse it, 35 ms at the
    // tail, against a 16.7 ms frame budget — so a drag could not hold 60fps on
    // a desktop, let alone a phone. That is the whole of the "not smooth".
    //
    // V and H (vertical/horizontal lineto) keep the path data short: a bar is
    // "M x yh V yl M x-t yo H x M x yc H x+t" and carries no attributes at all.
    const tick = Math.max(1.1, Math.min(bw * 0.4, 4));
    const bwid = Math.max(0.9, Math.min(bw * 0.24, 1.8));
    const seg = [];
    for (let i = 0; i < n; i++) {
      const o = b.o[i], h = b.h[i], l = b.l[i], c = b.c[i];
      if (c == null) continue;
      const x = +xOf(i).toFixed(1);
      if (h != null && l != null && h !== l) {
        seg.push('M', x, ' ', sc.y(h).toFixed(1), 'V', sc.y(l).toFixed(1));
      }
      if (o != null) {
        const yo = sc.y(o).toFixed(1);
        seg.push('M', (x - tick).toFixed(1), ' ', yo, 'H', x);
      }
      const yc = sc.y(c).toFixed(1);
      seg.push('M', x, ' ', yc, 'H', (x + tick).toFixed(1));
    }
    const bars = seg.length
      ? `<path d="${seg.join('')}" fill="none" stroke="var(--reel-bar)" stroke-width="${bwid}"/>`
      : '';

    // ── Last-signal marker ── REMOVED 2026-09-09.
    // The arrow and its code used to sit on the bar the signal fired on. The
    // card header already carries the signal chip, and on a chart zoomed in to
    // ten bars the marker covered the very price action it was pointing at.
    // Nothing here recomputes fires, so nothing is lost but the drawing.

    // ── Last price ──
    const last = b.c[n - 1];
    const lastY = sc.y(last);
    const lastTag =
      // Heavier since 2026-09-15 ("make the price line more visible"): a 1-unit
      // 2/4 dash at 80% was a faint dotted thread on the white ground. The line
      // takes a DEEPER amber than the tag: the app's accent is chosen for a
      // black background and all but disappears as a thin stroke on white.
      // Thin again (user, same day: "don't make the price line bold") — kept
      // at full strength in the deeper amber, which is what makes it findable.
      `<line x1="${L.x0}" y1="${lastY.toFixed(1)}" x2="${L.x1}" y2="${lastY.toFixed(1)}" stroke="#d99a00" stroke-width="1.6" stroke-dasharray="6 5" stroke-opacity="1"/>` +
      `<rect x="${L.x1 + 2}" y="${(lastY - 16).toFixed(1)}" width="${L.W - L.x1 - 4}" height="32" rx="4" fill="var(--accent)"/>` +
      `<text x="${(L.W - 8).toFixed(1)}" y="${(lastY + 8).toFixed(1)}" class="reel-axis reel-axis-last">${reelFmtPrice(last)}</text>`;

    // Clipped-ribbon tag — says which way the ribbon ran off and by how much,
    // so a capped scale never silently hides where the anchor is.
    let clipTag = '';
    if (sc.clipped) {
      const above = sc.maHi > sc.hi;
      const dist  = above ? (sc.maHi / last - 1) : (sc.maLo / last - 1);
      clipTag = `<text x="${L.x1 - 6}" y="${above ? L.py0 + 16 : L.py1 - 6}" class="reel-clip-tag" text-anchor="end">ribbon ${above ? '↑' : '↓'} ${Math.abs(dist * 100).toFixed(0)}%</text>`;
    }

    // ── Time lines + date labels ──
    // The boundary lines carry their own labels; the window's own first and
    // last dates stay as end-stops so the axis is never blank on a range that
    // happens to cross no boundary at all.
    const tg = reelTimeGrid(b, timeframe);
    // Every boundary gets its LINE; labels are thinned so they cannot overlap.
    // On the slow timeframes a boundary is rare enough that this never fires,
    // but 10m crosses a session every ~39 bars, so zoomed out its labels would
    // print on top of one another — one unreadable smear where the dates should
    // be. The line is the navigation aid and is always drawn; the label is the
    // annotation and is dropped when there is no room for it. LABEL_MIN_GAP is
    // in viewBox units, where the panel is ~880 wide and a "8 Sep" at font-size
    // 16 measures ~70.
    const LABEL_MIN_GAP = 116;
    let lastLabelX = -Infinity;
    // Where the labels that SURVIVE the thinning actually land, and how wide
    // they are, so the end-stops below can get out of their way. Width is the
    // same estimate LABEL_MIN_GAP is built on — about 14 viewBox units per
    // character at the axis font size.
    const lblW = s => String(s).length * 14;
    const drawnLabels = [];
    const timeGrid = tg.map(t => {
      const x = xOf(t.fi);
      if (x < L.x0 || x > L.x1) return '';
      const near = (x - L.x0) < (L.x1 - L.x0) * 0.1 || (L.x1 - x) < (L.x1 - L.x0) * 0.1;
      const room = (x - lastLabelX) >= LABEL_MIN_GAP;
      const cls  = t.admin ? 'reel-tgrid reel-tgrid-admin'
                 : t.month ? 'reel-tgrid reel-tgrid-month'
                 : 'reel-tgrid';
      const label = (!near && room);
      let text = t.label;
      if (label) {
        lastLabelX = x;
        drawnLabels.push([x, lblW(text)]);
      }
      return `<line x1="${x.toFixed(1)}" y1="${L.py0}" x2="${x.toFixed(1)}" y2="${L.py1}" class="${cls}"/>` +
             (label ? `<text x="${x.toFixed(1)}" y="${L.H - 8}" class="reel-axis reel-tgrid-lbl" text-anchor="middle">${text}</text>` : '');
    }).join('');

    // Once the calendar lines are labelled they ARE the axis, so the window's
    // own first/last dates are dropped — they sat on top of the year labels the
    // moment you panned, because the last bar is no longer at the right edge.
    // They come back only on a range that crosses no boundary at all, so the
    // axis is never left blank.
    //
    // "Enough labels" is TWO, not one (2026-09-14). A single label cannot collide
    // with the end-stops the way a panned row of year labels does — it is
    // nowhere near the edges, which is precisely why the `near` rule let it
    // through — so letting one label replace the whole axis left charts whose
    // only date was "Sep". It still earns its keep on the day grid: a 10m window
    // that crosses exactly one midnight keeps its end-stop times as well as the
    // day line.
    const gridLabelCount = (timeGrid.match(/reel-tgrid-lbl/g) || []).length;
    const hasGridLabels = gridLabelCount >= 2;
    // An end-stop that the ONE surviving grid label would print on top of is
    // dropped — the calendar line is the better reference, and two dates in the
    // same centimetre of axis are worse than one. The `near` rule above only
    // suppresses a label inside the outer tenth of the panel, which is not far
    // enough for a ten-character end-stop: it was exposed by 4H, where 520
    // four-hour bars is about ONE calendar quarter on a 24h instrument, so the
    // window usually carries exactly one quarter line and it can land anywhere —
    // BTCUSD read "2026-06-1Q3 2026" at the left edge.
    const clearOfGrid = (x, w, anchor) => {
      const lo = anchor === 'start' ? x : x - w;
      const hi = anchor === 'start' ? x + w : x;
      return !drawnLabels.some(([gx, gw]) => gx + gw / 2 > lo && gx - gw / 2 < hi);
    };
    // LAST BAR FIRST, then the window's start — the order decides which one
    // survives when the two collide, and they do: panning forward moves the last
    // bar off the right edge and into the middle of the panel, so on a window
    // with one grid label both end-stops end up in the same centimetre of axis
    // ("2026-08-05" printed through "2026-09-09"). The last bar's date is the one
    // worth keeping — it is where the data ends, and the blank space to its right
    // is the thing being read — so it is placed first and the start is dropped.
    // Each one placed joins drawnLabels, so the test is the same one the grid
    // labels get rather than a second rule about the same pixels.
    const dates = hasGridLabels ? '' :
      [n - 1, 0].filter((v, i, a) => a.indexOf(v) === i && v >= 0).map(i => {
        const anchor = i === 0 ? 'start' : 'end';
        const x = i === 0 ? L.x0 : xOf(i);
        const text = reelEndStopLabel(b.t[i]);
        const w = lblW(text);
        if (!clearOfGrid(x, w, anchor)) return '';
        drawnLabels.push([anchor === 'start' ? x + w / 2 : x - w / 2, w]);
        return `<text x="${x.toFixed(1)}" y="${L.H - 8}" class="reel-axis" text-anchor="${anchor}">${text}</text>`;
      }).join('');

    // ── Trend channel, if one is saved for this instrument ──
    const name    = item.instrument_name;
    // Builds this chart's two default channels the first time it is painted, if
    // it has none of its own. Read-only — nothing is stored until an edit.
    channelSeedsFor(name, b);
    const channel = reelChannelsSvg(channelsFor(name), b, L, sc, bw,
                                    reel.editing === name, activeIdx(name));

    // The pointer handlers need the exact geometry that was DRAWN, not a
    // recomputation that might drift from it, so it is stashed on the host.
    host._reelCtx = { L, sc, bw, b, name, bundle };

    // Park the tool bar just above the trend strip and the date row.
    //
    // The bar has to be a SIBLING of the chart — the chart's innerHTML is
    // replaced on every repaint, so a child would be destroyed — which means
    // its `bottom` is measured against the CARD, footer and all. No CSS
    // constant can express "clear of the dates" for both a phone card and a
    // wide desktop one, because the reserve below the plot is a fixed number of
    // viewBox units and the viewBox height tracks the box's own aspect. The
    // layout already knows where that reserve starts (L.stripY), and one
    // viewBox unit is clientWidth/1000 CSS px, so measure it here instead.
    const _tb = host.parentElement && host.parentElement.querySelector('.reel-toolbar');
    if (_tb) {
      const unit    = (host.clientWidth || 360) / 1000;
      const hostR   = host.getBoundingClientRect();
      const baseR   = (_tb.offsetParent || host.parentElement).getBoundingClientRect();
      const stripTop = hostR.top + L.stripY * unit;      // top of the trend strip
      _tb.style.bottom = Math.max(0, Math.round(baseR.bottom - stripTop + 4)) + 'px';
    }

    // Grab strip over the price scale. Drag it up and the price window narrows,
    // so the same bars are drawn over the same height with less price in
    // between — the candles stretch. Drag down and it widens, and they pinch.
    //
    // It is a real DOM element rather than a <rect> in the SVG for one reason:
    // `touch-action` is what stops a vertical drag here from being claimed by
    // the reel's own scrolling, and applying it to an SVG child is not reliably
    // honoured on iOS Safari — which is the one browser this has to work in.
    // Width is derived from the layout that DREW the axis, so the strip cannot
    // drift away from the numbers it is sitting on.
    const gripPct = (((L.W - L.x1) / L.W) * 100).toFixed(2);

    // And the matching strip over the DATE row. Drag it right and the window
    // holds fewer bars, so each one gets wider; drag it left and more of
    // history is squeezed in. Same rule as the price scale — pull in the
    // direction the axis grows (up, right) and you zoom in.
    //
    // Height comes from the layout too (everything below py1 is the date row
    // and its padding). That is only ~13 CSS px on a phone-sized card, far
    // under a thumb, so the CSS floors it at a real touch target and lets it
    // reach up into the bottom of the plot. It stops short of the price gutter
    // so the two strips never fight over the corner.
    const tgripPct = (((L.H - L.py1) / L.H) * 100).toFixed(2);

    const strip = reelTrendStripSvg(b, L, xOf, bw, item, bundle);

    // Price, ribbon and drawings are clipped to the plot. A channel or trend
    // line is drawn edge to edge at its own slope, so a steep one used to run
    // straight down through the trend strip and the date labels — on screen and
    // in the shared picture. The id is keyed by geometry, so two charts of the
    // same size sharing one id resolve to identical rectangles.
    const plotClipId = `reelPlot-${L.x1}-${Math.round(L.py1)}`;

    return `<svg class="reel-svg" viewBox="0 0 ${L.W} ${L.H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Price chart with moving-average ribbon">
      <defs><clipPath id="${plotClipId}"><rect x="0" y="0" width="${L.x1}" height="${L.py1 + 6}"/></clipPath></defs>
      ${grid}${timeGrid}<g clip-path="url(#${plotClipId})">${ribbon}${bars}${channel}</g>${lastTag}${clipTag}${dates}${strip}
    </svg><div class="reel-ygrip" data-ygrip="1" style="width:${gripPct}%" aria-hidden="true"></div>` +
      `<div class="reel-tgrip" data-tgrip="1" style="height:${tgripPct}%;right:${gripPct}%" aria-hidden="true"></div>`;
  }

  // ── Timeframe switch ON the chart (2026-09-15) ────────────────────────
  // The pill in each chart's footer opens a menu of every chart timeframe, and
  // picking one redraws THAT instrument — on the card, or in full screen, which
  // stays open. The header toggle already kept the reel's place, but it is off
  // screen behind the full-screen view, so there was no way to flick one chart
  // from 10m to Weekly without closing it and finding it again.
  function reelTfMenuClose() {
    document.querySelectorAll('.reel-tf-menu').forEach(m => m.remove());
    document.querySelectorAll('.reel-tf-tag[aria-expanded="true"]')
      .forEach(b => b.setAttribute('aria-expanded', 'false'));
  }

  function reelTfMenuToggle(tag) {
    const foot = tag.closest('.reel-foot');
    const open = foot && foot.querySelector('.reel-tf-menu');
    reelTfMenuClose();
    if (!foot || open) return;
    const name = tag.dataset.name;
    const menu = document.createElement('div');
    menu.className = 'reel-tf-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = tabTfs('charts').map(code => {
      const on = code === timeframe;
      return `<button class="reel-tf-opt${on ? ' on' : ''}" role="menuitemradio" aria-checked="${on}" data-act="tf-set" data-tf="${code}" data-name="${name}">${TF_BY_CODE[code].label}</button>`;
    }).join('');
    foot.appendChild(menu);
    tag.setAttribute('aria-expanded', 'true');
  }

  // Any tap outside the open menu closes it. Capture phase, so it runs before
  // the tap does anything else — and a tap on the pill itself is left to the
  // toggle, or the menu would close and immediately reopen.
  document.addEventListener('click', e => {
    if (!document.querySelector('.reel-tf-menu')) return;
    if (e.target.closest('.reel-tf-menu, .reel-tf-tag')) return;
    reelTfMenuClose();
  }, true);

  function reelSwitchTf(name, tf) {
    if (!isTf(tf) || tf === timeframe) return;
    const full = chartFullName;
    setTimeframe(tf, name);
    // Full screen is a separate overlay the reel rebuild does not touch, so it
    // is redrawn on the same instrument at the new timeframe.
    if (full) chartFullOpen(full);
  }

  // ── Full-screen chart ────────────────────────────────────────────────
  //
  // The same renderer, the same gesture wiring and the same buttons — only the
  // box is bigger. reelLayout() derives its geometry from the host's real size,
  // so a taller host simply draws a taller chart; nothing here re-implements
  // the chart. The overlay carries class `reel-card` on purpose: the delegated
  // dispatch finds its chart host with closest('.reel-card'), and giving it the
  // same shape means the controls behave identically without a second copy.

  let chartFullName = null;
  let chartFullPrevLock = undefined;   // the reader's own price scale, put back on close
  // Price span the full-screen view opened with. The baseline a zoom done
  // while expanded is measured against, so the ratio can be carried back to
  // the card on close.
  let chartFullOpenSpan = 0;
  let chartFullOpenMid  = 0;

  function chartFullEl() { return document.getElementById('chartFull'); }

  async function chartFullOpen(name) {
    const item = (reel.list || []).find(d => d.instrument_name === name)
              || allData.find(d => d.instrument_name === name);
    if (!item) return;
    chartFullName = name;

    let el = chartFullEl();
    if (!el) {
      el = document.createElement('div');
      el.id = 'chartFull';
      document.body.appendChild(el);
      el.addEventListener('click', e => {
        if (e.target.closest('[data-act="chart-full-close"]')) { chartFullClose(); return; }
        const step = e.target.closest('[data-act="chart-full-step"]');
        if (step) { if (!step.disabled) chartFullStep(+step.dataset.dir); return; }
        window.__reelBtnAct(e);
      });
    }
    el.className = 'reel-card chart-full open';
    el.dataset.name = name;
    el.innerHTML = chartFullHtml(item);
    chartHistNote(name);
    document.body.classList.add('chart-full-open');

    const host = el.querySelector('.reel-chart');
    const data = await reelLoadChunk(name);
    const bundle = data && data[name];
    if (!bundle) { host.innerHTML = '<div class="reel-nodata">No chart data</div>'; return; }
    host._reelItem = item;

    // Keep the BARS' SHAPE. The panel is taller but no wider, so letting the
    // price scale auto-fit again spreads the same price range over more pixels
    // and every bar comes out tall and thin — the chart is distorted, not
    // enlarged. Instead the price range is grown in proportion to the extra
    // height, which holds price-per-pixel exactly where it was and spends the
    // new room on showing MORE chart above and below.
    chartFullPrevLock = reel.lockY.has(name) ? reel.lockY.get(name) : undefined;
    const src = chartFullSourceCtx(name);
    if (src) {
      const srcPlot  = plotPixelHeight(src.host, src.ctx.L);
      const fullPlot = plotPixelHeight(host, reelLayout(host));
      if (srcPlot > 0 && fullPlot > 0) {
        const mid  = (src.ctx.sc.lo + src.ctx.sc.hi) / 2;
        const span = (src.ctx.sc.hi - src.ctx.sc.lo) * (fullPlot / srcPlot);
        reel.lockY.set(name, { lo: mid - span / 2, hi: mid + span / 2 });
      }
    }

    host.innerHTML = reelChartSvg(bundle, item, host);
    // Read the span off the scale that was actually PAINTED rather than the one
    // computed above: they differ whenever the source card was gone and no lock
    // could be imposed, and the baseline has to match what the reader sees.
    chartFullOpenSpan = host._reelCtx ? (host._reelCtx.sc.hi - host._reelCtx.sc.lo) : 0;
    chartFullOpenMid  = host._reelCtx ? (host._reelCtx.sc.hi + host._reelCtx.sc.lo) / 2 : 0;
    reelWireChart(host);
    chartFullSyncButtons();
  }

  // The card this was opened from, if it is still painted — the reference for
  // how big a bar was before the chart got a bigger box.
  function chartFullSourceCtx(name) {
    const card = [...document.querySelectorAll('#chartReel .reel-card')]
      .find(c => c.dataset.name === name);
    const h = card && card.querySelector('.reel-chart');
    return (h && h._reelCtx) ? { ctx: h._reelCtx, host: h } : null;
  }

  // Plot height in SCREEN pixels. The viewBox is 1000 wide on both hosts but
  // they are not the same number of CSS pixels wide (the full-screen one is
  // inset), so viewBox units do not convert to pixels at the same rate and
  // comparing them directly got the scaling wrong by 14%.
  function plotPixelHeight(host, L) {
    const px = host.getBoundingClientRect().height;
    return px > 0 && L.H > 0 ? px * (L.py1 - L.py0) / L.H : 0;
  }

  // Step to the neighbouring chart WITHOUT leaving full screen (2026-09-11).
  // The reel behind steps with it, so closing lands on the chart you were last
  // looking at rather than the one you opened.
  function chartFullStep(dir) {
    const list = reel.list || [];
    const n = list.length;
    if (!n) return;
    const i = list.findIndex(d => d.instrument_name === chartFullName);
    if (i < 0) return;
    // The list WRAPS (2026-09-12, user's request): pressing back on chart 1
    // lands on the LAST chart and counts down from there, and forward from the
    // last one returns to 1. Before this both ends were dead buttons, which
    // reads as broken rather than as "you have reached the end".
    const j = (i + dir + n) % n;
    if (j === i) return;                     // a one-chart list has nowhere to go
    const next = list[j];
    chartFullClose();
    // Put the reel behind on the SAME card. reelStepBy() scrolls exactly one
    // screen, which is right for a neighbour and wrong for a wrap: stepping
    // back from chart 1 would scroll off the top and leave the reel on the
    // wrong instrument once full screen closes. Position by the card itself,
    // the way reelRebuildKeepingPlace() and openChartFor() already do.
    const host = document.getElementById('chartReel');
    const el = host && host.querySelector(`.reel-card[data-name="${CSS.escape(next.instrument_name)}"]`);
    if (host && el) {
      host.scrollTop = el.offsetTop - host.offsetTop;
      reelPaintVisible();
      reelSyncNav();
    } else {
      reelStepBy(dir);                       // card not built yet — old behaviour
    }
    chartFullOpen(next.instrument_name);
  }

  function chartFullClose() {
    const el = chartFullEl();
    // Put the reader's own price scale back — the one full screen imposed was
    // ours, not theirs, and leaving it would zoom the card out on return.
    if (chartFullName) {
      // ...UNLESS the reader stretched or pinched the scale themselves while
      // it was open (_userY). That IS theirs and has to survive the close —
      // but not as an absolute price window: the card's plot is shorter, so
      // handing it the full-screen span would zoom the card out, which is the
      // very distortion the restore above exists to prevent. Carry the RATIO
      // they applied and re-apply it to the card's own scale.
      const cur   = reel.lockY.get(chartFullName);
      const owned = !!(cur && cur._userY && chartFullOpenSpan > 0);
      const ratio = owned ? (cur.hi - cur.lo) / chartFullOpenSpan : 1;
      // How far they slid the window, in units of the span they slid it at —
      // a fraction, for the same reason the zoom is a ratio. The card's span is
      // different, so carrying the raw price offset would move it by the wrong
      // amount and leave the chart somewhere they never put it.
      const shift = owned ? ((cur.hi + cur.lo) / 2 - chartFullOpenMid) / chartFullOpenSpan : 0;

      if (chartFullPrevLock === undefined) reel.lockY.delete(chartFullName);
      else reel.lockY.set(chartFullName, chartFullPrevLock);

      if (Math.abs(ratio - 1) > 0.005 || Math.abs(shift) > 0.005) {
        // Base = whatever the card would show on its own: the reader's earlier
        // window if they had one, else the card's live fitted scale.
        const src  = chartFullSourceCtx(chartFullName);
        const base = chartFullPrevLock
          || (src ? { lo: src.ctx.sc.lo, hi: src.ctx.sc.hi } : null);
        if (base) {
          const baseSpan = base.hi - base.lo;
          const mid  = (base.lo + base.hi) / 2 + shift * baseSpan;
          const span = baseSpan * ratio;
          if (isFinite(span) && span > 0 && isFinite(mid)) {
            reel.lockY.set(chartFullName, { lo: mid - span / 2, hi: mid + span / 2, _userY: true });
          }
        }
      }
      chartFullPrevLock = undefined;
      chartFullOpenSpan = 0;
      chartFullOpenMid  = 0;
    }
    if (el) { el.classList.remove('open'); el.innerHTML = ''; }
    document.body.classList.remove('chart-full-open');
    chartFullName = null;
    // The reel behind it shares the channel and pan state, so anything drawn
    // full-screen has to be redrawn on the card.
    reelRepaintVisible();
  }

  function chartFullHtml(item) {
    const name  = item.instrument_name;
    const ch    = activeChannel(name);
    const edit  = reel.editing === name;
    const list  = reel.list || [];
    const pos   = list.findIndex(d => d.instrument_name === name);
    // Neither button is ever disabled (2026-09-12): the list WRAPS. Back from
    // chart 1 goes to the last one and counts down from there, which is what
    // the reader asked for — a dead ‹ on the first chart just looked broken.
    const steps = pos < 0 ? '' :
      `<button class="cf-step" data-act="chart-full-step" data-dir="-1" aria-label="Previous chart">‹</button>`
      + `<span class="cf-pos">${pos + 1}/${list.length}</span>`
      + `<button class="cf-step" data-act="chart-full-step" data-dir="1" aria-label="Next chart">›</button>`;
    return `
      <header class="cf-head">
        <div class="cf-title">
          <div class="reel-head-line">
            <span class="reel-name">${name}</span>
            <span class="reel-group">${item.group || ''} · ${tfMeta().label}</span>
          </div>
          ${instName(name) ? `<span class="reel-fullname">${escText(instName(name))}</span>` : ''}
          ${reelTrendlineHtml(item)}
        </div>
        ${chartBackBtnHtml()}
        <button class="reel-share-btn reel-star-btn${userStarred.has(name) ? ' on' : ''}" data-act="star" data-name="${name}" aria-label="Star chart" title="Star">★</button>
        <button class="reel-share-btn" data-act="chart-share" data-name="${name}" aria-label="Share chart">${SHARE_ICON}</button>
        <button class="cf-close" data-act="chart-full-close" aria-label="Close full screen">✕</button>
      </header>
      <div class="reel-chart" id="chartFullHost"><div class="reel-skel"><span></span></div></div>
      ${reelToolbarHtml(name, edit)}
      <footer class="reel-foot">
        <button class="reel-tf-tag" data-act="tf-menu" data-name="${name}" aria-haspopup="menu" aria-label="Change timeframe">${tfMeta().label}<i class="reel-tf-caret">▾</i></button>
        <div class="reel-foot-actions">
          <button class="reel-act reel-act-ch" data-act="channel" data-name="${name}">${channelBtnHtml(name)}</button>
        </div>
        ${steps ? `<div class="cf-steps">${steps}</div>` : ''}
      </footer>`;
  }

  // Mirrors reelSyncChannelButtons for the one full-screen card.
  function chartFullSyncButtons() {
    const el = chartFullEl();
    if (!el || !el.classList.contains('open')) return;
    const name = el.dataset.name;
    const ch   = activeChannel(name);
    const edit = reel.editing === name;
    const q = a => el.querySelector(`[data-act="${a}"]`);
    const b = q('channel');
    const add = el.querySelector('[data-tools]');
    if (b) { b.innerHTML = channelBtnHtml(name); b.classList.toggle('on', edit); }
    if (add) add.hidden = !edit;
    reelSyncProps(el, name);
    el.classList.toggle('ch-editing', edit);
  }

  // Repaint whatever cards are currently drawn — used when returning from full
  // screen, where the shared channel/pan state may have changed underneath.
  function reelRepaintVisible() {
    document.querySelectorAll('#chartReel .reel-chart').forEach(h => {
      if (h._reelCtx && h._reelItem) reelRepaint(h);
    });
    reelSyncChannelButtons();
  }

  // ── Card shell ───────────────────────────────────────────────────────

  // While comparing, each card carries how close it is to the anchor — the
  // anchor itself is the one you came from, so it says so rather than "100%".
  function simPct(name) {
    if (!reel.similarTo) return '';
    if (name === reel.similarTo) return '<span class="reel-simpct">this one</span>';
    const hit = shapeNeighbours(reel.similarTo).find(n => n.name === name);
    return hit ? `<span class="reel-simpct">${(hit.corr * 100).toFixed(0)}% alike</span>` : '';
  }

  // The trend sentence for a chart header — the card and the full-screen view
  // share it, so "extended" never loses the writing the card has.
  function reelTrendlineHtml(item) {
    // A chartOnly timeframe HAS no row, so the sentence must not render on one —
    // asked of the flag, not only of the column. 10m is safe either way (no
    // m10_ column has ever existed), but `h4_` columns were published until
    // 2026-09-11 and still sit in older local output, so a column test alone
    // brought a three-month-old 4H trend back onto the card in local dev while
    // the live app showed nothing. The flag is the fact; the column is evidence.
    const hasTfRow = !tfMeta().chartOnly
      && item[f('close')] !== undefined && item[f('close')] !== '';
    const ts = hasTfRow ? trendSentence(item) : null;
    if (!ts) return '';
    return `<span class="reel-trendline ${ts.dir === 'UPTREND' ? 'up' : ts.dir === 'DOWNTREND' ? 'down' : 'flat'}">${ts.glyph} ${ts.head}`
      + `${ts.now ? ` <span class="reel-trendline-now${ts.against ? ' against' : ''}">· ${ts.now}</span>` : ''}</span>`;
  }

  function reelCardHtml(item, i) {
    const name  = item.instrument_name;
    // On a chart view (1H/4H/3D) the signal shown is the signal timeframe's and
    // is labelled with it, so a Daily B3 is never read as a 4H one.
    const onSigTf = SIGNAL_TFS.has(timeframe);
    const sig   = withSignalTf(() => item[f('primary_signal')] || '');
    const conf  = onSigTf ? '' : TF_BY_CODE[tfPrefs.signals].label;   // no confidence tier (2026-09-11)
    const mv    = parseFloat(item.pct_1d);
    const mvTxt = isNaN(mv) ? '' : (mv >= 0 ? '+' : '') + mv.toFixed(2) + '%';
    const mvCls = isNaN(mv) ? '' : mv >= 0 ? 'up' : 'down';
    const sigCls = !sig ? '' : sig.toUpperCase().startsWith('B') ? 'buy' : 'sell';
    const starred = userStarred.has(name);

    const _chNow = activeChannel(name);
    // Draw mode belongs to the CHART, not to one drawing: a locked selection no
    // longer switches the whole card out of it (2026-09-15, per-drawing props).
    const _chEditing = reel.editing === name;
    return `<article class="reel-card${_chEditing ? ' ch-editing' : ''}" data-name="${name}" data-idx="${i}">
      <header class="reel-head">
        <div class="reel-head-main">
          <div class="reel-head-line">
            <span class="reel-name">${name}</span>
            <span class="reel-group">${item.group || ''}</span>
          </div>
          ${instName(name) ? `<span class="reel-fullname">${escText(instName(name))}</span>` : ''}
          ${reelTrendlineHtml(item)}
        </div>
        <div class="reel-head-meta">
          ${simPct(name)}
          ${sig ? `<span class="reel-sig ${sigCls}">${sig}${conf ? `<i>${conf}</i>` : ''}</span>` : ''}
          ${mvTxt ? `<span class="reel-move ${mvCls}">${mvTxt}</span>` : ''}
          ${chartBackBtnHtml()}
          <button class="reel-share-btn" data-act="chart-expand" data-name="${name}" aria-label="Full screen chart">${EXPAND_ICON}</button>
          <button class="reel-share-btn" data-act="chart-share" data-name="${name}" aria-label="Share chart">${SHARE_ICON}</button>
        </div>
      </header>

      <div class="reel-chart" id="reelChart-${i}">
        <div class="reel-skel"><span></span></div>
      </div>
      ${reelToolbarHtml(name, _chEditing)}

      <footer class="reel-foot">
        <button class="reel-tf-tag" data-act="tf-menu" data-name="${name}" aria-haspopup="menu" aria-label="Change timeframe">${tfMeta().label}<i class="reel-tf-caret">▾</i></button>
        <div class="reel-foot-actions">
          <button class="reel-act ${starred ? 'on' : ''}" data-act="star" data-name="${name}" aria-label="Star">★</button>
          <button class="reel-act reel-act-ch" data-act="channel" data-name="${name}">${channelBtnHtml(name)}</button>
          <button class="reel-act" data-act="detail" data-name="${name}">Details</button>
          <button class="reel-act tv" data-act="tv" data-name="${name}">TradingView</button>
        </div>
      </footer>
    </article>`;
  }

  // ── Filtering ────────────────────────────────────────────────────────

  function reelFiltered() {
    const rowsAll = getActiveData();
    // "Charts like X" REPLACES the list rather than narrowing it: it is an
    // explicit set in similarity order, so the pills, the search and the sort
    // are deliberately bypassed. Anchor first, then descending similarity —
    // that is the order you want to flick through when comparing.
    if (reel.similarTo) {
      const by = new Map(rowsAll.map(d => [d.instrument_name, d]));
      const out = [];
      const anchor = by.get(reel.similarTo);
      if (anchor) out.push(anchor);
      shapeNeighbours(reel.similarTo).forEach(n => {
        const d = by.get(n.name);
        if (d) out.push(d);
      });
      return out;
    }
    let rows = rowsAll;

    if (reel.search) rows = rows.filter(d => matchesSearch(d, reel.search));
    if (reel.cat)    rows = rows.filter(d => matchesSearch(d, reel.cat));
    // On a chartOnly timeframe (10m) the row carries NO prefixed columns at
    // all, so these two read the signal timeframe the way the scopes below
    // already do. Without it `m_trend_direction` is undefined on every row,
    // effectiveTrend answers NEUTRAL for all 798, and picking Uptrend empties
    // the reel — a filter that silently matches nothing.
    const withRowTf = fn => (TF_BY_CODE[timeframe] || {}).chartOnly ? withSignalTf(fn) : fn();
    if (reel.trend !== 'all') rows = withRowTf(() => rows.filter(d => effectiveTrend(d) === reel.trend));
    // Same predicate the Signals sheet uses, so "near cross" cannot come to
    // mean two different things on two tabs.
    if (reel.stack !== 'all') rows = withRowTf(() => rows.filter(d => matchesStackFilter(d, reel.stack)));

    // Signal scopes and the signal sort read the signal timeframe: on a chart
    // view (1H/4H/3D), "Buys only" means a Daily or Weekly buy.
    rows = withSignalTf(() => {
    switch (reel.scope) {
      case 'today':   rows = rows.filter(firedOnLatestBar); break;
      case 'signal':  rows = rows.filter(d => !!d[f('primary_signal')]); break;
      case 'buy':     rows = rows.filter(isBuy); break;
      case 'sell':    rows = rows.filter(isSell); break;
      case 'watch':   rows = rows.filter(d => d[f('watch_flag')] === 'yes'); break;
      case 'starred': rows = rows.filter(d => userStarred.has(d.instrument_name)); break;
    }
    return rows;
    });

    const sigRank = d => {
      if (firedOnLatestBar(d)) return 0;
      if (d[f('primary_signal')]) return 1;
      if (d[f('watch_flag')] === 'yes') return 2;
      return 3;
    };
    const daysAgo = d => {
      const v = parseFloat(d[f('last_signal_days_ago')]);
      return isNaN(v) ? 1e9 : v;
    };

    const sorted = [...rows];
    withSignalTf(() => {
    if (reel.sort === 'name') {
      sorted.sort((a, b) => a.instrument_name.localeCompare(b.instrument_name));
    } else if (reel.sort === 'move') {
      sorted.sort((a, b) => Math.abs(parseFloat(b.pct_1d) || 0) - Math.abs(parseFloat(a.pct_1d) || 0));
    } else if (reel.sort === 'recent') {
      sorted.sort((a, b) => daysAgo(a) - daysAgo(b));
    } else {
      // Signals first, then by how recently they fired, then name.
      sorted.sort((a, b) =>
        sigRank(a) - sigRank(b) ||
        daysAgo(a) - daysAgo(b) ||
        a.instrument_name.localeCompare(b.instrument_name));
    }
    });
    return sorted;
  }

  // ── Lazy paint ───────────────────────────────────────────────────────

  async function reelPaint(idx) {
    const item = reel.list[idx];
    if (!item) return;
    const host = document.getElementById('reelChart-' + idx);
    if (!host || host.dataset.painted === timeframe) return;

    const name = item.instrument_name;
    const data = await reelLoadChunk(name);

    // The user may have scrolled far away, or flipped timeframe, while the
    // chunk was in flight — re-check before touching the DOM.
    const stillThere = document.getElementById('reelChart-' + idx);
    if (!stillThere || reel.list[idx] !== item) return;

    const bundle = data && data[name];
    if (!bundle) {
      stillThere.innerHTML = '<div class="reel-nodata">No chart data for this instrument</div>';
      stillThere.dataset.painted = timeframe;
      return;
    }
    stillThere.innerHTML = reelChartSvg(bundle, item, stillThere);
    stillThere.dataset.painted = timeframe;
    stillThere._reelItem = item;
    reelWireChart(stillThere);
    reel.drawn.add(idx);
  }

  // Redraw ONE chart in place — used by the pan drag and the channel drag,
  // which must not go through reelPaint (it early-exits on anything already
  // painted, and re-fetching a chunk mid-gesture would stutter).
  function reelRepaint(host) {
    const ctx = host && host._reelCtx;
    if (!ctx || !host._reelItem) return;
    // Carry the hint across the rebuild. It is a child of the host, so
    // replacing innerHTML deleted it — and every hint is raised BY a gesture,
    // which is exactly what repaints. The pan hint had the same problem and
    // was being destroyed within a frame or two of appearing; the zoom-limit
    // hint made it obvious because that one fires when nothing else changes.
    const hint = host.querySelector('.reel-hint');
    host.innerHTML = reelChartSvg(ctx.bundle, host._reelItem, host);
    if (hint) host.appendChild(hint);
  }

  // ── Share the chart as a picture ─────────────────────────────────────
  //
  // The chart is an inline SVG that gets ALL of its colour from stylesheet
  // classes and CSS custom properties. Serialise it as-is and every one of
  // those resolves to nothing — you get a black rectangle. So the clone is
  // walked against the live element and each painted property is copied across
  // as an explicit attribute. That is why this reads the computed style of the
  // original rather than trying to ship the stylesheet with the image.
  const SHARE_STYLE_PROPS = [
    'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
    'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
    'opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor',
  ];

  function inlineSvgStyles(liveEl, cloneEl) {
    const cs = getComputedStyle(liveEl);
    for (const prop of SHARE_STYLE_PROPS) {
      const v = cs.getPropertyValue(prop);
      // `none` IS a value and must be copied. Skipping it (2026-09-15) left the
      // channel band — `.reel-ch-band { fill: none }` — with no fill attribute
      // at all, and an SVG shape with no fill paints BLACK: every shared chart
      // with a channel came out with the inside of the channel blacked in.
      if (v && v !== 'normal') cloneEl.setAttribute(prop, v.trim());
    }
    const lk = liveEl.children, ck = cloneEl.children;
    for (let i = 0; i < lk.length && i < ck.length; i++) inlineSvgStyles(lk[i], ck[i]);
  }

  // Render one card's chart to a PNG blob, with a caption strip so the picture
  // still says what it is once it has left the app.
  async function chartToPngBlob(name, host) {
    const svg = host && host.querySelector('svg.reel-svg');
    if (!svg) return null;

    const vb = (svg.getAttribute('viewBox') || '0 0 1000 800').split(/\s+/).map(Number);
    const W = vb[2] || 1000, H = vb[3] || 800;
    const HEAD = 96, FOOT = 46, SCALE = 2;

    const clone = svg.cloneNode(true);
    inlineSvgStyles(svg, clone);
    // Editing chrome is not part of the picture: the drag handles, their
    // invisible grab circles and tap targets, and the "zoom out to adjust" note
    // only exist while Draw is open. Removed AFTER the style walk, which pairs
    // live and cloned children by position.
    clone.querySelectorAll('.reel-ch-h, .reel-ch-grab, .reel-ch-hit, .reel-ch-note')
         .forEach(el => el.remove());
    clone.setAttribute('width', W);
    clone.setAttribute('height', H);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    const url = 'data:image/svg+xml;charset=utf-8,' +
                encodeURIComponent(new XMLSerializer().serializeToString(clone));
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = url;
    });

    const cv = document.createElement('canvas');
    cv.width = W * SCALE; cv.height = (H + HEAD + FOOT) * SCALE;
    const ctx = cv.getContext('2d');
    ctx.scale(SCALE, SCALE);

    // GROUND AND INK COME FROM THE CHART BOX ITSELF, never from :root.
    //
    // This used to fill --bg-card (#121211) and caption in --text-primary. That
    // was right while the plot was dark. Since the white plot ground (v271) the
    // ground is a CSS `background` on the .reel-chart DIV — not on the SVG — so
    // the serialized clone is transparent, and the bars, which inlineSvgStyles
    // correctly resolves to the #14140f ink chosen FOR a white panel, were being
    // painted onto a #121211 canvas. Near-black on near-black: the share button
    // emitted a plain black chart.
    //
    // Reading the live host's own computed values instead means the picture
    // cannot drift from the chart again — .reel-chart re-points exactly these
    // tokens for its ground, so whatever it is set to is what gets shared.
    const hcs    = getComputedStyle(host);
    const ground = (hcs.backgroundColor && !/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(hcs.backgroundColor))
                   ? hcs.backgroundColor : '#ffffff';
    const ink    = hcs.getPropertyValue('--reel-bar').trim()       || '#14140f';
    const ink2   = hcs.getPropertyValue('--text-secondary').trim() || '#3f3f46';
    const ink3   = hcs.getPropertyValue('--text-muted').trim()     || '#70707a';

    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, W, H + HEAD + FOOT);

    const item  = allData.find(d => d.instrument_name === name) || {};
    // Same rule as the card: on a chart view the signal is the signal
    // timeframe's and says so; 1H has no trend word.
    const _sig  = withSignalTf(() => item[f('primary_signal')] || '');
    const sig   = _sig && !SIGNAL_TFS.has(timeframe) ? `${_sig} (${TF_BY_CODE[tfPrefs.signals].label})` : _sig;
    // chartOnly first, for the reason in reelTrendlineHtml: a stale h4_ column
    // must not put a trend word on a shared 4H card that the app itself shows
    // no trend word for.
    const trend = (!tfMeta().chartOnly && item[f('close')] !== undefined && item[f('close')] !== '')
      ? effectiveTrend(item) : '';
    const full  = instName(name);

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = ink;
    ctx.font = '700 40px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(name, 24, 52);

    const nameW = ctx.measureText(name).width;
    ctx.fillStyle = ink3;
    ctx.font = '400 26px system-ui, -apple-system, "Segoe UI", sans-serif';
    if (full && full !== name) ctx.fillText(full, 24 + nameW + 14, 52);

    ctx.fillStyle = ink2;
    ctx.font = '500 26px system-ui, -apple-system, "Segoe UI", sans-serif';
    const sub = [tfMeta().label, trend, sig].filter(Boolean).join('  ·  ');
    ctx.fillText(sub, 24, 84);

    ctx.drawImage(img, 0, HEAD, W, H);

    ctx.fillStyle = ink3;
    ctx.font = '400 22px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText('SwingPulse · ' + new Date().toISOString().slice(0, 10), 24, H + HEAD + 30);

    return await new Promise(res => cv.toBlob(res, 'image/png'));
  }

  async function shareChartImage(name, host) {
    let blob;
    try { blob = await chartToPngBlob(name, host); }
    catch (_) { blob = null; }
    if (!blob) { if (host) reelHint(host, 'Could not render this chart'); return; }

    const file = new File([blob], `${name.replace(/[^\w.-]+/g, '_')}-${tfMeta().code}.png`,
                          { type: 'image/png' });

    // Share sheet where the device has one (iOS/Android), download everywhere
    // else. canShare({files}) is the only honest test — navigator.share alone
    // exists on browsers that refuse file payloads.
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `${name} · ${tfMeta().label}` });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;   // user closed the sheet
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    if (host) reelHint(host, 'Chart saved as ' + file.name);
  }

  // ── Chart gestures: pan sideways, and drag the channel handles ───────
  //
  // ONE pointer handler does both. Which one you get is decided at the first
  // few pixels of movement and then LOCKED for the gesture:
  //   * started on a channel handle (edit mode only) → drag that handle
  //   * mostly horizontal                            → pan through history
  //   * mostly vertical                              → let the reel scroll
  // The axis lock is what makes this usable on a phone. Without it a slightly
  // diagonal flick either scrolls the feed when you meant to pan, or eats the
  // scroll when you meant to leave.
  const REEL_AXIS_LOCK_PX = 7;

  // How far the price scale may be stretched or pinched, as a multiple of the
  // visible slice's own high-to-low range. Past roughly this the chart has
  // stopped being readable in either direction — expanded, one bar fills the
  // panel and there is no context; pinched, every bar is a flat line on the
  // mid. Stops rather than limits: they are only reached by deliberately
  // dragging into them, and a double-tap resets.
  const REEL_Y_ZOOM_MAX = 24;

  // High-to-low of the bars actually on screen. This is the ABSOLUTE reference
  // the zoom stops are measured against — measuring against the current window
  // instead would let repeated drags compound past any bound.
  function reelPriceExtent(b) {
    let lo = Infinity, hi = -Infinity;
    for (const v of b.l) if (v != null && v < lo) lo = v;
    for (const v of b.h) if (v != null && v > hi) hi = v;
    if (!isFinite(lo) || !isFinite(hi)) return null;
    const span = hi - lo;
    return span > 0 ? { lo, hi, span } : null;
  }

  // Two-finger pinch. The axis strips are a drag, which works with a mouse and
  // on a phone, but "pinch" on a touch screen means two fingers and that is
  // what a reader reaches for first — so this is the same two zooms driven by
  // how far apart the fingers are.
  //
  // The axes are independent: the HORIZONTAL spread drives the bar count and
  // the VERTICAL spread drives the price window, each measured against the
  // spread at the moment the second finger landed. Pinch sideways and only
  // time changes; pinch up and down and only price does; pinch diagonally and
  // both move, by their own amounts. An axis the fingers barely span is left
  // alone — dividing by a few pixels of noise would send the chart flying.
  function reelApplyPinch(host, ctx, base, pair) {
    const [a, b] = pair;
    const sx = Math.abs(a.x - b.x), sy = Math.abs(a.y - b.y);
    const MIN_SPREAD = 24;
    let changed = false;

    // Fingers apart = zoom in = FEWER bars over the same width.
    if (base.dx0 >= MIN_SPREAD && sx >= 1) {
      const n = reelMaxBars(ctx.bundle);
      let bars = Math.round(base.bars * (base.dx0 / sx));
      bars = Math.min(Math.max(bars, REEL_MIN_WINDOW_BARS), n);
      if (bars === reelWindowBars(ctx.bundle, ctx.name)) {
        if (bars >= n && sx < base.dx0) reelZoomLimitHint(host, n, 'out');
      } else {
        if (bars === reelDefaultBars(ctx.bundle)) reel.tzoom.delete(ctx.name);
        else                                                reel.tzoom.set(ctx.name, bars);
        reelSetPan(ctx.name, reelPanOf(ctx.name), ctx.bundle);
        changed = true;
      }
    }

    // Fingers apart = zoom in = LESS price over the same height.
    if (base.dy0 >= MIN_SPREAD && sy >= 1) {
      const mid = (base.hi + base.lo) / 2;
      let span  = (base.hi - base.lo) * (base.dy0 / sy);
      if (base.ext) {
        span = Math.min(Math.max(span, base.ext.span / REEL_Y_ZOOM_MAX),
                        base.ext.span * REEL_Y_ZOOM_MAX);
      }
      if (isFinite(span) && span > 0) {
        const cur = reel.lockY.get(ctx.name);
        if (!cur || Math.abs((cur.hi - cur.lo) - span) > span * 1e-6) {
          reel.lockY.set(ctx.name, { lo: mid - span / 2, hi: mid + span / 2, _userY: true });
          changed = true;
        }
      }
    }
    return changed;
  }

  // Why a time zoom just did nothing. The bundle is a fixed 520 bars, and the
  // DEFAULT view is all of them — so "zoom out" has nowhere to go until you
  // have zoomed in first, which reads as a broken gesture rather than a limit.
  // Throttled: this is called from a pointermove, and reelHint re-arms its own
  // timer on every call.
  // Silent since 2026-09-15: the user asked for the black message bubbles over
  // the chart to go. Reaching a zoom limit simply stops the zoom.
  function reelZoomLimitHint(host, n, dir) {}

  // Apply a drag of `dx` CSS pixels to the time window captured at grab time.
  // Exponential, so the same travel is the same ratio wherever you start, and
  // scaled by the host's WIDTH so a card and a full-screen panel feel the same.
  //
  // Drag LEFT to zoom in (fewer, wider bars), RIGHT to zoom out. That is the
  // opposite of the price scale, where up zooms in, and it is the right way
  // round: you are dragging the timeline itself, and pulling it left drags
  // later dates toward you, which is what zooming in on the recent end does.
  //
  // The right edge of the window does not move: `pan` counts bars back from the
  // newest, so holding it fixed while the width changes adds and removes bars
  // on the LEFT. That is what makes the zoom feel anchored instead of sliding
  // the chart sideways as it scales. The pan is re-clamped afterwards because
  // a wider window has less history left to scroll back through.
  function reelApplyTZoom(host, ctx, grab, dx) {
    const wPx = host.getBoundingClientRect().width || 0;
    const K   = Math.max(140, wPx * 0.9);
    const n   = reelMaxBars(ctx.bundle);
    let bars  = grab.bars * Math.exp(dx / K);
    bars = Math.min(Math.max(Math.round(bars), REEL_MIN_WINDOW_BARS), n);
    if (bars === reelWindowBars(ctx.bundle, ctx.name)) {
      // Zooming OUT from the default does nothing, and it is not obvious why:
      // the default view is ALREADY the whole bundle, so there is no more chart
      // to reveal. Say so rather than letting the gesture read as broken —
      // this is the same failure the pan hint covers for the same reason.
      if (bars >= n && dx > 0)  reelZoomLimitHint(host, n, 'out');
      if (bars <= REEL_MIN_WINDOW_BARS && dx < 0) reelZoomLimitHint(host, n, 'in');
      return false;
    }
    // Clear the override only when it lands back on the DEFAULT window, not on
    // the whole bundle. Those used to be the same number; since the bundle
    // carries more than a card opens with, deleting at full width snapped the
    // chart straight back to 520 bars — zooming all the way out undid itself.
    if (bars === reelDefaultBars(ctx.bundle)) reel.tzoom.delete(ctx.name);
    else                                                reel.tzoom.set(ctx.name, bars);
    reelSetPan(ctx.name, reelPanOf(ctx.name), ctx.bundle);   // re-clamp, never widen
    return true;
  }

  // Shift the price window by a drag of `dy` CSS pixels, so the chart can be
  // moved up and down and not only sideways. Pixels are converted through the
  // window's own price-per-pixel, which is what keeps the content stuck to the
  // finger at any zoom.
  //
  // Clamped to keep the data reachable: the window's centre may wander up to
  // three quarters of the visible bar range beyond the highest high or lowest
  // low, which is enough to park price at the very top or bottom of the panel
  // and no further. Without it a flick sends the chart somewhere with nothing
  // in it and no obvious way back.
  function reelApplyYPan(host, ctx, grab, dy) {
    const plotPx = plotPixelHeight(host, ctx.L);
    if (!plotPx) return false;
    const span = grab.hi - grab.lo;
    // Drag DOWN and the paper comes with you: higher prices arrive from above,
    // so the window moves UP in price.
    let mid = (grab.hi + grab.lo) / 2 + dy * (span / plotPx);

    if (grab.ext) {
      const pad = grab.ext.span * 0.75;
      mid = Math.min(Math.max(mid, grab.ext.lo - pad), grab.ext.hi + pad);
    }
    if (!isFinite(mid)) return false;

    const cur = reel.lockY.get(ctx.name);
    if (cur && Math.abs((cur.hi + cur.lo) / 2 - mid) < span * 1e-6) return false;
    reel.lockY.set(ctx.name, { lo: mid - span / 2, hi: mid + span / 2, _userY: true });
    return true;
  }

  // Apply a drag of `dy` CSS pixels to the price window captured at grab time.
  // Returns true if the window changed.
  //
  // Exponential, not linear: the same finger travel gives the same RATIO of
  // zoom wherever you start from, so a chart that is already stretched does not
  // suddenly become twice as touchy. `K` is tied to the host's own height so
  // the gesture feels identical on a reel card and full screen — the same
  // fraction of the panel travelled is the same amount of zoom, which is what
  // "it should work expanded and not expanded" has to mean in practice.
  function reelApplyYZoom(host, ctx, grab, dy) {
    const hPx = host.getBoundingClientRect().height || 0;
    const K   = Math.max(120, hPx * 0.8);
    // Drag UP (dy negative) -> factor < 1 -> a NARROWER price window over the
    // same pixels -> taller bars. Drag down pinches. Matches the price scale on
    // every other chart the reader uses.
    const factor = Math.exp(dy / K);
    const mid    = (grab.hi + grab.lo) / 2;
    let   span   = (grab.hi - grab.lo) * factor;

    if (grab.ext) {
      span = Math.min(Math.max(span, grab.ext.span / REEL_Y_ZOOM_MAX),
                      grab.ext.span * REEL_Y_ZOOM_MAX);
    }
    if (!isFinite(span) || span <= 0) return false;

    const cur = reel.lockY.get(ctx.name);
    if (cur && Math.abs((cur.hi - cur.lo) - span) < span * 1e-6) return false;
    // _userY marks a window the READER chose, as against the provisional one a
    // pan takes or the one full screen imposes to keep bar shape. chartFullClose
    // reads it to decide whether to carry the zoom back to the card.
    reel.lockY.set(ctx.name, { lo: mid - span / 2, hi: mid + span / 2, _userY: true });
    return true;
  }

  // A one-line note over the chart, for the case where a gesture correctly does
  // nothing and the reason is not on screen. Auto-clears; never stacks.
  function reelHint(host, text) {
    let el = host.querySelector('.reel-hint');
    if (!el) {
      el = document.createElement('div');
      el.className = 'reel-hint';
      host.appendChild(el);
    }
    el.textContent = text;
    clearTimeout(host._hintTimer);
    host._hintTimer = setTimeout(() => { if (el.parentNode) el.remove(); }, 2200);
  }

  function reelSvgPoint(host, ev) {
    const svg = host.querySelector('svg.reel-svg');
    const ctx = host._reelCtx;
    if (!svg || !ctx) return null;
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return {
      x: (ev.clientX - r.left) / r.width  * ctx.L.W,
      y: (ev.clientY - r.top)  / r.height * ctx.L.H,
      pxPerUnit: r.width / ctx.L.W,
    };
  }

  function reelWireChart(host) {
    if (host.dataset.gestureWired) return;
    host.dataset.gestureWired = '1';

    let mode = null;         // null | 'pan' | 'handle' | 'scroll' | 'yzoom'
    let handle = null;       // 'a' | 'b' | 'u' | 'd'
    let chIdx = -1;          // which channel the grabbed handle belongs to
    let moveStart = null;    // move handle: {orig, fi0, p0} captured at grab
    let tapPick = null;      // a line touched at pointerdown; selected only if it stays a tap
    const TAP_SLOP_PX = 8, TAP_MAX_MS = 600;
    let sx = 0, sy = 0, startPan = 0, pid = null, raf = 0;
    let grab = null;         // price window captured when the scale was grabbed
    // Every finger currently down, so a second one can turn the gesture into a
    // pinch. Keyed by pointerId; the values are updated in place on move.
    const pts = new Map();
    let pinch = null;        // spreads + windows captured when the 2nd finger landed

    // Coalesce redraws to one per frame. rAF is the right scheduler while the
    // page is visible, but a backgrounded or hidden tab never runs it — and a
    // drag that silently stops following the finger is worse than a slightly
    // coarser one, so a timeout takes over if the frame never arrives.
    const schedule = () => {
      if (raf) return;
      const run = () => { if (!raf) return; cancelAnimationFrame(raf); raf = 0; reelRepaint(host); };
      raf = requestAnimationFrame(run);
      setTimeout(run, 60);
    };

    host.addEventListener('pointerdown', ev => {
      const ctx = host._reelCtx;
      if (!ctx) return;
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

      // Second finger down: whatever this was becomes a pinch. A channel
      // handle is the exception — that drag is a deliberate edit and a stray
      // second touch must not turn it into a zoom.
      if (pts.size === 2 && mode !== 'handle') {
        const pair = [...pts.values()];
        mode  = 'pinch';
        pinch = {
          dx0:  Math.abs(pair[0].x - pair[1].x),
          dy0:  Math.abs(pair[0].y - pair[1].y),
          bars: reelWindowBars(ctx.bundle, ctx.name),
          lo:   ctx.sc.lo, hi: ctx.sc.hi,
          ext:  reelPriceExtent(ctx.b),
        };
        host.classList.add('is-pinching');
        try { host.setPointerCapture(ev.pointerId); } catch (_) {}
        return;
      }

      if (pid !== null) return;
      pid = ev.pointerId;
      sx = ev.clientX; sy = ev.clientY;
      startPan = reelPanOf(ctx.name);
      mode = null; handle = null;
      // Capture the price window as it stands right now. If this becomes a pan
      // that is the view we hold; if it turns out to be a scroll or a handle
      // drag, it is dropped again on pointerup.
      if (!reel.lockY.has(ctx.name)) {
        reel.lockY.set(ctx.name, { lo: ctx.sc.lo, hi: ctx.sc.hi, _provisional: true });
      }

      // A grab on the price scale wins immediately and is settled here, not on
      // the first move: the whole gesture is vertical, so the usual
      // horizontal-or-vertical decision would read it as a scroll and hand it
      // to the reel. Nothing is written to lockY yet — a TAP on the scale must
      // still fall through to opening the instrument, so the window is only
      // committed once the finger actually travels.
      // One grab serves every mode: the price window, the bar count and the
      // data extent as they stood the moment the finger landed. Every gesture
      // is measured from HERE rather than from the last frame, so nothing
      // compounds and a drag back to where it started lands where it started.
      grab = { lo: ctx.sc.lo, hi: ctx.sc.hi,
               bars: reelWindowBars(ctx.bundle, ctx.name),
               ext: reelPriceExtent(ctx.b), moved: false };

      if (ev.target && ev.target.dataset && ev.target.dataset.tgrip) {
        mode = 'tzoom';
        try { host.setPointerCapture(pid); } catch (_) {}
        return;
      }

      if (ev.target && ev.target.dataset && ev.target.dataset.ygrip) {
        mode = 'yzoom';
        // Capture keeps the drag alive after the first repaint, which rebuilds
        // the strip the pointer went down on. Guarded because it throws for a
        // pointer the browser no longer considers active — and an exception
        // here would abandon the gesture half-armed, leaving the chart
        // unresponsive until the next reload.
        try { host.setPointerCapture(pid); } catch (_) {}
        // Deliberately NO preventDefault here. It is what the handle branch
        // below does, and on the scale it broke both of the gestures that are
        // supposed to keep working: preventDefault on pointerdown suppresses
        // the synthesized click and dblclick, so a double-tap on the scale
        // stopped resetting the view and a single tap stopped opening the
        // instrument. Scrolling is already held off by `touch-action: none` on
        // the strip, and the drag itself calls preventDefault on the first
        // move — by which point we know it is a drag and not a tap.
        return;
      }

      // TAP A DRAWING TO SELECT IT (2026-09-11). Lock, Unlock and Clear act on
      // the ACTIVE drawing, and until now the only way to change which one that
      // was is to grab a handle — so on a chart carrying three drawings the
      // buttons silently meant the last one added. Touching any part of a line
      // now makes it active and opens editing, so its handles appear where you
      // just touched. Deliberately does NOT claim the gesture: no capture, no
      // preventDefault, no mode — a drag that happens to start on a line still
      // pans the chart exactly as it did before.
      //
      // ON A REAL TAP ONLY (2026-09-15). This used to select on pointerDOWN, so
      // a pan that merely started on a line — they are fat tap targets —
      // opened Draw mode and the properties pop-up in the middle of scrolling
      // the chart. Now the line is only remembered here, and finish() selects
      // it if the finger came up where it went down, quickly, without the
      // gesture having become a pan, a scroll or a handle drag.
      const _di = ev.target && ev.target.dataset ? ev.target.dataset.di : undefined;
      tapPick = (_di !== undefined && _di !== '' && !isNaN(+_di))
        ? { di: +_di, x: ev.clientX, y: ev.clientY, t: Date.now() } : null;

      // A handle grab wins immediately — no axis lock, because dragging a
      // handle straight up is a legitimate gesture and must not scroll away.
      if (reel.editing === ctx.name && ev.target && ev.target.dataset && ev.target.dataset.h) {
        mode = 'handle';
        handle = ev.target.dataset.h;
        // Grabbing any handle makes that channel the active one, so Lock and
        // Clear act on the channel you were just touching rather than on
        // whichever happened to be added last.
        chIdx = +ev.target.dataset.ci;
        if (!isNaN(chIdx)) setActiveIdx(ctx.name, chIdx);
        moveStart = null;
        if (handle === 'm') {
          const pt0 = reelSvgPoint(host, ev);
          const d0  = channelsFor(ctx.name)[chIdx];
          if (pt0 && d0) moveStart = {
            orig: JSON.parse(JSON.stringify(d0)),
            fi0:  (pt0.x - ctx.L.x0 - ctx.bw / 2) / ctx.bw,
            p0:   ctx.sc.inv(pt0.y),
          };
        }
        host.setPointerCapture(pid);
        ev.preventDefault();
      }
    });

    host.addEventListener('pointermove', ev => {
      const ctx = host._reelCtx;
      if (!ctx) return;
      const tracked = pts.get(ev.pointerId);
      if (tracked) { tracked.x = ev.clientX; tracked.y = ev.clientY; }

      // A pinch is driven by BOTH fingers, so it is handled before the
      // primary-pointer filter below — the second finger's moves would
      // otherwise be dropped and the gesture would follow one finger only.
      if (mode === 'pinch') {
        ev.preventDefault();
        if (pts.size >= 2 && reelApplyPinch(host, ctx, pinch, [...pts.values()].slice(0, 2))) schedule();
        return;
      }

      if (ev.pointerId !== pid) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;

      if (mode === 'yzoom') {
        ev.preventDefault();
        if (!grab.moved) {
          if (Math.abs(dy) < 2) return;    // a tap with a shiver is still a tap
          grab.moved = true;
          // The class goes on the HOST, not the grip: every repaint of this
          // drag rebuilds the grip from scratch, so a class set on it would
          // survive exactly one frame.
          host.classList.add('is-yzooming');
        }
        if (reelApplyYZoom(host, ctx, grab, dy)) schedule();
        return;
      }

      if (mode === 'tzoom') {
        ev.preventDefault();
        if (!grab.moved) {
          if (Math.abs(dx) < 2) return;
          grab.moved = true;
          host.classList.add('is-tzooming');
        }
        if (reelApplyTZoom(host, ctx, grab, dx)) schedule();
        return;
      }

      if (mode === null) {
        if (Math.abs(dx) < REEL_AXIS_LOCK_PX && Math.abs(dy) < REEL_AXIS_LOCK_PX) return;
        // Full screen has no feed behind it, so nothing else wants a vertical
        // drag and every direction can pan. On a CARD a straight vertical drag
        // still belongs to the reel's scrolling — but a drag that starts
        // sideways is ours, and from that point it may go anywhere, which is
        // what makes the chart draggable around the panel without taking the
        // scroll gesture away.
        const freeVertical = !!host.closest('#chartFull');
        mode = (freeVertical || Math.abs(dx) > Math.abs(dy)) ? 'pan' : 'scroll';
        if (mode === 'pan') {
          host.setPointerCapture(pid);
          host.classList.add('is-panning');
        }
      }
      if (mode === 'scroll') return;         // the feed keeps it
      ev.preventDefault();

      if (mode === 'pan') {
        // Drag RIGHT walks back through history, the way every chart behaves.
        const lk = reel.lockY.get(ctx.name);
        if (lk) delete lk._provisional;      // committed: this really is a pan
        const pt = reelSvgPoint(host, ev);
        const perBar = (pt ? pt.pxPerUnit : 1) * ctx.bw;
        // Grab the paper and pull it RIGHT and older bars come in from the
        // left, so a rightward drag INCREASES the offset into history. Window
        // WIDTH never changes here — resizing is the time scale's job.
        let moved = reelSetPan(ctx.name, startPan + dx / Math.max(0.0001, perBar), ctx.bundle);
        // ...and the same drag carries the price window up and down with it.
        if (reelApplyYPan(host, ctx, grab, dy)) moved = true;
        // Nothing off-screen to scroll to → nothing happens. The "Whole chart is
        // already shown" bubble that used to pop up here was removed at the
        // user's request (2026-09-15): black text sitting over the bars.
        if (moved) schedule();
        return;
      }

      // mode === 'handle'
      const pt = reelSvgPoint(host, ev);
      if (!pt) return;
      const list = channelsFor(ctx.name);
      const ch = list[chIdx] || activeChannel(ctx.name);
      if (!ch) return;
      const price = ctx.sc.inv(pt.y);
      const fi    = (pt.x - ctx.L.x0 - ctx.bw / 2) / ctx.bw;

      // The whole drawing, shape untouched.
      if (handle === 'm') {
        if (moveStart) reelShiftDrawing(ch, moveStart.orig, Math.round(fi - moveStart.fi0), price - moveStart.p0, ctx.b);
        schedule();
        return;
      }

      // A horizontal level is one number and one handle.
      if (ch.kind === 'hline') { ch.p = price; schedule(); return; }
      if (ch.kind === 'vline') {
        const dt = reelDateForBarIndex(ctx.b, Math.round(fi));
        if (dt) ch.t = dt;
        schedule();
        return;
      }

      // Entry: the × moves the whole marker and keeps its length in bars; the
      // far end only changes the length, and never crosses back past the ×.
      if (ch.kind === 'entry') {
        const iE = reelBarIndexForDate(ctx.b, ch.t), iR = reelBarIndexForDate(ctx.b, ch.t2);
        if (iE == null || iR == null) return;
        if (handle === 'e') {
          const to = Math.round(fi);
          const dt = reelDateForBarIndex(ctx.b, to);
          const dt2 = reelDateForBarIndex(ctx.b, to + (iR - iE));
          if (dt && dt2) { ch.t = dt; ch.t2 = dt2; }
          ch.p = price;
        } else if (handle === 'r') {
          const dt2 = reelDateForBarIndex(ctx.b, Math.max(fi, iE + 1));
          if (dt2) ch.t2 = dt2;
        }
        schedule();
        return;
      }

      // Ten price lines: line 1 and line 4 are the anchors, the rest follow.
      // Refuse a drag that would collapse them onto one price (they vanish).
      if (ch.kind === 'ladder') {
        const minGap = (ctx.sc.hi - ctx.sc.lo) * 0.01;
        if (handle === 'l1' && Math.abs(ch.p4 - price) >= minGap) ch.p1 = price;
        else if (handle === 'l4' && Math.abs(price - ch.p1) >= minGap) ch.p4 = price;
        schedule();
        return;
      }

      // A trend line is two anchors and nothing else — there is no offset to
      // solve back through, so the pointer's price IS the anchor price. Running
      // it through the channel branch read ch.up/ch.dn, which a trend does not
      // have, and wrote NaN into the anchor.
      if (ch.kind === 'trend') {
        const dt = reelDateForBarIndex(ctx.b, fi);
        if (dt) {
          if (handle === 'a') { ch.t1 = dt; ch.p1 = price; }
          else                { ch.t2 = dt; ch.p2 = price; }
        }
        schedule();
        return;
      }

      if (handle === 'a' || handle === 'b') {
        // The end handles ride the MIDLINE, so the pointer's price is where the
        // midline should land — the spine sits (up+dn)/2 away from it.
        const d = reelDateForBarIndex(ctx.b, fi);
        const spine = price - (ch.up + ch.dn) / 2;
        if (d) { if (handle === 'a') { ch.t1 = d; ch.p1 = spine; } else { ch.t2 = d; ch.p2 = spine; } }
      } else {
        // An EDGE handle. ONLY its own offset changes — the opposite edge does
        // not move, which is the whole point of storing two of them.
        const i1 = reelBarIndexForDate(ctx.b, ch.t1);
        const i2 = reelBarIndexForDate(ctx.b, ch.t2);
        if (i1 != null && i2 != null && Math.abs(i2 - i1) > 1e-6) {
          const spinePrice = ch.p1 + (ch.p2 - ch.p1) * (fi - i1) / (i2 - i1);
          const unitPx = Math.abs(ctx.sc.y(spinePrice + 1) - ctx.sc.y(spinePrice)) || 1;
          const minGap = CH_MIN_SPAN / unitPx;   // in price
          const want   = price - spinePrice;
          // The edges may not be dragged through one another, or onto the same
          // pixels: past the stop, the edge being dragged parks minGap clear of
          // the other one — which still leaves the OTHER one where it was.
          if (handle === 'u') ch.up = Math.max(want, ch.dn + minGap);
          else                ch.dn = Math.min(want, ch.up - minGap);
        }
      }
      schedule();
    });

    const finish = ev => {
      pts.delete(ev.pointerId);

      if (mode === 'pinch') {
        tapPick = null;
        if (pts.size >= 2) return;              // a third finger left; still pinching
        reel.lastGestureAt = Date.now();        // never let a pinch open the instrument
        host.classList.remove('is-pinching', 'is-yzooming', 'is-tzooming', 'is-panning');
        try { host.releasePointerCapture(ev.pointerId); } catch (_) {}
        mode = null; pinch = null; grab = null; handle = null; chIdx = -1; pid = null;
        return;
      }

      if (ev.pointerId !== pid) return;
      const pick = tapPick; tapPick = null;
      const wasTap = !!pick && ev.type === 'pointerup' && mode === null
        && Math.hypot(ev.clientX - pick.x, ev.clientY - pick.y) <= TAP_SLOP_PX
        && Date.now() - pick.t <= TAP_MAX_MS;
      // A gesture that never became a pan leaves the axis free to fit again.
      const c = host._reelCtx;
      if (c) {
        const lk = reel.lockY.get(c.name);
        if (lk && lk._provisional) { reel.lockY.delete(c.name); reelRepaint(host); }
      }
      // After a handle drag the properties row follows the drawing just moved —
      // grabbing a handle selects that drawing, and the row must say so.
      if (mode === 'handle') { channelSave(); reelSyncChannelButtons(); }
      if (wasTap && c && channelsFor(c.name)[pick.di]) {
        setActiveIdx(c.name, pick.di);
        reel.editing = c.name;
        // The click that follows this pointerup must not open the instrument.
        reel.lastGestureAt = Date.now();
        reelRepaint(host);
        reelSyncChannelButtons();
      }
      // Suppresses the click that a drag inevitably ends with, which would
      // otherwise open the instrument modal every time you panned. A grab on
      // the price scale that never moved is NOT suppressed — it was a tap, and
      // taps on the chart open the instrument.
      if (mode === 'pan' || mode === 'handle' ||
          ((mode === 'yzoom' || mode === 'tzoom') && grab && grab.moved)) {
        reel.lastGestureAt = Date.now();
      }
      host.classList.remove('is-yzooming', 'is-tzooming', 'is-panning', 'is-pinching');
      try { host.releasePointerCapture(pid); } catch (_) {}
      pid = null; mode = null; handle = null; chIdx = -1; grab = null; moveStart = null;
    };
    host.addEventListener('pointerup', finish);
    host.addEventListener('pointercancel', finish);

    // The price-scale drag deliberately does NOT preventDefault on pointerdown
    // (it would kill the tap and double-tap). Native drag-and-drop is the one
    // default that has to be stopped anyway: starting it mid-gesture fires
    // pointercancel and the stretch dies halfway through the drag.
    host.addEventListener('dragstart', ev => ev.preventDefault());

    // Double-tap / double-click snaps back to the newest bar.
    host.addEventListener('dblclick', () => {
      const ctx = host._reelCtx;
      if (!ctx || (!reelPanOf(ctx.name) && !reel.lockY.has(ctx.name) &&
                   !reel.tzoom.has(ctx.name))) return;
      reel.pan.delete(ctx.name);
      reel.lockY.delete(ctx.name);
      reel.tzoom.delete(ctx.name);
      reelRepaint(host);
    });
  }

  function reelObserve() {
    if (reel.io) reel.io.disconnect();
    // rootMargin pre-paints roughly one screen either side, so a normal scroll
    // never lands on a blank card.
    reel.io = new IntersectionObserver(entries => {
      for (const e of entries) {
        const idx = +e.target.dataset.idx;
        if (e.isIntersecting) {
          reelPaint(idx);
        } else if (reel.drawn.size > 24) {
          // Keep the DOM light on a 700-card reel: drop the SVG of cards well
          // out of view. The shell keeps its height, so scroll position holds.
          const host = document.getElementById('reelChart-' + idx);
          if (host && host.dataset.painted && reel.drawn.has(idx)) {
            host.innerHTML = '<div class="reel-skel"><span></span></div>';
            delete host.dataset.painted;
            reel.drawn.delete(idx);
          }
        }
      }
    }, { root: null, rootMargin: '120% 0px', threshold: 0 });

    document.querySelectorAll('#chartReel .reel-card').forEach(el => reel.io.observe(el));

    // Belt and braces: if the observer is not delivering, scrolling still
    // paints. Cheap — reelPaint early-exits on anything already drawn.
    const host = document.getElementById('chartReel');
    if (host && !host.dataset.scrollWired) {
      host.dataset.scrollWired = '1';
      host.addEventListener('scroll', debounce(reelPaintVisible, 120), { passive: true });
    }
  }

  // The pane is a fixed layer, so it needs the topbar's real height — which
  // moves with the notch inset and the tf-switch row. Measured, not assumed.
  function reelSyncTop() {
    const bar = document.querySelector('.topbar-stack');
    if (!bar) return;
    const h = Math.round(bar.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty('--reel-top', h + 'px');
  }

  function buildReel() {
    reelSyncTop();
    const host = document.getElementById('chartReel');
    const empty = document.getElementById('reelEmpty');
    const count = document.getElementById('reelCount');
    if (!host) return;

    reel.list = reelFiltered();
    reel.drawn.clear();

    if (count) {
      count.textContent = reel.list.length + (reel.list.length === 1 ? ' chart' : ' charts');
    }
    if (!reel.list.length) {
      host.innerHTML = '';
      if (empty) empty.style.display = '';
      reelSyncNav();
      return;
    }
    if (empty) empty.style.display = 'none';

    host.innerHTML = reel.list.map(reelCardHtml).join('');
    reelObserve();
    // Paint what is already on screen directly. IntersectionObserver is
    // supposed to deliver an initial callback for every observed target, but
    // it is asynchronous and, in some engines, does not fire at all until the
    // page is composited — which left the first card spinning forever. The
    // observer still handles everything the reader scrolls to.
    reelPaintVisible();
    reelSyncPills();
    reelSyncNav();
  }

  // Drop every drawn chart and redraw what is on screen — for changes that
  // alter the drawing but not the list (range, resize).
  function reelRepaintAll() {
    document.querySelectorAll('#chartReel .reel-chart[data-painted]').forEach(el => {
      el.innerHTML = '<div class="reel-skel"><span></span></div>';
      delete el.dataset.painted;
    });
    reel.drawn.clear();
    reelPaintVisible();
  }

  // Paint every card intersecting the viewport right now.
  function reelPaintVisible() {
    document.querySelectorAll('#chartReel .reel-card').forEach(c => {
      const r = c.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) reelPaint(+c.dataset.idx);
    });
  }

  // Rebuild without losing the reader's place — used on timeframe flip, where
  // the instrument under your thumb should stay under your thumb.
  function reelRebuildKeepingPlace(anchorName) {
    const host = document.getElementById('chartReel');
    if (!host || !host.children.length) { buildReel(); return; }
    if (!anchorName) anchorName = reelVisibleName();
    buildReel();
    if (!anchorName) return;
    const el = host.querySelector(`.reel-card[data-name="${CSS.escape(anchorName)}"]`);
    if (!el) return;
    // Position the container directly rather than scrollIntoView, which can
    // scroll the page around the fixed pane instead of the reel itself.
    host.scrollTop = el.offsetTop - host.offsetTop;
    reelPaintVisible();
    reelSyncNav();
  }

  function reelVisibleName() {
    const cards = document.querySelectorAll('#chartReel .reel-card');
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (r.bottom > window.innerHeight * 0.35) return c.dataset.name;
    }
    return null;
  }

  // ── Filter wiring ────────────────────────────────────────────────────

  // ── Reel navigation: one chart at a time ──────────────────────────────────
  // The reel is a snap container (scroll-snap-type: y mandatory) whose cards are
  // each 100% of its height, so "next chart" is exactly one clientHeight. Done
  // by scrolling rather than by index because the scroll position is the single
  // source of truth — a flick, a wheel, a key and a tap all move the same thing,
  // and nothing can drift out of sync with a separately tracked index.
  function reelStepBy(dir) {
    const el = document.getElementById('chartReel');
    if (!el || !el.clientHeight) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ top: dir * el.clientHeight, behavior: reduce ? 'auto' : 'smooth' });
    // Refresh the buttons and the counter once the scroll has settled rather
    // than leaving it to the scroll event. Relying on that alone left `prev`
    // stuck disabled after stepping down — one step forward and no way back —
    // wherever those events are throttled or suppressed.
    clearTimeout(reel._navSettle);
    reel._navSettle = setTimeout(() => {
      reelSyncNav();
      // Paint whatever we landed on rather than waiting on the
      // IntersectionObserver. Stepping is a scroll, so the observer
      // normally handles it — but this is the same insurance the nav
      // state needed, and an unpainted chart is the one failure a reader
      // cannot work around. reelPaint no-ops on anything already drawn.
      reelPaintVisible();
    }, reduce ? 0 : 420);
  }

  function reelSyncNav() {
    const el   = document.getElementById('chartReel');
    const nav  = document.getElementById('reelNav');
    const pos  = document.getElementById('reelNavPos');
    // The step buttons are gone; nothing here may require them any more, or the
    // counter and the scroll sync go with them.
    if (!el || !nav) return;
    // Back-history sees every settle, including a one-chart search result —
    // which is exactly how you usually get to a chart — so it runs BEFORE the
    // single-chart early return below.
    if (!chartFullName) {
      const rb0 = el.getBoundingClientRect();
      let best = null, bestOv = 0;
      for (const c of el.querySelectorAll('.reel-card')) {
        const b = c.getBoundingClientRect();
        const ov = Math.min(b.bottom, rb0.bottom) - Math.max(b.top, rb0.top);
        if (ov > bestOv) { bestOv = ov; best = c; }
      }
      if (best) chartHistNote(best.dataset.name);
    }

    const total = reel.list ? reel.list.length : 0;
    // One chart cannot be stepped through, and no charts must not show a "0/0".
    nav.hidden = total < 2;
    if (nav.hidden) return;

    // Park it on the top-left corner of the visible CHART, measured live.
    // Two fixed positions were wrong before this: against the pane it landed on
    // the search box (the filter bar between them changes height when its pills
    // wrap), and against the reel it landed on the instrument name. The top-left
    // of the plot itself is the one corner that is reliably empty. This already
    // re-runs on scroll and on resize, so it tracks.
    // The chart with the MOST of itself inside the reel's viewport — not the
    // first one that is partly visible. Scrolled even slightly, the first
    // partly-visible card is the PREVIOUS one sliding off the top, and its top
    // edge is negative, so the counter was being positioned above the visible
    // area and vanished on every card but the first.
    const anc = nav.offsetParent;
    const rb  = el.getBoundingClientRect();
    let host = null, bestOverlap = 0;
    for (const c of el.querySelectorAll('.reel-chart')) {
      const b = c.getBoundingClientRect();
      if (b.height <= 0) continue;
      const overlap = Math.min(b.bottom, rb.bottom) - Math.max(b.top, rb.top);
      if (overlap > bestOverlap) { bestOverlap = overlap; host = c; }
    }
    if (anc && host) {
      const hb = host.getBoundingClientRect(), ab = anc.getBoundingClientRect();
      nav.style.top  = Math.round(hb.top  - ab.top  + 6) + 'px';
      nav.style.left = Math.round(hb.left - ab.left + 8) + 'px';
    }

    const h = el.clientHeight || 1;
    // 2px of slack: snap positions land on sub-pixel offsets, and an exact
    // comparison leaves the end button live with nowhere to go.
    if (pos) {
      const idx = Math.min(total, Math.max(1, Math.round(el.scrollTop / h) + 1));
      pos.textContent = `${idx}/${total}`;
    }
  }

  function wireReelNav() {
    const el = document.getElementById('chartReel');
    if (!el) return;

    const simClear = document.getElementById('reelSimClear');
    if (simClear) simClear.addEventListener('click', clearSimilarCharts);

    // Coalesced to one run per frame: a smooth scroll fires this continuously
    // and the handler reads layout. rAF is the right scheduler while the page
    // is being drawn — but it never fires in a tab that is hidden or
    // backgrounded, and scrolling still happens there, so a timeout takes over
    // if the frame does not arrive. Without it the counter silently freezes on
    // whatever card it last saw. Same belt-and-braces as reelWireChart's
    // schedule(), and for the same reason.
    let ticking = 0;
    el.addEventListener('scroll', () => {
      if (ticking) return;
      const run = () => { if (!ticking) return; cancelAnimationFrame(ticking); ticking = 0; reelSyncNav(); };
      ticking = requestAnimationFrame(run);
      setTimeout(run, 80);
    }, { passive: true });

    window.addEventListener('resize', reelSyncNav);

    document.addEventListener('keydown', e => {
      if (currentTab !== 'charts') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Never steal a key from something the user is typing into — the reel's
      // own search box lives on this tab.
      // e.target is not necessarily an Element — a key delivered with nothing
      // focused targets `document`, which has no .matches, and the raw call
      // threw TypeError and killed the handler silently.
      const t = e.target;
      if (t && typeof t.matches === 'function' &&
          (t.matches('input, textarea, select') || t.isContentEditable)) return;
      if (t && t.isContentEditable) return;
      // A sheet or modal over the reel owns the arrows while it is open.
      if (document.querySelector('.sheet.open, .modal.open, .filter-pill[open]')) return;
      const down = e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j';
      const up   = e.key === 'ArrowUp'   || e.key === 'PageUp'   || e.key === 'k';
      if (!down && !up) return;
      e.preventDefault();
      // Full screen steps to the next chart in place instead of scrolling the reel behind it.
      if (chartFullName) { chartFullStep(down ? 1 : -1); return; }
      reelStepBy(down ? 1 : -1);
    });
  }

  // ── Back to the previous chart (2026-09-15) ───────────────────────────
  // A chart counts as "used" once you have stayed on it for CHART_HIST_DWELL_MS
  // — flicking past twenty charts on the way to one is not twenty visits. The
  // entry is instrument AND timeframe, so switching AVGO from Daily to Weekly
  // is a step Back can undo. Back walks one step further each press, like a
  // browser's back button; in memory for this visit only.
  const CHART_HIST_DWELL_MS = 1200;
  const CHART_HIST_MAX = 30;
  const chartHist = { back: [], cur: null, pending: null, timer: 0, jumping: false };

  function chartHistNote(name) {
    if (!name || currentTab !== 'charts') return;
    const here = { name, tf: timeframe };
    if (chartHist.cur && chartHist.cur.name === name && chartHist.cur.tf === timeframe) {
      clearTimeout(chartHist.timer); chartHist.pending = null;
      return;
    }
    if (chartHist.pending && chartHist.pending.name === name && chartHist.pending.tf === timeframe) return;
    chartHist.pending = here;
    clearTimeout(chartHist.timer);
    // Arriving by Back is not a new visit — it must not push the chart you left.
    const delay = chartHist.jumping ? 0 : CHART_HIST_DWELL_MS;
    chartHist.timer = setTimeout(() => {
      const p = chartHist.pending;
      chartHist.pending = null;
      if (!p) return;
      if (chartHist.cur && !chartHist.jumping) {
        chartHist.back.push(chartHist.cur);
        if (chartHist.back.length > CHART_HIST_MAX) chartHist.back.shift();
      }
      chartHist.jumping = false;
      chartHist.cur = p;
      chartHistSyncButtons();
    }, delay);
  }

  function chartHistLabel(e) {
    return e ? `${e.name} · ${(TF_BY_CODE[e.tf] || {}).label || e.tf}` : '';
  }

  function chartBackBtnHtml() {
    const prev = chartHist.back[chartHist.back.length - 1];
    return `<button class="reel-share-btn reel-back-btn" data-act="chart-back" aria-label="Back to previous chart"${prev ? ` title="Back to ${chartHistLabel(prev)}"` : ' hidden'}>${ICON_BACK}</button>`;
  }

  function chartHistSyncButtons() {
    const prev = chartHist.back[chartHist.back.length - 1];
    document.querySelectorAll('[data-act="chart-back"]').forEach(b => {
      b.hidden = !prev;
      if (prev) b.title = 'Back to ' + chartHistLabel(prev);
    });
  }

  function chartGoBack() {
    const target = chartHist.back.pop();
    if (!target) { chartHistSyncButtons(); return; }
    clearTimeout(chartHist.timer); chartHist.pending = null;
    chartHist.jumping = true;
    const full = !!chartFullName;
    if (target.tf !== timeframe && isTf(target.tf)) setTimeframe(target.tf, target.name);
    const host = document.getElementById('chartReel');
    const find = () => host && host.querySelector(`.reel-card[data-name="${CSS.escape(target.name)}"]`);
    let el = find();
    // Filtered out since (a search, a pill): clear the filters rather than
    // leave Back doing nothing.
    if (!el) {
      const rst = document.getElementById('reelReset');
      if (rst) rst.click();
      el = find();
    }
    if (host && el) {
      host.scrollTop = el.offsetTop - host.offsetTop;
      reelPaintVisible();
      reelSyncNav();
    }
    if (full) chartFullOpen(target.name);
    // Settle straight onto the target as the current chart.
    chartHist.cur = null;
    chartHistNote(target.name);
    chartHistSyncButtons();
  }

  // Open the Charts tab showing this instrument and the charts most like it,
  // in similarity order. The modal could only ever LIST the lookalikes; the
  // whole reason to know GOLD looks like SA40 is to put the two charts in
  // front of your eyes, which is what the reel is for.
  // Open the Charts tab ON this instrument. Clears any "lookalikes" filter
  // first — landing inside a comparison set you did not ask for is disorienting
  // — then rebuilds and scrolls the reel to the card.
  function openChartFor(name) {
    if (!name) return;
    reel.similarTo = '';
    closeModal();
    navigateToTab('charts');
    buildReel();
    reelSyncSimBar();
    const host = document.getElementById('chartReel');
    const find = () => host && host.querySelector(`.reel-card[data-name="${CSS.escape(name)}"]`);
    let el = find();
    // A search or pill left on the Charts tab can hide the very chart asked
    // for, and the reel then sat on whatever was first — "Chart" on MSFT
    // showed AVGO (2026-09-15). Clear the filters in that case, and only then.
    if (!el) {
      const rst = document.getElementById('reelReset');
      if (rst) rst.click();
      el = find();
    }
    if (host && el) {
      // Position the container itself; scrollIntoView can scroll the page
      // around the fixed pane instead of the reel.
      host.scrollTop = el.offsetTop - host.offsetTop;
    }
    reelPaintVisible();
    reelSyncNav();
  }

  function showSimilarCharts(name) {
    if (!name || !shapeNeighbours(name).length) return;
    reel.similarTo = name;
    closeModal();
    navigateToTab('charts');
    buildReel();
    const el = document.getElementById('chartReel');
    if (el) el.scrollTop = 0;          // start on the instrument you came from
    reelSyncSimBar();
    reelSyncNav();
  }

  function clearSimilarCharts() {
    if (!reel.similarTo) return;
    reel.similarTo = '';
    buildReel();
    const el = document.getElementById('chartReel');
    if (el) el.scrollTop = 0;
    reelSyncSimBar();
    reelSyncNav();
  }

  // ★ Starred pill (2026-09-15): the same filter as Show → Starred, one tap
  // away. It is a shortcut onto reel.scope, not a second filter, so the two can
  // never disagree.
  function reelSyncStarPill() {
    const pill = document.getElementById('reelStarPill');
    if (!pill) return;
    const on = reel.scope === 'starred';
    pill.classList.toggle('on', on);
    pill.setAttribute('aria-pressed', on ? 'true' : 'false');
    const n = pill.querySelector('.fp-val');
    if (n) n.textContent = userStarred.size ? ' ' + userStarred.size : '';
  }

  function reelSyncSimBar() {
    const bar = document.getElementById('reelSimBar');
    const nm  = document.getElementById('reelSimName');
    if (!bar || !nm) return;
    bar.hidden = !reel.similarTo;
    if (reel.similarTo) nm.textContent = reel.similarTo;
  }

  function reelSyncPills() {
    reelSyncSimBar();
    const set = (id, txt) => {
      const el = document.querySelector('#' + id + ' .fp-val');
      if (el) el.textContent = txt ? ' · ' + txt : '';
    };
    const scopeLbl = { all: '', today: 'today', signal: 'signals', buy: 'buys',
                       sell: 'sells', watch: 'watch',
                       // Starred is announced by the gold ★ Starred pill itself;
                       // repeating it here widened Show enough to wrap the
                       // filter bar onto a third row on a phone.
                       starred: '' };
    set('reelPillScope', scopeLbl[reel.scope] || '');
    set('reelPillTrend', reel.trend === 'all' ? '' : reel.trend.toLowerCase());
    const stackLbl = { all: '', bull: 'bull', bear: 'bear', mixed: 'mixed',
                       near: 'near cross', fresh: 'just flipped' };
    set('reelPillStack', stackLbl[reel.stack] || '');
    const sortLbl = { signal: '', recent: 'newest', move: 'move', name: 'A–Z' };
    set('reelPillSort', sortLbl[reel.sort] || '');
    set('reelPillRange', reel.range ? reel.range + ' bars' : '');
    const cv = document.querySelector('#reelPillClass .fp-cv');
    if (cv) cv.textContent = reel.cat ? ' · ' + reel.cat : '';

    reelSyncStarPill();
    const dirty = reel.scope !== 'all' || reel.cat || reel.trend !== 'all' ||
                  reel.stack !== 'all' || reel.similarTo ||
                  reel.sort !== 'signal' || reel.search || reel.range;
    const rst = document.getElementById('reelReset');
    if (rst) rst.style.display = dirty ? '' : 'none';
  }

  function wireReel() {
    try {
      const savedRange = parseInt(localStorage.getItem('swingpulse-reel-range') || '0', 10);
      if (savedRange > 0) {
        reel.range = savedRange;
        const box = document.getElementById('reelRangeOpts');
        if (box) {
          box.querySelectorAll('.reel-opt').forEach(b => b.classList.remove('active'));
          const m = box.querySelector(`[data-range="${savedRange}"]`);
          if (m) m.classList.add('active');
        }
      }
    } catch (_) {}

    const search = document.getElementById('reelSearch');
    const clear  = document.getElementById('reelSearchClear');
    if (search) {
      search.addEventListener('input', debounce(() => {
        reel.search = search.value.trim().toLowerCase();
        if (clear) clear.style.display = reel.search ? '' : 'none';
        buildReel();
      }, 220));
    }
    if (clear) {
      clear.addEventListener('click', () => {
        search.value = ''; reel.search = '';
        clear.style.display = 'none';
        buildReel();
      });
    }

    const optGroup = (containerId, key, attr) => {
      const box = document.getElementById(containerId);
      if (!box) return;
      box.addEventListener('click', e => {
        const btn = e.target.closest('.reel-opt');
        if (!btn) return;
        box.querySelectorAll('.reel-opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        reel[key] = btn.dataset[attr];
        const pill = btn.closest('.filter-pill');
        if (pill) pill.open = false;
        buildReel();
      });
    };
    optGroup('reelScopeOpts', 'scope', 'scope');
    const starPill = document.getElementById('reelStarPill');
    if (starPill) {
      starPill.addEventListener('click', () => {
        reel.scope = reel.scope === 'starred' ? 'all' : 'starred';
        const box = document.getElementById('reelScopeOpts');
        if (box) box.querySelectorAll('.reel-opt').forEach(b =>
          b.classList.toggle('active', b.dataset.scope === reel.scope));
        buildReel();
        const el = document.getElementById('chartReel');
        if (el) el.scrollTop = 0;
        reelSyncNav();
      });
    }
    optGroup('reelTrendOpts', 'trend', 'trend');
    optGroup('reelStackOpts', 'stack', 'stack');
    optGroup('reelSortOpts',  'sort',  'sort');

    // Range is the only filter that changes nothing about WHICH instruments
    // are listed — just how much history each card draws — so it repaints in
    // place instead of rebuilding the list.
    const rangeBox = document.getElementById('reelRangeOpts');
    if (rangeBox) {
      rangeBox.addEventListener('click', e => {
        const btn = e.target.closest('.reel-opt');
        if (!btn) return;
        rangeBox.querySelectorAll('.reel-opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        reel.range = +btn.dataset.range || 0;
        reelResetPan();       // a different window width makes old offsets meaningless
        try { localStorage.setItem('swingpulse-reel-range', String(reel.range)); } catch (_) {}
        const pill = btn.closest('.filter-pill');
        if (pill) pill.open = false;
        reelRepaintAll();
        reelSyncPills();
      });
    }

    const chips = document.getElementById('reelCatChips');
    if (chips) {
      chips.addEventListener('click', e => {
        const chip = e.target.closest('.s-cat-chip');
        if (!chip) return;
        const cat = chip.dataset.cat;
        const on = reel.cat === cat;
        chips.querySelectorAll('.s-cat-chip').forEach(c => c.classList.remove('active'));
        reel.cat = on ? '' : cat;             // tapping the active chip clears it
        if (!on) chip.classList.add('active');
        buildReel();
      });
    }

    window.addEventListener('resize', debounce(() => {
      if (currentTab !== 'charts') return;
      reelSyncTop();
      // Card height changed, so every drawn chart's viewBox aspect is stale.
      document.querySelectorAll('#chartReel .reel-chart[data-painted]').forEach(el => {
        el.innerHTML = '<div class="reel-skel"><span></span></div>';
        delete el.dataset.painted;
      });
      reel.drawn.clear();
      reelPaintVisible();
    }, 250));

    const rst = document.getElementById('reelReset');
    if (rst) {
      rst.addEventListener('click', () => {
        reel.scope = 'all'; reel.cat = ''; reel.trend = 'all'; reel.sort = 'signal';
        reel.search = ''; reel.range = 0; reelResetPan();
        // Reset was missing both of these: the Stack pill (added with the MA
        // stack filter) and the compare mode. "Reset" that leaves a filter
        // applied is worse than no reset — you press it and still cannot see
        // the instrument you are looking for.
        reel.stack = 'all'; reel.similarTo = '';
        try { localStorage.removeItem('swingpulse-reel-range'); } catch (_) {}
        const rbox = document.getElementById('reelRangeOpts');
        if (rbox) {
          rbox.querySelectorAll('.reel-opt').forEach(b => b.classList.remove('active'));
          const d = rbox.querySelector('[data-range="0"]');
          if (d) d.classList.add('active');
        }
        if (search) search.value = '';
        if (clear) clear.style.display = 'none';
        document.querySelectorAll('#reelCatChips .s-cat-chip').forEach(c => c.classList.remove('active'));
        [['reelScopeOpts','all'],['reelTrendOpts','all'],['reelStackOpts','all'],['reelSortOpts','signal']].forEach(([id, def]) => {
          const box = document.getElementById(id);
          if (!box) return;
          box.querySelectorAll('.reel-opt').forEach(b => b.classList.remove('active'));
          const d = box.querySelector(`[data-scope="${def}"],[data-trend="${def}"],[data-stack="${def}"],[data-sort="${def}"]`);
          if (d) d.classList.add('active');
        });
        buildReel();
      });
    }

    // ONE dispatch for the card buttons, used by the reel AND by the full-screen
    // view — the two must never drift into doing different things.
    // Returns true when it handled the click.
    window.__reelBtnAct = function (e) {
      // .reel-share-btn lives in the card HEADER, so it is matched here too —
      // it is not a .reel-act and closest('.reel-act') silently skipped it.
      const btn = e.target.closest('.reel-act, .reel-share-btn, .reel-tool, .reel-tf-tag, .reel-tf-opt');
      if (!btn) return false;
      const name = btn.dataset.name;
      if (btn.dataset.act === 'tf-menu') { reelTfMenuToggle(btn); return true; }
      if (btn.dataset.act === 'tf-set')  { reelTfMenuClose(); reelSwitchTf(name, btn.dataset.tf); return true; }
      if (btn.dataset.act === 'tv')     { window.SP.openTvPicker(btn, name); return true; }
      if (btn.dataset.act === 'detail') { window.SP.openModal(name); return true; }
      if (btn.dataset.act === 'star')   {
        window.SP.toggleStar(name);
        return true;
      }
      const cardEl = btn.closest('.reel-card');
      const chHost = cardEl && cardEl.querySelector('.reel-chart');
      if (btn.dataset.act === 'chart-back')    { chartGoBack(); return true; }
      if (btn.dataset.act === 'chart-expand')  { chartFullOpen(name); return true; }
      if (btn.dataset.act === 'chart-share')   { shareChartImage(name, chHost); return true; }
      // Anything that CHANGES this chart's drawings commits its seeds first —
      // the two channels a chart opens with are not in the store until then, so
      // without this Delete quietly did nothing (clearChannelFor returns early
      // when the chart has no stored list), a colour or a lock was written to an
      // object nothing saves, and adding a drawing created the stored list from
      // scratch and took both seeded channels off the chart. Opening Draw mode
      // is NOT in this list: looking at the tools changes nothing.
      if (DRAW_MUTATING_ACTS.has(btn.dataset.act)) channelSeedCommit(name);
      if (btn.dataset.act === 'channel')       { channelToggleEdit(name, chHost); return true; }
      if (btn.dataset.act === 'channel-add')   { channelAdd(name, chHost, btn.dataset.kind); return true; }
      if (btn.dataset.act === 'draw-lock')   { const d = activeChannel(name); if (d) channelSetLocked(name, !d.locked, chHost); return true; }
      if (btn.dataset.act === 'draw-undo') { drawHistoryStep(name, chHost, -1); return true; }
      if (btn.dataset.act === 'draw-redo') { drawHistoryStep(name, chHost, 1); return true; }
      if (btn.dataset.act === 'draw-dup')  { channelDuplicate(name, chHost); return true; }
      if (btn.dataset.act === 'draw-bold') {
        const d = activeChannel(name);
        if (d && DRAW_BOLDABLE.has(d.kind)) {
          if (d.bold) delete d.bold; else d.bold = true;
          channelSave();
          if (chHost) reelRepaint(chHost);
          reelSyncChannelButtons();
        }
        return true;
      }
      if (btn.dataset.act === 'draw-labels') {
        const d = activeChannel(name);
        if (d && d.kind === 'ladder') {
          if (d.hideLabels) delete d.hideLabels; else d.hideLabels = true;
          channelSave();
          if (chHost) reelRepaint(chHost);
          reelSyncChannelButtons();
        }
        return true;
      }
      if (btn.dataset.act === 'draw-delete') { channelClear(name, chHost); return true; }
      if (btn.dataset.act === 'draw-color')  {
        const d = activeChannel(name);
        if (d && DRAW_COLORS.includes(btn.dataset.color)) {
          d.color = btn.dataset.color;
          channelSave();
          if (chHost) reelRepaint(chHost);
          reelSyncChannelButtons();
        }
        return true;
      }
      return false;
    };

    // Card actions — delegated, so re-rendering the reel never orphans them.
    const host = document.getElementById('chartReel');
    if (host) {
      host.addEventListener('click', e => {
        if (window.__reelBtnAct(e)) return;
        // Tapping the chart itself opens the full instrument view — but a pan
        // or a handle drag ends in a click too, and while a channel is being
        // edited every tap on the chart is aimed at the channel, not the modal.
        const card = e.target.closest('.reel-card');
        if (!card || !e.target.closest('.reel-chart')) return;
        if (reel.editing === card.dataset.name) return;
        if (Date.now() - (reel.lastGestureAt || 0) < 350) return;
        window.SP.openModal(card.dataset.name);
      });
    }
  }


  // ── Filter dropdown clamping ─────────────────────────────────────────
  // Every .filter-pop opens left-anchored under its pill, which runs off the
  // right of a narrow screen for a pill near the right edge. The old fix
  // right-aligned the LAST pill, which broke the moment the pill rows wrapped:
  // the last pill is then the leftmost one on row two, and right-aligning sent
  // its menu off the left of the screen. So measure where it actually landed
  // and slide it back inside. Applies to both tabs' pills — same class.
  function clampFilterPop(pill) {
    const pop = pill.querySelector('.filter-pop');
    if (!pop) return;
    pop.style.transform = '';           // measure un-nudged
    const margin = 8;
    const r = pop.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    let dx = 0;
    if (r.right > vw - margin) dx = (vw - margin) - r.right;   // pull left
    if (r.left + dx < margin)  dx = margin - r.left;           // but never past the left edge
    if (dx) pop.style.transform = `translateX(${Math.round(dx)}px)`;
  }

  function wireFilterPopClamp() {
    // `toggle` does not bubble, so listen in the capture phase.
    document.addEventListener('toggle', e => {
      const pill = e.target;
      if (!(pill instanceof HTMLElement) || !pill.classList.contains('filter-pill')) return;
      if (pill.open) clampFilterPop(pill);
    }, true);

    window.addEventListener('resize', debounce(() => {
      document.querySelectorAll('.filter-pill[open]').forEach(clampFilterPop);
    }, 150));
  }

  // Wired here, not with the other boot wiring: `reel` is declared in this
  // block, so an earlier call would hit its temporal dead zone.
  wireReel();
  wireReelNav();
  wireFilterPopClamp();

})();
