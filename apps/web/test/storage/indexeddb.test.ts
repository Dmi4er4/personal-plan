import "fake-indexeddb/auto";

import { addTask, createPlanDoc, snapshotPlan } from "@personal-plan/core";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

import { deleteDatabase, IndexedDbPlanStore } from "../../src/storage/indexeddb.js";

const databaseNames = ["test-plan", "test-plan-draft", "test-plan-legacy"];

async function seedVersionOneYIndexedDb(
  name: string,
  updates: readonly Uint8Array[],
): Promise<void> {
  const request = indexedDB.open(name, 1);
  request.addEventListener("upgradeneeded", () => {
    request.result.createObjectStore("updates", { autoIncrement: true });
    request.result.createObjectStore("custom");
  });
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
  const transaction = database.transaction("updates", "readwrite");
  for (const update of updates) {
    transaction.objectStore("updates").add(update);
  }
  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
  });
  expect(database.version).toBe(1);
  database.close();
}

afterEach(async () => {
  await Promise.all(databaseNames.map(deleteDatabase));
});

describe("IndexedDbPlanStore", () => {
  it.each(["structs", "deletions"])("flushes pending %s that emit no Yjs update event", async (kind) => {
    const source = new Y.Doc();
    const updates: Uint8Array[] = [];
    source.on("update", (update: Uint8Array) => updates.push(update));
    source.getMap("tasks").set("dependency", "first");
    if (kind === "structs") source.getMap("tasks").set("pending", "keep this operation");
    else source.getMap("tasks").delete("dependency");
    const initial = updates.at(0); const later = updates.at(1);
    if (initial === undefined || later === undefined) throw new Error("fixture_update_missing");
    const first = new IndexedDbPlanStore("test-plan");
    const doc = await first.load();
    Y.applyUpdate(doc, later);
    await first.flush();
    const bytes = await first.checkpointBytes(doc);
    await first.destroy();
    const reopened = new IndexedDbPlanStore("test-plan");
    const loaded = await reopened.load();

    expect(await reopened.checkpointBytes(loaded)).toEqual(bytes);
    Y.applyUpdate(loaded, initial);
    if (kind === "structs") expect(loaded.getMap("tasks").get("pending")).toBe("keep this operation");
    else expect(loaded.getMap("tasks").has("dependency")).toBe(false);
    await reopened.destroy();
  });

  it("restores plan data after the store is destroyed and reopened", async () => {
    const firstStore = new IndexedDbPlanStore("test-plan");
    const firstDoc = await firstStore.load();

    addTask(firstDoc, {
      id: "persistent-task",
      title: "Пережить перезапуск",
      note: null,
      bucket: { kind: "later" },
      parentId: null,
      order: 0,
      now: "2026-08-03T08:00:00.000Z",
    });
    await firstStore.destroy();

    const secondStore = new IndexedDbPlanStore("test-plan");
    const secondDoc = await secondStore.load();

    expect(snapshotPlan(secondDoc).tasks).toMatchObject([
      { id: "persistent-task", title: "Пережить перезапуск" },
    ]);
    await secondStore.destroy();
  });

  it("flushes the current plan before a sync cursor can be committed", async () => {
    const store = new IndexedDbPlanStore("test-plan");
    const doc = await store.load();
    addTask(doc, {
      id: "remote-before-cursor",
      title: "Сначала сохранить план",
      note: null,
      bucket: { kind: "later" },
      parentId: null,
      order: 0,
      now: "2026-08-03T08:00:00.000Z",
    });

    await store.flush();

    const reloaded = new IndexedDbPlanStore("test-plan");
    expect(snapshotPlan(await reloaded.load()).tasks).toMatchObject([
      { id: "remote-before-cursor", title: "Сначала сохранить план" },
    ]);
    await reloaded.destroy();
    await store.destroy();
  });

  it("persists a draft independently from plan data", async () => {
    const firstStore = new IndexedDbPlanStore("test-plan-draft");
    await firstStore.saveDraft("черновик");
    await firstStore.destroy();

    const secondStore = new IndexedDbPlanStore("test-plan-draft");
    expect(await secondStore.loadDraft()).toBe("черновик");

    await secondStore.clearDraft();
    expect(await secondStore.loadDraft()).toBeNull();
    await secondStore.destroy();
  });

  it("loads an actual version-1 y-indexeddb updates database", async () => {
    const legacyDoc = createPlanDoc();
    addTask(legacyDoc, {
      id: "legacy-task",
      title: "Из старой базы",
      note: null,
      bucket: { kind: "later" },
      parentId: null,
      order: 0,
      now: "2026-08-03T08:00:00.000Z",
    });
    const firstUpdate = Y.encodeStateAsUpdate(legacyDoc);
    const firstVector = Y.encodeStateVector(legacyDoc);
    addTask(legacyDoc, {
      id: "legacy-task-2",
      title: "Из второго update",
      note: null,
      bucket: { kind: "later" },
      parentId: null,
      order: 1,
      now: "2026-08-03T08:01:00.000Z",
    });
    const secondUpdate = Y.encodeStateAsUpdate(legacyDoc, firstVector);
    await seedVersionOneYIndexedDb("test-plan-legacy", [
      firstUpdate,
      secondUpdate,
    ]);

    const store = new IndexedDbPlanStore("test-plan-legacy");
    const loaded = await store.load();

    expect(snapshotPlan(loaded).tasks.map(({ id }) => id)).toEqual([
      "legacy-task",
      "legacy-task-2",
    ]);
    await store.destroy();
  });
});
