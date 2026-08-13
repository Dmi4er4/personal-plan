import type { AppendUpdatesResponse, BootstrapResponse, CreateVaultRequest, EncryptedEnvelope, ListUpdatesResponse, PutSnapshotRequest, RelayTransport } from "@personal-plan/sync";

export class AndroidHttpRelayTransport implements RelayTransport {
  constructor(private readonly baseUrl: string) {}
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/u, "")}${path}`, { ...init, signal: controller.signal, headers: { "content-type": "application/json", ...init.headers } });
      if (!response.ok) throw new Error(`relay_http_${String(response.status)}`);
      if (response.status === 204) return undefined as T;
      return await response.json() as T;
    } finally { clearTimeout(timer); }
  }
  async createVault(vaultId: string, authVerifier: string): Promise<void> { await this.request("/v1/vaults", { method: "POST", body: JSON.stringify({ vaultId, authVerifier } satisfies CreateVaultRequest) }); }
  append(vaultId: string, authToken: string, updates: EncryptedEnvelope[]): Promise<AppendUpdatesResponse> { return this.request(`/v1/vaults/${encodeURIComponent(vaultId)}/updates`, { method: "POST", headers: { authorization: `Bearer ${authToken}` }, body: JSON.stringify({ updates }) }); }
  list(vaultId: string, authToken: string, after: number): Promise<ListUpdatesResponse> { return this.request(`/v1/vaults/${encodeURIComponent(vaultId)}/updates?after=${String(after)}`, { headers: { authorization: `Bearer ${authToken}` } }); }
  async putSnapshot(vaultId: string, authToken: string, request: PutSnapshotRequest): Promise<void> { await this.request(`/v1/vaults/${encodeURIComponent(vaultId)}/snapshot`, { method: "PUT", headers: { authorization: `Bearer ${authToken}` }, body: JSON.stringify(request) }); }
  bootstrap(vaultId: string, authToken: string): Promise<BootstrapResponse> { return this.request(`/v1/vaults/${encodeURIComponent(vaultId)}/bootstrap`, { headers: { authorization: `Bearer ${authToken}` } }); }
}
