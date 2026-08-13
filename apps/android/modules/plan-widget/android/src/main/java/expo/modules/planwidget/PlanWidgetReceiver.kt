package expo.modules.planwidget
import android.appwidget.AppWidgetManager
import android.content.Context
import android.util.Log
import androidx.glance.appwidget.AppWidgetId
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import kotlinx.coroutines.runBlocking

class PlanWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = PlanWidget()
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    Log.i("PlanWidget", "onUpdate ids=${appWidgetIds.size}")
    // Drive composition directly and synchronously: Glance's coroutine path can
    // be descheduled when OxygenOS freezes the backgrounded app process mid-update.
    for (id in appWidgetIds) {
      try {
        runBlocking { PlanWidget().update(context, AppWidgetId(id)) }
        Log.i("PlanWidget", "update done id=$id")
      } catch (error: Throwable) {
        Log.e("PlanWidget", "update failed id=$id", error)
      }
    }
  }
}
