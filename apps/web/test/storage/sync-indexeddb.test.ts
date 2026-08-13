import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";

import { IndexedDbSyncStateStore } from "../../src/storage/sync-indexeddb.js";

describe("IndexedDbSyncStateStore", () => {
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
