package expo.modules.planwidget

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.NetworkType
import expo.modules.backgroundtask.BackgroundTaskWork
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class WidgetSyncSchedulerTest {
  private val context get() = ApplicationProvider.getApplicationContext<Context>()

  @Test fun requestStartsExpoHeadlessWorkerWithNetworkAndAppScope() {
    val request = buildWidgetSyncRequest(context)

    assertEquals(BackgroundTaskWork::class.java.name, request.workSpec.workerClassName)
    assertEquals(context.packageName, request.workSpec.input.getString("appScopeKey"))
    assertEquals(NetworkType.CONNECTED, request.workSpec.constraints.requiredNetworkType)
    assertTrue(request.tags.contains("personal-plan-widget-sync"))
  }
}
