import { afterEach, describe, expect, it, vi } from "vitest";

import { PWA_UPDATE_INTERVAL_MS, schedulePwaUpdates } from "../../src/sync/pwa-updates";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("PWA update checks", () => {
  it("checks while visible and when the app returns to the foreground", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const update = vi.fn().mockResolvedValue(undefined);
    const stop = schedulePwaUpdates({ update });

    await vi.advanceTimersByTimeAsync(PWA_UPDATE_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(update).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue("visible");
    window.dispatchEvent(new Event("focus"));
    expect(update).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(PWA_UPDATE_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(2);
  });
});
