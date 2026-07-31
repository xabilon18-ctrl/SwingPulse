// Exercises the sync worker's new per-user auth against a fake KV.
import worker from '../src/index.js';

const KV = new Map();
const env = {
  SYNC_SECRET: 'ci-only-secret',
  VAPID_PRIVATE: 'x',
  USER_DATA: {
    async get(k) { return KV.has(k) ? KV.get(k) : null; },
    async put(k, v) { KV.set(k, v); },
    async delete(k) { KV.delete(k); },
    async list({ prefix }) {
      return { keys: [...KV.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) };
    },
  },
};

async function tok(user, pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`swingpulse:${user}:${pw}`));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const call = (method, path, { token, secret, body } = {}) => {
  const h = {};
  if (token)  h['Authorization']  = `Bearer ${token}`;
  if (secret) h['X-Sync-Secret']  = secret;
  if (body)   h['Content-Type']   = 'application/json';
  return worker.fetch(new Request('https://w.dev' + path, { method, headers: h, body }), env);
};

let pass = 0, fail = 0;
async function check(name, res, wantStatus, wantBody) {
  const got = await res.clone().json().catch(() => ({}));
  const okS = res.status === wantStatus;
  const okB = !wantBody || Object.entries(wantBody).every(([k, v]) => got[k] === v);
  if (okS && okB) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} — got ${res.status} ${JSON.stringify(got)}, want ${wantStatus} ${JSON.stringify(wantBody || {})}`); }
}

const good = await tok('zabs', 'correct horse');
const bad  = await tok('zabs', 'wrong one');
const hemi = await tok('hemi', 'hemis own');

console.log('\nunauthenticated (the old attack)');
await check('GET  /sync with no token   → 401', await call('GET',  '/sync?user=zabs'), 401, { error: 'auth_required' });
await check('PUT  /sync with no token   → 401', await call('PUT',  '/sync?user=zabs', { body: '{"starred":["EVIL"]}' }), 401);
await check('POST /push/subscribe none  → 401', await call('POST', '/push/subscribe?user=zabs', { body: '{"endpoint":"https://e/1"}' }), 401);
await check('old shared secret rejected → 401', await call('PUT',  '/sync?user=zabs', { secret: 'swingpulse2026', body: '{}' }), 401);

console.log('\ntrust-on-first-use');
await check('first token claims account  → 200', await call('POST', '/sync/auth?user=zabs', { token: good }), 200, { ok: true, claimed: true });
await check('same token again, no claim  → 200', await call('POST', '/sync/auth?user=zabs', { token: good }), 200, { ok: true, claimed: false });
await check('KV stores a HASH, not token', { status: KV.get('auth:zabs') === good ? 500 : 200, clone: () => ({ json: async () => ({}) }) }, 200);

console.log('\nwrong password');
await check('GET  /sync wrong pw → 401', await call('GET', '/sync?user=zabs', { token: bad }), 401, { error: 'bad_password' });
await check('another user\'s token → 401', await call('GET', '/sync?user=zabs', { token: hemi }), 401, { error: 'bad_password' });

console.log('\nreal use');
await check('PUT  /sync right pw  → 200', await call('PUT', '/sync?user=zabs', { token: good, body: '{"starred":["NVDA"],"lastModified":1}' }), 200, { ok: true });
const readBack = await (await call('GET', '/sync?user=zabs', { token: good })).json();
await check('GET  returns what PUT wrote', { status: JSON.stringify(readBack.starred) === '["NVDA"]' ? 200 : 500, clone: () => ({ json: async () => readBack }) }, 200);
await check('hemi claims her own account → 200', await call('POST', '/sync/auth?user=hemi', { token: hemi }), 200, { claimed: true });
await check('hemi cannot read zabs        → 401', await call('GET', '/sync?user=zabs', { token: hemi }), 401);
await check('unknown user                 → 403', await call('GET', '/sync?user=mallory', { token: good }), 403);

console.log('\nbrute-force limit');
for (let i = 0; i < 9; i++) await call('GET', '/sync?user=zabs', { token: bad });  // 1 earlier + 9 = 10
await check('11th wrong attempt → 429', await call('GET', '/sync?user=zabs', { token: bad }), 429, { error: 'too_many_attempts' });
await check('right pw still works while locked', await call('GET', '/sync?user=zabs', { token: good }), 200);
// …and that success RESET the counter, so guessing starts from zero again
await check('counter cleared by success  → 401', await call('GET', '/sync?user=zabs', { token: bad }), 401, { error: 'bad_password' });
for (let i = 0; i < 9; i++) await call('GET', '/sync?user=zabs', { token: bad });
await check('re-locks after 10 more      → 429', await call('GET', '/sync?user=zabs', { token: bad }), 429);

console.log('\nCI push path (server-to-server, unchanged)');
await check('notify without secret → 401', await call('POST', '/push/notify'), 401);
await check('notify with browser token → 401', await call('POST', '/push/notify', { token: good }), 401);
KV.set('fail:zabs', '0');
await check('notify with CI secret → 200', await call('POST', '/push/notify', { secret: 'ci-only-secret' }), 200, { sent: 0 });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
