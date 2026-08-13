import { base64UrlDecode, base64UrlEncode, type OutboxEntry, type SyncStateStore } from "@personal-plan/sync";

const DATABASE_NAME = "personal-plan-sync-v1";
const META = "meta";
const OUTBOX = "outbox";
const SECRETS = "secrets";
const ACTIVE_SECRET = "active";

interface MetaRecord { vaultId: string; cursor: number; acknowledgedSinceSnapshot: number }
interface OutboxRecord extends OutboxEntry { updateId: string; vaultId: string }
interface SecretRecord { id: "active"; rootSecret: string; relayUrl: string; recoveryAcknowledged?: boolean }
export interface StoredSyncSecret { rootSecret: Uint8Array; relayUrl: string }

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB request failed")), { once: true });
  });
}

function get<T>(store: IDBObjectStore, key: IDBValidKey): IDBRequest<T | undefined> {
  return store.get(key) as IDBRequest<T | undefined>;
}

function getAll<T>(index: IDBIndex, query: IDBValidKey | IDBKeyRange, count?: number): IDBRequest<T[]> {
  return index.getAll(query, count) as IDBRequest<T[]>;
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("IndexedDB transaction aborted")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("IndexedDB transaction failed")), { once: true });
  });
}

function openDatabase(name: string): Promise<IDBDatabase> {
  const request = indexedDB.open(name, 1);
  request.addEventListener("upgradeneeded", () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(META)) database.createObjectStore(META, { keyPath: "vaultId" });
    if (!database.objectStoreNames.contains(OUTBOX)) {
      const store = database.createObjectStore(OUTBOX, { keyPath: "updateId" });
      store.createIndex("vaultId,queuedAt", ["vaultId", "queuedAt"]);
    }
    if (!database.objectStoreNames.contains(SECRETS)) database.createObjectStore(SECRETS, { keyPath: "id" });
  });
  return result(request);
}

export function deleteSyncDatabase(name = DATABASE_NAME): Promise<void> {
  const request = indexedDB.deleteDatabase(name);
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => { resolve(); }, { once: true });
    request.addEventListener("blocked", () => {
      reject(new Error(`IndexedDB database is still open: ${name}`));
    }, { once: true });
    request.addEventListener("error", () => {
      reject(request.error ?? new Error(`Could not delete IndexedDB database: ${name}`));
    }, { once: true });
  });
}

export class IndexedDbSyncStateStore implements SyncStateStore {
  readonly #name: string;
  #databasePromise: Promise<IDBDatabase> | null = null;

