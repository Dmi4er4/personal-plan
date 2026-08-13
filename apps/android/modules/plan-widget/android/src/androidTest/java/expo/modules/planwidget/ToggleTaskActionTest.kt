package expo.modules.planwidget

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ToggleTaskActionTest {
  @Test fun commandQueueSurvivesIndependentStorageInstance() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val id = "123e4567-e89b-42d3-a456-426614174001"; val command = "{\"version\":1,\"id\":\"$id\",\"taskId\":\"task\"}"
    WidgetStorage(context).acknowledgeCommands(listOf(id)); WidgetStorage(context).enqueueCommand(id, command)
    assertTrue(WidgetStorage(context).readCommands().contains(command)); WidgetStorage(context).acknowledgeCommands(listOf(id))
  }
}
