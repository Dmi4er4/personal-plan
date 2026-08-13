import { describe, expect, it } from "vitest";
import {
  addTask,
  createPlanDoc,
  pruneExpiredHistory,
  setTaskCompleted,
  snapshotPlan,
} from "../../src/index";

const julyFourth = { kind: "date", date: "2026-07-04" } as const;
const julyFifth = { kind: "date", date: "2026-07-05" } as const;

describe("history pruning", () => {
  it("keeps a parent completed exactly thirty days ago across a timezone transition", () => {
    const doc = createPlanDoc();
    addTask(doc, {
      id: "norfolk-boundary-parent",
      title: "norfolk-boundary-parent",
      note: null,
      bucket: { kind: "date", date: "2026-09-15" },
      parentId: null,
      order: 0,
      now: "2026-09-15T08:00:00.000Z",
    });
    setTaskCompleted(doc, "norfolk-boundary-parent", {
      completed: true,
      at: "2026-09-15T09:00:00.000Z",
      on: "2026-09-15",
    });

    pruneExpiredHistory(doc, "2026-10-15");

    expect(snapshotPlan(doc).tasks.map(({ id }) => id)).toEqual([
      "norfolk-boundary-parent",
    ]);
  });

  it("deletes only completed parent blocks older than thirty calendar days", () => {
    const doc = createPlanDoc();
    addTask(doc, {
      id: "expired-parent",
      title: "expired-parent",
      note: null,
      bucket: julyFourth,
      parentId: null,
      order: 0,
      now: "2026-07-04T08:00:00.000Z",
    });
    addTask(doc, {
      id: "expired-child",
      title: "expired-child",
      note: null,
      bucket: julyFourth,
      parentId: "expired-parent",
      order: 0,
      now: "2026-07-04T08:01:00.000Z",
    });
    setTaskCompleted(doc, "expired-parent", {
      completed: true,
      at: "2026-07-04T09:00:00.000Z",
      on: "2026-07-04",
    });

    addTask(doc, {
      id: "boundary-parent",
      title: "boundary-parent",
      note: null,
      bucket: julyFifth,
      parentId: null,
      order: 0,
      now: "2026-07-05T08:00:00.000Z",
    });
    addTask(doc, {
      id: "boundary-child",
      title: "boundary-child",
      note: null,
      bucket: julyFifth,
      parentId: "boundary-parent",
      order: 0,
      now: "2026-07-05T08:01:00.000Z",
    });
    setTaskCompleted(doc, "boundary-parent", {
      completed: true,
      at: "2026-07-05T09:00:00.000Z",
      on: "2026-07-05",
    });

    addTask(doc, {
      id: "open-parent",
      title: "open-parent",
      note: null,
      bucket: julyFifth,
      parentId: null,
      order: 1,
      now: "2026-07-05T10:00:00.000Z",
    });
    addTask(doc, {
      id: "old-completed-child",
      title: "old-completed-child",
      note: null,
      bucket: julyFifth,
      parentId: "open-parent",
      order: 0,
      now: "2026-07-05T10:01:00.000Z",
    });
    setTaskCompleted(doc, "old-completed-child", {
      completed: true,
      at: "2026-07-04T10:02:00.000Z",
      on: "2026-07-04",
    });

    pruneExpiredHistory(doc, "2026-08-04");

    expect(snapshotPlan(doc).tasks.map(({ id }) => id)).toEqual([
      "boundary-parent",
      "boundary-child",
      "open-parent",
    ]);
  });

  it("keeps an independently completed child exactly thirty days and prunes it alone after", () => {
    const doc = createPlanDoc();
    addTask(doc, {
      id: "open-parent",
      title: "open-parent",
      note: null,
      bucket: julyFifth,
      parentId: null,
      order: 0,
      now: "2026-07-05T08:00:00.000Z",
    });
    addTask(doc, {
      id: "boundary-child",
      title: "boundary-child",
      note: null,
      bucket: julyFifth,
      parentId: "open-parent",
      order: 0,
      now: "2026-07-05T08:01:00.000Z",
    });
    setTaskCompleted(doc, "boundary-child", {
      completed: true,
      at: "2026-07-05T09:00:00.000Z",
      on: "2026-07-05",
    });

    pruneExpiredHistory(doc, "2026-08-04");
    expect(snapshotPlan(doc).tasks.map(({ id }) => id)).toEqual([
      "open-parent",
      "boundary-child",
    ]);

    pruneExpiredHistory(doc, "2026-08-05");
    expect(snapshotPlan(doc).tasks.map(({ id }) => id)).toEqual(["open-parent"]);
  });
});
