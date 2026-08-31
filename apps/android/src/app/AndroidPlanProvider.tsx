import { isLocalDate, projectPlan, snapshotPlan, type LocalDate } from "@personal-plan/core";
import { deriveVaultMaterial, SyncClient, type RelayTransport } from "@personal-plan/sync";
import NetInfo from "@react-native-community/netinfo";
import Constants from "expo-constants";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState, Text } from "react-native";
import type * as Y from "yjs";
import PlanWidget from "../../modules/plan-widget";
import { ExpoCryptoProvider } from "../crypto/expo-crypto-provider";
import { SqlitePlanStore } from "../storage/sqlite-plan-store";
import { SecureVaultStore, type StoredVaultConfig } from "../storage/secure-vault";
import { SqliteSyncStateStore } from "../storage/sqlite-sync-store";
import { configureAndroidSync, runAndroidSync } from "../sync/android-sync";
import { registerBackgroundSync } from "../sync/background-task";
import { startForegroundSyncPolling } from "../sync/foreground-polling";
import { AndroidHttpRelayTransport } from "../sync/http-relay-transport";
import { processWidgetCommands } from "../widget/process-commands";
import type { WidgetBridge, WidgetSnapshot } from "../widget/contracts";

function today(): LocalDate {
  const qaToday: unknown = Constants.expoConfig?.extra?.qaToday;
  if (isLocalDate(qaToday)) {
    return qaToday;
  }
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` as LocalDate;
}
export interface AndroidPlanContext { doc: Y.Doc; today: LocalDate; projected: ReturnType<typeof projectPlan>; draft: string | null; rootSecret: Uint8Array; relayUrl: string; syncError: string | null; syncState: WidgetSnapshot["syncState"]; saveDraft(value: string): Promise<void>; clearDraft(): Promise<void>; restoreFromServer(): Promise<void>; disconnectVault(): Promise<void> }
const Context = createContext<AndroidPlanContext | null>(null);
export interface AndroidPlanProviderProps { children: ReactNode; config: StoredVaultConfig; planStore?: SqlitePlanStore; syncStore?: SqliteSyncStateStore; bridge?: WidgetBridge; transport?: RelayTransport; onRestoreFromServer?(): Promise<void>; onDisconnect?(): Promise<void> }

function syncErrorLabel(error: string | null): string | null {
  if (error === null) return null;
  if (error === "offline") return "Нет сети — план пока только локальный";
  if (error.includes("relay_http_404")) return "На сервере нет хранилища с этой фразой. Сначала на Mac нажмите «Создать зашифрованное хранилище»";
  if (error.includes("relay_http_401") || error.includes("relay_http_403")) return "Фраза не подходит к хранилищу на сервере";
  return "Не удалось синхронизировать план";
}

export function AndroidPlanProvider({ children, config, planStore, syncStore, bridge, transport, onRestoreFromServer, onDisconnect }: AndroidPlanProviderProps) {
  const resolvedPlanStore = useMemo(() => planStore ?? new SqlitePlanStore(), [planStore]);
  const resolvedSyncStore = useMemo(() => syncStore ?? new SqliteSyncStateStore(), [syncStore]);
  const resolvedBridge = bridge ?? PlanWidget;
  const resolvedTransport = useMemo(() => transport ?? new AndroidHttpRelayTransport(config.relayUrl), [config.relayUrl, transport]);
  const [loaded, setLoaded] = useState<{ doc: Y.Doc; draft: string | null } | null>(null); const [revision, setRevision] = useState(0); const [syncError, setSyncError] = useState<string | null>(null); const [syncState, setSyncState] = useState<WidgetSnapshot["syncState"]>("pending");
  useEffect(() => { let cancelled = false; let doc: Y.Doc | null = null; let sync: SyncClient | null = null; let timer: ReturnType<typeof setTimeout> | null = null; let widgetTimer: ReturnType<typeof setTimeout> | null = null; let appState: { remove(): void } | null = null; let network: (() => void) | null = null; let stopPolling: (() => void) | null = null;
    void Promise.all([resolvedPlanStore.load(), resolvedPlanStore.loadDraft(), deriveVaultMaterial(new ExpoCryptoProvider(), config.rootSecret)]).then(async ([nextDoc, draft, material]) => {
      if (cancelled) return; doc = nextDoc; sync = new SyncClient({ provider: new ExpoCryptoProvider(), material, store: resolvedSyncStore, transport: resolvedTransport });
      configureAndroidSync({ doc, planStore: resolvedPlanStore, syncClient: sync, bridge: resolvedBridge, today, isOnline: async () => (await NetInfo.fetch()).isConnected === true });
      let widgetStatus: WidgetSnapshot["syncState"] = "pending";
      const trackSyncResult = (result: { widgetStatus: WidgetSnapshot["syncState"]; error: string | null }) => {
        widgetStatus = result.widgetStatus;
        setSyncState(result.widgetStatus);
        setSyncError(syncErrorLabel(result.error));
      };
      const refreshWidget = () => {
        if (widgetTimer) clearTimeout(widgetTimer);
        widgetTimer = setTimeout(() => {
          const current = doc;
          if (current === null) return;
          const attempt = (retried: boolean): void => {
            // processWidgetCommands first drains any pending widget checkbox
            // commands into the doc and only then writes the snapshot — so an
            // app-side write can never overwrite the widget's optimistic toggle.
            processWidgetCommands(current, resolvedBridge, today(), widgetStatus).catch((reason: unknown) => {
              console.warn("widget snapshot failed", reason instanceof Error ? reason.message : String(reason));
              if (!retried) {
                widgetTimer = setTimeout(() => attempt(true), 250);
              }
            });
          };
          attempt(false);
        }, 0);
      };
      const refresh = () => {
        setRevision((value) => value + 1);
        widgetStatus = "pending";
        setSyncState("pending");
        refreshWidget();
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { void runAndroidSync("foreground").then(trackSyncResult).catch(() => { setSyncState("error"); setSyncError("Не удалось синхронизировать план"); }); }, 500);
      };
      doc.on("update", refresh);
      try {
        const result = await runAndroidSync("startup");
        trackSyncResult(result);
      } catch {
        setSyncState("error");
        setSyncError("Не удалось синхронизировать план");
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- cleanup may set cancelled during await
      if (cancelled) return;
      appState = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          void runAndroidSync("foreground").then(trackSyncResult).catch(() => { setSyncState("error"); setSyncError("Не удалось синхронизировать план"); });
        }
      });
      network = NetInfo.addEventListener((state) => {
        if (state.isConnected) {
          void runAndroidSync("network").then(trackSyncResult).catch(() => { setSyncState("error"); setSyncError("Не удалось синхронизировать план"); });
        }
      });
      stopPolling = startForegroundSyncPolling({
        isActive: () => AppState.currentState === "active",
        run: () => {
          void runAndroidSync("foreground").then(trackSyncResult).catch(() => { setSyncState("error"); setSyncError("Не удалось синхронизировать план"); });
        },
      });
      setLoaded({ doc, draft }); setRevision((value) => value + 1); void registerBackgroundSync();
    });
    return () => { cancelled = true; if (timer) clearTimeout(timer); if (widgetTimer) clearTimeout(widgetTimer); stopPolling?.(); appState?.remove(); network?.(); configureAndroidSync(null); if (sync) void sync.stop(); if (doc) { doc.destroy(); resolvedPlanStore.detachDoc(doc); } };
  }, [config.rootSecret, resolvedBridge, resolvedPlanStore, resolvedSyncStore, resolvedTransport]);
  const value = useMemo(() => {
    if (loaded === null) {
      return null;
    }
    const snapshot = snapshotPlan(loaded.doc);
    return {
      doc: loaded.doc,
      today: today(),
      projected: projectPlan(snapshot.tasks, today(), snapshot.records),
      draft: loaded.draft,
      rootSecret: config.rootSecret,
      relayUrl: config.relayUrl,
      syncError,
      syncState,
      saveDraft: async (text: string) => {
        await resolvedPlanStore.saveDraft(text);
        setLoaded((current) => (current ? { ...current, draft: text } : current));
      },
      clearDraft: async () => {
        await resolvedPlanStore.clearDraft();
        setLoaded((current) => (current ? { ...current, draft: null } : current));
      },
      restoreFromServer: async () => {
        if (onRestoreFromServer === undefined) {
          throw new Error("server_restore_unavailable");
        }
        await onRestoreFromServer();
      },
      disconnectVault: async () => {
        if (onDisconnect === undefined) {
          throw new Error("disconnect_unavailable");
        }
        await onDisconnect();
      },
    };
  }, [config.relayUrl, config.rootSecret, loaded, onDisconnect, onRestoreFromServer, resolvedPlanStore, revision, syncError, syncState]);
  return value === null ? <Text>Загрузка локального плана…</Text> : <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAndroidPlan(): AndroidPlanContext { const value = useContext(Context); if (value === null) throw new Error("useAndroidPlan outside provider"); return value; }
export async function configureVault(store: SecureVaultStore, config: StoredVaultConfig): Promise<void> { await store.save(config); }
