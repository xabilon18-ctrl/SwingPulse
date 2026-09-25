/**
 * SwingPulse run scheduler — see wrangler.toml for the why.
 *
 * scheduled  → POST /repos/{REPO}/actions/workflows/{WORKFLOW}/dispatches
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
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

async function livePrices(url) {
  const syms = [...new Set((url.searchParams.get('s') || '').split(',')
    .map(x => x.trim()).filter(x => /^[A-Za-z0-9^=.\-]{1,20}$/.test(x)))].slice(0, LIVE_MAX);
  const out = {};
  const batches = [];
  for (let i = 0; i < syms.length; i += LIVE_BATCH) batches.push(syms.slice(i, i + LIVE_BATCH));
  await Promise.all(batches.map(async b => {
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
  }));
  return new Response(JSON.stringify(out), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });
}

export default {
  async scheduled(event, env, ctx) {
    if (!env.GH_TOKEN) { console.error('GH_TOKEN secret is not set'); return; }
    ctx.waitUntil(dispatch(env, event.cron));
  },
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/live') return livePrices(url);
    return new Response('swingpulse-cron: dispatches publish.yml every 30 min, 05:00-23:00 SAST Mon-Fri, every 3h 06:00-21:00 Sat+Sun\n',
                        { headers: { 'content-type': 'text/plain' } });
  },
};
