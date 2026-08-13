import { describe, expect, it } from "vitest";
import {
  formatSectionHeading,
  parsePlanText,
  parseSectionHeading,
} from "../../src/index";

const canonical = String.raw`Сегодня — пн, 3 августа
Собраться: не забыть: свет
  + Трусы
  Носки
  Кофта
Купить корм
+ Оплатить интернет
\+ Математика

Завтра — вт, 4 августа
Отправить документы

--------
Позже
Разобрать шкаф

Сильно позже
Поехать в Исландию`;

describe("canonical plan text syntax", () => {
  it("parses notes, completion, child depth, escaped plus, and both far buckets", () => {
    const parsed = parsePlanText(canonical, "2026-08-03");

    expect(parsed.source).toBe(canonical);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.sections.map(({ bucket }) => bucket)).toEqual([
      { kind: "date", date: "2026-08-03" },
      { kind: "date", date: "2026-08-04" },
      { kind: "later" },
      { kind: "much-later" },
    ]);
    expect(parsed.sections[0]?.tasks).toMatchObject([
      {
        title: "Собраться",
        note: "не забыть: свет",
        completed: false,
        depth: 0,
      },
      { title: "Трусы", note: null, completed: true, depth: 1 },
      { title: "Носки", note: null, completed: false, depth: 1 },
      { title: "Кофта", note: null, completed: false, depth: 1 },
      { title: "Купить корм", note: null, completed: false, depth: 0 },
      {
        title: "Оплатить интернет",
        note: null,
        completed: true,
        depth: 0,
      },
      { title: "+ Математика", note: null, completed: false, depth: 0 },
    ]);
  });

  it("decodes only known escapes and retains unknown handwritten escapes", () => {
    const parsed = parsePlanText(
      String.raw`Сегодня — пн, 3 августа
Путь\\к\\файлу\nс новой строки\rвозврат\tтаб: заметка\\nбуквально \q`,
      "2026-08-03",
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.sections[0]?.tasks[0]).toMatchObject({
      title: "Путь\\к\\файлу\nс новой строки\rвозврат\tтаб",
      note: String.raw`заметка\nбуквально \q`,
    });
  });

  it("normalizes only CRLF in source and treats a tab as one child level", () => {
    const text = "Сегодня — пн, 3 августа\r\nРодитель\r\n\tРебёнок\r\n";
    const parsed = parsePlanText(text, "2026-08-03");

    expect(parsed.source).toBe("Сегодня — пн, 3 августа\nРодитель\n\tРебёнок\n");
    expect(parsed.sections[0]?.tasks[1]).toMatchObject({
      title: "Ребёнок",
      depth: 1,
    });
  });

  it("diagnoses deeper nesting without changing the retained source", () => {
    const text = "Сегодня — пн, 3 августа\nРодитель\n    Ребёнок";
    const parsed = parsePlanText(text, "2026-08-03");

    expect(parsed.source).toBe(text);
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ line: 3, code: "nested_too_deep" }),
    );
  });

  it("keeps ordinary em-dash task lines and the following task in the same section", () => {
    const parsed = parsePlanText(
      "Сегодня — пн, 3 августа\nПроверить — резервную копию\nЗаписать результат",
      "2026-08-03",
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.sections[0]?.tasks.map(({ title }) => title)).toEqual([
      "Проверить — резервную копию",
      "Записать результат",
    ]);
  });

  it("diagnoses one- and three-space indentation without creating tasks", () => {
    const text =
      "Сегодня — пн, 3 августа\nРодитель\n Один пробел\n   Три пробела\nСледующая задача";
    const parsed = parsePlanText(text, "2026-08-03");

    expect(parsed.source).toBe(text);
    expect(parsed.diagnostics).toEqual([
      expect.objectContaining({
        line: 3,
        code: "invalid_indentation",
        severity: "error",
      }),
      expect.objectContaining({
        line: 4,
        code: "invalid_indentation",
        severity: "error",
      }),
    ]);
    expect(parsed.sections[0]?.tasks.map(({ title }) => title)).toEqual([
      "Родитель",
      "Следующая задача",
    ]);
  });

  it("diagnoses an orphan child and duplicate instances of each far section", () => {
    const parsed = parsePlanText(
      "Позже\n  Без родителя\n\nПозже\nЕщё\n\nСильно позже\nПервое\n\nСильно позже\nВторое",
      "2026-08-03",
    );

    expect(parsed.diagnostics.map(({ code }) => code)).toEqual([
      "orphan_subtask",
      "duplicate_far_section",
      "duplicate_far_section",
    ]);
  });

  it("recognizes and validates explicit Russian date headings across a year edge", () => {
    expect(parseSectionHeading("Сегодня — чт, 31 декабря", "2026-12-31")).toEqual({
      kind: "date",
      date: "2026-12-31",
    });
    expect(parseSectionHeading("Завтра — пт, 1 января", "2026-12-31")).toEqual({
      kind: "date",
      date: "2027-01-01",
    });
    expect(parseSectionHeading("Суббота — сб, 2 января", "2026-12-31")).toEqual({
      kind: "date",
      date: "2027-01-02",
    });
    expect(parseSectionHeading("Сегодня — пт, 1 января", "2026-12-31")).toMatchObject({
      code: "invalid_date_heading",
    });
    expect(parseSectionHeading("Сегодня - пн, 3 августа", "2026-08-03")).toMatchObject({
      code: "invalid_date_heading",
    });
    expect(parseSectionHeading("Однажды — ср, 5 августа", "2026-08-03")).toMatchObject({
      code: "unrecognized_heading",
    });
    expect(parseSectionHeading("Обычная задача", "2026-08-03")).toBeNull();
  });

  it("formats headings without depending on the host timezone", () => {
    expect(formatSectionHeading({ kind: "date", date: "2026-08-03" }, "2026-08-03")).toBe(
      "Сегодня — пн, 3 августа",
    );
    expect(formatSectionHeading({ kind: "date", date: "2026-08-05" }, "2026-08-03")).toBe(
      "Среда — ср, 5 августа",
    );
    expect(formatSectionHeading({ kind: "later" }, "2026-08-03")).toBe("Позже");
    expect(formatSectionHeading({ kind: "much-later" }, "2026-08-03")).toBe(
      "Сильно позже",
    );
  });

  it("accepts «Послезавтра» as an alias for the offset-2 date heading", () => {
    // 2026-08-07 is a Friday; the day after tomorrow is Sunday 2026-08-09.
    expect(parseSectionHeading("Послезавтра — вс, 9 августа", "2026-08-07")).toEqual({
      kind: "date",
      date: "2026-08-09",
    });
  });

  it("rejects «Послезавтра» when the date is not two days out", () => {
    expect(parseSectionHeading("Послезавтра — сб, 8 августа", "2026-08-07")).toMatchObject({
      code: "invalid_date_heading",
    });
  });

  it("diagnoses a malformed «Послезавтра» heading instead of creating a task", () => {
    const parsed = parsePlanText(
      "Завтра — сб, 8 августа\nПозвонить\n\nПослезавтра — вс,  августа",
      "2026-08-07",
    );
    expect(parsed.diagnostics.map((entry) => entry.code)).toEqual(["invalid_date_heading"]);
    expect(parsed.sections.flatMap((section) => section.tasks.map((task) => task.title))).toEqual([
      "Позвонить",
    ]);
  });
});
