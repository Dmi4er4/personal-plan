import { addTask, applyWidgetCompletionCommand, createPlanDoc, moveTask, snapshotPlan } from "../../src/index.js";
import { describe, expect, it, vi } from "vitest";

const NOW = "2026-08-04T10:00:00.000Z";

describe("widget completion commands", () => {
  it("applies a command once without a duplicate Yjs update", () => {
    const doc = createPlanDoc();
    addTask(doc, { id: "task", title: "Дело", note: null, bucket: { kind: "date", date: "2026-08-04" }, parentId: null, order: 0, now: NOW });
    const updates = vi.fn();
    doc.on("update", updates);
    const command = { id: "123e4567-e89b-42d3-a456-426614174000", taskId: "task", completed: true, completedAt: NOW, completedOn: "2026-08-04" as const };
    expect(applyWidgetCompletionCommand(doc, command)).toBe("applied");
    expect(applyWidgetCompletionCommand(doc, command)).toBe("duplicate");
    expect(updates).toHaveBeenCalledTimes(1);
    expect(snapshotPlan(doc).tasks[0]?.completedAt).toBe(NOW);
    expect(doc.getMap("appliedWidgetCommands").size).toBe(1);
  });

  it("heals missing legacy completion fields from a widget command", () => {
    const doc = createPlanDoc();
    addTask(doc, { id: "legacy", title: "Старое дело", note: null, bucket: { kind: "date", date: "2026-08-04" }, parentId: null, order: 0, now: NOW });
    const map = doc.getMap<import("yjs").Map<unknown>>("tasks").get("legacy");
    map?.delete("completedAt");
    map?.delete("completedOn");

    expect(() => applyWidgetCompletionCommand(doc, {
      id: "123e4567-e89b-42d3-a456-426614174001",
      taskId: "legacy",
      completed: true,
      completedAt: NOW,
      completedOn: "2026-08-04",
    })).not.toThrow();
    expect(snapshotPlan(doc).records[0]).toMatchObject({ completedAt: NOW, completedOn: "2026-08-04" });
  });

  it("moves a task only on its first widget completion transition", () => {
    const doc = createPlanDoc();
    for (const [id, order] of [
      ["first", 0],
      ["target", 1],
      ["last", 2],
    ] as const) {
      addTask(doc, { id, title: id, note: null, bucket: { kind: "date", date: "2026-08-04" }, parentId: null, order, now: NOW });
    }

    expect(applyWidgetCompletionCommand(doc, {
      id: "123e4567-e89b-42d3-a456-426614174010",
      taskId: "target",
      completed: true,
      completedAt: NOW,
      completedOn: "2026-08-04",
    })).toBe("applied");
    expect(snapshotPlan(doc).tasks.map(({ id }) => id)).toEqual(["first", "last", "target"]);

    moveTask(doc, "target", {
      bucket: { kind: "date", date: "2026-08-04" },
      parentId: null,
      index: 0,
      now: "2026-08-04T10:01:00.000Z",
    });
    expect(applyWidgetCompletionCommand(doc, {
      id: "123e4567-e89b-42d3-a456-426614174011",
      taskId: "target",
      completed: true,
      completedAt: "2026-08-04T10:02:00.000Z",
      completedOn: "2026-08-04",
    })).toBe("applied");
    expect(snapshotPlan(doc).tasks.map(({ id }) => id)).toEqual(["target", "first", "last"]);
  });
});
