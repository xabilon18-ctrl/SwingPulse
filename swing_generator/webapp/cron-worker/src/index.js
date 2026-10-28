/**
 * SwingPulse run scheduler — see wrangler.toml for the why.
 *
 * scheduled  → POST /repos/{REPO}/actions/workflows/{WORKFLOW}/dispatches
 *              (:05 always; :35 only when no run started since — see backup)
 * GET /      → a one-line health check (no secrets, no side effects)
 */
async function dispatch(env, reason) {
  const res = await fetch(
    `https://api.github.com/repos/${env.REPO}/actions/workflows/${env.WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GH_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'swingpulse-cron',
      },
      body: JSON.stringify({ ref: env.REF }),
    });
  // 204 = accepted. Anything else is logged (wrangler tail / dashboard logs).
  if (res.status !== 204) {
    console.error(`dispatch failed (${reason}): ${res.status} ${await res.text()}`);
  } else {
    console.log(`dispatched (${reason})`);
  }
  return res.status;
}

/**
 * Backup at :35 (2026-10-20). The :05 dispatch is a single attempt, and on
 * 2026-10-20 the 14:05 one never reached GitHub — no run, no failure, so the
 * Publish Watchdog (which fires on a run COMPLETING) saw nothing and the app sat
 * on 13:05 data until 15:05. Here: if no run on REF was created in the last 45
 * minutes, dispatch one. A healthy :05 run was created 30 minutes earlier, so
 * this normally does nothing. If GitHub cannot be asked, dispatch anyway — the
 * publish concurrency group makes a second run wait instead of overlapping.
 * A recent run that already FINISHED without success is retried too
 * (2026-10-28: the 10:05 and 11:05 runs failed and :35 skipped both, because
 * all it asked was whether a run had been created). One still running is left
 * alone; if it fails after :35 the next :05 is the retry.
 */
const BACKUP_CRON = '35 * * * *', RECENT_MS = 45 * 60000;

async function backup(env, reason, now = Date.now()) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${env.REPO}/actions/workflows/${env.WORKFLOW}/runs?branch=${encodeURIComponent(env.REF)}&per_page=1`,
      {
        headers: {
          'Authorization': `Bearer ${env.GH_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'swingpulse-cron',
        },
      });
    if (res.ok) {
      const run = (await res.json()).workflow_runs?.[0];
      const last = Date.parse(run?.created_at);
      if (now - last < RECENT_MS) {
        if (run.status !== 'completed' || run.conclusion === 'success') {
          console.log(`backup not needed (${reason}): last run created ${new Date(last).toISOString()}, ${run.conclusion || run.status}`);
          return 0;
        }
        return dispatch(env, `${reason} retry of ${run.conclusion} run ${run.id}`);
      }
    } else {
      console.error(`backup check failed (${reason}): ${res.status}`);
    }
  } catch (err) {
    console.error(`backup check failed (${reason}): ${err}`);
  }
  return dispatch(env, reason + ' backup');
}

/**
 * GET /live?s=SYM,SYM,...  → {"SYM": [lastPrice, unixSeconds], ...}
 *
 * Live prices for the app's Watchlist (2026-09-24). Browsers cannot call
 * Yahoo directly (no CORS), so this relays its spark endpoint: 20 symbols per
 * upstream request (Yahoo answers 400 above that), range=1d&interval=5m
 * (~34 KB per 20 symbols). NB range=1h came back EMPTY when called from
 * Cloudflare (measured 2026-09-24) — it only worked from a home connection.
 * A symbol whose market printed nothing in the last hour is simply absent;
 * the app keeps the last published price for it. Capped at 200 symbols a call
 * (10 upstream requests; the free plan allows 50 subrequests).
 */
const LIVE_MAX = 200, LIVE_BATCH = 20;
// Crypto comes from the exchange the user's TradingView chart reads
// (exchange_feed.py, 2026-10-19): quotes.json names it as 'BINANCE:XRPUSDT' or
// 'COINBASE:BTCUSD'. Binance through its market-data host (api.binance.com
// refuses some locations); ONE request for every Binance price, so a delisted
// pair can never fail the others. Coinbase per product.
const BINANCE_PRICES = 'https://data-api.binance.vision/api/v3/ticker/price';
const COINBASE_PRODUCTS = 'https://api.exchange.coinbase.com/products/';

async function exchangePrices(syms, out) {
  const binance = syms.filter(s => s.startsWith('BINANCE:'));
  const coinbase = syms.filter(s => s.startsWith('COINBASE:'));
  const jobs = [];
  if (binance.length) jobs.push((async () => {
    try {
      const r = await fetch(BINANCE_PRICES);
      if (!r.ok) return;
      const want = new Set(binance.map(s => s.slice(8)));
      const now = Math.floor(Date.now() / 1000);   // the price is current as of this request
      for (const { symbol, price } of await r.json()) {
        const px = Number(price);
        if (want.has(symbol) && px > 0) out['BINANCE:' + symbol] = [px, now];
      }
    } catch (_) { /* leaves these symbols out; the app keeps the published price */ }
  })());
  for (const sym of coinbase) jobs.push((async () => {
    try {
      const pair = sym.slice(9), product = pair.slice(0, -3) + '-' + pair.slice(-3);
      const r = await fetch(COINBASE_PRODUCTS + product + '/ticker', { headers: { 'User-Agent': 'SwingPulse/1.0' } });
      if (!r.ok) return;
      const j = await r.json(), px = Number(j.price), t = Math.floor(Date.parse(j.time) / 1000);
      if (px > 0 && t > 0) out[sym] = [px, t];
    } catch (_) { /* as above */ }
  })());
  await Promise.all(jobs);
}
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

async function livePrices(url) {
  const syms = [...new Set((url.searchParams.get('s') || '').split(',')
    .map(x => x.trim()).filter(x => /^[A-Za-z0-9^=.:\-]{1,24}$/.test(x)))].slice(0, LIVE_MAX);
  const out = {};
  const yahoo = syms.filter(s => !s.includes(':'));
  const batches = [];
  for (let i = 0; i < yahoo.length; i += LIVE_BATCH) batches.push(yahoo.slice(i, i + LIVE_BATCH));
  const crypto = exchangePrices(syms.filter(s => s.includes(':')), out);
  await Promise.all([crypto, ...batches.map(async b => {
    try {
      const r = await fetch('https://query1.finance.yahoo.com/v8/finance/spark?symbols='
        + b.map(encodeURIComponent).join(',') + '&range=1d&interval=5m',
        { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) return;
      const j = await r.json();
      // Price: `fulldayPrice` (Yahoo's current price) when present, else the
      // last 5m close. Time: the last 5m bar's timestamp, which is what shows
      // a delayed or closed market for what it is.
      for (const [sym, v] of Object.entries(j || {})) {
        if (!v) continue;
        const ts = Array.isArray(v.timestamp) ? v.timestamp : [], cl = Array.isArray(v.close) ? v.close : [];
        let px = null, t = null;
        for (let k = cl.length - 1; k >= 0; k--) if (cl[k] != null) { px = cl[k]; t = ts[k]; break; }
        if (typeof v.fulldayPrice === 'number') px = v.fulldayPrice;
        if (px != null && t != null) out[sym] = [px, t];
      }
    } catch (_) { /* one failed batch just leaves its symbols out */ }
  })]);
  return new Response(JSON.stringify(out), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });
}

export default {
  async scheduled(event, env, ctx) {
    if (!env.GH_TOKEN) { console.error('GH_TOKEN secret is not set'); return; }
    ctx.waitUntil(event.cron === BACKUP_CRON ? backup(env, event.cron) : dispatch(env, event.cron));
  },
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/live') return livePrices(url);
    return new Response('swingpulse-cron: dispatches publish.yml at :05 every hour, 24/7 including weekends\n',
                        { headers: { 'content-type': 'text/plain' } });
  },
};
