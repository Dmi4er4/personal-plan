import {
  addTask,
  createPlanDoc,
  snapshotPlan,
  type LocalDate,
} from "@personal-plan/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/app/App.js";
import type { PersistenceState, PlanStore } from "../../src/storage/plan-store.js";

class DragStore implements PlanStore {
  readonly doc = createPlanDoc();

  load(): Promise<Y.Doc> {
    return Promise.resolve(this.doc);
  }

  loadDraft(): Promise<string | null> {
    return Promise.resolve(null);
  }

  saveDraft(): Promise<void> {
    return Promise.resolve();
  }

  clearDraft(): Promise<void> {
    return Promise.resolve();
  }

  getPersistenceState(): PersistenceState {
    return { error: null, status: "saved" };
  }

  subscribePersistence(listener: (state: PersistenceState) => void): () => void {
    listener(this.getPersistenceState());
    return () => undefined;
  }

  retryPersistence(): Promise<void> {
    return Promise.resolve();
  }

  destroy(): Promise<void> {
    return Promise.resolve();
  }
}

const fixedToday = (): LocalDate => "2026-08-03";
const monday = { kind: "date", date: "2026-08-03" } as const;

function dragStore(): DragStore {
  const store = new DragStore();
  addTask(store.doc, {
    id: "pack",
    title: "Собраться",
    note: null,
    bucket: monday,
    parentId: null,
    order: 0,
    now: "2026-08-03T08:00:00.000Z",
  });
  addTask(store.doc, {
    id: "socks",
    title: "Носки",
    note: null,
    bucket: monday,
    parentId: "pack",
    order: 0,
    now: "2026-08-03T08:01:00.000Z",
  });
  return store;
}

