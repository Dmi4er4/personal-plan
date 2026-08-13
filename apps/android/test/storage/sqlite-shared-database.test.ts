import { describe, expect, it, vi } from "vitest";
import { SqlitePlanStore } from "../../src/storage/sqlite-plan-store";
import { SqliteSyncStateStore } from "../../src/storage/sqlite-sync-store";

vi.mock("expo-sqlite", () => ({ openDatabaseAsync: async () => { throw new Error("not used"); } }));

class FakeDatabase {
  updates: Uint8Array[] = [];
  draft: string | null = null;
  outbox: string[] = [];
  syncMeta: string[] = [];

  async execAsync() {}

  async getAllAsync<T>(sql: string): Promise<T[]> {
    if (sql.includes("y_updates")) return this.updates.map((bytes) => ({ bytes })) as T[];
    if (sql.includes("outbox")) return this.outbox.map((envelope_json) => ({ envelope_json, queued_at: "2026-08-04T10:00:00.000Z" })) as T[];
    if (sql.includes("sync_meta")) return this.syncMeta.map((vault_id) => ({ vault_id })) as T[];
    return [];
  }

  async getFirstAsync<T>(sql: string): Promise<T | null> {
    if (sql.includes("drafts")) return (this.draft === null ? null : { value: this.draft }) as T | null;
    if (sql.includes("COUNT")) return { count: this.updates.length } as T;
    if (sql.includes("cursor")) return { cursor: 0 } as T;
    if (sql.includes("acknowledged_since_snapshot")) return { value: 0 } as T;
    return null;
  }

  async runAsync(sql: string, ...values: unknown[]) {
    if (sql.startsWith("INSERT INTO y_updates")) this.updates.push((values[0] as Uint8Array).slice());
    else if (sql.startsWith("DELETE FROM y_updates")) this.updates = [];
    else if (sql.startsWith("INSERT INTO drafts")) this.draft = values[0] as string;
    else if (sql.startsWith("DELETE FROM drafts")) this.draft = null;
    else if (sql.startsWith("INSERT OR IGNORE INTO outbox")) this.outbox.push(values[2] as string);
    else if (sql.startsWith("DELETE FROM outbox")) this.outbox = [];
    else if (sql.startsWith("INSERT OR IGNORE INTO sync_meta")) this.syncMeta.push(values[0] as string);
    else if (sql.startsWith("DELETE FROM sync_meta")) this.syncMeta = [];
    return { changes: 1, lastInsertRowId: 0 };
  }

  async withTransactionAsync(task: () => Promise<void>) {
    await task();
  }
}

describe("shared sqlite database", () => {
  it("clears plan and sync tables from one connection during restore reset", async () => {
    const db = new FakeDatabase();
    const dbPromise = Promise.resolve(db as never);
    const planStore = new SqlitePlanStore(dbPromise);
    const syncStore = new SqliteSyncStateStore(dbPromise);

    await planStore.load();
    await syncStore.setCursor("vault-a", 3);
    await syncStore.enqueue({
      envelope: {
        version: 1,
        kind: "update",
        vaultId: "vault-a",
        updateId: "u1",
        nonce: "n",
        ciphertext: "c",
        createdAt: "2026-08-04T10:00:00.000Z",
      },
      queuedAt: "2026-08-04T10:00:00.000Z",
    });

    await planStore.reset();

    expect(db.updates).toHaveLength(0);
    expect(db.outbox).toHaveLength(0);
    expect(db.syncMeta).toHaveLength(0);
    expect(await syncStore.getCursor("vault-a")).toBe(0);
  });
});
