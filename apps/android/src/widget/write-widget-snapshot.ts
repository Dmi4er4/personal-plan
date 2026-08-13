import { projectPlan, snapshotPlan, type LocalDate } from "@personal-plan/core";
import type * as Y from "yjs";
import { projectWidget } from "./project-widget";
import { writeSnapshotAndRefresh } from "./refresh-widget";
import type { WidgetBridge, WidgetSnapshot } from "./contracts";

export async function writeWidgetSnapshot(
  doc: Y.Doc,
  bridge: WidgetBridge,
  today: LocalDate,
  syncState: WidgetSnapshot["syncState"] = "pending",
): Promise<void> {
  const snapshot = snapshotPlan(doc);
  await writeSnapshotAndRefresh(
    bridge,
    JSON.stringify(
      projectWidget(projectPlan(snapshot.tasks, today, snapshot.records), today, syncState),
    ),
  );
}
