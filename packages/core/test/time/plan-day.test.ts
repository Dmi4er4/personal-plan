import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlanDate, millisecondsUntilNextPlanDay, startPlanDayClock } from "../../src/index.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("planning day", () => {
  it.each([
    [new Date(2026, 9, 25, 0, 0), "2026-10-24"],
    [new Date(2026, 9, 25, 3, 59, 59, 999), "2026-10-24"],
    [new Date(2026, 9, 25, 4, 0), "2026-10-25"],
    [new Date(2026, 9, 25, 23, 59, 59, 999), "2026-10-25"],
    [new Date(2027, 0, 1, 2), "2026-12-31"],
    [new Date(2028, 2, 1, 3), "2028-02-29"],
  ])("uses the local 04:00 boundary for %s", (now, expected) => {
    const timestamp = now.getTime();
    expect(getPlanDate(now)).toBe(expected);
    expect(now.getTime()).toBe(timestamp);
  });

  it("rejects an invalid clock value", () => {
    expect(() => getPlanDate(new Date(Number.NaN))).toThrow("invalid_plan_time");
  });

  it("schedules the next local 04:00, including immediately before and at the boundary", () => {
    expect(millisecondsUntilNextPlanDay(new Date(2026, 7, 4, 3, 59, 59, 999))).toBe(1);
    expect(millisecondsUntilNextPlanDay(new Date(2026, 7, 4, 4))).toBe(86_400_000);
    expect(millisecondsUntilNextPlanDay(new Date(2026, 7, 4, 0))).toBe(14_400_000);
  });

  it("keeps the old day at midnight and refreshes every day at 04:00 without edits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 3, 23, 59, 59, 900));
    const onChange = vi.fn();
    const clock = startPlanDayClock(onChange);
    expect(onChange).toHaveBeenLastCalledWith("2026-08-03");

    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(14_399_999);
    expect(onChange).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(onChange).toHaveBeenLastCalledWith("2026-08-04");
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(onChange).toHaveBeenLastCalledWith("2026-08-05");
    clock.stop();
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("refreshes after suspension and reschedules from the current local time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 3, 12));
    const onChange = vi.fn();
    const clock = startPlanDayClock(onChange);

    vi.setSystemTime(new Date(2026, 7, 5, 2));
    clock.refresh();
    expect(onChange).toHaveBeenLastCalledWith("2026-08-04");
    await vi.advanceTimersByTimeAsync(7_200_000);
    expect(onChange).toHaveBeenLastCalledWith("2026-08-05");
    expect(onChange).toHaveBeenCalledTimes(3);
    clock.stop();
  });
});
