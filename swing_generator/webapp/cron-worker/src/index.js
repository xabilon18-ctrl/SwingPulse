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

export default {
  async scheduled(event, env, ctx) {
    if (!env.GH_TOKEN) { console.error('GH_TOKEN secret is not set'); return; }
    ctx.waitUntil(dispatch(env, event.cron));
  },
  async fetch() {
    return new Response('swingpulse-cron: dispatches publish.yml every 30 min, 08:00-23:00 SAST, Mon-Fri\n',
                        { headers: { 'content-type': 'text/plain' } });
  },
};
