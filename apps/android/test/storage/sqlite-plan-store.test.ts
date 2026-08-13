import { addTask, snapshotPlan } from "@personal-plan/core";
import { describe, expect, it, vi } from "vitest";
vi.mock("expo-sqlite", () => ({ openDatabaseAsync: async () => { throw new Error("not used"); } }));
import { SqlitePlanStore } from "../../src/storage/sqlite-plan-store";

class FakeDatabase {
  updates: Uint8Array[] = []; draft: string | null = null;
  async execAsync() {}
  async getAllAsync<T>(sql: string): Promise<T[]> { if (sql.includes("y_updates")) return this.updates.map((bytes) => ({ bytes })) as T[]; return []; }
  async getFirstAsync<T>(sql: string): Promise<T | null> { if (sql.includes("drafts")) return (this.draft === null ? null : { value: this.draft }) as T | null; if (sql.includes("COUNT")) return { count: this.updates.length } as T; return null; }
  async runAsync(sql: string, value?: unknown) { if (sql.startsWith("INSERT INTO y_updates")) this.updates.push((value as Uint8Array).slice()); else if (sql.startsWith("DELETE FROM y_updates")) this.updates = []; else if (sql.startsWith("INSERT INTO drafts")) this.draft = value as string; else if (sql.startsWith("DELETE FROM drafts")) this.draft = null; return { changes: 1, lastInsertRowId: 0 }; }
  async withTransactionAsync(task: () => Promise<void>) { await task(); }
}

describe("SQLite Yjs persistence", () => {
  it("survives store reopen without replay duplication", async () => {
    const db = new FakeDatabase(); const first = new SqlitePlanStore(Promise.resolve(db as never)); const doc = await first.load();
    addTask(doc, { id: "persisted", title: "Пережить перезапуск", note: null, bucket: { kind: "later" }, parentId: null, order: 0, now: "2026-08-04T10:00:00.000Z" }); await first.flush(); expect(db.updates).toHaveLength(1);
    const reopened = new SqlitePlanStore(Promise.resolve(db as never)); const loaded = await reopened.load(); expect(snapshotPlan(loaded).tasks[0]?.title).toBe("Пережить перезапуск"); await reopened.flush(); expect(db.updates).toHaveLength(1);
  });

  it("reuses loaded doc and clears state on reset", async () => {
    const db = new FakeDatabase();
    const store = new SqlitePlanStore(Promise.resolve(db as never));
    const first = await store.load();
    addTask(first, { id: "reset-me", title: "Стереть", note: null, bucket: { kind: "later" }, parentId: null, order: 0, now: "2026-08-04T10:00:00.000Z" });
    await store.flush();
    expect(await store.load()).toBe(first);
    await store.reset();
    const fresh = await store.load();
    expect(fresh).not.toBe(first);
    expect(snapshotPlan(fresh).tasks).toHaveLength(0);
  });

  it("ignores a late detach from the provider that owned the previous doc", async () => {
    const db = new FakeDatabase();
    const store = new SqlitePlanStore(Promise.resolve(db as never));
    const previous = await store.load();
    await store.reset();
    const fresh = await store.load();

    store.detachDoc(previous);
    addTask(fresh, { id: "kept", title: "Сохранить", note: null, bucket: { kind: "later" }, parentId: null, order: 0, now: "2026-08-12T10:00:00.000Z" });
    await store.flush();

    expect(db.updates).toHaveLength(1);
    expect(snapshotPlan(await store.load()).tasks[0]?.id).toBe("kept");
  });
});
