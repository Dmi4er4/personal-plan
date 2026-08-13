import { base64UrlDecode, base64UrlEncode, utf8 } from "./bytes.js";
import type { CryptoProvider } from "./crypto-provider.js";

export type EnvelopeKind = "update" | "snapshot";

export interface EncryptedEnvelope {
  version: number;
  kind: string;
  vaultId: string;
  updateId: string;
  nonce: string;
  ciphertext: string;
  createdAt: string;
}

export interface EncryptPayloadInput {
  kind: EnvelopeKind;
  updateId: string;
  payload: Uint8Array;
  createdAt: string;
}

export class EnvelopeAuthenticationError extends Error {
  constructor() {
    super("Encrypted envelope authentication failed");
    this.name = "EnvelopeAuthenticationError";
  }
}

function aad(vaultId: string, updateId: string, kind: EnvelopeKind): Uint8Array {
  return utf8(`personal-plan|1|${vaultId}|${updateId}|${kind}`);
}

export async function encryptPayload(provider: CryptoProvider, encryptionKey: Uint8Array, vaultId: string, input: EncryptPayloadInput): Promise<EncryptedEnvelope> {
  if (encryptionKey.length !== 32) throw new RangeError("Encryption key must contain exactly 32 bytes");
  const nonce = await provider.randomBytes(12);
  if (nonce.length !== 12) throw new Error("Crypto provider returned an invalid nonce");
  const encrypted = await provider.encryptAesGcm(encryptionKey, nonce, input.payload, aad(vaultId, input.updateId, input.kind));
  return {
    version: 1,
    kind: input.kind,
    vaultId,
    updateId: input.updateId,
    nonce: base64UrlEncode(nonce),
    ciphertext: base64UrlEncode(encrypted.ciphertextAndTag),
    createdAt: input.createdAt,
  };
}

export async function decryptEnvelope(provider: CryptoProvider, encryptionKey: Uint8Array, expectedVaultId: string, envelope: EncryptedEnvelope): Promise<Uint8Array> {
  if (envelope.version !== 1 || envelope.vaultId !== expectedVaultId || (envelope.kind !== "update" && envelope.kind !== "snapshot")) {
    throw new EnvelopeAuthenticationError();
  }
  try {
    const nonce = base64UrlDecode(envelope.nonce);
    if (nonce.length !== 12) throw new Error("Invalid nonce");
    return await provider.decryptAesGcm(
      encryptionKey,
      nonce,
      base64UrlDecode(envelope.ciphertext),
      aad(envelope.vaultId, envelope.updateId, envelope.kind),
    );
  } catch {
    throw new EnvelopeAuthenticationError();
  }
}
