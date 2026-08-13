import { addTask, createPlanDoc, snapshotPlan } from "@personal-plan/core";
import { describe, expect, it, vi } from "vitest";
import { processWidgetCommands } from "../../src/widget/process-commands";
describe("widget command reconciliation", () => { it("acknowledges duplicate commands with exactly-once visible state", async () => { const doc = createPlanDoc(); const now = "2026-08-04T10:00:00.000Z"; addTask(doc, { id: "task", title: "Дело", note: null, bucket: { kind: "date", date: "2026-08-04" }, parentId: null, order: 0, now }); const command = JSON.stringify({ version: 1, id: "123e4567-e89b-42d3-a456-426614174000", taskId: "task", completed: true, completedAt: now, completedOn: "2026-08-04" }); const bridge = { readCommands: vi.fn(async () => [command, command]), acknowledgeCommands: vi.fn(async () => undefined), writeSnapshot: vi.fn(async () => undefined), requestRefresh: vi.fn(async () => undefined) }; expect(await processWidgetCommands(doc, bridge, "2026-08-04")).toBe(2); expect(snapshotPlan(doc).tasks[0]?.completedAt).toBe(now); expect(doc.getMap("appliedWidgetCommands").size).toBe(1); expect(bridge.requestRefresh).toHaveBeenCalledOnce(); expect(bridge.acknowledgeCommands).toHaveBeenCalledWith(["123e4567-e89b-42d3-a456-426614174000", "123e4567-e89b-42d3-a456-426614174000"]); }); });

describe("widget command timestamps", () => {
  it("accepts native Instant nanosecond timestamps and trims them to milliseconds", async () => {
    const doc = createPlanDoc();
    const now = "2026-08-05T10:00:00.000Z";
    addTask(doc, { id: "task", title: "Дело", note: null, bucket: { kind: "date", date: "2026-08-05" }, parentId: null, order: 0, now });
    const command = JSON.stringify({ version: 1, id: "123e4567-e89b-42d3-a456-426614174002", taskId: "task", completed: true, completedAt: "2026-08-05T11:21:33.123456789Z", completedOn: "2026-08-05" });
    const bridge = { readCommands: vi.fn(async () => [command]), acknowledgeCommands: vi.fn(async () => undefined), writeSnapshot: vi.fn(async () => undefined), requestRefresh: vi.fn(async () => undefined) };
    expect(await processWidgetCommands(doc, bridge, "2026-08-05")).toBe(1);
    expect(snapshotPlan(doc).tasks[0]?.completedAt).toBe("2026-08-05T11:21:33.123Z");
    expect(bridge.requestRefresh).toHaveBeenCalledOnce();
    expect(bridge.acknowledgeCommands).toHaveBeenCalledWith(["123e4567-e89b-42d3-a456-426614174002"]);
  });
});

describe("widget refresh bridge", () => {
  it("uses one native call when atomic snapshot refresh is available", async () => {
    const doc = createPlanDoc();
    addTask(doc, { id: "task", title: "Дело", note: null, bucket: { kind: "date", date: "2026-08-05" }, parentId: null, order: 0, now: "2026-08-05T10:00:00.000Z" });
    const bridge = {
      readCommands: vi.fn(async () => []),
      acknowledgeCommands: vi.fn(async () => undefined),
      writeSnapshot: vi.fn(async () => undefined),
      writeSnapshotAndRefresh: vi.fn(async () => undefined),
      requestRefresh: vi.fn(async () => undefined),
    };

    await processWidgetCommands(doc, bridge, "2026-08-05");

    expect(bridge.writeSnapshotAndRefresh).toHaveBeenCalledOnce();
    expect(bridge.writeSnapshot).not.toHaveBeenCalled();
    expect(bridge.requestRefresh).not.toHaveBeenCalled();
  });
});
