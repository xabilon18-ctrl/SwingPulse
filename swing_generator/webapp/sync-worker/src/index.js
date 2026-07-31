/**
 * SwingPulse Sync Worker
 *
 * POST /sync/auth?user=zabs           → check (or claim) the user's password
 * GET  /sync?user=zabs                → returns user's JSON blob   (Bearer)
 * PUT  /sync?user=zabs                → saves user's JSON blob     (Bearer)
 * GET  /sync/health                   → health check
 * POST /push/subscribe?user=zabs      → store push subscription    (Bearer)
 * DEL  /push/subscribe?user=zabs      → remove all subs for user   (Bearer)
 * POST /push/notify                   → fan-out empty push to all subs (X-Sync-Secret)
 *
 * AUTH (2026-07-31). The browser used to send a single shared literal,
 * `X-Sync-Secret: swingpulse2026`, that was hard-coded in the PUBLIC app.js
 * bundle — anyone who opened the site could read it and then overwrite a
 * user's starred list and notes, or fan out push notifications to their
 * phones. GET needed no secret at all.
 *
 * Now the two capabilities are split:
 *   · Everything a BROWSER does is per-user. The client derives
 *     `token = sha256("swingpulse:" + user + ":" + password)` from a password
 *     the user types once per device and sends it as `Authorization: Bearer`.
 *     We store only sha256(token), so a KV dump is not a credential.
 *     Trust-on-first-use: the first token presented for a user CLAIMS the
 *     account (there is no registration flow for two known people), after
 *     which a mismatch is rejected and counted.
 *   · `/push/notify` stays server-to-server — CI holds `SYNC_SECRET` as a
 *     GitHub secret and no browser ever sends it.
 *
 * Brute force: MAX_FAILS wrong passwords per user per hour, then 429. That is
 * what keeps a short password honest, so don't remove it.
 */

const ALLOWED_USERS = ['zabs', 'hemi'];

// Public half of the VAPID pair is public by definition (it ships to the push
// service in every request and to the browser in applicationServerKey).
// The PRIVATE half lives in `wrangler secret put VAPID_PRIVATE` — it used to
// sit in this file in plaintext.
const VAPID_PUBLIC  = 'BOO2qQLHIMhVkOKGkL2ClLs2RPVz_Lc5y10woA_OaU0FdAoFVYU4ZrWDy-OSzg6-TBgxELpbmKlrsahsdlN4i_w';
const VAPID_SUBJECT = 'mailto:xabilon18@gmail.com';

const MAX_FAILS   = 10;          // wrong passwords per user…
const FAIL_WINDOW = 60 * 60;     // …per hour

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Sync-Secret',
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

// ─── Password auth (per user, trust-on-first-use) ───────────────────────────
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Length-independent compare so a wrong password can't be narrowed by timing.
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(h.trim());
  return m ? m[1] : '';
}

/**
 * Returns null when the caller may proceed, or a Response to return as-is.
 * `claimed` is set on the request-scoped `out` object when this call was the
 * one that set the account's password.
 */
async function authorize(request, env, user, out = {}) {
  const token = bearer(request);
  if (!token) return json({ error: 'auth_required' }, 401);

  const authKey = `auth:${user}`;
  const failKey = `fail:${user}`;
  const stored  = await env.USER_DATA.get(authKey);
  const hashed  = await sha256Hex(token);

  if (!stored) {                     // trust-on-first-use — this device sets it
    await env.USER_DATA.put(authKey, hashed);
    out.claimed = true;
    return null;
  }

  // The RIGHT password is honoured even while the account is rate-limited.
  // Checking the limit first would have let anyone lock the real owner out of
  // sync for an hour just by spamming wrong guesses — the limit exists to stop
  // guessing, and someone who already knows the password isn't guessing.
  if (sameSecret(stored, hashed)) {
    if (await env.USER_DATA.get(failKey)) await env.USER_DATA.delete(failKey);
    return null;
  }

  const fails = parseInt(await env.USER_DATA.get(failKey) || '0', 10);
  if (fails >= MAX_FAILS) {
    return json({ error: 'too_many_attempts', retry_after_s: FAIL_WINDOW }, 429);
  }
  await env.USER_DATA.put(failKey, String(fails + 1), { expirationTtl: FAIL_WINDOW });
  return json({ error: 'bad_password' }, 401);
}

// ─── VAPID JWT signing ──────────────────────────────────────────────────────
let _vapidKey;
async function vapidPrivateKey(env) {
  if (_vapidKey) return _vapidKey;
  if (!env.VAPID_PRIVATE) throw new Error('VAPID_PRIVATE secret is not set');
  const dBytes  = b64uToBytes(env.VAPID_PRIVATE);
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

async function vapidJwt(audience, env) {
  const key = await vapidPrivateKey(env);
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
async function sendOne(sub, env) {
  try {
    const u = new URL(sub.endpoint);
    const audience = `${u.protocol}//${u.host}`;
    const jwt = await vapidJwt(audience, env);
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

    // ─── Auth: check or claim a user's password ─────────────────────────────
    // The client calls this when the user types a password, so it can tell
    // "wrong password" from "offline" before it starts syncing.
    if (path === '/sync/auth' && request.method === 'POST') {
      const user = (url.searchParams.get('user') || '').toLowerCase().trim();
      if (!ALLOWED_USERS.includes(user)) return json({ error: 'Unknown user' }, 403);
      const out  = {};
      const deny = await authorize(request, env, user, out);
      if (deny) return deny;
      return json({ ok: true, claimed: !!out.claimed });
    }

    // ─── Push: Subscribe / Unsubscribe ──────────────────────────────────────
    if (path === '/push/subscribe') {
      const user = (url.searchParams.get('user') || '').toLowerCase().trim();
      if (!ALLOWED_USERS.includes(user)) return json({ error: 'Unknown user' }, 403);
      const deny = await authorize(request, env, user);
      if (deny) return deny;

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
        const r = await sendOne(sub, env);
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
      // Reads are behind the password too — the starred list and notes ARE the
      // private part, and GET used to be open to anyone with the URL.
      const deny = await authorize(request, env, user);
      if (deny) return deny;

      if (request.method === 'GET') {
        const raw = await env.USER_DATA.get(user);
        return json(raw ? JSON.parse(raw) : {});
      }
      if (request.method === 'PUT') {
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
