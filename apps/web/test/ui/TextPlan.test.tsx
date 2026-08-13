import {
  addTask,
  createPlanDoc,
  editTask,
  projectPlan,
  removeTask,
  serializePlan,
  setTaskCompleted,
  snapshotPlan,
  type LocalDate,
} from "@personal-plan/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as Y from "yjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/app/App.js";
import type { PersistenceState, PlanStore } from "../../src/storage/plan-store.js";

const today = { kind: "date", date: "2026-08-03" } as const;
const fixedToday = (): LocalDate => "2026-08-03";

class TextPlanStore implements PlanStore {
  readonly doc = createPlanDoc();
  draft: string | null = null;
  readonly saveDraft = vi.fn((value: string): Promise<void> => {
    this.draft = value;
    return Promise.resolve();
  });
  readonly clearDraft = vi.fn((): Promise<void> => {
    this.draft = null;
    return Promise.resolve();
  });

  load(): Promise<Y.Doc> {
    return Promise.resolve(this.doc);
  }

  loadDraft(): Promise<string | null> {
    return Promise.resolve(this.draft);
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

function addTasks(store: TextPlanStore, count: number): void {
  for (let index = 0; index < count; index += 1) {
    addTask(store.doc, {
      id: `task-${String(index)}`,
      title: index === 0 ? "Купить корм" : `Дело ${String(index)}`,
      note: null,
      bucket: today,
      parentId: null,
      order: index,
      now: "2026-08-03T08:00:00.000Z",
    });
  }
}

async function openText(store: TextPlanStore): Promise<HTMLTextAreaElement> {
  render(<App store={store} today={fixedToday} />);
  fireEvent.click(await screen.findByRole("tab", { name: "Текст" }));
  const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Текст плана",
  });
  vi.useFakeTimers();
  return textarea;
}

