import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  addTask,
  createPlanDoc,
  moveTask,
  projectPlan,
  pruneExpiredHistory,
  removeTask,
  setTaskCompleted,
  snapshotPlan,
  type Bucket,
} from "../../src/index";

const today = { kind: "date", date: "2026-08-03" } as const;
const later = { kind: "later" } as const;
const now = "2026-08-03T08:00:00.000Z";

function clone(source: Y.Doc): Y.Doc {
  const target = createPlanDoc();
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source));
  return target;
}

function add(
  doc: Y.Doc,
  id: string,
  parentId: string | null = null,
  bucket: Bucket = today,
): void {
  addTask(doc, {
    id,
    title: id,
    note: null,
    bucket,
    parentId,
    order: 0,
    now,
  });
}

function writeRawTask(
  doc: Y.Doc,
  id: string,
  parentId: string | null,
  bucket: Bucket = today,
): void {
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    const title = new Y.Text();
    title.insert(0, id);
    map.set("id", id);
    map.set("title", title);
    map.set("note", new Y.Text());
    map.set("notePresent", false);
    map.set("bucket", bucket.kind === "date" ? `date:${bucket.date}` : bucket.kind);
    map.set("parentId", parentId);
    map.set("order", 0);
    map.set("completedAt", null);
    map.set("completedOn", null);
    map.set("childrenRevealedOn", null);
    map.set("createdAt", now);
    map.set("updatedAt", now);
    map.set("deleted", false);
    map.set("prunedOn", null);
    doc.getMap<Y.Map<unknown>>("tasks").set(id, map);
  });
}

function semantic(doc: Y.Doc): Uint8Array {
  const snapshot = snapshotPlan(doc);
  const projected = projectPlan(snapshot.tasks, "2026-08-03");
  return new TextEncoder().encode(
    JSON.stringify({
      diagnostics: snapshot.diagnostics,
      records: snapshot.records,
      tasks: snapshot.tasks,
      projected,
    }),
  );
}

function exchange(
  base: Y.Doc,
  mutateLeft: (doc: Y.Doc) => void,
  mutateRight: (doc: Y.Doc) => void,
): [Y.Doc, Y.Doc] {
  const leftReplica = clone(base);
  const rightReplica = clone(base);
  const baseVector = Y.encodeStateVector(base);
  mutateLeft(leftReplica);
  mutateRight(rightReplica);
  const leftUpdate = Y.encodeStateAsUpdate(leftReplica, baseVector);
  const rightUpdate = Y.encodeStateAsUpdate(rightReplica, baseVector);
  const leftThenRight = clone(base);
  const rightThenLeft = clone(base);
  Y.applyUpdate(leftThenRight, leftUpdate);
  Y.applyUpdate(leftThenRight, rightUpdate);
  Y.applyUpdate(rightThenLeft, rightUpdate);
  Y.applyUpdate(rightThenLeft, leftUpdate);
  expect(semantic(leftThenRight)).toEqual(semantic(rightThenLeft));
  return [leftThenRight, rightThenLeft];
}

