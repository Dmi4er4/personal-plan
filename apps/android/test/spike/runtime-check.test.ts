import { describe, expect, it, vi } from "vitest";

vi.mock("expo-crypto", () => ({ randomUUID: () => "123e4567-e89b-42d3-a456-426614174000" }));
import { runRuntimeCheck } from "../../src/spike/runtime-check";

describe("Android runtime", () => {
  it("round-trips Yjs and binary data", async () => {
    const result = await runRuntimeCheck();
    expect(result.yjsRoundTrip).toBe(true);
    expect(result.binaryLength).toBeGreaterThan(0);
    expect(result.generatedId).toMatch(/^[0-9a-f-]{36}$/u);
  });
});
