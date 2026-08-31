import { repairInvalidTaskOrders } from "@personal-plan/core";
import { base64UrlDecode, base64UrlEncode, createPairingQr, deriveVaultMaterial, generateRootSecret, parsePairingQr, phraseToRootSecret, rootSecretToPhrase, SyncClient, SyncIntegrityError, WebCryptoProvider, type RelayTransport, type VaultMaterial } from "@personal-plan/sync";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { IndexedDbSyncStateStore, type StoredSyncSecret } from "../storage/sync-indexeddb.js";
import { usePlan } from "../app/PlanProvider.js";

export type SyncUiState =
  | { kind: "local-only" }
  | { kind: "syncing" }
  | { kind: "synced"; at: string }
  | { kind: "pending"; count: number }
  | { kind: "offline"; count: number }
  | { kind: "error"; code: string };

export interface CreationRecovery {
  phrase: string;
  qr: string;
}

interface SyncContextValue {
  state: SyncUiState;
  enabled: boolean;
  ready: boolean;
  configured: boolean;
  creationRecovery: CreationRecovery | null;
  createVault(): Promise<void>;
  confirmCreationRecovery(): Promise<void>;
  restorePhrase(phrase: string): Promise<void>;
  restoreQr(payload: string): Promise<void>;
  revealPhrase(): Promise<string>;
  pairingQr(): Promise<string>;
  relayUrl: string | null;
}

export interface WebSyncOptions {
  stateStore: IndexedDbSyncStateStore;
  transport: RelayTransport;
  transportForRelay?: (relayUrl: string) => RelayTransport;
  defaultRelayUrl: string;
  pollIntervalMs?: number;
}
export interface WebSyncProviderProps { children: ReactNode; options?: WebSyncOptions | undefined }

const SyncContext = createContext<SyncContextValue | null>(null);

function isTimeout(reason: unknown): boolean {
  if (typeof reason !== "object" || reason === null || !("name" in reason)) return false;
  const name = reason.name;
  return name === "AbortError" || name === "TimeoutError";
}

function errorCode(reason: unknown): string {
  if (reason instanceof SyncIntegrityError) return "integrity_error";
  if (isTimeout(reason)) return "timeout";
  if (reason instanceof Error && "code" in reason && typeof reason.code === "string") return reason.code;
  return reason instanceof TypeError ? "network_unavailable" : "sync_failed";
}

