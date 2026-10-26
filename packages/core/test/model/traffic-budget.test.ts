import { describe, expect, it } from "vitest";
import { addTask, createPlanDoc, editTask, snapshotPlan } from "../../src/index.js";

describe("incremental edit traffic", () => {
  it("renames a task without retransmitting its unchanged large note", () => {
    const doc = createPlanDoc();
    const note = "x".repeat(100_000);
    addTask(doc, { id: "task", title: "Before", note, bucket: { kind: "later" }, parentId: null, order: 0, now: "2026-10-12T00:00:00.000Z" });
    const updates: Uint8Array[] = [];
    doc.on("update", (update: Uint8Array) => { updates.push(update); });

    editTask(doc, "task", { title: "After", note });

    expect(updates.reduce((bytes, update) => bytes + update.length, 0)).toBeLessThan(1_000);
    const task = snapshotPlan(doc).tasks[0];
    expect(task.title).toBe("After");
    expect(task.note?.length).toBe(100_000);
  });
});
