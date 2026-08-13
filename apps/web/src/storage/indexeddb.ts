import { createPlanDoc } from "@personal-plan/core";
import * as Y from "yjs";

import type { PersistenceState, PlanStore } from "./plan-store.js";

const PLAN_DATABASE_VERSION = 2;
const SNAPSHOT_STORE_NAME = "plan-snapshots";
const SNAPSHOT_KEY = "acknowledged";
const LEGACY_UPDATES_STORE_NAME = "updates";
const DRAFT_DATABASE_SUFFIX = "-drafts";
const DRAFT_STORE_NAME = "drafts";
const DRAFT_KEY = "current";

function draftDatabaseName(planName: string): string {
  return `${planName}${DRAFT_DATABASE_SUFFIX}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener(
      "success",
      () => {
        resolve(request.result);
      },
      { once: true },
    );
    request.addEventListener(
      "error",
      () => {
        reject(request.error ?? new Error("IndexedDB request failed"));
      },
      { once: true },
    );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener(
      "complete",
      () => {
        resolve();
      },
      { once: true },
    );
    transaction.addEventListener(
      "abort",
      () => {
        reject(transaction.error ?? new DOMException("Transaction aborted", "AbortError"));
      },
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => {
        reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      },
      { once: true },
    );
  });
}

function openPlanDatabase(planName: string): Promise<IDBDatabase> {
  const request = indexedDB.open(planName, PLAN_DATABASE_VERSION);
  request.addEventListener("upgradeneeded", () => {
    if (!request.result.objectStoreNames.contains(SNAPSHOT_STORE_NAME)) {
      request.result.createObjectStore(SNAPSHOT_STORE_NAME);
    }
  });
  return requestResult(request);
}

function openDraftDatabase(planName: string): Promise<IDBDatabase> {
  const request = indexedDB.open(draftDatabaseName(planName), 1);
  request.addEventListener("upgradeneeded", () => {
    if (!request.result.objectStoreNames.contains(DRAFT_STORE_NAME)) {
      request.result.createObjectStore(DRAFT_STORE_NAME);
    }
  });
  return requestResult(request);
}

function deleteNativeDatabase(name: string): Promise<void> {
  const request = indexedDB.deleteDatabase(name);
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => {
      resolve();
    });
    request.addEventListener("blocked", () => {
      reject(new Error(`IndexedDB database is still open: ${name}`));
    });
    request.addEventListener("error", () => {
      reject(request.error ?? new Error(`Could not delete IndexedDB database: ${name}`));
    });
  });
}

function asYjsUpdate(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (Object.prototype.toString.call(value) === "[object ArrayBuffer]") {
    return new Uint8Array(value as ArrayBuffer);
  }
  return null;
}

function asError(reason: unknown, fallback: string): Error {
  if (reason instanceof Error) {
    return reason;
  }
  if (
    typeof reason === "object" &&
    reason !== null &&
    "message" in reason &&
    typeof reason.message === "string"
  ) {
    const error = new Error(reason.message);
    if ("name" in reason && typeof reason.name === "string") {
      error.name = reason.name;
    }
    return error;
  }
  return new Error(fallback);
}

/** Deletes the plan and draft databases after their owners have been closed. */
export async function deleteDatabase(planName: string): Promise<void> {
  await Promise.all([
    deleteNativeDatabase(planName),
    deleteNativeDatabase(draftDatabaseName(planName)),
  ]);
}

export class IndexedDbPlanStore implements PlanStore {
  readonly #name: string;
  readonly #listeners = new Set<(state: PersistenceState) => void>();
  #state: PersistenceState = { error: null, status: "loading" };
  #doc: Y.Doc | null = null;
  #loadPromise: Promise<Y.Doc> | null = null;
  #databasePromise: Promise<IDBDatabase> | null = null;
  #draftDatabasePromise: Promise<IDBDatabase> | null = null;
  #pendingSnapshot: Uint8Array | null = null;
  #writeLoopPromise: Promise<void> | null = null;
  #activeTransaction: IDBTransaction | null = null;
  #writeBlocked = false;
  #destroyPromise: Promise<void> | null = null;
  #closing = false;
  #destroyed = false;

  readonly #recordUpdate = (): void => {
    if (this.#closing || this.#destroyed || this.#doc === null) {
      return;
    }
    this.#pendingSnapshot = Y.encodeStateAsUpdate(this.#doc);
    if (this.#writeBlocked) {
      return;
    }
    this.#setState({ error: null, status: "saving" });
    this.#startWriteLoop();
  };

  constructor(name: string) {
    this.#name = name;
  }

  load(): Promise<Y.Doc> {
    if (this.#destroyed) {
      return Promise.reject(new Error("Plan store has been destroyed"));
    }
    this.#loadPromise ??= this.#performLoad();
    return this.#loadPromise;
  }

  getPersistenceState(): PersistenceState {
    return this.#state;
  }

  subscribePersistence(listener: (state: PersistenceState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async retryPersistence(): Promise<void> {
    this.#ensureActive();
    const doc = await (this.#loadPromise ?? this.load());
    this.#ensureActive();
    this.#pendingSnapshot = Y.encodeStateAsUpdate(doc);
    this.#writeBlocked = false;
    this.#setState({ error: null, status: "saving" });
    this.#startWriteLoop();
    await this.#writeLoopPromise;
    if (this.#state.status === "error") {
      throw this.#state.error;
    }
  }

  async loadDraft(): Promise<string | null> {
    const database = await this.#draftDatabase();
    const transaction = database.transaction(DRAFT_STORE_NAME, "readonly");
    const completed = transactionComplete(transaction);
    const value = await requestResult<unknown>(
      transaction.objectStore(DRAFT_STORE_NAME).get(DRAFT_KEY),
    );
    await completed;

    if (value === undefined) {
      return null;
    }
    if (typeof value !== "string") {
      throw new TypeError("Stored draft must be a string");
    }
    return value;
  }

  async saveDraft(value: string): Promise<void> {
    const database = await this.#draftDatabase();
    const transaction = database.transaction(DRAFT_STORE_NAME, "readwrite");
    const completed = transactionComplete(transaction);
    await requestResult(transaction.objectStore(DRAFT_STORE_NAME).put(value, DRAFT_KEY));
    await completed;
  }

  async clearDraft(): Promise<void> {
    const database = await this.#draftDatabase();
    const transaction = database.transaction(DRAFT_STORE_NAME, "readwrite");
    const completed = transactionComplete(transaction);
    await requestResult(transaction.objectStore(DRAFT_STORE_NAME).delete(DRAFT_KEY));
    await completed;
  }

  destroy(): Promise<void> {
    if (this.#destroyPromise !== null) {
      return this.#destroyPromise;
    }
    this.#closing = true;
    this.#doc?.off("update", this.#recordUpdate);

    this.#destroyPromise = (async () => {
      if (this.#doc === null) {
        this.#destroyed = true;
        try {
          this.#activeTransaction?.abort();
        } catch {
          // It may have completed between the active check and abort.
        }
      }
      await this.#writeLoopPromise?.catch(() => undefined);
      this.#destroyed = true;
      const closingHandles: Promise<void>[] = [];
      if (this.#databasePromise !== null) {
        closingHandles.push(
          this.#databasePromise.then((database) => {
            database.close();
          }),
        );
      }
      if (this.#draftDatabasePromise !== null) {
        closingHandles.push(
          this.#draftDatabasePromise.then((database) => {
            database.close();
          }),
        );
      }
      await Promise.allSettled(closingHandles);
      this.#listeners.clear();
      this.#doc?.destroy();
    })();
    return this.#destroyPromise;
  }

  async #performLoad(): Promise<Y.Doc> {
    try {
      const database = await this.#database();
      if (this.#isDestroyed()) {
        throw new Error("Plan store was destroyed before it loaded");
      }
      const doc = createPlanDoc();
      await this.#applyAcknowledgedState(database, doc);
      if (this.#isDestroyed()) {
        doc.destroy();
        throw new Error("Plan store was destroyed before it loaded");
      }
      this.#doc = doc;
      doc.on("update", this.#recordUpdate);
      this.#setState({ error: null, status: "saved" });
      return doc;
    } catch (reason: unknown) {
      const error = asError(reason, "Could not load plan");
      if (!this.#destroyed) {
        this.#setState({ error, status: "error" });
      }
      throw error;
    }
  }

  async #applyAcknowledgedState(database: IDBDatabase, doc: Y.Doc): Promise<void> {
    const snapshotTransaction = database.transaction(SNAPSHOT_STORE_NAME, "readonly");
    const snapshotCompleted = transactionComplete(snapshotTransaction);
    const storedSnapshot = await requestResult<unknown>(
      snapshotTransaction.objectStore(SNAPSHOT_STORE_NAME).get(SNAPSHOT_KEY),
    );
    await snapshotCompleted;
    const acknowledged = asYjsUpdate(storedSnapshot);
    if (acknowledged !== null) {
      Y.applyUpdate(doc, acknowledged);
      return;
    }

    if (!database.objectStoreNames.contains(LEGACY_UPDATES_STORE_NAME)) {
      return;
    }
    const legacyTransaction = database.transaction(
      LEGACY_UPDATES_STORE_NAME,
      "readonly",
    );
    const legacyCompleted = transactionComplete(legacyTransaction);
    const values = await requestResult<unknown[]>(
      legacyTransaction.objectStore(LEGACY_UPDATES_STORE_NAME).getAll(),
    );
    await legacyCompleted;
    Y.transact(doc, () => {
      for (const value of values) {
        const update = asYjsUpdate(value);
        if (update !== null) {
          Y.applyUpdate(doc, update);
        }
      }
    });
  }

  #startWriteLoop(): void {
    if (this.#writeLoopPromise !== null || this.#destroyed || this.#writeBlocked) {
      return;
    }
    const loop = this.#drainWrites();
    this.#writeLoopPromise = loop;
    void loop.finally(() => {
      if (this.#writeLoopPromise === loop) {
        this.#writeLoopPromise = null;
      }
    });
  }

  async #drainWrites(): Promise<void> {
    while (
      this.#pendingSnapshot !== null &&
      !this.#destroyed &&
      !this.#writeBlocked
    ) {
      const snapshot = this.#pendingSnapshot;
      this.#pendingSnapshot = null;
      try {
        await this.#commitSnapshot(snapshot);
      } catch (reason: unknown) {
        if (this.#isDestroyed()) {
          return;
        }
        this.#pendingSnapshot ??= snapshot;
        this.#writeBlocked = true;
        this.#setState({
          error: asError(reason, "Could not save plan"),
          status: "error",
        });
        return;
      }
      this.#setState({
        error: null,
        status: this.#hasPendingSnapshot() ? "saving" : "saved",
      });
    }
  }

  async #commitSnapshot(snapshot: Uint8Array): Promise<void> {
    this.#databasePromise ??= openPlanDatabase(this.#name);
    const database = await this.#databasePromise;
    if (this.#destroyed) {
      throw new Error("Plan store has been destroyed");
    }
    const transaction = database.transaction(SNAPSHOT_STORE_NAME, "readwrite");
    this.#activeTransaction = transaction;
    const completed = transactionComplete(transaction);
    try {
      await requestResult(
        transaction.objectStore(SNAPSHOT_STORE_NAME).put(snapshot, SNAPSHOT_KEY),
      );
      await completed;
    } catch (reason: unknown) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already be aborted.
      }
      await completed.catch(() => undefined);
      throw reason;
    } finally {
      if (this.#activeTransaction === transaction) {
        this.#activeTransaction = null;
      }
    }
  }

  #database(): Promise<IDBDatabase> {
    this.#ensureActive();
    this.#databasePromise ??= openPlanDatabase(this.#name);
    return this.#databasePromise;
  }

  async #draftDatabase(): Promise<IDBDatabase> {
    this.#ensureActive();
    this.#draftDatabasePromise ??= openDraftDatabase(this.#name);
    const database = await this.#draftDatabasePromise;
    this.#ensureActive();
    return database;
  }

  #setState(state: PersistenceState): void {
    this.#state = state;
    for (const listener of this.#listeners) {
      listener(state);
    }
  }

  #ensureActive(): void {
    if (this.#closing || this.#destroyed) {
      throw new Error("Plan store has been destroyed");
    }
  }

  #hasPendingSnapshot(): boolean {
    return this.#pendingSnapshot !== null;
  }

  #isDestroyed(): boolean {
    return this.#destroyed;
  }
}
