package expo.modules.planwidget

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.currentState
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.background
import androidx.glance.color.ColorProvider
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextDecoration
import androidx.glance.text.TextStyle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

data class NativeTask(val id: String, val title: String, val note: String?, val completed: Boolean, val depth: Int)
data class NativeTaskBlock(val parent: NativeTask, val tasks: List<NativeTask>)
data class NativeSection(val key: String, val primary: String, val secondary: String?, val farSection: Boolean, val muchLaterDivider: Boolean, val tasks: List<NativeTask>)
data class NativeSnapshot(val status: String, val sections: List<NativeSection>)

internal val WidgetSnapshotKey = stringPreferencesKey("snapshot_json_v1")

internal fun selectWidgetSnapshot(preferences: Preferences, fallback: String?): String? =
  preferences[WidgetSnapshotKey] ?: fallback

internal fun completedExpandedKey(sectionKey: String) = booleanPreferencesKey("completed_expanded:$sectionKey")

internal fun toggleCompletedExpanded(preferences: MutablePreferences, sectionKey: String): Boolean {
  val key = completedExpandedKey(sectionKey)
  val expanded = !(preferences[key] ?: false)
  preferences[key] = expanded
  return expanded
}

internal fun taskBlocks(tasks: List<NativeTask>): List<NativeTaskBlock> {
  val blocks = mutableListOf<MutableList<NativeTask>>()
  tasks.forEach { task ->
    if (task.depth == 0 || blocks.isEmpty()) blocks.add(mutableListOf(task)) else blocks.last().add(task)
  }
  return blocks.map { NativeTaskBlock(it.first(), it.toList()) }
}

class PlanWidget : GlanceAppWidget() {
  override val stateDefinition = PreferencesGlanceStateDefinition

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val fallback = withContext(Dispatchers.IO) { WidgetStorage(context).readSnapshot() }
    provideContent {
      val preferences = currentState<Preferences>()
      val snapshot = parseSnapshot(selectWidgetSnapshot(preferences, fallback))
      android.util.Log.i("PlanWidget", "compose status=${snapshot?.status} sections=${snapshot?.sections?.size}")
      WidgetContent(snapshot, preferences)
    }
  }

  private fun parseSnapshot(raw: String?): NativeSnapshot? = try {
    if (raw == null) null else JSONObject(raw).takeIf { it.optInt("version") == 1 }?.let { root ->
      val sectionsJson = root.getJSONArray("sections")
      NativeSnapshot(root.optString("syncState", "offline"), (0 until sectionsJson.length()).map { i ->
        val section = sectionsJson.getJSONObject(i); val tasksJson = section.getJSONArray("tasks")
        NativeSection(
          section.getString("key"),
          section.getString("primaryLabel"),
          section.optString("secondaryLabel").takeIf { !section.isNull("secondaryLabel") },
          section.optBoolean("farSection"),
          section.optBoolean("muchLaterDivider"),
          (0 until tasksJson.length()).map { j ->
            val task = tasksJson.getJSONObject(j); NativeTask(task.getString("id"), task.getString("title"), task.optString("note").takeIf { !task.isNull("note") }, task.getBoolean("completed"), task.getInt("depth"))
          },
        )
      })
    }
  } catch (_: Throwable) { null }
}

private fun openListIntent(context: Context): Intent =
  Intent(Intent.ACTION_VIEW, Uri.parse("personalplan://list")).apply {
    setPackage(context.packageName)
    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
  }

@Composable private fun WidgetContent(snapshot: NativeSnapshot?, preferences: Preferences) {
  val context = LocalContext.current
  val openList = openListIntent(context)
  val rootClickable = GlanceModifier.fillMaxSize().background(widgetColor(0xFFF7F7FB)).padding(12.dp).clickable(actionStartActivity(openList))
  Column(rootClickable) {
    Row(GlanceModifier.fillMaxWidth().clickable(actionStartActivity(openList)), verticalAlignment = Alignment.CenterVertically) {
      Text("Планы", style = TextStyle(color = widgetColor(0xFF25262D), fontWeight = FontWeight.Bold))
      Spacer(GlanceModifier.defaultWeight())
      Text(statusLabel(snapshot?.status), style = TextStyle(color = widgetColor(0xFF747580)))
    }
    if (snapshot == null) {
      Text(
        "Откройте приложение, чтобы загрузить планы",
        modifier = GlanceModifier.padding(top = 18.dp),
        style = TextStyle(color = widgetColor(0xFF454651)),
      )
    } else {
      val compact = LocalSize.current.width < 280.dp
      LazyColumn(GlanceModifier.fillMaxSize().padding(top = 8.dp)) {
        items(snapshot.sections, itemId = { it.key.hashCode().toLong() }) { section ->
          SectionContent(section, compact, openList, preferences[completedExpandedKey(section.key)] ?: false)
        }
        // Tail filler: covers the empty area below the last section so the whole
        // widget surface opens the app (LazyColumn shadows the root clickable).
        // 600dp spans even a fully stretched widget.
        item {
          Box(GlanceModifier.fillMaxWidth().height(600.dp).clickable(actionStartActivity(openList))) {}
        }
      }
    }
  }
}

