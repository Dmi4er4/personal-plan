import { createPlanDoc } from "@personal-plan/core";
import type { SQLiteDatabase } from "expo-sqlite";
import * as Y from "yjs";
import { openPersonalPlanDatabase } from "./sqlite-database";

const REPLAY_ORIGIN = Symbol("sqlite-replay");
const MAX_REPLAY_BYTES = 1024 * 1024;
const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS y_updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, bytes BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS sync_meta (vault_id TEXT PRIMARY KEY, cursor INTEGER NOT NULL DEFAULT 0, acknowledged_since_snapshot INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS outbox (update_id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, envelope_json TEXT NOT NULL, queued_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS drafts (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_checkpoints (vault_id TEXT PRIMARY KEY, cursor INTEGER NOT NULL, fingerprint TEXT NOT NULL, relay_update_id TEXT);
`;

export class SqlitePlanStore {
  private doc: Y.Doc | null = null;
  private persistTail: Promise<void> = Promise.resolve();
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;
  private persistedPending: { structs: Uint8Array | null; deletions: Uint8Array | null } | null = null;
  private storageRevision = 0;
  private checkpointCache: Uint8Array | null = null;
  private compactionCheckedRevision = -1;
  constructor(private readonly dbPromise: Promise<SQLiteDatabase> = openPersonalPlanDatabase()) {}

  async initialize(): Promise<SQLiteDatabase> {
    const db = await this.dbPromise;
    await db.execAsync(SCHEMA);
    return db;
  }

  async load(): Promise<Y.Doc> {
    if (this.doc !== null) {
      return this.doc;
    }
    const started = performance.now();
    const db = await this.initialize();
    const doc = createPlanDoc();
    const rows = await db.getAllAsync<{ bytes: Uint8Array }>("SELECT bytes FROM y_updates ORDER BY seq");
    const readAt = performance.now();
    // Old journals contain overlapping full-state updates. Merge their binary
    // structs first instead of repeatedly rebuilding the same Yjs objects.
    const updates = rows.map((row) => new Uint8Array(row.bytes));
    const merged = updates.length > 1 ? Y.mergeUpdates(updates) : updates[0];
    const mergedAt = performance.now();
    if (merged !== undefined) Y.applyUpdate(doc, merged, REPLAY_ORIGIN);
    const loadedAt = performance.now();
    console.info(`personal-plan perf load rows=${String(rows.length)} bytes=${String(rows.reduce((size, row) => size + row.bytes.length, 0))} readMs=${String(Math.round(readAt - started))} mergeMs=${String(Math.round(mergedAt - readAt))} applyMs=${String(Math.round(loadedAt - mergedAt))} totalMs=${String(Math.round(loadedAt - started))}`);

    this.updateHandler = (update, origin) => {
      if (origin === REPLAY_ORIGIN) return;
      const copy = update.slice();
      this.storageRevision += 1; this.checkpointCache = null;
      this.persistTail = this.persistTail.then(async () => { await db.runAsync("INSERT INTO y_updates(bytes) VALUES (?)", copy); });
    };
    doc.on("update", this.updateHandler);
    this.doc = doc;
    this.persistedPending = this.pendingState(doc);
    return doc;
  }

  private pendingState(doc: Y.Doc): { structs: Uint8Array | null; deletions: Uint8Array | null } {
    return { structs: doc.store.pendingStructs?.update ?? null, deletions: doc.store.pendingDs };
  }

  async flush(): Promise<void> {
    for (;;) {
      const tail = this.persistTail;
      await tail;
      if (tail !== this.persistTail) continue;
      if (this.doc === null) return;
      const doc = this.doc;
      const pending = this.pendingState(doc);
      if (pending.structs === null && pending.deletions === null) { this.persistedPending = pending; return; }
      if (this.persistedPending?.structs === pending.structs && this.persistedPending.deletions === pending.deletions) return;
      // Pending operations do not emit Yjs's update event. Persist a complete
      // state before the relay cursor/checkpoint can acknowledge them.
      this.persistTail = tail.then(async () => {
        const db = await this.initialize();
        const update = Y.encodeStateAsUpdate(doc);
        const persisted = this.pendingState(doc);
        this.storageRevision += 1; this.checkpointCache = null;
        await db.runAsync("INSERT INTO y_updates(bytes) VALUES (?)", update);
        if (this.doc === doc) this.persistedPending = persisted;
      });
    }
  }

  async checkpointBytes(doc: Y.Doc): Promise<Uint8Array | null> {
    const started = performance.now();
    await this.flush();
    if (doc !== this.doc) return null;
    if (this.checkpointCache !== null) return this.checkpointCache;
    const revision = this.storageRevision;
    const db = await this.initialize();
    const rows = await db.getAllAsync<{ bytes: Uint8Array }>("SELECT bytes FROM y_updates ORDER BY seq");
    const readAt = performance.now();
    if (revision !== this.storageRevision) return this.checkpointBytes(doc);
    const bytes = new Uint8Array(rows.reduce((size, row) => size + 4 + row.bytes.length, 0));
    const view = new DataView(bytes.buffer);
    let offset = 0;
    for (const row of rows) {
      view.setUint32(offset, row.bytes.length); offset += 4;
      bytes.set(row.bytes, offset); offset += row.bytes.length;
    }
    this.checkpointCache = bytes;
    const finished = performance.now();
    if (bytes.length >= 64 * 1024 || finished - started >= 25) {
      console.info(`personal-plan perf checkpoint rows=${String(rows.length)} bytes=${String(bytes.length)} readMs=${String(Math.round(readAt - started))} copyMs=${String(Math.round(finished - readAt))}`);
    }
    return bytes;
  }

  /** Compact before a sync checkpoint is saved, so its fingerprint remains valid. */
  async prepareCheckpoint(): Promise<void> {
    for (;;) {
      await this.flush();
      const doc = this.doc;
      if (doc === null || this.compactionCheckedRevision === this.storageRevision) return;
      const revision = this.storageRevision;
      const db = await this.initialize();
      const stats = await db.getFirstAsync<{ count: number; bytes: number; largest: number }>(
        "SELECT COUNT(*) AS count,COALESCE(SUM(LENGTH(bytes)),0) AS bytes,COALESCE(MAX(LENGTH(bytes)),0) AS largest FROM y_updates",
      );
      if (doc !== this.doc) return;
      if (revision !== this.storageRevision) continue;
      this.compactionCheckedRevision = revision;
      // A single large snapshot cannot be shrunk by replay compaction. Require
      // meaningful duplication to avoid re-encoding it after every small edit.
      if (stats !== null && (stats.count > 200 || stats.bytes > Math.max(MAX_REPLAY_BYTES, stats.largest * 2))) {
        const started = performance.now();
        await this.compact(doc);
        console.info(`personal-plan perf compact rows=${String(stats.count)} bytesBefore=${String(stats.bytes)} durationMs=${String(Math.round(performance.now() - started))}`);
        continue;
      }
      return;
    }
  }

  async compact(doc = this.doc): Promise<void> {
    if (doc === null) return;
    const compacting = this.persistTail.then(async () => {
      const db = await this.initialize();
      const update = Y.encodeStateAsUpdate(doc);
      this.storageRevision += 1; this.checkpointCache = null;
      const pending = this.pendingState(doc);
      await db.withTransactionAsync(async () => {
        await db.runAsync("DELETE FROM y_updates");
        await db.runAsync("INSERT INTO y_updates(bytes) VALUES (?)", update);
      });
      if (this.doc === doc) this.persistedPending = pending;
    });
    this.persistTail = compacting;
    await compacting;
  }

  async loadDraft(): Promise<string | null> {
    const db = await this.initialize();
    return (await db.getFirstAsync<{ value: string }>("SELECT value FROM drafts WHERE id=1"))?.value ?? null;
  }
  async saveDraft(value: string): Promise<void> {
    const db = await this.initialize();
    await db.runAsync("INSERT INTO drafts(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", value);
  }
  async clearDraft(): Promise<void> { const db = await this.initialize(); await db.runAsync("DELETE FROM drafts WHERE id=1"); }
  async updateCount(): Promise<number> { const db = await this.initialize(); return (await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM y_updates"))?.count ?? 0; }

  detachDoc(expectedDoc?: Y.Doc): void {
    if (this.doc === null || (expectedDoc !== undefined && this.doc !== expectedDoc)) {
      return;
    }
    if (this.updateHandler !== null) {
      this.doc.off("update", this.updateHandler);
      this.updateHandler = null;
    }
    this.doc = null;
    this.persistedPending = null;
    this.checkpointCache = null;
    this.compactionCheckedRevision = -1;
  }

  async reset(): Promise<void> {
    this.detachDoc();
    await this.flush();
    const db = await this.initialize();
    await db.withTransactionAsync(async () => {
      await db.runAsync("DELETE FROM y_updates");
      await db.runAsync("DELETE FROM drafts");
      await db.runAsync("DELETE FROM outbox");
      await db.runAsync("DELETE FROM sync_meta");
      await db.runAsync("DELETE FROM sync_checkpoints");
    });
  }
}
