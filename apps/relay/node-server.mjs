import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const MAX_BODY_BYTES = 2_000_000;
const MAX_ENVELOPE_BYTES = 1_048_576;
const UPDATE_PAGE_SIZE = 500;

function base64UrlDecode(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/u.test(value)) throw new TypeError("invalid_base64url");
  return Buffer.from(value, "base64url");
}

function validVaultId(value) {
  try {
    return base64UrlDecode(value).length === 16;
  } catch {
    return false;
  }
}

function validBase64Url(value, bytes) {
  try {
    const decoded = base64UrlDecode(value);
    return bytes === undefined ? true : decoded.length === bytes;
  } catch {
    return false;
  }
}

function validEnvelope(value, vaultId, expectedKind) {
  if (typeof value !== "object" || value === null) return false;
  if (value.version !== 1 || value.kind !== expectedKind || value.vaultId !== vaultId) return false;
  if (typeof value.updateId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.updateId)) return false;
  if (!validBase64Url(value.nonce, 12) || !validBase64Url(value.ciphertext)) return false;
  const ciphertextBytes = base64UrlDecode(value.ciphertext).length;
  if (ciphertextBytes < 16 || ciphertextBytes > MAX_ENVELOPE_BYTES) return false;
  return typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt));
}

function json(response, value, status = 200) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function apiError(response, code, status) {
  json(response, { error: code }, status);
}

async function readJson(request) {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw Object.assign(new Error("request_too_large"), { status: 413 });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("request_too_large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("invalid_json"), { status: 400 });
  }
}

function initializeSchema(database) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS relay_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vaults (
      vault_id TEXT PRIMARY KEY,
      auth_verifier TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS updates (
      vault_id TEXT NOT NULL REFERENCES vaults(vault_id) ON DELETE CASCADE,
      cursor INTEGER NOT NULL,
      update_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind = 'update'),
      nonce TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (vault_id, cursor),
      UNIQUE (vault_id, update_id)
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      vault_id TEXT PRIMARY KEY REFERENCES vaults(vault_id) ON DELETE CASCADE,
      cursor INTEGER NOT NULL,
      update_id TEXT NOT NULL,
      nonce TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

export function openRelayDatabase(databasePath, { journalMode = "WAL" } = {}) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`PRAGMA journal_mode = ${journalMode};`);
  database.exec("PRAGMA synchronous = FULL;");
  initializeSchema(database);
  return database;
}

function tableExists(database, table) {
  return database.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = ? AND name = ?").get("table", table) !== undefined;
}

