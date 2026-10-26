import { addTask, createPlanDoc, snapshotPlan } from "@personal-plan/core";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { configureAndroidSync, needsRemoteBootstrap, runAndroidSync } from "../../src/sync/android-sync";
import { runHeadlessAndroidSync } from "../../src/sync/headless-sync";
import type { WidgetSnapshot } from "../../src/widget/contracts";

describe("Android sync orchestration", () => {
  it("reconciles the complete local and remote state on startup", async () => {
    const doc = createPlanDoc();
    addTask(doc, { id: "local-only", title: "Локальное дело", note: null, bucket: { kind: "later" }, parentId: null, order: 0, now: "2026-08-04T10:00:00.000Z" });
    const calls: string[] = [];
    const syncClient = {
      start: vi.fn(() => { calls.push("start"); }),
      stop: vi.fn(async () => undefined),
      enqueueCurrentState: vi.fn(async () => { calls.push("checkpoint"); }),
      bootstrapInto: vi.fn(async () => { calls.push("bootstrap"); return { uploaded: 0, downloaded: 2, cursor: 2, status: "synced" as const }; }),
      syncOnce: vi.fn(async () => { calls.push("sync"); return { uploaded: 1, downloaded: 1, cursor: 3, status: "synced" as const }; }),
    };
    const bridge = { readCommands: vi.fn(async () => []), acknowledgeCommands: vi.fn(async () => undefined), writeSnapshot: vi.fn(async () => undefined), requestRefresh: vi.fn(async () => undefined) };
    const planStore = { updateCount: vi.fn(async () => 1), compact: vi.fn(), flush: vi.fn(async () => undefined) };
    configureAndroidSync({ doc, bridge, syncClient, planStore: planStore as never, today: () => "2026-08-04", isOnline: async () => true });

    const result = await runAndroidSync("startup");

    expect(calls).toEqual(["start", "start", "checkpoint", "bootstrap", "sync"]);
    expect(syncClient.enqueueCurrentState).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ uploaded: 1, downloaded: 3, widgetStatus: "synced" });
    configureAndroidSync(null);
  });

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
    expect(bridge.requestRefresh).toHaveBeenCalledTimes(1);
    configureAndroidSync(null);
  });

  it("keeps polling without rebuilding an unchanged widget, then refreshes on edits and the next day", async () => {
    const doc = createPlanDoc();
    addTask(doc, { id: "task", title: "Дело", note: null, bucket: { kind: "date", date: "2026-08-04" }, parentId: null, order: 0, now: "2026-08-04T10:00:00.000Z" });
    let day: "2026-08-04" | "2026-08-05" = "2026-08-04";
    const bridge = { readCommands: vi.fn(async () => []), acknowledgeCommands: vi.fn(async () => undefined), writeSnapshot: vi.fn<(json: string) => Promise<void>>().mockResolvedValue(undefined), requestRefresh: vi.fn(async () => undefined) };
    const syncClient = {
      start: vi.fn(), stop: vi.fn(async () => undefined), enqueueCurrentState: vi.fn(async () => undefined),
      canResumeFromCheckpoint: vi.fn(async () => true), bootstrapInto: vi.fn(),
      syncOnce: vi.fn(async () => ({ uploaded: 0, downloaded: 0, cursor: 1, status: "synced" as const })),
    };
    const planStore = { updateCount: vi.fn(async () => 1), compact: vi.fn(), flush: vi.fn(async () => undefined) };
    configureAndroidSync({ doc, bridge, syncClient, planStore: planStore as never, today: () => day, isOnline: async () => true });

    await runAndroidSync("startup");
    await runAndroidSync("foreground");
    expect(syncClient.syncOnce).toHaveBeenCalledTimes(2);
    expect(bridge.readCommands).toHaveBeenCalledTimes(2);
    expect(bridge.requestRefresh).toHaveBeenCalledTimes(1);

    const title = doc.getMap<Y.Map<unknown>>("tasks").get("task")?.get("title") as Y.Text;
    title.delete(0, 1);
    await runAndroidSync("foreground");
    expect(bridge.requestRefresh).toHaveBeenCalledTimes(2);
    const written = JSON.parse(bridge.writeSnapshot.mock.calls[1]?.[0] ?? "{}") as WidgetSnapshot;
    expect(written.sections[0]?.tasks[0]?.title).toBe("ело");
    day = "2026-08-05";
    await runAndroidSync("foreground");
    expect(bridge.requestRefresh).toHaveBeenCalledTimes(3);
    configureAndroidSync(null);
    doc.destroy();
  });

  it("repairs and captures missing legacy orders before syncing", async () => {
    const doc = createPlanDoc();
    addTask(doc, { id: "legacy", title: "Старое дело", note: null, bucket: { kind: "later" }, parentId: null, order: 0, now: "2026-08-04T10:00:00.000Z" });
    doc.getMap<Y.Map<unknown>>("tasks").get("legacy")?.delete("order");
    let captured = 0;
    const syncClient = {
      start: vi.fn(() => { doc.on("update", () => { captured += 1; }); }),
      stop: vi.fn(async () => undefined),
      enqueueCurrentState: vi.fn(async () => undefined),
      bootstrapInto: vi.fn(),
      syncOnce: vi.fn(),
    };
    const bridge = { readCommands: vi.fn(async () => []), acknowledgeCommands: vi.fn(async () => undefined), writeSnapshot: vi.fn(async () => undefined), requestRefresh: vi.fn(async () => undefined) };
    const planStore = { updateCount: vi.fn(async () => 1), compact: vi.fn(), flush: vi.fn(async () => undefined) };
    configureAndroidSync({ doc, bridge, syncClient, planStore: planStore as never, today: () => "2026-08-04", isOnline: async () => false });

    await runAndroidSync("startup");

    expect(captured).toBeGreaterThan(0);
    expect(snapshotPlan(doc).diagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "invalid_task_order" })]),
    );
    configureAndroidSync(null);
  });

  it("bootstraps remote state and publishes a checkpoint on empty startup", async () => {
    const doc = createPlanDoc();
    const bridge = { readCommands: vi.fn(async () => []), acknowledgeCommands: vi.fn(async () => undefined), writeSnapshot: vi.fn(async () => undefined), requestRefresh: vi.fn(async () => undefined) };
    const syncClient = {
      start: vi.fn(),
      stop: vi.fn(async () => undefined),
      enqueueCurrentState: vi.fn(async () => undefined),
      bootstrapInto: vi.fn(async () => ({ uploaded: 0, downloaded: 2, cursor: 2, status: "synced" as const })),
      syncOnce: vi.fn(async () => ({ uploaded: 1, downloaded: 1, cursor: 3, status: "synced" as const })),
    };
    const planStore = { updateCount: vi.fn(async () => 0), compact: vi.fn(), flush: vi.fn(async () => undefined) };
    configureAndroidSync({ doc, bridge, syncClient, planStore: planStore as never, today: () => "2026-08-04", isOnline: async () => true });
    const result = await runAndroidSync("startup");
    expect(result.downloaded).toBe(3);
    expect(syncClient.enqueueCurrentState).toHaveBeenCalledOnce();
    expect(syncClient.bootstrapInto).toHaveBeenCalledOnce();
    expect(syncClient.syncOnce).toHaveBeenCalledOnce();
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
      bootstrapInto: vi.fn(async () => ({ uploaded: 0, downloaded: 0, cursor: 0, status: "synced" as const })),
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

  it("captures a widget quick-add before the same headless run uploads", async () => {
    const doc = createPlanDoc();
    addTask(doc, { id: "existing", title: "Существующее", note: null, bucket: { kind: "date", date: "2026-08-04" }, parentId: null, order: 0, now: "2026-08-04T10:00:00.000Z" });
    const command = JSON.stringify({
      version: 1,
      kind: "create",
      id: "123e4567-e89b-42d3-a456-426614174020",
      taskId: "123e4567-e89b-42d3-a456-426614174021",
      title: "Из виджета",
      createdAt: "2026-08-04T11:00:00.000Z",
      createdOn: "2026-08-04",
    });
    const bridge = { readCommands: vi.fn(async () => [command]), acknowledgeCommands: vi.fn(async () => undefined), writeSnapshot: vi.fn(async () => undefined), requestRefresh: vi.fn(async () => undefined) };
    let pendingUpdates = 0;
    const syncClient = {
      start: vi.fn(() => { doc.on("update", () => { pendingUpdates += 1; }); }),
      stop: vi.fn(async () => undefined),
      enqueueCurrentState: vi.fn(async () => undefined),
      bootstrapInto: vi.fn(async () => ({ uploaded: 0, downloaded: 0, cursor: 0, status: "synced" as const })),
      syncOnce: vi.fn(async () => {
        const uploaded = pendingUpdates;
        pendingUpdates = 0;
        return { uploaded, downloaded: 0, cursor: uploaded, status: "synced" as const };
      }),
    };
    const planStore = { updateCount: vi.fn(async () => 1), compact: vi.fn(), flush: vi.fn(async () => undefined) };
    configureAndroidSync({ doc, bridge, syncClient, planStore: planStore as never, today: () => "2026-08-04", isOnline: async () => true });

    const result = await runAndroidSync("widget");

    expect(snapshotPlan(doc).tasks.map(({ title }) => title)).toEqual(["Из виджета", "Существующее"]);
    expect(result.commandsProcessed).toBe(1);
    expect(result.uploaded).toBeGreaterThan(0);
    expect(result.widgetStatus).toBe("synced");
    expect(bridge.acknowledgeCommands).toHaveBeenCalledWith(["123e4567-e89b-42d3-a456-426614174020"]);
    configureAndroidSync(null);
  });

  it("detects when remote bootstrap is required", () => {
    const doc = createPlanDoc();
    expect(needsRemoteBootstrap(doc)).toBe(true);
    addTask(doc, { id: "task", title: "Дело", note: null, bucket: { kind: "date", date: "2026-08-04" }, parentId: null, order: 0, now: "2026-08-04T10:00:00.000Z" });
    expect(needsRemoteBootstrap(doc)).toBe(false);
  });

  it("creates and closes a complete sync session without UI configuration", async () => {
    configureAndroidSync(null);
    const doc = createPlanDoc();
    addTask(doc, { id: "task", title: "Дело", note: null, bucket: { kind: "date", date: "2026-08-04" }, parentId: null, order: 0, now: "2026-08-04T10:00:00.000Z" });
    const destroy = vi.spyOn(doc, "destroy");
    const bridge = { readCommands: vi.fn(async () => []), acknowledgeCommands: vi.fn(async () => undefined), writeSnapshot: vi.fn(async () => undefined), requestRefresh: vi.fn(async () => undefined) };
    const syncClient = { start: vi.fn(), stop: vi.fn(async () => undefined), enqueueCurrentState: vi.fn(async () => undefined), bootstrapInto: vi.fn(), syncOnce: vi.fn() };
    const planStore = {
      load: vi.fn(async () => doc),
      updateCount: vi.fn(async () => 1),
      compact: vi.fn(),
      flush: vi.fn(async () => undefined),
      detachDoc: vi.fn(),
    };

    const result = await runHeadlessAndroidSync({
      loadVault: async () => ({ relayUrl: "https://relay.example", rootSecret: new Uint8Array(32) }),
      createPlanStore: () => planStore as never,
      createSyncClient: async () => syncClient,
      bridge,
      today: () => "2026-08-04",
      isOnline: async () => false,
    });

    expect(result?.reason).toBe("background");
    expect(result?.error).toBe("offline");
    expect(syncClient.start).toHaveBeenCalledWith(doc);
    expect(syncClient.stop).toHaveBeenCalledOnce();
    expect(planStore.flush).toHaveBeenCalled();
    expect(planStore.detachDoc).toHaveBeenCalledWith(doc);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("skips a headless session before the vault is configured", async () => {
    const createPlanStore = vi.fn();
    const result = await runHeadlessAndroidSync({
      loadVault: async () => null,
      createPlanStore,
      createSyncClient: vi.fn(),
      bridge: {} as never,
      today: () => "2026-08-04",
      isOnline: async () => true,
    });
    expect(result).toBeNull();
    expect(createPlanStore).not.toHaveBeenCalled();
  });
});
