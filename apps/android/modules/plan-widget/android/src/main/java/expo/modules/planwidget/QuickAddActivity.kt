package expo.modules.planwidget

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Bundle
import android.text.InputFilter
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.UUID

internal fun buildQuickAddCommand(
  commandId: String,
  taskId: String,
  title: String,
  createdAt: Instant,
  createdOn: LocalDate,
): String = JSONObject()
  .put("version", 1)
  .put("kind", "create")
  .put("id", commandId)
  .put("taskId", taskId)
  .put("title", title.trim())
  .put("createdAt", createdAt.truncatedTo(ChronoUnit.MILLIS).toString())
  .put("createdOn", createdOn.toString())
  .toString()

private fun Context.hasValidatedNetwork(): Boolean {
  val manager = getSystemService(ConnectivityManager::class.java) ?: return false
  val network = manager.activeNetwork ?: return false
  val capabilities = manager.getNetworkCapabilities(network) ?: return false
  return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
}

private fun Context.dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

class QuickAddActivity : Activity() {
  private lateinit var titleInput: EditText
  private lateinit var submitButton: Button
  private var saving = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    requestWindowFeature(Window.FEATURE_NO_TITLE)
    setFinishOnTouchOutside(true)
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)

    val content = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(20), dp(18), dp(20), dp(12))
      setBackgroundColor(Color.WHITE)
    }
    content.addView(TextView(this).apply {
      text = "Новое дело"
      textSize = 20f
      setTextColor(Color.rgb(37, 38, 45))
    })
    content.addView(TextView(this).apply {
      text = "Будет добавлено в Сегодня"
      textSize = 13f
      setTextColor(Color.rgb(116, 117, 128))
      setPadding(0, dp(4), 0, dp(8))
    })
    titleInput = EditText(this).apply {
      id = R.id.quick_add_title
      hint = "Название"
      isSingleLine = true
      imeOptions = EditorInfo.IME_ACTION_DONE
      filters = arrayOf(InputFilter.LengthFilter(500))
      setOnEditorActionListener { _, actionId, event ->
        val submitted = actionId == EditorInfo.IME_ACTION_DONE ||
          (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_UP)
        if (submitted) submit()
        submitted
      }
    }
    content.addView(titleInput, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

    val actions = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.END
      setPadding(0, dp(8), 0, 0)
    }
    actions.addView(Button(this).apply {
      text = "Отмена"
      isAllCaps = false
      setOnClickListener { finish() }
    })
    submitButton = Button(this).apply {
      id = R.id.quick_add_submit
      text = "Добавить"
      isAllCaps = false
      setTextColor(Color.rgb(73, 77, 168))
      setOnClickListener { submit() }
    }
    actions.addView(submitButton)
    content.addView(actions, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    setContentView(content)

    window.decorView.post {
      window.setLayout((resources.displayMetrics.widthPixels * 0.92f).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT)
      titleInput.requestFocus()
      (getSystemService(INPUT_METHOD_SERVICE) as? InputMethodManager)?.showSoftInput(titleInput, InputMethodManager.SHOW_IMPLICIT)
    }
  }

  private fun submit() {
    if (saving) return
    val title = titleInput.text.toString().trim()
    if (title.isEmpty()) {
      titleInput.error = "Введите название дела"
      return
    }
    saving = true
    submitButton.isEnabled = false
    val commandId = UUID.randomUUID().toString()
    val taskId = UUID.randomUUID().toString()
    val createdAt = Instant.now().truncatedTo(ChronoUnit.MILLIS)
    val createdOn = planDate(createdAt)
    val storage = WidgetStorage(this)
    try {
      storage.enqueueCommand(
        commandId,
        buildQuickAddCommand(commandId, taskId, title, createdAt, createdOn),
      )
    } catch (error: Throwable) {
      Log.e("PlanWidget", "quick add command failed", error)
      saving = false
      submitButton.isEnabled = true
      titleInput.error = "Не удалось сохранить дело"
      return
    }

    val snapshot = try {
      storage.addTaskSnapshot(
        taskId,
        title,
        createdOn,
        createdAt.toString(),
        if (hasValidatedNetwork()) "pending" else "offline",
      )
    } catch (error: Throwable) {
      // The durable command is already safe. The worker will rebuild the
      // snapshot from canonical state even if this optimistic redraw fails.
      Log.e("PlanWidget", "quick add optimistic snapshot failed", error)
      storage.readSnapshot()
    }
    try {
      refreshPlanWidgets(this, snapshot)
      enqueueWidgetSync(this)
    } catch (error: Throwable) {
      // A registered periodic run and the next app start also drain commands.
      Log.e("PlanWidget", "quick add sync scheduling failed", error)
    }
    finish()
  }
}
