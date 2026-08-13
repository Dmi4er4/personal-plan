import type { AppendUpdatesResponse, BootstrapResponse, CreateVaultRequest, EncryptedEnvelope, ListUpdatesResponse, PutSnapshotRequest, RelayTransport } from "@personal-plan/sync";

export class RelayHttpError extends Error {
  constructor(readonly code: string, readonly status: number) { super(`Relay request failed: ${code}`); this.name = "RelayHttpError"; }
}

export class HttpRelayTransport implements RelayTransport {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(baseUrl = window.location.origin, fetchImplementation: typeof fetch = fetch) {
    this.#baseUrl = baseUrl.replace(/\/$/u, "");
    this.#fetch = fetchImplementation.bind(globalThis);
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await this.#fetch(`${this.#baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(15_000), headers });
    if (!response.ok) {
      let code = `http_${String(response.status)}`;
      try {
        const body = await response.json() as { error?: unknown };
        if (typeof body.error === "string" && /^[a-z0-9_]{1,64}$/u.test(body.error)) code = body.error;
      } catch { /* Do not surface arbitrary relay response bodies. */ }
      throw new RelayHttpError(code, response.status);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  async createVault(vaultId: string, authVerifier: string): Promise<void> {
    await this.#request("/v1/vaults", { method: "POST", body: JSON.stringify({ vaultId, authVerifier } satisfies CreateVaultRequest) });
  }
  append(vaultId: string, authToken: string, updates: EncryptedEnvelope[]): Promise<AppendUpdatesResponse> {
    return this.#request(`/v1/vaults/${encodeURIComponent(vaultId)}/updates`, { method: "POST", headers: { authorization: `Bearer ${authToken}` }, body: JSON.stringify({ updates }) });
  }
  list(vaultId: string, authToken: string, after: number): Promise<ListUpdatesResponse> {
    return this.#request(`/v1/vaults/${encodeURIComponent(vaultId)}/updates?after=${String(after)}`, { headers: { authorization: `Bearer ${authToken}` } });
  }
  async putSnapshot(vaultId: string, authToken: string, request: PutSnapshotRequest): Promise<void> {
    await this.#request(`/v1/vaults/${encodeURIComponent(vaultId)}/snapshot`, { method: "PUT", headers: { authorization: `Bearer ${authToken}` }, body: JSON.stringify(request) });
  }
  bootstrap(vaultId: string, authToken: string): Promise<BootstrapResponse> {
    return this.#request(`/v1/vaults/${encodeURIComponent(vaultId)}/bootstrap`, { headers: { authorization: `Bearer ${authToken}` } });
  }
}
