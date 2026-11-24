// The run scheduler (cron-worker scheduled), offline: :25 always dispatches;
// the :55 backup dispatches only when no run was created in the last 45
// minutes, and dispatches anyway when GitHub cannot be asked (2026-10-20); it
// also retries a recent run that finished without success (2026-10-28).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../webapp/cron-worker/src/index.js';

// The crons Cloudflare fires must be the ones the Worker tells apart: a
// backup cron the Worker does not recognise would dispatch unconditionally.
const toml = readFileSync(new URL('../webapp/cron-worker/wrangler.toml', import.meta.url), 'utf8');
assert.deepEqual(JSON.parse(toml.match(/^crons\s*=\s*(\[.*\])/m)[1]), ['25 * * * *', '55 * * * *'],
                 'wrangler.toml crons are :25 (dispatch) and :55 (backup)');

const env = { GH_TOKEN: 't', REPO: 'o/r', WORKFLOW: 'publish.yml', REF: 'main' };
const minutesAgo = m => new Date(Date.now() - m * 60000).toISOString();

async function run(cron, runs) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url}`);
    if (init.method === 'POST') return new Response(null, { status: 204 });
    return runs();
  };
  const jobs = [];
  await worker.scheduled({ cron }, env, { waitUntil: p => jobs.push(p) });
  await Promise.all(jobs);
  return { listed: calls.filter(c => c.startsWith('GET')), dispatched: calls.filter(c => c.startsWith('POST')).length };
}
const list = (...ages) => () => new Response(JSON.stringify({ workflow_runs: ages.map(m => ({ created_at: minutesAgo(m) })) }));

console.log = console.error = () => {};   // the Worker logs every decision
let r = await run('25 * * * *', list(30));
assert.equal(r.dispatched, 1, ':25 dispatches');
assert.equal(r.listed.length, 0, ':25 does not ask first');

r = await run('55 * * * *', list(30));
assert.equal(r.dispatched, 0, ':55 skips when the :25 run exists');
assert.equal(r.listed[0], 'GET https://api.github.com/repos/o/r/actions/workflows/publish.yml/runs?branch=main&per_page=1');

assert.equal((await run('55 * * * *', list(90))).dispatched, 1, ':55 dispatches when :25 was lost');
assert.equal((await run('55 * * * *', list())).dispatched, 1, ':55 dispatches when there are no runs');
assert.equal((await run('55 * * * *', () => new Response('', { status: 500 }))).dispatched, 1, ':55 dispatches when the check fails');
assert.equal((await run('55 * * * *', () => { throw new Error('network'); })).dispatched, 1, ':55 dispatches when GitHub is unreachable');

// A :25 run that already failed is retried at :55; one that passed or is
// still running is not.
const one = run => () => new Response(JSON.stringify({ workflow_runs: [{ id: 7, created_at: minutesAgo(30), ...run }] }));
assert.equal((await run('55 * * * *', one({ status: 'completed', conclusion: 'failure' }))).dispatched, 1, ':55 retries a failed :25 run');
assert.equal((await run('55 * * * *', one({ status: 'completed', conclusion: 'timed_out' }))).dispatched, 1, ':55 retries a timed-out run');
assert.equal((await run('55 * * * *', one({ status: 'completed', conclusion: 'success' }))).dispatched, 0, ':55 skips a passed run');
assert.equal((await run('55 * * * *', one({ status: 'in_progress', conclusion: null }))).dispatched, 0, ':55 leaves a running run alone');
assert.equal((await run('55 * * * *', one({ status: 'queued', conclusion: null }))).dispatched, 0, ':55 leaves a queued run alone');

process.stdout.write('PASS: scheduler — :25 always dispatches; :55 when no run started in 45 min or the recent one failed\n');
