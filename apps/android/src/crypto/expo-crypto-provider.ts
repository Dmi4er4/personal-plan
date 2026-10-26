import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { CryptoProvider } from "@personal-plan/sync";
import {
  AESEncryptionKey,
  AESSealedData,
  CryptoDigestAlgorithm,
  aesDecryptAsync,
  aesEncryptAsync,
  digest,
  getRandomBytesAsync,
} from "expo-crypto";

const HASH_CHUNK_BYTES = 16 * 1024;

async function yieldingSha256(input: Uint8Array): Promise<Uint8Array> {
  const hash = sha256.create();
  let deadline = 0;
  for (let offset = 0; offset < input.length; offset += HASH_CHUNK_BYTES) {
    hash.update(input.subarray(offset, offset + HASH_CHUNK_BYTES));
    if (input.length > HASH_CHUNK_BYTES && performance.now() >= deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      deadline = performance.now() + 4;
    }
  }
  return hash.digest();
}

export class ExpoCryptoProvider implements CryptoProvider {
  private nativeDigestAvailable = true;

  async randomBytes(length: number): Promise<Uint8Array> {
    return getRandomBytesAsync(length);
  }

  async sha256(input: Uint8Array): Promise<Uint8Array> {
    const started = performance.now();
    let mode = "native";
    try {
      if (this.nativeDigestAvailable) {
        try {
          // Android's Expo bridge expects a TypedArray, not its ArrayBuffer.
          // A fresh view also handles slices and nonzero offsets on Hermes.
          const bytes = new Uint8Array(input.length);
          bytes.set(input);
          return new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes));
        } catch {
          this.nativeDigestAvailable = false;
          console.warn("personal-plan native SHA-256 unavailable; using yielding fallback");
        }
      }
      mode = "yielding";
      return await yieldingSha256(input);
    } finally {
      const durationMs = Math.round(performance.now() - started);
      if (input.length >= 64 * 1024 || durationMs >= 25) {
        console.info(`personal-plan perf sha256 mode=${mode} bytes=${String(input.length)} durationMs=${String(durationMs)}`);
      }
    }
  }

  async hkdfSha256(inputKey: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
    return hkdf(sha256, inputKey, undefined, info, length);
  }

  async encryptAesGcm(keyBytes: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array) {
    const key = await AESEncryptionKey.import(keyBytes);
    const sealed = await aesEncryptAsync(plaintext, key, { nonce: { bytes: nonce }, tagLength: 16, additionalData: aad });
    return { ciphertextAndTag: await sealed.ciphertext({ encoding: "bytes", includeTag: true }) };
  }

  async decryptAesGcm(keyBytes: Uint8Array, nonce: Uint8Array, ciphertextAndTag: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
    const key = await AESEncryptionKey.import(keyBytes);
    const sealed = AESSealedData.fromParts(nonce, ciphertextAndTag, 16);
    return aesDecryptAsync(sealed, key, { output: "bytes", additionalData: aad });
  }
}
