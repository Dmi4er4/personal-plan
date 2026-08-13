import "fake-indexeddb/auto";
import { addTask, createPlanDoc, type LocalDate } from "@personal-plan/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { deriveVaultMaterial, SyncClient, WebCryptoProvider, type AppendUpdatesResponse, type BootstrapResponse, type EncryptedEnvelope, type ListUpdatesResponse, type OutboxEntry, type RelayTransport, type SyncStateStore } from "@personal-plan/sync";
import type * as Y from "yjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/app/App.js";
import type { PersistenceState, PlanStore } from "../../src/storage/plan-store.js";
import { IndexedDbSyncStateStore } from "../../src/storage/sync-indexeddb.js";
import { openSettings } from "../ui/open-settings.js";

class MemoryPlanStore implements PlanStore {
  readonly doc = createPlanDoc();
  load(): Promise<Y.Doc> { return Promise.resolve(this.doc); }
  loadDraft(): Promise<string | null> { return Promise.resolve(null); }
  saveDraft(): Promise<void> { return Promise.resolve(); }
  clearDraft(): Promise<void> { return Promise.resolve(); }
  getPersistenceState(): PersistenceState { return { error: null, status: "saved" }; }
  subscribePersistence(listener: (state: PersistenceState) => void): () => void { listener(this.getPersistenceState()); return () => undefined; }
  retryPersistence(): Promise<void> { return Promise.resolve(); }
  destroy(): Promise<void> { return Promise.resolve(); }
}

class FakeRelay implements RelayTransport {
  online = true;
  bootstrapCalls = 0;
  listCalls = 0;
  readonly createCalls: unknown[][] = [];
  readonly updates: EncryptedEnvelope[] = [];
  createVault(...args: [string, string]): Promise<void> { this.createCalls.push(args); return Promise.resolve(); }
  append(_vaultId: string, _authToken: string, updates: EncryptedEnvelope[]): Promise<AppendUpdatesResponse> {
    if (!this.online) return Promise.reject(new TypeError("offline"));
    this.updates.push(...updates);
    return Promise.resolve({ accepted: updates.map((envelope, index) => ({ updateId: envelope.updateId, cursor: this.updates.length - updates.length + index + 1 })) });
  }
  list(_vaultId: string, _authToken: string, after: number): Promise<ListUpdatesResponse> {
    if (!this.online) return Promise.reject(new TypeError("offline"));
    this.listCalls += 1;
    return Promise.resolve({
      updates: this.updates.slice(after).map((envelope, index) => ({ cursor: after + index + 1, envelope })),
      nextCursor: this.updates.length,
    });
  }
  putSnapshot(): Promise<void> { return Promise.resolve(); }
  bootstrap(): Promise<BootstrapResponse> {
    this.bootstrapCalls += 1;
    return Promise.resolve({ snapshot: null, updates: this.updates.map((envelope, index) => ({ cursor: index + 1, envelope })), nextCursor: this.updates.length });
  }
}

class MemorySyncStore implements SyncStateStore {
  cursor = 0;
  acknowledged = 0;
  outbox: OutboxEntry[] = [];
  getCursor(): Promise<number> { return Promise.resolve(this.cursor); }
  setCursor(_vaultId: string, cursor: number): Promise<void> { this.cursor = cursor; return Promise.resolve(); }
  enqueue(entry: OutboxEntry): Promise<void> { this.outbox.push(entry); return Promise.resolve(); }
  listOutbox(vaultId: string, limit: number): Promise<OutboxEntry[]> { return Promise.resolve(this.outbox.filter((entry) => entry.envelope.vaultId === vaultId).slice(0, limit)); }
  acknowledge(ids: string[]): Promise<number> {
    const before = this.outbox.length;
    this.outbox = this.outbox.filter((entry) => !ids.includes(entry.envelope.updateId));
    const count = before - this.outbox.length;
    this.acknowledged += count;
    return Promise.resolve(count);
  }
  getAcknowledgedSinceSnapshot(): Promise<number> { return Promise.resolve(this.acknowledged); }
  resetAcknowledgedSinceSnapshot(): Promise<void> { this.acknowledged = 0; return Promise.resolve(); }
}

