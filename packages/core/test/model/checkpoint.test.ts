import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { planCheckpointContent } from "../../src/index.js";

describe("plan checkpoint content", () => {
  it("is stable across map insertion order and persistence replay", () => {
    const first = new Y.Doc();
    first.getMap("tasks").set("b", { title: "B", note: "Keep all content" });
    first.getMap("tasks").set("a", { title: "A", deleted: true });
    first.getMap("appliedWidgetCommands").set("command", "2026-10-12");
    const reordered = new Y.Doc();
    reordered.getMap("appliedWidgetCommands").set("command", "2026-10-12");
    reordered.getMap("tasks").set("a", { deleted: true, title: "A" });
    reordered.getMap("tasks").set("b", { note: "Keep all content", title: "B" });
    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(first));

    expect(planCheckpointContent(reopened)).toEqual(planCheckpointContent(first));
    expect(planCheckpointContent(reordered)).toEqual(planCheckpointContent(first));
    reopened.getMap("appliedWidgetCommands").delete("command");
    expect(planCheckpointContent(reopened)).not.toEqual(planCheckpointContent(first));
  });

  it("includes an unmaterialized sequence from an older schema", () => {
    const doc = new Y.Doc();
    doc.getText("futureSchema").insert(0, "Retain unknown data");
    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc));
    expect(planCheckpointContent(doc)).not.toBeNull();
    expect(planCheckpointContent(reopened)).toEqual(planCheckpointContent(doc));
    reopened.getText("futureSchema").delete(0, 1);
    expect(planCheckpointContent(reopened)).not.toEqual(planCheckpointContent(doc));
  });

  it("includes additional root maps from older document schemas", () => {
    const doc = new Y.Doc();
    doc.getMap("legacyMetadata").set("revision", 1);
    const before = planCheckpointContent(doc);
    expect(before).not.toBeNull();
    doc.getMap("legacyMetadata").set("revision", 2);
    expect(planCheckpointContent(doc)).not.toEqual(before);
  });
});
