export const PENDING_DELETE_MS = 2000;

/**
 * Pure pending-delete state machine, decoupled from React for testability.
 * Expired entries commit automatically; flush() commits everything that is
 * still pending (used on tab switch / app background).
 */
export class PendingDeleteQueue {
  #pending = new Map<string, number>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  request(id: string): void {
    this.#pending.set(id, this.#now());
  }

  cancel(id: string): boolean {
    return this.#pending.delete(id);
  }

  isPending(id: string): boolean {
    return this.#pending.has(id);
  }

  get size(): number {
    return this.#pending.size;
  }

  progress(id: string): number {
    const startedAt = this.#pending.get(id);
    if (startedAt === undefined) {
      return 0;
    }
    return Math.min(1, (this.#now() - startedAt) / PENDING_DELETE_MS);
  }

  /** Returns ids whose grace period elapsed and removes them from the queue. */
  collectExpired(): string[] {
    const now = this.#now();
    const expired: string[] = [];
    for (const [id, startedAt] of this.#pending) {
      if (now - startedAt >= PENDING_DELETE_MS) {
        expired.push(id);
        this.#pending.delete(id);
      }
    }
    return expired;
  }

  /** Returns and removes every pending id. */
  flush(): string[] {
    const ids = [...this.#pending.keys()];
    this.#pending.clear();
    return ids;
  }
}
