import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { runAndroidSync } from "./android-sync";

export const BACKGROUND_SYNC_TASK = "personal-plan-sync-v1";
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try { await runAndroidSync("background"); return BackgroundTask.BackgroundTaskResult.Success; }
  catch { return BackgroundTask.BackgroundTaskResult.Failed; }
});
export async function registerBackgroundSync(): Promise<void> {
  if (!(await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK))) await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, { minimumInterval: 15 });
}
