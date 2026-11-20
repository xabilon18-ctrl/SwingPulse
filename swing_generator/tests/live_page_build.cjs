const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Make sure the BROWSER under test runs this build before a live check reads
// it (2026-11-17). live_release_wait.cjs checks the live site from Node, and
// on two releases in a row the browser opened right after it still ran the
// previous release: #233 got the old app.js with the new style.css, #234 the
// old style.css (the new "no text selection" rule missing). Cloudflare can
// answer one client with the new deployment and the next with the old one for
// a short while. So this reads, inside the page, every script and stylesheet
// it loaded, from the browser's own cache (the copy the page used), and
// compares them byte for byte (SHA-256) with this build, and the page's asset
// list with the built index.html. If anything differs it waits and reloads,
// until the deadline.
const built = path.resolve(__dirname, '../webapp/publish/ui');
const refsOf = html => [...html.matchAll(/(?:src|href)="\/?(static\/[^"?]+\.(?:js|css))(\?v=\d+)?"/g)].map(m => m[1] + (m[2] || ''));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(built, file))).digest('hex');

module.exports = async function ensurePageBuild(page, url, { timeoutMs = 150000, everyMs = 5000, reload } = {}) {
  const want = new Set(refsOf(fs.readFileSync(path.join(built, 'index.html'), 'utf8')));
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 1; ; attempt++) {
    // Every script and stylesheet in, so the cache holds what the page used.
    await page.waitForLoadState('load');
    const loaded = await page.evaluate(async () => {
      const hex = buf => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
      const urls = [...document.querySelectorAll('script[src], link[rel="stylesheet"][href]')]
        .map(e => e.src || e.href).filter(u => new URL(u).origin === location.origin && /\/static\/.+\.(js|css)$/.test(new URL(u).pathname));
      const out = [];
      for (const u of urls) {
        const p = new URL(u);
        try {
          const r = await fetch(u, { cache: 'force-cache' });
          out.push([p.pathname.slice(1) + p.search, r.ok ? hex(await crypto.subtle.digest('SHA-256', await r.arrayBuffer())) : 'HTTP ' + r.status]);
        } catch (err) { out.push([p.pathname.slice(1) + p.search, 'ERR ' + err.message]); }
      }
      return out;
    });
    const have = new Set(loaded.map(([ref]) => ref));
    const stale = [];
    for (const ref of want) if (!have.has(ref)) stale.push(ref + ' (not on the page)');
    for (const [ref, hash] of loaded) {
      const file = ref.split('?')[0];
      if (!fs.existsSync(path.join(built, file)) || sha(file) !== hash) stale.push(ref);
    }
    if (!stale.length) {
      if (attempt > 1) console.log(`The page under test runs this build (after ${attempt - 1} reload${attempt > 2 ? 's' : ''})`);
      return attempt;
    }
    if (Date.now() >= deadline) throw new Error('The page under test still runs an older build of: ' + stale.join(', '));
    console.log(`The page under test runs an older build of ${stale.length} file(s) (${stale.slice(0, 3).join(', ')}); reloading`);
    await page.waitForTimeout(everyMs);
    if (reload) await reload();
    else {
      const u = new URL(url);
      u.searchParams.set('buildcheck', String(Date.now()));
      await page.goto(u.toString(), { waitUntil: 'networkidle' });
    }
  }
};
