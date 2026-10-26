import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";

import { IndexedDbSyncStateStore } from "../../src/storage/sync-indexeddb.js";

describe("IndexedDbSyncStateStore", () => {
  it("persists resume checkpoints across reopen and metadata writes, then clears them on restore", async () => {
    const name = `checkpoint-${crypto.randomUUID()}`;
    const vault = "vault";
    const checkpoint = { version: 1 as const, cursor: 7, fingerprint: "verified-plan-hash", relayUpdateId: "verified-relay-update" };
    const first = new IndexedDbSyncStateStore(name);
    await first.setCursor(vault, 7);
    await first.setResumeCheckpoint(vault, checkpoint);
    await first.destroy();
    const second = new IndexedDbSyncStateStore(name);
    expect(await second.getResumeCheckpoint(vault)).toEqual(checkpoint);
    await second.setCursor(vault, 8);
    await second.resetAcknowledgedSinceSnapshot(vault);
    expect(await second.getResumeCheckpoint(vault)).toEqual(checkpoint);
    expect(await second.getCursor(vault)).toBe(8);
    await second.resetForServerRestore();
    expect(await second.getResumeCheckpoint(vault)).toBeNull();
    expect(await second.getCursor(vault)).toBe(0);
    await second.destroy();
  });

  it("keeps encrypted outbox entries after close and reopen", async () => {
    const name = `sync-${crypto.randomUUID()}`;
    const first = new IndexedDbSyncStateStore(name);
    const envelope = { version: 1 as const, kind: "update" as const, vaultId: "AAAAAAAAAAAAAAAAAAAAAA", updateId: "11111111-1111-4111-8111-111111111111", nonce: "AAAAAAAAAAAAAAAA", ciphertext: "AAAAAAAAAAAAAAAAAAAAAA", createdAt: "2026-08-04T00:00:00.000Z" };
    await first.enqueue({ envelope, queuedAt: envelope.createdAt });
    await first.destroy();
    const second = new IndexedDbSyncStateStore(name);
    expect(await second.listOutbox(envelope.vaultId, 10)).toEqual([{ envelope, queuedAt: envelope.createdAt }]);
    await second.destroy();
  });
});
