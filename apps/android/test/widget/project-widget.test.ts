import { addTask, createPlanDoc, projectPlan, setTaskCompleted, snapshotPlan } from "@personal-plan/core";
import { describe, expect, it } from "vitest";
import { projectWidget } from "../../src/widget/project-widget";
describe("widget projection", () => {
  it("includes visible sections, notes, depth and effective completion only", () => {
    const doc = createPlanDoc(); const now = "2026-08-04T10:00:00.000Z"; const bucket = { kind: "date", date: "2026-08-04" } as const;
    addTask(doc, { id: "p", title: "Собраться", note: "свет", bucket, parentId: null, order: 0, now }); addTask(doc, { id: "c", title: "Трусы", note: null, bucket, parentId: "p", order: 0, now }); setTaskCompleted(doc, "p", { completed: true, at: now, on: "2026-08-04" });
    const result = projectWidget(projectPlan(snapshotPlan(doc).tasks, "2026-08-04"), "2026-08-04", "synced", now);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.tasks).toEqual([{ id: "p", title: "Собраться", note: "свет", completed: true, depth: 0 }, { id: "c", title: "Трусы", note: null, completed: true, depth: 1 }]);
    expect(JSON.stringify(result)).not.toMatch(/rootSecret|encryptionKey|rawText/u);
  });

  it("marks only the first far bucket with a divider", () => {
    const doc = createPlanDoc(); const now = "2026-08-04T10:00:00.000Z";
    addTask(doc, { id: "later", title: "Later", note: null, bucket: { kind: "later" }, parentId: null, order: 0, now });
    addTask(doc, { id: "much", title: "Much", note: null, bucket: { kind: "much-later" }, parentId: null, order: 0, now });
    const result = projectWidget(projectPlan(snapshotPlan(doc).tasks, "2026-08-04"), "2026-08-04", "synced", now);
    expect(result.sections.map((section) => section.farSection)).toEqual([true, false]);
    expect(result.sections.map((section) => section.muchLaterDivider)).toEqual([false, true]);
  });

  it("formats date secondary labels like the app", () => {
    const doc = createPlanDoc(); const now = "2026-08-04T10:00:00.000Z";
    addTask(doc, { id: "today", title: "Today", note: null, bucket: { kind: "date", date: "2026-08-04" }, parentId: null, order: 0, now });
    addTask(doc, { id: "future", title: "Future", note: null, bucket: { kind: "date", date: "2026-08-10" }, parentId: null, order: 0, now });
    const result = projectWidget(projectPlan(snapshotPlan(doc).tasks, "2026-08-04"), "2026-08-04", "synced", now);
    expect(result.sections[0]?.secondaryLabel).toBe("4.08");
    expect(result.sections[1]?.secondaryLabel).toBe("10.08");
  });
});
