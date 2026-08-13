import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { base64UrlEncode, deriveVaultMaterial, SyncClient, WebCryptoProvider, type AppendUpdatesResponse, type BootstrapResponse, type EncryptedEnvelope, type ListUpdatesResponse, type OutboxEntry, type PutSnapshotRequest, type RelayTransport, type SyncStateStore } from "../src/index.js";

class MemoryStore implements SyncStateStore {
  cursor = 0;
  acknowledged = 0;
  outbox: OutboxEntry[] = [];
  async getCursor() { return this.cursor; }
  async setCursor(_vaultId: string, cursor: number) { this.cursor = cursor; }
  async enqueue(entry: OutboxEntry) { this.outbox.push(entry); }
  async listOutbox(vaultId: string, limit: number) { return this.outbox.filter((entry) => entry.envelope.vaultId === vaultId).slice(0, limit); }
  async acknowledge(ids: string[]) { const before = this.outbox.length; this.outbox = this.outbox.filter((entry) => !ids.includes(entry.envelope.updateId)); const count = before - this.outbox.length; this.acknowledged += count; return count; }
  async getAcknowledgedSinceSnapshot() { return this.acknowledged; }
  async resetAcknowledgedSinceSnapshot() { this.acknowledged = 0; }
}

class MemoryRelay implements RelayTransport {
  updates: EncryptedEnvelope[] = [];
  snapshot: { cursor: number; envelope: EncryptedEnvelope & { kind: "snapshot" } } | null = null;
  async createVault() {}
  async append(_vaultId: string, _authToken: string, updates: EncryptedEnvelope[]): Promise<AppendUpdatesResponse> {
    const accepted = updates.map((envelope) => {
      let cursor = this.updates.findIndex((item) => item.updateId === envelope.updateId) + 1;
      if (cursor === 0) { this.updates.push(envelope); cursor = this.updates.length; }
      return { updateId: envelope.updateId, cursor };
    });
    return { accepted };
  }
  async list(_vaultId: string, _authToken: string, after: number): Promise<ListUpdatesResponse> {
    const updates = this.updates.slice(after).map((envelope, index) => ({ cursor: after + index + 1, envelope }));
    return { updates, nextCursor: this.updates.length };
  }
  async putSnapshot(_vaultId: string, _authToken: string, request: PutSnapshotRequest) { this.snapshot = { cursor: request.coversThrough, envelope: request.envelope }; }
  async bootstrap(): Promise<BootstrapResponse> {
    const after = this.snapshot?.cursor ?? 0;
    return { snapshot: this.snapshot, updates: this.updates.slice(after).map((envelope, index) => ({ cursor: after + index + 1, envelope })), nextCursor: this.updates.length };
  }
}

describe("SyncClient", () => {
  it("persists outboxes and converges two independently edited documents", async () => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(9));
    expect(base64UrlEncode(material.authToken)).not.toBe("");
    const relay = new MemoryRelay();
    const storeA = new MemoryStore();
    const storeB = new MemoryStore();
    const a = new Y.Doc();
    const b = new Y.Doc();
    const clientA = new SyncClient({ provider, material, store: storeA, transport: relay });
    const clientB = new SyncClient({ provider, material, store: storeB, transport: relay });
    clientA.start(a);
    clientB.start(b);
    a.getMap("tasks").set("a", "Дело A");
    b.getMap("tasks").set("b", "Дело B");
    await Promise.all([clientA.stop(), clientB.stop()]);
    expect(storeA.outbox).toHaveLength(1);
    expect(storeB.outbox).toHaveLength(1);
    await clientA.syncOnce(a);
    await clientB.syncOnce(b);
    await clientA.syncOnce(a);
    expect(a.getMap("tasks").toJSON()).toEqual(b.getMap("tasks").toJSON());
    expect(a.getMap("tasks").toJSON()).toEqual({ a: "Дело A", b: "Дело B" });
    expect(storeA.outbox).toHaveLength(0);
    expect(storeB.outbox).toHaveLength(0);
    const clean = new Y.Doc();
    clean.getMap("tasks");
    const bootstrap = new SyncClient({ provider, material, store: new MemoryStore(), transport: relay });
    await bootstrap.bootstrapInto(clean);
    expect(clean.getMap("tasks").toJSON()).toEqual(a.getMap("tasks").toJSON());
  });

  it("uploads an encrypted full snapshot after 200 acknowledged updates", async () => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(3));
    const relay = new MemoryRelay();
    const store = new MemoryStore();
    store.acknowledged = 199;
    const doc = new Y.Doc();
    doc.getMap("tasks");
    const client = new SyncClient({ provider, material, store, transport: relay });
    client.start(doc);
    doc.getMap("tasks").set("snapshot-task", "Только в шифротексте");
    await client.syncOnce(doc);
    expect(relay.snapshot?.cursor).toBe(1);
    expect(relay.snapshot?.envelope.kind).toBe("snapshot");
    expect(JSON.stringify(relay.snapshot)).not.toContain("Только в шифротексте");
    expect(store.acknowledged).toBe(0);
    const restored = new Y.Doc();
    restored.getMap("tasks");
    await new SyncClient({ provider, material, store: new MemoryStore(), transport: relay }).bootstrapInto(restored);
    expect(restored.getMap("tasks").toJSON()).toEqual(doc.getMap("tasks").toJSON());
  });
});
