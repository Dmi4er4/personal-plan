import * as Y from "yjs";

import { base64UrlEncode, utf8 } from "./bytes.js";
import type { CryptoProvider, VaultMaterial } from "./crypto-provider.js";
import { decryptEnvelope, encryptPayload } from "./envelope.js";
import type { AppendUpdatesResponse, BootstrapResponse, ListUpdatesResponse, PutSnapshotRequest } from "./protocol.js";
import type { SyncStateStore } from "./state-store.js";

export type ResumeDiagnostic = "missing" | "read_failed" | "cursor_mismatch" | "fingerprint_mismatch" | "state_vector_mismatch" | "deletions_mismatch" | "encoding_mismatch" | "verified" | "saved" | "save_failed";

export interface RelayTransport {
  setResumeDiagnostic?(result: ResumeDiagnostic): void;
  createVault(vaultId: string, authVerifier: string): Promise<void>;
  append(vaultId: string, authToken: string, updates: import("./envelope.js").EncryptedEnvelope[]): Promise<AppendUpdatesResponse>;
  list(vaultId: string, authToken: string, after: number, allowBootstrap?: boolean): Promise<ListUpdatesResponse>;
  putSnapshot(vaultId: string, authToken: string, request: PutSnapshotRequest): Promise<void>;
  bootstrap(vaultId: string, authToken: string): Promise<BootstrapResponse>;
}

export interface SyncResult { uploaded: number; downloaded: number; cursor: number; status: "synced" | "pending" }
export interface SyncClientApi { start(doc: Y.Doc): void; stop(): Promise<void>; enqueueCurrentState(doc: Y.Doc): Promise<void>; bootstrapInto(doc: Y.Doc): Promise<SyncResult>; syncOnce(doc: Y.Doc): Promise<SyncResult>; canResumeFromCheckpoint?(doc: Y.Doc): Promise<boolean>; enqueueMissingState?(doc: Y.Doc): Promise<void> }

export interface SyncClientOptions {
  provider: CryptoProvider;
  material: VaultMaterial;
  store: SyncStateStore;
  transport: RelayTransport;
  now?: () => string;
  onEnqueued?: () => void;
  /** Persist remote Yjs changes before their relay cursor becomes durable. */
  beforeCursorCommit?: () => Promise<void>;
  /** Stable schema content; clocks, deletions and pending updates are also hashed. */
  checkpointContent?: (doc: Y.Doc) => Uint8Array | null;
  /** Bytes actually acknowledged by the local persistence owner. */
  checkpointBytes?: ((doc: Y.Doc) => Promise<Uint8Array | null>) | undefined;
}

export class SyncIntegrityError extends Error {
  constructor() { super("A downloaded encrypted update failed authentication"); this.name = "SyncIntegrityError"; }
}

