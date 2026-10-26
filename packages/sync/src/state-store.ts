import type { EncryptedEnvelope } from "./envelope.js";

export interface OutboxEntry { envelope: EncryptedEnvelope; queuedAt: string }
export interface ResumeCheckpoint { version: 1; cursor: number; fingerprint: string; relayUpdateId: string | null }

export interface SyncStateStore {
  getCursor(vaultId: string): Promise<number>;
  setCursor(vaultId: string, cursor: number): Promise<void>;
  enqueue(entry: OutboxEntry): Promise<void>;
  listOutbox(vaultId: string, limit: number): Promise<OutboxEntry[]>;
  acknowledge(updateIds: string[]): Promise<number>;
  getAcknowledgedSinceSnapshot(vaultId: string): Promise<number>;
  resetAcknowledgedSinceSnapshot(vaultId: string): Promise<void>;
  getResumeCheckpoint?(vaultId: string): Promise<ResumeCheckpoint | null>;
  setResumeCheckpoint?(vaultId: string, checkpoint: ResumeCheckpoint): Promise<void>;
}
