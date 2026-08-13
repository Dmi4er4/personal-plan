import type { EncryptedEnvelope } from "./envelope.js";

export interface CreateVaultRequest { vaultId: string; authVerifier: string }
export interface AppendUpdatesRequest { updates: EncryptedEnvelope[] }
export interface StoredEnvelope { cursor: number; envelope: EncryptedEnvelope }
export interface AppendUpdatesResponse { accepted: Array<{ updateId: string; cursor: number }> }
export interface ListUpdatesResponse { updates: StoredEnvelope[]; nextCursor: number }
export interface BootstrapResponse { snapshot: StoredEnvelope | null; updates: StoredEnvelope[]; nextCursor: number }
export interface PutSnapshotRequest { coversThrough: number; envelope: EncryptedEnvelope & { kind: "snapshot" } }
