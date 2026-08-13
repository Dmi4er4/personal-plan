import { base64UrlDecode, type EncryptedEnvelope } from "@personal-plan/sync";

import { constantTimeVerifierEqual, parseBearer, verifierFor } from "./auth.js";
import { error, HttpError, json, readJson } from "./http.js";

interface MetaRow extends Record<string, SqlStorageValue> { auth_verifier: string }
interface UpdateRow extends Record<string, SqlStorageValue> { cursor: number; update_id: string; kind: "update" | "snapshot"; nonce: string; ciphertext: string; created_at: string }
interface SnapshotRow extends Record<string, SqlStorageValue> { cursor: number; update_id: string; nonce: string; ciphertext: string; created_at: string }

function routeVaultId(request: Request): string {
  const bodyless = /^\/v1\/vaults\/([^/]+)/u.exec(new URL(request.url).pathname);
  return decodeURIComponent(bodyless?.[1] ?? "");
}

function validBase64(value: unknown, bytes?: number): value is string {
  if (typeof value !== "string") return false;
  try { const decoded = base64UrlDecode(value); return bytes === undefined || decoded.length === bytes; } catch { return false; }
}

function validEnvelope(value: unknown, vaultId: string, kind?: "update" | "snapshot"): value is EncryptedEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  if (item.version !== 1 || (item.kind !== "update" && item.kind !== "snapshot") || (kind !== undefined && item.kind !== kind)) return false;
  if (item.vaultId !== vaultId || typeof item.updateId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(item.updateId)) return false;
  if (!validBase64(item.nonce, 12) || !validBase64(item.ciphertext)) return false;
  const ciphertext = base64UrlDecode(item.ciphertext);
  if (ciphertext.length < 16 || ciphertext.length > 1_048_576) return false;
  return typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt));
}

function envelopeFromRow(vaultId: string, row: UpdateRow | SnapshotRow, kind?: "update" | "snapshot"): EncryptedEnvelope {
  const storedKind = row.kind;
  const envelopeKind = kind ?? (storedKind === "update" || storedKind === "snapshot" ? storedKind : "snapshot");
  return { version: 1, kind: envelopeKind, vaultId, updateId: row.update_id, nonce: row.nonce, ciphertext: row.ciphertext, createdAt: row.created_at };
}

export class VaultObject {
  readonly #ctx: DurableObjectState;
  readonly #ready: Promise<void>;

