import { deleteDatabase } from "./indexeddb.js";
import { deleteSyncDatabase, IndexedDbSyncStateStore } from "./sync-indexeddb.js";

const RESET_REQUEST_KEY = "personal-plan-reset-requested";
const SERVER_RESTORE_REQUEST_KEY = "personal-plan-server-restore-requested";

interface ResetMarkerStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

interface ApplyResetOptions {
  markerStorage?: ResetMarkerStorage;
  planDatabaseName?: string;
  syncDatabaseName?: string;
}

export function requestLocalDataReset(
  markerStorage: ResetMarkerStorage = window.localStorage,
  reload: () => void = () => { window.location.reload(); },
): void {
  markerStorage.setItem(RESET_REQUEST_KEY, "1");
  reload();
}

export function requestServerDataRestore(
  markerStorage: ResetMarkerStorage = window.localStorage,
  reload: () => void = () => { window.location.reload(); },
): void {
  markerStorage.setItem(SERVER_RESTORE_REQUEST_KEY, "1");
  reload();
}

export async function applyPendingLocalDataReset({
  markerStorage = window.localStorage,
  planDatabaseName = "personal-plan",
  syncDatabaseName = "personal-plan-sync-v1",
}: ApplyResetOptions = {}): Promise<boolean> {
  if (markerStorage.getItem(RESET_REQUEST_KEY) === "1") {
    await Promise.all([
      deleteDatabase(planDatabaseName),
      deleteSyncDatabase(syncDatabaseName),
    ]);
    markerStorage.removeItem(RESET_REQUEST_KEY);
    markerStorage.removeItem(SERVER_RESTORE_REQUEST_KEY);
    return true;
  }
  if (markerStorage.getItem(SERVER_RESTORE_REQUEST_KEY) !== "1") return false;

  const syncStore = new IndexedDbSyncStateStore(syncDatabaseName);
  try {
    if (await syncStore.getActiveSecret() === null) {
      throw new Error("Cannot restore from the server without an active vault");
    }
    await syncStore.resetForServerRestore();
  } finally {
    await syncStore.destroy();
  }
  await deleteDatabase(planDatabaseName);
  markerStorage.removeItem(SERVER_RESTORE_REQUEST_KEY);
  return true;
}
