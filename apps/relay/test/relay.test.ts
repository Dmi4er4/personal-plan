import { SELF } from "cloudflare:test";
import { base64UrlEncode, deriveVaultMaterial, encryptPayload, WebCryptoProvider } from "@personal-plan/sync";
import { describe, expect, it } from "vitest";

describe("opaque relay", () => {
  it("paginates large bootstrap and update responses without changing the legacy API", async () => {
    const provider = new WebCryptoProvider();
    const material = await deriveVaultMaterial(provider, new Uint8Array(32).fill(17));
    const headers = { authorization: `Bearer ${base64UrlEncode(material.authToken)}`, "content-type": "application/json" };
    expect((await SELF.fetch("https://relay.test/v1/vaults", { method: "POST", headers, body: JSON.stringify({ vaultId: material.vaultId, authVerifier: base64UrlEncode(await provider.sha256(material.authToken)) }) })).status).toBe(201);
    const envelope = { version: 1, kind: "update", vaultId: material.vaultId, updateId: "11111111-1111-4111-8111-111111111111", nonce: base64UrlEncode(new Uint8Array(12)), ciphertext: base64UrlEncode(new Uint8Array(600_000)), createdAt: "2026-10-12T00:00:00.000Z" };
    const url = `https://relay.test/v1/vaults/${material.vaultId}`;
    for (let index = 1; index <= 4; index += 1) {
      const update = { ...envelope, updateId: `${String(index).repeat(8)}-1111-4111-8111-111111111111` };
      expect((await SELF.fetch(`${url}/updates`, { method: "POST", headers, body: JSON.stringify({ updates: [update] }) })).status).toBe(200);
    }
    expect((await SELF.fetch(`${url}/snapshot`, { method: "PUT", headers, body: JSON.stringify({ coversThrough: 1, envelope: { ...envelope, kind: "snapshot" } }) })).status).toBe(204);
    const initialText = await (await SELF.fetch(`${url}/bootstrap?paged=1`, { headers })).text();
    expect(new TextEncoder().encode(initialText).length).toBeLessThanOrEqual(1_500_000);
    const initial = JSON.parse(initialText) as { snapshot: { cursor: number }; updates: unknown[]; nextCursor: number; hasMore: boolean };
    expect(initial.snapshot.cursor).toBe(1);
    expect(initial.updates).toEqual([]);
    expect(initial.nextCursor).toBe(1);
    expect(initial.hasMore).toBe(true);
    let cursor = initial.nextCursor;
    const cursors: number[] = [];
    for (;;) {
      const text = await (await SELF.fetch(`${url}/updates?after=${String(cursor)}&paged=1`, { headers })).text();
      expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(1_500_000);
      const page = JSON.parse(text) as { updates: Array<{ cursor: number }>; nextCursor: number; hasMore: boolean };
      expect(page.nextCursor).toBeGreaterThan(cursor);
      cursors.push(...page.updates.map((update) => update.cursor));
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
    expect(cursors).toEqual([2, 3, 4]);
    const legacy = await (await SELF.fetch(`${url}/bootstrap`, { headers })).json<{ updates: unknown[]; nextCursor: number; hasMore?: boolean }>();
    expect(legacy.updates).toHaveLength(3);
    expect(legacy.nextCursor).toBe(4);
    expect(legacy.hasMore).toBeUndefined();
    expect((await SELF.fetch(`${url}/snapshot`, { method: "PUT", headers, body: JSON.stringify({ coversThrough: 3, envelope: { ...envelope, kind: "snapshot" } }) })).status).toBe(204);
    const shortcutText = await (await SELF.fetch(`${url}/updates?after=0&paged=1&resume=1`, { headers })).text();
    expect(new TextEncoder().encode(shortcutText).length).toBeLessThan(500);
    expect(JSON.parse(shortcutText)).toEqual({ updates: [], nextCursor: 0, hasMore: false, anchorUpdateId: null, bootstrapRequired: true });
    const continuation = await (await SELF.fetch(`${url}/updates?after=1&paged=1&resume=0`, { headers })).json<{ anchorUpdateId: string; updates: unknown[]; bootstrapRequired?: boolean }>();
    expect(continuation.anchorUpdateId).toBe(envelope.updateId);
    expect(continuation.updates).toHaveLength(1);
    expect(continuation.bootstrapRequired).toBeUndefined();
  });

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
