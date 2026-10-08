const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../webapp/static/js/app.js'), 'utf8');
const code = source.slice(source.indexOf('  async function chartFullRefresh()'), source.indexOf('  async function chartFullOpen('));

async function main() {
  const host = { innerHTML: 'old candles', _reelItem: { instrument_name: 'BTC' } };
  const item = { instrument_name: 'BTC', price: 123 };
  const bundle = { c: [100, 123] };
  const context = vm.createContext({
    chartFullName: 'BTC', timeframe: '30m', reelDataVersion: 'new publish',
    chartFullEl: () => ({ querySelector: () => host }),
    reelLoadChunk: async () => ({ BTC: bundle }), ovOtherTf: () => null,
    allData: [item], reelChartSvg: b => 'candles: ' + b.c.join(','),
    chartFullSyncButtons: () => {},
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
