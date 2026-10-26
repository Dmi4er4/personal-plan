import { addTask, createPlanDoc } from "@personal-plan/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { writeWidgetSnapshot } from "../../src/widget/write-widget-snapshot";
import type { WidgetSnapshot } from "../../src/widget/contracts";

const docs: Y.Doc[] = [];
function plan() {
  const doc = createPlanDoc();
  docs.push(doc);
  addTask(doc, { id: "task", title: "Дело", note: null, bucket: { kind: "date", date: "2026-08-04" }, parentId: null, order: 0, now: "2026-08-04T10:00:00.000Z" });
  return doc;
}
function widgetBridge() {
  return { readCommands: vi.fn(async () => []), acknowledgeCommands: vi.fn(async () => undefined), writeSnapshot: vi.fn<(json: string) => Promise<void>>().mockResolvedValue(undefined), requestRefresh: vi.fn(async () => undefined) };
}
afterEach(() => { for (const doc of docs.splice(0)) doc.destroy(); });

describe("widget snapshot refreshes", () => {
  it("skips identical polls, but refreshes after deletion, a day change or a status change", async () => {
    const doc = plan();
    const bridge = widgetBridge();
    await writeWidgetSnapshot(doc, bridge, "2026-08-04", "synced");
    await writeWidgetSnapshot(doc, bridge, "2026-08-04", "synced");
    expect(bridge.writeSnapshot).toHaveBeenCalledTimes(1);

    // A pure text deletion need not advance a Yjs state vector.
    const title = doc.getMap<Y.Map<unknown>>("tasks").get("task")?.get("title") as Y.Text;
    title.delete(0, 1);
    await writeWidgetSnapshot(doc, bridge, "2026-08-04", "synced");
    const written = JSON.parse(bridge.writeSnapshot.mock.calls[1]?.[0] ?? "{}") as WidgetSnapshot;
    expect(written.sections[0]?.tasks[0]?.title).toBe("ело");
    await writeWidgetSnapshot(doc, bridge, "2026-08-05", "synced");
    await writeWidgetSnapshot(doc, bridge, "2026-08-05", "offline");
    expect(bridge.writeSnapshot).toHaveBeenCalledTimes(4);
  });

  it("retries an unsuccessful native write instead of caching it", async () => {
    const doc = plan();
    const bridge = widgetBridge();
    bridge.writeSnapshot.mockRejectedValueOnce(new Error("native write failed"));
    await expect(writeWidgetSnapshot(doc, bridge, "2026-08-04", "synced")).rejects.toThrow("native write failed");
    await writeWidgetSnapshot(doc, bridge, "2026-08-04", "synced");
    expect(bridge.writeSnapshot).toHaveBeenCalledTimes(2);
    expect(bridge.requestRefresh).toHaveBeenCalledTimes(1);
  });

  it("finishes overlapping status snapshots in request order", async () => {
    const doc = plan();
    const bridge = widgetBridge();
    let release: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const statuses: string[] = [];
    bridge.writeSnapshot.mockImplementation(async (json: string) => {
      statuses.push((JSON.parse(json) as WidgetSnapshot).syncState);
      if (statuses.length === 1) await barrier;
    });
    const first = writeWidgetSnapshot(doc, bridge, "2026-08-04", "pending");
    await vi.waitFor(() => expect(statuses).toEqual(["pending"]));
    const second = writeWidgetSnapshot(doc, bridge, "2026-08-04", "synced");
    await Promise.resolve();
    expect(statuses).toEqual(["pending"]);
    release();
    await Promise.all([first, second]);
    expect(statuses).toEqual(["pending", "synced"]);
  });
});
