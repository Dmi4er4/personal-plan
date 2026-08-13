import { applyWidgetCompletionCommand, projectPlan, snapshotPlan, type LocalDate } from "@personal-plan/core";
import type * as Y from "yjs";
import { projectWidget } from "./project-widget";
import { writeSnapshotAndRefresh } from "./refresh-widget";
import type { WidgetBridge, WidgetCommand, WidgetSnapshot } from "./contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
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
    const command = value as Partial<WidgetCommand>;
    if (command.version !== 1 || typeof command.id !== "string" || !UUID.test(command.id) || typeof command.taskId !== "string" || command.taskId.length === 0 || typeof command.completed !== "boolean" || typeof command.completedAt !== "string" || typeof command.completedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(command.completedOn)) return null;
    const completedAt = normalizeTimestamp(command.completedAt);
    if (completedAt === null) return null;
    return { ...command, completedAt } as WidgetCommand;
  } catch { return null; }
}

export async function processWidgetCommands(doc: Y.Doc, bridge: WidgetBridge, today: LocalDate, status: WidgetSnapshot["syncState"] = "pending"): Promise<number> {
  const acknowledged: string[] = []; let count = 0;
  for (const raw of await bridge.readCommands()) {
    const command = parseCommand(raw);
    if (command === null) continue;
    try { applyWidgetCompletionCommand(doc, command); acknowledged.push(command.id); count += 1; } catch { /* Keep valid command if referenced task is not available yet. */ }
  }
  const snapshot = snapshotPlan(doc);
  await writeSnapshotAndRefresh(
    bridge,
    JSON.stringify(
      projectWidget(projectPlan(snapshot.tasks, today, snapshot.records), today, status),
    ),
  );
  if (acknowledged.length > 0) await bridge.acknowledgeCommands(acknowledged);
  return count;
}
