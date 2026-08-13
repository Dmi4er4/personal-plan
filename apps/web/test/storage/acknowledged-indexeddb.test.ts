import "fake-indexeddb/auto";

import { addTask, snapshotPlan } from "@personal-plan/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteDatabase,
  IndexedDbPlanStore,
} from "../../src/storage/indexeddb.js";

const databaseNames = [
  "ack-failure",
  "ack-in-flight",
  "ack-destroy-before-load",
  "ack-no-post-destroy",
];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databaseNames.map(deleteDatabase));
});

async function waitForStatus(
  store: IndexedDbPlanStore,
  expected: "loading" | "saving" | "saved" | "error",
): Promise<void> {
  if (store.getPersistenceState().status === expected) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for persistence state ${expected}`));
    }, 2_000);
    const unsubscribe = store.subscribePersistence((state) => {
      if (state.status === expected) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

function add(doc: Awaited<ReturnType<IndexedDbPlanStore["load"]>>, id: string): void {
  addTask(doc, {
    id,
    title: id,
    note: null,
    bucket: { kind: "later" },
    parentId: null,
    order: 0,
    now: "2026-08-03T08:00:00.000Z",
  });
}

describe("acknowledged IndexedDB persistence", () => {
  it("keeps the prior acknowledged snapshot on write rejection, then persists retry", async () => {
    const first = new IndexedDbPlanStore("ack-failure");
    const firstDoc = await first.load();
    expect(first.getPersistenceState()).toMatchObject({ status: "saved" });
    add(firstDoc, "acknowledged");
    await waitForStatus(first, "saved");
    await first.destroy();

    const failing = new IndexedDbPlanStore("ack-failure");
    const failingDoc = await failing.load();
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(() => {
        throw new DOMException("quota exhausted", "QuotaExceededError");
      });

    add(failingDoc, "unsaved");
    await waitForStatus(failing, "error");
    const failedState = failing.getPersistenceState();
    expect(failedState.status).toBe("error");
    if (failedState.status !== "error") {
      throw new Error("Expected persistence failure state");
    }
    expect(failedState.error.name).toBe("QuotaExceededError");
    expect(snapshotPlan(failingDoc).tasks.map(({ id }) => id)).toEqual([
      "acknowledged",
      "unsaved",
    ]);

    const beforeRetry = new IndexedDbPlanStore("ack-failure");
    const beforeRetryDoc = await beforeRetry.load();
    expect(snapshotPlan(beforeRetryDoc).tasks.map(({ id }) => id)).toEqual([
      "acknowledged",
    ]);
    await beforeRetry.destroy();

    put.mockRestore();
    await failing.retryPersistence();
    expect(failing.getPersistenceState()).toMatchObject({ status: "saved" });
    await failing.destroy();

    const afterRetry = new IndexedDbPlanStore("ack-failure");
    const afterRetryDoc = await afterRetry.load();
    expect(snapshotPlan(afterRetryDoc).tasks.map(({ id }) => id)).toEqual([
      "acknowledged",
      "unsaved",
    ]);
    await afterRetry.destroy();
  });

  it("serializes writes arriving during an in-flight write and acknowledges the latest", async () => {
    const store = new IndexedDbPlanStore("ack-in-flight");
    const doc = await store.load();

    add(doc, "first");
    add(doc, "second");
    add(doc, "third");
    await waitForStatus(store, "saved");
    await store.destroy();

    const reloaded = new IndexedDbPlanStore("ack-in-flight");
    const reloadedDoc = await reloaded.load();
    expect(snapshotPlan(reloadedDoc).tasks.map(({ id }) => id).sort()).toEqual([
      "first",
      "second",
      "third",
    ]);
    await reloaded.destroy();
  });

  it("cleans status listeners and supports concurrent repeated destroy", async () => {
    const store = new IndexedDbPlanStore("ack-in-flight");
    const doc = await store.load();
    const listener = vi.fn();
    const unsubscribe = store.subscribePersistence(listener);
    unsubscribe();
    add(doc, "after-unsubscribe");
    await waitForStatus(store, "saved");
    expect(listener).toHaveBeenCalledTimes(1);

    await Promise.all([store.destroy(), store.destroy(), store.destroy()]);
  });

  it("rejects load when destroyed before load completes", async () => {
    const store = new IndexedDbPlanStore("ack-destroy-before-load");
    const loading = store.load();
    const destroying = store.destroy();

    await expect(loading).rejects.toThrow("destroyed before it loaded");
    await destroying;
    await expect(store.load()).rejects.toThrow("destroyed");
  });

  it("does not persist document mutations after destroy", async () => {
    const store = new IndexedDbPlanStore("ack-no-post-destroy");
    const doc = await store.load();
    add(doc, "acknowledged");
    await waitForStatus(store, "saved");
    await store.destroy();

    add(doc, "after-destroy");

    const reloaded = new IndexedDbPlanStore("ack-no-post-destroy");
    const reloadedDoc = await reloaded.load();
    expect(snapshotPlan(reloadedDoc).tasks.map(({ id }) => id)).toEqual([
      "acknowledged",
    ]);
    await reloaded.destroy();
  });
});
