package expo.modules.planwidget

import android.content.Context
import android.os.Build
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.workDataOf
import expo.modules.backgroundtask.BackgroundTaskWork

// Expo SDK 57 owns its periodic worker under this unique name. Replacing the
// delayed request with an immediate request avoids parallel sync sessions; the
// Expo worker schedules the next periodic run after the JS task finishes.
internal const val ExpoBackgroundWorkerName = "EXPO_BACKGROUND_WORKER"

internal fun buildWidgetSyncRequest(context: Context): OneTimeWorkRequest {
  val builder = OneTimeWorkRequestBuilder<BackgroundTaskWork>()
    .setInputData(workDataOf("appScopeKey" to context.packageName))
    .setConstraints(
      Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()
    )
    .addTag("personal-plan-widget-sync")

  // Android 12+ can run user-initiated work promptly without starting a
  // foreground service. Older releases use a normal one-time request.
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
    builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
  }
  return builder.build()
}

internal fun enqueueWidgetSync(context: Context) {
  WorkManager.getInstance(context).enqueueUniqueWork(
    ExpoBackgroundWorkerName,
    ExistingWorkPolicy.REPLACE,
    buildWidgetSyncRequest(context),
  )
}