export function WebSyncProvider({ children, options }: WebSyncProviderProps) {
  const { doc } = usePlan();
  const provider = useMemo(() => new WebCryptoProvider(), []);
  const [secret, setSecret] = useState<StoredSyncSecret | null>(null);
  const [ready, setReady] = useState(options === undefined);
  const [material, setMaterial] = useState<VaultMaterial | null>(null);
  const [state, setState] = useState<SyncUiState>({ kind: "local-only" });
  const [creationRecovery, setCreationRecovery] = useState<CreationRecovery | null>(null);
  const nextMode = useRef<"normal" | "seed" | "bootstrap">("normal");
  const clientRef = useRef<SyncClient | null>(null);
  const syncRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (options === undefined) return;
    let active = true;
    void options.stateStore.getActiveSecret().then(async (stored) => {
      if (!active) return;
      if (stored === null) {
        setReady(true);
        return;
      }
      if (await options.stateStore.isCreationRecoveryPending()) {
        setCreationRecovery({
          phrase: rootSecretToPhrase(stored.rootSecret),
          qr: createPairingQr(stored.relayUrl, stored.rootSecret),
        });
      }
      setSecret(stored);
      setMaterial(await deriveVaultMaterial(provider, stored.rootSecret));
      setReady(true);
    }).catch((reason: unknown) => {
      if (active) {
        setReady(true);
        setState({ kind: "error", code: errorCode(reason) });
      }
    });
    return () => { active = false; };
  }, [options, provider]);

  useEffect(() => {
    if (options === undefined || material === null || secret === null) return;
    let active = true;
    let timer: number | null = null;
    let pollTimer: number | null = null;
    let inFlight: Promise<void> | null = null;
    const client = new SyncClient({
      provider,
      material,
      store: options.stateStore,
      transport: options.transportForRelay?.(secret.relayUrl) ?? options.transport,
      onEnqueued: () => {
        if (!active) return;
        void options.stateStore.listOutbox(material.vaultId, 1000).then((items) => {
          if (active) setState({ kind: navigator.onLine ? "pending" : "offline", count: items.length });
        });
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(() => { requestSync(); }, 500);
      },
    });
    clientRef.current = client;
    const repairOrders = (): void => {
      repairInvalidTaskOrders(doc);
    };

    const performSync = async (): Promise<void> => {
      if (!active) return;
      setState({ kind: "syncing" });
      try {
        const result = await client.syncOnce(doc);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- cleanup may set active during await
        if (active) setState(result.status === "synced" ? { kind: "synced", at: new Date().toISOString() } : { kind: "pending", count: 1 });
      } catch (reason) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- cleanup may set active during await
        if (!active) return;
        const pending = await options.stateStore.listOutbox(material.vaultId, 1000).then((items) => items.length).catch(() => 0);
        if (!navigator.onLine || reason instanceof TypeError) setState({ kind: "offline", count: pending });
        else setState({ kind: "error", code: errorCode(reason) });
      }
    };
    const runSync = (): Promise<void> => {
      inFlight ??= performSync().finally(() => { inFlight = null; });
      return inFlight;
    };
    const schedulePoll = (): void => {
      if (!active) return;
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      pollTimer = window.setTimeout(() => {
        pollTimer = null;
        if (!active) return;
        if (document.visibilityState !== "visible") {
          schedulePoll();
          return;
        }
        void runSync().finally(schedulePoll);
      }, Math.max(1, options.pollIntervalMs ?? 5_000));
    };
    const requestSync = (): void => {
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
        pollTimer = null;
      }
      void runSync().finally(schedulePoll);
    };
    syncRef.current = runSync;

    const initialize = async (): Promise<void> => {
      const mode = nextMode.current;
      nextMode.current = "normal";
      if (mode === "bootstrap" || (mode === "normal" && doc.getMap("tasks").size === 0)) {
        setState({ kind: "syncing" });
        await client.bootstrapInto(doc);
      } else {
        client.start(doc);
      }
      doc.on("update", repairOrders);
      repairInvalidTaskOrders(doc);
      if (mode === "seed") {
        await client.enqueueCurrentState(doc);
      }
      await runSync();
      schedulePoll();
    };
    void initialize().catch((reason: unknown) => { if (active) setState({ kind: "error", code: errorCode(reason) }); });

    const online = (): void => { requestSync(); };
    const focus = (): void => { requestSync(); };
    const visibility = (): void => {
      if (document.visibilityState === "visible") requestSync();
    };
    window.addEventListener("online", online);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      window.removeEventListener("online", online);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
      doc.off("update", repairOrders);
      syncRef.current = null;
      clientRef.current = null;
      void client.stop();
    };
  }, [doc, material, options, provider, secret]);

  const activate = useCallback(async (stored: StoredSyncSecret, mode: "normal" | "seed" | "bootstrap", recoveryAcknowledged = true) => {
    if (options === undefined) throw new Error("Synchronization is disabled");
    nextMode.current = mode;
    await options.stateStore.setActiveSecret(stored, recoveryAcknowledged);
    setSecret(stored);
    setMaterial(await deriveVaultMaterial(provider, stored.rootSecret));
  }, [options, provider]);

  const restore = useCallback(async (stored: StoredSyncSecret) => {
    if (options === undefined) throw new Error("Synchronization is disabled");
    const nextMaterial = await deriveVaultMaterial(provider, stored.rootSecret);
    if (material !== null && material.vaultId !== nextMaterial.vaultId) {
      throw new Error("vault_mismatch");
    }
    const client = new SyncClient({
      provider,
      material: nextMaterial,
      store: options.stateStore,
      transport: options.transportForRelay?.(stored.relayUrl) ?? options.transport,
    });
    setState({ kind: "syncing" });
    try {
      await client.bootstrapInto(doc);
      await client.stop();
      await activate(stored, "normal");
    } catch (reason) {
      await client.stop().catch(() => undefined);
      setState({ kind: "error", code: errorCode(reason) });
      throw reason;
    }
  }, [activate, doc, material, options, provider]);

  const createVault = useCallback(async () => {
    if (options === undefined) throw new Error("Synchronization is disabled");
    const rootSecret = await generateRootSecret(provider);
    const nextMaterial = await deriveVaultMaterial(provider, rootSecret);
    const verifier = base64UrlEncode(await provider.sha256(nextMaterial.authToken));
    await (options.transportForRelay?.(options.defaultRelayUrl) ?? options.transport).createVault(nextMaterial.vaultId, verifier);
    await activate({ rootSecret, relayUrl: options.defaultRelayUrl }, "seed", false);
    setCreationRecovery({
      phrase: rootSecretToPhrase(rootSecret),
      qr: createPairingQr(options.defaultRelayUrl, rootSecret),
    });
  }, [activate, options, provider]);

  const confirmCreationRecovery = useCallback(async () => {
    if (options === undefined) throw new Error("Synchronization is disabled");
    await options.stateStore.acknowledgeCreationRecovery();
    setCreationRecovery(null);
  }, [options]);

  const restorePhrase = useCallback(async (phrase: string) => {
    if (options === undefined) throw new Error("Synchronization is disabled");
    await restore({ rootSecret: phraseToRootSecret(phrase), relayUrl: options.defaultRelayUrl });
  }, [options, restore]);

  const restoreQr = useCallback(async (payload: string) => {
    const parsed = parsePairingQr(payload);
    await restore({ rootSecret: base64UrlDecode(parsed.rootSecret), relayUrl: parsed.relayUrl });
  }, [restore]);

  const revealPhrase = useCallback(async () => {
    if (options === undefined) throw new Error("Synchronization is disabled");
    const stored = await options.stateStore.getActiveSecret();
    if (stored === null) throw new Error("Encrypted storage is not configured");
    return rootSecretToPhrase(stored.rootSecret);
  }, [options]);

  const pairingQr = useCallback((): Promise<string> => {
    if (secret === null) return Promise.reject(new Error("Encrypted storage is not configured"));
    return Promise.resolve(createPairingQr(secret.relayUrl, secret.rootSecret));
  }, [secret]);

  const value = useMemo<SyncContextValue>(() => ({
    state: options === undefined ? { kind: "local-only" } : state,
    enabled: options !== undefined,
    ready,
    configured: secret !== null,
    creationRecovery,
    createVault,
    confirmCreationRecovery,
    restorePhrase,
    restoreQr,
    revealPhrase,
    pairingQr,
    relayUrl: secret?.relayUrl ?? null,
  }), [confirmCreationRecovery, createVault, creationRecovery, options, pairingQr, ready, restorePhrase, restoreQr, revealPhrase, secret, state]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useWebSync(): SyncContextValue {
  const value = useContext(SyncContext);
  if (value === null) throw new Error("useWebSync must be used inside WebSyncProvider");
  return value;
}
