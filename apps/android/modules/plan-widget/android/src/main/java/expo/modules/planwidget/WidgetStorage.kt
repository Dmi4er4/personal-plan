package expo.modules.planwidget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.time.Instant
import java.time.LocalDate
import java.util.Locale
import java.util.UUID

class WidgetStorage(context: Context) {
  private val root = File(context.filesDir, "plan-widget-v1")
  private val commands = File(root, "commands")
  private val invalid = File(root, "commands-invalid")
  private val snapshot = File(root, "snapshot.json")

  init { commands.mkdirs(); invalid.mkdirs() }

  @Synchronized fun writeSnapshot(json: String) {
    require(json.toByteArray().size < 1024 * 1024) { "snapshot_too_large" }
    require(JSONObject(json).optInt("version") == 1) { "snapshot_version" }
    root.mkdirs()
    val temp = File(root, "snapshot.json.tmp")
    FileOutputStream(temp).use { stream -> stream.write(json.toByteArray(Charsets.UTF_8)); stream.fd.sync() }
    if (!temp.renameTo(snapshot)) { temp.delete(); error("snapshot_rename_failed") }
  }

  fun readSnapshot(): String? = snapshot.takeIf { it.isFile }?.readText(Charsets.UTF_8)

  @Synchronized fun enqueueCommand(commandId: String, json: String): Boolean {
    UUID.fromString(commandId)
    require(json.toByteArray(Charsets.UTF_8).size < 64 * 1024) { "command_too_large" }
    val parsed = JSONObject(json)
    require(parsed.optInt("version") == 1 && parsed.optString("id") == commandId) { "command_invalid" }
    val destination = File(commands, "$commandId.json")
    if (destination.exists()) return false
    val temp = File(root, "command-$commandId.tmp")
    return try {
      FileOutputStream(temp).use { stream ->
        stream.write(json.toByteArray(Charsets.UTF_8))
        stream.fd.sync()
      }
      if (!temp.renameTo(destination)) error("command_rename_failed")
      true
    } catch (error: Throwable) {
      temp.delete()
      throw error
    }
  }

  @Synchronized fun readCommands(): List<String> = commands.listFiles()?.mapNotNull { file ->
    try {
      val id = file.name.removeSuffix(".json"); UUID.fromString(id)
      val text = file.readText(Charsets.UTF_8); val parsed = JSONObject(text)
      require(parsed.optInt("version") == 1 && parsed.optString("id") == id)
      val rawTimestamp = parsed.optString("createdAt").ifBlank { parsed.optString("completedAt") }
      val timestamp = runCatching { Instant.parse(rawTimestamp).toEpochMilli() }.getOrElse { file.lastModified() }
      Triple(timestamp, id, text)
    } catch (_: Throwable) { file.renameTo(File(invalid, file.name)); null }
  }?.sortedWith(compareBy<Triple<Long, String, String>>({ it.first }, { it.second }))?.map { it.third } ?: emptyList()

  @Synchronized fun acknowledgeCommands(ids: List<String>) {
    ids.forEach { id -> UUID.fromString(id); File(commands, "$id.json").delete() }
  }

  @Synchronized fun toggleSnapshot(taskId: String, completed: Boolean) {
    val raw = readSnapshot() ?: return
    val rootJson = JSONObject(raw); val sections = rootJson.getJSONArray("sections")
    for (i in 0 until sections.length()) {
      val tasks = sections.getJSONObject(i).getJSONArray("tasks")
      for (j in 0 until tasks.length()) {
        val task = tasks.getJSONObject(j)
        if (task.optString("id") != taskId) continue
        task.put("completed", completed)
        if (task.optInt("depth") == 0) {
          var childIndex = j + 1
          while (childIndex < tasks.length()) {
            val child = tasks.getJSONObject(childIndex)
            if (child.optInt("depth") != 1) break
            child.put("completed", completed)
            childIndex += 1
          }
        }
        // The visual toggle is immediate, but the durable command still has
        // to be drained by the app/background sync before it is canonical.
        rootJson.put("syncState", "pending")
        writeSnapshot(rootJson.toString())
        return
      }
    }
  }

  @Synchronized fun addTaskSnapshot(
    taskId: String,
    title: String,
    createdOn: LocalDate,
    createdAt: String,
    syncState: String,
  ): String {
    require(title.isNotBlank()) { "task_title_empty" }
    require(syncState in setOf("pending", "offline")) { "sync_state_invalid" }
    val rootJson = readSnapshot()?.let(::JSONObject) ?: JSONObject()
      .put("version", 1)
      .put("sections", JSONArray())
    val originalSections = rootJson.optJSONArray("sections") ?: JSONArray()

    for (sectionIndex in 0 until originalSections.length()) {
      val tasks = originalSections.getJSONObject(sectionIndex).optJSONArray("tasks") ?: continue
      for (taskIndex in 0 until tasks.length()) {
        if (tasks.getJSONObject(taskIndex).optString("id") == taskId) {
          rootJson.put("generatedAt", createdAt)
          rootJson.put("syncState", syncState)
          val unchanged = rootJson.toString()
          writeSnapshot(unchanged)
          return unchanged
        }
      }
    }

    var todaySection: JSONObject? = null
    for (index in 0 until originalSections.length()) {
      val section = originalSections.getJSONObject(index)
      if (section.optString("key") == createdOn.toString()) {
        todaySection = section
        break
      }
    }
    if (todaySection == null) {
      todaySection = JSONObject()
        .put("key", createdOn.toString())
        .put("primaryLabel", "Сегодня")
        .put("secondaryLabel", String.format(Locale.ROOT, "%d.%02d", createdOn.dayOfMonth, createdOn.monthValue))
        .put("farSection", false)
        .put("muchLaterDivider", false)
        .put("tasks", JSONArray())
      val nextSections = JSONArray().put(todaySection)
      for (index in 0 until originalSections.length()) nextSections.put(originalSections.get(index))
      rootJson.put("sections", nextSections)
    }

    val resolvedTodaySection = requireNotNull(todaySection)
    val task = JSONObject()
      .put("id", taskId)
      .put("title", title.trim())
      .put("note", JSONObject.NULL)
      .put("completed", false)
      .put("depth", 0)
    val existingTasks = resolvedTodaySection.getJSONArray("tasks")
    val nextTasks = JSONArray().put(task)
    for (index in 0 until existingTasks.length()) nextTasks.put(existingTasks.get(index))
    resolvedTodaySection.put("tasks", nextTasks)
    rootJson.put("generatedAt", createdAt)
    rootJson.put("syncState", syncState)
    val updated = rootJson.toString()
    writeSnapshot(updated)
    return updated
  }
}
