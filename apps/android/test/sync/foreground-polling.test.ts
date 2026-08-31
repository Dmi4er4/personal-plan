import { afterEach, describe, expect, it, vi } from "vitest";
import { startForegroundSyncPolling } from "../../src/sync/foreground-polling";

afterEach(() => {
  vi.useRealTimers();
});

describe("foreground sync polling", () => {
  it("polls while active, pauses while hidden, and stops cleanly", async () => {
    vi.useFakeTimers();
    let active = true;
    const run = vi.fn();
    const stop = startForegroundSyncPolling({
      intervalMs: 1_000,
      isActive: () => active,
      run,
    });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(run).toHaveBeenCalledTimes(2);

    active = false;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run).toHaveBeenCalledTimes(2);

    active = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run).toHaveBeenCalledTimes(3);
  });
});
