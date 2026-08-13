import * as Y from "yjs";
import { describe, expect, it, vi } from "vitest";
import {
  applyReconcilePreview,
  buildReconcilePreview,
  createPlanDoc,
  parseLegacyNote,
  parsePlanText,
  snapshotPlan,
} from "../../src/index";

const legacyNote = [
  "Собраться: не забыть свет",
  "- Носки",
  "✓ Оплатить интернет",
  "",
  "Отправить документы",
  "",
  "Позвонить маме",
  "",
  "--------",
  "",
  "Разобрать шкаф",
  "",
  "Поехать в Исландию",
].join("\r\n");

describe("legacy note import", () => {
  it("maps blank-separated blocks to consecutive and far buckets", () => {
    const parsed = parseLegacyNote(legacyNote, "2026-08-03");

    expect(parsed.mode).toBe("legacy");
    expect(parsed.source).toBe(legacyNote.replaceAll("\r\n", "\n"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.sections.map(({ bucket }) => bucket)).toEqual([
      { kind: "date", date: "2026-08-03" },
      { kind: "date", date: "2026-08-04" },
      { kind: "date", date: "2026-08-05" },
      { kind: "later" },
      { kind: "much-later" },
    ]);
    expect(parsed.sections[0]?.tasks).toMatchObject([
      {
        title: "Собраться",
        note: "не забыть свет",
        completed: false,
        depth: 0,
      },
      { title: "Носки", note: null, completed: false, depth: 1 },
      {
        title: "Оплатить интернет",
        note: null,
        completed: true,
        depth: 0,
      },
    ]);
    expect(parsed.sections[4]?.tasks[0]).toMatchObject({
      title: "Поехать в Исландию",
      depth: 0,
    });
  });

  it("uses only the first exact divider and maps every later far block to much-later", () => {
    const parsed = parseLegacyNote(
      "Today\n\n--------\n\nLater\n\nMuch later\n\n--------",
      "2026-08-03",
    );

    expect(parsed.sections.map(({ bucket }) => bucket)).toEqual([
      { kind: "date", date: "2026-08-03" },
      { kind: "later" },
      { kind: "much-later" },
      { kind: "much-later" },
    ]);
    expect(parsed.sections[3]?.tasks[0]).toMatchObject({
      title: "--------",
      depth: 0,
    });
  });

  it("keeps dash and checkmark markers exclusive to legacy mode", () => {
    const legacy = parseLegacyNote("Parent\n- ✓ Child", "2026-08-03");
    const canonical = parsePlanText(
      "Сегодня — пн, 3 августа\nParent\n- ✓ Child\n✓ Complete",
      "2026-08-03",
    );

    expect(legacy.sections[0]?.tasks[1]).toMatchObject({
      title: "Child",
      depth: 1,
      completed: true,
    });
    expect(canonical.sections[0]?.tasks.slice(1)).toMatchObject([
      { title: "- ✓ Child", depth: 0, completed: false },
      { title: "✓ Complete", depth: 0, completed: false },
    ]);
  });

  it("recognizes legacy markers after spaces and tab indentation", () => {
    const parsed = parseLegacyNote(
      "Parent\n  - Spaced child\n\t- Tab child\n  ✓ Completed child",
      "2026-08-03",
    );

    expect(parsed.sections[0]?.tasks).toMatchObject([
      { title: "Parent", depth: 0, completed: false },
      { title: "Spaced child", depth: 1, completed: false },
      { title: "Tab child", depth: 1, completed: false },
      { title: "Completed child", depth: 1, completed: true },
    ]);
  });

  it("returns a typed blocking diagnostic for an eighth near block", () => {
    const source = Array.from(
      { length: 8 },
      (_, index) => `Legacy block ${String(index + 1)}`,
    ).join("\n\n");

    const parsed = parseLegacyNote(source, "2026-08-03");

    expect(parsed.source).toBe(source);
    expect(parsed.sections.filter(({ bucket }) => bucket.kind === "date")).toHaveLength(7);
    expect(parsed.legacyCounts).toEqual({
      completedTasks: 0,
      farSections: 0,
      nearSections: 8,
      tasks: 8,
    });
    const overflow = parsed.diagnostics.find(
      ({ code }) => code === "legacy_near_section_overflow",
    );
    expect(overflow).toMatchObject({
      code: "legacy_near_section_overflow",
      line: 15,
      severity: "error",
    });
    expect(overflow?.message).toContain("--------");
  });

  it("never applies a blocking legacy overflow preview to Yjs", () => {
    const doc = createPlanDoc();
    const source = Array.from(
      { length: 8 },
      (_, index) => `Legacy block ${String(index + 1)}`,
    ).join("\n\n");
    const parsed = parseLegacyNote(source, "2026-08-03");
    const before = Y.encodeStateAsUpdate(doc);

    const preview = buildReconcilePreview(doc, parsed, "2026-08-03");

    expect(preview.requiresConfirmation).toBe(true);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(() => {
      applyReconcilePreview(doc, preview, {
        completedOn: "2026-08-03",
        confirmDiagnostics: true,
        idFactory: vi.fn(() => "must-not-create"),
        now: "2026-08-03T12:00:00.000Z",
      });
    }).toThrow("reconcile_blocking_diagnostic");
    expect(snapshotPlan(doc).tasks).toEqual([]);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });
});
