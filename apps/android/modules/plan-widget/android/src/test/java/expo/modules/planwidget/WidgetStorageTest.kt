package expo.modules.planwidget

import androidx.datastore.preferences.core.mutablePreferencesOf
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.time.LocalDate

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class WidgetStorageTest {
  private val context get() = ApplicationProvider.getApplicationContext<android.content.Context>()
  @Before fun clean() { File(context.filesDir, "plan-widget-v1").deleteRecursively() }
  @Test fun snapshotAndCommandsAreDurableAndIdempotent() {
    val storage = WidgetStorage(context); val first = "{\"version\":1,\"sections\":[]}"; storage.writeSnapshot(first)
    assertEquals(first, storage.readSnapshot())
    val id = "123e4567-e89b-42d3-a456-426614174000"; val command = "{\"version\":1,\"id\":\"$id\"}"
    assertTrue(storage.enqueueCommand(id, command)); assertEquals(false, storage.enqueueCommand(id, command)); assertEquals(listOf(command), storage.readCommands())
    storage.acknowledgeCommands(listOf(id)); assertTrue(storage.readCommands().isEmpty())
  }

  @Test fun toggleSnapshotMirrorsEffectiveCompletionForChildren() {
    val storage = WidgetStorage(context)
    storage.writeSnapshot("""{"version":1,"syncState":"synced","sections":[{"key":"today","primaryLabel":"Сегодня","secondaryLabel":null,"tasks":[{"id":"p","title":"Parent","completed":false,"depth":0},{"id":"c","title":"Child","completed":false,"depth":1}]}]}""")
    storage.toggleSnapshot("p", true)
    val toggled = JSONObject(storage.readSnapshot()!!)
    val tasks = toggled.getJSONArray("sections").getJSONObject(0).getJSONArray("tasks")
    assertEquals("pending", toggled.getString("syncState"))
    assertEquals(true, tasks.getJSONObject(0).getBoolean("completed"))
    assertEquals(true, tasks.getJSONObject(1).getBoolean("completed"))
    storage.toggleSnapshot("p", false)
    assertEquals(false, JSONObject(storage.readSnapshot()!!).getJSONArray("sections").getJSONObject(0).getJSONArray("tasks").getJSONObject(1).getBoolean("completed"))
  }

  @Test fun quickAddSnapshotCreatesTodayAtTheHeadWithoutDuplicates() {
    val storage = WidgetStorage(context)
    storage.writeSnapshot("""{"version":1,"generatedAt":"old","syncState":"synced","sections":[{"key":"2026-09-02","primaryLabel":"Сегодня","secondaryLabel":"2.09","tasks":[{"id":"old","title":"Старое","note":null,"completed":false,"depth":0}]}]}""")

    storage.addTaskSnapshot(
      "fresh",
      "Новое",
      LocalDate.parse("2026-09-02"),
      "2026-09-02T08:00:00.000Z",
      "pending",
    )
    storage.addTaskSnapshot(
      "fresh",
      "Новое",
      LocalDate.parse("2026-09-02"),
      "2026-09-02T08:00:00.000Z",
      "pending",
    )

    val snapshot = JSONObject(storage.readSnapshot()!!)
    val section = snapshot.getJSONArray("sections").getJSONObject(0)
    val tasks = section.getJSONArray("tasks")
    assertEquals("pending", snapshot.getString("syncState"))
    assertEquals("2026-09-02", section.getString("key"))
    assertEquals(2, tasks.length())
    assertEquals(listOf("fresh", "old"), (0 until tasks.length()).map { tasks.getJSONObject(it).getString("id") })
  }

  @Test fun quickAddSnapshotBuildsTodayWhenThePlanWasEmpty() {
    val storage = WidgetStorage(context)

    val raw = storage.addTaskSnapshot(
      "fresh",
      "Первая задача",
      LocalDate.parse("2026-09-02"),
      "2026-09-02T08:00:00.000Z",
      "offline",
    )

    val snapshot = JSONObject(raw)
    val section = snapshot.getJSONArray("sections").getJSONObject(0)
    assertEquals("offline", snapshot.getString("syncState"))
    assertEquals("Сегодня", section.getString("primaryLabel"))
    assertEquals("2.09", section.getString("secondaryLabel"))
    assertEquals("Первая задача", section.getJSONArray("tasks").getJSONObject(0).getString("title"))
  }

  @Test fun quickAddCommandCarriesStableCommandAndTaskIds() {
    val raw = buildQuickAddCommand(
      "123e4567-e89b-42d3-a456-426614174030",
      "123e4567-e89b-42d3-a456-426614174031",
      "  Купить хлеб  ",
      Instant.parse("2026-09-02T08:00:00.123456789Z"),
      LocalDate.parse("2026-09-02"),
    )

    val command = JSONObject(raw)
    assertEquals("create", command.getString("kind"))
    assertEquals("123e4567-e89b-42d3-a456-426614174030", command.getString("id"))
    assertEquals("123e4567-e89b-42d3-a456-426614174031", command.getString("taskId"))
    assertEquals("Купить хлеб", command.getString("title"))
    assertEquals("2026-09-02T08:00:00.123Z", command.getString("createdAt"))
    assertEquals("2026-09-02", command.getString("createdOn"))
  }

  @Test fun commandsAreReadChronologicallyInsteadOfByRandomUuid() {
    val storage = WidgetStorage(context)
    val olderId = "ffffffff-ffff-4fff-afff-ffffffffffff"
    val newerId = "00000000-0000-4000-8000-000000000000"
    val older = """{"version":1,"id":"$olderId","completedAt":"2026-09-02T08:00:00.000Z"}"""
    val newer = """{"version":1,"id":"$newerId","completedAt":"2026-09-02T08:01:00.000Z"}"""
    storage.enqueueCommand(olderId, older)
    storage.enqueueCommand(newerId, newer)

    assertEquals(listOf(older, newer), storage.readCommands())
  }

  @Test fun widgetPrefersObservableSnapshotStateOverFileFallback() {
    val fallback = "{\"version\":1,\"syncState\":\"pending\",\"sections\":[]}"
    val current = "{\"version\":1,\"syncState\":\"synced\",\"sections\":[]}"
    val preferences = mutablePreferencesOf(WidgetSnapshotKey to current)

    assertSame(PreferencesGlanceStateDefinition, PlanWidget().stateDefinition)
    assertEquals(current, selectWidgetSnapshot(preferences, fallback))
    assertEquals(fallback, selectWidgetSnapshot(mutablePreferencesOf(), fallback))
  }

  @Test fun completedCutStateTogglesIndependentlyForEachSection() {
    val preferences = mutablePreferencesOf()

    assertEquals(false, preferences[completedExpandedKey("today")] ?: false)
    assertEquals(true, toggleCompletedExpanded(preferences, "today"))
    assertEquals(true, preferences[completedExpandedKey("today")])
    assertEquals(false, preferences[completedExpandedKey("tomorrow")] ?: false)
    assertEquals(false, toggleCompletedExpanded(preferences, "today"))
  }

  @Test fun taskBlocksKeepCompletedChildrenWithTheirParent() {
    val blocks = taskBlocks(listOf(
      NativeTask("open", "Open", null, false, 0),
      NativeTask("done-child", "Done child", null, true, 1),
      NativeTask("done", "Done", null, true, 0),
      NativeTask("effective-child", "Effective child", null, true, 1),
    ))

    assertEquals(listOf("open", "done"), blocks.map { it.parent.id })
    assertEquals(listOf("open", "done-child"), blocks[0].tasks.map { it.id })
    assertEquals(listOf("done", "effective-child"), blocks[1].tasks.map { it.id })
    assertEquals(listOf("done"), blocks.filter { it.parent.completed }.map { it.parent.id })
  }
}
