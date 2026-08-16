import type { LocalDate } from "@personal-plan/core";
import type { SyncClientApi } from "@personal-plan/sync";
import type { StoredVaultConfig } from "../storage/secure-vault";
import type { SqlitePlanStore } from "../storage/sqlite-plan-store";
import type { WidgetBridge } from "../widget/contracts";
import { runAndroidSyncWithDependencies, type AndroidSyncResult } from "./android-sync";

export interface HeadlessAndroidSyncRuntime {
  loadVault(): Promise<StoredVaultConfig | null>;
  createPlanStore(): SqlitePlanStore;
  createSyncClient(config: StoredVaultConfig): Promise<SyncClientApi>;
  bridge: WidgetBridge;
  today(): LocalDate;
  isOnline(): Promise<boolean>;
}

/**
 * Runs a complete sync session without relying on a mounted React provider.
 * Expo TaskManager can therefore execute it after Android has reclaimed the
 * application process or the user has removed the app from recents.
 */
export async function runHeadlessAndroidSync(runtime: HeadlessAndroidSyncRuntime): Promise<AndroidSyncResult | null> {
  const config = await runtime.loadVault();
  if (config === null) return null;

  const planStore = runtime.createPlanStore();
  const doc = await planStore.load();
  let syncClient: SyncClientApi | null = null;
  try {
    syncClient = await runtime.createSyncClient(config);
    return await runAndroidSyncWithDependencies("background", {
      doc,
      planStore,
      syncClient,
      bridge: runtime.bridge,
      today: runtime.today,
      isOnline: runtime.isOnline,
    });
  } finally {
    try {
      try {
        await syncClient?.stop();
      } finally {
        await planStore.flush();
      }
    } finally {
      planStore.detachDoc(doc);
      doc.destroy();
    }
  }
}
