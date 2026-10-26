import { getPlanDate, planCheckpointContent } from "@personal-plan/core";
import { deriveVaultMaterial, SyncClient } from "@personal-plan/sync";
import NetInfo from "@react-native-community/netinfo";
import PlanWidget from "../../modules/plan-widget";
import { ExpoCryptoProvider } from "../crypto/expo-crypto-provider";
import { SecureVaultStore } from "../storage/secure-vault";
import { SqlitePlanStore } from "../storage/sqlite-plan-store";
import { SqliteSyncStateStore } from "../storage/sqlite-sync-store";
import { AndroidHttpRelayTransport } from "./http-relay-transport";
import type { HeadlessAndroidSyncRuntime } from "./headless-sync";

export function createHeadlessAndroidSyncRuntime(): HeadlessAndroidSyncRuntime {
  return {
    loadVault: () => new SecureVaultStore().load(),
    createPlanStore: () => new SqlitePlanStore(),
    createSyncClient: async (config, beforeCursorCommit, checkpointBytes) => {
      const provider = new ExpoCryptoProvider();
      const material = await deriveVaultMaterial(provider, config.rootSecret);
      return new SyncClient({
        provider,
        material,
        store: new SqliteSyncStateStore(),
        transport: new AndroidHttpRelayTransport(config.relayUrl),
        beforeCursorCommit,
        checkpointContent: planCheckpointContent,
        checkpointBytes,
      });
    },
    bridge: PlanWidget,
    today: getPlanDate,
    isOnline: async () => (await NetInfo.fetch()).isConnected === true,
  };
}
