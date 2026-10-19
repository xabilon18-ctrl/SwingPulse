// The live-price Worker (cron-worker /live), offline: crypto symbols go to the
// exchange their chart reads, everything else to Yahoo as before (2026-10-19).
import assert from 'node:assert/strict';
import worker from '../webapp/cron-worker/src/index.js';

const seen = [];
globalThis.fetch = async url => {
  url = String(url);
  seen.push(url);
  const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  if (url.startsWith('https://data-api.binance.vision/api/v3/ticker/price'))
    return json([{ symbol: 'XRPUSDT', price: '1.3083' }, { symbol: 'POLUSDT', price: '0.21' }, { symbol: 'OTHER', price: '9' }]);
  if (url === 'https://api.exchange.coinbase.com/products/BTC-USD/ticker')
    return json({ price: '82305.83', time: '2026-10-19T10:00:00.000Z' });
  if (url.startsWith('https://query1.finance.yahoo.com/v8/finance/spark'))
    return json({ AAPL: { timestamp: [1792400000], close: [255.5] } });
  return new Response('not found', { status: 404 });
};

const res = await worker.fetch(new Request('https://w/live?s=BINANCE:XRPUSDT,BINANCE:POLUSDT,BINANCE:GONEUSDT,COINBASE:BTCUSD,AAPL'));
const out = await res.json();
assert.deepEqual(Object.keys(out).sort(), ['AAPL', 'BINANCE:POLUSDT', 'BINANCE:XRPUSDT', 'COINBASE:BTCUSD']);
assert.equal(out['BINANCE:XRPUSDT'][0], 1.3083);
assert.ok(Math.abs(out['BINANCE:XRPUSDT'][1] - Date.now() / 1000) < 5, 'Binance price is stamped now');
assert.deepEqual(out['COINBASE:BTCUSD'], [82305.83, Date.parse('2026-10-19T10:00:00Z') / 1000]);
assert.deepEqual(out.AAPL, [255.5, 1792400000]);
// One Binance request for all its pairs (a delisted one cannot fail the rest),
// and no crypto symbol is ever sent to Yahoo.
assert.equal(seen.filter(u => u.includes('binance')).length, 1);
assert.ok(seen.filter(u => u.includes('yahoo')).every(u => !u.includes('BINANCE') && !u.includes('COINBASE')));
console.log('PASS: live prices — Binance and Coinbase pairs from their exchanges, the rest from Yahoo');
