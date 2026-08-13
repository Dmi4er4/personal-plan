package expo.modules.planwidget

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
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
    val destination = File(commands, "$commandId.json")
    return try { destination.createNewFile() && destination.outputStream().use { it.write(json.toByteArray(Charsets.UTF_8)) }.let { true } } catch (error: Throwable) { destination.delete(); throw error }
  }

  @Synchronized fun readCommands(): List<String> = commands.listFiles()?.sortedBy { it.name }?.mapNotNull { file ->
    try {
      val id = file.name.removeSuffix(".json"); UUID.fromString(id)
      val text = file.readText(Charsets.UTF_8); val parsed = JSONObject(text)
      require(parsed.optInt("version") == 1 && parsed.optString("id") == id)
      text
    } catch (_: Throwable) { file.renameTo(File(invalid, file.name)); null }
  } ?: emptyList()

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
}
