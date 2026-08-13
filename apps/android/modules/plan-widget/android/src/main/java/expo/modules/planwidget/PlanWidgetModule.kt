package expo.modules.planwidget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import androidx.glance.appwidget.AppWidgetId
import androidx.glance.appwidget.state.updateAppWidgetState
import kotlinx.coroutines.runBlocking

internal fun refreshPlanWidgets(context: android.content.Context, snapshotJson: String?) {
  val ids = AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, PlanWidgetReceiver::class.java))
  Log.i("PlanWidget", "refreshPlanWidgets widgetIds=${ids.size}")
  if (ids.isEmpty()) return
  if (snapshotJson != null) {
    runBlocking {
      for (id in ids) {
        updateAppWidgetState(context, AppWidgetId(id)) { preferences ->
          preferences[WidgetSnapshotKey] = snapshotJson
        }
      }
    }
    Log.i("PlanWidget", "refreshPlanWidgets state updated")
  }
  // Glance updateAll is unreliable here (stale provider mapping after app
  // updates), so drive the rebind directly. The observable preference above
  // makes an already-running Glance composition recompose immediately; the
  // explicit broadcast also starts composition when no session is active.
  context.sendBroadcast(Intent(context, PlanWidgetReceiver::class.java).apply {
    action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
    putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
  })
  Log.i("PlanWidget", "refreshPlanWidgets broadcast sent")
}

class PlanWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PlanWidget")
    AsyncFunction("writeSnapshot") { snapshotJson: String ->
      require(snapshotJson.toByteArray().size < 1024 * 1024) { "snapshot_too_large" }
      require(JSONObject(snapshotJson).optInt("version") == 1) { "snapshot_version" }
      WidgetStorage(requireNotNull(appContext.reactContext)).writeSnapshot(snapshotJson)
      Log.i("PlanWidget", "writeSnapshot bytes=${snapshotJson.toByteArray().size}")
    }
    AsyncFunction("writeSnapshotAndRefresh") { snapshotJson: String ->
      require(snapshotJson.toByteArray().size < 1024 * 1024) { "snapshot_too_large" }
      require(JSONObject(snapshotJson).optInt("version") == 1) { "snapshot_version" }
      WidgetStorage(requireNotNull(appContext.reactContext)).writeSnapshot(snapshotJson)
      refreshPlanWidgets(requireNotNull(appContext.reactContext), snapshotJson)
      Log.i("PlanWidget", "writeSnapshotAndRefresh bytes=${snapshotJson.toByteArray().size}")
    }
    AsyncFunction("readCommands") { WidgetStorage(requireNotNull(appContext.reactContext)).readCommands() }
    AsyncFunction("acknowledgeCommands") { ids: List<String> -> WidgetStorage(requireNotNull(appContext.reactContext)).acknowledgeCommands(ids) }
    AsyncFunction("requestRefresh") {
      val context = requireNotNull(appContext.reactContext)
      refreshPlanWidgets(context, WidgetStorage(context).readSnapshot())
    }
  }
}