describe("two-replica tombstone and invariant convergence", () => {
  it("converges for prune versus reopen and keeps the incomplete task active", () => {
    const base = createPlanDoc();
    addTask(base, {
      id: "old",
      title: "old",
      note: null,
      bucket: { kind: "date", date: "2026-07-01" },
      parentId: null,
      order: 0,
      now: "2026-07-01T08:00:00.000Z",
    });
    setTaskCompleted(base, "old", {
      completed: true,
      at: "2026-07-01T09:00:00.000Z",
      on: "2026-07-01",
    });

    const [first, second] = exchange(
      base,
      (doc) => {
        pruneExpiredHistory(doc, "2026-08-03");
      },
      (doc) => {
        setTaskCompleted(doc, "old", {
          completed: false,
          at: "2026-08-03T10:00:00.000Z",
          on: "2026-08-03",
        });
      },
    );

    for (const doc of [first, second]) {
      expect(snapshotPlan(doc).tasks).toMatchObject([
        { id: "old", completedAt: null },
      ]);
      expect(doc.getMap("tasks").has("old")).toBe(true);
    }
  });

  it("converges for parent delete versus concurrent child creation and preserves the live child", () => {
    const base = createPlanDoc();
    add(base, "parent");
    add(base, "known-child", "parent");

    const [first, second] = exchange(
      base,
      (doc) => {
        removeTask(doc, "parent");
      },
      (doc) => {
        add(doc, "live-child", "parent");
      },
    );

    for (const doc of [first, second]) {
      expect(snapshotPlan(doc).tasks).toMatchObject([
        { id: "parent", deleted: true },
        { id: "live-child", parentId: "parent", deleted: false },
      ]);
      expect(snapshotPlan(doc).tasks.map(({ id }) => id)).not.toContain(
        "known-child",
      );
      expect([...doc.getMap("tasks").keys()].sort()).toEqual([
        "known-child",
        "live-child",
        "parent",
      ]);
    }
  });

  it("converges for explicit delete versus a concurrent independent create", () => {
    const base = createPlanDoc();
    add(base, "removed");

    const [first, second] = exchange(
      base,
      (doc) => {
        removeTask(doc, "removed");
      },
      (doc) => {
        add(doc, "created");
      },
    );

    for (const doc of [first, second]) {
      expect(snapshotPlan(doc).tasks.map(({ id }) => id)).toEqual(["created"]);
      expect(snapshotPlan(doc).records.map(({ id }) => id)).toEqual([
        "created",
        "removed",
      ]);
      expect(doc.getMap("tasks").has("removed")).toBe(true);
    }
  });

  it("converges for parent move versus concurrent child creation and uses the parent bucket", () => {
    const base = createPlanDoc();
    add(base, "parent");

    const [first, second] = exchange(
      base,
      (doc) => {
        moveTask(doc, "parent", {
          bucket: later,
          parentId: null,
          index: 0,
          now: "2026-08-03T10:00:00.000Z",
        });
      },
      (doc) => {
        add(doc, "new-child", "parent", today);
      },
    );

    for (const doc of [first, second]) {
      expect(snapshotPlan(doc).tasks).toMatchObject([
        { id: "parent", bucket: later },
        { id: "new-child", parentId: "parent", bucket: later },
      ]);
      expect(
        projectPlan(snapshotPlan(doc).tasks, "2026-08-03").active
          .find(({ bucket }) => bucket.kind === "later")
          ?.tasks.map(({ id }) => id),
      ).toEqual(["parent", "new-child"]);
    }
  });

  it("surfaces an orphan update before its independently arriving parent and then reattaches", () => {
    const base = createPlanDoc();
    const childReplica = clone(base);
    const parentReplica = clone(base);
    writeRawTask(childReplica, "child", "parent");
    writeRawTask(parentReplica, "parent", null);
    const childUpdate = Y.encodeStateAsUpdate(childReplica);
    const parentUpdate = Y.encodeStateAsUpdate(parentReplica);

    const childFirst = createPlanDoc();
    Y.applyUpdate(childFirst, childUpdate);
    expect(snapshotPlan(childFirst).tasks).toMatchObject([
      { id: "child", parentId: null, sourceParentId: "parent" },
    ]);
    Y.applyUpdate(childFirst, parentUpdate);

    const parentFirst = createPlanDoc();
    Y.applyUpdate(parentFirst, parentUpdate);
    Y.applyUpdate(parentFirst, childUpdate);

    expect(semantic(childFirst)).toEqual(semantic(parentFirst));
    expect(snapshotPlan(childFirst).tasks).toMatchObject([
      { id: "parent", parentId: null },
      { id: "child", parentId: "parent", sourceParentId: null },
    ]);
  });

  it("hides a tombstoned parent only when it has no live child", () => {
    const withoutLiveChild = createPlanDoc();
    add(withoutLiveChild, "parent");
    add(withoutLiveChild, "child", "parent");
    removeTask(withoutLiveChild, "parent");
    expect(snapshotPlan(withoutLiveChild).tasks).toEqual([]);

    const withLiveChild = createPlanDoc();
    add(withLiveChild, "parent");
    removeTask(withLiveChild, "parent");
    add(withLiveChild, "live-child", "parent");
    expect(snapshotPlan(withLiveChild).tasks).toMatchObject([
      { id: "parent", deleted: true },
      { id: "live-child", parentId: "parent", deleted: false },
    ]);
  });

  it("keeps repeated invariant projection idempotent and mutation-free", () => {
    const doc = createPlanDoc();
    writeRawTask(doc, "orphan", "missing-parent", later);
    const before = Y.encodeStateAsUpdate(doc);

    const first = semantic(doc);
    const second = semantic(doc);
    const third = semantic(doc);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });
});
