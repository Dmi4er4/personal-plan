import { describe, expect, it } from "vitest";
import { addDays, type LocalDate } from "../../src/index";

describe("local-date arithmetic validation", () => {
  it("rejects non-finite and non-integer day counts with a stable RangeError", () => {
    expect(() => addDays("2026-08-03", Number.NaN)).toThrow(
      new RangeError("invalid_day_count:NaN"),
    );
    expect(() => addDays("2026-08-03", 1.5)).toThrow(
      new RangeError("invalid_day_count:1.5"),
    );
  });

  it("returns a narrowed LocalDate and rejects arithmetic outside its range", () => {
    const result: LocalDate = addDays("2026-08-03", 1);

    expect(result).toBe("2026-08-04");
    expect(() => addDays("2026-08-03", Number.MAX_SAFE_INTEGER)).toThrow(
      new RangeError("local_date_out_of_range"),
    );
  });
});
