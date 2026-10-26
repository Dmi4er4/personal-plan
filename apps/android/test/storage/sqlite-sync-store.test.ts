import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { planCheckpointContent } from "@personal-plan/core";
import { deriveVaultMaterial, encryptPayload, reconcileAtStartup, SyncClient, WebCryptoProvider, type EncryptedEnvelope, type RelayTransport } from "@personal-plan/sync";
import * as Y from "yjs";
vi.mock("expo-sqlite", () => ({ openDatabaseAsync: async () => { throw new Error("not used"); } }));
import { SqlitePlanStore } from "../../src/storage/sqlite-plan-store";
import { SqliteSyncStateStore } from "../../src/storage/sqlite-sync-store";

class TestDatabase {
  readonly database = new DatabaseSync(":memory:");
  async execAsync(sql: string) { this.database.exec(sql); }
  async getFirstAsync<T>(sql: string, ...values: SQLInputValue[]): Promise<T | null> { return this.database.prepare(sql).get(...values) as T | undefined ?? null; }
  async getAllAsync<T>(sql: string, ...values: SQLInputValue[]): Promise<T[]> { return this.database.prepare(sql).all(...values) as T[]; }
  async runAsync(sql: string, ...values: SQLInputValue[]) {
    const result = this.database.prepare(sql).run(...values);
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  }
  async withTransactionAsync(task: () => Promise<void>) {
    this.database.exec("BEGIN");
    try { await task(); this.database.exec("COMMIT"); } catch (reason) { this.database.exec("ROLLBACK"); throw reason; }
  }
}

