import { describe, expect, it } from "vitest";

import { shouldOfferLegacyImport } from "../../src/ui/legacy-import";

describe("Android legacy import affordance", () => {
  it("offers controlled import for a blank-separated old note", () => {
    expect(shouldOfferLegacyImport("Собраться\n  Носки\n\nЗавтра позвонить", "2026-08-09")).toBe(true);
  });

  it("does not intercept canonical plan text", () => {
    expect(shouldOfferLegacyImport("Сегодня — вс, 9 августа\nСобраться\n\nЗавтра — пн, 10 августа\nПозвонить", "2026-08-09")).toBe(false);
  });
});
