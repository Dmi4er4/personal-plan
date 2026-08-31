import {
  addTask,
  createPlanDoc,
  setTaskCompleted,
  snapshotPlan,
  type LocalDate,
} from "@personal-plan/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as Y from "yjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/app/App.js";
import type { PersistenceState, PlanStore } from "../../src/storage/plan-store.js";
import { openSettings } from "./open-settings.js";

class TimelineStore implements PlanStore {
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

function populatedStore(): TimelineStore {
  const store = new TimelineStore();
  addTask(store.doc, {
    id: "pack",
    title: "Собраться",
    note: "Выключить свет",
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
  setTaskCompleted(store.doc, "socks", {
    completed: true,
    at: "2026-08-03T08:02:00.000Z",
    on: "2026-08-03",
  });
  addTask(store.doc, {
    id: "pay",
    title: "Оплатить интернет",
    note: null,
    bucket: monday,
    parentId: null,
    order: 1,
    now: "2026-08-03T08:03:00.000Z",
  });
  setTaskCompleted(store.doc, "pay", {
    completed: true,
    at: "2026-08-03T08:04:00.000Z",
    on: "2026-08-03",
  });
  addTask(store.doc, {
    id: "receipt",
    title: "Сохранить квитанцию",
    note: null,
    bucket: monday,
    parentId: "pay",
    order: 0,
    now: "2026-08-03T08:05:00.000Z",
  });
  return store;
}

function historicalStore(): TimelineStore {
  const store = new TimelineStore();
  addTask(store.doc, {
    id: "active-parent",
    title: "Активный родитель",
    note: null,
    bucket: monday,
    parentId: null,
    order: 0,
    now: "2026-08-01T08:00:00.000Z",
  });
  addTask(store.doc, {
    id: "historical-child",
    title: "Старая подзадача",
    note: null,
    bucket: monday,
    parentId: "active-parent",
    order: 0,
    now: "2026-08-01T08:01:00.000Z",
  });
  setTaskCompleted(store.doc, "historical-child", {
    completed: true,
    at: "2026-08-02T08:02:00.000Z",
    on: "2026-08-02",
  });
  addTask(store.doc, {
    id: "completed-parent",
    title: "Завершённый родитель",
    note: null,
    bucket: { kind: "date", date: "2026-08-02" },
    parentId: null,
    order: 0,
    now: "2026-08-02T08:03:00.000Z",
  });
  addTask(store.doc, {
    id: "stored-open-child",
    title: "Незавершённая подзадача",
    note: null,
    bucket: { kind: "date", date: "2026-08-02" },
    parentId: "completed-parent",
    order: 0,
    now: "2026-08-02T08:04:00.000Z",
  });
  setTaskCompleted(store.doc, "completed-parent", {
    completed: true,
    at: "2026-08-02T08:05:00.000Z",
    on: "2026-08-02",
  });
  return store;
}

function completedBlockWithOldChildStore(): TimelineStore {
  const store = new TimelineStore();
  addTask(store.doc, {
    id: "completed-parent",
    title: "Завершённый родитель",
    note: null,
    bucket: { kind: "date", date: "2026-08-02" },
    parentId: null,
    order: 0,
    now: "2026-08-01T08:00:00.000Z",
  });
  addTask(store.doc, {
    id: "independently-completed-child",
    title: "Самостоятельно завершённая подзадача",
    note: null,
    bucket: { kind: "date", date: "2026-08-02" },
    parentId: "completed-parent",
    order: 0,
    now: "2026-08-01T08:01:00.000Z",
  });
  setTaskCompleted(store.doc, "independently-completed-child", {
    completed: true,
    at: "2026-08-01T09:00:00.000Z",
    on: "2026-08-01",
  });
  addTask(store.doc, {
    id: "stored-open-child",
    title: "Незавершённая подзадача",
    note: null,
    bucket: { kind: "date", date: "2026-08-02" },
    parentId: "completed-parent",
    order: 1,
    now: "2026-08-01T08:02:00.000Z",
  });
  setTaskCompleted(store.doc, "completed-parent", {
    completed: true,
    at: "2026-08-02T09:00:00.000Z",
    on: "2026-08-02",
  });
  return store;
}

function cloneTimelineStore(source: TimelineStore): TimelineStore {
  const clone = new TimelineStore();
  Y.applyUpdate(clone.doc, Y.encodeStateAsUpdate(source.doc));
  return clone;
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
});

describe("Timeline", () => {
  it("persists a completed child reveal across reload and expires it on D plus one", async () => {
    const user = userEvent.setup();
    const store = completedBlockWithOldChildStore();
    render(<App store={store} today={() => "2026-08-03"} />);

    await openSettings(user);
    const history = await screen.findByRole("region", { name: "История" });
    await user.click(
      within(history).getByRole("button", {
        name: "Вернуть из истории: Завершённый родитель",
      }),
    );
    await user.click(screen.getByRole("button", { name: "← Назад" }));

    const todaySection = screen.getByRole("region", {
      name: "Сегодня — пн, 3 августа",
    });
    expect(
      within(todaySection).getByRole("checkbox", {
        name: "Вернуть: Самостоятельно завершённая подзадача",
      }),
    ).toHaveAttribute("aria-checked", "true");
    expect(snapshotPlan(store.doc).tasks).toMatchObject([
      { id: "completed-parent", childrenRevealedOn: "2026-08-03" },
      {
        id: "independently-completed-child",
        completedAt: "2026-08-01T09:00:00.000Z",
        completedOn: "2026-08-01",
      },
      { id: "stored-open-child" },
    ]);

    const reloadedOnD = cloneTimelineStore(store);
    cleanup();
    render(<App store={reloadedOnD} today={() => "2026-08-03"} />);
    const reloadedToday = await screen.findByRole("region", {
      name: "Сегодня — пн, 3 августа",
    });
    expect(
      within(reloadedToday).getByRole("checkbox", {
        name: "Вернуть: Самостоятельно завершённая подзадача",
      }),
    ).toBeInTheDocument();

    const reloadedOnNextDay = cloneTimelineStore(reloadedOnD);
    cleanup();
    render(<App store={reloadedOnNextDay} today={() => "2026-08-04"} />);
    const nextDaySection = await screen.findByRole("region", {
      name: "Сегодня — вт, 4 августа",
    });
    expect(
      within(nextDaySection).queryByText("Самостоятельно завершённая подзадача"),
    ).not.toBeInTheDocument();
    await openSettings(user);
    const nextDayHistory = screen.getByRole("region", { name: "История" });
    const childReopen = within(nextDayHistory).getByRole("button", {
      name: "Вернуть из истории: Самостоятельно завершённая подзадача",
    });
    expect(childReopen).toBeEnabled();

    await user.click(childReopen);
    await user.click(screen.getByRole("button", { name: "← Назад" }));
    const todayOnNextDay = screen.getByRole("region", { name: "Сегодня — вт, 4 августа" });
    expect(
      within(todayOnNextDay).getByRole("checkbox", {
        name: "Завершить: Самостоятельно завершённая подзадача",
      }),
    ).toBeInTheDocument();
    expect(snapshotPlan(reloadedOnNextDay.doc).tasks).toMatchObject([
      { id: "completed-parent", completedAt: null, completedOn: null },
      {
        id: "independently-completed-child",
        parentId: "completed-parent",
        completedAt: null,
        completedOn: null,
      },
      { id: "stored-open-child", completedAt: null, completedOn: null },
    ]);
  });

  it("shows history in both views and reopens exact child and parent states", async () => {
    const user = userEvent.setup();
    const store = historicalStore();
    render(<App store={store} today={fixedToday} />);

    const todaySection = await screen.findByRole("region", {
      name: "Сегодня — пн, 3 августа",
    });
    await openSettings(user);
    const history = screen.getByRole("region", { name: "История" });
    expect(within(todaySection).queryByText("Старая подзадача")).not.toBeInTheDocument();
    expect(within(history).getByText("Родитель: Активный родитель")).toBeInTheDocument();
    expect(
      within(history).getByRole("button", {
        name: "Вернуть из истории: Старая подзадача",
      }),
    ).toBeEnabled();
    expect(
      within(history).getByRole("button", {
        name: "Вернуть из истории: Завершённый родитель",
      }),
    ).toBeEnabled();
    expect(
      within(history).queryByRole("button", {
        name: "Вернуть из истории: Незавершённая подзадача",
      }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "← Назад" }));
    await user.click(screen.getByRole("tab", { name: "Текст" }));
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Текст плана" })
        .value,
    ).not.toContain("Старая подзадача");
    await openSettings(user);
    expect(screen.getByRole("region", { name: "История" })).toBeVisible();
    await user.click(
      screen.getByRole("button", {
        name: "Вернуть из истории: Старая подзадача",
      }),
    );
    await user.click(screen.getByRole("button", { name: "← Назад" }));
    await user.click(screen.getByRole("tab", { name: "Список" }));
    const todayAfterReopen = screen.getByRole("region", {
      name: "Сегодня — пн, 3 августа",
    });
    expect(
      within(todayAfterReopen).getByRole("checkbox", {
        name: "Завершить: Старая подзадача",
      }),
    ).toBeInTheDocument();

    await openSettings(user);
    await user.click(
      screen.getByRole("button", {
        name: "Вернуть из истории: Завершённый родитель",
      }),
    );
    await user.click(screen.getByRole("button", { name: "← Назад" }));
    const todayAfterParentReopen = screen.getByRole("region", {
      name: "Сегодня — пн, 3 августа",
    });
    expect(
      within(todayAfterParentReopen).getByRole("checkbox", {
        name: "Завершить: Завершённый родитель",
      }),
    ).toBeInTheDocument();
    expect(
      within(todayAfterParentReopen).getByRole("checkbox", {
        name: "Завершить: Незавершённая подзадача",
      }),
    ).toBeInTheDocument();
  });

  it("renders own completion controls, effective styling, notes, and child depth", async () => {
    const user = userEvent.setup();
    render(<App store={populatedStore()} today={fixedToday} />);

    const packCheckbox = await screen.findByRole("checkbox", {
      name: "Завершить: Собраться",
    });
    const socksCheckbox = screen.getByRole("checkbox", { name: "Вернуть: Носки" });
    expect(screen.getByText("Выполненные (1)")).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "Вернуть: Оплатить интернет" }),
    ).not.toBeVisible();
    await user.click(screen.getByText("Выполненные (1)"));
    const payCheckbox = screen.getByRole("checkbox", {
      name: "Вернуть: Оплатить интернет",
    });

