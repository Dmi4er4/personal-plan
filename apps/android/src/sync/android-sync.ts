import { pruneExpiredHistory, pruneAppliedWidgetCommands, repairInvalidTaskOrders, type LocalDate } from "@personal-plan/core";
import type { SyncClientApi } from "@personal-plan/sync";
import type * as Y from "yjs";
import type { SqlitePlanStore } from "../storage/sqlite-plan-store";
import type { WidgetBridge, WidgetSnapshot } from "../widget/contracts";
import { processWidgetCommands } from "../widget/process-commands";
import { writeWidgetSnapshot } from "../widget/write-widget-snapshot";

export type AndroidSyncReason = "startup" | "foreground" | "network" | "background" | "widget";
export interface AndroidSyncResult { reason: AndroidSyncReason; commandsProcessed: number; uploaded: number; downloaded: number; widgetStatus: WidgetSnapshot["syncState"]; error: string | null }
export interface AndroidSyncDependencies { doc: Y.Doc; planStore: SqlitePlanStore; syncClient: SyncClientApi; bridge: WidgetBridge; today(): LocalDate; isOnline(): Promise<boolean> }

const SYNC_MAINTENANCE_MAP = "syncMaintenance";
const ANDROID_FULL_STATE_MARKER = "androidFullStateVersion";
const ANDROID_FULL_STATE_VERSION = 1;

export async function ensureAndroidFullStatePublished(doc: Y.Doc, syncClient: SyncClientApi): Promise<boolean> {
  const maintenance = doc.getMap<number>(SYNC_MAINTENANCE_MAP);
  if ((maintenance.get(ANDROID_FULL_STATE_MARKER) ?? 0) >= ANDROID_FULL_STATE_VERSION) {
    return false;
  }
  await syncClient.enqueueCurrentState(doc);
  doc.transact(() => {
    maintenance.set(ANDROID_FULL_STATE_MARKER, ANDROID_FULL_STATE_VERSION);
  }, "android-full-state-reconciliation");
  return true;
}

export function needsRemoteBootstrap(doc: Y.Doc): boolean {
  return doc.getMap("tasks").size === 0;
}
let dependencies: AndroidSyncDependencies | null = null;
let inFlight: Promise<AndroidSyncResult> | null = null;
export function configureAndroidSync(value: AndroidSyncDependencies | null): void { dependencies = value; }
export function isAndroidSyncConfigured(): boolean { return dependencies !== null; }

export async function runAndroidSyncWithDependencies(reason: AndroidSyncReason, value: AndroidSyncDependencies): Promise<AndroidSyncResult> {
  const { doc, planStore, syncClient, bridge } = value; const today = value.today();
  // Widget commands and offline app edits must be captured before any local
  // mutation happens. syncOnce waits for the client's capture queue, so a
  // command drained below is uploaded by this same run instead of being
  // reported as synced while remaining local-only.
  syncClient.start(doc);
  const repairOrders = (): void => {
    repairInvalidTaskOrders(doc);
  };
  doc.on("update", repairOrders);
  try {
    repairInvalidTaskOrders(doc);
    if (!needsRemoteBootstrap(doc)) {
      await ensureAndroidFullStatePublished(doc, syncClient);
    }
    const commandsProcessed = await processWidgetCommands(doc, bridge, today, "pending");
    let uploaded = 0; let downloaded = 0; let widgetStatus: WidgetSnapshot["syncState"] = "offline"; let error: string | null = null;
    if (await value.isOnline()) {
      try {
        let result;
        if (needsRemoteBootstrap(doc)) {
          result = await syncClient.bootstrapInto(doc);
        } else {
          result = await syncClient.syncOnce(doc);
        }
        uploaded = result.uploaded;
        downloaded = result.downloaded;
        widgetStatus = result.status;
      } catch (reason) {
        widgetStatus = "error";
        error = reason instanceof Error ? reason.message : "sync_failed";
      }
    } else {
      error = "offline";
    }
    pruneExpiredHistory(doc, today); pruneAppliedWidgetCommands(doc, today);
    if (await planStore.updateCount() > 200) await planStore.compact(doc);
    await planStore.flush();
    await writeWidgetSnapshot(doc, bridge, today, widgetStatus);
    return { reason, commandsProcessed, uploaded, downloaded, widgetStatus, error };
  } finally {
    doc.off("update", repairOrders);
  }
}

export function runAndroidSync(reason: AndroidSyncReason): Promise<AndroidSyncResult> {
  if (inFlight !== null) return inFlight;
  if (dependencies === null) return Promise.reject(new Error("android_sync_not_configured"));
  inFlight = runAndroidSyncWithDependencies(reason, dependencies).finally(() => { inFlight = null; });
  return inFlight;
}
