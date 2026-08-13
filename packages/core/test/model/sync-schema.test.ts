import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  addTask,
  createPlanDoc,
  pruneExpiredHistory,
  removeTask,
  setTaskCompleted,
  snapshotPlan,
} from "../../src/index";

const today = { kind: "date", date: "2026-08-03" } as const;
const now = "2026-08-03T08:00:00.000Z";

function add(
  doc: Y.Doc,
  id: string,
  parentId: string | null = null,
): void {
  addTask(doc, {
    id,
    title: id,
    note: null,
    bucket: today,
    parentId,
    order: 0,
    now,
  });
}

describe("sync-safe raw schema and retention", () => {
  it("surfaces malformed remote scalar data with typed diagnostics and safe values", () => {
    const doc = createPlanDoc();
    add(doc, "malformed");
    const map = doc.getMap<Y.Map<unknown>>("tasks").get("malformed");
    if (map === undefined) {
      throw new Error("missing test task");
    }
    map.set("bucket", "date:2026-02-30");
    map.set("order", -1);
    map.set("completedAt", "yesterday");
    map.set("completedOn", "2026-02-30");
    map.set("childrenRevealedOn", 3);
    map.set("createdAt", "2026-02-30T08:00:00.000Z");
    map.set("updatedAt", Number.NaN);
    map.set("deleted", "yes");
    map.set("prunedOn", 42);

    const snapshot = snapshotPlan(doc);

    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.tasks[0]).toMatchObject({
      id: "malformed",
      bucket: { kind: "later" },
      order: 0,
      completedAt: null,
      completedOn: null,
      childrenRevealedOn: null,
      deleted: false,
      prunedOn: null,
    });
    expect(snapshot.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "invalid_task_bucket",
        "invalid_task_order",
        "invalid_task_completedAt",
        "invalid_task_completedOn",
        "invalid_task_childrenRevealedOn",
        "invalid_task_createdAt",
        "invalid_task_updatedAt",
        "invalid_task_deleted",
        "invalid_task_prunedOn",
      ]),
    );
    expect(snapshot.diagnostics.every(({ taskId }) => taskId === "malformed")).toBe(
      true,
    );
  });

  it("never omits a malformed raw record or loses non-empty legacy note text", () => {
    const doc = createPlanDoc();
    addTask(doc, {
      id: "legacy-note",
      title: "Legacy note",
      note: "keep this text",
      bucket: today,
      parentId: null,
      order: 0,
      now,
    });
    const tasks = doc.getMap<Y.Map<unknown>>("tasks");
    const legacy = tasks.get("legacy-note");
    legacy?.delete("notePresent");
    legacy?.set("notePresent", false);
    tasks.set("broken-record", "not-a-map" as unknown as Y.Map<unknown>);

    const snapshot = snapshotPlan(doc);

    expect(snapshot.records.map(({ id }) => id)).toEqual([
      "broken-record",
      "legacy-note",
    ]);
    expect(snapshot.tasks.find(({ id }) => id === "legacy-note")?.note).toBe(
      "keep this text",
    );
    expect(snapshot.tasks.find(({ id }) => id === "broken-record")).toBeDefined();
    expect(snapshot.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["invalid_task_map", "inconsistent_task_notePresence"]),
    );
  });

  it("keeps explicit deletion as parent-and-known-child tombstones without task GC", () => {
    const doc = createPlanDoc();
    add(doc, "parent");
    add(doc, "child", "parent");

    removeTask(doc, "parent");

    const rawTasks = doc.getMap<Y.Map<unknown>>("tasks");
    expect([...rawTasks.keys()].sort()).toEqual(["child", "parent"]);
    expect(rawTasks.get("parent")?.get("deleted")).toBe(true);
    expect(rawTasks.get("child")?.get("deleted")).toBe(true);
    expect(snapshotPlan(doc).tasks).toEqual([]);
    expect(snapshotPlan(doc).records).toHaveLength(2);
  });

  it("keeps automatic pruning as a reversible marker and lets reopen win", () => {
    const doc = createPlanDoc();
    addTask(doc, {
      id: "old",
      title: "Old",
      note: null,
      bucket: { kind: "date", date: "2026-07-01" },
      parentId: null,
      order: 0,
      now: "2026-07-01T08:00:00.000Z",
    });
    setTaskCompleted(doc, "old", {
      completed: true,
      at: "2026-07-01T09:00:00.000Z",
      on: "2026-07-01",
    });

    pruneExpiredHistory(doc, "2026-08-03");

    const raw = doc.getMap<Y.Map<unknown>>("tasks").get("old");
    expect(raw).toBeDefined();
    expect(raw?.get("prunedOn")).toBe("2026-08-03");
    expect(snapshotPlan(doc).tasks).toEqual([]);
    expect(snapshotPlan(doc).records).toHaveLength(1);

    setTaskCompleted(doc, "old", {
      completed: false,
      at: "2026-08-03T10:00:00.000Z",
      on: "2026-08-03",
    });
    expect(snapshotPlan(doc).tasks).toMatchObject([
      { id: "old", completedAt: null },
    ]);
  });

  it("surfaces a missing-parent child as effective top-level with reattach provenance", () => {
    const doc = createPlanDoc();
    add(doc, "parent");
    add(doc, "child", "parent");
    doc.getMap<Y.Map<unknown>>("tasks").delete("parent");

    const orphaned = snapshotPlan(doc);

    expect(orphaned.tasks).toMatchObject([
      { id: "child", parentId: null, sourceParentId: "parent" },
    ]);
    expect(orphaned.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "missing_task_parent",
        taskId: "child",
      }),
    );
    expect(orphaned.records).toMatchObject([
      { id: "child", parentId: "parent", sourceParentId: null },
    ]);
  });
});
