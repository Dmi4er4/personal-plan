package expo.modules.planwidget

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.state.updateAppWidgetState

class ToggleCompletedSectionAction : ActionCallback {
  companion object {
    val SectionKey = ActionParameters.Key<String>("sectionKey")
  }

  override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
    val sectionKey = requireNotNull(parameters[SectionKey])
    updateAppWidgetState(context, glanceId) { preferences ->
      toggleCompletedExpanded(preferences, sectionKey)
    }
    PlanWidget().update(context, glanceId)
  }
}
