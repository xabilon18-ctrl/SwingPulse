"""Build the desktop review on a separate Pages origin; never publish data."""
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "webapp"))
import publish

def build():
    ui = Path(publish.build_ui())
    worker = "https://swingpulse-sync.xabilon18.workers.dev"
    # The preview has device-local saves, including for named users. No request
    # to the production sync service is possible, even with an imported backup.
    app = ui / "static/js/app.js"
    js = app.read_text()
    assert worker in js
    js = js.replace(worker, "/__preview-sync")
    js = js.replace("swRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });",
                    "swRegistration = null; // review build: no background subscriptions")
    app.write_text(js)
    bridge = r"""
(() => {
  const original = window.fetch.bind(window);
  const reply = (value, status = 200) => Promise.resolve(new Response(JSON.stringify(value), {
    status, headers: {'Content-Type': 'application/json'}
  }));
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const method = (options.method || input.method || 'GET').toUpperCase();
    if (url.origin === location.origin && url.pathname.startsWith('/__preview-sync')) {
      const user = url.searchParams.get('user') || 'guest';
      const key = 'desktop-review-sync:' + user;
      if (url.pathname.endsWith('/sync/auth')) return reply({ok: true, claimed: false});
      if (url.pathname.endsWith('/sync/backup')) return reply(JSON.parse(localStorage.getItem(key + ':backup') || '{}'));
      if (url.pathname.endsWith('/sync') && method === 'GET') return reply(JSON.parse(localStorage.getItem(key) || '{}'));
      if (url.pathname.endsWith('/sync') && method === 'PUT') {
        localStorage.setItem(key + ':backup', localStorage.getItem(key) || '{}');
        const data = JSON.parse(options.body);
        localStorage.setItem(key, JSON.stringify(data));
        return reply({ok: true, lastModified: data.lastModified});
      }
      return reply({error: 'Push notifications are unavailable in the review build.'}, 404);
    }
    if (url.origin !== location.origin && !['GET', 'HEAD'].includes(method))
      return reply({error: 'Review builds cannot change production data.'}, 403);
    return original(input, options);
  };
})();
"""
    (ui / "static/js/review-sandbox.js").write_text(bridge)
    html = ui / "index.html"
    html.write_text(html.read_text().replace("<head>", '<head>\n  <script src="/static/js/review-sandbox.js"></script>', 1))
    # Browser-enforced backup to the fetch isolation. Quotes/R2 remain read-only.
    (ui / "_headers").write_text("/*\n  Content-Security-Policy: connect-src 'self' " +
        publish.R2_PUBLIC_URL + " https://swingpulse-cron.xabilon18.workers.dev\n  X-Robots-Tag: noindex, nofollow\n")
    # Provenance and exact asset hashes can be verified after Pages publishes.
    revision = os.environ["REVIEW_SHA"]
    assert len(revision) == 40
    assets = {str(path.relative_to(ui)): hashlib.sha256(path.read_bytes()).hexdigest()
              for path in [app, ui / "static/css/style.css", html]}
    (ui / "preview.json").write_text(json.dumps({
        "revision": revision, "base": "718d4d5c7529686a99f6d77c0b3fdb2af7d0adf1",
        "production": False, "saves": "this browser only", "assets": assets
    }, indent=2))
    assert worker not in app.read_text()
    print("Review UI built; production sync is excluded. Revision:", revision)

if __name__ == "__main__":
    build()