async function advance(milliseconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TextPlan", () => {
  it("persists every edit and auto-applies a safe preview after exactly 400 ms", async () => {
    const store = new TextPlanStore();
    addTasks(store, 1);
    let transactions = 0;
    store.doc.on("afterTransaction", () => {
      transactions += 1;
    });
    const textarea = await openText(store);
    const edited = textarea.value.replace("Купить корм", "Купить корм коту");

    fireEvent.change(textarea, { target: { value: edited } });

    expect(store.saveDraft).toHaveBeenCalledTimes(1);
    expect(store.saveDraft).toHaveBeenLastCalledWith(edited);
    await advance(399);
    expect(snapshotPlan(store.doc).tasks[0]?.title).toBe("Купить корм");

    await advance(1);

    await flushPromises();
    expect(snapshotPlan(store.doc).tasks[0]?.title).toBe("Купить корм коту");
    expect(store.clearDraft).toHaveBeenCalledOnce();
    expect(transactions).toBe(1);
    fireEvent.click(screen.getByRole("tab", { name: "Список" }));
    expect(screen.getByText("Купить корм коту")).toBeInTheDocument();
  });

  it("restarts the 400 ms debounce and never applies a stale preview", async () => {
    const store = new TextPlanStore();
    addTasks(store, 1);
    const textarea = await openText(store);
    const first = textarea.value.replace("Купить корм", "Первый вариант");
    const second = textarea.value.replace("Купить корм", "Второй вариант");

    fireEvent.change(textarea, { target: { value: first } });
    await advance(399);
    fireEvent.change(textarea, { target: { value: second } });
    await advance(1);

    expect(snapshotPlan(store.doc).tasks[0]?.title).toBe("Купить корм");
    await advance(399);
    await flushPromises();
    expect(snapshotPlan(store.doc).tasks[0]?.title).toBe("Второй вариант");
    expect(store.saveDraft).toHaveBeenCalledTimes(2);
  });

  it("auto-applies a safe edit even when Yjs changes during the debounce", async () => {
    const store = new TextPlanStore();
    addTasks(store, 1);
    const textarea = await openText(store);
    const source = textarea.value.replace("Купить корм", "Купить корм коту");

    fireEvent.change(textarea, { target: { value: source } });
    await advance(200);
    act(() => {
      setTaskCompleted(store.doc, "task-0", {
        completed: true,
        at: "2026-08-03T09:00:00.000Z",
        on: "2026-08-03",
      });
    });
    await advance(200);
    await flushPromises();

    expect(snapshotPlan(store.doc).tasks[0]).toMatchObject({
      title: "Купить корм коту",
    });
    expect(store.clearDraft).toHaveBeenCalledOnce();
  });

  it("auto-applies typing that follows an external Yjs edit", async () => {
    const store = new TextPlanStore();
    addTasks(store, 1);
    const textarea = await openText(store);
    fireEvent.focus(textarea);
    act(() => {
      editTask(store.doc, "task-0", { title: "Изменено снаружи" });
    });
    const source = serializePlan(projectPlan(snapshotPlan(store.doc).tasks, "2026-08-03"), "2026-08-03")
      .replace("Изменено снаружи", "Мой заголовок");

    fireEvent.change(textarea, { target: { value: source } });
    await advance(400);
    await flushPromises();

    expect(snapshotPlan(store.doc).tasks[0]?.title).toBe("Мой заголовок");
  });

  it("auto-applies three removals after the debounce", async () => {
    const store = new TextPlanStore();
    addTasks(store, 10);
    const textarea = await openText(store);
    const edited = textarea.value.split("\n").slice(0, -3).join("\n");

    fireEvent.change(textarea, { target: { value: edited } });
    await advance(400);
    await flushPromises();

    expect(snapshotPlan(store.doc).tasks).toHaveLength(7);
    expect(store.clearDraft).toHaveBeenCalledOnce();
  });

  it("auto-applies a destructive preview and keeps later external edits", async () => {
    const store = new TextPlanStore();
    addTasks(store, 10);
    const textarea = await openText(store);
    const edited = textarea.value.split("\n").slice(0, -3).join("\n");

    fireEvent.change(textarea, { target: { value: edited } });
    await advance(400);
    await flushPromises();
    act(() => {
      addTask(store.doc, {
        id: "external",
        title: "Параллельное изменение",
        note: null,
        bucket: today,
        parentId: null,
        order: 10,
        now: "2026-08-03T08:05:00.000Z",
      });
    });

    expect(snapshotPlan(store.doc).tasks).toHaveLength(8);
    expect(snapshotPlan(store.doc).tasks).toContainEqual(
      expect.objectContaining({ id: "external", title: "Параллельное изменение" }),
    );
    await flushPromises();
    expect(store.clearDraft).toHaveBeenCalledOnce();
    expect(textarea.value).toBe(
      serializePlan(
        {
          active: [
            {
              bucket: today,
              tasks: snapshotPlan(store.doc).tasks.map((task) => ({
                ...task,
                effectiveCompleted: false,
              })),
            },
          ],
          history: [],
        },
        "2026-08-03",
      ),
    );
  });

  it("auto-applies the exact hidden History cascade", async () => {
    const store = new TextPlanStore();
    addTasks(store, 10);
    addTask(store.doc, {
      id: "hidden-child",
      title: "Скрытая завершённая подзадача",
      note: null,
      bucket: today,
      parentId: "task-0",
      order: 0,
      now: "2026-08-01T08:01:00.000Z",
    });
    setTaskCompleted(store.doc, "hidden-child", {
      completed: true,
      at: "2026-08-01T09:00:00.000Z",
      on: "2026-08-01",
    });
    const textarea = await openText(store);
    const edited = textarea.value
      .split("\n")
      .filter((line) => line !== "Купить корм")
      .join("\n");

    fireEvent.change(textarea, { target: { value: edited } });
    await advance(400);
    await flushPromises();

    expect(snapshotPlan(store.doc).tasks.map(({ id }) => id)).toEqual(
      Array.from({ length: 9 }, (_, index) => `task-${String(index + 1)}`),
    );
    await flushPromises();
    expect(store.clearDraft).toHaveBeenCalledOnce();
  });

  it("auto-applies destructive edits even when a referenced task disappears mid-debounce", async () => {
    const store = new TextPlanStore();
    addTasks(store, 10);
    const textarea = await openText(store);
    const lines = textarea.value.split("\n");
    lines[1] = "Отредактированное дело";
    const source = lines.slice(0, -3).join("\n");

    fireEvent.change(textarea, { target: { value: source } });
    await advance(200);
    act(() => {
      removeTask(store.doc, "task-0");
    });
    await advance(200);
    await flushPromises();

    expect(snapshotPlan(store.doc).tasks).toHaveLength(7);
    expect(snapshotPlan(store.doc).tasks[0]?.title).toBe("Отредактированное дело");
  });

  it("preserves invalid source and reports its exact line without mutating Yjs", async () => {
    const store = new TextPlanStore();
    addTasks(store, 1);
    const textarea = await openText(store);
    const invalid = `${textarea.value}\n    Слишком глубокая подзадача`;

    fireEvent.change(textarea, { target: { value: invalid } });
    await advance(400);

    expect(textarea).toHaveValue(invalid);
    expect(screen.getByRole("alert")).toHaveTextContent("Строка 3");
    expect(snapshotPlan(store.doc).tasks).toHaveLength(1);
    expect(snapshotPlan(store.doc).tasks[0]?.title).toBe("Купить корм");
  });

  it("does not auto-apply error diagnostics", async () => {
    const store = new TextPlanStore();
    addTasks(store, 1);
    const textarea = await openText(store);
    const invalid = `${textarea.value.split("\n")[0] ?? ""}\n    Не задача`;

    fireEvent.change(textarea, { target: { value: invalid } });
    await advance(400);

    expect(snapshotPlan(store.doc).tasks).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Строка 2");
  });

  it("treats one-space indentation as an error and blocks auto-apply", async () => {
    const store = new TextPlanStore();
    addTasks(store, 1);
    const textarea = await openText(store);
    const invalid = `${textarea.value}\n Подзадача с неверным отступом`;

    fireEvent.change(textarea, { target: { value: invalid } });
    await advance(400);

    expect(textarea).toHaveValue(invalid);
    expect(screen.getByRole("alert")).toHaveTextContent("Строка 3");
    expect(screen.getByRole("alert")).toHaveTextContent("0 или 2 пробела");
    expect(snapshotPlan(store.doc).tasks).toHaveLength(1);
  });

  it("does not replace a focused textarea after an external Yjs update", async () => {
    const store = new TextPlanStore();
    addTasks(store, 1);
    const textarea = await openText(store);
    const focusedValue = textarea.value;
    fireEvent.focus(textarea);

    act(() => {
      editTask(store.doc, "task-0", { title: "Изменено в списке" });
    });

    expect(textarea).toHaveValue(focusedValue);
    fireEvent.blur(textarea);
    expect(textarea.value).toContain("Изменено в списке");
  });

  it("keeps safe non-canonical source while focused and canonicalizes on blur", async () => {
    const store = new TextPlanStore();
    addTasks(store, 1);
    const textarea = await openText(store);
    const source = `\n${textarea.value}\n\n`;
    fireEvent.focus(textarea);

    fireEvent.change(textarea, { target: { value: source } });
    await advance(400);
    await flushPromises();

    expect(textarea).toHaveValue(source);
    expect(store.clearDraft).toHaveBeenCalledOnce();
    fireEvent.blur(textarea);
    expect(textarea.value).toBe(source.trim());
  });

  it("surfaces asynchronous draft failures without blocking a safe apply", async () => {
    const store = new TextPlanStore();
    addTasks(store, 1);
    store.saveDraft.mockRejectedValueOnce(new Error("disk full"));
    const textarea = await openText(store);
    const edited = textarea.value.replace("Купить корм", "Сохранить корм");

    fireEvent.change(textarea, { target: { value: edited } });
    await flushPromises();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Не удалось сохранить черновик: disk full",
    );

    await advance(400);
    await flushPromises();
    expect(snapshotPlan(store.doc).tasks[0]?.title).toBe("Сохранить корм");
    expect(store.clearDraft).toHaveBeenCalledOnce();
  });

  it("auto-applies edits to a persisted draft", async () => {
    const store = new TextPlanStore();
    addTasks(store, 1);
    store.draft = ["Сегодня — пн, 3 августа", "Купить корм из черновика"].join(
      "\n",
    );
    const textarea = await openText(store);
    const edited = store.draft.replace(
      "Купить корм из черновика",
      "Купить корм из сохраненного черновика",
    );

    expect(textarea).toHaveValue(store.draft);
    fireEvent.change(textarea, { target: { value: edited } });
    await advance(400);
    await flushPromises();

    expect(snapshotPlan(store.doc).tasks[0]?.title).toBe(
      "Купить корм из сохраненного черновика",
    );
    expect(store.clearDraft).toHaveBeenCalledOnce();
  });

  it("retries clearing an identical restored draft without mutating Yjs", async () => {
    const store = new TextPlanStore();
    addTasks(store, 1);
    const restoredDraft = ["Сегодня — пн, 3 августа", "Купить корм"].join("\n");
    store.draft = restoredDraft;
    const before = Y.encodeStateAsUpdate(store.doc);

    const textarea = await openText(store);
    await flushPromises();

    expect(textarea).toHaveValue(restoredDraft);
    expect(store.clearDraft).toHaveBeenCalledOnce();
    expect(Y.encodeStateAsUpdate(store.doc)).toEqual(before);
    expect(screen.queryByText("Восстановлен черновик")).not.toBeInTheDocument();
  });

  it("keeps a newer list edit when remounting with a stale persisted draft", async () => {
    const store = new TextPlanStore();
    addTasks(store, 1);
    let clearAttempts = 0;
    store.clearDraft.mockImplementation(() => {
      clearAttempts += 1;
      if (clearAttempts === 1) {
        return Promise.reject(new Error("draft database unavailable"));
      }
      store.draft = null;
      return Promise.resolve();
    });
    const textarea = await openText(store);
    const appliedDraft = textarea.value.replace("Купить корм", "Применённый черновик");

    fireEvent.change(textarea, { target: { value: appliedDraft } });
    await advance(400);
    await flushPromises();
    expect(snapshotPlan(store.doc).tasks[0]?.title).toBe("Применённый черновик");
    expect(store.draft).toBe(appliedDraft);
    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось удалить черновик");

    act(() => {
      editTask(store.doc, "task-0", { title: "Новее из списка" });
    });
    vi.useRealTimers();
    cleanup();

    render(<App store={store} today={fixedToday} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Текст" }));
    const restored = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Текст плана",
    });
    vi.useFakeTimers();
    fireEvent.change(restored, { target: { value: appliedDraft } });
    await advance(400);
    await flushPromises();
    expect(snapshotPlan(store.doc).tasks[0]?.title).toBe("Новее из списка");
    expect(restored).toHaveValue(appliedDraft);
  });

  it("cancels its pending timer on unmount", async () => {
    const store = new TextPlanStore();
    addTasks(store, 1);
    const textarea = await openText(store);
    const edited = textarea.value.replace("Купить корм", "Не применять");

    fireEvent.change(textarea, { target: { value: edited } });
    cleanup();
    await advance(400);

    expect(snapshotPlan(store.doc).tasks[0]?.title).toBe("Купить корм");
  });
});