@Composable private fun SectionContent(section: NativeSection, compact: Boolean, openList: Intent, completedExpanded: Boolean) {
  val blocks = taskBlocks(section.tasks)
  val incompleteBlocks = blocks.filterNot { it.parent.completed }
  val completedBlocks = blocks.filter { it.parent.completed }
  Column(GlanceModifier.fillMaxWidth().clickable(actionStartActivity(openList))) {
    if (section.farSection) {
      Spacer(GlanceModifier.height(12.dp))
      Row(GlanceModifier.fillMaxWidth().padding(bottom = 8.dp)) {
        Spacer(GlanceModifier.defaultWeight().height(1.dp).background(widgetColor(0xFFD5D6DE)))
      }
    } else if (section.muchLaterDivider) {
      // The far-zone divider belongs only before the first visible far
      // section. "Сильно позже" following "Позже" gets spacing, not a line.
      Spacer(GlanceModifier.height(14.dp))
    }
    Row(
      GlanceModifier.fillMaxWidth().padding(vertical = 5.dp).clickable(actionStartActivity(openList)),
      verticalAlignment = Alignment.Top,
    ) {
      Column(GlanceModifier.width(64.dp).padding(end = 6.dp).clickable(actionStartActivity(openList))) {
        Text(section.primary, style = TextStyle(color = widgetColor(0xFF454651), fontWeight = FontWeight.Medium))
        if (!compact && section.secondary != null) Text(section.secondary, style = TextStyle(color = widgetColor(0xFF858692)))
      }
      Column(GlanceModifier.defaultWeight().background(widgetColor(0xFFEEEFFE)).padding(start = 2.dp).clickable(actionStartActivity(openList))) {
        incompleteBlocks.forEach { block -> block.tasks.forEach { TaskContent(it, openList) } }
        if (completedBlocks.isNotEmpty()) {
          CompletedCut(section.key, completedBlocks.size, completedExpanded)
          if (completedExpanded) completedBlocks.forEach { block -> block.tasks.forEach { TaskContent(it, openList) } }
        }
      }
    }
  }
}

@Composable private fun CompletedCut(sectionKey: String, count: Int, expanded: Boolean) {
  val toggle = actionRunCallback<ToggleCompletedSectionAction>(
    actionParametersOf(ToggleCompletedSectionAction.SectionKey to sectionKey),
  )
  Column(
    GlanceModifier.fillMaxWidth()
      .padding(start = 8.dp, end = 4.dp, top = 4.dp, bottom = 4.dp)
      .clickable(toggle),
  ) {
    Spacer(GlanceModifier.fillMaxWidth().height(1.dp).background(widgetColor(0xFFD5D6DE)))
    Text(
      "${if (expanded) "▾" else "▸"} Выполненные ($count)",
      modifier = GlanceModifier.fillMaxWidth().padding(top = 6.dp, bottom = 2.dp),
      style = TextStyle(color = widgetColor(0xFF747580), fontWeight = FontWeight.Medium),
    )
  }
}

@Composable private fun TaskContent(task: NativeTask, openList: Intent) {
  val contentDescription = if (task.completed) "Выполнено: ${task.title}" else "Не выполнено: ${task.title}"
  val toggle = actionRunCallback<ToggleTaskAction>(actionParametersOf(ToggleTaskAction.TaskId to task.id, ToggleTaskAction.Completed to !task.completed))
  Row(
    GlanceModifier.fillMaxWidth()
      .padding(start = if (task.depth == 1) 18.dp else 8.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
    verticalAlignment = Alignment.Top,
  ) {
    Box(GlanceModifier.size(40.dp).clickable(toggle), contentAlignment = Alignment.Center) {
      Image(ImageProvider(if (task.completed) R.drawable.ic_task_done else R.drawable.ic_task_open), contentDescription, GlanceModifier.size(22.dp))
    }
    Column(GlanceModifier.defaultWeight().padding(start = 4.dp).clickable(actionStartActivity(openList))) {
      Text(task.title, style = taskStyle(task.completed))
      if (task.note != null) Text(task.note, style = TextStyle(color = widgetColor(0xFF747580), textDecoration = if (task.completed) TextDecoration.LineThrough else TextDecoration.None))
    }
  }
}

private fun widgetColor(value: Long) = ColorProvider(Color(value), Color(value))
private fun taskStyle(completed: Boolean) = TextStyle(color = widgetColor(if (completed) 0xFF8B8F96 else 0xFF25262D), textDecoration = if (completed) TextDecoration.LineThrough else TextDecoration.None)
private fun statusLabel(status: String?): String = when (status) { "synced" -> "синхронизировано"; "pending" -> "ожидает"; "error" -> "ошибка"; else -> "офлайн" }
