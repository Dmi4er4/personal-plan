import { describe, expect, it } from "vitest";

import {
  addTask,
  createPlanDoc,
  parsePlanText,
  projectPlan,
  serializePlan,
  snapshotPlan,
} from "../../src/index";

const today = { kind: "date", date: "2026-08-03" } as const;
const now = "2026-08-03T08:00:00.000Z";

describe("significant List and Text whitespace", () => {
  it("preserves leading, trailing, repeated spaces and non-empty notes in storage", () => {
    const doc = createPlanDoc();
    addTask(doc, {
      id: "spaces",
      title: "  title   with spaces  ",
      note: "  note   with spaces  ",
      bucket: today,
      parentId: null,
      order: 0,
      now,
    });
    addTask(doc, {
      id: "whitespace-only",
      title: "   ",
      note: null,
      bucket: today,
      parentId: null,
      order: 1,
      now,
    });

    expect(snapshotPlan(doc).tasks).toMatchObject([
      {
        id: "spaces",
        title: "  title   with spaces  ",
        note: "  note   with spaces  ",
      },
      { id: "whitespace-only", title: "   ", note: null },
    ]);
  });

  it("treats only an actual leading tab as child indentation", () => {
    const parsed = parsePlanText(
      [
        "Сегодня — пн, 3 августа",
        "Parent\tinside: note\tinside",
        "\tChild\tinside: child-note\tinside",
      ].join("\n"),
      "2026-08-03",
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.sections[0]?.tasks).toMatchObject([
      {
        depth: 0,
        title: "Parent\tinside",
        note: "note\tinside",
      },
      {
        depth: 1,
        title: "Child\tinside",
        note: "child-note\tinside",
      },
    ]);
  });

  it("keeps List-created fields equivalent after canonical Text round-trip", () => {
    const doc = createPlanDoc();
    addTask(doc, {
      id: "parent",
      title: " Parent\twith  spaces ",
      note: " note\twith  spaces ",
      bucket: today,
      parentId: null,
      order: 0,
      now,
    });
    addTask(doc, {
      id: "child",
      title: " Child\twith  spaces ",
      note: "",
      bucket: today,
      parentId: "parent",
      order: 0,
      now,
    });

    const canonical = serializePlan(
      projectPlan(snapshotPlan(doc).tasks, "2026-08-03"),
      "2026-08-03",
    );
    expect(canonical).toContain("\\t");
    const parsed = parsePlanText(canonical, "2026-08-03");

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.sections[0]?.tasks.map(({ depth, title, note }) => ({
      depth,
      title,
      note,
    }))).toEqual([
      {
        depth: 0,
        title: " Parent\twith  spaces ",
        note: " note\twith  spaces ",
      },
      { depth: 1, title: " Child\twith  spaces ", note: "" },
    ]);
  });
});
