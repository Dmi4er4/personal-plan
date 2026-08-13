import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  addTask,
  applyReconcilePreview,
  buildReconcilePreview,
  createPlanDoc,
  editTask,
  parsePlanText,
  projectPlan,
  promoteSubtask,
  removeTask,
  setTaskCompleted,
  snapshotPlan,
  type Bucket,
} from "../../src/index";

const today = { kind: "date", date: "2026-08-03" } as const;
const now = "2026-08-03T12:00:00.000Z";

function add(
  doc: ReturnType<typeof createPlanDoc>,
  id: string,
  title: string,
  bucket: Bucket = today,
  order = 0,
  parentId: string | null = null,
  note: string | null = null,
): void {
  addTask(doc, { id, title, note, bucket, parentId, order, now });
}

function canonical(todayLines: string, extraSections = "") {
  return parsePlanText(
    `Сегодня — пн, 3 августа\n${todayLines}${extraSections}`,
    "2026-08-03",
  );
}

function apply(
  doc: ReturnType<typeof createPlanDoc>,
  preview: ReturnType<typeof buildReconcilePreview>,
  idFactory = vi.fn(() => "created"),
  confirmDiagnostics = false,
): void {
  applyReconcilePreview(doc, preview, {
    now,
    completedOn: "2026-08-03",
    idFactory,
    confirmDiagnostics,
  });
}