    expect(packCheckbox).toHaveAttribute("aria-checked", "false");
    expect(socksCheckbox).toHaveAttribute("aria-checked", "true");
    expect(payCheckbox).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("checkbox", { name: "Завершить: Сохранить квитанцию" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Носки")).toHaveClass("task-title--completed");
    expect(screen.getByText("Оплатить интернет")).toHaveClass(
      "task-title--completed",
    );
    expect(screen.getByText("Сохранить квитанцию")).toHaveClass(
      "task-title--completed",
    );
    expect(screen.getByText("Собраться")).not.toHaveClass("task-title--completed");
    expect(screen.getByText("Выключить свет")).toBeInTheDocument();

    const childRow = document.querySelector('[data-task-id="socks"]');
    expect(childRow).toHaveAttribute("data-depth", "1");
    expect(screen.queryByText("— Носки")).not.toBeInTheDocument();
  });

  it("toggles a task through its checkbox and keeps the text view equivalent", async () => {
    const user = userEvent.setup();
    const store = populatedStore();
    render(<App store={store} today={fixedToday} />);

    const checkbox = await screen.findByRole("checkbox", {
      name: "Завершить: Собраться",
    });
    await user.click(checkbox);

    await user.click(screen.getByText("Выполненные (2)"));
    expect(screen.getByRole("checkbox", { name: "Вернуть: Собраться" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(snapshotPlan(store.doc).tasks.find(({ id }) => id === "pack")).toMatchObject({
      completedOn: "2026-08-03",
    });
    const textValue = document.querySelector<HTMLTextAreaElement>("#plan-text")?.value;
    expect(textValue).toContain("+ Собраться: Выключить свет");
  });

  it("creates a top-level task under today on Enter and cancels on Escape", async () => {
    const user = userEvent.setup();
    const store = populatedStore();
    const randomUUID = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("10000000-0000-4000-8000-000000000001");
    render(<App store={store} today={fixedToday} />);

    const trigger = await screen.findByRole("button", { name: "Новое дело" });
    const todaySection = screen.getByRole("region", { name: "Сегодня — пн, 3 августа" });
    expect(
      trigger.compareDocumentPosition(todaySection) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(screen.queryByRole("button", { name: "+" })).not.toBeInTheDocument();

    await user.click(trigger);
    const titleInput = screen.getByRole("textbox", { name: "Название нового дела" });
    expect(titleInput).toHaveFocus();
    await user.type(titleInput, "Позвонить маме{Enter}");

    expect(randomUUID).toHaveBeenCalledOnce();
    expect(snapshotPlan(store.doc).tasks.find(({ id }) => id.startsWith("10000000"))).toMatchObject(
      {
        title: "Позвонить маме",
        note: null,
        bucket: monday,
        parentId: null,
        order: 0,
      },
    );
    expect(snapshotPlan(store.doc).tasks.filter(({ parentId }) => parentId === null).map(({ title }) => title)).toEqual([
      "Позвонить маме",
      "Собраться",
      "Оплатить интернет",
    ]);
    expect(screen.getByText("Позвонить маме")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Новое дело" }));
    const cancelledInput = screen.getByRole("textbox", { name: "Название нового дела" });
    await user.type(cancelledInput, "Не создавать{Escape}");

    expect(screen.queryByRole("textbox", { name: "Название нового дела" })).not.toBeInTheDocument();
    expect(screen.queryByText("Не создавать")).not.toBeInTheDocument();
    expect(snapshotPlan(store.doc).tasks).toHaveLength(5);
  });

  it("edits a task title and note after a double click", async () => {
    const user = userEvent.setup();
    const store = populatedStore();
    render(<App store={store} today={fixedToday} />);

    fireEvent.doubleClick(await screen.findByText("Собраться"));
    const title = screen.getByRole("textbox", { name: "Название дела" });
    const note = screen.getByRole("textbox", { name: "Пояснение дела" });
    await user.clear(title);
    await user.type(title, "Собрать рюкзак");
    await user.clear(note);
    await user.type(note, "Не забыть документы");
    await user.click(screen.getByRole("button", { name: "Сохранить изменения" }));

    expect(snapshotPlan(store.doc).tasks.find(({ id }) => id === "pack")).toMatchObject({
      title: "Собрать рюкзак",
      note: "Не забыть документы",
    });
    expect(screen.getByText("Собрать рюкзак")).toBeInTheDocument();
  });

  it("does not show a completed cut in a section without completed tasks", async () => {
    const store = new TimelineStore();
    addTask(store.doc, {
      id: "open",
      title: "Открытое дело",
      note: null,
      bucket: monday,
      parentId: null,
      order: 0,
      now: "2026-08-03T08:00:00.000Z",
    });
    render(<App store={store} today={fixedToday} />);

    expect(await screen.findByText("Открытое дело")).toBeInTheDocument();
    expect(screen.queryByText(/^Выполненные/u)).not.toBeInTheDocument();
  });

  it("creates directly in any selected section", async () => {
    const user = userEvent.setup();
    const store = populatedStore();
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("20000000-0000-4000-8000-000000000002");
    render(<App store={store} today={fixedToday} />);

    await user.click(await screen.findByRole("button", { name: "Новое дело" }));
    await user.click(screen.getByRole("button", { name: "Сильно позже" }));
    await user.type(screen.getByRole("textbox", { name: "Название нового дела" }), "Когда-нибудь потом{Enter}");

    expect(snapshotPlan(store.doc).tasks.find(({ id }) => id.startsWith("20000000"))).toMatchObject({
      bucket: { kind: "much-later" },
      title: "Когда-нибудь потом",
    });
  });

  it("opens the top editor for a pressed day and creates with the OK button", async () => {
    const user = userEvent.setup();
    const store = populatedStore();
    addTask(store.doc, {
      id: "tomorrow-existing",
      title: "Уже завтра",
      note: null,
      bucket: { kind: "date", date: "2026-08-04" },
      parentId: null,
      order: 0,
      now: "2026-08-03T09:00:00.000Z",
    });
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "30000000-0000-4000-8000-000000000003",
    );
    render(<App store={store} today={fixedToday} />);

    await user.click(
      await screen.findByRole("button", {
        name: "Добавить дело: Завтра — вт, 4 августа",
      }),
    );

    const titleInput = await screen.findByRole("textbox", { name: "Название нового дела" });
    expect(titleInput).toHaveFocus();
    expect(
      within(screen.getByRole("group", { name: "Раздел нового дела" })).getByRole(
        "button",
        { name: "Завтра" },
      ),
    ).toHaveAttribute("aria-pressed", "true");
    await user.type(titleInput, "Создано на завтра");
    const submit = screen.getByRole("button", { name: "Создать дело" });
    expect(submit).toHaveTextContent("ОК");
    await user.click(submit);

    expect(snapshotPlan(store.doc).tasks.find(({ id }) => id.startsWith("30000000"))).toMatchObject({
      bucket: { kind: "date", date: "2026-08-04" },
      title: "Создано на завтра",
    });
  });

  it("commits a pending deletion after exactly the two-second window", async () => {
    const store = populatedStore();
    render(<App store={store} today={fixedToday} />);
    const deleteButton = await screen.findByRole("button", { name: "Удалить: Собраться" });
    vi.useFakeTimers();

    fireEvent.click(deleteButton);
    expect(snapshotPlan(store.doc).records.find(({ id }) => id === "pack")?.deleted).toBe(false);
    act(() => { vi.advanceTimersByTime(1_999); });
    expect(snapshotPlan(store.doc).records.find(({ id }) => id === "pack")?.deleted).toBe(false);
    act(() => { vi.advanceTimersByTime(51); });
    expect(snapshotPlan(store.doc).records.find(({ id }) => id === "pack")?.deleted).toBe(true);
  });

  it("commits pending deletion immediately when leaving the list tab", async () => {
    const store = populatedStore();
    render(<App store={store} today={fixedToday} />);
    fireEvent.click(await screen.findByRole("button", { name: "Удалить: Собраться" }));

    expect(snapshotPlan(store.doc).records.find(({ id }) => id === "pack")?.deleted).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "Текст" }));
    expect(snapshotPlan(store.doc).records.find(({ id }) => id === "pack")?.deleted).toBe(true);
  });

  it("commits pending deletion immediately when the PWA goes to background", async () => {
    const store = populatedStore();
    render(<App store={store} today={fixedToday} />);
    fireEvent.click(await screen.findByRole("button", { name: "Удалить: Собраться" }));

    fireEvent(window, new Event("pagehide"));

    expect(snapshotPlan(store.doc).records.find(({ id }) => id === "pack")?.deleted).toBe(true);
  });

  it("keeps sections and tasks in projected order while hiding empty buckets", async () => {
    render(<App store={populatedStore()} today={fixedToday} />);

    const todaySection = await screen.findByRole("region", {
      name: "Сегодня — пн, 3 августа",
    });
    expect(
      within(todaySection).getByRole("checkbox", { name: "Завершить: Собраться" }),
    ).toBeVisible();
    expect(
      within(todaySection).getByRole("checkbox", { name: "Вернуть: Носки" }),
    ).toBeVisible();
    expect(
      within(todaySection).getByRole("checkbox", { name: "Вернуть: Оплатить интернет" }),
    ).not.toBeVisible();
    expect(
      within(todaySection).getByRole("checkbox", { name: "Завершить: Сохранить квитанцию" }),
    ).not.toBeVisible();
    expect(within(todaySection).getByText("Выполненные (1)")).toBeVisible();
    expect(document.querySelectorAll("[data-bucket-key]")).toHaveLength(1);
    expect(document.querySelector('[data-bucket-key="date:2026-08-03"]')).toBeInTheDocument();
  });
});
