import { addTask, applyReconcilePreview, buildReconcilePreview, createPlanDoc, parsePlanText, projectPlan, serializePlan, snapshotPlan } from "@personal-plan/core";
import { describe, expect, it } from "vitest";
import { resolveDropDestination } from "../../src/ui/timeline-model";
describe("Android List/Text semantics", () => {
  it("keeps child completion in text while graphical projection uses a checked state", () => {
    const doc = createPlanDoc(); const now = "2026-08-04T10:00:00.000Z"; const bucket = { kind: "date", date: "2026-08-04" } as const;
    addTask(doc, { id: "parent", title: "Собраться", note: "свет", bucket, parentId: null, order: 0, now }); addTask(doc, { id: "child", title: "Трусы", note: null, bucket, parentId: "parent", order: 0, now });
    const source = serializePlan(projectPlan(snapshotPlan(doc).tasks, "2026-08-04"), "2026-08-04").replace("  Трусы", "  + Трусы");
    const preview = buildReconcilePreview(doc, parsePlanText(source, "2026-08-04"), "2026-08-04"); applyReconcilePreview(doc, preview, { completedOn: "2026-08-04", confirmDiagnostics: true, confirmRisky: true, idFactory: () => "new", now });
    const tasks = projectPlan(snapshotPlan(doc).tasks, "2026-08-04").active.flatMap((section) => section.tasks); expect(tasks.find((task) => task.id === "child")?.effectiveCompleted).toBe(true); expect(tasks.find((task) => task.id === "parent")?.effectiveCompleted).toBe(false);
  });
  it("resolves a drag drop to the section above it", () => {
    const items = [
      { type: "header", key: "header:date:2026-08-04", bucket: { kind: "date", date: "2026-08-04" } },
      { type: "block", key: "block:a", block: { parent: { id: "a" }, tasks: [] } },
      { type: "header", key: "header:date:2026-08-05", bucket: { kind: "date", date: "2026-08-05" } },
    ] as const;
    expect(resolveDropDestination(items as never, "block:a")).toEqual({ bucket: { kind: "date", date: "2026-08-04" }, index: 0 });
  });
});
