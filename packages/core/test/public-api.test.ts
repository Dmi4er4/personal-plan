import { describe, expect, it } from "vitest";
import { createPlanDoc } from "../src/index";

describe("core public API", () => {
  it("creates an empty plan document", () => {
    const doc = createPlanDoc();
    expect(doc.getMap("tasks").size).toBe(0);
  });
});
