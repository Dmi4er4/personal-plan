import { addTask, snapshotPlan } from "@personal-plan/core";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
vi.mock("expo-sqlite", () => ({ openDatabaseAsync: async () => { throw new Error("not used"); } }));
import { SqlitePlanStore } from "../../src/storage/sqlite-plan-store";

class FakeDatabase {
  updates: Uint8Array[] = []; draft: string | null = null;
  async execAsync() {}
  async getAllAsync<T>(sql: string): Promise<T[]> { if (sql.includes("y_updates")) return this.updates.map((bytes) => ({ bytes })) as T[]; return []; }
  async getFirstAsync<T>(sql: string): Promise<T | null> { if (sql.includes("drafts")) return (this.draft === null ? null : { value: this.draft }) as T | null; if (sql.includes("COUNT")) return { count: this.updates.length, bytes: this.updates.reduce((size, update) => size + update.length, 0), largest: Math.max(0, ...this.updates.map((update) => update.length)) } as T; return null; }
  async runAsync(sql: string, value?: unknown) { if (sql.startsWith("INSERT INTO y_updates")) this.updates.push((value as Uint8Array).slice()); else if (sql.startsWith("DELETE FROM y_updates")) this.updates = []; else if (sql.startsWith("INSERT INTO drafts")) this.draft = value as string; else if (sql.startsWith("DELETE FROM drafts")) this.draft = null; return { changes: 1, lastInsertRowId: 0 }; }
  async withTransactionAsync(task: () => Promise<void>) { await task(); }
}

class BlockingCompactionDatabase extends FakeDatabase {
  readonly deleteStarted: Promise<void>;
  private markDeleteStarted!: () => void;
  private readonly deleteReleased: Promise<void>;
  private releaseDelete!: () => void;

  constructor() {
    super();
    this.deleteStarted = new Promise((resolve) => { this.markDeleteStarted = resolve; });
    this.deleteReleased = new Promise((resolve) => { this.releaseDelete = resolve; });
  }

  override async runAsync(sql: string, value?: unknown) {
    if (sql.startsWith("DELETE FROM y_updates")) {
      this.markDeleteStarted();
      await this.deleteReleased;
    }
    return super.runAsync(sql, value);
  }

  allowDelete(): void {
    this.releaseDelete();
  }
}

describe("SQLite Yjs persistence", () => {
  it("merges overlapping, out-of-order updates while retaining deletions", async () => {
    const source = new Y.Doc();
    const updates: Uint8Array[] = [];
    source.on("update", (update: Uint8Array) => updates.push(update));
    source.getText("text").insert(0, "first");
    source.getText("text").insert(5, " second");
    source.getText("text").delete(0, 6);
    const db = new FakeDatabase();
    const [initial, addition, deletion] = updates;
    if (initial === undefined || addition === undefined || deletion === undefined) throw new Error("fixture_update_missing");
    db.updates = [addition, initial, deletion, initial];
    const loaded = await new SqlitePlanStore(Promise.resolve(db as never)).load();
    expect(loaded.getText("text").toString()).toBe(source.getText("text").toString());
    expect(Y.encodeStateVector(loaded)).toEqual(Y.encodeStateVector(source));
  });

  it("compacts a large replay journal even below the 200-row limit", async () => {
    const source = new Y.Doc();
    source.getMap("payload").set("bytes", new Uint8Array(600_000).fill(7));
    const fullState = Y.encodeStateAsUpdate(source);
    const db = new FakeDatabase();
    db.updates = [fullState, fullState, fullState];
    const store = new SqlitePlanStore(Promise.resolve(db as never));
    const doc = await store.load();

    await store.prepareCheckpoint();

    expect(db.updates).toHaveLength(1);
    const loaded = await new SqlitePlanStore(Promise.resolve(db as never)).load();
    expect(Y.encodeStateAsUpdate(loaded)).toEqual(Y.encodeStateAsUpdate(doc));
  });

  it("does not repeatedly compact an intrinsically large single snapshot", async () => {
    const source = new Y.Doc();
    source.getMap("payload").set("bytes", new Uint8Array(2_000_000));
    const db = new FakeDatabase();
    db.updates = [Y.encodeStateAsUpdate(source)];
    const store = new SqlitePlanStore(Promise.resolve(db as never));
    await store.load();
    const compact = vi.spyOn(store, "compact");
    await store.prepareCheckpoint();
    await store.prepareCheckpoint();
    expect(compact).not.toHaveBeenCalled();
  });

  it.each(["structs", "deletions"])("persists pending %s even when Yjs emits no update event", async (kind) => {
    const source = new Y.Doc();
    const updates: Uint8Array[] = [];
    source.on("update", (update: Uint8Array) => updates.push(update));
    source.getMap("tasks").set("dependency", "first");
    if (kind === "structs") source.getMap("tasks").set("pending", "must survive restart");
    else source.getMap("tasks").delete("dependency");
    const db = new FakeDatabase();
    const first = new SqlitePlanStore(Promise.resolve(db as never));
    const doc = await first.load();
    const later = updates.at(1); const initial = updates.at(0);
    if (later === undefined || initial === undefined) throw new Error("fixture_update_missing");
    const observed = vi.fn();
    doc.on("update", observed);
    Y.applyUpdate(doc, later);
    expect(observed).not.toHaveBeenCalled();

    await first.flush();

    expect(db.updates).toHaveLength(1);
    const reopened = new SqlitePlanStore(Promise.resolve(db as never));
    const loaded = await reopened.load();
    expect(Y.encodeStateAsUpdate(loaded)).toEqual(Y.encodeStateAsUpdate(doc));
    Y.applyUpdate(loaded, initial);
    if (kind === "structs") expect(loaded.getMap("tasks").get("pending")).toBe("must survive restart");
    else expect(loaded.getMap("tasks").has("dependency")).toBe(false);
  });

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

  it("keeps an update written while compaction is in flight", async () => {
    const db = new BlockingCompactionDatabase();
    const store = new SqlitePlanStore(Promise.resolve(db as never));
    const doc = await store.load();
    addTask(doc, { id: "before", title: "До compaction", note: null, bucket: { kind: "later" }, parentId: null, order: 0, now: "2026-08-12T10:00:00.000Z" });
    await store.flush();

    const compacting = store.compact(doc);
    await db.deleteStarted;
    addTask(doc, { id: "during", title: "Во время compaction", note: null, bucket: { kind: "later" }, parentId: null, order: 1, now: "2026-08-12T10:01:00.000Z" });
    db.allowDelete();
    await compacting;
    await store.flush();

    const reopened = new SqlitePlanStore(Promise.resolve(db as never));
    expect(snapshotPlan(await reopened.load()).tasks.map(({ id }) => id)).toEqual(["before", "during"]);
  });
});
