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

  @Test fun widgetPrefersObservableSnapshotStateOverFileFallback() {
    val fallback = "{\"version\":1,\"syncState\":\"pending\",\"sections\":[]}"
    val current = "{\"version\":1,\"syncState\":\"synced\",\"sections\":[]}"
    val preferences = mutablePreferencesOf(WidgetSnapshotKey to current)

    assertSame(PreferencesGlanceStateDefinition, PlanWidget().stateDefinition)
    assertEquals(current, selectWidgetSnapshot(preferences, fallback))
    assertEquals(fallback, selectWidgetSnapshot(mutablePreferencesOf(), fallback))
  }
}
