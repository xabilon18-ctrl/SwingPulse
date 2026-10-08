const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '../webapp/static/js/app.js'), 'utf8');
const live = source.slice(source.indexOf('  async function wlPollLive()'), source.indexOf('  function wlAgeTag('));
const json = source.slice(source.indexOf('  function fetchJson('), source.indexOf('  // Retry loop'));

async function main() {
  const label = { textContent: '' };
  let timer;
  const context = vm.createContext({
    AbortController, Number, Set, Date, Error,
    setTimeout: fn => { timer = fn; return 1; }, clearTimeout: () => {},
    wlLiveBusy: false, currentTab: 'watchlist',
    document: { hidden: false, getElementById: () => label },
    quotesData: { q: { Bitcoin: { y: 'BTC-USD' } } },
    wlVisibleNames: () => ['Bitcoin'], wlLive: {}, wlLiveAt: 0,
    wlPaintLive: () => {}, WL_LIVE_URL: 'https://example.test/live',
    WL_LIVE_TIMEOUT_MS: 12000, FETCH_TIMEOUT_MS: 15000,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  });
  vm.runInContext(live + json, context);
  await context.wlPollLive();
  assert.equal(context.wlLiveAt, 0, 'Empty responses must not claim a refresh');
  assert.match(label.textContent, /unavailable/);
  context.fetch = async () => ({ ok: false });
  await context.wlPollLive();
  assert.equal(context.wlLiveAt, 0, 'HTTP failures must not claim a refresh');
  context.fetch = async () => ({ ok: true, json: async () => ({ 'BTC-USD': [123, 1000] }) });
  await context.wlPollLive();
  assert.equal(context.wlLive.Bitcoin.p, 123);
  assert.ok(context.wlLiveAt > 0);
  context.fetch = (_, opts) => new Promise((resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const pending = context.wlPollLive();
  assert.equal(context.wlLiveBusy, true);
  timer();
  await pending;
  assert.equal(context.wlLiveBusy, false, 'Timeout must release polling lock');
  const data = context.fetchJson('/api/summary', null);
  timer();
  assert.equal(await data, null, 'Data requests must time out without AbortSignal.timeout');
  console.log('Price refresh checks passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
