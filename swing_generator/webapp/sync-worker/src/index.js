/**
 * SwingPulse Sync Worker
 * Stores per-user data (starred instruments, trades, notes) in Cloudflare KV.
 *
 * GET  /sync?user=zabs          → returns user's JSON blob
 * PUT  /sync?user=zabs          → saves user's JSON blob (requires X-Sync-Secret header)
 * GET  /sync/health             → health check
 */

const ALLOWED_USERS = ['zabs', 'hemi'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Secret',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Health check — no auth needed
    if (path === '/sync/health') {
      return json({ ok: true, ts: Date.now() });
    }

    if (path !== '/sync') {
      return json({ error: 'Not found' }, 404);
    }

    const user = (url.searchParams.get('user') || '').toLowerCase().trim();

    if (!ALLOWED_USERS.includes(user)) {
      return json({ error: 'Unknown user' }, 403);
    }

    // ── GET: read user data ────────────────────────────────────────────────
    if (request.method === 'GET') {
      const raw = await env.USER_DATA.get(user);
      return json(raw ? JSON.parse(raw) : {});
    }

    // ── PUT: write user data (auth required) ───────────────────────────────
    if (request.method === 'PUT') {
      const secret = request.headers.get('X-Sync-Secret');
      if (!secret || secret !== env.SYNC_SECRET) {
        return json({ error: 'Unauthorized' }, 401);
      }

      let body;
      try {
        body = await request.text();
        JSON.parse(body); // validate it's proper JSON before storing
      } catch {
        return json({ error: 'Invalid JSON' }, 400);
      }

      await env.USER_DATA.put(user, body);
      return json({ ok: true });
    }

    return json({ error: 'Method not allowed' }, 405);
  },
};
