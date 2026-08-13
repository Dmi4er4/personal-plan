import { base64UrlDecode, base64UrlEncode } from "@personal-plan/sync";
import * as SecureStore from "expo-secure-store";

const KEY = "personal-plan-vault-v1";

export interface StoredVaultConfig { relayUrl: string; rootSecret: Uint8Array }
export interface SecureBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: { requireAuthentication: boolean }): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export class SecureVaultStore {
  constructor(private readonly backend: SecureBackend = SecureStore) {}

  async load(): Promise<StoredVaultConfig | null> {
    const raw = await this.backend.getItemAsync(KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("relayUrl" in parsed) || !("rootSecret" in parsed) || typeof parsed.relayUrl !== "string" || typeof parsed.rootSecret !== "string") {
      throw new Error("invalid_secure_vault");
    }
    const rootSecret = base64UrlDecode(parsed.rootSecret);
    if (rootSecret.length !== 32) throw new Error("invalid_secure_vault");
    return { relayUrl: parsed.relayUrl, rootSecret };
  }

  async save(value: StoredVaultConfig): Promise<void> {
    if (value.rootSecret.length !== 32) throw new RangeError("root_secret_length");
    await this.backend.setItemAsync(KEY, JSON.stringify({ relayUrl: value.relayUrl, rootSecret: base64UrlEncode(value.rootSecret) }), { requireAuthentication: false });
  }

  clear(): Promise<void> { return this.backend.deleteItemAsync(KEY); }
}
