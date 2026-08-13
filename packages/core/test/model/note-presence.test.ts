import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  addTask,
  applyReconcilePreview,
  buildReconcilePreview,
  createPlanDoc,
  editTask,
  parsePlanText,
  projectPlan,
  serializePlan,
  snapshotPlan,
} from "../../src/index";

const today = { kind: "date", date: "2026-08-03" } as const;
const now = "2026-08-03T12:00:00.000Z";

function add(doc: Y.Doc, id: string, note: string | null, order: number): void {
  addTask(doc, {
    id,
    title: "Same",
    note,
    bucket: today,
    parentId: null,
    order,
    now,
  });
}

describe("persisted note presence", () => {
  it("preserves null, empty, and non-empty notes through edit and Yjs reload", () => {
    const doc = createPlanDoc();
    add(doc, "absent", null, 0);
    add(doc, "empty", "", 1);
    add(doc, "present", "note", 2);

    expect(snapshotPlan(doc).tasks.map(({ id, note }) => ({ id, note }))).toEqual([
      { id: "absent", note: null },
      { id: "empty", note: "" },
      { id: "present", note: "note" },
    ]);
    expect(
      doc.getMap<Y.Map<unknown>>("tasks").get("absent")?.get("notePresent"),
    ).toBe(false);
    expect(
      doc.getMap<Y.Map<unknown>>("tasks").get("empty")?.get("notePresent"),
    ).toBe(true);

    editTask(doc, "absent", { note: "" });
    editTask(doc, "empty", { note: null });
    editTask(doc, "present", { note: "" });

    const reloaded = createPlanDoc();
    Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(doc));
    expect(snapshotPlan(reloaded).tasks.map(({ id, note }) => ({ id, note }))).toEqual([
      { id: "absent", note: "" },
      { id: "empty", note: null },
      { id: "present", note: "" },
    ]);
  });

  it("reads legacy maps without the scalar without rewriting their note text", () => {
    const doc = createPlanDoc();
    add(doc, "legacy-absent", null, 0);
    add(doc, "legacy-present", "keep me", 1);
    const tasks = doc.getMap<Y.Map<unknown>>("tasks");
    tasks.get("legacy-absent")?.delete("notePresent");
    tasks.get("legacy-present")?.delete("notePresent");
    const beforeText = (tasks.get("legacy-present")?.get("note") as Y.Text).toJSON();

    expect(snapshotPlan(doc).tasks.map(({ id, note }) => ({ id, note }))).toEqual([
      { id: "legacy-absent", note: null },
      { id: "legacy-present", note: "keep me" },
    ]);
    expect((tasks.get("legacy-present")?.get("note") as Y.Text).toJSON()).toBe(
      beforeText,
    );
    expect(tasks.get("legacy-present")?.has("notePresent")).toBe(false);
  });

  it("parses and serializes an empty delimiter distinctly from no delimiter", () => {
    const parsed = parsePlanText(
      "Сегодня — пн, 3 августа\nAbsent\nEmpty: \nPresent: note",
      "2026-08-03",
    );

    expect(parsed.sections[0]?.tasks.map(({ title, note }) => ({ title, note }))).toEqual([
      { title: "Absent", note: null },
      { title: "Empty", note: "" },
      { title: "Present", note: "note" },
    ]);

    const doc = createPlanDoc();
    addTask(doc, {
      id: "absent",
      title: "Absent",
      note: null,
      bucket: today,
      parentId: null,
      order: 0,
      now,
    });
    addTask(doc, {
      id: "empty",
      title: "Empty",
      note: "",
      bucket: today,
      parentId: null,
      order: 1,
      now,
    });
    const canonical = serializePlan(
      projectPlan(snapshotPlan(doc).tasks, "2026-08-03"),
      "2026-08-03",
    );
    expect(canonical).toBe(
      "Сегодня — пн, 3 августа\nAbsent\nEmpty: ",
    );
  });

  it("keeps exact null and empty identities during reconcile", () => {
    const doc = createPlanDoc();
    add(doc, "null-note", null, 0);
    add(doc, "empty-note", "", 1);

    const preview = buildReconcilePreview(
      doc,
      parsePlanText(
        "Сегодня — пн, 3 августа\nSame: \nSame",
        "2026-08-03",
      ),
      "2026-08-03",
    );

    expect(preview.requiresConfirmation).toBe(false);
    expect(preview.changes).not.toContainEqual(
      expect.objectContaining({ kind: "update" }),
    );
    applyReconcilePreview(doc, preview, {
      completedOn: "2026-08-03",
      idFactory: () => "unused",
      now,
    });
    expect(snapshotPlan(doc).tasks.map(({ id, note }) => ({ id, note }))).toEqual([
      { id: "empty-note", note: "" },
      { id: "null-note", note: null },
    ]);
  });

  it("property-checks note presence through snapshot, encode/apply, and canonical parse", () => {
    fc.assert(
      fc.property(fc.option(fc.string({ maxLength: 60 }), { nil: null }), (note) => {
        const doc = createPlanDoc();
        addTask(doc, {
          id: "property",
          title: "Property",
          note,
          bucket: today,
          parentId: null,
          order: 0,
          now,
        });
        const reloaded = createPlanDoc();
        Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(doc));
        const snapshot = snapshotPlan(reloaded).tasks[0];
        expect(snapshot.note).toBe(note);

        const text = serializePlan(
          projectPlan(snapshotPlan(reloaded).tasks, "2026-08-03"),
          "2026-08-03",
        );
        const parsed = parsePlanText(text, "2026-08-03");
        expect(parsed.sections[0]?.tasks[0]?.note).toBe(note);
      }),
      { numRuns: 200 },
    );
  });
});