function importLegacyVault(target, source) {
  if (!tableExists(source, "__miniflare_do_name") || !tableExists(source, "vault_meta")) return false;
  const vaultId = source.prepare("SELECT name FROM __miniflare_do_name LIMIT 1").get()?.name;
  const metadata = source.prepare("SELECT auth_verifier, created_at FROM vault_meta WHERE singleton = 1").get();
  if (!validVaultId(vaultId) || metadata === undefined || !validBase64Url(metadata.auth_verifier, 32)) return false;

  target.prepare("INSERT OR IGNORE INTO vaults(vault_id, auth_verifier, created_at) VALUES (?, ?, ?)").run(vaultId, metadata.auth_verifier, metadata.created_at);
  if (tableExists(source, "updates")) {
    const insert = target.prepare("INSERT OR IGNORE INTO updates(vault_id, cursor, update_id, kind, nonce, ciphertext, created_at) VALUES (?, ?, ?, 'update', ?, ?, ?)");
    for (const row of source.prepare("SELECT cursor, update_id, kind, nonce, ciphertext, created_at FROM updates ORDER BY cursor").iterate()) {
      const envelope = { version: 1, kind: row.kind, vaultId, updateId: row.update_id, nonce: row.nonce, ciphertext: row.ciphertext, createdAt: row.created_at };
      if (!validEnvelope(envelope, vaultId, "update") || !Number.isSafeInteger(row.cursor) || row.cursor < 1) throw new Error("invalid_legacy_update");
      insert.run(vaultId, row.cursor, row.update_id, row.nonce, row.ciphertext, row.created_at);
    }
  }
  if (tableExists(source, "snapshots")) {
    const row = source.prepare("SELECT cursor, update_id, nonce, ciphertext, created_at FROM snapshots WHERE singleton = 1").get();
    if (row !== undefined) {
      const envelope = { version: 1, kind: "snapshot", vaultId, updateId: row.update_id, nonce: row.nonce, ciphertext: row.ciphertext, createdAt: row.created_at };
      if (!validEnvelope(envelope, vaultId, "snapshot") || !Number.isSafeInteger(row.cursor) || row.cursor < 0) throw new Error("invalid_legacy_snapshot");
      target.prepare("INSERT OR REPLACE INTO snapshots(vault_id, cursor, update_id, nonce, ciphertext, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(vaultId, row.cursor, row.update_id, row.nonce, row.ciphertext, row.created_at);
    }
  }
  return true;
}

function openLegacyDatabase(databasePath) {
  // SQLite databases that were cleanly closed in WAL mode may have neither a
  // WAL nor an SHM sidecar. Opening such a database from a read-only mount can
  // still try to create the sidecars. `immutable=1` is safe only in this exact
  // case: there is no WAL whose uncheckpointed records could be skipped.
  if (!existsSync(`${databasePath}-wal`) && !existsSync(`${databasePath}-shm`)) {
    const databaseUrl = pathToFileURL(databasePath);
    databaseUrl.searchParams.set("immutable", "1");
    return new DatabaseSync(databaseUrl, { readOnly: true });
  }
  return new DatabaseSync(databasePath, { readOnly: true });
}

export function migrateMiniflareState(legacyDirectory, targetPath) {
  const temporaryPath = `${targetPath}.migrating-${process.pid}-${Date.now()}`;
  const target = openRelayDatabase(temporaryPath, { journalMode: "DELETE" });
  let vaults = 0;
  let updates;
  try {
    target.exec("BEGIN IMMEDIATE");
    if (legacyDirectory !== undefined && existsSync(legacyDirectory)) {
      for (const file of readdirSync(legacyDirectory).filter((name) => /^[0-9a-f]{64}\.sqlite$/u.test(name)).sort()) {
        const source = openLegacyDatabase(join(legacyDirectory, file));
        try {
          if (importLegacyVault(target, source)) vaults += 1;
        } finally {
          source.close();
        }
      }
    }
    updates = Number(target.prepare("SELECT COUNT(*) AS count FROM updates").get().count);
    target.prepare("INSERT OR REPLACE INTO relay_meta(key, value) VALUES ('legacy_migration_complete', ?)").run(new Date().toISOString());
    target.exec("COMMIT");
  } catch (error) {
    try { target.exec("ROLLBACK"); } catch { /* already rolled back */ }
    target.close();
    throw error;
  }
  target.close();
  renameSync(temporaryPath, targetPath);
  return { updates, vaults };
}

export function ensureRelayDatabase(databasePath, legacyDirectory) {
  if (!existsSync(databasePath)) migrateMiniflareState(legacyDirectory, databasePath);
  const database = openRelayDatabase(databasePath);
  database.prepare("INSERT OR IGNORE INTO relay_meta(key, value) VALUES ('schema_version', '1')").run();
  return database;
}

function verifierForToken(token) {
  return createHash("sha256").update(token).digest("base64url");
}

function authenticate(database, request, vaultId) {
  const authorization = request.headers.authorization;
  if (authorization === undefined) return { code: "authentication_required", status: 401 };
  const match = /^Bearer ([A-Za-z0-9_-]+)$/u.exec(authorization);
  if (match === null) return { code: "authentication_failed", status: 403 };
  let token;
  try { token = base64UrlDecode(match[1]); } catch { return { code: "authentication_failed", status: 403 }; }
  if (token.length !== 32) return { code: "authentication_failed", status: 403 };
  const stored = database.prepare("SELECT auth_verifier FROM vaults WHERE vault_id = ?").get(vaultId)?.auth_verifier;
  if (typeof stored !== "string") return { code: "authentication_failed", status: 403 };
  const actual = Buffer.from(verifierForToken(token));
  const expected = Buffer.from(stored);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { code: "authentication_failed", status: 403 };
  return null;
}

function envelopeFromRow(vaultId, row, kind = "update") {
  return { version: 1, kind, vaultId, updateId: row.update_id, nonce: row.nonce, ciphertext: row.ciphertext, createdAt: row.created_at };
}

function appendUpdates(database, vaultId, updates) {
  const accepted = [];
  database.exec("BEGIN IMMEDIATE");
  try {
    const existing = database.prepare("SELECT cursor FROM updates WHERE vault_id = ? AND update_id = ?");
    const nextCursor = database.prepare("SELECT COALESCE(MAX(cursor), 0) + 1 AS cursor FROM updates WHERE vault_id = ?");
    const insert = database.prepare("INSERT INTO updates(vault_id, cursor, update_id, kind, nonce, ciphertext, created_at) VALUES (?, ?, ?, 'update', ?, ?, ?)");
    for (const update of updates) {
      const previous = existing.get(vaultId, update.updateId);
      if (previous !== undefined) {
        accepted.push({ updateId: update.updateId, cursor: previous.cursor });
        continue;
      }
      const cursor = Number(nextCursor.get(vaultId).cursor);
      insert.run(vaultId, cursor, update.updateId, update.nonce, update.ciphertext, update.createdAt);
      accepted.push({ updateId: update.updateId, cursor });
    }
    database.exec("COMMIT");
    return accepted;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw error;
  }
}

async function handleApi(database, request, response, url) {
  if (request.method === "GET" && url.pathname === "/healthz") {
    const vaults = Number(database.prepare("SELECT COUNT(*) AS count FROM vaults").get().count);
    json(response, { status: "ok", vaults });
    return { route: "health", vaultId: null };
  }
  if (request.method === "POST" && url.pathname === "/v1/vaults") {
    const body = await readJson(request);
    if (typeof body !== "object" || body === null || !validVaultId(body.vaultId) || !validBase64Url(body.authVerifier, 32)) {
      apiError(response, "invalid_request", 400);
      return { route: "create", vaultId: null };
    }
    const existing = database.prepare("SELECT auth_verifier FROM vaults WHERE vault_id = ?").get(body.vaultId);
    if (existing !== undefined) {
      const left = Buffer.from(existing.auth_verifier);
      const right = Buffer.from(body.authVerifier);
      if (left.length !== right.length || !timingSafeEqual(left, right)) apiError(response, "vault_conflict", 409);
      else json(response, { created: false }, 200);
      return { route: "create", vaultId: body.vaultId };
    }
    database.prepare("INSERT INTO vaults(vault_id, auth_verifier, created_at) VALUES (?, ?, ?)").run(body.vaultId, body.authVerifier, new Date().toISOString());
    json(response, { created: true }, 201);
    return { route: "create", vaultId: body.vaultId };
  }

  const match = /^\/v1\/vaults\/([^/]+)(?:\/(updates|snapshot|bootstrap))?$/u.exec(url.pathname);
  if (match === null) {
    apiError(response, "not_found", 404);
    return { route: "not_found", vaultId: null };
  }
  const vaultId = decodeURIComponent(match[1] ?? "");
  if (!validVaultId(vaultId)) {
    apiError(response, "invalid_vault_id", 400);
    return { route: "invalid", vaultId: null };
  }
  const authError = authenticate(database, request, vaultId);
  if (authError !== null) {
    apiError(response, authError.code, authError.status);
    return { route: "auth", vaultId };
  }

  if (request.method === "POST" && match[2] === "updates") {
    const body = await readJson(request);
    if (typeof body !== "object" || body === null || !Array.isArray(body.updates) || body.updates.length > 100 || !body.updates.every((item) => validEnvelope(item, vaultId, "update"))) {
      apiError(response, "invalid_updates", 400);
    } else {
      json(response, { accepted: appendUpdates(database, vaultId, body.updates) });
    }
    return { route: "append", vaultId };
  }

  if (request.method === "GET" && match[2] === "updates") {
    const rawAfter = url.searchParams.get("after") ?? "0";
    if (!/^\d+$/u.test(rawAfter) || !Number.isSafeInteger(Number(rawAfter))) {
      apiError(response, "invalid_cursor", 400);
      return { route: "list", vaultId };
    }
    const after = Number(rawAfter);
    const rows = database.prepare("SELECT cursor, update_id, nonce, ciphertext, created_at FROM updates WHERE vault_id = ? AND cursor > ? ORDER BY cursor LIMIT ?").all(vaultId, after, UPDATE_PAGE_SIZE);
    json(response, { updates: rows.map((row) => ({ cursor: row.cursor, envelope: envelopeFromRow(vaultId, row) })), nextCursor: rows.at(-1)?.cursor ?? after });
    return { route: "list", vaultId };
  }

  if (request.method === "PUT" && match[2] === "snapshot") {
    const body = await readJson(request);
    if (typeof body !== "object" || body === null || !Number.isSafeInteger(body.coversThrough) || body.coversThrough < 0 || !validEnvelope(body.envelope, vaultId, "snapshot")) {
      apiError(response, "invalid_snapshot", 400);
      return { route: "snapshot", vaultId };
    }
    const maximum = Number(database.prepare("SELECT COALESCE(MAX(cursor), 0) AS cursor FROM updates WHERE vault_id = ?").get(vaultId).cursor);
    if (body.coversThrough > maximum) {
      apiError(response, "snapshot_ahead_of_log", 400);
      return { route: "snapshot", vaultId };
    }
    const current = database.prepare("SELECT cursor FROM snapshots WHERE vault_id = ?").get(vaultId);
    if (current === undefined || body.coversThrough >= current.cursor) {
      database.prepare("INSERT INTO snapshots(vault_id, cursor, update_id, nonce, ciphertext, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(vault_id) DO UPDATE SET cursor=excluded.cursor, update_id=excluded.update_id, nonce=excluded.nonce, ciphertext=excluded.ciphertext, created_at=excluded.created_at").run(vaultId, body.coversThrough, body.envelope.updateId, body.envelope.nonce, body.envelope.ciphertext, body.envelope.createdAt);
    }
    response.writeHead(204, { "cache-control": "no-store" });
    response.end();
    return { route: "snapshot", vaultId };
  }

  if (request.method === "GET" && match[2] === "bootstrap") {
    const snapshot = database.prepare("SELECT cursor, update_id, nonce, ciphertext, created_at FROM snapshots WHERE vault_id = ?").get(vaultId);
    const after = snapshot?.cursor ?? 0;
    const rows = database.prepare("SELECT cursor, update_id, nonce, ciphertext, created_at FROM updates WHERE vault_id = ? AND cursor > ? ORDER BY cursor").all(vaultId, after);
    const maximum = Number(database.prepare("SELECT COALESCE(MAX(cursor), 0) AS cursor FROM updates WHERE vault_id = ?").get(vaultId).cursor);
    json(response, {
      snapshot: snapshot === undefined ? null : { cursor: snapshot.cursor, envelope: envelopeFromRow(vaultId, snapshot, "snapshot") },
      updates: rows.map((row) => ({ cursor: row.cursor, envelope: envelopeFromRow(vaultId, row) })),
      nextCursor: maximum,
    });
    return { route: "bootstrap", vaultId };
  }

  if (request.method === "DELETE" && match[2] === undefined) {
    if (request.headers["x-confirm-delete"] !== vaultId) {
      apiError(response, "delete_confirmation_required", 400);
      return { route: "delete", vaultId };
    }
    database.prepare("DELETE FROM vaults WHERE vault_id = ?").run(vaultId);
    response.writeHead(204, { "cache-control": "no-store" });
    response.end();
    return { route: "delete", vaultId };
  }

  apiError(response, "not_found", 404);
  return { route: "not_found", vaultId };
}

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

function serveStatic(staticDirectory, request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { allow: "GET, HEAD" });
    response.end();
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { response.writeHead(400); response.end(); return; }
  const root = resolve(staticDirectory);
  let candidate = resolve(root, `.${pathname}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    response.writeHead(403);
    response.end();
    return;
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile()) candidate = join(root, "index.html");
  if (!existsSync(candidate) || !statSync(candidate).isFile()) {
    response.writeHead(404);
    response.end();
    return;
  }
  const headers = {
    "cache-control": candidate.endsWith("index.html") || candidate.endsWith("sw.js") ? "no-cache" : "public, max-age=3600",
    "content-length": statSync(candidate).size,
    "content-type": MIME_TYPES.get(extname(candidate)) ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
  };
  response.writeHead(200, headers);
  if (request.method === "HEAD") response.end();
  else createReadStream(candidate).pipe(response);
}

function vaultFingerprint(vaultId) {
  return vaultId === null ? undefined : createHash("sha256").update(vaultId).digest("hex").slice(0, 12);
}

export function createRelayServer({ databasePath, legacyDirectory, staticDirectory }) {
  const database = ensureRelayDatabase(databasePath, legacyDirectory);
  const server = createServer(async (request, response) => {
    const started = Date.now();
    let diagnostic = { route: "static", vaultId: null };
    try {
      const url = new URL(request.url ?? "/", "http://relay.local");
      if (url.pathname === "/healthz" || url.pathname.startsWith("/v1/")) diagnostic = await handleApi(database, request, response, url);
      else serveStatic(staticDirectory, request, response, url);
    } catch (error) {
      const status = Number.isSafeInteger(error?.status) ? error.status : 500;
      const code = status === 400 && error?.message === "invalid_json"
        ? "invalid_json"
        : status === 413
          ? "request_too_large"
          : "internal_error";
      if (!response.headersSent) apiError(response, code, status);
      else response.destroy();
    } finally {
      console.log(JSON.stringify({ at: new Date().toISOString(), durationMs: Date.now() - started, method: request.method, route: diagnostic.route, status: response.statusCode, vault: vaultFingerprint(diagnostic.vaultId) }));
    }
  });
  return {
    database,
    server,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => {
        database.close();
        if (error) rejectClose(error);
        else resolveClose();
      });
    }),
  };
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 || index + 1 >= process.argv.length ? fallback : process.argv[index + 1];
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const databasePath = resolve(argument("--db", "/state/node-relay.sqlite"));
  const legacyDirectory = resolve(argument("--legacy", "/state/v3/do/personal-plan-relay-VaultObject"));
  const staticDirectory = resolve(argument("--static", "/app/apps/web/dist"));
  const host = argument("--host", "0.0.0.0");
  const port = Number(argument("--port", "8787"));
  const relay = createRelayServer({ databasePath, legacyDirectory, staticDirectory });
  relay.server.listen(port, host, () => {
    const aggregates = relay.database.prepare("SELECT (SELECT COUNT(*) FROM vaults) AS vaults, (SELECT COUNT(*) FROM updates) AS updates, (SELECT COALESCE(MAX(cursor), 0) FROM updates) AS maxCursor").get();
    console.log(JSON.stringify({ at: new Date().toISOString(), event: "relay_ready", host, port, vaults: Number(aggregates.vaults), updates: Number(aggregates.updates), maxCursor: Number(aggregates.maxCursor) }));
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void relay.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
