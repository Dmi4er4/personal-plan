#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${DEPLOY_HOST:?Set DEPLOY_HOST to an SSH target}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/personal-plan}"
BASE_URL="${DEPLOY_BASE_URL:?Set DEPLOY_BASE_URL to the public HTTPS origin}"

if [[ "$BASE_URL" != https://* ]]; then
  echo "DEPLOY_BASE_URL must use HTTPS" >&2
  exit 2
fi

cd "$ROOT"
pnpm build:web
rsync -av --delete apps/web/dist/ "$HOST:$REMOTE_DIR/apps/web/dist/"
rsync -av apps/relay/node-server.mjs "$HOST:$REMOTE_DIR/apps/relay/"
rsync -av docker-compose.yml Dockerfile Caddyfile "$HOST:$REMOTE_DIR/"
if [[ -f artifacts/android/personal-plan-release.apk ]]; then
  APK_RELAY_URL="$(unzip -p artifacts/android/personal-plan-release.apk assets/app.config | node -e 'let input=""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => { input += chunk; }); process.stdin.on("end", () => { const config = JSON.parse(input); process.stdout.write(String(config.extra?.relayUrl ?? "")); });')"
  if [[ "$APK_RELAY_URL" != "$BASE_URL" ]]; then
    echo "Android APK relay URL mismatch: expected $BASE_URL, got ${APK_RELAY_URL:-<missing>}" >&2
    exit 2
  fi
  ssh "$HOST" "mkdir -p $REMOTE_DIR/apps/web/dist/download"
  rsync -av artifacts/android/personal-plan-release.apk "$HOST:$REMOTE_DIR/apps/web/dist/download/personal-plan.apk"
  ssh "$HOST" "cd $REMOTE_DIR/apps/web/dist/download && sha256sum personal-plan.apk > personal-plan.apk.sha256"
fi
ssh "$HOST" "cd $REMOTE_DIR && docker compose up -d --build relay"

bash scripts/smoke-production-web.sh "$BASE_URL"
echo "Deployed and verified."
