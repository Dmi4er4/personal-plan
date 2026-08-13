import { base64UrlEncode, utf8 } from "./bytes.js";
import type { CryptoProvider, VaultMaterial } from "./crypto-provider.js";

const ENCRYPTION_INFO = utf8("personal-plan/v1/encryption");
const AUTH_INFO = utf8("personal-plan/v1/auth");
const VAULT_ID_INFO = utf8("personal-plan/v1/vault-id");

export async function generateRootSecret(provider: CryptoProvider): Promise<Uint8Array> {
  return provider.randomBytes(32);
}

export async function deriveVaultMaterial(provider: CryptoProvider, rootSecret: Uint8Array): Promise<VaultMaterial> {
  if (rootSecret.length !== 32) throw new RangeError("Root secret must contain exactly 32 bytes");
  const [encryptionKey, authToken, vaultIdBytes] = await Promise.all([
    provider.hkdfSha256(rootSecret, ENCRYPTION_INFO, 32),
    provider.hkdfSha256(rootSecret, AUTH_INFO, 32),
    provider.hkdfSha256(rootSecret, VAULT_ID_INFO, 16),
  ]);
  return { rootSecret: rootSecret.slice(), encryptionKey, authToken, vaultId: base64UrlEncode(vaultIdBytes) };
}