const REMOTE_ORIGIN = Symbol("personal-plan-remote-update");
const SNAPSHOT_REPLAY_CHARS = 1_500_000;
const MAX_UPLOAD_BYTES = 1_500_000;

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
  readonly #beforeCursorCommit: (() => Promise<void>) | undefined;
  readonly #checkpointContent: ((doc: Y.Doc) => Uint8Array | null) | undefined;
  readonly #checkpointBytes: ((doc: Y.Doc) => Promise<Uint8Array | null>) | undefined;
  #captureChain = Promise.resolve();
  #doc: Y.Doc | null = null;
  #replayedCiphertextChars = 0;
  #revision = 0;
  #savedCheckpoint: { doc: Y.Doc; cursor: number; revision: number; bytes: Uint8Array | null } | null = null;
  #remoteBaseline: { vector: Uint8Array; fingerprint: string } | null = null;
  #serverPosition: { cursor: number; updateId: string | null } | null = null;
  #verifiedDoc: Y.Doc | null = null;

  readonly #capture = (update: Uint8Array, origin: unknown): void => {
    this.#revision += 1;
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
    this.#beforeCursorCommit = options.beforeCursorCommit;
    this.#checkpointContent = options.checkpointContent;
    this.#checkpointBytes = options.checkpointBytes;
  }

  start(doc: Y.Doc): void {
    if (this.#doc === doc) return;
    if (this.#doc !== null) this.#doc.off("update", this.#capture);
    this.#doc = doc;
    this.#verifiedDoc = null;
    this.#revision += 1;
    doc.on("update", this.#capture);
  }

  async stop(): Promise<void> {
    this.#doc?.off("update", this.#capture);
    this.#doc = null;
    this.#verifiedDoc = null;
    this.#savedCheckpoint = null;
    await this.#captureChain;
  }

  async enqueueCurrentState(doc: Y.Doc): Promise<void> {
    await this.#captureChain;
    await this.#enqueuePayload(Y.encodeStateAsUpdate(doc));
  }

  async #fingerprint(update: Uint8Array): Promise<string> {
    // Compare the durable representation, after the same decoding/GC pass
    // used when reopening local storage. Live structs can be split or retain
    // deleted content that is normalized on replay without changing the plan.
    const durable = new Y.Doc();
    const empty = new Y.Doc();
    try {
      Y.applyUpdate(durable, update);
      const content = this.#checkpointContent?.(durable);
      const emptyUpdate = Y.encodeStateAsUpdateV2(empty);
      const pending = (bytes: Uint8Array | null | undefined): Uint8Array => bytes === null || bytes === undefined ? new Uint8Array() : Y.convertUpdateFormatV2ToV1(Y.mergeUpdatesV2([bytes, emptyUpdate]));
      const components = [content ?? Y.encodeStateAsUpdate(durable), Y.encodeStateVector(durable), Y.encodeSnapshot(Y.snapshot(durable)), pending(durable.store.pendingStructs?.update), pending(durable.store.pendingDs)];
      const hashes = await Promise.all(components.map(async (bytes) => base64UrlEncode(await this.#provider.sha256(bytes))));
      return `${content === undefined || content === null ? "binary" : "logical"}.${hashes.join(".")}`;
    } finally { durable.destroy(); empty.destroy(); }
  }

  async #drainCapture(): Promise<void> {
    let captured: Promise<void>;
    do {
      captured = this.#captureChain;
      await captured;
    } while (captured !== this.#captureChain);
  }

  async canResumeFromCheckpoint(doc: Y.Doc): Promise<boolean> {
    if (this.#verifiedDoc === doc && this.#doc === doc) return true;
    if (this.#beforeCursorCommit === undefined || this.#store.getResumeCheckpoint === undefined) return false;
    const read = { failed: false };
    const checkpoint = await this.#store.getResumeCheckpoint(this.#material.vaultId).catch(() => { read.failed = true; return null; });
    const version: unknown = checkpoint?.version;
    if (checkpoint === null || version !== 1) {
      this.#transport.setResumeDiagnostic?.(read.failed ? "read_failed" : "missing");
      return false;
    }
    if (checkpoint.cursor !== await this.#store.getCursor(this.#material.vaultId)) {
      this.#transport.setResumeDiagnostic?.("cursor_mismatch");
      return false;
    }
    await this.#captureChain;
    // Hash the entire update, including deletions: state vectors alone cannot
    // distinguish a lost deletion from a fully persisted local document.
    const bytes = await this.#checkpointBytes?.(doc);
    if (this.#checkpointBytes !== undefined && (bytes === null || bytes === undefined)) return false;
    const fingerprint = bytes === undefined || bytes === null ? await this.#fingerprint(Y.encodeStateAsUpdate(doc)) : `persisted.${base64UrlEncode(await this.#provider.sha256(bytes))}`;
    if (checkpoint.fingerprint !== fingerprint) {
      const saved = checkpoint.fingerprint.split(".");
      const loaded = fingerprint.split(".");
      const code = saved.length !== 6 || saved[0] !== loaded[0] ? "fingerprint_mismatch" : saved[2] !== loaded[2] ? "state_vector_mismatch" : saved[3] !== loaded[3] ? "deletions_mismatch" : "encoding_mismatch";
      this.#transport.setResumeDiagnostic?.(code);
      return false;
    }
    this.#transport.setResumeDiagnostic?.("verified");
    console.info("personal-plan resume checkpoint verified");
    this.#serverPosition = { cursor: checkpoint.cursor, updateId: checkpoint.relayUpdateId };
    this.#verifiedDoc = doc;
    return true;
  }

  async enqueueMissingState(doc: Y.Doc): Promise<void> {
    await this.#captureChain;
    const baseline = this.#remoteBaseline;
    if (baseline === null) return this.enqueueCurrentState(doc);
    if (await this.#fingerprint(Y.encodeStateAsUpdate(doc)) === baseline.fingerprint) {
      this.#verifiedDoc = doc;
      return;
    }
    await this.#enqueuePayload(Y.encodeStateAsUpdate(doc, baseline.vector));
    this.#verifiedDoc = doc;
  }

  async #enqueuePayload(payload: Uint8Array): Promise<void> {
    const updateId = uuid(await this.#provider.randomBytes(16));
    const createdAt = this.#now();
    const envelope = await encryptPayload(this.#provider, this.#material.encryptionKey, this.#material.vaultId, {
      kind: "update",
      updateId,
      payload,
      createdAt,
    });
    await this.#store.enqueue({ envelope, queuedAt: createdAt });
    this.#onEnqueued?.();
  }

  async bootstrapInto(doc: Y.Doc): Promise<SyncResult> {
    this.#verifiedDoc = null;
    this.#remoteBaseline = null;
    await this.#captureChain;
    const authToken = base64UrlEncode(this.#material.authToken);
    const response = await this.#transport.bootstrap(this.#material.vaultId, authToken);
    let downloaded = 0;
    let replayedCiphertextChars = 0;
    let cursor = response.nextCursor;
    const staged = new Y.Doc();
    try {
      if (response.snapshot !== null) {
        try {
          Y.applyUpdate(staged, await decryptEnvelope(this.#provider, this.#material.encryptionKey, this.#material.vaultId, response.snapshot.envelope));
        } catch { throw new SyncIntegrityError(); }
        downloaded += 1;
      }
      let page: ListUpdatesResponse = response;
      for (;;) {
        for (const stored of [...page.updates].sort((left, right) => left.cursor - right.cursor)) {
          try {
            Y.applyUpdate(staged, await decryptEnvelope(this.#provider, this.#material.encryptionKey, this.#material.vaultId, stored.envelope));
          } catch { throw new SyncIntegrityError(); }
          downloaded += 1;
          replayedCiphertextChars += stored.envelope.ciphertext.length;
        }
        if (page.hasMore !== true) break;
        page = await this.#transport.list(this.#material.vaultId, authToken, cursor, false);
        if (page.nextCursor <= cursor) throw new Error("relay_cursor_did_not_advance");
        cursor = page.nextCursor;
      }
      const remoteUpdate = Y.encodeStateAsUpdate(staged);
      this.#remoteBaseline = { vector: Y.encodeStateVector(staged), fingerprint: await this.#fingerprint(remoteUpdate) };
      Y.applyUpdate(doc, remoteUpdate, REMOTE_ORIGIN);
    } finally { staged.destroy(); }
    await this.#beforeCursorCommit?.();
    await this.#store.setCursor(this.#material.vaultId, cursor);
    this.#serverPosition = null;
    this.#replayedCiphertextChars += replayedCiphertextChars;
    this.start(doc);
    return { uploaded: 0, downloaded, cursor, status: "synced" };
  }

  async syncOnce(doc: Y.Doc): Promise<SyncResult> {
    await this.#captureChain;
    const authToken = base64UrlEncode(this.#material.authToken);
    const candidates = await this.#store.listOutbox(this.#material.vaultId, 100);
    const queued: typeof candidates = [];
    let uploadBytes = 32;
    for (const entry of candidates) {
      const bytes = utf8(JSON.stringify(entry.envelope)).length + 1;
      if (queued.length > 0 && uploadBytes + bytes > MAX_UPLOAD_BYTES) break;
      queued.push(entry);
      uploadBytes += bytes;
    }
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
      const position = this.#serverPosition;
      if (page.bootstrapRequired === true || (position?.cursor === cursor && position.updateId !== page.anchorUpdateId)) {
        // Detect a restored/replaced relay history, including replacement at
        // the same cursor. Recover from both sides rather than trusting a
        // cached position whose update ID no longer exists on the relay.
        const bootstrap = await this.bootstrapInto(doc);
        await this.enqueueMissingState(doc);
        const recovered = await this.syncOnce(doc);
        return { ...recovered, uploaded: uploaded + recovered.uploaded, downloaded: downloaded + bootstrap.downloaded + recovered.downloaded };
      }
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
        this.#replayedCiphertextChars += stored.envelope.ciphertext.length;
      }
      if (decrypted.length > 0) await this.#beforeCursorCommit?.();
      await this.#store.setCursor(this.#material.vaultId, cursor);
      this.#serverPosition = page.anchorUpdateId === undefined ? null : { cursor, updateId: page.updates.at(-1)?.envelope.updateId ?? page.anchorUpdateId };
      if (!(page.hasMore ?? page.updates.length === 500)) break;
      if (page.updates.length === 0) throw new Error("relay_cursor_did_not_advance");
    }

    if (this.#replayedCiphertextChars >= SNAPSHOT_REPLAY_CHARS || await this.#store.getAcknowledgedSinceSnapshot(this.#material.vaultId) >= 200) {
      const updateId = uuid(await this.#provider.randomBytes(16));
      const createdAt = this.#now();
      const envelope = await encryptPayload(this.#provider, this.#material.encryptionKey, this.#material.vaultId, { kind: "snapshot", updateId, payload: Y.encodeStateAsUpdate(doc), createdAt });
      await this.#transport.putSnapshot(this.#material.vaultId, authToken, { coversThrough: cursor, envelope: { ...envelope, kind: "snapshot" } });
      await this.#store.resetAcknowledgedSinceSnapshot(this.#material.vaultId);
      this.#replayedCiphertextChars = 0;
    }

    // A local edit can arrive while the network request above is in flight.
    // Wait for its encryption/persistence before claiming that the outbox is
    // empty; otherwise the UI can briefly (or, without polling, indefinitely)
    // report "synced" while a captured update is still being enqueued.
    await this.#drainCapture();
    const checkpointRevision = this.#revision;
    let pending = (await this.#store.listOutbox(this.#material.vaultId, 1)).length > 0;
    if (!pending && checkpointRevision === this.#revision) await this.#saveResumeCheckpoint(doc, cursor);
    // A local edit may arrive during the optional checkpoint write too.
    await this.#drainCapture();
    const finalRevision = this.#revision;
    pending = (await this.#store.listOutbox(this.#material.vaultId, 1)).length > 0 || finalRevision !== this.#revision;
    return { uploaded, downloaded, cursor, status: pending ? "pending" : "synced" };
  }

  async #saveResumeCheckpoint(doc: Y.Doc, cursor: number): Promise<void> {
    if (this.#verifiedDoc !== doc || this.#beforeCursorCommit === undefined || this.#store.setResumeCheckpoint === undefined || this.#serverPosition?.cursor !== cursor) return;
    const revision = this.#revision;
    const started = performance.now();
    await this.#beforeCursorCommit();
    const flushedAt = performance.now();
    const bytes = await this.#checkpointBytes?.(doc) ?? null;
    const bytesAt = performance.now();
    if (this.#checkpointBytes !== undefined && bytes === null) return;
    if (this.#doc === doc && this.#savedCheckpoint?.doc === doc && this.#savedCheckpoint.cursor === cursor && this.#savedCheckpoint.revision === this.#revision && this.#savedCheckpoint.bytes === bytes) return;
    const fingerprint = bytes === null ? await this.#fingerprint(Y.encodeStateAsUpdate(doc)) : `persisted.${base64UrlEncode(await this.#provider.sha256(bytes))}`;
    const hashedAt = performance.now();
    if (this.#revision !== revision) return;
    try {
      await this.#store.setResumeCheckpoint(this.#material.vaultId, { version: 1, cursor, fingerprint, relayUpdateId: this.#serverPosition.updateId });
      const finished = performance.now();
      if (finished - started >= 50) console.info(`personal-plan perf checkpoint-save ${JSON.stringify({ flushMs: Math.round(flushedAt - started), bytesMs: Math.round(bytesAt - flushedAt), hashMs: Math.round(hashedAt - bytesAt), writeMs: Math.round(finished - hashedAt), totalMs: Math.round(finished - started) })}`);
      console.info("personal-plan resume checkpoint saved");
      this.#transport.setResumeDiagnostic?.("saved");
      if (this.#revision === revision) this.#savedCheckpoint = { doc, cursor, revision, bytes };
    } catch {
      // This is an optimization only. A missing checkpoint causes the next
      // startup to perform the full authenticated reconciliation again.
      this.#savedCheckpoint = null;
      this.#transport.setResumeDiagnostic?.("save_failed");
      console.warn("personal-plan resume checkpoint not saved");
    }
  }
}

/**
 * Repairs both directions of a split local/server history at application start.
 *
 * A verified durable fingerprint allows incremental startup. Otherwise,
 * bootstrap repairs a cursor that outlived downloaded plan data, and a delta
 * against the remote state recovers local writes whose outbox entry was lost.
 */
const startupCheckpoints = new WeakMap<SyncClientApi, Y.Doc>();
const startupReconciled = new WeakMap<SyncClientApi, Y.Doc>();

export async function reconcileAtStartup(client: SyncClientApi, doc: Y.Doc): Promise<SyncResult> {
  client.start(doc);
  if (startupReconciled.get(client) === doc && (client.canResumeFromCheckpoint === undefined || await client.canResumeFromCheckpoint(doc))) return client.syncOnce(doc);
  if (await client.canResumeFromCheckpoint?.(doc)) {
    startupReconciled.set(client, doc);
    return client.syncOnce(doc);
  }
  if (client.enqueueMissingState === undefined && startupCheckpoints.get(client) !== doc) {
    await client.enqueueCurrentState(doc);
    startupCheckpoints.set(client, doc);
  }
  const bootstrap = await client.bootstrapInto(doc);
  if (client.enqueueMissingState !== undefined) await client.enqueueMissingState(doc);
  // Once the remote state is durable, a failed upload or snapshot should retry
  // the normal sync pass instead of downloading the whole history again.
  startupReconciled.set(client, doc);
  const synced = await client.syncOnce(doc);
  return {
    uploaded: synced.uploaded,
    downloaded: bootstrap.downloaded + synced.downloaded,
    cursor: synced.cursor,
    status: synced.status,
  };
}
