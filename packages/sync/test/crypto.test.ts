import { describe, expect, it } from "vitest";

import { base64UrlDecode, deriveVaultMaterial, encryptPayload, decryptEnvelope, EnvelopeAuthenticationError, equalBytes, WebCryptoProvider } from "../src/index.js";

describe("vault crypto", () => {
  it("derives stable domain-separated material", async () => {
    const provider = new WebCryptoProvider();
    const root = Uint8Array.from({ length: 32 }, (_, index) => index);
    const first = await deriveVaultMaterial(provider, root);
    const second = await deriveVaultMaterial(provider, root);
    expect(equalBytes(first.encryptionKey, second.encryptionKey)).toBe(true);
    expect(equalBytes(first.authToken, second.authToken)).toBe(true);
    expect(equalBytes(first.encryptionKey, first.authToken)).toBe(false);
    expect(first.encryptionKey).toHaveLength(32);
    expect(first.authToken).toHaveLength(32);
    expect(base64UrlDecode(first.vaultId)).toHaveLength(16);
  });

  it("authenticates envelope metadata and ciphertext", async () => {
    const web = new WebCryptoProvider();
    const provider = { ...web, randomBytes: async (length: number) => new Uint8Array(length).fill(7), sha256: web.sha256.bind(web), hkdfSha256: web.hkdfSha256.bind(web), encryptAesGcm: web.encryptAesGcm.bind(web), decryptAesGcm: web.decryptAesGcm.bind(web) };
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(4));
    const plaintext = new TextEncoder().encode("Секретное дело");
    const envelope = await encryptPayload(provider, material.encryptionKey, material.vaultId, { kind: "update", updateId: "11111111-1111-4111-8111-111111111111", payload: plaintext, createdAt: "2026-08-04T00:00:00.000Z" });
    expect(await decryptEnvelope(provider, material.encryptionKey, material.vaultId, envelope)).toEqual(plaintext);
    expect(JSON.stringify(envelope)).not.toContain("Секретное дело");
    const changed = { ...envelope, updateId: "22222222-2222-4222-8222-222222222222" };
    await expect(decryptEnvelope(provider, material.encryptionKey, material.vaultId, changed)).rejects.toBeInstanceOf(EnvelopeAuthenticationError);
    const bytes = base64UrlDecode(envelope.ciphertext);
    bytes[0] ^= 1;
    const tampered = { ...envelope, ciphertext: (await import("../src/index.js")).base64UrlEncode(bytes) };
    await expect(decryptEnvelope(provider, material.encryptionKey, material.vaultId, tampered)).rejects.toBeInstanceOf(EnvelopeAuthenticationError);
  });
});
