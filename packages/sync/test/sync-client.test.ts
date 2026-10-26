import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { base64UrlEncode, deriveVaultMaterial, reconcileAtStartup, SyncClient, SyncIntegrityError, WebCryptoProvider, type AppendUpdatesResponse, type BootstrapResponse, type EncryptedEnvelope, type ListUpdatesResponse, type OutboxEntry, type PutSnapshotRequest, type RelayTransport, type SyncStateStore } from "../src/index.js";

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

class PagedMemoryRelay extends MemoryRelay {
  bootstrapCalls = 0;
  readonly listedAfter: number[] = [];

  override async bootstrap(): Promise<BootstrapResponse> {
    this.bootstrapCalls += 1;
    const response = await super.bootstrap();
    const updates = response.updates.slice(0, 2);
    return { ...response, updates, nextCursor: updates.at(-1)?.cursor ?? response.snapshot?.cursor ?? 0, hasMore: response.updates.length > updates.length };
  }

  override async list(vaultId: string, authToken: string, after: number): Promise<ListUpdatesResponse> {
    this.listedAfter.push(after);
    const response = await super.list(vaultId, authToken, after);
    const updates = response.updates.slice(0, 2);
    return { ...response, updates, nextCursor: updates.at(-1)?.cursor ?? after, hasMore: response.updates.length > updates.length };
  }
}

class CheckpointStore extends MemoryStore {
  checkpoint: { version: 1; cursor: number; fingerprint: string; relayUpdateId: string | null } | null = null;
  async getResumeCheckpoint() { return this.checkpoint; }
  async setResumeCheckpoint(_vaultId: string, checkpoint: NonNullable<CheckpointStore["checkpoint"]>) { this.checkpoint = checkpoint; }
}

class TrafficRelay extends MemoryRelay {
  uploadedBytes = 0;
  downloadedBytes = 0;
  bootstrapCalls = 0;
  resetTraffic() { this.uploadedBytes = 0; this.downloadedBytes = 0; this.bootstrapCalls = 0; }
  override async append(vaultId: string, authToken: string, updates: EncryptedEnvelope[]) {
    this.uploadedBytes += new TextEncoder().encode(JSON.stringify({ updates })).length;
    return super.append(vaultId, authToken, updates);
  }
  override async list(vaultId: string, authToken: string, after: number) {
    const response = await super.list(vaultId, authToken, after);
    const anchored = { ...response, anchorUpdateId: this.updates[after - 1]?.updateId ?? null };
    this.downloadedBytes += new TextEncoder().encode(JSON.stringify(anchored)).length;
    return anchored;
  }
  override async bootstrap() {
    this.bootstrapCalls += 1;
    const response = await super.bootstrap();
    this.downloadedBytes += new TextEncoder().encode(JSON.stringify(response)).length;
    return response;
  }
  override async putSnapshot(vaultId: string, authToken: string, request: PutSnapshotRequest) {
    this.uploadedBytes += new TextEncoder().encode(JSON.stringify(request)).length;
    return super.putSnapshot(vaultId, authToken, request);
  }
}

class BlockingEnqueueStore extends MemoryStore {
  readonly enqueueStarted: Promise<void>;
  private markEnqueueStarted!: () => void;
  private readonly enqueueReleased: Promise<void>;
  private releaseEnqueue!: () => void;

  constructor() {
    super();
    this.enqueueStarted = new Promise((resolve) => { this.markEnqueueStarted = resolve; });
    this.enqueueReleased = new Promise((resolve) => { this.releaseEnqueue = resolve; });
  }

  override async enqueue(entry: OutboxEntry): Promise<void> {
    this.markEnqueueStarted();
    await this.enqueueReleased;
    await super.enqueue(entry);
  }

  allowEnqueue(): void {
    this.releaseEnqueue();
  }
}

class BlockingListRelay extends MemoryRelay {
  readonly listStarted: Promise<void>;
  private markListStarted!: () => void;
  private readonly listReleased: Promise<void>;
  private releaseList!: () => void;

