import { base64UrlDecode } from "@personal-plan/sync";

import { error, HttpError, readJson } from "./http.js";
export { VaultObject } from "./vault-object.js";

export interface Env {
  VAULTS: DurableObjectNamespace;
  ASSETS: Fetcher;
}

function validVaultId(value: string): boolean {
  try { return base64UrlDecode(value).length === 16; } catch { return false; }
}

async function api(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/v1/vaults") {
    const forwarded = request.clone();
    const body = await readJson(request);
    if (typeof body !== "object" || body === null || !("vaultId" in body) || typeof body.vaultId !== "string" || !validVaultId(body.vaultId)) return error("invalid_vault_id", 400);
    return env.VAULTS.get(env.VAULTS.idFromName(body.vaultId)).fetch(forwarded);
  }
  const match = /^\/v1\/vaults\/([^/]+)(?:\/(updates|snapshot|bootstrap))?$/u.exec(url.pathname);
  if (match === null) return url.pathname.startsWith("/v1/") ? error("not_found", 404) : null;
  const vaultId = decodeURIComponent(match[1] ?? "");
  if (!validVaultId(vaultId)) return error("invalid_vault_id", 400);
  return env.VAULTS.get(env.VAULTS.idFromName(vaultId)).fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const response = await api(request, env);
      return response ?? env.ASSETS.fetch(request);
    } catch (reason) {
      if (reason instanceof HttpError) return error(reason.code, reason.status);
      return error("internal_error", 500);
    }
  },
} satisfies ExportedHandler<Env>;
