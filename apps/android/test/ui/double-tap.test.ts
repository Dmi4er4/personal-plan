import { describe, expect, it } from "vitest";
import { registerTap } from "../../src/ui/double-tap";

describe("task double tap", () => {
  it("opens on the second nearby tap and resets the gesture", () => {
    const first = registerTap(null, 1_000);
    expect(first).toEqual({ activated: false, lastTapAt: 1_000 });

    const second = registerTap(first.lastTapAt, 1_280);
    expect(second).toEqual({ activated: true, lastTapAt: null });
  });

  it("starts a new gesture after a slow second tap", () => {
    expect(registerTap(1_000, 1_351)).toEqual({
      activated: false,
      lastTapAt: 1_351,
    });
  });
});