  constructor() {
    super();
    this.listStarted = new Promise((resolve) => { this.markListStarted = resolve; });
    this.listReleased = new Promise((resolve) => { this.releaseList = resolve; });
  }

  override async list(vaultId: string, authToken: string, after: number): Promise<ListUpdatesResponse> {
    this.markListStarted();
    await this.listReleased;
    return super.list(vaultId, authToken, after);
  }

  allowList(): void {
    this.releaseList();
  }
}

describe("SyncClient", () => {
  it("does not acknowledge a late edit while persistence bytes are being read", async () => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(33));
    const store = new CheckpointStore(); const transport = new TrafficRelay();
    const hook: { edit: (() => void) | null } = { edit: null };
    const checkpointBytes = async (value: Y.Doc) => {
      const bytes = Y.encodeStateAsUpdate(value);
      const edit = hook.edit; hook.edit = null; edit?.();
      await Promise.resolve();
      return bytes;
    };
    const options = { provider, material, store, transport, checkpointBytes, beforeCursorCommit: async () => undefined };
    const doc = new Y.Doc(); doc.getMap("tasks").set("first", "keep");
    const first = new SyncClient(options);
    await reconcileAtStartup(first, doc);
    const saved = store.checkpoint;
    hook.edit = () => doc.getMap("tasks").set("late", "recover this edit");

    expect(await first.syncOnce(doc)).toMatchObject({ status: "pending" });
    expect(store.checkpoint).toEqual(saved);
    await first.stop(); store.outbox = [];
    const reopened = new Y.Doc(); Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc));
    const second = new SyncClient(options);
    expect(await second.canResumeFromCheckpoint(reopened)).toBe(false);
    await reconcileAtStartup(second, reopened);
    const restored = new Y.Doc();
    await new SyncClient({ provider, material, store: new MemoryStore(), transport }).bootstrapInto(restored);
    expect(restored.getMap("tasks").get("late")).toBe("recover this edit");
    await second.stop();
  });

  it("rejects changed logical content even with identical clocks and deletions", async () => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(30));
    const store = new CheckpointStore();
    const transport = new TrafficRelay();
    const checkpointContent = (value: Y.Doc) => new TextEncoder().encode(JSON.stringify(value.getMap("tasks").toJSON()));
    const options = { provider, material, store, transport, checkpointContent, beforeCursorCommit: async () => undefined };
    const doc = new Y.Doc();
    doc.getMap("tasks").set("title", "Original");
    const first = new SyncClient(options);
    await reconcileAtStartup(first, doc);
    await first.stop();
    const bytes = Y.encodeStateAsUpdate(doc);
    const needle = new TextEncoder().encode("Original");
    const offset = bytes.findIndex((_byte, index) => needle.every((byte, position) => bytes[index + position] === byte));
    expect(offset).toBeGreaterThanOrEqual(0);
    bytes.set(new TextEncoder().encode("Corrupt!"), offset);
    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, bytes);
    expect(Y.encodeSnapshot(Y.snapshot(reopened))).toEqual(Y.encodeSnapshot(Y.snapshot(doc)));

    expect(await new SyncClient(options).canResumeFromCheckpoint(reopened)).toBe(false);
  });

  it("rejects a lost pending update even if the visible content and snapshot are unchanged", async () => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(31));
    const store = new CheckpointStore();
    const transport = new TrafficRelay();
    const checkpointContent = (value: Y.Doc) => new TextEncoder().encode(JSON.stringify(value.getMap("tasks").toJSON()));
    const options = { provider, material, store, transport, checkpointContent, beforeCursorCommit: async () => undefined };
    const source = new Y.Doc();
    const updates: Uint8Array[] = [];
    source.on("update", (update: Uint8Array) => updates.push(update));
    source.getMap("tasks").set("first", "dependency");
    source.getMap("tasks").set("pending", "retain this operation");
    const doc = new Y.Doc();
    Y.applyUpdate(doc, updates[1]);
    const first = new SyncClient(options);
    await reconcileAtStartup(first, doc);
    await first.stop();
    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc));
    expect(await new SyncClient(options).canResumeFromCheckpoint(reopened)).toBe(true);
    const missingPending = new Y.Doc();
    expect(Y.encodeSnapshot(Y.snapshot(missingPending))).toEqual(Y.encodeSnapshot(Y.snapshot(doc)));

    expect(await new SyncClient(options).canResumeFromCheckpoint(missingPending)).toBe(false);
  });

  it("resumes a persisted document after replay normalizes deleted content", async () => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(29));
    const relay = new TrafficRelay();
    const store = new CheckpointStore();
    const doc = new Y.Doc({ gc: false });
    doc.getText("note").insert(0, "Deleted prefix. Keep this note.");
    doc.getText("note").delete(0, 16);
    const first = new SyncClient({ provider, material, store, transport: relay, beforeCursorCommit: async () => undefined });
    await reconcileAtStartup(first, doc);
    await first.stop();
    const persisted = Y.encodeStateAsUpdate(doc);
    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, persisted);
    expect(Y.encodeStateAsUpdate(reopened)).not.toEqual(persisted);
    relay.resetTraffic();
    const client = new SyncClient({ provider, material, store, transport: relay, beforeCursorCommit: async () => undefined });

    await reconcileAtStartup(client, reopened);

    expect(reopened.getText("note").toJSON()).toBe("Keep this note.");
    expect(relay.bootstrapCalls).toBe(0);
    expect(relay.uploadedBytes).toBe(0);
    expect(relay.downloadedBytes).toBeLessThan(500);
    await client.stop();
  });

  it("repairs a replaced relay history even when the cursor number has not changed", async () => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(22));
    const relay = new TrafficRelay();
    const store = new CheckpointStore();
    const doc = new Y.Doc();
    doc.getMap("tasks").set("original", "Retain local backup");
    const first = new SyncClient({ provider, material, store, transport: relay, beforeCursorCommit: async () => undefined });
    await reconcileAtStartup(first, doc);
    await first.stop();
    const priorId = relay.updates[0]?.updateId;
    relay.updates = [];
    const replacementDoc = new Y.Doc();
    const replacementWriter = new SyncClient({ provider, material, store: new MemoryStore(), transport: relay });
    replacementWriter.start(replacementDoc);
    replacementDoc.getMap("tasks").set("replacement", "New remote edit");
    await replacementWriter.syncOnce(replacementDoc);
    expect(relay.updates).toHaveLength(1);
    expect(relay.updates[0]?.updateId).not.toBe(priorId);
    const background = new SyncClient({ provider, material, store, transport: relay, beforeCursorCommit: async () => undefined });
    background.start(doc);
    await background.syncOnce(doc);
    expect(store.checkpoint?.relayUpdateId).toBe(priorId);
    await background.stop();
    relay.resetTraffic();
    const client = new SyncClient({ provider, material, store, transport: relay, beforeCursorCommit: async () => undefined });

    await reconcileAtStartup(client, doc);

    expect(relay.bootstrapCalls).toBe(1);
    const restored = new Y.Doc();
    await new SyncClient({ provider, material, store: new MemoryStore(), transport: relay }).bootstrapInto(restored);
    expect(restored.getMap("tasks").toJSON()).toEqual({ original: "Retain local backup", replacement: "New remote edit" });
  });

  it("does not checkpoint an edit that arrives during an empty outbox read", async () => {
    class LateReadStore extends CheckpointStore {
      armed = false;
      readonly readStarted: Promise<void>;
      private markReadStarted!: () => void;
      private readonly released: Promise<void>;
      private release!: () => void;
      constructor() {
        super();
        this.readStarted = new Promise((resolve) => { this.markReadStarted = resolve; });
        this.released = new Promise((resolve) => { this.release = resolve; });
      }
      override async listOutbox(vaultId: string, limit: number) {
        const entries = await super.listOutbox(vaultId, limit);
        if (this.armed && limit === 1) {
          this.armed = false;
          this.markReadStarted();
          await this.released;
        }
        return entries;
      }
      allowRead() { this.release(); }
    }
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(23));
    const relay = new TrafficRelay();
    const store = new LateReadStore();
    const doc = new Y.Doc();
    doc.getMap("tasks").set("original", "Durable");
    const first = new SyncClient({ provider, material, store, transport: relay, beforeCursorCommit: async () => undefined });
    await reconcileAtStartup(first, doc);
    await first.stop();
    const fingerprintBefore = store.checkpoint?.fingerprint;
    const client = new SyncClient({ provider, material, store, transport: relay, beforeCursorCommit: async () => undefined });
    client.start(doc);
    expect(await client.canResumeFromCheckpoint(doc)).toBe(true);
    store.armed = true;
    const syncing = client.syncOnce(doc);
    await store.readStarted;
    doc.getMap("tasks").set("during-read", "Preserve through a crash");
    store.allowRead();

    expect(await syncing).toMatchObject({ status: "pending" });
    expect(store.checkpoint?.fingerprint).toBe(fingerprintBefore);
    await client.stop();
    store.outbox = [];
    const recovery = new SyncClient({ provider, material, store, transport: relay, beforeCursorCommit: async () => undefined });
    expect(await recovery.canResumeFromCheckpoint(doc)).toBe(false);
    await reconcileAtStartup(recovery, doc);
    const restored = new Y.Doc();
    await new SyncClient({ provider, material, store: new MemoryStore(), transport: relay }).bootstrapInto(restored);
    expect(restored.getMap("tasks").get("during-read")).toBe("Preserve through a crash");
  });

  it("reopens an unchanged large plan using only an empty incremental response", async () => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(19));
    const relay = new TrafficRelay();
    const store = new CheckpointStore();
    const doc = new Y.Doc();
    doc.getMap("tasks").set("large", "x".repeat(400_000));
    const first = new SyncClient({ provider, material, store, transport: relay, beforeCursorCommit: async () => undefined });
    await reconcileAtStartup(first, doc);
    await first.stop();
    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc));
    relay.resetTraffic();
    const client = new SyncClient({ provider, material, store, transport: relay, beforeCursorCommit: async () => undefined });

    await reconcileAtStartup(client, reopened);

    expect(relay.bootstrapCalls).toBe(0);
    expect(relay.uploadedBytes).toBe(0);
    expect(relay.downloadedBytes).toBeLessThan(500);
    expect(reopened.getMap<string>("tasks").get("large")?.length).toBe(400_000);
  });

  it("transfers two small edits to a cold receiving client without full-plan packets", async () => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(20));
    const relay = new TrafficRelay();
    const a = new Y.Doc();
    a.getMap("tasks").set("large", "x".repeat(400_000));
    a.getMap("tasks").set("day", "2026-10-12");
    a.getMap("tasks").set("completed", false);
    const writer = new SyncClient({ provider, material, store: new CheckpointStore(), transport: relay, beforeCursorCommit: async () => undefined });
    await reconcileAtStartup(writer, a);
    const b = new Y.Doc();
    const receiverStore = new CheckpointStore();
    const receiver = new SyncClient({ provider, material, store: receiverStore, transport: relay, beforeCursorCommit: async () => undefined });
    await reconcileAtStartup(receiver, b);
    await receiver.stop();
    const persisted = Y.encodeStateAsUpdate(b);
    relay.resetTraffic();
    a.transact(() => {
      a.getMap("tasks").set("day", "2026-10-13");
      a.getMap("tasks").set("completed", true);
    });
    await writer.syncOnce(a);
    const cold = new Y.Doc();
    Y.applyUpdate(cold, persisted);
    const client = new SyncClient({ provider, material, store: receiverStore, transport: relay, beforeCursorCommit: async () => undefined });

    await reconcileAtStartup(client, cold);

    expect(relay.bootstrapCalls).toBe(0);
    expect(relay.uploadedBytes + relay.downloadedBytes).toBeLessThan(2_000);
    expect(cold.getMap("tasks").get("day")).toBe("2026-10-13");
    expect(cold.getMap("tasks").get("completed")).toBe(true);
    expect(cold.getMap<string>("tasks").get("large")?.length).toBe(400_000);
  });

  it.each([false, true])("repairs a lost offline deletion outbox with unchanged clocks (logical content=%s)", async (logical) => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(21));
    const relay = new TrafficRelay();
    const store = new CheckpointStore();
    const checkpointContent = logical ? (value: Y.Doc) => new TextEncoder().encode(JSON.stringify(value.getMap("tasks").toJSON())) : undefined;
    const doc = new Y.Doc();
    doc.getMap("tasks").set("large", "x".repeat(100_000));
    doc.getMap("tasks").set("deleted-offline", "Remove me");
    const first = new SyncClient({ provider, material, store, transport: relay, beforeCursorCommit: async () => undefined, checkpointContent });
    await reconcileAtStartup(first, doc);
    await first.stop();
    const vectorBeforeDeletion = Y.encodeStateVector(doc);
    doc.getMap("tasks").delete("deleted-offline");
    expect(Y.encodeStateVector(doc)).toEqual(vectorBeforeDeletion);
    expect(store.outbox).toHaveLength(0);
    relay.resetTraffic();
    const client = new SyncClient({ provider, material, store, transport: relay, beforeCursorCommit: async () => undefined, checkpointContent });

    await reconcileAtStartup(client, doc);

    expect(relay.bootstrapCalls).toBe(1);
    expect(relay.uploadedBytes).toBeLessThan(2_000);
    const restored = new Y.Doc();
    await new SyncClient({ provider, material, store: new MemoryStore(), transport: relay }).bootstrapInto(restored);
    expect(restored.getMap("tasks").has("deleted-offline")).toBe(false);
    expect(restored.getMap<string>("tasks").get("large")?.length).toBe(100_000);
  });

  it("sends accumulated large offline updates in batches below the relay body limit", async () => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(18));
    class BodyLimitedRelay extends MemoryRelay {
      override async append(vaultId: string, authToken: string, updates: EncryptedEnvelope[]) {
        if (new TextEncoder().encode(JSON.stringify({ updates })).length > 2_000_000) throw new Error("relay_http_413");
        return super.append(vaultId, authToken, updates);
      }
    }
    const relay = new BodyLimitedRelay();
    const store = new MemoryStore();
    const doc = new Y.Doc();
    const client = new SyncClient({ provider, material, store, transport: relay });
    client.start(doc);
    for (let index = 0; index < 4; index += 1) doc.getMap("tasks").set("large", `${String(index)}${"x".repeat(450_000)}`);
    await client.stop();

    expect(await client.syncOnce(doc)).toMatchObject({ uploaded: 2, status: "pending" });
    expect(store.outbox).toHaveLength(2);
    expect(await client.syncOnce(doc)).toMatchObject({ uploaded: 2, status: "synced" });
    expect(store.outbox).toHaveLength(0);
    const restored = new Y.Doc();
    await new SyncClient({ provider, material, store: new MemoryStore(), transport: relay }).bootstrapInto(restored);
    expect(restored.getMap<string>("tasks").get("large")?.length).toBe(450_001);
    expect(restored.getMap<string>("tasks").get("large")?.startsWith("3")).toBe(true);
  });

  it("keeps the local document and cursor intact when a later bootstrap page is corrupt", async () => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(10));
    const relay = new PagedMemoryRelay();
    const remoteDoc = new Y.Doc();
    const writer = new SyncClient({ provider, material, store: new MemoryStore(), transport: relay });
    writer.start(remoteDoc);
    for (let index = 0; index < 5; index += 1) remoteDoc.getMap("tasks").set(`remote-${String(index)}`, index);
    await writer.stop();
    await writer.syncOnce(remoteDoc);
    relay.updates[4] = { ...relay.updates[4], nonce: "invalid" };
    const doc = new Y.Doc();
    doc.getMap("tasks").set("local", "Preserved");
    const store = new MemoryStore();
    const reader = new SyncClient({ provider, material, store, transport: relay });

    await expect(reader.bootstrapInto(doc)).rejects.toBeInstanceOf(SyncIntegrityError);
    expect(doc.getMap("tasks").toJSON()).toEqual({ local: "Preserved" });
    expect(store.cursor).toBe(0);
  });

  it("publishes a fresh snapshot after replaying a large history", async () => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(11));
    const relay = new PagedMemoryRelay();
    const source = new Y.Doc();
    const sourceStore = new MemoryStore();
    const writer = new SyncClient({ provider, material, store: sourceStore, transport: relay });
    writer.start(source);
    for (let index = 0; index < 4; index += 1) source.getMap("tasks").set("large", `${String(index)}${"x".repeat(450_000)}`);
    await writer.stop();
    await relay.append(material.vaultId, base64UrlEncode(material.authToken), sourceStore.outbox.map((entry) => entry.envelope));
    const doc = new Y.Doc();
    const reader = new SyncClient({ provider, material, store: new MemoryStore(), transport: relay });

    await reconcileAtStartup(reader, doc);

    expect(doc.getMap<string>("tasks").get("large")?.length).toBe(450_001);
    expect(relay.snapshot?.cursor).toBe(4);
    expect(relay.snapshot?.envelope.ciphertext.length).toBeLessThan(700_000);
    const nextBootstrap = await relay.bootstrap();
    expect(nextBootstrap.updates).toHaveLength(0);
  });

  it("retries an interrupted upload without repeating a completed bootstrap", async () => {
    let attempts = 0;
    let bootstraps = 0;
    let checkpoints = 0;
    const success = { uploaded: 1, downloaded: 0, cursor: 1, status: "synced" as const };
    const client = {
      start() {},
      async stop() {},
      async enqueueCurrentState() { checkpoints += 1; },
      async bootstrapInto() { bootstraps += 1; return success; },
      async syncOnce() {
        attempts += 1;
        if (attempts === 1) throw new Error("network interrupted");
        return success;
      },
    };
    const doc = new Y.Doc();
    await expect(reconcileAtStartup(client, doc)).rejects.toThrow("network interrupted");
    await expect(reconcileAtStartup(client, doc)).resolves.toMatchObject({ status: "synced" });
    expect(bootstraps).toBe(1);
    expect(checkpoints).toBe(1);
    expect(attempts).toBe(2);
  });

  it("restores every short page and preserves offline edits with a stale saved cursor", async () => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(7));
    const relay = new PagedMemoryRelay();
    const remoteDoc = new Y.Doc();
    const remoteClient = new SyncClient({ provider, material, store: new MemoryStore(), transport: relay });
    remoteClient.start(remoteDoc);
    for (let index = 0; index < 5; index += 1) remoteDoc.getMap("tasks").set(`remote-${String(index)}`, `Remote ${String(index)}`);
    await remoteClient.stop();
    await remoteClient.syncOnce(remoteDoc);
    relay.listedAfter.length = 0;

    const doc = new Y.Doc();
    doc.getMap("tasks").set("offline", "Offline edit");
    const store = new MemoryStore();
    store.cursor = 5;
    const client = new SyncClient({ provider, material, store, transport: relay });
    await reconcileAtStartup(client, doc);
    await remoteClient.syncOnce(remoteDoc);

    expect(doc.getMap("tasks").size).toBe(6);
    expect(doc.getMap("tasks").toJSON()).toEqual(remoteDoc.getMap("tasks").toJSON());
    expect(relay.listedAfter).toContain(2);
    expect(relay.listedAfter).toContain(4);
    expect(store.cursor).toBe(6);
    expect(store.outbox).toHaveLength(0);
  });

  it("continues incremental downloads when a byte-limited page has fewer than 500 updates", async () => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(8));
    const relay = new PagedMemoryRelay();
    const remote = new Y.Doc();
    const writer = new SyncClient({ provider, material, store: new MemoryStore(), transport: relay });
    writer.start(remote);
    for (let index = 0; index < 5; index += 1) remote.getMap("tasks").set(`task-${String(index)}`, index);
    await writer.stop();
    await writer.syncOnce(remote);
    const restored = new Y.Doc();
    const store = new MemoryStore();
    const reader = new SyncClient({ provider, material, store, transport: relay });

    expect(await reader.syncOnce(restored)).toMatchObject({ downloaded: 5, cursor: 5, status: "synced" });
    expect(restored.getMap("tasks").toJSON()).toEqual(remote.getMap("tasks").toJSON());
  });

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

  it("does not report synced while an edit captured during download is still being enqueued", async () => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(4));
    const relay = new BlockingListRelay();
    const store = new BlockingEnqueueStore();
    const doc = new Y.Doc();
    doc.getMap("tasks");
    const client = new SyncClient({ provider, material, store, transport: relay });
    client.start(doc);

    let completed = false;
    const syncing = client.syncOnce(doc).then((result) => {
      completed = true;
      return result;
    });
    await relay.listStarted;
    doc.getMap("tasks").set("during-download", "Локальное изменение");
    await store.enqueueStarted;
    relay.allowList();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(completed).toBe(false);

    store.allowEnqueue();
    await expect(syncing).resolves.toMatchObject({ status: "pending" });
    expect(store.outbox).toHaveLength(1);
  });

  it("repairs an advanced cursor and a lost local outbox at startup", async () => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(5));
    const relay = new MemoryRelay();

    const remoteDoc = new Y.Doc();
    const remoteClient = new SyncClient({ provider, material, store: new MemoryStore(), transport: relay });
    remoteClient.start(remoteDoc);
    remoteDoc.getMap("tasks").set("remote-only", "С сервера");
    await remoteClient.stop();
    await remoteClient.syncOnce(remoteDoc);

    const localDoc = new Y.Doc();
    localDoc.getMap("tasks").set("local-only", "С устройства");
    const localStore = new MemoryStore();
    // Simulate a crash after the relay cursor was saved but before the remote
    // update reached the durable plan, plus a local write whose outbox was lost.
    localStore.cursor = 1;
    const localClient = new SyncClient({ provider, material, store: localStore, transport: relay });

    await reconcileAtStartup(localClient, localDoc);
    await remoteClient.syncOnce(remoteDoc);

    expect(localDoc.getMap("tasks").toJSON()).toEqual({
      "local-only": "С устройства",
      "remote-only": "С сервера",
    });
    expect(remoteDoc.getMap("tasks").toJSON()).toEqual(localDoc.getMap("tasks").toJSON());
    expect(localStore.cursor).toBe(2);
    expect(localStore.outbox).toHaveLength(0);

    await reconcileAtStartup(localClient, localDoc);
    expect(relay.updates).toHaveLength(2);
  });

  it("does not advance a cursor before downloaded state is durable", async () => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(6));
    const relay = new MemoryRelay();
    const remoteDoc = new Y.Doc();
    const remoteClient = new SyncClient({ provider, material, store: new MemoryStore(), transport: relay });
    remoteClient.start(remoteDoc);
    remoteDoc.getMap("tasks").set("remote", "Удаленное изменение");
    await remoteClient.stop();
    await remoteClient.syncOnce(remoteDoc);

    let markCommitStarted!: () => void;
    const commitStarted = new Promise<void>((resolve) => { markCommitStarted = resolve; });
    let releaseCommit!: () => void;
    const commitReleased = new Promise<void>((resolve) => { releaseCommit = resolve; });
    const store = new MemoryStore();
    const localDoc = new Y.Doc();
    const localClient = new SyncClient({
      provider,
      material,
      store,
      transport: relay,
      beforeCursorCommit: async () => {
        markCommitStarted();
        await commitReleased;
      },
    });

    const syncing = localClient.syncOnce(localDoc);
    await commitStarted;
    expect(localDoc.getMap("tasks").get("remote")).toBe("Удаленное изменение");
    expect(store.cursor).toBe(0);

    releaseCommit();
    await syncing;
    expect(store.cursor).toBe(1);
  });
});
