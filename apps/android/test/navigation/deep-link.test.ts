import { describe, expect, it, vi } from "vitest";
import { applyDeepLinkTab, tabFromDeepLink } from "../../src/navigation/deep-link-routing";

describe("deep link tab routing", () => {
  it("opens list for widget and generic links", () => {
    expect(tabFromDeepLink("personalplan://list")).toBe("list");
    expect(tabFromDeepLink("personalplan://task/abc")).toBe("list");
    expect(tabFromDeepLink("personalplan://")).toBe("list");
  });

  it("opens text only for explicit text links", () => {
    expect(tabFromDeepLink("personalplan://text")).toBe("text");
  });

  it("ignores empty and unrelated urls", () => {
    expect(tabFromDeepLink(null)).toBeNull();
    expect(tabFromDeepLink("")).toBeNull();
    expect(tabFromDeepLink("https://example.com")).toBeNull();
  });
});

describe("applyDeepLinkTab", () => {
  it("switches tab when url maps to a tab", () => {
    const onTab = vi.fn();
    applyDeepLinkTab("personalplan://list", onTab);
    expect(onTab).toHaveBeenCalledWith("list");
  });

  it("does not call onTab for unrelated urls", () => {
    const onTab = vi.fn();
    applyDeepLinkTab("https://example.com", onTab);
    expect(onTab).not.toHaveBeenCalled();
  });

  it("switches from text to list on repeated warm-start list deep link", () => {
    const onTab = vi.fn();
    applyDeepLinkTab("personalplan://text", onTab);
    applyDeepLinkTab("personalplan://list", onTab);
    applyDeepLinkTab("personalplan://list", onTab);
    expect(onTab).toHaveBeenCalledTimes(3);
    expect(onTab).toHaveBeenLastCalledWith("list");
  });
});
