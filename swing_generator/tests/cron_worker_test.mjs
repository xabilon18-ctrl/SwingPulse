// The run scheduler (cron-worker scheduled), offline: :05 always dispatches;
// the :35 backup dispatches only when no run was created in the last 45
// minutes, and dispatches anyway when GitHub cannot be asked (2026-10-20); it
// also retries a recent run that finished without success (2026-10-28).
import assert from 'node:assert/strict';
import worker from '../webapp/cron-worker/src/index.js';

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
let r = await run('5 * * * *', list(30));
assert.equal(r.dispatched, 1, ':05 dispatches');
assert.equal(r.listed.length, 0, ':05 does not ask first');

r = await run('35 * * * *', list(30));
assert.equal(r.dispatched, 0, ':35 skips when the :05 run exists');
assert.equal(r.listed[0], 'GET https://api.github.com/repos/o/r/actions/workflows/publish.yml/runs?branch=main&per_page=1');

assert.equal((await run('35 * * * *', list(90))).dispatched, 1, ':35 dispatches when :05 was lost');
assert.equal((await run('35 * * * *', list())).dispatched, 1, ':35 dispatches when there are no runs');
assert.equal((await run('35 * * * *', () => new Response('', { status: 500 }))).dispatched, 1, ':35 dispatches when the check fails');
assert.equal((await run('35 * * * *', () => { throw new Error('network'); })).dispatched, 1, ':35 dispatches when GitHub is unreachable');

// A :05 run that already failed is retried at :35; one that passed or is
// still running is not.
const one = run => () => new Response(JSON.stringify({ workflow_runs: [{ id: 7, created_at: minutesAgo(30), ...run }] }));
assert.equal((await run('35 * * * *', one({ status: 'completed', conclusion: 'failure' }))).dispatched, 1, ':35 retries a failed :05 run');
assert.equal((await run('35 * * * *', one({ status: 'completed', conclusion: 'timed_out' }))).dispatched, 1, ':35 retries a timed-out run');
assert.equal((await run('35 * * * *', one({ status: 'completed', conclusion: 'success' }))).dispatched, 0, ':35 skips a passed run');
assert.equal((await run('35 * * * *', one({ status: 'in_progress', conclusion: null }))).dispatched, 0, ':35 leaves a running run alone');
assert.equal((await run('35 * * * *', one({ status: 'queued', conclusion: null }))).dispatched, 0, ':35 leaves a queued run alone');

process.stdout.write('PASS: scheduler — :05 always dispatches; :35 when no run started in 45 min or the recent one failed\n');
