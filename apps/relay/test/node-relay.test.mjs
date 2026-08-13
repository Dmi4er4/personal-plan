import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";

import { createRelayServer, migrateMiniflareState, openRelayDatabase } from "../node-server.mjs";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "personal-plan-node-relay-"));
const staticDirectory = join(temporaryDirectory, "static");
mkdirSync(staticDirectory);
writeFileSync(join(staticDirectory, "index.html"), "<!doctype html><title>Plans</title>");

const vaultId = randomBytes(16).toString("base64url");
const authToken = randomBytes(32);
const authVerifier = createHash("sha256").update(authToken).digest("base64url");
const authorization = `Bearer ${authToken.toString("base64url")}`;
const envelope = {
  version: 1,
  kind: "update",
  vaultId,
  updateId: "11111111-1111-4111-8111-111111111111",
  nonce: randomBytes(12).toString("base64url"),
  ciphertext: randomBytes(32).toString("base64url"),
  createdAt: "2026-08-10T00:00:00.000Z",
};

let relay;
let baseUrl;

before(async () => {
  relay = createRelayServer({ databasePath: join(temporaryDirectory, "relay.sqlite"), staticDirectory });
  await new Promise((resolve) => relay.server.listen(0, "127.0.0.1", resolve));
  const address = relay.server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await relay.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("serves the PWA and reports health", async () => {
  assert.equal((await fetch(`${baseUrl}/`)).status, 200);
  assert.deepEqual(await (await fetch(`${baseUrl}/healthz`)).json(), { status: "ok", vaults: 0 });
});

test("preserves the opaque relay API contract", async () => {
  const create = await fetch(`${baseUrl}/v1/vaults`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vaultId, authVerifier }) });
  assert.equal(create.status, 201);
  assert.equal((await fetch(`${baseUrl}/v1/vaults/${vaultId}/updates?after=0`)).status, 401);

  const append = await fetch(`${baseUrl}/v1/vaults/${vaultId}/updates`, { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ updates: [envelope] }) });
  assert.deepEqual(await append.json(), { accepted: [{ updateId: envelope.updateId, cursor: 1 }] });
  const duplicate = await fetch(`${baseUrl}/v1/vaults/${vaultId}/updates`, { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ updates: [envelope] }) });
  assert.deepEqual(await duplicate.json(), { accepted: [{ updateId: envelope.updateId, cursor: 1 }] });

  const listed = await (await fetch(`${baseUrl}/v1/vaults/${vaultId}/updates?after=0`, { headers: { authorization } })).json();
  assert.equal(listed.nextCursor, 1);
  assert.deepEqual(listed.updates, [{ cursor: 1, envelope }]);

  const snapshot = { ...envelope, kind: "snapshot", updateId: "22222222-2222-4222-8222-222222222222" };
  assert.equal((await fetch(`${baseUrl}/v1/vaults/${vaultId}/snapshot`, { method: "PUT", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ coversThrough: 1, envelope: snapshot }) })).status, 204);
  const bootstrap = await (await fetch(`${baseUrl}/v1/vaults/${vaultId}/bootstrap`, { headers: { authorization } })).json();
  assert.deepEqual(bootstrap, { snapshot: { cursor: 1, envelope: snapshot }, updates: [], nextCursor: 1 });
});

test("migrates persisted Miniflare vaults without decrypting them", () => {
  const legacyDirectory = join(temporaryDirectory, "legacy");
  mkdirSync(legacyDirectory);
  const sourcePath = join(legacyDirectory, `${"a".repeat(64)}.sqlite`);
  const source = new DatabaseSync(sourcePath);
  source.exec("PRAGMA journal_mode = WAL");
  source.exec("CREATE TABLE __miniflare_do_name (id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE vault_meta (singleton INTEGER PRIMARY KEY, auth_verifier TEXT, created_at TEXT); CREATE TABLE updates (cursor INTEGER PRIMARY KEY, update_id TEXT, kind TEXT, nonce TEXT, ciphertext TEXT, created_at TEXT); CREATE TABLE snapshots (singleton INTEGER PRIMARY KEY, cursor INTEGER, update_id TEXT, nonce TEXT, ciphertext TEXT, created_at TEXT)");
  source.prepare("INSERT INTO __miniflare_do_name(id, name) VALUES (1, ?)").run(vaultId);
  source.prepare("INSERT INTO vault_meta(singleton, auth_verifier, created_at) VALUES (1, ?, ?)").run(authVerifier, envelope.createdAt);
  source.prepare("INSERT INTO updates(cursor, update_id, kind, nonce, ciphertext, created_at) VALUES (1, ?, 'update', ?, ?, ?)").run(envelope.updateId, envelope.nonce, envelope.ciphertext, envelope.createdAt);
  source.close();
  chmodSync(legacyDirectory, 0o555);

  const migratedPath = join(temporaryDirectory, "migrated.sqlite");
  assert.deepEqual(migrateMiniflareState(legacyDirectory, migratedPath), { updates: 1, vaults: 1 });
  chmodSync(legacyDirectory, 0o755);
  const migrated = openRelayDatabase(migratedPath);
  assert.equal(migrated.prepare("SELECT COUNT(*) AS count FROM vaults").get().count, 1);
  assert.equal(migrated.prepare("SELECT COUNT(*) AS count FROM updates").get().count, 1);
  assert.equal(migrated.prepare("SELECT ciphertext FROM updates").get().ciphertext, envelope.ciphertext);
  migrated.close();
});
