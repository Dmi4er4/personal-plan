import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { CryptoProvider } from "@personal-plan/sync";
import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
  getRandomBytesAsync,
} from "expo-crypto";

export class ExpoCryptoProvider implements CryptoProvider {
  async randomBytes(length: number): Promise<Uint8Array> {
    return getRandomBytesAsync(length);
  }

  // Pure-JS implementation: expo-crypto's native `digest` rejects ArrayBuffer
  // inputs created via Uint8Array#slice on Hermes ("no ArrayBuffer attached").
  async sha256(input: Uint8Array): Promise<Uint8Array> {
    return Promise.resolve(sha256(input.slice()));
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