describe("SQLite resume checkpoint", () => {
  it.each(["structs", "deletions"])("resumes durable pending %s and repairs a lost SQLite write", async (kind) => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(32));
    const source = new Y.Doc(); const updates: Uint8Array[] = [];
    source.on("update", (update: Uint8Array) => updates.push(update));
    source.getMap("tasks").set("dependency", "first");
    if (kind === "structs") source.getMap("tasks").set("pending", "retain this operation");
    else source.getMap("tasks").delete("dependency");
    const later = updates.at(1);
    if (later === undefined) throw new Error("fixture_update_missing");
    const envelopes: EncryptedEnvelope[] = [await encryptPayload(provider, material.encryptionKey, material.vaultId, { kind: "update", updateId: "11111111-1111-4111-8111-111111111111", payload: later, createdAt: "2026-10-12T14:00:00.000Z" })];
    let bootstraps = 0;
    const transport: RelayTransport = {
      createVault: async () => undefined,
      append: async (_vault, _token, incoming) => ({ accepted: incoming.map((envelope) => { envelopes.push(envelope); return { updateId: envelope.updateId, cursor: envelopes.length }; }) }),
      list: async (_vault, _token, after) => ({ updates: envelopes.slice(after).map((envelope, index) => ({ cursor: after + index + 1, envelope })), nextCursor: envelopes.length, anchorUpdateId: envelopes.at(after - 1)?.updateId ?? null }),
      bootstrap: async () => { bootstraps += 1; return { snapshot: null, updates: envelopes.map((envelope, index) => ({ cursor: index + 1, envelope })), nextCursor: envelopes.length }; },
      putSnapshot: async () => undefined,
    };
    const db = new TestDatabase();
    const syncStore = new SqliteSyncStateStore(Promise.resolve(db as never));
    const make = (planStore: SqlitePlanStore) => new SyncClient({ provider, material, store: syncStore, transport, beforeCursorCommit: () => planStore.prepareCheckpoint(), checkpointContent: planCheckpointContent, checkpointBytes: (doc) => planStore.checkpointBytes(doc) });
    const firstStore = new SqlitePlanStore(Promise.resolve(db as never));
    const firstDoc = await firstStore.load(); const first = make(firstStore);
    await reconcileAtStartup(first, firstDoc); await first.stop(); firstStore.detachDoc();
    expect(bootstraps).toBe(1);
    const reopened = new SqlitePlanStore(Promise.resolve(db as never));
    const doc = await reopened.load(); const client = make(reopened);

    expect(await reconcileAtStartup(client, doc)).toMatchObject({ uploaded: 0, downloaded: 0, status: "synced" });
    expect(bootstraps).toBe(1);
    await client.stop(); reopened.detachDoc();
    await db.runAsync("DELETE FROM y_updates");
    const damaged = new SqlitePlanStore(Promise.resolve(db as never));
    const damagedDoc = await damaged.load(); const repair = make(damaged);
    await reconcileAtStartup(repair, damagedDoc);
    expect(bootstraps).toBe(2);
    expect(Y.encodeStateAsUpdate(damagedDoc)).toEqual(Y.encodeStateAsUpdate(doc));
    await repair.stop(); db.database.close();
  });

  it("upgrades an existing schema, preserves checkpoints across metadata writes and resets them", async () => {
    const db = new TestDatabase();
    await db.execAsync("CREATE TABLE sync_meta (vault_id TEXT PRIMARY KEY,cursor INTEGER NOT NULL DEFAULT 0,acknowledged_since_snapshot INTEGER NOT NULL DEFAULT 0)");
    const checkpoint = { version: 1 as const, cursor: 7, fingerprint: "verified-plan", relayUpdateId: "verified-update" };
    const first = new SqliteSyncStateStore(Promise.resolve(db as never));
    await first.setCursor("vault", 7);
    await first.setResumeCheckpoint("vault", checkpoint);
    const reopened = new SqliteSyncStateStore(Promise.resolve(db as never));
    expect(await reopened.getResumeCheckpoint("vault")).toEqual(checkpoint);
    await reopened.setCursor("vault", 8);
    await reopened.resetAcknowledgedSinceSnapshot("vault");
    expect(await reopened.getResumeCheckpoint("vault")).toEqual(checkpoint);
    expect(await reopened.getCursor("vault")).toBe(8);
    await reopened.resetAll();
    expect(await reopened.getResumeCheckpoint("vault")).toBeNull();
    expect(await reopened.getCursor("vault")).toBe(0);
    db.database.close();
  });

  it("resumes after replay-log compaction without downloading the remote history again", async () => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(33));
    const source = new Y.Doc();
    source.getMap("payload").set("bytes", new Uint8Array(20_000).fill(9));
    const fullState = Y.encodeStateAsUpdate(source);
    const envelopes: EncryptedEnvelope[] = [await encryptPayload(provider, material.encryptionKey, material.vaultId, { kind: "update", updateId: "22222222-2222-4222-8222-222222222222", payload: fullState, createdAt: "2026-10-26T11:00:00.000Z" })];
    let bootstraps = 0;
    const transport: RelayTransport = {
      createVault: async () => undefined,
      append: async (_vault, _token, incoming) => ({ accepted: incoming.map((envelope) => { envelopes.push(envelope); return { updateId: envelope.updateId, cursor: envelopes.length }; }) }),
      list: async (_vault, _token, after) => ({ updates: envelopes.slice(after).map((envelope, index) => ({ cursor: after + index + 1, envelope })), nextCursor: envelopes.length, anchorUpdateId: envelopes.at(after - 1)?.updateId ?? null }),
      bootstrap: async () => { bootstraps += 1; return { snapshot: null, updates: envelopes.map((envelope, index) => ({ cursor: index + 1, envelope })), nextCursor: envelopes.length }; },
      putSnapshot: async () => undefined,
    };
    const db = new TestDatabase();
    const syncStore = new SqliteSyncStateStore(Promise.resolve(db as never));
    const make = (store: SqlitePlanStore) => new SyncClient({ provider, material, store: syncStore, transport, beforeCursorCommit: () => store.prepareCheckpoint(), checkpointContent: planCheckpointContent, checkpointBytes: (doc) => store.checkpointBytes(doc) });
    const firstStore = new SqlitePlanStore(Promise.resolve(db as never));
    await firstStore.initialize();
    // Exceed the byte threshold below 200 rows without an oversized live value.
    for (let i = 0; i < 60; i += 1) await db.runAsync("INSERT INTO y_updates(bytes) VALUES (?)", fullState);
    const firstDoc = await firstStore.load();
    const first = make(firstStore);
    await reconcileAtStartup(first, firstDoc);
    expect(await firstStore.updateCount()).toBe(1);
    await first.stop();
    firstStore.detachDoc();

    const reopened = new SqlitePlanStore(Promise.resolve(db as never));
    const doc = await reopened.load();
    const resumed = make(reopened);
    expect(await reconcileAtStartup(resumed, doc)).toMatchObject({ downloaded: 0, uploaded: 0, status: "synced" });
    expect(bootstraps).toBe(1);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(Y.encodeStateAsUpdate(firstDoc));
    await resumed.stop();
    db.database.close();
  });

  it("clears the resume checkpoint when the local plan is reset for restore", async () => {
    const db = new TestDatabase();
    const sync = new SqliteSyncStateStore(Promise.resolve(db as never));
    await sync.setResumeCheckpoint("vault", { version: 1, cursor: 9, fingerprint: "previous-plan", relayUpdateId: "previous-update" });
    const plan = new SqlitePlanStore(Promise.resolve(db as never));
    await plan.reset();
    expect(await sync.getResumeCheckpoint("vault")).toBeNull();
    db.database.close();
  });
});