describe("text reconciliation", () => {
  it("reserves unique raw parent identities before normalized subtree fallback", () => {
    const doc = createPlanDoc();
    add(doc, "plain-parent", "A", today, 0);
    add(doc, "plain-child", "Plain child", today, 0, "plain-parent");
    add(doc, "spaced-parent", " A", today, 1);
    add(doc, "spaced-child", "Spaced child", today, 0, "spaced-parent");

    const preview = buildReconcilePreview(
      doc,
      canonical("A\n  Spaced child\n\\ A\n  Plain child"),
      "2026-08-03",
    );

    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "update", taskId: "plain-parent" }),
    );
    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "update", taskId: "spaced-parent" }),
    );

    apply(doc, preview);
    expect(snapshotPlan(doc).tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "plain-parent", title: "A" }),
        expect.objectContaining({ id: "spaced-parent", title: " A" }),
      ]),
    );
  });

  it("does not confirm an exact raw identity plus a genuinely new normalized collider", () => {
    const doc = createPlanDoc();
    add(doc, "plain-a", "A", today, 0);

    const preview = buildReconcilePreview(
      doc,
      canonical("A\n\\ A"),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(false);
    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "update", taskId: "plain-a" }),
    );
    const created = preview.changes.find(
      (change) => change.kind === "create",
    );
    expect(created?.kind).toBe("create");
    if (created?.kind !== "create") {
      throw new Error("missing_normalized_collider_create");
    }
    expect(created.task.title).toBe(" A");
  });

  it("keeps exact raw title identities when normalized-colliding rows swap", () => {
    const doc = createPlanDoc();
    addTask(doc, {
      id: "plain-a",
      title: "A",
      note: null,
      bucket: today,
      parentId: null,
      order: 0,
      now: "2026-08-01T08:00:00.000Z",
    });
    addTask(doc, {
      id: "spaced-a",
      title: " A",
      note: null,
      bucket: today,
      parentId: null,
      order: 1,
      now: "2026-08-02T08:00:00.000Z",
    });
    const before = new Map(snapshotPlan(doc).tasks.map((task) => [task.id, task]));

    const preview = buildReconcilePreview(
      doc,
      canonical("\\ A\nA"),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(false);
    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "update", taskId: "plain-a" }),
    );
    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "update", taskId: "spaced-a" }),
    );
    expect(preview.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "move", taskId: "spaced-a", index: 0 }),
        expect.objectContaining({ kind: "move", taskId: "plain-a", index: 1 }),
      ]),
    );

    apply(doc, preview);
    const after = snapshotPlan(doc).tasks;
    expect(after.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: "spaced-a", title: " A" },
      { id: "plain-a", title: "A" },
    ]);
    for (const task of after) {
      expect(task).toMatchObject({
        createdAt: before.get(task.id)?.createdAt,
        updatedAt: before.get(task.id)?.updatedAt,
      });
    }
  });

  it("keeps exact raw note identities when whitespace-colliding notes swap", () => {
    const doc = createPlanDoc();
    addTask(doc, {
      id: "one-space-note",
      title: "Same",
      note: " note ",
      bucket: today,
      parentId: null,
      order: 0,
      now: "2026-08-01T08:00:00.000Z",
    });
    addTask(doc, {
      id: "two-space-note",
      title: "Same",
      note: "  note  ",
      bucket: today,
      parentId: null,
      order: 1,
      now: "2026-08-02T08:00:00.000Z",
    });

    const preview = buildReconcilePreview(
      doc,
      canonical("Same:   note  \nSame:  note "),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(false);
    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "update", taskId: "one-space-note" }),
    );
    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "update", taskId: "two-space-note" }),
    );
    apply(doc, preview);
    expect(snapshotPlan(doc).tasks.map(({ id, note }) => ({ id, note }))).toEqual([
      { id: "two-space-note", note: "  note  " },
      { id: "one-space-note", note: " note " },
    ]);
  });

  it("uses distinct child blocks to swap identical parents as intact subtrees", () => {
    const doc = createPlanDoc();
    addTask(doc, {
      id: "parent-one",
      title: "Parent",
      note: null,
      bucket: today,
      parentId: null,
      order: 0,
      now: "2026-08-01T08:00:00.000Z",
    });
    addTask(doc, {
      id: "child-one",
      title: "Child one",
      note: " first ",
      bucket: today,
      parentId: "parent-one",
      order: 0,
      now: "2026-08-01T08:01:00.000Z",
    });
    setTaskCompleted(doc, "child-one", {
      completed: true,
      at: "2026-08-03T07:00:00.000Z",
      on: "2026-08-03",
    });
    addTask(doc, {
      id: "parent-two",
      title: "Parent",
      note: null,
      bucket: today,
      parentId: null,
      order: 1,
      now: "2026-08-02T08:00:00.000Z",
    });
    addTask(doc, {
      id: "child-two",
      title: "Child two",
      note: null,
      bucket: today,
      parentId: "parent-two",
      order: 0,
      now: "2026-08-02T08:01:00.000Z",
    });
    const before = new Map(snapshotPlan(doc).tasks.map((task) => [task.id, task]));

    const preview = buildReconcilePreview(
      doc,
      canonical("Parent\n  Child two\nParent\n  + Child one:  first "),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(false);
    expect(preview.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "move", taskId: "parent-two", index: 0 }),
        expect.objectContaining({ kind: "move", taskId: "parent-one", index: 1 }),
      ]),
    );
    expect(preview.changes.some(({ kind }) => kind === "update")).toBe(false);
    expect(preview.changes.some(({ kind }) => kind === "create")).toBe(false);
    expect(preview.changes.some(({ kind }) => kind === "remove")).toBe(false);

    apply(doc, preview);
    const after = snapshotPlan(doc).tasks;
    expect(after.map(({ id }) => id)).toEqual([
      "parent-two",
      "child-two",
      "parent-one",
      "child-one",
    ]);
    expect(after.find(({ id }) => id === "child-one")).toMatchObject({
      parentId: "parent-one",
      completedAt: "2026-08-03T07:00:00.000Z",
      completedOn: "2026-08-03",
    });
    expect(after.find(({ id }) => id === "child-two")).toMatchObject({
      parentId: "parent-two",
      completedAt: null,
      completedOn: null,
    });
    for (const task of after) {
      expect(task).toMatchObject({
        createdAt: before.get(task.id)?.createdAt,
        updatedAt: before.get(task.id)?.updatedAt,
      });
    }
  });

  it("requires confirmation when an identical parent/subtree duplicate is removed", () => {
    const doc = createPlanDoc();
    for (const suffix of ["a", "b"] as const) {
      add(doc, `parent-${suffix}`, "Parent", today, suffix === "a" ? 0 : 1);
      add(doc, `child-${suffix}`, "Child", today, 0, `parent-${suffix}`);
    }
    for (let index = 0; index < 9; index += 1) {
      add(doc, `safe-${String(index)}`, `Safe ${String(index)}`, today, index + 2);
    }
    const source = [
      "Parent",
      "  Child",
      ...Array.from({ length: 9 }, (_, index) => `Safe ${String(index)}`),
    ].join("\n");

    const preview = buildReconcilePreview(doc, canonical(source), "2026-08-03");

    expect(preview.destructive).toBe(false);
    expect(preview.requiresConfirmation).toBe(true);
  });

  it("keeps the uniquely retained open row when its completed mirror is deleted", () => {
    const doc = createPlanDoc();
    add(doc, "open-duplicate", "Duplicate", today, 0, null, "same note");
    add(doc, "completed-duplicate", "Duplicate", today, 1, null, "same note");
    setTaskCompleted(doc, "completed-duplicate", {
      completed: true,
      at: "2026-08-03T09:15:00.000Z",
      on: "2026-08-03",
    });

    const preview = buildReconcilePreview(
      doc,
      canonical("Duplicate: same note"),
      "2026-08-03",
    );

    expect(preview.changes).toContainEqual({
      kind: "remove",
      taskId: "completed-duplicate",
    });
    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "update", taskId: "open-duplicate" }),
    );

    apply(doc, preview);
    expect(snapshotPlan(doc).tasks).toMatchObject([
      {
        id: "open-duplicate",
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        completedOn: null,
      },
    ]);
  });

  it("keeps unchanged duplicate subtrees safe during an unrelated edit", () => {
    const doc = createPlanDoc();
    for (const suffix of ["a", "b"] as const) {
      add(doc, `parent-${suffix}`, "Parent", today, suffix === "a" ? 0 : 1);
      add(doc, `child-${suffix}`, "Child", today, 0, `parent-${suffix}`);
    }
    add(doc, "edited", "Old title", today, 2);

    const preview = buildReconcilePreview(
      doc,
      canonical("Parent\n  Child\nParent\n  Child\nEdited title"),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(false);
    expect(preview.changes).toEqual([
      expect.objectContaining({ kind: "update", taskId: "edited" }),
    ]);
  });

  it("includes self-completion in exact identity and preserves the completed task", () => {
    const doc = createPlanDoc();
    add(doc, "open-duplicate", "Duplicate", today, 0, null, "same note");
    add(doc, "completed-duplicate", "Duplicate", today, 1, null, "same note");
    setTaskCompleted(doc, "completed-duplicate", {
      completed: true,
      at: "2026-08-03T09:15:00.000Z",
      on: "2026-08-03",
    });

    const preview = buildReconcilePreview(
      doc,
      canonical("+ Duplicate: same note"),
      "2026-08-03",
    );

    expect(preview.changes).toContainEqual({
      kind: "remove",
      taskId: "open-duplicate",
    });
    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "update", taskId: "completed-duplicate" }),
    );

    apply(doc, preview);
    expect(snapshotPlan(doc).tasks).toMatchObject([
      {
        id: "completed-duplicate",
        completedAt: "2026-08-03T09:15:00.000Z",
        completedOn: "2026-08-03",
      },
    ]);
  });

  it("reserves unique open and completed exact matches before positional fallback", () => {
    const doc = createPlanDoc();
    add(doc, "completed", "Duplicate", today, 0);
    setTaskCompleted(doc, "completed", {
      completed: true,
      at: "2026-08-03T09:15:00.000Z",
      on: "2026-08-03",
    });
    add(doc, "open", "Duplicate", today, 1);

    const preview = buildReconcilePreview(
      doc,
      canonical("Duplicate\n+ Duplicate"),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(false);
    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "update", taskId: "completed" }),
    );
    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "update", taskId: "open" }),
    );
    apply(doc, preview);
    expect(snapshotPlan(doc).tasks).toMatchObject([
      { id: "open", completedAt: null },
      { id: "completed", completedAt: "2026-08-03T09:15:00.000Z" },
    ]);
  });

  it("requires confirmation when deleting one fully identical duplicate amid a reorder", () => {
    const doc = createPlanDoc();
    add(doc, "duplicate-a", "Duplicate", today, 0);
    add(doc, "duplicate-b", "Duplicate", today, 1);
    for (let index = 0; index < 8; index += 1) {
      add(doc, `safe-${String(index)}`, `Safe ${String(index)}`, today, index + 2);
    }
    const reorderedSafe = [
      "Duplicate",
      "Safe 1",
      "Safe 0",
      ...Array.from({ length: 6 }, (_, index) => `Safe ${String(index + 2)}`),
    ].join("\n");

    const preview = buildReconcilePreview(
      doc,
      canonical(reorderedSafe),
      "2026-08-03",
    );

    expect(preview.destructive).toBe(false);
    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.changes.filter(({ kind }) => kind === "remove")).toHaveLength(1);
  });

  it("requires confirmation when identical duplicates move around another task", () => {
    const doc = createPlanDoc();
    add(doc, "duplicate-a", "Duplicate", today, 0);
    add(doc, "anchor", "Anchor", today, 1);
    add(doc, "duplicate-b", "Duplicate", today, 2);

    const preview = buildReconcilePreview(
      doc,
      canonical("Duplicate\nDuplicate\nAnchor"),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(true);
  });

  it("does not make unchanged duplicates ambiguous during an unrelated edit", () => {
    const doc = createPlanDoc();
    add(doc, "duplicate-a", "Duplicate", today, 0);
    add(doc, "duplicate-b", "Duplicate", today, 1);
    add(doc, "edited", "Old title", today, 2);
    for (let index = 0; index < 7; index += 1) {
      add(doc, `safe-${String(index)}`, `Safe ${String(index)}`, today, index + 3);
    }
    const source = [
      "Duplicate",
      "Duplicate",
      "Edited title",
      ...Array.from({ length: 7 }, (_, index) => `Safe ${String(index)}`),
    ].join("\n");

    const preview = buildReconcilePreview(doc, canonical(source), "2026-08-03");

    expect(preview.requiresConfirmation).toBe(false);
    expect(preview.changes).toEqual([
      expect.objectContaining({ kind: "update", taskId: "edited" }),
    ]);
  });

  it("matches by exact content, position, then unique title across buckets", () => {
    const doc = createPlanDoc();
    add(doc, "exact", "Exact", today, 0, null, "note");
    add(doc, "position", "Old positional title", today, 1);
    add(doc, "moved", "Move me", { kind: "later" }, 0);
    const parsed = canonical("Exact: note\nEdited positional title\nMove me\nBrand new");
    const idFactory = vi.fn(() => "real-new-id");

    const preview = buildReconcilePreview(doc, parsed, "2026-08-03");

    expect(idFactory).not.toHaveBeenCalled();
    expect(preview).toMatchObject({
      destructive: false,
      requiresConfirmation: false,
    });
    expect(preview.changes).toContainEqual(
      expect.objectContaining({ kind: "update", taskId: "position" }),
    );
    expect(preview.changes).toContainEqual({
      kind: "move",
      taskId: "moved",
      bucket: today,
      parentId: null,
      index: 2,
    });
    expect(preview.changes).toContainEqual(
      expect.objectContaining({
        kind: "create",
        provisionalId: "new:0:3",
        bucket: today,
        parentId: null,
        index: 3,
      }),
    );

    let transactions = 0;
    doc.on("afterTransaction", () => {
      transactions += 1;
    });
    apply(doc, preview, idFactory);

    expect(transactions).toBe(1);
    expect(idFactory).toHaveBeenCalledTimes(1);
    expect(snapshotPlan(doc).tasks.map(({ id, title, bucket }) => ({ id, title, bucket })))
      .toEqual([
        { id: "exact", title: "Exact", bucket: today },
        { id: "position", title: "Edited positional title", bucket: today },
        { id: "moved", title: "Move me", bucket: today },
        { id: "real-new-id", title: "Brand new", bucket: today },
      ]);
  });

  it("uses stable provisional parent IDs and maps them only during apply", () => {
    const doc = createPlanDoc();
    add(doc, "parent", "Parent", today, 0);
    add(doc, "child", "Old child", today, 0, "parent");
    const parsed = canonical(
      "Parent\n  Edited child\nNew parent\n  ✓ is ordinary canonical text",
    );
    const preview = buildReconcilePreview(doc, parsed, "2026-08-03");

    expect(preview.changes).toContainEqual(
      expect.objectContaining({ kind: "update", taskId: "child" }),
    );
    expect(preview.changes).toContainEqual(
      expect.objectContaining({
        kind: "create",
        provisionalId: "new:0:2",
        parentId: null,
        index: 1,
      }),
    );
    expect(preview.changes).toContainEqual(
      expect.objectContaining({
        kind: "create",
        provisionalId: "new:0:3",
        parentId: "new:0:2",
        index: 0,
      }),
    );

    const ids = ["real-parent", "real-child"];
    const idFactory = vi.fn(() => ids.shift() ?? "unexpected");
    apply(doc, preview, idFactory);

    expect(idFactory).toHaveBeenCalledTimes(2);
    expect(snapshotPlan(doc).tasks).toMatchObject([
      { id: "parent", title: "Parent", parentId: null },
      { id: "child", title: "Edited child", parentId: "parent" },
      { id: "real-parent", title: "New parent", parentId: null },
      {
        id: "real-child",
        title: "✓ is ordinary canonical text",
        parentId: "real-parent",
      },
    ]);
  });

  it("reserves exact top-level matches before a front insertion fallback", () => {
    const doc = createPlanDoc();
    add(doc, "a", "A", today, 0);
    add(doc, "b", "B", today, 1);
    const preview = buildReconcilePreview(doc, canonical("X\nA\nB"), "2026-08-03");

    expect(
      preview.changes.find(
        (change) =>
          change.kind === "create" && change.provisionalId === "new:0:0",
      ),
    ).toMatchObject({ kind: "create", task: { title: "X" } });
    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "update", taskId: "a" }),
    );
    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "update", taskId: "b" }),
    );

    apply(doc, preview, vi.fn(() => "x"));
    expect(snapshotPlan(doc).tasks.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: "x", title: "X" },
      { id: "a", title: "A" },
      { id: "b", title: "B" },
    ]);
  });

  it("reserves exact child matches before a front child insertion fallback", () => {
    const doc = createPlanDoc();
    add(doc, "parent", "Parent", today, 0);
    add(doc, "child-a", "A", today, 0, "parent");
    add(doc, "child-b", "B", today, 1, "parent");
    const preview = buildReconcilePreview(
      doc,
      canonical("Parent\n  X\n  A\n  B"),
      "2026-08-03",
    );

    expect(
      preview.changes.find(
        (change) =>
          change.kind === "create" && change.provisionalId === "new:0:1",
      ),
    ).toMatchObject({
      kind: "create",
      parentId: "parent",
      task: { title: "X" },
    });
    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "update", taskId: "child-a" }),
    );
    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "update", taskId: "child-b" }),
    );

    apply(doc, preview, vi.fn(() => "child-x"));
    expect(snapshotPlan(doc).tasks.map(({ id, title, parentId }) => ({
      id,
      title,
      parentId,
    }))).toEqual([
      { id: "parent", title: "Parent", parentId: null },
      { id: "child-x", title: "X", parentId: "parent" },
      { id: "child-a", title: "A", parentId: "parent" },
      { id: "child-b", title: "B", parentId: "parent" },
    ]);
  });

  it("moves a parent block across buckets and keeps child identity", () => {
    const doc = createPlanDoc();
    add(doc, "parent", "Parent", { kind: "later" }, 0);
    add(doc, "child", "Child", { kind: "later" }, 0, "parent");
    const preview = buildReconcilePreview(
      doc,
      canonical("Parent\n  Child"),
      "2026-08-03",
    );

    expect(preview.changes).toContainEqual({
      kind: "move",
      taskId: "parent",
      bucket: today,
      parentId: null,
      index: 0,
    });
    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "move", taskId: "child" }),
    );

    apply(doc, preview);
    expect(snapshotPlan(doc).tasks).toMatchObject([
      { id: "parent", bucket: today },
      { id: "child", parentId: "parent", bucket: today },
    ]);
  });

  it("reorders ordinary children without replacing their IDs", () => {
    const doc = createPlanDoc();
    add(doc, "parent", "Parent", today, 0);
    add(doc, "child-a", "A", today, 0, "parent");
    add(doc, "child-b", "B", today, 1, "parent");
    const preview = buildReconcilePreview(
      doc,
      canonical("Parent\n  B\n  A"),
      "2026-08-03",
    );

    apply(doc, preview);
    expect(snapshotPlan(doc).tasks.map(({ id }) => id)).toEqual([
      "parent",
      "child-b",
      "child-a",
    ]);
  });

  it("reorders and inserts active children without mutating hidden History task data", () => {
    const doc = createPlanDoc();
    add(doc, "parent", "Parent", today, 0);
    add(doc, "child-a", "A", today, 0, "parent");
    add(doc, "hidden-child", "Hidden", today, 1, "parent");
    setTaskCompleted(doc, "hidden-child", {
      completed: true,
      at: "2026-08-01T09:00:00.000Z",
      on: "2026-08-01",
    });
    add(doc, "child-b", "B", today, 2, "parent");
    const hiddenBefore = snapshotPlan(doc).tasks.find(
      ({ id }) => id === "hidden-child",
    );
    const hiddenMap = doc
      .getMap<Y.Map<unknown>>("tasks")
      .get("hidden-child");
    if (hiddenMap === undefined) {
      throw new Error("missing_hidden_task_map");
    }
    let hiddenEvents = 0;
    hiddenMap.observeDeep(() => {
      hiddenEvents += 1;
    });

    const preview = buildReconcilePreview(
      doc,
      canonical("Parent\n  B\n  Inserted\n  A"),
      "2026-08-03",
    );
    apply(doc, preview, vi.fn(() => "inserted"));

    expect(hiddenEvents).toBe(0);
    expect(
      snapshotPlan(doc).tasks.find(({ id }) => id === "hidden-child"),
    ).toEqual(hiddenBefore);
    expect(
      projectPlan(snapshotPlan(doc).tasks, "2026-08-03").active
        .flatMap(({ tasks }) => tasks)
        .filter(({ parentId }) => parentId === "parent")
        .map(({ id }) => id),
    ).toEqual(["child-b", "inserted", "child-a"]);
  });

  it("uses move now for every child during a cross-bucket parent move and reorder", () => {
    const later = { kind: "later" } as const;
    const doc = createPlanDoc();
    addTask(doc, {
      id: "parent",
      title: "Parent",
      note: null,
      bucket: later,
      parentId: null,
      order: 0,
      now: "2026-08-01T08:00:00.000Z",
    });
    addTask(doc, {
      id: "child-a",
      title: "A",
      note: null,
      bucket: later,
      parentId: "parent",
      order: 0,
      now: "2026-08-01T08:01:00.000Z",
    });
    addTask(doc, {
      id: "hidden-child",
      title: "Hidden",
      note: null,
      bucket: later,
      parentId: "parent",
      order: 1,
      now: "2026-08-01T08:02:00.000Z",
    });
    setTaskCompleted(doc, "hidden-child", {
      completed: true,
      at: "2026-08-01T09:00:00.000Z",
      on: "2026-08-01",
    });
    addTask(doc, {
      id: "child-b",
      title: "B",
      note: null,
      bucket: later,
      parentId: "parent",
      order: 2,
      now: "2026-08-01T08:03:00.000Z",
    });
    const hiddenBefore = snapshotPlan(doc).tasks.find(
      ({ id }) => id === "hidden-child",
    );
    const hiddenMap = doc
      .getMap<Y.Map<unknown>>("tasks")
      .get("hidden-child");
    if (hiddenMap === undefined || hiddenBefore === undefined) {
      throw new Error("missing_hidden_task");
    }
    const hiddenChangedKeys = new Set<string>();
    hiddenMap.observe((event) => {
      for (const key of event.keysChanged) {
        if (typeof key === "string") {
          hiddenChangedKeys.add(key);
        }
      }
    });

    const preview = buildReconcilePreview(
      doc,
      canonical("Parent\n  B\n  A"),
      "2026-08-03",
    );
    apply(doc, preview);

    const tasks = snapshotPlan(doc).tasks;
    const children = tasks.filter(({ parentId }) => parentId === "parent");
    expect(children.map(({ id, updatedAt }) => ({ id, updatedAt }))).toEqual([
      { id: "child-b", updatedAt: now },
      { id: "hidden-child", updatedAt: now },
      { id: "child-a", updatedAt: now },
    ]);
    expect(tasks.find(({ id }) => id === "hidden-child")).toEqual({
      ...hiddenBefore,
      bucket: today,
      updatedAt: now,
    });
    expect([...hiddenChangedKeys].sort()).toEqual(["bucket", "updatedAt"]);
    expect(
      projectPlan(tasks, "2026-08-03").active
        .flatMap(({ tasks: active }) => active)
        .filter(({ parentId }) => parentId === "parent")
        .map(({ id }) => id),
    ).toEqual(["child-b", "child-a"]);
  });

  it("preserves prior child timestamps for a same-container reorder", () => {
    const doc = createPlanDoc();
    add(doc, "parent", "Parent", today, 0);
    addTask(doc, {
      id: "child-a",
      title: "A",
      note: null,
      bucket: today,
      parentId: "parent",
      order: 0,
      now: "2026-08-01T08:01:00.000Z",
    });
    addTask(doc, {
      id: "child-b",
      title: "B",
      note: null,
      bucket: today,
      parentId: "parent",
      order: 1,
      now: "2026-08-02T08:01:00.000Z",
    });

    apply(
      doc,
      buildReconcilePreview(doc, canonical("Parent\n  B\n  A"), "2026-08-03"),
    );

    expect(snapshotPlan(doc).tasks).toMatchObject([
      { id: "parent" },
      { id: "child-b", updatedAt: "2026-08-02T08:01:00.000Z" },
      { id: "child-a", updatedAt: "2026-08-01T08:01:00.000Z" },
    ]);
  });

  it("reorders overdue children using their parent's stored bucket", () => {
    const overdue = { kind: "date", date: "2026-08-01" } as const;
    const doc = createPlanDoc();
    add(doc, "parent", "Parent", overdue, 0);
    add(doc, "child-a", "A", overdue, 0, "parent");
    add(doc, "child-b", "B", overdue, 1, "parent");
    const preview = buildReconcilePreview(
      doc,
      canonical("Parent\n  B\n  A"),
      "2026-08-03",
    );

    expect(preview.changes).toContainEqual({
      kind: "move",
      taskId: "child-b",
      bucket: overdue,
      parentId: "parent",
      index: 0,
    });
    expect(preview.changes).toContainEqual({
      kind: "move",
      taskId: "child-a",
      bucket: overdue,
      parentId: "parent",
      index: 1,
    });

    apply(doc, preview);
    expect(snapshotPlan(doc).tasks).toMatchObject([
      { id: "parent", bucket: overdue },
      { id: "child-b", parentId: "parent", bucket: overdue },
      { id: "child-a", parentId: "parent", bucket: overdue },
    ]);
  });

  it("auto-applies two of ten removals and confirms three or 25 percent", () => {
    const doc = createPlanDoc();
    for (let index = 0; index < 10; index += 1) {
      add(doc, `task-${String(index)}`, `Task ${String(index)}`, today, index);
    }

    const twoRemoved = buildReconcilePreview(
      doc,
      canonical(
        Array.from({ length: 8 }, (_, index) => `Task ${String(index)}`).join("\n"),
      ),
      "2026-08-03",
    );
    expect(twoRemoved.changes.filter(({ kind }) => kind === "remove")).toHaveLength(2);
    expect(twoRemoved).toMatchObject({ destructive: false, requiresConfirmation: false });

    const threeRemoved = buildReconcilePreview(
      doc,
      canonical(
        Array.from({ length: 7 }, (_, index) => `Task ${String(index)}`).join("\n"),
      ),
      "2026-08-03",
    );
    expect(threeRemoved.changes.filter(({ kind }) => kind === "remove")).toHaveLength(3);
    expect(threeRemoved).toMatchObject({ destructive: true, requiresConfirmation: true });

    const eightTaskDoc = createPlanDoc();
    for (let index = 0; index < 8; index += 1) {
      add(eightTaskDoc, `eight-${String(index)}`, `Eight ${String(index)}`, today, index);
    }
    const quarterRemoved = buildReconcilePreview(
      eightTaskDoc,
      canonical(
        Array.from({ length: 6 }, (_, index) => `Eight ${String(index)}`).join("\n"),
      ),
      "2026-08-03",
    );
    expect(quarterRemoved).toMatchObject({ destructive: true, requiresConfirmation: true });
  });

  it("requires confirmation when repeated cross-bucket titles are ambiguous", () => {
    const doc = createPlanDoc();
    for (let index = 0; index < 8; index += 1) {
      add(doc, `safe-${String(index)}`, `Safe ${String(index)}`, today, index);
    }
    add(doc, "repeat-later", "Repeated", { kind: "later" }, 0);
    add(doc, "repeat-much-later", "Repeated", { kind: "much-later" }, 0);
    const todayLines = Array.from(
      { length: 8 },
      (_, index) => `Safe ${String(index)}`,
    ).join("\n");
    const parsed = canonical(
      todayLines,
      "\n\nЗавтра — вт, 4 августа\nRepeated",
    );

    const preview = buildReconcilePreview(doc, parsed, "2026-08-03");

    expect(preview.destructive).toBe(false);
    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.changes).toContainEqual(
      expect.objectContaining({ kind: "create", provisionalId: "new:1:0" }),
    );
  });

  it("requires confirmation for one raw subtree competing across destination buckets", () => {
    const doc = createPlanDoc();
    add(doc, "stored", "Repeated", { kind: "later" }, 0);

    const preview = buildReconcilePreview(
      doc,
      canonical(
        "Repeated",
        "\n\nЗавтра — вт, 4 августа\nRepeated",
      ),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(true);
  });

  it("requires confirmation for one normalized subtree competing across destination buckets", () => {
    const doc = createPlanDoc();
    add(doc, "stored", " Repeated", { kind: "later" }, 0);

    const preview = buildReconcilePreview(
      doc,
      canonical(
        "Repeated",
        "\n\nЗавтра — вт, 4 августа\nRepeated",
      ),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(true);
  });

  it("requires normalized-title confirmation for one stored block requested twice with different data", () => {
    const doc = createPlanDoc();
    add(doc, "stored-parent", "Repeated", { kind: "later" }, 0, null, "stored note");
    add(
      doc,
      "stored-child",
      "Stored child",
      { kind: "later" },
      0,
      "stored-parent",
    );

    const preview = buildReconcilePreview(
      doc,
      canonical(
        "Repeated: today note\n  Today child",
        "\n\nЗавтра — вт, 4 августа\nRepeated: tomorrow note\n  Tomorrow child",
      ),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(true);
  });

  it("requires normalized-title confirmation for two stored blocks competing for different desired data", () => {
    const doc = createPlanDoc();
    add(doc, "later-parent", "Repeated", { kind: "later" }, 0, null, "later note");
    add(
      doc,
      "later-child",
      "Later child",
      { kind: "later" },
      0,
      "later-parent",
    );
    add(
      doc,
      "much-later-parent",
      "Repeated",
      { kind: "much-later" },
      0,
      null,
      "much later note",
    );
    add(
      doc,
      "much-later-child",
      "Much later child",
      { kind: "much-later" },
      0,
      "much-later-parent",
    );

    const preview = buildReconcilePreview(
      doc,
      canonical("Repeated: desired note\n  Desired child"),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(true);
  });

  it("requires confirmation when an ineligible same-bucket row pads a real cross-bucket competition", () => {
    const doc = createPlanDoc();
    for (let index = 0; index < 5; index += 1) {
      add(doc, `safe-${String(index)}`, `Safe ${String(index)}`, today, index);
    }
    add(doc, "same-bucket", "Repeated", today, 5, null, "same-bucket note");
    add(doc, "ordinary-removal", "Ordinary removal", today, 6);
    add(doc, "eligible", "Repeated", { kind: "later" }, 0, null, "eligible note");
    const safeRows = Array.from(
      { length: 5 },
      (_, index) => `Safe ${String(index)}`,
    ).join("\n");

    const preview = buildReconcilePreview(
      doc,
      canonical(
        `Repeated: today desired\n${safeRows}`,
        "\n\nЗавтра — вт, 4 августа\nRepeated: tomorrow desired",
      ),
      "2026-08-03",
    );

    expect(preview.destructive).toBe(false);
    expect(preview.requiresConfirmation).toBe(true);
  });

  it("does not confirm normalized-title leftovers with no eligible cross-bucket edge", () => {
    const doc = createPlanDoc();
    for (let index = 0; index < 8; index += 1) {
      add(doc, `safe-${String(index)}`, `Safe ${String(index)}`, today, index);
    }
    add(doc, "same-bucket-a", "Repeated", today, 8, null, "first stored note");
    add(doc, "same-bucket-b", "Repeated", today, 9, null, "second stored note");
    const safeRows = Array.from(
      { length: 8 },
      (_, index) => `Safe ${String(index)}`,
    ).join("\n");

    const preview = buildReconcilePreview(
      doc,
      canonical(`Repeated: desired note\n${safeRows}`),
      "2026-08-03",
    );

    expect(preview.destructive).toBe(false);
    expect(preview.requiresConfirmation).toBe(false);
  });

  it("does not confirm a unique one-to-one normalized-title cross-bucket edge", () => {
    const doc = createPlanDoc();
    add(doc, "stored", "Repeated", { kind: "later" }, 0, null, "stored note");

    const preview = buildReconcilePreview(
      doc,
      canonical("Repeated: desired note"),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(false);
    expect(preview.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "update", taskId: "stored" }),
        expect.objectContaining({ kind: "move", taskId: "stored" }),
      ]),
    );
  });

  it("requires confirmation for raw subtrees in multiple buckets competing for one row", () => {
    const doc = createPlanDoc();
    add(doc, "stored-later", "Repeated", { kind: "later" }, 0);
    add(doc, "stored-much-later", "Repeated", { kind: "much-later" }, 0);

    const preview = buildReconcilePreview(
      doc,
      canonical("Repeated"),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(true);
  });

  it("requires confirmation for normalized subtrees in multiple buckets competing for one row", () => {
    const doc = createPlanDoc();
    add(doc, "stored-later", " Repeated", { kind: "later" }, 0);
    add(doc, "stored-much-later", "Repeated ", { kind: "much-later" }, 0);

    const preview = buildReconcilePreview(
      doc,
      canonical("Repeated"),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(true);
  });

  it("keeps an overdue stored date while applying a Today text edit", () => {
    const doc = createPlanDoc();
    add(doc, "overdue", "Old title", { kind: "date", date: "2026-08-01" });
    const parsed = canonical("Edited overdue title");

    const preview = buildReconcilePreview(doc, parsed, "2026-08-03");

    expect(preview.changes).toContainEqual(
      expect.objectContaining({ kind: "update", taskId: "overdue" }),
    );
    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "move", taskId: "overdue" }),
    );
    apply(doc, preview);
    expect(snapshotPlan(doc).tasks[0]).toMatchObject({
      id: "overdue",
      title: "Edited overdue title",
      bucket: { kind: "date", date: "2026-08-01" },
    });
  });

  it("does not reconcile projected history as removals", () => {
    const doc = createPlanDoc();
    add(doc, "history", "Completed before today", {
      kind: "date",
      date: "2026-08-01",
    });
    setTaskCompleted(doc, "history", {
      completed: true,
      at: "2026-08-01T12:00:00.000Z",
      on: "2026-08-01",
    });

    const preview = buildReconcilePreview(doc, canonical(""), "2026-08-03");

    expect(preview.changes).toEqual([]);
    expect(snapshotPlan(doc).tasks).toHaveLength(1);
  });

  it("requires explicit confirmation for a hidden History child cascade", () => {
    const doc = createPlanDoc();
    add(doc, "target-parent", "Target parent", today, 0);
    add(
      doc,
      "hidden-child",
      "Hidden completed child",
      today,
      0,
      "target-parent",
    );
    setTaskCompleted(doc, "hidden-child", {
      completed: true,
      at: "2026-08-01T09:00:00.000Z",
      on: "2026-08-01",
    });
    for (let index = 0; index < 9; index += 1) {
      add(doc, `safe-parent-${String(index)}`, `Safe parent ${String(index)}`, today, index + 1);
    }
    const source = Array.from(
      { length: 9 },
      (_, index) => `Safe parent ${String(index)}`,
    ).join("\n");

    const preview = buildReconcilePreview(doc, canonical(source), "2026-08-03");

    expect(preview.destructive).toBe(true);
    expect(preview.requiresConfirmation).toBe(true);
    const removals = preview.changes.filter(({ kind }) => kind === "remove");
    expect(removals).toHaveLength(2);
    expect(removals).toContainEqual({ kind: "remove", taskId: "target-parent" });
    const hiddenRemoval = removals.find(
      ({ taskId }) => taskId === "hidden-child",
    );
    expect(hiddenRemoval).toMatchObject({ kind: "remove", taskId: "hidden-child" });
    if (hiddenRemoval?.kind !== "remove") {
      throw new Error("missing_hidden_cascade_removal");
    }
    expect(hiddenRemoval.hiddenCascade).toMatchObject({
      parentId: "target-parent",
      title: "Hidden completed child",
    });

    const before = Y.encodeStateAsUpdate(doc);
    expect(() => {
      applyReconcilePreview(doc, preview, {
        now,
        completedOn: "2026-08-03",
        idFactory: vi.fn(() => "unused"),
      });
    }).toThrow("reconcile_risky_changes_require_confirmation");
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);

    const affectedIds = preview.changes
      .filter((change) => change.kind === "remove")
      .map(({ taskId }) => taskId)
      .sort();
    const beforeIds = snapshotPlan(doc).tasks.map(({ id }) => id);
    let transactions = 0;
    doc.on("afterTransaction", () => {
      transactions += 1;
    });
    applyReconcilePreview(doc, preview, {
      now,
      completedOn: "2026-08-03",
      confirmRisky: true,
      idFactory: vi.fn(() => "unused"),
    });

    const afterIds = snapshotPlan(doc).tasks.map(({ id }) => id);
    expect(beforeIds.filter((id) => !afterIds.includes(id)).sort()).toEqual(
      affectedIds,
    );
    expect(afterIds).toEqual(
      Array.from({ length: 9 }, (_, index) => `safe-parent-${String(index)}`),
    );
    expect(transactions).toBe(1);
  });

  it("keeps a hidden History child attached during a parent edit and move", () => {
    const doc = createPlanDoc();
    add(doc, "anchor", "Anchor", today, 0);
    add(doc, "target-parent", "Target parent", today, 1);
    add(doc, "hidden-child", "Hidden child", today, 0, "target-parent");
    setTaskCompleted(doc, "hidden-child", {
      completed: true,
      at: "2026-08-01T09:00:00.000Z",
      on: "2026-08-01",
    });

    const preview = buildReconcilePreview(
      doc,
      canonical("Edited target parent\nAnchor"),
      "2026-08-03",
    );

    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "remove", taskId: "hidden-child" }),
    );
    apply(doc, preview);
    expect(snapshotPlan(doc).tasks).toMatchObject([
      { id: "target-parent", title: "Edited target parent", parentId: null },
      {
        id: "hidden-child",
        title: "Hidden child",
        parentId: "target-parent",
        completedAt: "2026-08-01T09:00:00.000Z",
        completedOn: "2026-08-01",
      },
      { id: "anchor" },
    ]);
  });

  it("rejects a stale preview when a removed parent gains an unreported child", () => {
    const doc = createPlanDoc();
    add(doc, "target-parent", "Target parent", today, 0);
    add(doc, "hidden-child", "Hidden child", today, 0, "target-parent");
    setTaskCompleted(doc, "hidden-child", {
      completed: true,
      at: "2026-08-01T09:00:00.000Z",
      on: "2026-08-01",
    });
    for (let index = 0; index < 9; index += 1) {
      add(doc, `safe-${String(index)}`, `Safe ${String(index)}`, today, index + 1);
    }
    const preview = buildReconcilePreview(
      doc,
      canonical(
        Array.from({ length: 9 }, (_, index) => `Safe ${String(index)}`).join(
          "\n",
        ),
      ),
      "2026-08-03",
    );
    add(doc, "late-child", "Late child", today, 1, "target-parent");
    const before = Y.encodeStateAsUpdate(doc);

    expect(() => {
      applyReconcilePreview(doc, preview, {
        now,
        completedOn: "2026-08-03",
        confirmRisky: true,
        idFactory: vi.fn(() => "unused"),
      });
    }).toThrow("reconcile_unreported_cascade:late-child");
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it.each([
    {
      label: "the hidden child is reopened",
      mutate: (doc: ReturnType<typeof createPlanDoc>) => {
        setTaskCompleted(doc, "hidden-child", {
          completed: false,
          at: "2026-08-03T13:00:00.000Z",
          on: "2026-08-03",
        });
      },
    },
    {
      label: "the hidden child title changes",
      mutate: (doc: ReturnType<typeof createPlanDoc>) => {
        editTask(doc, "hidden-child", { title: "Renamed child" });
      },
    },
    {
      label: "the hidden child changes parent",
      mutate: (doc: ReturnType<typeof createPlanDoc>) => {
        promoteSubtask(doc, "hidden-child", {
          bucket: today,
          parentId: null,
          index: 0,
          now: "2026-08-03T13:00:00.000Z",
        });
      },
    },
    {
      label: "the parent reopens and reveals its stored children",
      mutate: (doc: ReturnType<typeof createPlanDoc>) => {
        setTaskCompleted(doc, "target-parent", {
          completed: true,
          at: "2026-08-01T10:00:00.000Z",
          on: "2026-08-01",
        });
        setTaskCompleted(doc, "target-parent", {
          completed: false,
          at: "2026-08-03T13:00:00.000Z",
          on: "2026-08-03",
        });
      },
    },
  ])("rejects a stale annotated cascade when $label", ({ mutate }) => {
    const doc = createPlanDoc();
    add(doc, "target-parent", "Target parent", today, 0);
    add(doc, "hidden-child", "Hidden child", today, 0, "target-parent");
    setTaskCompleted(doc, "hidden-child", {
      completed: true,
      at: "2026-08-01T09:00:00.000Z",
      on: "2026-08-01",
    });
    for (let index = 0; index < 9; index += 1) {
      add(doc, `safe-${String(index)}`, `Safe ${String(index)}`, today, index + 1);
    }
    const preview = buildReconcilePreview(
      doc,
      canonical(
        Array.from({ length: 9 }, (_, index) => `Safe ${String(index)}`).join(
          "\n",
        ),
      ),
      "2026-08-03",
    );
    mutate(doc);
    const before = Y.encodeStateAsUpdate(doc);

    expect(() => {
      applyReconcilePreview(doc, preview, {
        now,
        completedOn: "2026-08-03",
        confirmRisky: true,
        idFactory: vi.fn(() => "unused"),
      });
    }).toThrow("reconcile_stale_cascade:hidden-child");
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it("writes parsed self-completion rather than effective parent completion", () => {
    const doc = createPlanDoc();
    add(doc, "parent", "Parent", today, 0);
    add(doc, "child", "Child", today, 0, "parent");
    apply(
      doc,
      buildReconcilePreview(doc, canonical("+ Parent\n  Child"), "2026-08-03"),
    );
    expect(snapshotPlan(doc).tasks).toMatchObject([
      { id: "parent", completedAt: now },
      { id: "child", completedAt: null },
    ]);

    apply(
      doc,
      buildReconcilePreview(doc, canonical("+ Parent\n  + Child"), "2026-08-03"),
    );
    expect(snapshotPlan(doc).tasks[1]).toMatchObject({
      id: "child",
      completedAt: now,
      completedOn: "2026-08-03",
    });

    apply(
      doc,
      buildReconcilePreview(doc, canonical("+ Parent\n  Child"), "2026-08-03"),
    );
    expect(snapshotPlan(doc).tasks[1]).toMatchObject({
      id: "child",
      completedAt: null,
      completedOn: null,
    });
  });

  it("removes children before parents and still applies the preview once", () => {
    const doc = createPlanDoc();
    add(doc, "removed-parent", "Removed parent", today, 0);
    add(doc, "removed-child", "Removed child", today, 0, "removed-parent");
    for (let index = 0; index < 4; index += 1) {
      add(doc, `kept-${String(index)}`, `Kept ${String(index)}`, today, index + 1);
    }
    const parsed = canonical(
      Array.from({ length: 4 }, (_, index) => `Kept ${String(index)}`).join("\n"),
    );
    const preview = buildReconcilePreview(doc, parsed, "2026-08-03");
    let transactions = 0;
    doc.on("afterTransaction", () => {
      transactions += 1;
    });

    apply(doc, preview);

    expect(transactions).toBe(1);
    expect(snapshotPlan(doc).tasks.map(({ id }) => id)).toEqual([
      "kept-0",
      "kept-1",
      "kept-2",
      "kept-3",
    ]);
  });

  it("requires explicit confirmation before applying error diagnostics", () => {
    const doc = createPlanDoc();
    const parsed = canonical("Parent\n Invalid indentation");
    const preview = buildReconcilePreview(doc, parsed, "2026-08-03");

    expect(preview.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid_indentation", severity: "error" }),
    );
    expect(preview.requiresConfirmation).toBe(true);
    expect(() => {
      apply(doc, preview);
    }).toThrow("reconcile_diagnostics_require_confirmation");
    expect(snapshotPlan(doc).tasks).toEqual([]);

    apply(doc, preview, vi.fn(() => "confirmed"), true);
    expect(snapshotPlan(doc).tasks).toMatchObject([{ id: "confirmed", title: "Parent" }]);
  });

  it("preflights a stale update after removals without mutating the real document", () => {
    const doc = createPlanDoc();
    for (let index = 0; index < 10; index += 1) {
      add(doc, `stale-${String(index)}`, `Stale ${String(index)}`, today, index);
    }
    const preview = buildReconcilePreview(
      doc,
      canonical(
        [
          "Edited stale zero",
          ...Array.from({ length: 6 }, (_, index) => `Stale ${String(index + 1)}`),
        ].join("\n"),
      ),
      "2026-08-03",
    );
    removeTask(doc, "stale-0");
    const before = Y.encodeStateAsUpdate(doc);

    expect(() => {
      apply(doc, preview);
    }).toThrow("task_not_found");
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it("preflights duplicate concrete create IDs after removals", () => {
    const doc = createPlanDoc();
    for (let index = 0; index < 5; index += 1) {
      add(doc, `kept-${String(index)}`, `Kept ${String(index)}`, today, index);
    }
    const preview = buildReconcilePreview(
      doc,
      canonical(
        "Kept 0\nKept 1\nKept 2",
        "\n\nЗавтра — вт, 4 августа\nCreated tomorrow",
      ),
      "2026-08-03",
    );
    const before = Y.encodeStateAsUpdate(doc);
    const idFactory = vi.fn(() => "kept-0");

    expect(() => {
      apply(doc, preview, idFactory);
    }).toThrow("duplicate_task");
    expect(idFactory).toHaveBeenCalledOnce();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it("materializes all create IDs before preflight and leaves real state intact on failure", () => {
    const doc = createPlanDoc();
    for (let index = 0; index < 4; index += 1) {
      add(doc, `existing-${String(index)}`, `Existing ${String(index)}`, today, index);
    }
    const preview = buildReconcilePreview(
      doc,
      canonical(
        "Existing 0\nExisting 1\nExisting 2",
        "\n\nЗавтра — вт, 4 августа\nParent\n  Child",
      ),
      "2026-08-03",
    );
    const before = Y.encodeStateAsUpdate(doc);
    const idFactory = vi
      .fn<() => string>()
      .mockReturnValueOnce("new-parent")
      .mockImplementationOnce(() => {
        throw new Error("entropy unavailable");
      });

    expect(() => {
      apply(doc, preview, idFactory);
    }).toThrow("entropy unavailable");
    expect(idFactory).toHaveBeenCalledTimes(2);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });
});
