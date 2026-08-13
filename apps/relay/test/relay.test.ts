import { SELF } from "cloudflare:test";
import { base64UrlEncode, deriveVaultMaterial, encryptPayload, WebCryptoProvider } from "@personal-plan/sync";
import { describe, expect, it } from "vitest";

describe("opaque relay", () => {
  it("authenticates, appends opaquely, and bootstraps from an encrypted snapshot", async () => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(6));
    const authToken = base64UrlEncode(material.authToken);
    const verifier = base64UrlEncode(await provider.sha256(material.authToken));
    const create = await SELF.fetch("https://relay.test/v1/vaults", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vaultId: material.vaultId, authVerifier: verifier }) });
    if (create.status !== 201) throw new Error(await create.text());
    expect(create.status).toBe(201);
    expect((await SELF.fetch(`https://relay.test/v1/vaults/${material.vaultId}/updates?after=0`)).status).toBe(401);
    expect((await SELF.fetch(`https://relay.test/v1/vaults/${material.vaultId}/updates?after=0`, { headers: { authorization: `Bearer ${base64UrlEncode(new Uint8Array(32))}` } })).status).toBe(403);

    const plaintext = new TextEncoder().encode("Совершенно секретное дело");
    const update = await encryptPayload(provider, material.encryptionKey, material.vaultId, { kind: "update", updateId: "11111111-1111-4111-8111-111111111111", payload: plaintext, createdAt: "2026-08-04T00:00:00.000Z" });
    const appendBody = JSON.stringify({ updates: [update] });
    expect(appendBody).not.toContain("Совершенно секретное дело");
    const append = await SELF.fetch(`https://relay.test/v1/vaults/${material.vaultId}/updates`, { method: "POST", headers: { authorization: `Bearer ${authToken}`, "content-type": "application/json" }, body: appendBody });
    expect(append.status).toBe(200);
    expect(await append.json()).toEqual({ accepted: [{ updateId: update.updateId, cursor: 1 }] });
    const duplicate = await SELF.fetch(`https://relay.test/v1/vaults/${material.vaultId}/updates`, { method: "POST", headers: { authorization: `Bearer ${authToken}`, "content-type": "application/json" }, body: appendBody });
    expect(await duplicate.json()).toEqual({ accepted: [{ updateId: update.updateId, cursor: 1 }] });

    const snapshot = await encryptPayload(provider, material.encryptionKey, material.vaultId, { kind: "snapshot", updateId: "22222222-2222-4222-8222-222222222222", payload: plaintext, createdAt: "2026-08-04T00:01:00.000Z" });
    expect((await SELF.fetch(`https://relay.test/v1/vaults/${material.vaultId}/snapshot`, { method: "PUT", headers: { authorization: `Bearer ${authToken}`, "content-type": "application/json" }, body: JSON.stringify({ coversThrough: 1, envelope: snapshot }) })).status).toBe(204);
    const bootstrap = await SELF.fetch(`https://relay.test/v1/vaults/${material.vaultId}/bootstrap`, { headers: { authorization: `Bearer ${authToken}` } });
    const body = await bootstrap.json<{ snapshot: { cursor: number }; updates: unknown[]; nextCursor: number }>();
    expect(body.snapshot.cursor).toBe(1);
    expect(body.updates).toEqual([]);
    expect(body.nextCursor).toBe(1);
    expect(JSON.stringify(body)).not.toContain("Совершенно секретное дело");
  });
});
