# Personal Plan

An offline-first personal planner for the web, Android, and macOS. The same
plan can be edited as a compact timeline or as plain text, stored locally, and
synchronized through a relay that only sees encrypted envelopes.

The interface is currently in Russian.

## Features

- local-first PWA backed by IndexedDB;
- Android client backed by SQLite and SecureStore;
- Android home-screen widget with durable offline actions;
- timeline and lossless plain-text views of the same Yjs document;
- end-to-end encrypted device sync using AES-256-GCM and a 24-word BIP-39
  recovery phrase;
- self-hostable Node/Docker relay and a Cloudflare Workers implementation;
- no accounts, sharing, notifications, analytics, or plaintext server data.

## Repository layout

```text
apps/web       React/Vite PWA
apps/android   Expo/React Native client and native Glance widget
apps/macos     Minimal native WebKit wrapper
apps/relay     Node and Cloudflare encrypted relays
packages/core  Shared plan model, projections, and text reconciliation
packages/sync  Shared encryption, pairing, and synchronization protocol
```

## Quick start

Requirements: Node.js 24 and pnpm 10.15.0.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build:web
node apps/relay/node-server.mjs \
  --db .local/relay.sqlite \
  --static apps/web/dist \
  --host 127.0.0.1 \
  --port 8787
```

Open <http://127.0.0.1:8787>, create a vault, and save the displayed recovery
phrase offline. Losing both every configured device and the phrase makes the
encrypted plan unrecoverable.

For development commands and platform setup, see
[local development](docs/local-development.md),
[Android development](docs/android-development.md), and
[sync operations](docs/sync-operations.md).

## Verification

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

The encrypted browser-to-browser acceptance test additionally requires a
Playwright Chromium installation:

```bash
pnpm --dir apps/web exec playwright install chromium
pnpm test:sync-e2e
```

## Security model

Clients derive separate encryption and authentication material from a random
32-byte root secret. Plan updates and snapshots are encrypted before they leave
a device. The relay still observes metadata such as IP addresses, timing,
envelope sizes, vault identifiers, and update frequency.

This project has not received an independent security audit. Do not treat it as
a substitute for a reviewed secrets manager, and do not expose a relay without
TLS. See [SECURITY.md](SECURITY.md) for reporting guidance and operational
notes.

## License

[MIT](LICENSE)