function rect(top: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: 640,
    top,
    width: 640,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const bucketKey = this.dataset.bucketKey;
    if (bucketKey !== undefined) {
      const keys = [
        "date:2026-08-03",
        "date:2026-08-04",
        "date:2026-08-05",
        "date:2026-08-06",
        "date:2026-08-07",
        "date:2026-08-08",
        "date:2026-08-09",
        "later",
        "much-later",
      ];
      return rect((keys.indexOf(bucketKey) + 1) * 120, 100);
    }

    const taskId = this.dataset.dragTaskId ?? this.dataset.taskId;
    if (taskId === "pack") {
      return rect(130, 55);
    }
    if (taskId === "socks") {
      return rect(188, 35);
    }
    if (taskId === "charger") {
      return rect(226, 35);
    }
    if (taskId === "errands") {
      return rect(226, 55);
    }
    if (taskId === "overdue") {
      return rect(130, 55);
    }
    if (taskId === "overdue-child") {
      return rect(188, 35);
    }
    return rect(0, 20);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Timeline dragging", () => {
  it("keyboard-drags a parent block with its children into tomorrow", async () => {
    const user = userEvent.setup();
    const store = dragStore();
    render(<App store={store} today={fixedToday} />);

    const handle = await screen.findByRole("button", { name: "Переместить: Собраться" });
    handle.focus();
    await user.keyboard(" ");

    const zones = document.querySelectorAll("[data-bucket-key]");
    expect(zones).toHaveLength(9);
    expect(
      Array.from(zones, (zone) => zone.getAttribute("data-bucket-key")),
    ).toEqual([
      "date:2026-08-03",
      "date:2026-08-04",
      "date:2026-08-05",
      "date:2026-08-06",
      "date:2026-08-07",
      "date:2026-08-08",
      "date:2026-08-09",
      "later",
      "much-later",
    ]);

    await user.keyboard("{ArrowDown}");
    await waitFor(() => {
      expect(document.querySelector('[data-bucket-key="date:2026-08-04"]')).toHaveClass(
        "timeline-section--over",
      );
    });
    await user.keyboard(" ");

    await waitFor(() => {
      const tasks = snapshotPlan(store.doc).tasks;
      expect(tasks.find(({ id }) => id === "pack")?.bucket).toEqual({
        kind: "date",
        date: "2026-08-04",
      });
      expect(tasks.find(({ id }) => id === "socks")?.bucket).toEqual({
        kind: "date",
        date: "2026-08-04",
      });
    });
    expect(document.querySelectorAll("[data-bucket-key]")).toHaveLength(2);
  });

  it("does not allow a child to drop directly into another date", async () => {
    const user = userEvent.setup();
    const store = dragStore();
    render(<App store={store} today={fixedToday} />);

    const handle = await screen.findByRole("button", { name: "Переместить: Носки" });
    handle.focus();
    await user.keyboard(" ");
    expect(document.querySelector('[data-bucket-key="date:2026-08-04"]')).toBeInTheDocument();

    await user.keyboard("{ArrowDown}");
    await user.keyboard(" ");

    const child = snapshotPlan(store.doc).tasks.find(({ id }) => id === "socks");
    expect(child).toMatchObject({
      bucket: monday,
      parentId: "pack",
      order: 0,
    });
  });

  it("keyboard-sorts children only among siblings of their current parent", async () => {
    const user = userEvent.setup();
    const store = dragStore();
    addTask(store.doc, {
      id: "charger",
      title: "Зарядка",
      note: null,
      bucket: monday,
      parentId: "pack",
      order: 1,
      now: "2026-08-03T08:02:00.000Z",
    });
    render(<App store={store} today={fixedToday} />);

    const handle = await screen.findByRole("button", { name: "Переместить: Носки" });
    handle.focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowDown}");
    await user.keyboard(" ");

    expect(
      snapshotPlan(store.doc).tasks
        .filter(({ parentId }) => parentId === "pack")
        .map(({ id }) => id),
    ).toEqual(["charger", "socks"]);
    expect(snapshotPlan(store.doc).tasks.find(({ id }) => id === "socks")).toMatchObject({
      bucket: monday,
      parentId: "pack",
    });
  });

  it("does not move a parent when a pointer is released outside every drop target", async () => {
    const store = dragStore();
    render(<App store={store} today={fixedToday} />);

    const handle = await screen.findByRole("button", { name: "Переместить: Собраться" });
    fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 620,
      clientY: 150,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(document, {
      clientX: 2_000,
      clientY: 2_000,
      isPrimary: true,
      pointerId: 1,
    });
    await waitFor(() => {
      expect(document.querySelectorAll("[data-bucket-key]")).toHaveLength(9);
    });
    fireEvent.pointerUp(document, {
      clientX: 2_000,
      clientY: 2_000,
      isPrimary: true,
      pointerId: 1,
    });

    await waitFor(() => {
      expect(document.querySelectorAll("[data-bucket-key]")).toHaveLength(1);
    });
    expect(snapshotPlan(store.doc).tasks.find(({ id }) => id === "pack")).toMatchObject({
      bucket: monday,
      order: 0,
    });
    expect(snapshotPlan(store.doc).tasks.find(({ id }) => id === "socks")).toMatchObject({
      bucket: monday,
      parentId: "pack",
    });
  });

  it("explicitly rewrites an overdue projected parent block to today's stored bucket", async () => {
    const user = userEvent.setup();
    const store = new DragStore();
    const sunday = { kind: "date", date: "2026-08-02" } as const;
    addTask(store.doc, {
      id: "overdue",
      title: "Просроченное",
      note: null,
      bucket: sunday,
      parentId: null,
      order: 0,
      now: "2026-08-02T08:00:00.000Z",
    });
    addTask(store.doc, {
      id: "overdue-child",
      title: "Подзадача",
      note: null,
      bucket: sunday,
      parentId: "overdue",
      order: 0,
      now: "2026-08-02T08:01:00.000Z",
    });
    render(<App store={store} today={fixedToday} />);

    expect(snapshotPlan(store.doc).tasks.find(({ id }) => id === "overdue")?.bucket).toEqual(
      sunday,
    );
    expect(
      snapshotPlan(store.doc).tasks.find(({ id }) => id === "overdue-child")?.bucket,
    ).toEqual(sunday);
    const handle = await screen.findByRole("button", { name: "Переместить: Просроченное" });
    handle.focus();
    await user.keyboard(" ");
    await waitFor(() => {
      expect(document.querySelector('[data-bucket-key="date:2026-08-03"]')).toHaveClass(
        "timeline-section--over",
      );
    });
    await user.keyboard(" ");

    await waitFor(() => {
      expect(snapshotPlan(store.doc).tasks.find(({ id }) => id === "overdue")?.bucket).toEqual(
        monday,
      );
      expect(
        snapshotPlan(store.doc).tasks.find(({ id }) => id === "overdue-child")?.bucket,
      ).toEqual(monday);
    });
  });

  it("keyboard-reorders top-level siblings inside their current bucket", async () => {
    const user = userEvent.setup();
    const store = dragStore();
    addTask(store.doc, {
      id: "errands",
      title: "Поручения",
      note: null,
      bucket: monday,
      parentId: null,
      order: 1,
      now: "2026-08-03T08:02:00.000Z",
    });
    render(<App store={store} today={fixedToday} />);

    const handle = await screen.findByRole("button", { name: "Переместить: Собраться" });
    handle.focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowDown}");
    await user.keyboard(" ");

    expect(
      snapshotPlan(store.doc).tasks
        .filter(({ parentId }) => parentId === null)
        .map(({ id }) => id),
    ).toEqual(["errands", "pack"]);
    expect(snapshotPlan(store.doc).tasks.find(({ id }) => id === "pack")?.bucket).toEqual(
      monday,
    );
    expect(snapshotPlan(store.doc).tasks.find(({ id }) => id === "errands")?.bucket).toEqual(
      monday,
    );
  });
});
