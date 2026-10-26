import { pruneExpiredHistory, pruneAppliedWidgetCommands, repairInvalidTaskOrders, type LocalDate } from "@personal-plan/core";
import { reconcileAtStartup, type SyncClientApi } from "@personal-plan/sync";
import type * as Y from "yjs";
import { documentRevision } from "../app/doc-revision";
import type { SqlitePlanStore } from "../storage/sqlite-plan-store";
import type { WidgetBridge, WidgetSnapshot } from "../widget/contracts";
import { processWidgetCommands } from "../widget/process-commands";
import { writeWidgetSnapshot } from "../widget/write-widget-snapshot";

export type AndroidSyncReason = "startup" | "foreground" | "network" | "background" | "widget";
export interface AndroidSyncResult { reason: AndroidSyncReason; commandsProcessed: number; uploaded: number; downloaded: number; widgetStatus: WidgetSnapshot["syncState"]; error: string | null }
export interface AndroidSyncDependencies { doc: Y.Doc; planStore: SqlitePlanStore; syncClient: SyncClientApi; bridge: WidgetBridge; today(): LocalDate; isOnline(): Promise<boolean> }

export function needsRemoteBootstrap(doc: Y.Doc): boolean {
  return doc.getMap("tasks").size === 0;
}
let dependencies: AndroidSyncDependencies | null = null;
let inFlight: Promise<AndroidSyncResult> | null = null;
const maintenance = new WeakMap<Y.Doc, { repairedRevision: number; prunedRevision: number; prunedOn: LocalDate | null }>();
export function configureAndroidSync(value: AndroidSyncDependencies | null): void { dependencies = value; }
export function isAndroidSyncConfigured(): boolean { return dependencies !== null; }

export async function runAndroidSyncWithDependencies(reason: AndroidSyncReason, value: AndroidSyncDependencies): Promise<AndroidSyncResult> {
  const started = performance.now();
  let lastStage = started;
  const timings: Record<string, number> = {};
  const mark = (stage: string): void => {
    const now = performance.now();
    timings[stage] = Math.round(now - lastStage);
    lastStage = now;
  };
  const { doc, planStore, syncClient, bridge } = value; const today = value.today();
  documentRevision(doc);
  let maintained = maintenance.get(doc);
  if (maintained === undefined) {
    maintained = { repairedRevision: -1, prunedRevision: -1, prunedOn: null };
    maintenance.set(doc, maintained);
  }
  const state = maintained;
  // Widget commands and offline app edits must be captured before any local
  // mutation happens. syncOnce waits for the client's capture queue, so a
  // command drained below is uploaded by this same run instead of being
  // reported as synced while remaining local-only.
  syncClient.start(doc);
  // Verify the loaded baseline before applying durable widget commands. New
  // edits are then covered by the active capture listener and stay incremental.
  if (syncClient.canResumeFromCheckpoint !== undefined) {
    await syncClient.canResumeFromCheckpoint(doc).catch(() => false);
  }
  mark("resumeMs");
  let repairing = false;
  const repairOrders = (): void => {
    if (repairing || state.repairedRevision === documentRevision(doc)) return;
    repairing = true;
    try {
      repairInvalidTaskOrders(doc);
      state.repairedRevision = documentRevision(doc);
    } finally {
      repairing = false;
    }
  };
  doc.on("update", repairOrders);
  try {
    repairOrders();
    mark("repairMs");
    const commandsProcessed = await processWidgetCommands(doc, bridge, today, "pending", { refreshIfUnchanged: false });
    mark("commandsMs");
    let uploaded = 0; let downloaded = 0; let widgetStatus: WidgetSnapshot["syncState"] = "offline"; let error: string | null = null;
    if (await value.isOnline()) {
      try {
        let result;
        if (reason !== "background" || syncClient.canResumeFromCheckpoint !== undefined) {
          result = await reconcileAtStartup(syncClient, doc);
        } else if (needsRemoteBootstrap(doc)) {
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
        const name = reason instanceof Error ? reason.name : "Error";
        const code = /^relay_http_\d{3}$/u.test(error) ? error : ["AbortError", "TimeoutError", "SyncIntegrityError", "TypeError"].includes(name) ? name : "sync_failed";
        console.warn(`personal-plan sync failed: ${code}`);
      }
    } else {
      error = "offline";
    }
    mark("reconcileMs");
    if (state.prunedRevision !== documentRevision(doc) || state.prunedOn !== today) {
      pruneExpiredHistory(doc, today);
      pruneAppliedWidgetCommands(doc, today);
      state.prunedRevision = documentRevision(doc);
      state.prunedOn = today;
    }
    mark("pruneMs");
    if (await planStore.updateCount() > 200) await planStore.compact(doc);
    mark("compactMs");
    await planStore.flush();
    mark("flushMs");
    await writeWidgetSnapshot(doc, bridge, today, widgetStatus);
    mark("widgetMs");
    if (lastStage - started >= 50) console.info(`personal-plan perf sync ${JSON.stringify({ reason, ...timings, totalMs: Math.round(lastStage - started) })}`);
    console.info(`personal-plan sync completed: reason=${reason} uploaded=${String(uploaded)} downloaded=${String(downloaded)} status=${widgetStatus}`);
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
