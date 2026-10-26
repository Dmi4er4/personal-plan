import { describe, expect, it } from "vitest";
import { reduceMainLayer, shouldHandleMainBack } from "../../src/ui/main-layer";

describe("Android transient navigation", () => {
  it("closes the menu for tabs, Back, outside taps, and background", () => {
    for (const event of ["tab", "back", "close", "background"] as const) {
      expect(reduceMainLayer("menu", event)).toBe("none");
    }
  });

  it("returns from Settings on Back but preserves Settings on background", () => {
    expect(reduceMainLayer("settings", "back")).toBe("none");
    expect(reduceMainLayer("settings", "background")).toBe("settings");
  });

  it("returns from History on Back but preserves History on background", () => {
    expect(reduceMainLayer("history", "back")).toBe("none");
    expect(reduceMainLayer("history", "background")).toBe("history");
  });

  it("toggles the menu and opens Settings as a single layer", () => {
    expect(reduceMainLayer("none", "toggle-menu")).toBe("menu");
    expect(reduceMainLayer("menu", "toggle-menu")).toBe("none");
    expect(reduceMainLayer("menu", "open-settings")).toBe("settings");
    expect(reduceMainLayer("menu", "open-history")).toBe("history");
  });

  it("handles Back only while a transient layer is open", () => {
    expect(shouldHandleMainBack("none")).toBe(false);
    expect(shouldHandleMainBack("menu")).toBe(true);
    expect(shouldHandleMainBack("settings")).toBe(true);
    expect(shouldHandleMainBack("history")).toBe(true);
  });
});
