import { addTask, createPlanDoc, snapshotPlan } from "@personal-plan/core";
import { describe, expect, it, vi } from "vitest";
import { configureAndroidSync, needsRemoteBootstrap, runAndroidSync } from "../../src/sync/android-sync";

describe("Android sync orchestration", () => {
  it("processes widget state even offline", async () => {
    const doc = createPlanDoc();
    addTask(doc, { id: "task", title: "Дело", note: null, bucket: { kind: "date", date: "2026-08-04" }, parentId: null, order: 0, now: "2026-08-04T10:00:00.000Z" });
    const bridge = { readCommands: vi.fn(async () => []), acknowledgeCommands: vi.fn(async () => undefined), writeSnapshot: vi.fn(async () => undefined), requestRefresh: vi.fn(async () => undefined) };
    const syncClient = { start: vi.fn(), stop: vi.fn(async () => undefined), enqueueCurrentState: vi.fn(async () => undefined), bootstrapInto: vi.fn(), syncOnce: vi.fn() };
    const planStore = { updateCount: vi.fn(async () => 1), compact: vi.fn(), flush: vi.fn(async () => undefined) };
    configureAndroidSync({ doc, bridge, syncClient, planStore: planStore as never, today: () => "2026-08-04", isOnline: async () => false });
    const result = await runAndroidSync("background");
    expect(result.widgetStatus).toBe("offline");
    expect(result.error).toBe("offline");
    expect(syncClient.syncOnce).not.toHaveBeenCalled();
    expect(bridge.requestRefresh).toHaveBeenCalledTimes(2);
    configureAndroidSync(null);
  });

  it("bootstraps remote state on startup when local doc is empty", async () => {
    const doc = createPlanDoc();
    const bridge = { readCommands: vi.fn(async () => []), acknowledgeCommands: vi.fn(async () => undefined), writeSnapshot: vi.fn(async () => undefined), requestRefresh: vi.fn(async () => undefined) };
    const syncClient = {
      start: vi.fn(),
      stop: vi.fn(async () => undefined),
      enqueueCurrentState: vi.fn(async () => undefined),
      bootstrapInto: vi.fn(async () => ({ uploaded: 0, downloaded: 2, cursor: 2, status: "synced" as const })),
      syncOnce: vi.fn(),
    };
    const planStore = { updateCount: vi.fn(async () => 0), compact: vi.fn(), flush: vi.fn(async () => undefined) };
    configureAndroidSync({ doc, bridge, syncClient, planStore: planStore as never, today: () => "2026-08-04", isOnline: async () => true });
    const result = await runAndroidSync("startup");
    expect(result.downloaded).toBe(2);
    expect(syncClient.bootstrapInto).toHaveBeenCalledOnce();
    expect(syncClient.syncOnce).not.toHaveBeenCalled();
    configureAndroidSync(null);
  });

  it("captures a widget completion before the same sync run uploads", async () => {
    const doc = createPlanDoc();
    addTask(doc, { id: "task", title: "Дело", note: null, bucket: { kind: "date", date: "2026-08-04" }, parentId: null, order: 0, now: "2026-08-04T10:00:00.000Z" });
    const command = JSON.stringify({ version: 1, id: "123e4567-e89b-42d3-a456-426614174000", taskId: "task", completed: true, completedAt: "2026-08-04T11:00:00.000Z", completedOn: "2026-08-04" });
    const bridge = { readCommands: vi.fn(async () => [command]), acknowledgeCommands: vi.fn(async () => undefined), writeSnapshot: vi.fn(async () => undefined), requestRefresh: vi.fn(async () => undefined) };
    let pendingUpdates = 0;
    const captureUpdate = () => { pendingUpdates += 1; };
    const syncClient = {
      start: vi.fn(() => { doc.on("update", captureUpdate); }),
      stop: vi.fn(async () => undefined),
      enqueueCurrentState: vi.fn(async () => undefined),
      bootstrapInto: vi.fn(),
      syncOnce: vi.fn(async () => {
        const uploaded = pendingUpdates;
        pendingUpdates = 0;
        return { uploaded, downloaded: 0, cursor: uploaded, status: "synced" as const };
      }),
    };
    const planStore = { updateCount: vi.fn(async () => 1), compact: vi.fn(), flush: vi.fn(async () => undefined) };
    configureAndroidSync({ doc, bridge, syncClient, planStore: planStore as never, today: () => "2026-08-04", isOnline: async () => true });

    const result = await runAndroidSync("startup");

    expect(snapshotPlan(doc).tasks[0]?.completedAt).toBe("2026-08-04T11:00:00.000Z");
    expect(result.uploaded).toBeGreaterThan(0);
    configureAndroidSync(null);
  });

  it("detects when remote bootstrap is required", () => {
    const doc = createPlanDoc();
    expect(needsRemoteBootstrap(doc)).toBe(true);
    addTask(doc, { id: "task", title: "Дело", note: null, bucket: { kind: "date", date: "2026-08-04" }, parentId: null, order: 0, now: "2026-08-04T10:00:00.000Z" });
    expect(needsRemoteBootstrap(doc)).toBe(false);
  });
});
