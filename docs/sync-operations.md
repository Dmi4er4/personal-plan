# Encrypted sync operations

## Local development

Use Node.js 24 and the committed pnpm version. Build the PWA, then start either
the Cloudflare-compatible development Worker or the production-equivalent Node
relay. Both serve `apps/web/dist` and the `/v1` API from the same origin.

```bash
pnpm build:web
pnpm --dir apps/relay dev
node apps/relay/node-server.mjs \
  --db .local/relay.sqlite \
  --legacy .local/miniflare-vaults \
  --static apps/web/dist \
  --host 127.0.0.1 \
  --port 8787
```

Open `http://127.0.0.1:8787`. Focused checks:

```bash
pnpm --dir packages/sync test
pnpm --dir apps/relay test
pnpm test:sync-e2e
pnpm --dir apps/relay exec wrangler deploy --dry-run
```

## VPS production deployment and rollback

Production runs the Node 24 relay behind Caddy from `/opt/personal-plan`.
Encrypted state is stored in the Docker volume `personal-plan_relay-state` at
`/state/node-relay.sqlite`. On the first Node start, legacy Miniflare Durable
Object SQLite files are imported atomically without decrypting their payloads.

Set the SSH destination and public HTTPS origin explicitly, then run the
deployment entrypoint:

```bash
export DEPLOY_HOST='deploy@plan-host.example'
export DEPLOY_BASE_URL='https://plan.example.com'
bash scripts/deploy-web.sh
```

Before the first start, create `/opt/personal-plan/.env` on the host with the
Caddy site address (host name, optionally with a port):

```dotenv
PERSONAL_PLAN_HOST=plan.example.com
```

It changes the VPS and must be run only after explicit user approval. It builds
the PWA, uploads the Node relay and compose files, preserves the optional APK at
`/download/personal-plan.apk`, recreates only the relay service, and runs the
production smoke test.

Before a runtime or storage migration, stop only `relay` and archive the volume
read-only. Keep the previous immutable image tag until the migrated vault count,
update count, current-vault bootstrap, health check, and restart count are
verified. Example backup:

```bash
docker compose stop relay
docker run --rm \
  -v personal-plan_relay-state:/state:ro \
  -v /opt/personal-plan/backups/<timestamp>:/backup \
  alpine:3.22 tar -C /state -czf /backup/relay-state.tar.gz .
```

Rollback means stopping the Node relay, restoring the previous compose/runtime
files and immutable image tag, then starting only `relay`. Do not delete the
volume: the legacy SQLite files remain alongside the migrated database, and the
backup is the final recovery source.

Healthy production must satisfy all of the following:

```bash
curl -fsS http://127.0.0.1:8787/healthz
docker inspect --format '{{.RestartCount}} {{.State.Health.Status}}' personal-plan-relay-1
docker logs --tail 50 personal-plan-relay-1
```

Logs may contain only route/status/duration and a truncated one-way vault
fingerprint. A stable `200` polling loop is not sufficient by itself: verify the
authenticated bootstrap cursor and compare a local decrypted canonical hash on
a trusted client without printing the recovery phrase or plan.

## Legacy Cloudflare deployment

The Worker implementation remains available for compatibility and dry-run
testing. If Cloudflare is deliberately selected as production, use
`wrangler deploy` only after explicit approval. Worker rollback and Durable
Object data retention are separate operations; never delete or recreate the
`VAULTS` namespace during a code rollback.

## Safe inspection

Operational inspection may report only vault count, update count, maximum cursor, snapshot coverage cursor, envelope byte sizes, and timestamps. Never print authorization headers, auth verifiers, nonces, ciphertext, request bodies, recovery phrases, or root-secret material. The relay cannot inspect Yjs, task titles, notes, dates, completion, or parent relationships.

The relay host can still observe vault IDs, request timing, IP-level transport metadata, envelope sizes, cursor progression, and update frequency.

## Vault deletion

Deletion is intentional and irreversible. Send both the normal bearer token and an exact confirmation header:

```bash
curl -X DELETE \
  -H 'Authorization: Bearer <auth-token>' \
  -H 'X-Confirm-Delete: <vault-id>' \
  'https://<relay>/v1/vaults/<vault-id>'
```

Do not paste a real token into logs, tickets, or shell history. A missing or mismatched confirmation returns `400` without deleting data.

If every paired device and the 24-word recovery phrase are lost, the encrypted plan is intentionally unrecoverable. Relay storage and the auth token cannot reconstruct the encryption key.
