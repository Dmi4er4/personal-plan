package expo.modules.planwidget
import android.content.Intent
import android.net.Uri
import androidx.glance.appwidget.action.actionStartActivity
fun openTaskAction(taskId: String) = actionStartActivity(Intent(Intent.ACTION_VIEW, Uri.parse("personalplan://task/${Uri.encode(taskId)}")))
