import { addTask, addTaskToIncompleteHead, createPlanDoc, projectPlan, snapshotPlan } from "@personal-plan/core";
import { describe, expect, it } from "vitest";
import { buildNewTask } from "../../src/ui/new-task";

const TODAY = "2026-08-04";
const TOMORROW = "2026-08-05";
const NOW = "2026-08-04T10:00:00.000Z";

describe("Новое дело", () => {
  it("puts the typed title first today and reaches the plan document", () => {
    const doc = createPlanDoc();
    addTask(doc, { id: "existing", title: "Уже есть", note: null, bucket: { kind: "date", date: TODAY }, parentId: null, order: 0, now: NOW });
    const input = buildNewTask("Купить лампу RX-77", { kind: "date", date: TODAY }, { id: "fresh", now: NOW });
    expect(input).toEqual({ id: "fresh", title: "Купить лампу RX-77", note: null, bucket: { kind: "date", date: TODAY }, parentId: null, order: 0, now: NOW });
    if (input === null) throw new Error("expected a new task input");
    addTaskToIncompleteHead(doc, input);
    const todaySection = projectPlan(snapshotPlan(doc).tasks, TODAY).active.find((section) => section.bucket.kind === "date" && section.bucket.date === TODAY);
    expect(todaySection?.tasks.map((task) => task.title)).toEqual(["Купить лампу RX-77", "Уже есть"]);
  });

  it("places the task in the selected bucket", () => {
    const doc = createPlanDoc();
    addTask(doc, { id: "later", title: "Позже", note: null, bucket: { kind: "later" }, parentId: null, order: 0, now: NOW });
    const input = buildNewTask("Новое позже", { kind: "later" }, { id: "fresh", now: NOW });
    expect(input).toEqual({ id: "fresh", title: "Новое позже", note: null, bucket: { kind: "later" }, parentId: null, order: 0, now: NOW });
    if (input === null) throw new Error("expected a new task input");
    addTaskToIncompleteHead(doc, input);
    const laterSection = projectPlan(snapshotPlan(doc).tasks, TODAY).active.find((section) => section.bucket.kind === "later");
    expect(laterSection?.tasks.map((task) => task.title)).toEqual(["Новое позже", "Позже"]);
  });

  it("places the task in tomorrow when that bucket is selected", () => {
    const input = buildNewTask("Завтрашнее", { kind: "date", date: TOMORROW }, { id: "fresh", now: NOW });
    expect(input).toEqual({ id: "fresh", title: "Завтрашнее", note: null, bucket: { kind: "date", date: TOMORROW }, parentId: null, order: 0, now: NOW });
  });

  it("ignores an empty title", () => {
    expect(buildNewTask("", { kind: "date", date: TODAY }, { id: "fresh", now: NOW })).toBeNull();
    expect(buildNewTask("   ", { kind: "date", date: TODAY }, { id: "fresh", now: NOW })).toBeNull();
  });
});
