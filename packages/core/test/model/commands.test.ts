import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  addTask,
  createPlanDoc,
  editTask,
  moveTask,
  projectPlan,
  promoteSubtask,
  removeTask,
  setTaskCompleted,
  snapshotPlan,
} from "../../src/index";

const monday = { kind: "date", date: "2026-08-03" } as const;
const tuesday = { kind: "date", date: "2026-08-04" } as const;

describe("task commands", () => {
  it("persists a parent reopen day without clearing completed child metadata", () => {
    const doc = createPlanDoc();
    addTask(doc, {
      id: "parent",
      title: "Parent",
      note: null,
      bucket: monday,
      parentId: null,
      order: 0,
      now: "2026-08-01T08:00:00.000Z",
    });
    addTask(doc, {
      id: "completed-child",
      title: "Completed child",
      note: null,
      bucket: monday,
      parentId: "parent",
      order: 0,
      now: "2026-08-01T08:01:00.000Z",
    });
    setTaskCompleted(doc, "completed-child", {
      completed: true,
      at: "2026-08-01T09:00:00.000Z",
      on: "2026-08-01",
    });
    setTaskCompleted(doc, "parent", {
      completed: true,
      at: "2026-08-02T09:00:00.000Z",
      on: "2026-08-02",
    });

    setTaskCompleted(doc, "parent", {
      completed: false,
      at: "2026-08-03T09:00:00.000Z",
      on: "2026-08-03",
    });

    const reopened = snapshotPlan(doc).tasks;
    expect(reopened).toMatchObject([
      {
        id: "parent",
        completedAt: null,
        completedOn: null,
        childrenRevealedOn: "2026-08-03",
      },
      {
        id: "completed-child",
        completedAt: "2026-08-01T09:00:00.000Z",
        completedOn: "2026-08-01",
        childrenRevealedOn: null,
      },
    ]);

    const reloaded = createPlanDoc();
    Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(doc));
    expect(snapshotPlan(reloaded).tasks[0]).toMatchObject({
      id: "parent",
      childrenRevealedOn: "2026-08-03",
    });

    setTaskCompleted(reloaded, "parent", {
      completed: true,
      at: "2026-08-03T10:00:00.000Z",
      on: "2026-08-03",
    });
    expect(snapshotPlan(reloaded).tasks[0]).toMatchObject({
      completedOn: "2026-08-03",
      childrenRevealedOn: null,
    });
    expect(snapshotPlan(reloaded).tasks[1]).toMatchObject({
      completedAt: "2026-08-01T09:00:00.000Z",
      completedOn: "2026-08-01",
    });
    expect(
      projectPlan(snapshotPlan(reloaded).tasks, "2026-08-04").history.map(
        ({ id }) => id,
      ),
    ).toEqual(["parent", "completed-child"]);
  });

  it("reads pre-marker task data with a neutral reopen state", () => {
    const doc = createPlanDoc();
    addTask(doc, {
      id: "legacy",
      title: "Legacy",
      note: null,
      bucket: monday,
      parentId: null,
      order: 0,
      now: "2026-08-01T08:00:00.000Z",
    });
    doc
      .getMap<Y.Map<unknown>>("tasks")
      .get("legacy")
      ?.delete("childrenRevealedOn");

    expect(snapshotPlan(doc).tasks[0]).toMatchObject({
      id: "legacy",
      childrenRevealedOn: null,
    });
  });

  it("heals a legacy task that has no completion fields when toggled", () => {
    const doc = createPlanDoc();
    addTask(doc, {
      id: "legacy-completion",
      title: "Legacy completion",
      note: null,
      bucket: monday,
      parentId: null,
      order: 0,
      now: "2026-08-01T08:00:00.000Z",
    });
    const map = doc.getMap<Y.Map<unknown>>("tasks").get("legacy-completion");
    map?.delete("completedAt");
    map?.delete("completedOn");

    expect(snapshotPlan(doc).diagnostics.map(({ code }) => code)).toContain("invalid_task_completedAt");
    expect(() => {
      setTaskCompleted(doc, "legacy-completion", {
        completed: true,
        at: "2026-08-12T10:00:00.000Z",
        on: "2026-08-12",
      });
    }).not.toThrow();
    expect(snapshotPlan(doc).records[0]).toMatchObject({
      completedAt: "2026-08-12T10:00:00.000Z",
      completedOn: "2026-08-12",
    });
  });

  it("moves newly completed tasks to the end once and preserves manual moves", () => {
    const doc = createPlanDoc();
    for (const [id, order] of [
      ["first", 0],
      ["second", 1],
      ["third", 2],
      ["fourth", 3],
    ] as const) {
      addTask(doc, {
        id,
        title: id,
        note: null,
        bucket: monday,
        parentId: null,
        order,
        now: "2026-08-03T08:00:00.000Z",
      });
    }

    setTaskCompleted(doc, "second", {
      completed: true,
      at: "2026-08-03T09:00:00.000Z",
      on: "2026-08-03",
    });
    expect(snapshotPlan(doc).tasks.map(({ id }) => id)).toEqual([
      "first",
      "third",
      "fourth",
      "second",
    ]);

    setTaskCompleted(doc, "fourth", {
      completed: true,
      at: "2026-08-03T09:01:00.000Z",
      on: "2026-08-03",
    });
    expect(snapshotPlan(doc).tasks.map(({ id }) => id)).toEqual([
      "first",
      "third",
      "second",
      "fourth",
    ]);

    moveTask(doc, "second", {
      bucket: monday,
      parentId: null,
      index: 0,
      now: "2026-08-03T09:02:00.000Z",
    });
    setTaskCompleted(doc, "second", {
      completed: true,
      at: "2026-08-03T09:03:00.000Z",
      on: "2026-08-03",
    });
    expect(snapshotPlan(doc).tasks.map(({ id }) => id)).toEqual([
      "second",
      "first",
      "third",
      "fourth",
    ]);
  });

  it("moves an overdue task to the end of today when completed", () => {
    const doc = createPlanDoc();
    addTask(doc, {
      id: "overdue",
      title: "Overdue",
      note: null,
      bucket: monday,
      parentId: null,
      order: 0,
      now: "2026-08-03T08:00:00.000Z",
    });
    addTask(doc, {
      id: "today",
      title: "Today",
      note: null,
      bucket: tuesday,
      parentId: null,
      order: 0,
      now: "2026-08-04T08:00:00.000Z",
    });

    setTaskCompleted(doc, "overdue", {
      completed: true,
      at: "2026-08-04T09:00:00.000Z",
      on: "2026-08-04",
    });

    expect(snapshotPlan(doc).tasks).toMatchObject([
      { id: "today", bucket: tuesday, order: 0, completedAt: null },
      { id: "overdue", bucket: tuesday, order: 1, completedOn: "2026-08-04" },
    ]);
  });

  it("moves a completed child to the end of its sibling list", () => {
    const doc = createPlanDoc();
    addTask(doc, {
      id: "parent",
      title: "Parent",
      note: null,
      bucket: monday,
      parentId: null,
      order: 0,
      now: "2026-08-03T08:00:00.000Z",
    });
    for (const [id, order] of [
      ["child-a", 0],
      ["child-b", 1],
      ["child-c", 2],
    ] as const) {
      addTask(doc, {
        id,
        title: id,
        note: null,
        bucket: monday,
        parentId: "parent",
        order,
        now: "2026-08-03T08:01:00.000Z",
      });
    }

    setTaskCompleted(doc, "child-b", {
      completed: true,
      at: "2026-08-03T09:00:00.000Z",
      on: "2026-08-03",
    });

    expect(snapshotPlan(doc).tasks.map(({ id }) => id)).toEqual([
      "parent",
      "child-a",
      "child-c",
      "child-b",
    ]);
  });

  it("creates a parent and child and completes only the child", () => {
    const doc = createPlanDoc();
    addTask(doc, {
      id: "pack",
      title: "Собраться",
      note: "выключить свет",
      bucket: monday,
      parentId: null,
      order: 0,
      now: "2026-08-03T08:00:00.000Z",
    });
    addTask(doc, {
      id: "socks",
      title: "Носки",
      note: null,
      bucket: monday,
      parentId: "pack",
      order: 0,
      now: "2026-08-03T08:01:00.000Z",
    });
    setTaskCompleted(doc, "socks", {
      completed: true,
      at: "2026-08-03T08:02:00.000Z",
      on: "2026-08-03",
    });

    expect(snapshotPlan(doc).tasks).toMatchObject([
      { id: "pack", parentId: null, completedAt: null },
      { id: "socks", parentId: "pack", completedOn: "2026-08-03" },
    ]);

    setTaskCompleted(doc, "socks", {
      completed: false,
      at: "2026-08-03T08:03:00.000Z",
      on: "2026-08-03",
    });
    expect(snapshotPlan(doc).tasks[1]).toMatchObject({
      completedAt: null,
      completedOn: null,
      updatedAt: "2026-08-03T08:03:00.000Z",
    });
  });

  it("rejects nesting deeper than one level", () => {
    const doc = createPlanDoc();
    addTask(doc, {
      id: "pack",
      title: "Собраться",
      note: null,
      bucket: monday,
      parentId: null,
      order: 0,
      now: "2026-08-03T08:00:00.000Z",
    });
    addTask(doc, {
      id: "socks",
      title: "Носки",
      note: null,
      bucket: monday,
      parentId: "pack",
      order: 0,
      now: "2026-08-03T08:01:00.000Z",
    });

    expect(() => {
      addTask(doc, {
        id: "left-sock",
        title: "Левый носок",
        note: null,
        bucket: monday,
        parentId: "socks",
        order: 0,
        now: "2026-08-03T08:02:00.000Z",
      });
    }).toThrow("nested_subtask");
  });

  it("moves a parent block and normalizes deterministic sibling order", () => {
    const doc = createPlanDoc();
    for (const [id, order] of [
      ["pack", 7],
      ["pay", 7],
      ["call", 2],
    ] as const) {
      addTask(doc, {
        id,
        title: id,
        note: null,
        bucket: monday,
        parentId: null,
        order,
        now: "2026-08-03T08:00:00.000Z",
      });
    }
    addTask(doc, {
      id: "socks",
      title: "Носки",
      note: null,
      bucket: monday,
      parentId: "pack",
      order: 4,
      now: "2026-08-03T08:01:00.000Z",
    });

    moveTask(doc, "pack", {
      bucket: tuesday,
      parentId: null,
      index: 0,
      now: "2026-08-03T08:03:00.000Z",
    });

    const tasks = snapshotPlan(doc).tasks;
    expect(tasks.map(({ id }) => id)).toEqual(["call", "pay", "pack", "socks"]);
    expect(tasks.filter(({ parentId }) => parentId === null)).toMatchObject([
      { id: "call", order: 0 },
      { id: "pay", order: 1 },
      { id: "pack", order: 0, bucket: tuesday },
    ]);
    expect(tasks.find(({ id }) => id === "socks")).toMatchObject({
      bucket: tuesday,
      parentId: "pack",
    });
  });

  it("edits text, promotes a child, and removes parent blocks atomically", () => {
    const doc = createPlanDoc();
    addTask(doc, {
      id: "pack",
      title: "pack",
      note: "old",
      bucket: monday,
      parentId: null,
      order: 0,
      now: "2026-08-03T08:00:00.000Z",
    });
    addTask(doc, {
      id: "socks",
      title: "socks",
      note: null,
      bucket: monday,
      parentId: "pack",
      order: 0,
      now: "2026-08-03T08:01:00.000Z",
    });
    editTask(doc, "pack", { title: "Pack", note: null });
    expect(snapshotPlan(doc).tasks[0]).toMatchObject({ title: "Pack", note: null });

    promoteSubtask(doc, "socks", {
      bucket: tuesday,
      parentId: null,
      index: 0,
      now: "2026-08-03T08:02:00.000Z",
    });
    expect(snapshotPlan(doc).tasks.find(({ id }) => id === "socks")).toMatchObject({
      parentId: null,
      bucket: tuesday,
      order: 0,
    });

    addTask(doc, {
      id: "charger",
      title: "charger",
      note: null,
      bucket: monday,
      parentId: "pack",
      order: 0,
      now: "2026-08-03T08:03:00.000Z",
    });
    let transactions = 0;
    doc.on("afterTransaction", () => {
      transactions += 1;
    });
    removeTask(doc, "pack");

    expect(transactions).toBe(1);
    expect(snapshotPlan(doc).tasks.map(({ id }) => id)).toEqual(["socks"]);
  });
});
