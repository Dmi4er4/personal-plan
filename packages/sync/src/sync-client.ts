import * as Y from "yjs";

import { base64UrlEncode } from "./bytes.js";
import type { CryptoProvider, VaultMaterial } from "./crypto-provider.js";
import { decryptEnvelope, encryptPayload } from "./envelope.js";
import type { AppendUpdatesResponse, BootstrapResponse, ListUpdatesResponse, PutSnapshotRequest } from "./protocol.js";
import type { SyncStateStore } from "./state-store.js";

export interface RelayTransport {
  createVault(vaultId: string, authVerifier: string): Promise<void>;
  append(vaultId: string, authToken: string, updates: import("./envelope.js").EncryptedEnvelope[]): Promise<AppendUpdatesResponse>;
  list(vaultId: string, authToken: string, after: number): Promise<ListUpdatesResponse>;
  putSnapshot(vaultId: string, authToken: string, request: PutSnapshotRequest): Promise<void>;
  bootstrap(vaultId: string, authToken: string): Promise<BootstrapResponse>;
}

export interface SyncResult { uploaded: number; downloaded: number; cursor: number; status: "synced" | "pending" }
export interface SyncClientApi { start(doc: Y.Doc): void; stop(): Promise<void>; enqueueCurrentState(doc: Y.Doc): Promise<void>; bootstrapInto(doc: Y.Doc): Promise<SyncResult>; syncOnce(doc: Y.Doc): Promise<SyncResult> }

export interface SyncClientOptions {
  provider: CryptoProvider;
  material: VaultMaterial;
  store: SyncStateStore;
  transport: RelayTransport;
  now?: () => string;
  onEnqueued?: () => void;
}

export class SyncIntegrityError extends Error {
  constructor() { super("A downloaded encrypted update failed authentication"); this.name = "SyncIntegrityError"; }
}

const REMOTE_ORIGIN = Symbol("personal-plan-remote-update");

function uuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new Error("UUID entropy must contain exactly 16 bytes");
  const value = bytes.slice();
  value[6] = ((value[6] ?? 0) & 0x0f) | 0x40;
  value[8] = ((value[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class SyncClient implements SyncClientApi {
  readonly #provider: CryptoProvider;
  readonly #material: VaultMaterial;
  readonly #store: SyncStateStore;
  readonly #transport: RelayTransport;
  readonly #now: () => string;
  readonly #onEnqueued: (() => void) | undefined;
  #captureChain = Promise.resolve();
  #doc: Y.Doc | null = null;

  readonly #capture = (update: Uint8Array, origin: unknown): void => {
    if (origin === REMOTE_ORIGIN) return;
    this.#captureChain = this.#captureChain.then(async () => {
      const updateId = uuid(await this.#provider.randomBytes(16));
      const createdAt = this.#now();
      const envelope = await encryptPayload(this.#provider, this.#material.encryptionKey, this.#material.vaultId, { kind: "update", updateId, payload: update, createdAt });
      await this.#store.enqueue({ envelope, queuedAt: createdAt });
      this.#onEnqueued?.();
    });
  };

  constructor(options: SyncClientOptions) {
    this.#provider = options.provider;
    this.#material = options.material;
    this.#store = options.store;
    this.#transport = options.transport;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#onEnqueued = options.onEnqueued;
  }

  start(doc: Y.Doc): void {
    if (this.#doc === doc) return;
    if (this.#doc !== null) this.#doc.off("update", this.#capture);
    this.#doc = doc;
    doc.on("update", this.#capture);
  }

  async stop(): Promise<void> {
    this.#doc?.off("update", this.#capture);
    this.#doc = null;
    await this.#captureChain;
  }

  async enqueueCurrentState(doc: Y.Doc): Promise<void> {
    await this.#captureChain;
    const updateId = uuid(await this.#provider.randomBytes(16));
    const createdAt = this.#now();
    const envelope = await encryptPayload(this.#provider, this.#material.encryptionKey, this.#material.vaultId, {
      kind: "update",
      updateId,
      payload: Y.encodeStateAsUpdate(doc),
      createdAt,
    });
    await this.#store.enqueue({ envelope, queuedAt: createdAt });
    this.#onEnqueued?.();
  }

  async bootstrapInto(doc: Y.Doc): Promise<SyncResult> {
    await this.#captureChain;
    const response = await this.#transport.bootstrap(this.#material.vaultId, base64UrlEncode(this.#material.authToken));
    let downloaded = 0;
    const staged = new Y.Doc();
    Y.applyUpdate(staged, Y.encodeStateAsUpdate(doc));
    try {
      if (response.snapshot !== null) {
        Y.applyUpdate(staged, await decryptEnvelope(this.#provider, this.#material.encryptionKey, this.#material.vaultId, response.snapshot.envelope));
        downloaded += 1;
      }
      for (const stored of [...response.updates].sort((left, right) => left.cursor - right.cursor)) {
        Y.applyUpdate(staged, await decryptEnvelope(this.#provider, this.#material.encryptionKey, this.#material.vaultId, stored.envelope));
        downloaded += 1;
      }
    } catch { throw new SyncIntegrityError(); }
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(staged), REMOTE_ORIGIN);
    await this.#store.setCursor(this.#material.vaultId, response.nextCursor);
    this.start(doc);
    return { uploaded: 0, downloaded, cursor: response.nextCursor, status: "synced" };
  }

  async syncOnce(doc: Y.Doc): Promise<SyncResult> {
    await this.#captureChain;
    const authToken = base64UrlEncode(this.#material.authToken);
    const queued = await this.#store.listOutbox(this.#material.vaultId, 100);
    let uploaded = 0;
    if (queued.length > 0) {
      const response = await this.#transport.append(this.#material.vaultId, authToken, queued.map((entry) => entry.envelope));
      const accepted = new Set(response.accepted.map((item) => item.updateId));
      uploaded = await this.#store.acknowledge(queued.filter((entry) => accepted.has(entry.envelope.updateId)).map((entry) => entry.envelope.updateId));
    }

    let cursor = await this.#store.getCursor(this.#material.vaultId);
    let downloaded = 0;
    for (;;) {
      const page = await this.#transport.list(this.#material.vaultId, authToken, cursor);
      const decrypted: Array<{ stored: (typeof page.updates)[number]; update: Uint8Array }> = [];
      for (const stored of page.updates) {
        try {
          decrypted.push({ stored, update: await decryptEnvelope(this.#provider, this.#material.encryptionKey, this.#material.vaultId, stored.envelope) });
        } catch { throw new SyncIntegrityError(); }
      }
      for (const { stored, update } of decrypted) {
        Y.applyUpdate(doc, update, REMOTE_ORIGIN);
        cursor = stored.cursor;
        downloaded += 1;
      }
      await this.#store.setCursor(this.#material.vaultId, cursor);
      if (page.updates.length < 500) break;
    }

    if (await this.#store.getAcknowledgedSinceSnapshot(this.#material.vaultId) >= 200) {
      const updateId = uuid(await this.#provider.randomBytes(16));
      const createdAt = this.#now();
      const envelope = await encryptPayload(this.#provider, this.#material.encryptionKey, this.#material.vaultId, { kind: "snapshot", updateId, payload: Y.encodeStateAsUpdate(doc), createdAt });
      await this.#transport.putSnapshot(this.#material.vaultId, authToken, { coversThrough: cursor, envelope: { ...envelope, kind: "snapshot" } });
      await this.#store.resetAcknowledgedSinceSnapshot(this.#material.vaultId);
    }

    // A local edit can arrive while the network request above is in flight.
    // Wait for its encryption/persistence before claiming that the outbox is
    // empty; otherwise the UI can briefly (or, without polling, indefinitely)
    // report "synced" while a captured update is still being enqueued.
    await this.#captureChain;
    const pending = (await this.#store.listOutbox(this.#material.vaultId, 1)).length > 0;
    return { uploaded, downloaded, cursor, status: pending ? "pending" : "synced" };
  }
}
