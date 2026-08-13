import * as Y from "yjs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addTask,
  buildReconcilePreview,
  createPlanDoc,
  parsePlanText,
  projectPlan,
  serializePlan,
  type TaskSnapshot,
} from "../../src/index";

describe("text source retention", () => {
  it("retains every arbitrary source code point except CRLF normalization", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2000 }), (source) => {
        const result = parsePlanText(source, "2026-08-03");
        expect(result.source).toBe(source.replaceAll("\r\n", "\n"));
      }),
    );
  });

  it("does not mutate the Yjs document while building a preview", () => {
    const doc = createPlanDoc();
    addTask(doc, {
      id: "existing",
      title: "Existing",
      note: null,
      bucket: { kind: "date", date: "2026-08-03" },
      parentId: null,
      order: 0,
      now: "2026-08-03T08:00:00.000Z",
    });
    const parsed = parsePlanText(
      "Сегодня — пн, 3 августа\nEdited",
      "2026-08-03",
    );
    const before = Y.encodeStateAsUpdate(doc);

    buildReconcilePreview(doc, parsed, "2026-08-03");

    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it("round-trips arbitrary supported Unicode task fields, completion, and depth", () => {
    const arbitraryText = fc.string({ unit: "binary", maxLength: 80 });
    const arbitraryTitle = arbitraryText.filter((value) => value.length > 0);
    const arbitraryNote = fc.option(arbitraryText, { nil: null });

    fc.assert(
      fc.property(
        arbitraryTitle,
        arbitraryNote,
        fc.boolean(),
        fc.boolean(),
        (title, note, completed, child) => {
          const base: TaskSnapshot = {
            id: "target",
            title,
            note,
            bucket: { kind: "date", date: "2026-08-03" },
            parentId: child ? "parent" : null,
            order: 0,
            completedAt: completed ? "2026-08-03T09:00:00.000Z" : null,
            completedOn: completed ? "2026-08-03" : null,
            childrenRevealedOn: null,
            createdAt: "2026-08-03T08:00:00.000Z",
            updatedAt: "2026-08-03T09:00:00.000Z",
          };
          const parent: TaskSnapshot = {
            ...base,
            id: "parent",
            title: "Property parent",
            note: null,
            parentId: null,
            completedAt: null,
            completedOn: null,
          };
          const tasks = child ? [parent, base] : [base];

          const serialized = serializePlan(
            projectPlan(tasks, "2026-08-03"),
            "2026-08-03",
          );
          const parsed = parsePlanText(serialized, "2026-08-03");
          const parsedTarget = parsed.sections[0]?.tasks[child ? 1 : 0];

          expect(parsed.diagnostics).toEqual([]);
          expect(parsedTarget).toMatchObject({
            title,
            note,
            completed,
            depth: child ? 1 : 0,
          });
        },
      ),
      { numRuns: 300, seed: 20_260_813 },
    );
  });

  it.each(["\u000b", "\u000c", "\u00a0", "\u2028", "\u2029", "\ufeff"])(
    "round-trips a title containing only Unicode whitespace %#",
    (title) => {
      const task: TaskSnapshot = {
        id: "whitespace",
        title,
        note: null,
        bucket: { kind: "date", date: "2026-08-03" },
        parentId: null,
        order: 0,
        completedAt: null,
        completedOn: null,
        childrenRevealedOn: null,
        createdAt: "2026-08-03T08:00:00.000Z",
        updatedAt: "2026-08-03T08:00:00.000Z",
      };

      const serialized = serializePlan(projectPlan([task], "2026-08-03"), "2026-08-03");
      const parsed = parsePlanText(serialized, "2026-08-03");

      expect(parsed.diagnostics).toEqual([]);
      expect(parsed.sections[0]?.tasks[0]?.title).toBe(title);
    },
  );
});
