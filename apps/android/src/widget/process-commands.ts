import { applyWidgetCompletionCommand, applyWidgetCreateTaskCommand, isLocalDate, type LocalDate } from "@personal-plan/core";
import type * as Y from "yjs";
import { writeWidgetSnapshot } from "./write-widget-snapshot";
import type { WidgetBridge, WidgetCommand, WidgetSnapshot } from "./contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
interface RawWidgetCommand {
  version?: unknown;
  kind?: unknown;
  id?: unknown;
  taskId?: unknown;
  title?: unknown;
  createdAt?: unknown;
  createdOn?: unknown;
  completed?: unknown;
  completedAt?: unknown;
  completedOn?: unknown;
}
// Native Instant.now().toString() may carry nano/micro digits, which
// Date.parse rejects. Trim the fraction to milliseconds before use.
function normalizeTimestamp(value: string): string | null {
  const trimmed = value.replace(/(\.\d{3})\d+/u, "$1");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/u.test(trimmed)) return null;
  return Number.isFinite(Date.parse(trimmed)) ? trimmed : null;
}

function parseCommand(raw: string): WidgetCommand | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const command = value as RawWidgetCommand;
    if (command.version !== 1 || typeof command.id !== "string" || !UUID.test(command.id) || typeof command.taskId !== "string" || command.taskId.length === 0) return null;
    if (command.kind === "create") {
      if (typeof command.title !== "string" || command.title.trim().length === 0 || command.title.length > 500 || typeof command.createdAt !== "string" || !isLocalDate(command.createdOn)) return null;
      const createdAt = normalizeTimestamp(command.createdAt);
      if (createdAt === null) return null;
      return { version: 1, kind: "create", id: command.id, taskId: command.taskId, title: command.title.trim(), createdAt, createdOn: command.createdOn };
    }
    if (command.kind !== undefined && command.kind !== "completion") return null;
    if (typeof command.completed !== "boolean" || typeof command.completedAt !== "string" || !isLocalDate(command.completedOn)) return null;
    const completedAt = normalizeTimestamp(command.completedAt);
    if (completedAt === null) return null;
    const completion = { version: 1 as const, id: command.id, taskId: command.taskId, completed: command.completed, completedAt, completedOn: command.completedOn };
    return command.kind === "completion" ? { ...completion, kind: "completion" } : completion;
  } catch { return null; }
}

export async function processWidgetCommands(doc: Y.Doc, bridge: WidgetBridge, today: LocalDate, status: WidgetSnapshot["syncState"] = "pending", options: { refreshIfUnchanged?: boolean } = {}): Promise<number> {
  const acknowledged: string[] = []; let count = 0;
  const commands = await bridge.readCommands();
  for (const raw of commands) {
    const command = parseCommand(raw);
    if (command === null) continue;
    try {
      if (command.kind === "create") applyWidgetCreateTaskCommand(doc, command);
      else applyWidgetCompletionCommand(doc, command);
      acknowledged.push(command.id);
      count += 1;
    } catch { /* Keep a valid command if its referenced state is not available yet. */ }
  }
  // Actual native commands may have changed the widget optimistically. Always
  // reconcile those; empty sync polls need only the final status snapshot.
  if (commands.length > 0 || options.refreshIfUnchanged !== false) {
    await writeWidgetSnapshot(doc, bridge, today, status, { force: commands.length > 0 });
  }
  if (acknowledged.length > 0) await bridge.acknowledgeCommands(acknowledged);
  return count;
}
