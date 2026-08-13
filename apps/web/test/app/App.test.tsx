import {
  addTask,
  createPlanDoc,
  setTaskCompleted,
  snapshotPlan,
  type LocalDate,
} from "@personal-plan/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as Y from "yjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/app/App.js";
import type { PersistenceState, PlanStore } from "../../src/storage/plan-store.js";
import { openSettings } from "../ui/open-settings.js";

class InMemoryPlanStore implements PlanStore {
  readonly doc = createPlanDoc();
  #draft: string | null = null;
  destroyCallCount = 0;

  load(): Promise<Y.Doc> {
    return Promise.resolve(this.doc);
  }

  loadDraft(): Promise<string | null> {
    return Promise.resolve(this.#draft);
  }

  saveDraft(value: string): Promise<void> {
    this.#draft = value;
    return Promise.resolve();
  }

  clearDraft(): Promise<void> {
    this.#draft = null;
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
    this.destroyCallCount += 1;
    return Promise.resolve();
  }
}

class FailingPlanStore extends InMemoryPlanStore {
  override load(): Promise<Y.Doc> {
    return Promise.reject(new Error("database unavailable"));
  }
}

const fixedToday = (): LocalDate => "2026-08-03";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("App", () => {
  it("requires explicit confirmation before deleting the local plan", async () => {
    const user = userEvent.setup();
    const onResetLocalData = vi.fn();
    render(<App onResetLocalData={onResetLocalData} store={new InMemoryPlanStore()} today={fixedToday} />);

    await openSettings(user);
    await user.click(screen.getByRole("button", { name: "Удалить план и создать новое хранилище" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/без возможности отмены/u);

    await user.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Удалить план и создать новое хранилище" }));
    await user.click(screen.getByRole("button", { name: "Да, удалить всё" }));
    expect(onResetLocalData).toHaveBeenCalledTimes(1);
  });

  it("requires explicit confirmation before replacing the local plan from the server", async () => {
    const user = userEvent.setup();
    const onRestoreServerData = vi.fn();
    render(<App onRestoreServerData={onRestoreServerData} store={new InMemoryPlanStore()} today={fixedToday} />);

    await openSettings(user);
    await user.click(screen.getByRole("button", { name: "Заменить локальный план данными с сервера" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/изменения на этом Mac будут потеряны/u);

    await user.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Заменить локальный план данными с сервера" }));
    await user.click(screen.getByRole("button", { name: "Да, заменить локальный план" }));
    expect(onRestoreServerData).toHaveBeenCalledTimes(1);
  });

  it("renders the two-tab shell with the list selected by default", async () => {
    const user = userEvent.setup();
    render(<App store={new InMemoryPlanStore()} today={fixedToday} />);

    const listTab = await screen.findByRole("tab", { name: "Список" });
    const textTab = screen.getByRole("tab", { name: "Текст" });

    expect(listTab).toHaveAttribute("aria-selected", "true");
    expect(textTab).toHaveAttribute("aria-selected", "false");
    await openSettings(user);
    expect(screen.getByText("сохранено на устройстве")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "← Назад" }));

    await user.click(screen.getByRole("tab", { name: "Текст" }));
    expect(screen.getByRole("tab", { name: "Текст" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Текст" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Список" })).toHaveAttribute("tabindex", "-1");
  });

  it("selects and focuses tabs with arrow, Home, and End keys", async () => {
    const user = userEvent.setup();
    render(<App store={new InMemoryPlanStore()} today={fixedToday} />);

    const listTab = await screen.findByRole("tab", { name: "Список" });
    const textTab = screen.getByRole("tab", { name: "Текст" });
    listTab.focus();

    await user.keyboard("{ArrowRight}");
    expect(textTab).toHaveFocus();
    expect(textTab).toHaveAttribute("aria-selected", "true");
    expect(textTab).toHaveAttribute("tabindex", "0");
    expect(listTab).toHaveAttribute("tabindex", "-1");

    await user.keyboard("{ArrowRight}");
    expect(listTab).toHaveFocus();
    expect(listTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowLeft}");
    expect(textTab).toHaveFocus();
    expect(textTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Home}");
    expect(listTab).toHaveFocus();
    expect(listTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{End}");
    expect(textTab).toHaveFocus();
    expect(textTab).toHaveAttribute("aria-selected", "true");
  });

  it("keeps both ARIA-controlled panels mounted and hides only the inactive one", async () => {
    const user = userEvent.setup();
    render(<App store={new InMemoryPlanStore()} today={fixedToday} />);

    const listTab = await screen.findByRole("tab", { name: "Список" });
    const textTab = screen.getByRole("tab", { name: "Текст" });
    const listPanel = document.querySelector("#list-panel");
    const textPanel = document.querySelector("#text-panel");

    expect(listPanel).toBeInTheDocument();
    expect(textPanel).toBeInTheDocument();
    expect(listTab).toHaveAttribute("aria-controls", "list-panel");
    expect(textTab).toHaveAttribute("aria-controls", "text-panel");
    expect(listPanel).toHaveAttribute("aria-labelledby", "list-tab");
    expect(textPanel).toHaveAttribute("aria-labelledby", "text-tab");
    expect(listPanel).not.toHaveAttribute("hidden");
    expect(textPanel).toHaveAttribute("hidden");

    listTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(listPanel).toHaveAttribute("hidden");
    expect(textPanel).not.toHaveAttribute("hidden");
  });

  it("removes the Y.Doc observer and destroys the store on unmount", async () => {
    const store = new InMemoryPlanStore();
    const off = vi.spyOn(store.doc, "off");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const clearTimeout = vi.spyOn(window, "clearTimeout");
    const { unmount } = render(<App store={store} today={fixedToday} />);
    await screen.findByRole("tab", { name: "Список" });

    unmount();

    expect(off).toHaveBeenCalledWith("update", expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith("focus", expect.any(Function));
    expect(removeDocumentListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    expect(clearTimeout).toHaveBeenCalled();
    expect(store.destroyCallCount).toBe(1);
  });

  it("shows a local loading error instead of rendering a broken context", async () => {
    render(<App store={new FailingPlanStore()} today={fixedToday} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось открыть локальный план: database unavailable",
    );
  });

  it("refreshes at local midnight, prunes once per date, and completes on the new day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 3, 23, 59, 59, 900));
    let localToday: LocalDate = "2026-08-03";
    const store = new InMemoryPlanStore();
    addTask(store.doc, {
      id: "rollover-task",
      title: "Перенести через полночь",
      note: null,
      bucket: { kind: "date", date: "2026-08-03" },
      parentId: null,
      order: 0,
      now: "2026-08-03T08:00:00.000Z",
    });
    addTask(store.doc, {
      id: "completed-today",
      title: "Завершено сегодня",
      note: null,
      bucket: { kind: "date", date: "2026-08-03" },
      parentId: null,
      order: 1,
      now: "2026-08-03T08:01:00.000Z",
    });
    setTaskCompleted(store.doc, "completed-today", {
      completed: true,
      at: "2026-08-03T08:02:00.000Z",
      on: "2026-08-03",
    });
    addTask(store.doc, {
      id: "prune-parent",
      title: "Родитель очистки",
      note: null,
      bucket: { kind: "date", date: "2026-07-04" },
      parentId: null,
      order: 0,
      now: "2026-07-04T08:00:00.000Z",
    });
    addTask(store.doc, {
      id: "prune-on-rollover",
      title: "Удалить после полуночи",
      note: null,
      bucket: { kind: "date", date: "2026-07-04" },
      parentId: "prune-parent",
      order: 0,
      now: "2026-07-04T08:01:00.000Z",
    });
    setTaskCompleted(store.doc, "prune-on-rollover", {
      completed: true,
      at: "2026-07-04T08:02:00.000Z",
      on: "2026-07-04",
    });
    let transactions = 0;
    store.doc.on("afterTransaction", () => {
      transactions += 1;
    });

    render(
      <App
        clock={() => new Date()}
        store={store}
        today={() => localToday}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      screen.getByRole("region", { name: "Сегодня — пн, 3 августа" }),
    ).toBeInTheDocument();
    expect(snapshotPlan(store.doc).tasks.map(({ id }) => id)).toContain(
      "prune-on-rollover",
    );

    localToday = "2026-08-04";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const newToday = screen.getByRole("region", { name: "Сегодня — вт, 4 августа" });
    expect(within(newToday).getByText("Перенести через полночь")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Меню" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Настройки" }));
    expect(
      within(screen.getByRole("region", { name: "История" })).getByText(
        "Завершено сегодня",
      ),
    ).toBeInTheDocument();
    expect(snapshotPlan(store.doc).tasks.map(({ id }) => id)).not.toContain(
      "prune-on-rollover",
    );
    fireEvent.click(screen.getByRole("button", { name: "← Назад" }));
    const newTodayAfterSettings = screen.getByRole("region", { name: "Сегодня — вт, 4 августа" });
    const afterRolloverTransactions = transactions;

    fireEvent.click(
      within(newTodayAfterSettings).getByRole("checkbox", {
        name: "Завершить: Перенести через полночь",
      }),
    );
    expect(snapshotPlan(store.doc).tasks.find(({ id }) => id === "rollover-task"))
      .toMatchObject({ completedOn: "2026-08-04" });

    const afterCompletionTransactions = transactions;
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(transactions).toBe(afterCompletionTransactions);
    expect(afterRolloverTransactions).toBeGreaterThan(0);
  });

  it("refreshes the local date on focus before the next scheduled midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 3, 12, 0, 0, 0));
    let localToday: LocalDate = "2026-08-03";
    const store = new InMemoryPlanStore();

    render(
      <App
        clock={() => new Date()}
        store={store}
        today={() => localToday}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      screen.getByRole("region", { name: "Сегодня — пн, 3 августа" }),
    ).toBeInTheDocument();

    localToday = "2026-08-04";
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(
      screen.getByRole("region", { name: "Сегодня — вт, 4 августа" }),
    ).toBeInTheDocument();

    localToday = "2026-08-05";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(
      screen.getByRole("region", { name: "Сегодня — ср, 5 августа" }),
    ).toBeInTheDocument();
  });
});
