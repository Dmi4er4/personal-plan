import type { Bucket } from "@personal-plan/core";
import { describe, expect, it } from "vitest";
import {
  bucketsEqual,
  flattenSections,
  resolveChildDropDestination,
  resolveDropDestination,
  sectionKey,
  taskBlocks,
  type ProjectedTask,
  type TimelineItem,
} from "../../src/ui/timeline-model";

function task(id: string, parentId: string | null = null): ProjectedTask {
  return {
    id,
    title: id,
    note: null,
    bucket: { kind: "date", date: "2026-08-06" },
    parentId,
    order: 0,
    completedAt: null,
    completedOn: null,
    childrenRevealedOn: null,
    prunedOn: null,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    deleted: false,
    deletedAt: null,
    deletedOn: null,
    sourceParentId: null,
    effectiveCompleted: false,
  };
}

const today: Bucket = { kind: "date", date: "2026-08-06" };
const tomorrow: Bucket = { kind: "date", date: "2026-08-07" };

function pick(items: TimelineItem[], ...indexes: number[]): TimelineItem[] {
  return indexes.map((index) => {
    const item = items[index];
    if (item === undefined) {
      throw new Error(`missing item at ${String(index)}`);
    }
    return item;
  });
}

describe("drag helpers", () => {
  it("builds stable section keys", () => {
    expect(sectionKey(today)).toBe("date:2026-08-06");
    expect(sectionKey({ kind: "later" })).toBe("later");
    expect(bucketsEqual(today, { kind: "date", date: "2026-08-06" })).toBe(true);
    expect(bucketsEqual(today, tomorrow)).toBe(false);
  });

  it("flattens sections into header + block items with stable keys", () => {
    const items = flattenSections([
      { bucket: today, tasks: [task("a"), task("a1", "a"), task("b")] },
      { bucket: tomorrow, tasks: [] },
    ]);
    expect(items.map((item) => item.key)).toEqual([
      "header:date:2026-08-06",
      "block:a",
      "block:b",
      "header:date:2026-08-07",
    ]);
    expect(items[0]).toMatchObject({ type: "header", bucket: today });
    const blockA = items[1];
    if (blockA === undefined || blockA.type !== "block") {
      throw new Error("expected a block item");
    }
    expect(blockA.block.tasks.map((t: ProjectedTask) => t.id)).toEqual(["a", "a1"]);
  });

  it("resolves a same-bucket reorder", () => {
    const items = flattenSections([
      { bucket: today, tasks: [task("a"), task("b"), task("c")] },
      { bucket: tomorrow, tasks: [task("d")] },
    ]);
    // Simulate DraggableFlatList's reordered data: c moved above a.
    const reordered = pick(items, 0, 3, 1, 2, 4, 5);
    expect(resolveDropDestination(reordered, "block:c")).toEqual({ bucket: today, index: 0 });
  });

  it("resolves a cross-bucket move to the destination index", () => {
    const items = flattenSections([
      { bucket: today, tasks: [task("a"), task("b")] },
      { bucket: tomorrow, tasks: [task("d"), task("e")] },
    ]);
    // a moved below d in tomorrow: [h_today, b, h_tomorrow, d, a, e]
    const reordered = pick(items, 0, 2, 3, 4, 1, 5);
    expect(resolveDropDestination(reordered, "block:a")).toEqual({ bucket: tomorrow, index: 1 });
  });

  it("resolves a drop at the very end to the last bucket append", () => {
    const items = flattenSections([
      { bucket: today, tasks: [task("a")] },
      { bucket: { kind: "later" }, tasks: [task("x"), task("y")] },
    ]);
    const reordered = pick(items, 0, 2, 3, 4, 1);
    expect(resolveDropDestination(reordered, "block:a")).toEqual({ bucket: { kind: "later" }, index: 2 });
  });

  it("resolves a drop into an empty section right after its header", () => {
    const items = flattenSections([
      { bucket: today, tasks: [task("a")] },
      { bucket: tomorrow, tasks: [] },
    ]);
    const reordered = pick(items, 0, 2, 1);
    expect(resolveDropDestination(reordered, "block:a")).toEqual({ bucket: tomorrow, index: 0 });
  });

  it("returns null when the dragged key is absent", () => {
    const items = flattenSections([{ bucket: today, tasks: [task("a")] }]);
    expect(resolveDropDestination(items, "block:missing")).toBeNull();
  });

  it("keeps taskBlocks grouping children under their parent", () => {
    const blocks = taskBlocks([task("a"), task("a1", "a"), task("b")]);
    expect(blocks.map((block) => block.parent.id)).toEqual(["a", "b"]);
    expect(blocks[0]?.tasks.map((t) => t.id)).toEqual(["a", "a1"]);
  });

  it("scopes a child drop to its current parent and bucket", () => {
    const block = taskBlocks([
      task("parent"),
      task("first", "parent"),
      task("second", "parent"),
    ])[0];
    if (block === undefined) throw new Error("expected a task block");

    expect(resolveChildDropDestination(block, "second", 0)).toEqual({
      bucket: today,
      index: 0,
      parentId: "parent",
      taskId: "second",
    });
    expect(resolveChildDropDestination(block, "other-parent-child", 0)).toBeNull();
  });
});
