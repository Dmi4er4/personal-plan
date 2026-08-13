import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  addTask,
  applyReconcilePreview,
  buildReconcilePreview,
  createPlanDoc,
  parsePlanText,
  setTaskCompleted,
  snapshotPlan,
  type Bucket,
  type ReconcilePreview,
} from "../../src/index";

const today = { kind: "date", date: "2026-08-03" } as const;
const tomorrow = { kind: "date", date: "2026-08-04" } as const;
const now = "2026-08-03T12:00:00.000Z";

function add(
  doc: Y.Doc,
  id: string,
  title: string,
  bucket: Bucket,
  order: number,
  parentId: string | null = null,
  note: string | null = null,
  createdAt = "2026-08-01T08:00:00.000Z",
): void {
  addTask(doc, {
    id,
    title,
    note,
    bucket,
    parentId,
    order,
    now: createdAt,
  });
}

function parsed(todayLines: string, tomorrowLines = "") {
  const tomorrowSection =
    tomorrowLines.length === 0
      ? ""
      : `\n\nЗавтра — вт, 4 августа\n${tomorrowLines}`;
  return parsePlanText(
    `Сегодня — пн, 3 августа\n${todayLines}${tomorrowSection}`,
    "2026-08-03",
  );
}

function apply(doc: Y.Doc, preview: ReconcilePreview): void {
  applyReconcilePreview(doc, preview, {
    completedOn: "2026-08-03",
    confirmRisky: preview.requiresConfirmation,
    idFactory: vi.fn(() => "unexpected-created-id"),
    now,
  });
}

function structuralChangeIds(preview: ReconcilePreview): string[] {
  return preview.changes
    .flatMap((change) =>
      change.kind === "create" ? [] : [change.taskId],
    )
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .sort();
}

