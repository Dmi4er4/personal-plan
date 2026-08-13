import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("expo-crypto", async () => {
  const { createHash, webcrypto: nodeCrypto } = await import("node:crypto");
  const buffer = (value: Uint8Array): ArrayBuffer => value.slice().buffer as ArrayBuffer;
  class MockKey { constructor(readonly bytes: Uint8Array) {} static async import(bytes: Uint8Array) { return new MockKey(bytes); } }
  class MockSealed { constructor(readonly nonce: Uint8Array, readonly combined: Uint8Array) {} static fromParts(nonce: Uint8Array, combined: Uint8Array) { return new MockSealed(nonce, combined); } async ciphertext() { return this.combined; } }
  return { AESEncryptionKey: MockKey, AESSealedData: MockSealed, CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  getRandomBytesAsync: async (length: number) => new Uint8Array(length).fill(7),
  digest: async (_algorithm: string, data: ArrayBuffer) => createHash("sha256").update(new Uint8Array(data)).digest().buffer,
  aesEncryptAsync: async (plaintext: Uint8Array, key: MockKey, options: { nonce: { bytes: Uint8Array }; additionalData: Uint8Array }) => { const imported = await nodeCrypto.subtle.importKey("raw", buffer(key.bytes), "AES-GCM", false, ["encrypt"]); const bytes = await nodeCrypto.subtle.encrypt({ name: "AES-GCM", iv: buffer(options.nonce.bytes), additionalData: buffer(options.additionalData), tagLength: 128 }, imported, buffer(plaintext)); return new MockSealed(options.nonce.bytes, new Uint8Array(bytes)); },
  aesDecryptAsync: async (sealed: MockSealed, key: MockKey, options: { additionalData: Uint8Array }) => { const imported = await nodeCrypto.subtle.importKey("raw", buffer(key.bytes), "AES-GCM", false, ["decrypt"]); return new Uint8Array(await nodeCrypto.subtle.decrypt({ name: "AES-GCM", iv: buffer(sealed.nonce), additionalData: buffer(options.additionalData), tagLength: 128 }, imported, buffer(sealed.combined))); },
  };
});
import { deriveVaultMaterial, utf8, WebCryptoProvider } from "@personal-plan/sync";
import { ExpoCryptoProvider } from "../../src/crypto/expo-crypto-provider";

beforeAll(() => { vi.stubGlobal("crypto", webcrypto); });
describe("Expo crypto compatibility", () => {
  it("sha256 matches the web provider and the known vector", async () => {
    const expo = new ExpoCryptoProvider(); const web = new WebCryptoProvider();
    const input = utf8("личный план");
    expect(await expo.sha256(input)).toEqual(await web.sha256(input));
    // sha256("") well-known vector guards against accidental native-bridge regressions.
    expect([...await expo.sha256(new Uint8Array(0))].map((b) => b.toString(16).padStart(2, "0")).join(""))
      .toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
  it("derives identical material and cross-decrypts AES-GCM", async () => {
    const expo = new ExpoCryptoProvider(); const web = new WebCryptoProvider(); const root = new Uint8Array(32).map((_, i) => i);
    const [a, b] = await Promise.all([deriveVaultMaterial(expo, root), deriveVaultMaterial(web, root)]);
    expect(a.encryptionKey).toEqual(b.encryptionKey); expect(a.authToken).toEqual(b.authToken); expect(a.vaultId).toBe(b.vaultId);
    const nonce = new Uint8Array(12).fill(3); const aad = utf8("aad"); const text = utf8("секретный план");
    const sealed = await expo.encryptAesGcm(a.encryptionKey, nonce, text, aad);
    expect(await web.decryptAesGcm(a.encryptionKey, nonce, sealed.ciphertextAndTag, aad)).toEqual(text);
    await expect(web.decryptAesGcm(a.encryptionKey, nonce, sealed.ciphertextAndTag, utf8("bad"))).rejects.toThrow();
  });
});
