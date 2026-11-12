// SwingPulse lock-screen widget for the Scriptable iPhone app.
//
// Shows 4 instruments, symbol and today's % change, in a 2 x 2 grid.
// Add it twice (one "rectangular" lock-screen widget each) for 8 instruments.
// Which 4 it shows is the widget's Parameter, typed on the phone:
//   BTCUSD, ETHUSD, US100, GOLD
// Names are the app's own instrument names (as in the Watchlist).
//
// Today's % is worked out exactly as the app's Watchlist does (app.js
// wlQuote): the newest price, live or published, against the previous close.
//   published: quotes.json on R2 (refreshed by the hourly data run)
//   live:      the cron Worker's /live relay, the Watchlist's own price feed
//
// iOS, not this script, decides when a lock-screen widget refreshes (often
// every 15-60 minutes). It cannot refresh on lifting the phone.
//
// Setup and design notes: README.md in this folder.

const QUOTES_URL = 'https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev/ma500/quotes.json';
const LIVE_URL = 'https://swingpulse-cron.xabilon18.workers.dev/live';
const APP_URL = 'https://swingpulse200.pages.dev/';
const DEFAULT_NAMES = ['BTCUSD', 'ETHUSD', 'US100', 'GOLD'];
const REFRESH_MINUTES = 5;   // a request to iOS, not a promise

// ── Data ────────────────────────────────────────────────────────────────

function namesFromParameter(param) {
  const names = String(param || '')
    .split(/[\s,;]+/)
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
  return (names.length ? names : DEFAULT_NAMES).slice(0, 4);
}

function quoteTimeMs(t) {
  // quotes.json writes 'YYYY-MM-DD HH:MM' in UTC (freshness.js timestamp).
  if (typeof t !== 'string') return null;
  const ms = Date.parse(t.trim().replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? ms : null;
}

// One instrument's % from its quotes.json row and the /live answer.
function percentFor(row, live) {
  if (!row || row.p == null || !row.pc) return null;
  const ok = v => Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]) && v[1] > 0;
  const choices = [];
  if (row.y && ok(live[row.y])) choices.push({ p: live[row.y][0] - (row.b || 0), t: live[row.y][1] });
  if (row.yc && ok(live[row.yc])) choices.push({ p: live[row.yc][0], t: live[row.yc][1] });
  choices.sort((a, b) => b.t - a.t);
  const runMs = quoteTimeMs(row.t);
  const L = choices[0];
  const price = L && (runMs == null || L.t * 1000 >= runMs) ? L.p : row.p;
  return (price / row.pc - 1) * 100;
}

async function loadPercents(names, http) {
  const quotes = await http.json(QUOTES_URL + '?t=' + Date.now());
  const rows = (quotes && quotes.q) || {};
  const symbols = new Set();
  for (const n of names) {
    const r = rows[n];
    if (r && r.y) symbols.add(r.y);
    if (r && r.yc) symbols.add(r.yc);
  }
  let live = {};
  if (symbols.size) {
    // The live feed is a bonus: without it the published prices still stand.
    try { live = (await http.json(LIVE_URL + '?s=' + [...symbols].map(encodeURIComponent).join(','))) || {}; }
    catch (_) { live = {}; }
  }
  return names.map(n => ({ name: n, pct: percentFor(rows[n], live) }));
}

function formatPercent(pct) {
  if (pct == null || !Number.isFinite(pct)) return '—';
  const v = Math.abs(pct) < 0.005 ? 0 : pct;
  return (v < 0 ? '−' : '+') + Math.abs(v).toFixed(2) + '%';
}

// ── Widget (Scriptable only) ────────────────────────────────────────────

function cell(row, item) {
  const c = row.addStack();
  c.layoutVertically();
  c.centerAlignContent();
  const sym = c.addStack();
  sym.addSpacer();
  const s = sym.addText(item.name);
  s.font = Font.boldSystemFont(13);
  s.textColor = Color.white();
  s.lineLimit = 1;
  s.minimumScaleFactor = 0.7;
  sym.addSpacer();
  const val = c.addStack();
  val.addSpacer();
  const v = val.addText(formatPercent(item.pct));
  v.font = Font.systemFont(13);
  v.textColor = Color.white();
  v.lineLimit = 1;
  v.minimumScaleFactor = 0.7;
  val.addSpacer();
}

function buildWidget(items) {
  const w = new ListWidget();
  w.addAccessoryWidgetBackground = true;   // the lock screen's own frosted tile
  w.url = APP_URL;
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000);
  w.setPadding(4, 6, 4, 6);
  for (let r = 0; r < 2; r++) {
    if (r) w.addSpacer(3);
    const row = w.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();
    for (let c = 0; c < 2; c++) {
      const item = items[r * 2 + c];
      if (!item) continue;
      row.addSpacer();
      cell(row, item);
    }
    row.addSpacer();
  }
  return w;
}

// Last good values per widget, shown when the phone is offline.
function cache() {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.cacheDirectory(), 'swingpulse-lock-widget.json');
  return {
    read() { try { return fm.fileExists(path) ? JSON.parse(fm.readString(path)) : {}; } catch (_) { return {}; } },
    write(all) { try { fm.writeString(path, JSON.stringify(all)); } catch (_) { /* cache is a convenience */ } },
  };
}

async function run() {
  const names = namesFromParameter(args.widgetParameter);
  const key = names.join(',');
  const store = cache();
  const all = store.read();
  const http = { json: async url => { const r = new Request(url); r.timeoutInterval = 15; return r.loadJSON(); } };
  let items;
  try {
    items = await loadPercents(names, http);
    all[key] = items;
    store.write(all);
  } catch (_) {
    items = all[key] || names.map(n => ({ name: n, pct: null }));
  }
  const widget = buildWidget(items);
  if (config.runsInAccessoryWidget || config.runsInWidget) {
    Script.setWidget(widget);
  } else if (widget.presentAccessoryRectangular) {
    await widget.presentAccessoryRectangular();
  } else {
    await widget.presentSmall();
  }
  Script.complete();
}

// Scriptable runs the script; tests/lock_widget_test.cjs loads it without this.
if (typeof Script !== 'undefined') await run();
