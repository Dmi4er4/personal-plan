import "fake-indexeddb/auto";

import { addTask, snapshotPlan } from "@personal-plan/core";
import { describe, expect, it, vi } from "vitest";

import { deleteDatabase, IndexedDbPlanStore } from "../../src/storage/indexeddb.js";
import { applyPendingLocalDataReset, requestLocalDataReset, requestServerDataRestore } from "../../src/storage/reset-local-data.js";
import { deleteSyncDatabase, IndexedDbSyncStateStore } from "../../src/storage/sync-indexeddb.js";

function memoryMarkerStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string): string | null { return values.get(key) ?? null; },
    removeItem(key: string): void { values.delete(key); },
    setItem(key: string, value: string): void { values.set(key, value); },
  };
}

describe("local PWA reset", () => {
  it("deletes the plan, draft, sync state, and active vault on the next load", async () => {
    const suffix = crypto.randomUUID();
    const planDatabaseName = `reset-plan-${suffix}`;
    const syncDatabaseName = `reset-sync-${suffix}`;
    const planStore = new IndexedDbPlanStore(planDatabaseName);
    const doc = await planStore.load();
    addTask(doc, {
      id: "discarded-task",
      title: "Старый план",
      note: null,
      bucket: { kind: "later" },
      parentId: null,
      order: 0,
      now: "2026-08-10T10:00:00.000Z",
    });
    await planStore.saveDraft("старый черновик");
    await planStore.destroy();

    const syncStore = new IndexedDbSyncStateStore(syncDatabaseName);
    await syncStore.setActiveSecret({
      relayUrl: "https://plan.test",
      rootSecret: new Uint8Array(32).fill(3),
    });
    await syncStore.destroy();

    const markerStorage = memoryMarkerStorage();
    const reload = vi.fn();
    requestLocalDataReset(markerStorage, reload);
    expect(reload).toHaveBeenCalledTimes(1);

    await expect(applyPendingLocalDataReset({
      markerStorage,
      planDatabaseName,
      syncDatabaseName,
    })).resolves.toBe(true);

    const emptyPlanStore = new IndexedDbPlanStore(planDatabaseName);
    expect(snapshotPlan(await emptyPlanStore.load()).tasks).toEqual([]);
    expect(await emptyPlanStore.loadDraft()).toBeNull();
    await emptyPlanStore.destroy();

    const emptySyncStore = new IndexedDbSyncStateStore(syncDatabaseName);
    expect(await emptySyncStore.getActiveSecret()).toBeNull();
    await emptySyncStore.destroy();
    await Promise.all([
      deleteDatabase(planDatabaseName),
      deleteSyncDatabase(syncDatabaseName),
    ]);
  });

  it("discards the local plan and sync cursor while preserving the active vault", async () => {
    const suffix = crypto.randomUUID();
    const planDatabaseName = `restore-plan-${suffix}`;
    const syncDatabaseName = `restore-sync-${suffix}`;
    const planStore = new IndexedDbPlanStore(planDatabaseName);
    const doc = await planStore.load();
    addTask(doc, {
      id: "desynced-task",
      title: "Рассинхронизированная копия",
      note: null,
      bucket: { kind: "later" },
      parentId: null,
      order: 0,
      now: "2026-08-12T10:00:00.000Z",
    });
    await planStore.saveDraft("локальный черновик");
    await planStore.destroy();

    const rootSecret = new Uint8Array(32).fill(7);
    const vaultId = "preserved-vault";
    const syncStore = new IndexedDbSyncStateStore(syncDatabaseName);
    await syncStore.setActiveSecret({ relayUrl: "https://plan.test", rootSecret });
    await syncStore.setCursor(vaultId, 140);
    await syncStore.enqueue({
      envelope: {
        version: 1,
        kind: "update",
        vaultId,
        updateId: "queued-update",
        nonce: "nonce",
        ciphertext: "ciphertext",
        createdAt: "2026-08-12T10:00:00.000Z",
      },
      queuedAt: "2026-08-12T10:00:00.000Z",
    });
    await syncStore.destroy();

    const markerStorage = memoryMarkerStorage();
    const reload = vi.fn();
    requestServerDataRestore(markerStorage, reload);
    expect(reload).toHaveBeenCalledTimes(1);
    await expect(applyPendingLocalDataReset({ markerStorage, planDatabaseName, syncDatabaseName })).resolves.toBe(true);

    const emptyPlanStore = new IndexedDbPlanStore(planDatabaseName);
    expect(snapshotPlan(await emptyPlanStore.load()).tasks).toEqual([]);
    expect(await emptyPlanStore.loadDraft()).toBeNull();
    await emptyPlanStore.destroy();

    const restoredSyncStore = new IndexedDbSyncStateStore(syncDatabaseName);
    expect(await restoredSyncStore.getActiveSecret()).toEqual({ relayUrl: "https://plan.test", rootSecret });
    expect(await restoredSyncStore.getCursor(vaultId)).toBe(0);
    expect(await restoredSyncStore.listOutbox(vaultId, 10)).toEqual([]);
    await restoredSyncStore.destroy();
    await Promise.all([
      deleteDatabase(planDatabaseName),
      deleteSyncDatabase(syncDatabaseName),
    ]);
  });
});
