import { createPlanDoc, snapshotPlan, type LocalDate } from "@personal-plan/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as Y from "yjs";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "../../src/app/App.js";
import type { PersistenceState, PlanStore } from "../../src/storage/plan-store.js";

class NewTaskStore implements PlanStore {
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

afterEach(cleanup);

describe("NewTask significant whitespace", () => {
  it("preserves meaningful whitespace but rejects whitespace-only titles", async () => {
    const user = userEvent.setup();
    const store = new NewTaskStore();
    render(<App store={store} today={fixedToday} />);

    await user.click(await screen.findByRole("button", { name: "Новое дело" }));
    let input = screen.getByRole("textbox", { name: "Название нового дела" });
    await user.type(input, "  leading   and trailing  ");
    await user.keyboard("{Enter}");

    await user.click(await screen.findByRole("button", { name: "Новое дело" }));
    input = screen.getByRole("textbox", { name: "Название нового дела" });
    await user.type(input, "   ");
    await user.keyboard("{Enter}");

    expect(snapshotPlan(store.doc).tasks.map(({ title }) => title)).toEqual([
      "  leading   and trailing  ",
    ]);
    expect(screen.getByRole("alert")).toHaveTextContent("Введите название дела");
  });
});
