import {
  addTask,
  createPlanDoc,
  projectPlan,
  serializePlan,
  snapshotPlan,
} from "@personal-plan/core";
import { describe, expect, it } from "vitest";
import { commitTextDraft } from "../../src/ui/text-draft";

const TODAY = "2026-08-10";
const NOW = "2026-08-10T12:00:00.000Z";

function canonical(doc: ReturnType<typeof createPlanDoc>): string {
  const snapshot = snapshotPlan(doc);
  return serializePlan(projectPlan(snapshot.tasks, TODAY, snapshot.records), TODAY);
}

describe("text draft commit", () => {
  it("flushes a valid draft into the shared Yjs document", () => {
    const doc = createPlanDoc();
    addTask(doc, {
      id: "existing",
      title: "Исходная задача",
      note: null,
      bucket: { kind: "date", date: TODAY },
      parentId: null,
      order: 0,
      now: NOW,
    });
    const before = canonical(doc);

    const result = commitTextDraft(
      doc,
      `${before}\nНовая задача с телефона`,
      before,
      TODAY,
      { idFactory: () => "from-draft", now: NOW },
    );

    expect(result.kind).toBe("applied");
    expect(canonical(doc)).toContain("Новая задача с телефона");
  });

  it("keeps an invalid draft out of the shared document", () => {
    const doc = createPlanDoc();
    const before = canonical(doc);
    const result = commitTextDraft(
      doc,
      "текст без заголовка раздела",
      before,
      TODAY,
      { idFactory: () => "unused", now: NOW },
    );

    expect(result.kind).toBe("invalid");
    expect(canonical(doc)).toBe(before);
  });
});
