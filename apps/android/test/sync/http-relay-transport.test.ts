import { afterEach, describe, expect, it, vi } from "vitest";
import { ANDROID_RELAY_REQUEST_TIMEOUT_MS, AndroidHttpRelayTransport } from "../../src/sync/http-relay-transport";

describe("AndroidHttpRelayTransport", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("allows a slow response body to finish after the former five-second deadline", async () => {
    vi.useFakeTimers();
    const body = { snapshot: null, updates: [], nextCursor: 0, hasMore: false };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: () => new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(body), 6_000);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("response aborted"));
        });
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const request = new AndroidHttpRelayTransport("https://relay.example").bootstrap("vault", "token");
    const completion = expect(request).resolves.toEqual(body);
    await vi.advanceTimersByTimeAsync(6_000);
    await completion;
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://relay.example/v1/vaults/vault/bootstrap?paged=1");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a stalled relay request after thirty seconds", async () => {
    vi.useFakeTimers();
    const requestState: { signal: AbortSignal | null } = { signal: null };
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestState.signal = init?.signal as AbortSignal;
      requestState.signal.addEventListener("abort", () => reject(new Error("request aborted")));
    })));
    const transport = new AndroidHttpRelayTransport("https://relay.example/");

    const request = transport.bootstrap("vault", "token");
    const rejection = expect(request).rejects.toThrow("request aborted");
    await vi.advanceTimersByTimeAsync(ANDROID_RELAY_REQUEST_TIMEOUT_MS - 1);
    expect(requestState.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await rejection;
    expect(requestState.signal?.aborted).toBe(true);
  });

  it("clears the timeout after a completed request", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ snapshot: null, updates: [], nextCursor: 0 }),
    })));
    const transport = new AndroidHttpRelayTransport("https://relay.example/");

    await expect(transport.bootstrap("vault", "token")).resolves.toEqual({ snapshot: null, updates: [], nextCursor: 0 });

    expect(vi.getTimerCount()).toBe(0);
  });
});
