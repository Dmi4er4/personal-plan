import { describe, expect, it, vi } from "vitest";
vi.mock("expo-secure-store", () => ({}));
import { SecureVaultStore } from "../../src/storage/secure-vault";
describe("SecureVaultStore", () => {
  it("round-trips only through the secure backend", async () => {
    let value: string | null = null; let options: unknown;
    const backend = { getItemAsync: async () => value, setItemAsync: async (_key: string, next: string, nextOptions?: unknown) => { value = next; options = nextOptions; }, deleteItemAsync: async () => { value = null; } };
    const store = new SecureVaultStore(backend);
    await store.save({ relayUrl: "https://relay.example", rootSecret: new Uint8Array(32).fill(9) });
    expect(options).toEqual({ requireAuthentication: false }); expect(await store.load()).toEqual({ relayUrl: "https://relay.example", rootSecret: new Uint8Array(32).fill(9) });
    await store.clear(); expect(await store.load()).toBeNull();
  });
});
