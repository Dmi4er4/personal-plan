import { createPlanDoc, snapshotPlan, type LocalDate } from "@personal-plan/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as Y from "yjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/app/App.js";
import type { PersistenceState, PlanStore } from "../../src/storage/plan-store.js";

const fixedToday = (): LocalDate => "2026-08-03";

class LegacyStore implements PlanStore {
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

const legacySource = [
  "Собраться: не забыть свет",
  "- Носки",
  "✓ Оплатить интернет",
  "",
  "Отправить документы",
  "",
  "✓ Позвонить маме",
  "",
  "--------",
  "",
  "Разобрать шкаф",
  "",
  "Поехать в Исландию",
].join("\n");

async function openText(store: LegacyStore): Promise<HTMLTextAreaElement> {
  render(<App store={store} today={fixedToday} />);
  fireEvent.click(await screen.findByRole("tab", { name: "Текст" }));
  const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Текст плана",
  });
  vi.useFakeTimers();
  return textarea;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LegacyImport", () => {
  it("detects a multi-block legacy note but never imports it implicitly", async () => {
    const store = new LegacyStore();
    const textarea = await openText(store);

    fireEvent.change(textarea, { target: { value: legacySource } });
    expect(
      screen.getByRole("button", { name: "Распознать старую заметку" }),
    ).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(snapshotPlan(store.doc).tasks).toEqual([]);
    expect(textarea).toHaveValue(legacySource);
  });

  it("does not offer legacy import when a canonical dated section is recognized", async () => {
    const store = new LegacyStore();
    const textarea = await openText(store);
    const mixedSource = [
      "Текст перед разделом",
      "",
      "Второй старый блок",
      "",
      "Сегодня — пн, 3 августа",
      "Каноническая задача",
    ].join("\n");

    fireEvent.change(textarea, { target: { value: mixedSource } });

    expect(
      screen.queryByRole("button", { name: "Распознать старую заметку" }),
    ).not.toBeInTheDocument();
  });

  it("shows exact legacy counts before enabling explicit import", async () => {
    const store = new LegacyStore();
    await openText(store);
    fireEvent.change(screen.getByRole("textbox", { name: "Текст плана" }), {
      target: { value: legacySource },
    });

    expect(screen.queryByRole("button", { name: "Импортировать" })).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Распознать старую заметку" }),
    );

    expect(screen.getByText("Ближних разделов: 3")).toBeInTheDocument();
    expect(screen.getByText("Дальних разделов: 2")).toBeInTheDocument();
    expect(screen.getByText("Задач: 7")).toBeInTheDocument();
    expect(screen.getByText("Выполнено: 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Импортировать" })).toBeEnabled();
    expect(snapshotPlan(store.doc).tasks).toEqual([]);
  });

  it("imports only the displayed legacy preview and then canonicalizes", async () => {
    const store = new LegacyStore();
    const textarea = await openText(store);
    fireEvent.change(textarea, { target: { value: legacySource } });
    fireEvent.click(
      screen.getByRole("button", { name: "Распознать старую заметку" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Импортировать" }));

    expect(snapshotPlan(store.doc).tasks).toHaveLength(7);
    expect(snapshotPlan(store.doc).tasks.map(({ title }) => title)).toEqual([
      "Собраться",
      "Носки",
      "Оплатить интернет",
      "Отправить документы",
      "Позвонить маме",
      "Разобрать шкаф",
      "Поехать в Исландию",
    ]);
    expect(snapshotPlan(store.doc).tasks.filter(({ completedAt }) => completedAt !== null))
      .toHaveLength(2);
    expect(textarea.value).toContain("Сегодня — пн, 3 августа");
    expect(textarea.value).not.toContain("✓ ");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(store.clearDraft).toHaveBeenCalledOnce();
  });

  it("shows counts but blocks an eighth legacy near section without mutating Yjs", async () => {
    const store = new LegacyStore();
    const textarea = await openText(store);
    const overflowSource = Array.from(
      { length: 8 },
      (_, index) => `Legacy block ${String(index + 1)}`,
    ).join("\n\n");
    const before = Y.encodeStateAsUpdate(store.doc);

    fireEvent.change(textarea, { target: { value: overflowSource } });
    fireEvent.click(
      screen.getByRole("button", { name: "Распознать старую заметку" }),
    );

    expect(screen.getByText("Ближних разделов: 8")).toBeInTheDocument();
    expect(screen.getByText("Задач: 8")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "после седьмого",
    );
    expect(screen.getByRole("button", { name: "Импортировать" })).toBeDisabled();
    expect(Y.encodeStateAsUpdate(store.doc)).toEqual(before);
    expect(snapshotPlan(store.doc).tasks).toEqual([]);
  });
});
