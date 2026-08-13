import { describe, expect, it } from "vitest";
import { PENDING_DELETE_MS, PendingDeleteQueue } from "../../src/ui/pending-delete-queue";

describe("PendingDeleteQueue", () => {
  it("has a two-second grace period", () => {
    expect(PENDING_DELETE_MS).toBe(2000);
  });

  it("commits entries only after the grace period", () => {
    let now = 1000;
    const queue = new PendingDeleteQueue(() => now);
    queue.request("a");
    expect(queue.collectExpired()).toEqual([]);
    now += PENDING_DELETE_MS - 1;
    expect(queue.collectExpired()).toEqual([]);
    now += 1;
    expect(queue.collectExpired()).toEqual(["a"]);
    expect(queue.size).toBe(0);
  });

  it("flush commits everything still pending", () => {
    const queue = new PendingDeleteQueue(() => 5000);
    queue.request("a");
    queue.request("b");
    expect(queue.flush()).toEqual(["a", "b"]);
    expect(queue.size).toBe(0);
    expect(queue.flush()).toEqual([]);
  });

  it("cancel removes an entry before commit", () => {
    const queue = new PendingDeleteQueue(() => 0);
    queue.request("a");
    expect(queue.cancel("a")).toBe(true);
    expect(queue.isPending("a")).toBe(false);
    expect(queue.cancel("a")).toBe(false);
  });

  it("reports progress from 0 to 1 over the grace period", () => {
    let now = 0;
    const queue = new PendingDeleteQueue(() => now);
    queue.request("a");
    expect(queue.progress("a")).toBe(0);
    now += PENDING_DELETE_MS / 2;
    expect(queue.progress("a")).toBe(0.5);
    now += PENDING_DELETE_MS;
    expect(queue.progress("a")).toBe(1);
    expect(queue.progress("missing")).toBe(0);
  });
});