  constructor(name = DATABASE_NAME) { this.#name = name; }
  #database(): Promise<IDBDatabase> { this.#databasePromise ??= openDatabase(this.#name); return this.#databasePromise; }

  async getCursor(vaultId: string): Promise<number> {
    const database = await this.#database();
    const transaction = database.transaction(META, "readonly");
    const done = completed(transaction);
    const record = await result(get<MetaRecord>(transaction.objectStore(META), vaultId));
    await done;
    return record?.cursor ?? 0;
  }

  async setCursor(vaultId: string, cursor: number): Promise<void> {
    const database = await this.#database();
    const transaction = database.transaction(META, "readwrite");
    const done = completed(transaction);
    const store = transaction.objectStore(META);
    const record = await result(get<MetaRecord>(store, vaultId));
    await result(store.put({ vaultId, cursor, acknowledgedSinceSnapshot: record?.acknowledgedSinceSnapshot ?? 0 } satisfies MetaRecord));
    await done;
  }

  async enqueue(entry: OutboxEntry): Promise<void> {
    const database = await this.#database();
    const transaction = database.transaction(OUTBOX, "readwrite");
    const done = completed(transaction);
    await result(transaction.objectStore(OUTBOX).put({ ...entry, updateId: entry.envelope.updateId, vaultId: entry.envelope.vaultId } satisfies OutboxRecord));
    await done;
  }

  async listOutbox(vaultId: string, limit: number): Promise<OutboxEntry[]> {
    const database = await this.#database();
    const transaction = database.transaction(OUTBOX, "readonly");
    const done = completed(transaction);
    const index = transaction.objectStore(OUTBOX).index("vaultId,queuedAt");
    const records = await result(getAll<OutboxRecord>(index, IDBKeyRange.bound([vaultId, ""], [vaultId, "\uffff"]), limit));
    await done;
    return records.map(({ envelope, queuedAt }) => ({ envelope, queuedAt }));
  }

  async acknowledge(updateIds: string[]): Promise<number> {
    if (updateIds.length === 0) return 0;
    const database = await this.#database();
    const transaction = database.transaction([OUTBOX, META], "readwrite");
    const done = completed(transaction);
    const outbox = transaction.objectStore(OUTBOX);
    const counts = new Map<string, number>();
    for (const updateId of updateIds) {
      const entry = await result(get<OutboxRecord>(outbox, updateId));
      if (entry !== undefined) {
        counts.set(entry.vaultId, (counts.get(entry.vaultId) ?? 0) + 1);
        await result(outbox.delete(updateId));
      }
    }
    const meta = transaction.objectStore(META);
    for (const [vaultId, count] of counts) {
      const record = await result(get<MetaRecord>(meta, vaultId));
      await result(meta.put({ vaultId, cursor: record?.cursor ?? 0, acknowledgedSinceSnapshot: (record?.acknowledgedSinceSnapshot ?? 0) + count } satisfies MetaRecord));
    }
    await done;
    return [...counts.values()].reduce((sum, count) => sum + count, 0);
  }

  async getAcknowledgedSinceSnapshot(vaultId: string): Promise<number> {
    const database = await this.#database();
    const transaction = database.transaction(META, "readonly");
    const done = completed(transaction);
    const record = await result(get<MetaRecord>(transaction.objectStore(META), vaultId));
    await done;
    return record?.acknowledgedSinceSnapshot ?? 0;
  }

  async resetAcknowledgedSinceSnapshot(vaultId: string): Promise<void> {
    const database = await this.#database();
    const transaction = database.transaction(META, "readwrite");
    const done = completed(transaction);
    const store = transaction.objectStore(META);
    const record = await result(get<MetaRecord>(store, vaultId));
    await result(store.put({ vaultId, cursor: record?.cursor ?? 0, acknowledgedSinceSnapshot: 0 } satisfies MetaRecord));
    await done;
  }

  async resetForServerRestore(): Promise<void> {
    const database = await this.#database();
    const transaction = database.transaction([META, OUTBOX], "readwrite");
    const done = completed(transaction);
    await Promise.all([
      result(transaction.objectStore(META).clear()),
      result(transaction.objectStore(OUTBOX).clear()),
    ]);
    await done;
  }

  async getActiveSecret(): Promise<StoredSyncSecret | null> {
    const database = await this.#database();
    const transaction = database.transaction(SECRETS, "readonly");
    const done = completed(transaction);
    const record = await result(get<SecretRecord>(transaction.objectStore(SECRETS), ACTIVE_SECRET));
    await done;
    if (record === undefined) return null;
    const rootSecret = base64UrlDecode(record.rootSecret);
    if (rootSecret.length !== 32) throw new Error("Stored root secret has an invalid length");
    return { rootSecret, relayUrl: record.relayUrl };
  }

  async setActiveSecret(secret: StoredSyncSecret, recoveryAcknowledged = true): Promise<void> {
    if (secret.rootSecret.length !== 32) throw new RangeError("Root secret must contain exactly 32 bytes");
    const database = await this.#database();
    const transaction = database.transaction(SECRETS, "readwrite");
    const done = completed(transaction);
    await result(transaction.objectStore(SECRETS).put({ id: ACTIVE_SECRET, rootSecret: base64UrlEncode(secret.rootSecret), relayUrl: secret.relayUrl, recoveryAcknowledged } satisfies SecretRecord));
    await done;
  }

  async isCreationRecoveryPending(): Promise<boolean> {
    const database = await this.#database();
    const transaction = database.transaction(SECRETS, "readonly");
    const done = completed(transaction);
    const record = await result(get<SecretRecord>(transaction.objectStore(SECRETS), ACTIVE_SECRET));
    await done;
    return record?.recoveryAcknowledged === false;
  }

  async acknowledgeCreationRecovery(): Promise<void> {
    const database = await this.#database();
    const transaction = database.transaction(SECRETS, "readwrite");
    const done = completed(transaction);
    const store = transaction.objectStore(SECRETS);
    const record = await result(get<SecretRecord>(store, ACTIVE_SECRET));
    if (record !== undefined) {
      await result(store.put({ ...record, recoveryAcknowledged: true } satisfies SecretRecord));
    }
    await done;
  }

  async destroy(): Promise<void> {
    if (this.#databasePromise !== null) (await this.#databasePromise).close();
    this.#databasePromise = null;
  }
}