describe("structural Text reconciliation", () => {
  it("promotes a unique child in the same bucket without replacing its identity", () => {
    const doc = createPlanDoc();
    add(doc, "parent", "Parent", today, 0);
    add(
      doc,
      "child",
      "Child",
      today,
      0,
      "parent",
      "note",
      "2026-08-01T08:01:00.000Z",
    );
    setTaskCompleted(doc, "child", {
      completed: true,
      at: "2026-08-03T09:00:00.000Z",
      on: "2026-08-03",
    });
    const before = snapshotPlan(doc).tasks.find(({ id }) => id === "child");

    const preview = buildReconcilePreview(
      doc,
      parsed("Parent\n+ Child: note"),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(false);
    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "create" }),
    );
    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "remove", taskId: "child" }),
    );
    expect(structuralChangeIds(preview)).toEqual(["child"]);

    apply(doc, preview);
    expect(snapshotPlan(doc).tasks.find(({ id }) => id === "child")).toEqual({
      ...before,
      parentId: null,
      order: 1,
      updatedAt: now,
    });
  });

  it("promotes a unique child across buckets and preserves its metadata", () => {
    const doc = createPlanDoc();
    add(doc, "parent", "Parent", today, 0);
    add(
      doc,
      "child",
      "Child",
      today,
      0,
      "parent",
      "",
      "2026-08-01T08:01:00.000Z",
    );
    const before = snapshotPlan(doc).tasks.find(({ id }) => id === "child");

    const preview = buildReconcilePreview(
      doc,
      parsed("Parent", "Child: "),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(false);
    expect(preview.changes).toContainEqual({
      kind: "move",
      taskId: "child",
      bucket: tomorrow,
      parentId: null,
      index: 0,
    });
    expect(preview.changes.some(({ kind }) => kind === "create")).toBe(false);
    expect(preview.changes.some(({ kind }) => kind === "remove")).toBe(false);

    apply(doc, preview);
    expect(snapshotPlan(doc).tasks.find(({ id }) => id === "child")).toEqual({
      ...before,
      bucket: tomorrow,
      parentId: null,
      order: 0,
      updatedAt: now,
    });
  });

  it("indents a unique top-level task under another parent in the same bucket", () => {
    const doc = createPlanDoc();
    add(doc, "child", "Child", today, 0, null, "keep");
    add(doc, "parent", "Parent", today, 1);
    const createdAt = snapshotPlan(doc).tasks.find(({ id }) => id === "child")
      ?.createdAt;

    const preview = buildReconcilePreview(
      doc,
      parsed("Parent\n  Child: keep"),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(false);
    expect(preview.changes).toContainEqual(
      expect.objectContaining({
        kind: "move",
        taskId: "child",
        parentId: "parent",
      }),
    );
    expect(preview.changes.some(({ kind }) => kind === "create")).toBe(false);
    expect(preview.changes.some(({ kind }) => kind === "remove")).toBe(false);

    apply(doc, preview);
    expect(snapshotPlan(doc).tasks.find(({ id }) => id === "child")).toMatchObject({
      id: "child",
      parentId: "parent",
      bucket: today,
      note: "keep",
      createdAt,
    });
  });

  it("reparents a unique child across buckets under the destination parent", () => {
    const doc = createPlanDoc();
    add(doc, "old-parent", "Old parent", today, 0);
    add(doc, "child", "Child", today, 0, "old-parent", "keep");
    add(doc, "new-parent", "New parent", tomorrow, 0);

    const preview = buildReconcilePreview(
      doc,
      parsed("Old parent", "New parent\n  Child: keep"),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(false);
    expect(preview.changes).toContainEqual(
      expect.objectContaining({
        kind: "move",
        taskId: "child",
        bucket: tomorrow,
        parentId: "new-parent",
      }),
    );
    expect(preview.changes.some(({ kind }) => kind === "create")).toBe(false);
    expect(preview.changes.some(({ kind }) => kind === "remove")).toBe(false);

    apply(doc, preview);
    expect(snapshotPlan(doc).tasks.find(({ id }) => id === "child")).toMatchObject({
      id: "child",
      parentId: "new-parent",
      bucket: tomorrow,
      note: "keep",
    });
  });

  it("keeps the ID for the only remaining renamed-and-moved top-level candidate", () => {
    const doc = createPlanDoc();
    add(doc, "anchor", "Anchor", today, 0);
    add(
      doc,
      "renamed",
      "Old title",
      today,
      1,
      null,
      null,
      "2026-07-31T08:00:00.000Z",
    );

    const preview = buildReconcilePreview(
      doc,
      parsed("Anchor", "Completely different"),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(false);
    expect(preview.changes).toContainEqual(
      expect.objectContaining({ kind: "update", taskId: "renamed" }),
    );
    expect(preview.changes).toContainEqual(
      expect.objectContaining({ kind: "move", taskId: "renamed" }),
    );
    expect(preview.changes.some(({ kind }) => kind === "create")).toBe(false);
    expect(preview.changes.some(({ kind }) => kind === "remove")).toBe(false);

    apply(doc, preview);
    expect(snapshotPlan(doc).tasks.find(({ id }) => id === "renamed")).toMatchObject({
      id: "renamed",
      title: "Completely different",
      note: null,
      bucket: tomorrow,
      createdAt: "2026-07-31T08:00:00.000Z",
    });
  });

  it("requires confirmation when multiple structural replacements remain plausible", () => {
    const doc = createPlanDoc();
    add(doc, "parent", "Parent", today, 0);
    add(doc, "child-a", "Old A", today, 0, "parent");
    add(doc, "child-b", "Old B", today, 1, "parent");

    const preview = buildReconcilePreview(
      doc,
      parsed("Parent\nNew A\nNew B"),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.changes.filter(({ kind }) => kind === "create")).toHaveLength(2);
    expect(preview.changes.filter(({ kind }) => kind === "remove")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: "child-a" }),
        expect.objectContaining({ taskId: "child-b" }),
      ]),
    );
  });

  it("finds a unique promotion after five exact parent blocks", () => {
    const doc = createPlanDoc();
    const lines: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const parentId = `parent-${String(index)}`;
      const childId = `child-${String(index)}`;
      add(doc, parentId, `Parent ${String(index)}`, today, index);
      add(doc, childId, `Child ${String(index)}`, today, 0, parentId);
      lines.push(`Parent ${String(index)}`, `  Child ${String(index)}`);
    }
    lines.splice(8, 2, "Parent 4", "Child 4");

    const preview = buildReconcilePreview(
      doc,
      parsed(lines.join("\n")),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(false);
    expect(preview.changes.some(({ kind }) => kind === "create")).toBe(false);
    expect(preview.changes.some(({ kind }) => kind === "remove")).toBe(false);
    expect(structuralChangeIds(preview)).toEqual(["child-4"]);
    apply(doc, preview);
    expect(snapshotPlan(doc).tasks.find(({ id }) => id === "child-4")).toMatchObject({
      id: "child-4",
      parentId: null,
    });
  });

  it("matches a promotion before positional fallback for an unrelated rename", () => {
    const doc = createPlanDoc();
    add(doc, "parent", "Parent", today, 0);
    add(doc, "child", "Child", today, 0, "parent");
    add(doc, "renamed", "Old title", today, 1);

    const preview = buildReconcilePreview(
      doc,
      parsed("Parent\nChild\nNew title"),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(false);
    expect(preview.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "move", taskId: "child", parentId: null }),
        expect.objectContaining({ kind: "update", taskId: "renamed" }),
      ]),
    );
    expect(preview.changes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "update", taskId: "child" }),
      ]),
    );

    apply(doc, preview);
    expect(snapshotPlan(doc).tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "child", title: "Child", parentId: null }),
        expect.objectContaining({ id: "renamed", title: "New title" }),
      ]),
    );
  });

  it("replays moves from raw orphan and divergent-child structure", () => {
    const orphanDoc = createPlanDoc();
    add(orphanDoc, "orphan", "Orphan", today, 0);
    orphanDoc
      .getMap<Y.Map<unknown>>("tasks")
      .get("orphan")
      ?.set("parentId", "missing-parent");
    const orphanPreview = buildReconcilePreview(
      orphanDoc,
      parsed("", "Orphan"),
      "2026-08-03",
    );
    apply(orphanDoc, orphanPreview);
    expect(snapshotPlan(orphanDoc).records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "orphan", parentId: null, bucket: tomorrow }),
      ]),
    );

    const divergentDoc = createPlanDoc();
    add(divergentDoc, "parent", "Parent", today, 0);
    add(divergentDoc, "child-a", "Child A", today, 0, "parent");
    add(divergentDoc, "child-b", "Child B", today, 1, "parent");
    divergentDoc
      .getMap<Y.Map<unknown>>("tasks")
      .get("child-b")
      ?.set("bucket", "date:2026-08-04");
    const divergentPreview = buildReconcilePreview(
      divergentDoc,
      parsed("Parent\n  Child B\n  Child A"),
      "2026-08-03",
    );
    apply(divergentDoc, divergentPreview);
    expect(snapshotPlan(divergentDoc).records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "child-b", bucket: today, order: 0 }),
        expect.objectContaining({ id: "child-a", bucket: today, order: 1 }),
      ]),
    );
  });

  it("reparents a task with retained tombstoned and pruned descendants", () => {
    const doc = createPlanDoc();
    add(doc, "target", "Target", today, 0);
    add(doc, "deleted-child", "Deleted child", today, 0, "target");
    add(doc, "pruned-child", "Pruned child", today, 1, "target");
    add(doc, "destination", "Destination", today, 1);
    const tasks = doc.getMap<Y.Map<unknown>>("tasks");
    tasks.get("deleted-child")?.set("deleted", true);
    tasks.get("pruned-child")?.set("completedAt", now);
    tasks.get("pruned-child")?.set("completedOn", "2026-08-03");
    tasks.get("pruned-child")?.set("prunedOn", "2026-08-03");

    const preview = buildReconcilePreview(
      doc,
      parsed("Destination\n  Target"),
      "2026-08-03",
    );
    apply(doc, preview);

    expect(snapshotPlan(doc).records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "target", parentId: "destination" }),
        expect.objectContaining({ id: "deleted-child", parentId: "target" }),
        expect.objectContaining({ id: "pruned-child", parentId: "target" }),
      ]),
    );
  });
});
