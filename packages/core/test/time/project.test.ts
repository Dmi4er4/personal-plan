import { describe, expect, it } from "vitest";
import {
  InvalidLocalDateError,
  addDays,
  compareLocalDate,
  effectiveBucket,
  isEffectivelyCompleted,
  projectPlan,
  type Bucket,
  type TaskSnapshot,
} from "../../src/index";

function task(
  id: string,
  bucket: Bucket,
  overrides: Partial<TaskSnapshot> = {},
): TaskSnapshot {
  return {
    id,
    title: id,
    note: null,
    bucket,
    parentId: null,
    order: 0,
    completedAt: null,
    completedOn: null,
    childrenRevealedOn: null,
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-01T08:00:00.000Z",
    ...overrides,
  };
}

const augustSecond = { kind: "date", date: "2026-08-02" } as const;
const augustThird = { kind: "date", date: "2026-08-03" } as const;
const augustFourth = { kind: "date", date: "2026-08-04" } as const;

describe("time projection", () => {
  it("reveals stored completed children on the parent reopen day only", () => {
    const parent = task("parent", augustThird, {
      childrenRevealedOn: "2026-08-03",
    });
    const completedChild = task("completed-child", augustThird, {
      parentId: parent.id,
      completedAt: "2026-08-01T09:00:00.000Z",
      completedOn: "2026-08-01",
    });

    const reopenDay = projectPlan([parent, completedChild], "2026-08-03");

    expect(reopenDay.active[0]?.tasks).toMatchObject([
      { id: "parent", effectiveCompleted: false },
      {
        id: "completed-child",
        effectiveCompleted: true,
        completedAt: "2026-08-01T09:00:00.000Z",
        completedOn: "2026-08-01",
      },
    ]);
    expect(reopenDay.history).toEqual([]);

    const nextDay = projectPlan([parent, completedChild], "2026-08-04");
    expect(nextDay.active[0]?.tasks.map(({ id }) => id)).toEqual(["parent"]);
    expect(nextDay.history).toMatchObject([
      {
        id: "completed-child",
        parentId: "parent",
        completedAt: "2026-08-01T09:00:00.000Z",
        completedOn: "2026-08-01",
      },
    ]);
  });

  it("uses strict local-date calendar arithmetic across month and leap-day edges", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(compareLocalDate("2026-08-03", "2026-08-03")).toBe(0);
    expect(compareLocalDate("2026-08-02", "2026-08-03")).toBe(-1);
    expect(() => addDays("2026-02-30", 1)).toThrow(InvalidLocalDateError);
  });

  it("rolls overdue open blocks forward and applies completion downwards only", () => {
    const overdueOpen = task("overdue-open", augustSecond);
    const tomorrowOpen = task("tomorrow-open", augustFourth);
    const doneParent = task("done-parent", augustThird, {
      completedAt: "2026-08-03T09:00:00.000Z",
      completedOn: "2026-08-03",
    });
    const openChildOfDoneParent = task("open-child", augustThird, {
      parentId: doneParent.id,
    });
    const openParent = task("open-parent", augustFourth);
    const doneChildOfOpenParent = task("done-child", augustFourth, {
      parentId: openParent.id,
      completedAt: "2026-08-03T09:00:00.000Z",
      completedOn: "2026-08-03",
    });
    const secondDoneChild = task("second-done-child", augustFourth, {
      parentId: openParent.id,
      completedAt: "2026-08-03T09:01:00.000Z",
      completedOn: "2026-08-03",
    });
    const tasks = [
      overdueOpen,
      tomorrowOpen,
      doneParent,
      openChildOfDoneParent,
      openParent,
      doneChildOfOpenParent,
      secondDoneChild,
    ];
    const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]));

    expect(effectiveBucket(overdueOpen, byId, "2026-08-03")).toEqual({
      kind: "date",
      date: "2026-08-03",
    });
    expect(effectiveBucket(tomorrowOpen, byId, "2026-08-03")).toEqual({
      kind: "date",
      date: "2026-08-04",
    });
    expect(isEffectivelyCompleted(openChildOfDoneParent, byId)).toBe(true);
    expect(isEffectivelyCompleted(doneChildOfOpenParent, byId)).toBe(true);
    expect(isEffectivelyCompleted(openParent, byId)).toBe(false);
    expect(effectiveBucket(doneChildOfOpenParent, byId, "2026-08-03")).toEqual({
      kind: "date",
      date: "2026-08-04",
    });
  });

  it("projects seven dated sections, then undated sections, and separates old blocks", () => {
    const current = task("current", augustThird);
    const currentChild = task("current-child", augustThird, {
      parentId: current.id,
      completedAt: "2026-08-02T09:00:00.000Z",
      completedOn: "2026-08-02",
    });
    const completedToday = task("completed-today", augustSecond, {
      completedAt: "2026-08-03T09:00:00.000Z",
      completedOn: "2026-08-03",
    });
    const oldCompleted = task("old-completed", augustSecond, {
      completedAt: "2026-08-02T09:00:00.000Z",
      completedOn: "2026-08-02",
    });
    const oldChild = task("old-child", augustSecond, {
      parentId: oldCompleted.id,
    });
    const horizonEnd = task("horizon-end", {
      kind: "date",
      date: "2026-08-09",
    });
    const beyondHorizon = task("beyond-horizon", {
      kind: "date",
      date: "2026-08-10",
    });
    const later = task("later", { kind: "later" });
    const muchLater = task("much-later", { kind: "much-later" });

    const projection = projectPlan(
      [
        current,
        currentChild,
        completedToday,
        oldCompleted,
        oldChild,
        horizonEnd,
        beyondHorizon,
        later,
        muchLater,
      ],
      "2026-08-03",
    );

    expect(projection.active.map(({ bucket }) => bucket)).toEqual([
      { kind: "date", date: "2026-08-03" },
      { kind: "date", date: "2026-08-04" },
      { kind: "date", date: "2026-08-05" },
      { kind: "date", date: "2026-08-06" },
      { kind: "date", date: "2026-08-07" },
      { kind: "date", date: "2026-08-08" },
      { kind: "date", date: "2026-08-09" },
      { kind: "later" },
      { kind: "much-later" },
    ]);
    expect(projection.active[0]?.tasks).toMatchObject([
      { id: "current", effectiveCompleted: false },
      { id: "completed-today", effectiveCompleted: true },
    ]);
    expect(projection.active[6]?.tasks).toMatchObject([
      { id: "horizon-end", effectiveCompleted: false },
    ]);
    expect(projection.active[7]?.tasks).toMatchObject([
      { id: "later", effectiveCompleted: false },
    ]);
    expect(projection.active[8]?.tasks).toMatchObject([
      { id: "much-later", effectiveCompleted: false },
    ]);
    expect(projection.active.flatMap(({ tasks }) => tasks).map(({ id }) => id)).not.toContain(
      beyondHorizon.id,
    );
    expect(projection.history.map(({ id }) => id)).toEqual([
      "old-completed",
      "old-child",
      "current-child",
    ]);
  });

  it("keeps a completed child active through its local completion day only", () => {
    const parent = task("parent", augustThird);
    const completedYesterday = task("completed-yesterday", augustThird, {
      parentId: parent.id,
      order: 0,
      completedAt: "2026-08-02T09:00:00.000Z",
      completedOn: "2026-08-02",
    });
    const completedToday = task("completed-today-child", augustThird, {
      parentId: parent.id,
      order: 1,
      completedAt: "2026-08-03T09:00:00.000Z",
      completedOn: "2026-08-03",
    });
    const openChild = task("open-child", augustThird, {
      parentId: parent.id,
      order: 2,
    });

    const projection = projectPlan(
      [parent, completedYesterday, completedToday, openChild],
      "2026-08-03",
    );

    expect(projection.active[0]?.tasks.map(({ id }) => id)).toEqual([
      "parent",
      "completed-today-child",
      "open-child",
    ]);
    expect(projection.history).toMatchObject([
      {
        id: "completed-yesterday",
        parentId: "parent",
        completedOn: "2026-08-02",
      },
    ]);
  });

  it("orders historical parent blocks and standalone children by completion date", () => {
    const oldOpenParent = task("old-open-parent", augustThird, { order: 0 });
    const oldestStandaloneChild = task("oldest-child", augustThird, {
      parentId: oldOpenParent.id,
      completedAt: "2026-07-31T09:00:00.000Z",
      completedOn: "2026-07-31",
    });
    const completedParent = task("completed-parent", augustSecond, {
      order: 1,
      completedAt: "2026-08-02T09:00:00.000Z",
      completedOn: "2026-08-02",
    });
    const firstBlockChild = task("first-block-child", augustSecond, {
      parentId: completedParent.id,
      order: 0,
    });
    const secondBlockChild = task("second-block-child", augustSecond, {
      parentId: completedParent.id,
      order: 1,
      completedAt: "2026-08-01T09:00:00.000Z",
      completedOn: "2026-08-01",
    });
    const recentOpenParent = task("recent-open-parent", augustThird, { order: 2 });
    const recentStandaloneChild = task("recent-child", augustThird, {
      parentId: recentOpenParent.id,
      completedAt: "2026-08-02T10:00:00.000Z",
      completedOn: "2026-08-02",
    });

    const projection = projectPlan(
      [
        oldOpenParent,
        oldestStandaloneChild,
        completedParent,
        firstBlockChild,
        secondBlockChild,
        recentOpenParent,
        recentStandaloneChild,
      ],
      "2026-08-03",
    );

    expect(projection.history.map(({ id }) => id)).toEqual([
      "completed-parent",
      "first-block-child",
      "second-block-child",
      "recent-child",
      "oldest-child",
    ]);
  });
});
