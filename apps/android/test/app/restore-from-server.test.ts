import { describe, expect, it, vi } from "vitest";

import { discardLocalPlanForServerRestore } from "../../src/app/restore-from-server";

describe("Android server restore", () => {
  it("clears the local plan before remounting it for bootstrap", async () => {
    const order: string[] = [];
    const planStore = {
      reset: vi.fn(async () => {
        order.push("reset");
      }),
    };

    await discardLocalPlanForServerRestore(planStore, () => {
      order.push("remount");
    });

    expect(order).toEqual(["reset", "remount"]);
  });

  it("does not remount when clearing local state fails", async () => {
    const remount = vi.fn();
    const failure = new Error("sqlite failure");

    await expect(discardLocalPlanForServerRestore({ reset: () => Promise.reject(failure) }, remount)).rejects.toBe(failure);
    expect(remount).not.toHaveBeenCalled();
  });
});
