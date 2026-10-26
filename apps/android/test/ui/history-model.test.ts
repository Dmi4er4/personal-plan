import { addTask, createPlanDoc, removeTask, setTaskCompleted, snapshotPlan } from "@personal-plan/core";
import { describe, expect, it } from "vitest";
import { buildHistoryGroups, historyDateLabel } from "../../src/ui/history-model";

const TODAY = "2026-09-02";
const NOW = "2026-09-02T08:00:00.000Z";

describe("Android history model", () => {
  it("groups blocks by day and keeps matching children with their parent", () => {
    const doc = createPlanDoc();
    const bucket = { kind: "date", date: TODAY } as const;
    addTask(doc, { id: "parent", title: "Поездка", note: null, bucket, parentId: null, order: 0, now: NOW });
    addTask(doc, { id: "child", title: "Купить билет", note: "Минск", bucket, parentId: "parent", order: 0, now: NOW });
    setTaskCompleted(doc, "parent", { completed: true, at: NOW, on: TODAY });
    const history = snapshotPlan(doc).tasks;

    const groups = buildHistoryGroups(history, "билет");

    expect(groups).toHaveLength(1);
    expect(groups[0]?.date).toBe(TODAY);
    expect(groups[0]?.blocks[0]?.tasks.map(({ id }) => id)).toEqual(["parent", "child"]);
  });

  it("searches titles and notes and separates different dates", () => {
    const doc = createPlanDoc();
    addTask(doc, { id: "done", title: "Позвонить", note: "Дане", bucket: { kind: "date", date: "2026-09-01" }, parentId: null, order: 0, now: NOW });
    setTaskCompleted(doc, "done", { completed: true, at: NOW, on: "2026-09-01" });
    addTask(doc, { id: "deleted", title: "Черновик", note: null, bucket: { kind: "date", date: TODAY }, parentId: null, order: 0, now: NOW });
    removeTask(doc, "deleted", { at: NOW, on: TODAY });
    const history = snapshotPlan(doc).records.filter((task) => task.completedAt !== null || task.deleted);

    expect(buildHistoryGroups(history, "дане").flatMap(({ blocks }) => blocks).map(({ root }) => root.id)).toEqual(["done"]);
    expect(buildHistoryGroups(history, "").map(({ date }) => date)).toEqual([TODAY, "2026-09-01"]);
  });

  it("formats relative and absolute group labels", () => {
    expect(historyDateLabel(TODAY, TODAY)).toBe("Сегодня");
    expect(historyDateLabel("2026-09-01", TODAY)).toBe("Вчера");
    expect(historyDateLabel("2026-08-30", TODAY)).toBe("30.08.2026");
  });
});
