import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  addTask,
  applyReconcilePreview,
  buildReconcilePreview,
  createPlanDoc,
  editTask,
  moveTask,
  parsePlanText,
  setTaskCompleted,
  snapshotPlan,
  type ReconcilePreview,
} from "../../src/index";

const today = { kind: "date", date: "2026-08-03" } as const;
const later = { kind: "later" } as const;
const previewNow = "2026-08-03T12:00:00.000Z";

function add(
  doc: Y.Doc,
  id: string,
  title: string,
  order: number,
  bucket = today,
  parentId: string | null = null,
): void {
  addTask(doc, {
    id,
    title,
    note: null,
    bucket,
    parentId,
    order,
    now: "2026-08-03T08:00:00.000Z",
  });
}

function canonical(lines: string, laterLines = "") {
  return parsePlanText(
    `Сегодня — пн, 3 августа\n${lines}${
      laterLines.length === 0 ? "" : `\n\n--------\nПозже\n${laterLines}`
    }`,
    "2026-08-03",
  );
}

function apply(
  doc: Y.Doc,
  preview: ReconcilePreview,
  idFactory = vi.fn(() => "created"),
): void {
  applyReconcilePreview(doc, preview, {
    completedOn: "2026-08-03",
    confirmRisky: true,
    idFactory,
    now: previewNow,
  });
}

function expectTypedStaleWithoutMutation(
  doc: Y.Doc,
  preview: ReconcilePreview,
  idFactory = vi.fn(() => "created"),
): void {
  const before = Y.encodeStateAsUpdate(doc);
  let thrown: unknown;
  try {
    apply(doc, preview, idFactory);
  } catch (reason: unknown) {
    thrown = reason;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect(thrown).toMatchObject({ name: "StaleReconcilePreviewError" });
  expect((thrown as Error).message).toMatch(/^reconcile_stale_preview:/u);
  expect(idFactory).not.toHaveBeenCalled();
  expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
}

describe("touched-state reconcile preview validation", () => {
  it.each([
    {
      label: "title",
      mutate: (doc: Y.Doc) => {
        editTask(doc, "target", { title: "Newer title" });
      },
    },
    {
      label: "note",
      mutate: (doc: Y.Doc) => {
        editTask(doc, "target", { note: "newer note" });
      },
    },
    {
      label: "completion",
      mutate: (doc: Y.Doc) => {
        setTaskCompleted(doc, "target", {
          completed: true,
          at: "2026-08-03T13:00:00.000Z",
          on: "2026-08-03",
        });
      },
    },
    {
      label: "move",
      mutate: (doc: Y.Doc) => {
        moveTask(doc, "target", {
          bucket: later,
          parentId: null,
          index: 0,
          now: "2026-08-03T13:00:00.000Z",
        });
      },
    },
  ])("rejects a newer touched-task $label edit", ({ mutate }) => {
    const doc = createPlanDoc();
    add(doc, "target", "Target", 0);
    add(doc, "sibling", "Sibling", 1);
    const preview = buildReconcilePreview(
      doc,
      canonical("Edited target\nSibling"),
      "2026-08-03",
    );
    mutate(doc);

    expectTypedStaleWithoutMutation(doc, preview);
  });

  it("rejects a sibling-order/container change before applying a reorder", () => {
    const doc = createPlanDoc();
    add(doc, "first", "First", 0);
    add(doc, "second", "Second", 1);
    const preview = buildReconcilePreview(
      doc,
      canonical("Second\nFirst"),
      "2026-08-03",
    );
    moveTask(doc, "second", {
      bucket: later,
      parentId: null,
      index: 0,
      now: "2026-08-03T13:00:00.000Z",
    });

    expectTypedStaleWithoutMutation(doc, preview);
  });

  it("rejects a stale promotion and allocates no IDs", () => {
    const doc = createPlanDoc();
    add(doc, "parent", "Parent", 0);
    add(doc, "child", "Child", 0, today, "parent");
    const preview = buildReconcilePreview(
      doc,
      canonical("Parent\nChild\nCreated"),
      "2026-08-03",
    );
    editTask(doc, "child", { note: "newer" });
    const idFactory = vi.fn(() => "created");

    expectTypedStaleWithoutMutation(doc, preview, idFactory);
  });

  it("rejects a stale parent cascade using the same typed error", () => {
    const doc = createPlanDoc();
    add(doc, "parent", "Parent", 0);
    add(doc, "child", "Child", 0, today, "parent");
    for (let index = 0; index < 9; index += 1) {
      add(doc, `safe-${String(index)}`, `Safe ${String(index)}`, index + 1);
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
    editTask(doc, "child", { title: "Newer child" });

    expectTypedStaleWithoutMutation(doc, preview);
  });

  it("validates before concrete create ID allocation and any transaction", () => {
    const doc = createPlanDoc();
    add(doc, "target", "Target", 0);
    const preview = buildReconcilePreview(
      doc,
      canonical("Edited target\nCreated"),
      "2026-08-03",
    );
    editTask(doc, "target", { title: "Newer title" });
    const idFactory = vi.fn(() => "created");
    let transactions = 0;
    doc.on("afterTransaction", () => {
      transactions += 1;
    });

    expectTypedStaleWithoutMutation(doc, preview, idFactory);
    expect(transactions).toBe(0);
  });

  it("allows an unrelated concurrent addition in an unrelated container", () => {
    const doc = createPlanDoc();
    add(doc, "target", "Target", 0);
    const preview = buildReconcilePreview(
      doc,
      canonical("Edited target"),
      "2026-08-03",
    );
    add(doc, "unrelated", "Unrelated", 0, later);

    apply(doc, preview);

    expect(snapshotPlan(doc).tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "target", title: "Edited target" }),
        expect.objectContaining({ id: "unrelated", title: "Unrelated" }),
      ]),
    );
  });

  it.each([
    ["stored ID", (map: Y.Map<unknown>) => map.set("id", "different-id")],
    ["malformed prune marker", (map: Y.Map<unknown>) => map.set("prunedOn", "bad-date")],
  ])("rejects a touched task with a raw-only %s change", (_label, mutate) => {
    const doc = createPlanDoc();
    add(doc, "target", "Target", 0);
    const preview = buildReconcilePreview(
      doc,
      canonical("Edited target"),
      "2026-08-03",
    );
    const map = doc.getMap<Y.Map<unknown>>("tasks").get("target");
    if (map === undefined) {
      throw new Error("missing_target_map");
    }
    mutate(map);

    expectTypedStaleWithoutMutation(doc, preview);
  });
});
