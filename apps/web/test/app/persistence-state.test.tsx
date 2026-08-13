import { createPlanDoc, type LocalDate } from "@personal-plan/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as Y from "yjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/app/App.js";
import type { PlanStore } from "../../src/storage/plan-store.js";
import { openSettings } from "../ui/open-settings.js";

type PersistenceState =
  | { error: null; status: "loading" | "saving" | "saved" }
  | { error: Error; status: "error" };

class ManualPersistenceStore implements PlanStore {
  readonly doc = createPlanDoc();
  #state: PersistenceState = { error: null, status: "saving" };
  #listeners = new Set<(state: PersistenceState) => void>();
  retryPersistence = vi.fn(async (): Promise<void> => {
    this.emit({ error: null, status: "saving" });
    await Promise.resolve();
    this.emit({ error: null, status: "saved" });
  });

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
    return this.#state;
  }

  subscribePersistence(listener: (state: PersistenceState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  emit(state: PersistenceState): void {
    this.#state = state;
    for (const listener of this.#listeners) {
      listener(state);
    }
  }

  destroy(): Promise<void> {
    return Promise.resolve();
  }
}

const fixedToday = (): LocalDate => "2026-08-03";

afterEach(cleanup);

describe("truthful plan persistence UI", () => {
  it("renders loading/saving/saved from observable durable state", async () => {
    const user = userEvent.setup();
    const store = new ManualPersistenceStore();
    render(<App store={store} today={fixedToday} />);

    await openSettings(user);
    expect(
      await screen.findByText("сохранение на устройстве…", { exact: true }),
    ).toBeVisible();
    expect(screen.queryByText("сохранено на устройстве", { exact: true })).toBeNull();

    store.emit({ error: null, status: "saved" });
    expect(
      await screen.findByText("сохранено на устройстве", { exact: true }),
    ).toBeVisible();
  });

  it("shows a write error and retries the current in-memory state", async () => {
    const user = userEvent.setup();
    const store = new ManualPersistenceStore();
    render(<App store={store} today={fixedToday} />);
    await openSettings(user);

    store.emit({
      error: new DOMException("quota exhausted", "QuotaExceededError"),
      status: "error",
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "не удалось сохранить на устройстве: quota exhausted",
    );
    await user.click(screen.getByRole("button", { name: "Повторить сохранение" }));

    expect(store.retryPersistence).toHaveBeenCalledOnce();
    expect(
      await screen.findByText("сохранено на устройстве", { exact: true }),
    ).toBeVisible();
  });
});
