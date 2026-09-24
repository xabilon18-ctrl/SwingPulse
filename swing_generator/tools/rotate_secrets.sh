#!/usr/bin/env bash
# Rotate the two server-side secrets before the repo goes public (2026-09-24).
#
#   1. VAPID push key pair — the old PRIVATE key sits in git history
#      (commits dfad83d..cfe4013). New pair: private half -> the sync Worker's
#      VAPID_PRIVATE secret, public half patched into the Worker and app.js.
#      No device is subscribed to push today, so nothing breaks.
#   2. SYNC_SECRET — the CI -> Worker shared secret for /push/notify. New random
#      value written to BOTH the GitHub Actions secret and the Worker secret.
#
# Neither new secret value is ever printed. Needs: node, gh (logged in),
# wrangler (logged in). Run from anywhere:
#     bash swing_generator/tools/rotate_secrets.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKER="$ROOT/webapp/sync-worker"
APP="$ROOT/webapp/static/js/app.js"
cd "$WORKER"

echo "1/3  New VAPID key pair -> Worker secret VAPID_PRIVATE"
NEW_PUB="$(node -e '
const c = require("crypto"), { execFileSync } = require("child_process");
const { privateKey } = c.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const j = privateKey.export({ format: "jwk" });
execFileSync("npx", ["wrangler", "secret", "put", "VAPID_PRIVATE"],
             { input: j.d, stdio: ["pipe", "ignore", "inherit"] });
process.stdout.write(Buffer.concat([Buffer.from([4]),
  Buffer.from(j.x, "base64url"), Buffer.from(j.y, "base64url")]).toString("base64url"));
')"
OLD_PUB="$(grep -o "VAPID_PUBLIC  = '[^']*'" src/index.js | sed "s/.*= '//; s/'//")"
sed -i '' "s|$OLD_PUB|$NEW_PUB|" src/index.js "$APP"
echo "     public key patched into sync-worker/src/index.js and app.js"

echo "2/3  New SYNC_SECRET -> GitHub Actions secret + Worker secret"
SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')"
printf '%s' "$SECRET" | gh secret set SYNC_SECRET --repo xabilon18-ctrl/SwingPulse
printf '%s' "$SECRET" | npx wrangler secret put SYNC_SECRET >/dev/null
unset SECRET

echo "3/3  Deploy the sync Worker"
npx wrangler deploy >/dev/null
echo "Done. Tell Claude — it will commit the new public key and redeploy the app."
