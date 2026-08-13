import type { AesGcmCiphertext, CryptoProvider } from "./crypto-provider.js";

function copy(value: Uint8Array): ArrayBuffer {
  return value.slice().buffer;
}

export class WebCryptoProvider implements CryptoProvider {
  readonly #crypto: Crypto;

  constructor(cryptoImplementation: Crypto = globalThis.crypto) {
    this.#crypto = cryptoImplementation;
  }

  randomBytes(length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(length) || length < 0) throw new RangeError("Invalid random byte length");
    return Promise.resolve(this.#crypto.getRandomValues(new Uint8Array(length)));
  }

  async sha256(input: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(await this.#crypto.subtle.digest("SHA-256", copy(input)));
  }

  async hkdfSha256(inputKey: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
    const key = await this.#crypto.subtle.importKey("raw", copy(inputKey), "HKDF", false, ["deriveBits"]);
    const bits = await this.#crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new ArrayBuffer(0), info: copy(info) },
      key,
      length * 8,
    );
    return new Uint8Array(bits);
  }

  async encryptAesGcm(keyBytes: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<AesGcmCiphertext> {
    const key = await this.#crypto.subtle.importKey("raw", copy(keyBytes), "AES-GCM", false, ["encrypt"]);
    const result = await this.#crypto.subtle.encrypt(
      { name: "AES-GCM", iv: copy(nonce), additionalData: copy(aad), tagLength: 128 },
      key,
      copy(plaintext),
    );
    return { ciphertextAndTag: new Uint8Array(result) };
  }

  async decryptAesGcm(keyBytes: Uint8Array, nonce: Uint8Array, ciphertextAndTag: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
    const key = await this.#crypto.subtle.importKey("raw", copy(keyBytes), "AES-GCM", false, ["decrypt"]);
    return new Uint8Array(await this.#crypto.subtle.decrypt(
      { name: "AES-GCM", iv: copy(nonce), additionalData: copy(aad), tagLength: 128 },
      key,
      copy(ciphertextAndTag),
    ));
  }
}
