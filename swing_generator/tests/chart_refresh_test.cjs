const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../webapp/static/js/app.js'), 'utf8');
const code = source.slice(source.indexOf('  async function chartFullRefresh()'), source.indexOf('  async function chartFullOpen('));

async function main() {
  const display = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('  function reelDisplayBundle('), source.indexOf('  // Build the whole chart as one SVG string.')), display);
  const closed = {t:['2026-10-10 08:00'],o:[10],h:[12],l:[9],c:[11],p:[50],ms:3,mi:[0],m:[[10]],sg:[[0,'B1']],forming:{t:'2026-10-10 12:00',o:11,h:14,l:10,c:13,m:[10.5]}};
  const snapshot = JSON.stringify(closed);
  const shown = display.reelDisplayBundle(closed);
  assert.equal(shown.c.at(-1),13);
  assert.equal(shown.m[0].at(-1),10.5);
  assert.equal(JSON.stringify(closed),snapshot,'Rendering must not change signal data');
  assert.equal(display.reelDisplayBundle(shown),shown,'Repaints must not duplicate the candle');
  assert.equal(shown.sg,closed.sg,'Signal indices remain on completed bars');
  // NEXT BAR FROM THE LIVE PRICE (2026-11-27): the forming hour has closed
  // and the run that adds the next one has not landed.
  const stretch = source.slice(source.indexOf('  function reelDisplayBundle('), source.indexOf('  // Build the whole chart as one SVG string.'));
  const ts = v => { const t = String(v).trim(); return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(t) ? t + 'T00:00:00Z' : t.replace(' ', 'T') + (/Z$/.test(t) ? '' : 'Z')); };
  let price = null;
  const live = vm.createContext({ freshness: { timestamp: ts },
    reelLivePrice: (name, c0, from, until) => price && price.at >= from && price.at < until ? price.p : null,
    reelLiveForming: (b) => b.forming, reelLiveLastBar: () => null });
  vm.runInContext(stretch, live);
  const hourly = { t: ['2026-11-26 08:00', '2026-11-27 06:00'], o: [1, 100], h: [1, 101], l: [1, 99], c: [1, 100], p: [2], ms: 1, mi: [0, 1], m: [[1, 50]],
    forming: { t: '2026-11-27 07:00', closes_at: '2026-11-27T08:00:00Z', o: 100, h: 103, l: 98, c: 102, m: [101] } };
  price = { at: ts('2026-11-27 08:14'), p: 104 };
  let next = live.reelDisplayBundle(hourly, 'BTC', '1H');
  assert.deepEqual([next.t.at(-1), next.o.at(-1), next.c.at(-1), next.h.at(-1), next.l.at(-1)], ['2026-11-27 08:00', 102, 104, 104, 102]);
  assert.equal(next.t.at(-2), '2026-11-27 07:00', 'the closed forming hour stays before it');
  assert.equal(next.m[0].at(-1), (102 + 104) / 2, 'its MA point follows the price');
  assert.equal(next._live, true, 'the new hour is marked live');
  price = { at: ts('2026-11-27 08:20'), p: 101 };
  next = live.reelDisplayBundle(next, 'BTC', '1H');
  assert.deepEqual([next.c.at(-1), next.h.at(-1), next.l.at(-1)], [101, 104, 101], 'high and low keep every price seen');
  assert.equal(next.t.length, 4, 'a repaint redoes the bar, it does not add another');
  // A market that did not trade that hour a day earlier (a stock after its close) gets no bar.
  const stock = { ...hourly, t: ['2026-11-25 08:00', '2026-11-27 06:00'] };
  assert.equal(live.reelDisplayBundle(stock, 'AAPL', '1H').t.length, 3);
  // No live price in the next hour: the chart is as published, not marked live.
  price = null;
  assert.equal(live.reelDisplayBundle(hourly, 'BTC', '1H')._live, undefined);
  // Daily: the UTC day has turned before the run added the new day.
  const daily = { t: ['2026-11-21', '2026-11-26'], o: [1, 60], h: [1, 62], l: [1, 59], c: [1, 61], p: [2], ms: 1, mi: [0, 1], m: [[1, 31]] };
  price = { at: ts('2026-11-27 00:10'), p: 63 };
  next = live.reelDisplayBundle(daily, 'BTC', 'D');
  assert.deepEqual([next.t.at(-1), next.o.at(-1), next.c.at(-1)], ['2026-11-27', 61, 63]);
  assert.equal(next._live, true, 'the new day is marked live');

  const host = { innerHTML: 'old candles', _reelItem: { instrument_name: 'BTC' } };
  const item = { instrument_name: 'BTC', price: 123 };
  const bundle = { c: [100, 123] };
  const context = vm.createContext({
    chartFullName: 'BTC', timeframe: '30m', reelDataVersion: 'new publish',
    chartFullEl: () => ({ querySelector: () => host }),
    reelLoadChunk: async () => ({ BTC: bundle }), ovLoadHtf: async () => {},
    allData: [item], reelChartSvg: b => 'candles: ' + b.c.join(','),
    chartFullSyncButtons: () => {}, reelMatchPhoneStrokes: () => {},
  });
  vm.runInContext(code, context);
  await context.chartFullRefresh();
  assert.equal(host.innerHTML, 'candles: 100,123');
  assert.equal(host._reelItem, item);
  let finish;
  context.reelLoadChunk = () => new Promise(resolve => { finish = resolve; });
  const pending = context.chartFullRefresh();
  context.chartFullName = 'AAPL';
  host.innerHTML = 'AAPL candles';
  finish({ BTC: bundle });
  await pending;
  assert.equal(host.innerHTML, 'AAPL candles', 'Late response must not overwrite a different chart');
  assert.match(source, /renderAll\(\);\s+await chartFullRefresh\(\);/);
  console.log('Expanded chart refresh checks passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
