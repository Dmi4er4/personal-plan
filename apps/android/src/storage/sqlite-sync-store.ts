import type { OutboxEntry, SyncStateStore } from "@personal-plan/sync";
import type { SQLiteDatabase } from "expo-sqlite";
import { openPersonalPlanDatabase } from "./sqlite-database";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sync_meta (vault_id TEXT PRIMARY KEY, cursor INTEGER NOT NULL DEFAULT 0, acknowledged_since_snapshot INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS outbox (update_id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, envelope_json TEXT NOT NULL, queued_at TEXT NOT NULL);
`;

export class SqliteSyncStateStore implements SyncStateStore {
  constructor(private readonly dbPromise: Promise<SQLiteDatabase> = openPersonalPlanDatabase()) {}
  private async db(): Promise<SQLiteDatabase> { const db = await this.dbPromise; await db.execAsync(SCHEMA); return db; }
  private async ensure(vaultId: string): Promise<SQLiteDatabase> { const db = await this.db(); await db.runAsync("INSERT OR IGNORE INTO sync_meta(vault_id) VALUES(?)", vaultId); return db; }
  async getCursor(vaultId: string): Promise<number> { const db = await this.ensure(vaultId); return (await db.getFirstAsync<{ cursor: number }>("SELECT cursor FROM sync_meta WHERE vault_id=?", vaultId))?.cursor ?? 0; }
  async setCursor(vaultId: string, cursor: number): Promise<void> { const db = await this.ensure(vaultId); await db.runAsync("UPDATE sync_meta SET cursor=? WHERE vault_id=?", cursor, vaultId); }
  async enqueue(entry: OutboxEntry): Promise<void> { const db = await this.db(); await db.runAsync("INSERT OR IGNORE INTO outbox(update_id,vault_id,envelope_json,queued_at) VALUES(?,?,?,?)", entry.envelope.updateId, entry.envelope.vaultId, JSON.stringify(entry.envelope), entry.queuedAt); }
  async listOutbox(vaultId: string, limit: number): Promise<OutboxEntry[]> { const db = await this.db(); const rows = await db.getAllAsync<{ envelope_json: string; queued_at: string }>("SELECT envelope_json,queued_at FROM outbox WHERE vault_id=? ORDER BY queued_at,update_id LIMIT ?", vaultId, limit); return rows.map((row) => ({ envelope: JSON.parse(row.envelope_json) as OutboxEntry["envelope"], queuedAt: row.queued_at })); }
  async acknowledge(updateIds: string[]): Promise<number> { if (updateIds.length === 0) return 0; const db = await this.db(); let count = 0; await db.withTransactionAsync(async () => { for (const id of updateIds) { const result = await db.runAsync("DELETE FROM outbox WHERE update_id=?", id); count += result.changes; } }); if (count > 0) { const vaults = await db.getAllAsync<{ vault_id: string }>("SELECT vault_id FROM sync_meta"); for (const { vault_id } of vaults) await db.runAsync("UPDATE sync_meta SET acknowledged_since_snapshot=acknowledged_since_snapshot+? WHERE vault_id=?", count, vault_id); } return count; }
  async getAcknowledgedSinceSnapshot(vaultId: string): Promise<number> { const db = await this.ensure(vaultId); return (await db.getFirstAsync<{ value: number }>("SELECT acknowledged_since_snapshot AS value FROM sync_meta WHERE vault_id=?", vaultId))?.value ?? 0; }
  async resetAcknowledgedSinceSnapshot(vaultId: string): Promise<void> { const db = await this.ensure(vaultId); await db.runAsync("UPDATE sync_meta SET acknowledged_since_snapshot=0 WHERE vault_id=?", vaultId); }
  async resetAll(): Promise<void> {
    const db = await this.db();
    await db.withTransactionAsync(async () => {
      await db.runAsync("DELETE FROM outbox");
      await db.runAsync("DELETE FROM sync_meta");
    });
  }
}
