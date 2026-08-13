#!/usr/bin/env bash
set -euo pipefail

export NODE_ENV="${NODE_ENV:-development}"

pnpm --dir packages/core test
pnpm --dir packages/sync test
pnpm build:deps
pnpm --dir apps/android test
pnpm --dir apps/android typecheck
pnpm --dir apps/android lint
pnpm --dir apps/android exec expo prebuild --clean --platform android
(cd apps/android/android && ./gradlew testDebugUnitTest assembleDebug)

apk_path="$(pwd)/apps/android/android/app/build/outputs/apk/debug/app-debug.apk"
test -f "$apk_path"
echo "APK: $apk_path"
