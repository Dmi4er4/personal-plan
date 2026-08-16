package expo.modules.planwidget

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback
import org.json.JSONObject
import java.time.LocalDate
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

class ToggleTaskAction : ActionCallback {
  companion object {
    val TaskId = ActionParameters.Key<String>("taskId")
    val Completed = ActionParameters.Key<Boolean>("completed")
  }
  override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
    val taskId = requireNotNull(parameters[TaskId])
    val completed = requireNotNull(parameters[Completed])
    val id = UUID.randomUUID().toString()
    val command = JSONObject()
      .put("version", 1)
      .put("id", id)
      .put("taskId", taskId)
      .put("completed", completed)
      .put("completedAt", Instant.now().truncatedTo(ChronoUnit.MILLIS).toString())
      .put("completedOn", LocalDate.now().toString())
    val storage = WidgetStorage(context)
    storage.enqueueCommand(id, command.toString())
    storage.toggleSnapshot(taskId, completed)
    refreshPlanWidgets(context, storage.readSnapshot())
    enqueueWidgetSync(context)
  }
}
