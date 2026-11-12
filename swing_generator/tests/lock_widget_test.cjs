// The Scriptable lock-screen widget (ios-widget/swingpulse-lock-widget.js):
// its % must match the app's Watchlist (app.js wlQuote), and the script must
// run end to end against stand-ins for Scriptable's objects.
// Run: node tests/lock_widget_test.cjs   (not in CI; the widget is not deployed)
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const src = fs.readFileSync(path.join(__dirname, '../ios-widget/swingpulse-lock-widget.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const load = scope => new AsyncFunction(...Object.keys(scope), `${src}\nreturn { namesFromParameter, percentFor, loadPercents, formatPercent, run };`)(...Object.values(scope));

(async () => {
  const W = await load({});

  // Parameter: any separator, upper-cased, first 4; empty falls back to the default.
  assert.deepEqual(W.namesFromParameter(' btcusd, ethusd us100;gold, silver '), ['BTCUSD', 'ETHUSD', 'US100', 'GOLD']);
  assert.deepEqual(W.namesFromParameter(''), ['BTCUSD', 'ETHUSD', 'US100', 'GOLD']);
  assert.deepEqual(W.namesFromParameter(null), ['BTCUSD', 'ETHUSD', 'US100', 'GOLD']);

  // % as wlQuote: newest price, live or published, against the previous close.
  const run = { p: 110, pc: 100, t: '2026-11-12 07:00', y: 'NQ=F', b: 5, yc: '^NDX' };
  const t0 = Date.parse('2026-11-12T07:00:00Z') / 1000;
  const near = (a, b, msg) => assert.ok(a != null && Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);
  near(W.percentFor(run, {}), 10, 'no live print: published price');
  near(W.percentFor(run, { 'NQ=F': [125, t0 + 60] }), 20, 'live future shifted by b');
  near(W.percentFor(run, { 'NQ=F': [125, t0 + 60], '^NDX': [121, t0 + 120] }), 21, 'newer cash print wins, unshifted');
  near(W.percentFor(run, { 'NQ=F': [125, t0 - 600] }), 10, 'a live print older than the run is ignored');
  near(W.percentFor(run, { 'NQ=F': [NaN, t0 + 60] }), 10, 'a broken live print is ignored');
  assert.equal(W.percentFor(undefined, {}), null, 'unknown instrument');
  assert.equal(W.percentFor({ p: 1, pc: 0 }, {}), null, 'no previous close');

  assert.equal(W.formatPercent(-0.5371), '−0.54%');
  assert.equal(W.formatPercent(0.63), '+0.63%');
  assert.equal(W.formatPercent(-0.004), '+0.00%', 'a rounded zero is not shown as negative');
  assert.equal(W.formatPercent(null), '—');

  // Live feed down: the published prices still give a %.
  const rows = { q: { GOLD: { p: 3953.68, pc: 3973.6, t: '2026-11-12 06:55', y: 'GC=F', b: 17.819, yc: 'XAUT-USD' } } };
  const offline = { json: async url => { if (url.includes('/live')) throw new Error('down'); return rows; } };
  const got = await W.loadPercents(['GOLD', 'NOPE'], offline);
  assert.equal(W.formatPercent(got[0].pct), '−0.50%');
  assert.equal(got[1].pct, null);

  // End to end inside stand-ins for Scriptable: the widget is built and set,
  // and a failed download falls back to the last values for that parameter.
  const texts = [];
  let setWidget = null, files = {}, fail = false;
  class Stack {
    addStack() { return new Stack(); } addText(t) { texts.push(t); return {}; } addSpacer() {}
    layoutVertically() {} layoutHorizontally() {} centerAlignContent() {} setPadding() {}
  }
  const scope = {
    args: { widgetParameter: 'gold' },
    config: { runsInAccessoryWidget: true, widgetFamily: 'accessoryRectangular' },
    Script: { setWidget: w => { setWidget = w; }, complete() {} },
    ListWidget: Stack,
    Font: { boldSystemFont: n => n, systemFont: n => n },
    Color: { white: () => '#fff' },
    Request: class { constructor(u) { this.u = u; } async loadJSON() { if (fail) throw new Error('offline'); return this.u.includes('/live') ? {} : rows; } },
    FileManager: { local: () => ({
      joinPath: (a, b) => a + '/' + b, cacheDirectory: () => '/c',
      fileExists: p => p in files, readString: p => files[p], writeString: (p, s) => { files[p] = s; },
    }) },
  };
  await load(scope);   // with Script defined, the file runs itself
  assert.ok(setWidget, 'widget set');
  assert.deepEqual(texts, ['GOLD', '−0.50%']);
  texts.length = 0; fail = true;
  await load(scope);   // with Script defined, the file runs itself
  assert.deepEqual(texts, ['GOLD', '−0.50%'], 'offline: last values for this parameter');
  texts.length = 0; files = {};
  await load(scope);   // with Script defined, the file runs itself
  assert.deepEqual(texts, ['GOLD', '—'], 'offline with nothing saved: a dash, not a crash');
  console.log('PASS: lock widget % matches the Watchlist, parameter, offline fallback, Scriptable run');
})().catch(e => { console.error(e); process.exit(1); });