  constructor(ctx: DurableObjectState) {
    this.#ctx = ctx;
    this.#ready = ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS vault_meta (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), auth_verifier TEXT NOT NULL, created_at TEXT NOT NULL)");
      ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS updates (cursor INTEGER PRIMARY KEY AUTOINCREMENT, update_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK (kind IN ('update', 'snapshot')), nonce TEXT NOT NULL, ciphertext TEXT NOT NULL, created_at TEXT NOT NULL)");
      ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS snapshots (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), cursor INTEGER NOT NULL, update_id TEXT NOT NULL, nonce TEXT NOT NULL, ciphertext TEXT NOT NULL, created_at TEXT NOT NULL)");
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.#ready;
    try {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/v1/vaults") return this.#create(request);
      const vaultId = routeVaultId(request);
      const auth = await this.#authenticate(request);
      if (auth !== null) return auth;
      if (request.method === "POST" && url.pathname.endsWith("/updates")) return this.#append(request, vaultId);
      if (request.method === "GET" && url.pathname.endsWith("/updates")) return this.#list(url, vaultId);
      if (request.method === "PUT" && url.pathname.endsWith("/snapshot")) return this.#snapshot(request, vaultId);
      if (request.method === "GET" && url.pathname.endsWith("/bootstrap")) return this.#bootstrap(vaultId);
      if (request.method === "DELETE" && url.pathname === `/v1/vaults/${encodeURIComponent(vaultId)}`) return this.#delete(request, vaultId);
      return error("not_found", 404);
    } catch (reason) {
      if (reason instanceof HttpError) return error(reason.code, reason.status);
      return error("internal_error", 500);
    }
  }

  async #create(request: Request): Promise<Response> {
    const body = await readJson(request);
    if (typeof body !== "object" || body === null) return error("invalid_request", 400);
    const item = body as Record<string, unknown>;
    if (typeof item.vaultId !== "string" || !validBase64(item.authVerifier, 32)) return error("invalid_request", 400);
    const existing = this.#ctx.storage.sql.exec<MetaRow>("SELECT auth_verifier FROM vault_meta WHERE singleton = 1").toArray()[0];
    if (existing !== undefined) return constantTimeVerifierEqual(existing.auth_verifier, item.authVerifier) ? json({ created: false }, 200) : error("vault_conflict", 409);
    this.#ctx.storage.sql.exec("INSERT INTO vault_meta(singleton, auth_verifier, created_at) VALUES (1, ?, ?)", item.authVerifier, new Date().toISOString());
    return json({ created: true }, 201);
  }

  async #authenticate(request: Request): Promise<Response | null> {
    const token = parseBearer(request);
    if (request.headers.get("authorization") === null) return error("authentication_required", 401);
    if (token === null) return error("authentication_failed", 403);
    const meta = this.#ctx.storage.sql.exec<MetaRow>("SELECT auth_verifier FROM vault_meta WHERE singleton = 1").toArray()[0];
    if (meta === undefined || !constantTimeVerifierEqual(meta.auth_verifier, await verifierFor(token))) return error("authentication_failed", 403);
    return null;
  }

  async #append(request: Request, vaultId: string): Promise<Response> {
    const body = await readJson(request);
    const updates = typeof body === "object" && body !== null && "updates" in body ? body.updates : null;
    if (!Array.isArray(updates) || updates.length > 100 || !updates.every((item) => validEnvelope(item, vaultId, "update"))) return error("invalid_updates", 400);
    const accepted: Array<{ updateId: string; cursor: number }> = [];
    this.#ctx.storage.transactionSync(() => {
      for (const update of updates) {
        this.#ctx.storage.sql.exec("INSERT OR IGNORE INTO updates(update_id, kind, nonce, ciphertext, created_at) VALUES (?, ?, ?, ?, ?)", update.updateId, update.kind, update.nonce, update.ciphertext, update.createdAt);
        const row = this.#ctx.storage.sql.exec<{ cursor: number }>("SELECT cursor FROM updates WHERE update_id = ?", update.updateId).toArray()[0];
        if (row === undefined) throw new Error("Inserted update was not found");
        accepted.push({ updateId: update.updateId, cursor: row.cursor });
      }
    });
    return json({ accepted });
  }

  #list(url: URL, vaultId: string): Response {
    const rawAfter = url.searchParams.get("after") ?? "0";
    if (!/^\d+$/u.test(rawAfter)) return error("invalid_cursor", 400);
    const after = Number(rawAfter);
    if (!Number.isSafeInteger(after)) return error("invalid_cursor", 400);
    const rows = this.#ctx.storage.sql.exec<UpdateRow>("SELECT cursor, update_id, kind, nonce, ciphertext, created_at FROM updates WHERE cursor > ? ORDER BY cursor ASC LIMIT 500", after).toArray();
    const updates = rows.map((row) => ({ cursor: row.cursor, envelope: envelopeFromRow(vaultId, row) }));
    return json({ updates, nextCursor: rows.at(-1)?.cursor ?? after });
  }

  async #snapshot(request: Request, vaultId: string): Promise<Response> {
    const body = await readJson(request);
    if (typeof body !== "object" || body === null) return error("invalid_snapshot", 400);
    const item = body as Record<string, unknown>;
    if (!Number.isSafeInteger(item.coversThrough) || (item.coversThrough as number) < 0 || !validEnvelope(item.envelope, vaultId, "snapshot")) return error("invalid_snapshot", 400);
    const max = this.#ctx.storage.sql.exec<{ cursor: number }>("SELECT COALESCE(MAX(cursor), 0) AS cursor FROM updates").toArray()[0]?.cursor ?? 0;
    const coversThrough = item.coversThrough as number;
    if (coversThrough > max) return error("snapshot_ahead_of_log", 400);
    const envelope = item.envelope;
    const current = this.#ctx.storage.sql.exec<{ cursor: number }>("SELECT cursor FROM snapshots WHERE singleton = 1").toArray()[0];
    if (current === undefined || coversThrough >= current.cursor) {
      this.#ctx.storage.sql.exec("INSERT INTO snapshots(singleton, cursor, update_id, nonce, ciphertext, created_at) VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET cursor=excluded.cursor, update_id=excluded.update_id, nonce=excluded.nonce, ciphertext=excluded.ciphertext, created_at=excluded.created_at", coversThrough, envelope.updateId, envelope.nonce, envelope.ciphertext, envelope.createdAt);
    }
    return new Response(null, { status: 204 });
  }

  #bootstrap(vaultId: string): Response {
    const snapshot = this.#ctx.storage.sql.exec<SnapshotRow>("SELECT cursor, update_id, nonce, ciphertext, created_at FROM snapshots WHERE singleton = 1").toArray()[0];
    const after = snapshot?.cursor ?? 0;
    const rows = this.#ctx.storage.sql.exec<UpdateRow>("SELECT cursor, update_id, kind, nonce, ciphertext, created_at FROM updates WHERE cursor > ? ORDER BY cursor ASC", after).toArray();
    const max = this.#ctx.storage.sql.exec<{ cursor: number }>("SELECT COALESCE(MAX(cursor), 0) AS cursor FROM updates").toArray()[0]?.cursor ?? 0;
    return json({ snapshot: snapshot === undefined ? null : { cursor: snapshot.cursor, envelope: envelopeFromRow(vaultId, snapshot, "snapshot") }, updates: rows.map((row) => ({ cursor: row.cursor, envelope: envelopeFromRow(vaultId, row) })), nextCursor: max });
  }

  async #delete(request: Request, vaultId: string): Promise<Response> {
    if (request.headers.get("x-confirm-delete") !== vaultId) return error("delete_confirmation_required", 400);
    await this.#ctx.storage.deleteAll();
    return new Response(null, { status: 204 });
  }
}
