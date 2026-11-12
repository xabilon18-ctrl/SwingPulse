const fs = require('fs');
const path = require('path');

// Wait until the live site serves THIS build's scripts and styles, byte for
// byte, before a live browser check opens it.
//
// Cloudflare Pages can answer with the new index.html while a script still
// comes from the previous deployment for a few seconds after a deploy.
// validate_hourly_release.py --live only waits for the new index.html, so a
// check of new behaviour could run against the old app.js: on 2026-11-12 the
// first live check of the 4:5 share picture got the old picture 9 seconds
// after the deploy and turned the release red; the same job passed when
// re-run. Comparing every file under static/ closes that gap for any change.
module.exports = async function waitForLiveRelease(origin, { timeoutMs = 120000, everyMs = 5000 } = {}) {
  const built = path.resolve(__dirname, '../webapp/publish/ui');
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|css)$/.test(entry.name)) files.push(path.relative(built, full).split(path.sep).join('/'));
    }
  };
  walk(path.join(built, 'static'));
  if (!files.length) throw new Error('No built scripts or styles to compare the live site against');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const stale = [];
    for (const file of files) {
      let body = null;
      try {
        const res = await fetch(`${origin}/${file}?releasewait=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) body = Buffer.from(await res.arrayBuffer());
      } catch (err) { body = null; }   // a failed read counts as not released yet and is retried
      if (!body || !body.equals(fs.readFileSync(path.join(built, file)))) stale.push(file);
    }
    if (!stale.length) return files.length;
    if (Date.now() >= deadline) throw new Error(`Live site still serves an older build of: ${stale.join(', ')}`);
    console.log(`Waiting for the live site to serve this build (${stale.length} of ${files.length} files differ)`);
    await new Promise(resolve => setTimeout(resolve, everyMs));
  }
};
