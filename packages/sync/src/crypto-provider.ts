export interface AesGcmCiphertext {
  ciphertextAndTag: Uint8Array;
}

export interface CryptoProvider {
  randomBytes(length: number): Promise<Uint8Array>;
  sha256(input: Uint8Array): Promise<Uint8Array>;
  hkdfSha256(inputKey: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array>;
  encryptAesGcm(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<AesGcmCiphertext>;
  decryptAesGcm(key: Uint8Array, nonce: Uint8Array, ciphertextAndTag: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
}

export interface VaultMaterial {
  rootSecret: Uint8Array;
  encryptionKey: Uint8Array;
  authToken: Uint8Array;
  vaultId: string;
}
