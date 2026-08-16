import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { isAndroidSyncConfigured, runAndroidSync } from "./android-sync";
import { runHeadlessAndroidSync } from "./headless-sync";
import { createHeadlessAndroidSyncRuntime } from "./headless-sync-runtime";

export const BACKGROUND_SYNC_TASK = "personal-plan-sync-v1";
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    const result = isAndroidSyncConfigured()
      ? await runAndroidSync("background")
      : await runHeadlessAndroidSync(createHeadlessAndroidSyncRuntime());
    if (result === null) {
      console.info("personal-plan background sync skipped: vault_not_configured");
    } else {
      console.info(`personal-plan background sync completed: uploaded=${String(result.uploaded)} downloaded=${String(result.downloaded)} status=${result.widgetStatus}`);
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (reason) {
    console.warn("personal-plan background sync failed", reason instanceof Error ? reason.message : String(reason));
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});
export async function registerBackgroundSync(): Promise<void> {
  if (!(await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK))) await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, { minimumInterval: 15 });
}
