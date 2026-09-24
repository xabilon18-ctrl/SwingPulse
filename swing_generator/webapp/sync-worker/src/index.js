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
 * POST /run?user=zabs                 → trigger the CI data pipeline   (Bearer)
 * GET  /run/status?user=zabs          → state of the latest CI run     (Bearer)
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

// ─── CI trigger ───────────────────────────────────────────────────────────────
// The workflow the app's "Run now" button dispatches. `xabilon18/SwingPulse`
// was retired 2026-06-01; this is the only repo.
const GH_REPO     = 'xabilon18-ctrl/SwingPulse';
const GH_WORKFLOW = 'publish.yml';
const GH_REF      = 'main';
// Slightly longer than a run takes (last measured 8m50s). Long enough that
// double-tapping cannot queue two, short enough to retry after a failure.
const RUN_COOLDOWN_MS = 10 * 60 * 1000;

function ghHeaders(env) {
  return {
    'Authorization': `Bearer ${env.GH_TOKEN}`,
    'Accept':        'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    // GitHub rejects an API request with no User-Agent.
    'User-Agent':    'swingpulse-sync-worker',
    'Content-Type':  'application/json',
  };
}

// The newest run of publish.yml, or {ok:false}. Never throws into a handler:
// a GitHub outage must not make the button look broken in a way that reads as
// "your password is wrong".
async function latestRun(env) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GH_REPO}/actions/workflows/${GH_WORKFLOW}` +
      `/runs?per_page=1`,
      { headers: ghHeaders(env) });
    if (!res.ok) return { ok: false, error: `github_${res.status}` };
    const data = await res.json();
    const run  = (data.workflow_runs || [])[0];
    if (!run) return { ok: true, status: 'none' };
    return {
      ok: true,
      id:         run.id,
      status:     run.status,          // queued | in_progress | completed
      conclusion: run.conclusion,      // success | failure | cancelled | null
      started:    run.run_started_at,
      url:        run.html_url,
      event:      run.event,           // schedule | workflow_dispatch
    };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) };
  }
}

// Public half of the VAPID pair is public by definition (it ships to the push
// service in every request and to the browser in applicationServerKey).
// The PRIVATE half lives in `wrangler secret put VAPID_PRIVATE` — it used to
// sit in this file in plaintext.
const VAPID_PUBLIC  = 'BGTt0ibpBc0izJ1IsjGg9YD8SLYoQpf2jYtCpECqnWAIDDuKeiULpkJ-Ocf4Yf-oNtBJKhb1Dv4PGyuGPRmGEZc';
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
        // This used to be a blind `put(user, body)`: one KV key, last writer
        // wins, no history. So any device that came up with an empty starred
        // list — an evicted iOS PWA, a fresh install, a pull that had not
        // landed yet — destroyed the real list for every other device the
        // moment the user starred one thing, and there was nothing to roll
        // back to. Three changes below: merge instead of replace, refuse a
        // destructive clear, and keep one previous version.
        let incoming;
        let body;
        try {
          body = await request.text();
          incoming = JSON.parse(body);
        } catch {
          return json({ error: 'Invalid JSON' }, 400);
        }
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
          return json({ error: 'Expected a JSON object' }, 400);
        }

        const prevRaw = await env.USER_DATA.get(user);
        let prev = {};
        if (prevRaw) { try { prev = JSON.parse(prevRaw) || {}; } catch { prev = {}; } }

        const prevStars = Array.isArray(prev.starred) ? prev.starred : [];
        const nextStars = Array.isArray(incoming.starred) ? incoming.starred : null;

        // An absent key means "I am not speaking about stars" — a note edit
        // must never carry the starred list as collateral.
        const merged = { ...prev, ...incoming };
        if (nextStars === null) {
          merged.starred = prevStars;
        } else if (nextStars.length === 0 && prevStars.length > 0
                   && url.searchParams.get('allowEmpty') !== '1') {
          // Deliberately unstarring the last item sends allowEmpty=1. Anything
          // else asking to clear a populated list is the bug, not the user.
          return json({
            error: 'Refusing to clear a non-empty starred list',
            kept:  prevStars.length,
          }, 409);
        }

        // One generation of history. Enough to undo the accident that is
        // actually plausible here (a single bad write); not a version store.
        if (prevRaw) await env.USER_DATA.put(`${user}:prev`, prevRaw);
        await env.USER_DATA.put(user, JSON.stringify(merged));
        return json({ ok: true, starred: (merged.starred || []).length });
      }
    }

    // Read the one retained previous version, so a bad write can be inspected
    // and restored by hand without touching the KV dashboard.
    if (path === '/sync/backup') {
      const user = (url.searchParams.get('user') || '').toLowerCase().trim();
      if (!ALLOWED_USERS.includes(user)) return json({ error: 'Unknown user' }, 403);
      const deny = await authorize(request, env, user);
      if (deny) return deny;
      const raw = await env.USER_DATA.get(`${user}:prev`);
      return json(raw ? JSON.parse(raw) : {});
    }

    // ─── Trigger a CI data run ──────────────────────────────────────────────
    // The app is a PUBLIC bundle on Pages, so it cannot hold a GitHub token —
    // that is the same mistake the old hard-coded SYNC_SECRET was. The token
    // lives here as a Worker secret and the browser only ever proves WHO it is,
    // with the same per-user bearer everything else uses.
    if (path === '/run' && request.method === 'POST') {
      const user = (url.searchParams.get('user') || '').toLowerCase().trim();
      if (!ALLOWED_USERS.includes(user)) return json({ error: 'Unknown user' }, 403);
      const deny = await authorize(request, env, user);
      if (deny) return deny;

      if (!env.GH_TOKEN) {
        return json({ error: 'not_configured',
                      detail: 'GH_TOKEN is not set on this Worker' }, 501);
      }

      // A run costs ~9 minutes of Actions time and the pipeline is not
      // re-entrant — two concurrent runs would race on the same R2 keys and on
      // the accumulating files (ledger, sector activity). The cooldown is the
      // cheap half of that guard; the "already running" check below is the
      // half that actually matters.
      const cdKey = 'run:cooldown';
      const last  = await env.USER_DATA.get(cdKey);
      if (last) {
        const waited = Date.now() - Number(last);
        if (waited < RUN_COOLDOWN_MS) {
          return json({ error: 'cooldown',
                        retry_in_s: Math.ceil((RUN_COOLDOWN_MS - waited) / 1000) }, 429);
        }
      }

      const live = await latestRun(env);
      if (live.ok && (live.status === 'queued' || live.status === 'in_progress')) {
        return json({ error: 'already_running', run: live }, 409);
      }

      const res = await fetch(
        `https://api.github.com/repos/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/dispatches`,
        { method: 'POST', headers: ghHeaders(env),
          body: JSON.stringify({ ref: GH_REF }) });

      if (res.status !== 204) {
        // Surface GitHub's own reason rather than a generic failure — a bad or
        // expired token and a disabled workflow look identical otherwise.
        const detail = (await res.text()).slice(0, 300);
        return json({ error: 'dispatch_failed', status: res.status, detail }, 502);
      }

      await env.USER_DATA.put(cdKey, String(Date.now()), { expirationTtl: 3600 });
      return json({ ok: true, by: user, at: new Date().toISOString() });
    }

    // ─── State of the most recent run ───────────────────────────────────────
    // Polled by the button so it can show queued → running → done rather than
    // firing and leaving you to guess. GitHub's dispatch endpoint returns 204
    // with no run id, so the id has to be discovered by listing.
    if (path === '/run/status') {
      const user = (url.searchParams.get('user') || '').toLowerCase().trim();
      if (!ALLOWED_USERS.includes(user)) return json({ error: 'Unknown user' }, 403);
      const deny = await authorize(request, env, user);
      if (deny) return deny;
      if (!env.GH_TOKEN) return json({ error: 'not_configured' }, 501);
      return json(await latestRun(env));
    }

    return json({ error: 'Not found' }, 404);
  },
};
