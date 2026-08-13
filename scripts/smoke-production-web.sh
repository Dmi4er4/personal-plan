#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_URL="${1:?Usage: scripts/smoke-production-web.sh https://plan.example.com}"
if [[ "$BASE_URL" != https://* ]]; then
  echo "Production smoke requires an HTTPS URL" >&2
  exit 2
fi
curl_args=(
  --fail
  --silent
  --show-error
  --retry 15
  --retry-all-errors
  --retry-delay 2
  --connect-timeout 5
  --max-time 20
)

cd "$ROOT"

curl "${curl_args[@]}" "$BASE_URL/healthz" | grep -Fq '"status":"ok"'

# TEXT-10 is exercised against the same core code that was bundled, while the
# byte-for-byte asset check below proves that production serves that build.
pnpm --dir packages/core exec vitest run test/text/parse.test.ts

local_asset="$(sed -nE 's#.*src="(/assets/index-[^"]+\.js)".*#\1#p' apps/web/dist/index.html | head -n 1)"
test -n "$local_asset"

remote_html="$(curl "${curl_args[@]}" "$BASE_URL/")"
remote_asset="$(printf '%s' "$remote_html" | sed -nE 's#.*src="(/assets/index-[^"]+\.js)".*#\1#p' | head -n 1)"
test "$remote_asset" = "$local_asset"

local_sha="$(shasum -a 256 "apps/web/dist${local_asset}" | awk '{print $1}')"
remote_sha="$(curl "${curl_args[@]}" "$BASE_URL$remote_asset" | shasum -a 256 | awk '{print $1}')"
test "$remote_sha" = "$local_sha"

curl "${curl_args[@]}" "$BASE_URL/sw.js" | grep -Fq "${local_asset#/}"

echo "Production smoke passed: $remote_asset ($remote_sha)"
