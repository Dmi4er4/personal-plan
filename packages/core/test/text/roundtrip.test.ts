import { describe, expect, it } from "vitest";
import {
  parsePlanText,
  projectPlan,
  serializePlan,
  type Bucket,
  type TaskSnapshot,
} from "../../src/index";

function task(
  id: string,
  title: string,
  bucket: Bucket,
  overrides: Partial<TaskSnapshot> = {},
): TaskSnapshot {
  return {
    id,
    title,
    note: null,
    bucket,
    parentId: null,
    order: 0,
    completedAt: null,
    completedOn: null,
    childrenRevealedOn: null,
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-01T08:00:00.000Z",
    ...overrides,
  };
}

describe("canonical text round trip", () => {
  it("serializes only non-empty sections and preserves self completion", () => {
    const today = { kind: "date", date: "2026-08-03" } as const;
    const tomorrow = { kind: "date", date: "2026-08-04" } as const;
    const parent = task("parent", "Собраться", today, {
      note: "не забыть: свет",
    });
    const completedChild = task("completed-child", "Трусы", today, {
      parentId: parent.id,
      completedAt: "2026-08-03T08:30:00.000Z",
      completedOn: "2026-08-03",
    });
    const completedParent = task("completed-parent", "+ Сдать документы", today, {
      completedAt: "2026-08-03T09:00:00.000Z",
      completedOn: "2026-08-03",
    });
    const effectivelyCompletedChild = task(
      "effective-child",
      "Проверить копии",
      today,
      { parentId: completedParent.id },
    );
    const tomorrowTask = task("tomorrow", "Отправить документы", tomorrow);
    const later = task("later", "Разобрать шкаф", { kind: "later" });
    const muchLater = task("much-later", "+ Поехать в Исландию", {
      kind: "much-later",
    });
    const projection = projectPlan(
      [
        parent,
        completedChild,
        completedParent,
        effectivelyCompletedChild,
        tomorrowTask,
        later,
        muchLater,
      ],
      "2026-08-03",
    );

    const text = serializePlan(projection, "2026-08-03");

    expect(text).toMatchInlineSnapshot(`
      "Сегодня — пн, 3 августа
      Собраться: не забыть: свет
        + Трусы
      + \\+ Сдать документы
        Проверить копии

      Завтра — вт, 4 августа
      Отправить документы

      --------
      Позже
      Разобрать шкаф

      Сильно позже
      \\+ Поехать в Исландию"
    `);

    const parsed = parsePlanText(text, "2026-08-03");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.sections.map(({ bucket }) => bucket)).toEqual([
      { kind: "date", date: "2026-08-03" },
      { kind: "date", date: "2026-08-04" },
      { kind: "later" },
      { kind: "much-later" },
    ]);
    expect(parsed.sections[0]?.tasks.slice(2)).toMatchObject([
      { title: "+ Сдать документы", completed: true, depth: 0 },
      { title: "Проверить копии", completed: false, depth: 1 },
    ]);
    expect(parsed.sections[3]?.tasks[0]).toMatchObject({
      title: "+ Поехать в Исландию",
      completed: false,
    });
  });

  it("escapes every structural and inline token without losing task fields", () => {
    const bucket = { kind: "date", date: "2026-08-03" } as const;
    const values = [
      task("divider", "--------", bucket, { order: 0 }),
      task("later-heading", "Позже", bucket, { order: 1 }),
      task("much-later-heading", "Сильно позже", bucket, { order: 2 }),
      task("date-heading", "Сегодня — пн, 3 августа", bucket, { order: 3 }),
      task("delimiter", "Проверить: отчёт", bucket, {
        note: "путь \\server\r\nстрока\tс двоеточием: внутри",
        order: 4,
      }),
      task("backslash", "\\буквальный путь", bucket, { order: 5 }),
      task("plus", "+ буквальный плюс", bucket, { order: 6 }),
    ];

    const text = serializePlan(projectPlan(values, "2026-08-03"), "2026-08-03");

    expect(text).toContain("\\--------");
    expect(text).toContain("\\Позже");
    expect(text).toContain("\\Сильно позже");
    expect(text).toContain("\\Сегодня — пн, 3 августа");
    expect(text).toContain("Проверить\\: отчёт: путь \\\\server\\r\\nстрока\\tс двоеточием: внутри");
    expect(text).toContain("\\\\буквальный путь");
    expect(text).toContain("\\+ буквальный плюс");

    const parsed = parsePlanText(text, "2026-08-03");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.sections[0]?.tasks.map(({ title, note, completed, depth }) => ({
      title,
      note,
      completed,
      depth,
    }))).toEqual(
      values.map(({ title, note }) => ({
        title,
        note,
        completed: false,
        depth: 0,
      })),
    );
  });

  it("escapes leading title spaces without confusing them with task depth", () => {
    const bucket = { kind: "date", date: "2026-08-03" } as const;
    const parent = task("parent", " Parent", bucket, { order: 0 });
    const values = [
      parent,
      task("open-child", "  open child", bucket, {
        parentId: parent.id,
        order: 0,
      }),
      task("completed-child", "   completed child", bucket, {
        parentId: parent.id,
        order: 1,
        completedAt: "2026-08-03T09:00:00.000Z",
        completedOn: "2026-08-03",
      }),
      task("completed-top-level", "    completed top level", bucket, {
        order: 1,
        completedAt: "2026-08-03T09:00:00.000Z",
        completedOn: "2026-08-03",
      }),
    ];

    const text = serializePlan(projectPlan(values, "2026-08-03"), "2026-08-03");

    expect(text).toContain("\\ Parent");
    expect(text).toContain("  \\  open child");
    expect(text).toContain("  + \\   completed child");
    expect(text).toContain("+ \\    completed top level");

    const parsed = parsePlanText(text, "2026-08-03");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.sections[0]?.tasks).toMatchObject([
      { title: " Parent", completed: false, depth: 0 },
      { title: "  open child", completed: false, depth: 1 },
      { title: "   completed child", completed: true, depth: 1 },
      { title: "    completed top level", completed: true, depth: 0 },
    ]);
  });
});
