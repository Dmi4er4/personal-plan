import type { Bucket } from "@personal-plan/core";
import { describe, expect, it } from "vitest";
import { bucketsEqual, sectionKey } from "../../src/ui/timeline-model";

describe("timeline drag rows", () => {
  const today = { kind: "date", date: "2026-08-05" } as const;
  const tomorrow = { kind: "date", date: "2026-08-06" } as const;

  it("resolves destination bucket keys across days", () => {
    expect(sectionKey(today)).toBe("date:2026-08-05");
    expect(sectionKey(tomorrow)).toBe("date:2026-08-06");
    expect(bucketsEqual(today, tomorrow)).toBe(false);
    expect(bucketsEqual(today, { kind: "date", date: "2026-08-05" } as Bucket)).toBe(true);
  });
});
