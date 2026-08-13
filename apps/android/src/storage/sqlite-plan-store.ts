import { createPlanDoc } from "@personal-plan/core";
import type { SQLiteDatabase } from "expo-sqlite";
import * as Y from "yjs";
import { openPersonalPlanDatabase } from "./sqlite-database";

const REPLAY_ORIGIN = Symbol("sqlite-replay");
const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS y_updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, bytes BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS sync_meta (vault_id TEXT PRIMARY KEY, cursor INTEGER NOT NULL DEFAULT 0, acknowledged_since_snapshot INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS outbox (update_id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, envelope_json TEXT NOT NULL, queued_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS drafts (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);
`;

export class SqlitePlanStore {
  private doc: Y.Doc | null = null;
  private persistTail: Promise<void> = Promise.resolve();
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;
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
    const db = await this.initialize();
    const doc = createPlanDoc();
    const rows = await db.getAllAsync<{ bytes: Uint8Array }>("SELECT bytes FROM y_updates ORDER BY seq");
    for (const row of rows) Y.applyUpdate(doc, new Uint8Array(row.bytes), REPLAY_ORIGIN);

    this.updateHandler = (update, origin) => {
      if (origin === REPLAY_ORIGIN) return;
      const copy = update.slice();
      this.persistTail = this.persistTail.then(async () => { await db.runAsync("INSERT INTO y_updates(bytes) VALUES (?)", copy); });
    };
    doc.on("update", this.updateHandler);
    this.doc = doc;
    return doc;
  }

  async flush(): Promise<void> { await this.persistTail; }

  async compact(doc = this.doc): Promise<void> {
    if (doc === null) return;
    await this.flush();
    const db = await this.initialize();
    const update = Y.encodeStateAsUpdate(doc);
    await db.withTransactionAsync(async () => {
      await db.runAsync("DELETE FROM y_updates");
      await db.runAsync("INSERT INTO y_updates(bytes) VALUES (?)", update);
    });
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
    });
  }
}