const today = (): LocalDate => "2026-08-04";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("WebSyncProvider", () => {
  it("creates with only a verifier, reveals a phrase explicitly, and stays editable offline", async () => {
    const relay = new FakeRelay();
    const stateStore = new IndexedDbSyncStateStore(`web-sync-${crypto.randomUUID()}`);
    render(<App store={new MemoryPlanStore()} today={today} sync={{ defaultRelayUrl: "http://127.0.0.1:8787", stateStore, transport: relay }} />);
    await userEvent.click(await screen.findByRole("button", { name: "Создать новое хранилище" }));
    expect(await screen.findByRole("heading", { name: "Сохраните фразу восстановления" })).toBeVisible();
    const creationPhrase = (await screen.findByLabelText("Фраза восстановления")).textContent;
    expect(creationPhrase.split(" ")).toHaveLength(24);
    expect(screen.queryByRole("tab", { name: "Список" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Я сохранил фразу" }));
    await openSettings(userEvent.setup());
    const reveal = await screen.findByRole("button", { name: "Показать фразу восстановления" });
    expect(relay.createCalls).toHaveLength(1);
    expect(relay.createCalls[0]).toEqual([expect.any(String), expect.any(String)]);
    expect(document.body.textContent).not.toMatch(/[A-Za-z0-9_-]{43}/u);
    await userEvent.click(reveal);
    const revealedPhrase = (await screen.findByLabelText("Фраза восстановления")).textContent;
    expect(revealedPhrase.split(" ")).toHaveLength(24);
    expect(screen.getByRole("button", { name: "Переподключить устройство" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "← Назад" }));

    relay.online = false;
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await userEvent.click(screen.getByRole("button", { name: "Новое дело" }));
    const input = screen.getByRole("textbox", { name: "Название нового дела" });
    await userEvent.type(input, "Локальное офлайн-дело{Enter}");
    expect(screen.getByText("Локальное офлайн-дело", { exact: true })).toBeVisible();
    await openSettings(userEvent.setup());
    expect(await screen.findByText(/^офлайн/u)).toBeVisible();
    await stateStore.destroy();
  });

  it("keeps the mandatory recovery step across a reload until acknowledged", async () => {
    const relay = new FakeRelay();
    const stateStore = new IndexedDbSyncStateStore(`web-sync-recovery-${crypto.randomUUID()}`);
    const sync = { defaultRelayUrl: "http://127.0.0.1:8787", stateStore, transport: relay };
    const first = render(<App store={new MemoryPlanStore()} today={today} sync={sync} />);
    await userEvent.click(await screen.findByRole("button", { name: "Создать новое хранилище" }));
    expect(await screen.findByRole("heading", { name: "Сохраните фразу восстановления" })).toBeVisible();

    first.unmount();
    render(<App store={new MemoryPlanStore()} today={today} sync={sync} />);
    expect(await screen.findByRole("heading", { name: "Сохраните фразу восстановления" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Список" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Я сохранил фразу" }));
    expect(await screen.findByRole("tab", { name: "Список" })).toBeVisible();
    await stateStore.destroy();
  });

  it("pulls a remote edit while the visible PWA stays open", async () => {
    const relay = new FakeRelay();
    const rootSecret = new Uint8Array(32).fill(12);
    const stateStore = new IndexedDbSyncStateStore(`web-sync-poll-${crypto.randomUUID()}`);
    await stateStore.setActiveSecret({ rootSecret, relayUrl: "http://127.0.0.1:8787" });
    const view = render(<App
      store={new MemoryPlanStore()}
      today={today}
      sync={{ defaultRelayUrl: "http://127.0.0.1:8787", pollIntervalMs: 20, stateStore, transport: relay }}
    />);
    await screen.findByRole("tab", { name: "Список" });
    expect(relay.bootstrapCalls).toBe(1);
    await waitFor(() => { expect(relay.listCalls).toBeGreaterThan(0); });

    const remoteDoc = createPlanDoc();
    const remoteClient = new SyncClient({
      provider: new WebCryptoProvider(),
      material: await deriveVaultMaterial(new WebCryptoProvider(), rootSecret),
      store: new MemorySyncStore(),
      transport: relay,
    });
    remoteClient.start(remoteDoc);
    addTask(remoteDoc, {
      id: "remote-poll-task",
      title: "Изменение с телефона",
      note: null,
      bucket: { kind: "date", date: today() },
      parentId: null,
      order: 0,
      now: "2026-08-04T10:00:00.000Z",
    });
    await remoteClient.stop();
    await remoteClient.syncOnce(remoteDoc);

    expect(await screen.findByText("Изменение с телефона")).toBeVisible();
    view.unmount();
    await stateStore.destroy();
  });
});
