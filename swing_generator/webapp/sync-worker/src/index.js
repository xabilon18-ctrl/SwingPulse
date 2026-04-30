/**
 * SwingPulse Sync Worker
 *
 * GET  /sync?user=zabs                → returns user's JSON blob
 * PUT  /sync?user=zabs                → saves user's JSON blob (X-Sync-Secret)
 * GET  /sync/health                   → health check
 * POST /push/subscribe?user=zabs      → store push subscription
 * DEL  /push/subscribe?user=zabs      → remove all subscriptions for user
 * POST /push/notify                   → fan-out empty push to all subs (X-Sync-Secret)
 */

const ALLOWED_USERS = ['zabs', 'hemi'];

const VAPID_PUBLIC  = 'BOO2qQLHIMhVkOKGkL2ClLs2RPVz_Lc5y10woA_OaU0FdAoFVYU4ZrWDy-OSzg6-TBgxELpbmKlrsahsdlN4i_w';
const VAPID_PRIVATE = '_D9SgDHEQDDsT8Cym_PK5cmLogChXxiNHXRfZmRxEHw';
const VAPID_SUBJECT = 'mailto:xabilon18@gmail.com';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Secret',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ─── base64url helpers ──────────────────────────────────────────────────────
function b64uToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
function bytesToB64u(b) {
  return btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── VAPID JWT signing ──────────────────────────────────────────────────────
let _vapidKey;
async function vapidPrivateKey() {
  if (_vapidKey) return _vapidKey;
  const dBytes  = b64uToBytes(VAPID_PRIVATE);
  const xyBytes = b64uToBytes(VAPID_PUBLIC); // 0x04 || x || y
  const x = xyBytes.slice(1, 33);
  const y = xyBytes.slice(33, 65);
  _vapidKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC', crv: 'P-256',
      d: bytesToB64u(dBytes),
      x: bytesToB64u(x),
      y: bytesToB64u(y),
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  return _vapidKey;
}

async function vapidJwt(audience) {
  const key = await vapidPrivateKey();
  const header  = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: VAPID_SUBJECT,
  };
  const enc = new TextEncoder();
  const headerB64  = bytesToB64u(enc.encode(JSON.stringify(header)));
  const payloadB64 = bytesToB64u(enc.encode(JSON.stringify(payload)));
  const unsigned = `${headerB64}.${payloadB64}`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    enc.encode(unsigned),
  );
  return `${unsigned}.${bytesToB64u(sig)}`;
}

// ─── Fan-out push (no payload — SW fetches details itself) ─────────────────
async function sendOne(sub) {
  try {
    const u = new URL(sub.endpoint);
    const audience = `${u.protocol}//${u.host}`;
    const jwt = await vapidJwt(audience);
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Authorization':   `vapid t=${jwt}, k=${VAPID_PUBLIC}`,
        'Crypto-Key':      `p256ecdsa=${VAPID_PUBLIC}`,
        'TTL':             '600',
        'Content-Length':  '0',
      },
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, err: String(e) };
  }
}

// ─── Subscription key helper ────────────────────────────────────────────────
function subKey(user, endpoint) {
  // Hash the endpoint to a fixed-length key
  let h = 0;
  for (let i = 0; i < endpoint.length; i++) {
    h = ((h << 5) - h + endpoint.charCodeAt(i)) | 0;
  }
  return `push:${user}:${Math.abs(h).toString(36)}`;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url  = new URL(request.url);
    const path = url.pathname;

    // ─── Health ─────────────────────────────────────────────────────────────
    if (path === '/sync/health') {
      return json({ ok: true, ts: Date.now() });
    }

    // ─── Push: Subscribe / Unsubscribe ──────────────────────────────────────
    if (path === '/push/subscribe') {
      const user = (url.searchParams.get('user') || '').toLowerCase().trim();
      if (!ALLOWED_USERS.includes(user)) return json({ error: 'Unknown user' }, 403);

      if (request.method === 'POST') {
        const sub = await request.json();
        if (!sub.endpoint) return json({ error: 'Missing endpoint' }, 400);
        const key = subKey(user, sub.endpoint);
        await env.USER_DATA.put(key, JSON.stringify(sub), { expirationTtl: 60 * 60 * 24 * 90 });
        return json({ ok: true });
      }
      if (request.method === 'DELETE') {
        const list = await env.USER_DATA.list({ prefix: `push:${user}:` });
        for (const k of list.keys) await env.USER_DATA.delete(k.name);
        return json({ ok: true, deleted: list.keys.length });
      }
    }

    // ─── Push: Notify (fan-out) ─────────────────────────────────────────────
    if (path === '/push/notify' && request.method === 'POST') {
      const secret = request.headers.get('X-Sync-Secret');
      if (!secret || secret !== env.SYNC_SECRET) {
        return json({ error: 'Unauthorized' }, 401);
      }
      const list = await env.USER_DATA.list({ prefix: 'push:' });
      const results = { sent: 0, failed: 0, expired: 0 };
      for (const k of list.keys) {
        const raw = await env.USER_DATA.get(k.name);
        if (!raw) continue;
        const sub = JSON.parse(raw);
        const r = await sendOne(sub);
        if (r.ok) results.sent++;
        else if (r.status === 410 || r.status === 404) {
          results.expired++;
          await env.USER_DATA.delete(k.name);
        } else {
          results.failed++;
        }
      }
      return json(results);
    }

    // ─── Sync: existing user-data store ─────────────────────────────────────
    if (path === '/sync') {
      const user = (url.searchParams.get('user') || '').toLowerCase().trim();
      if (!ALLOWED_USERS.includes(user)) return json({ error: 'Unknown user' }, 403);

      if (request.method === 'GET') {
        const raw = await env.USER_DATA.get(user);
        return json(raw ? JSON.parse(raw) : {});
      }
      if (request.method === 'PUT') {
        const secret = request.headers.get('X-Sync-Secret');
        if (!secret || secret !== env.SYNC_SECRET) {
          return json({ error: 'Unauthorized' }, 401);
        }
        let body;
        try {
          body = await request.text();
          JSON.parse(body);
        } catch {
          return json({ error: 'Invalid JSON' }, 400);
        }
        await env.USER_DATA.put(user, body);
        return json({ ok: true });
      }
    }

    return json({ error: 'Not found' }, 404);
  },
};
