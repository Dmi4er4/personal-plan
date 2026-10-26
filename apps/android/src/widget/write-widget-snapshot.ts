import { projectPlan, snapshotPlan, type LocalDate } from "@personal-plan/core";
import type * as Y from "yjs";
import { documentRevision } from "../app/doc-revision";
import { projectWidget } from "./project-widget";
import { writeSnapshotAndRefresh } from "./refresh-widget";
import type { WidgetBridge, WidgetSnapshot } from "./contracts";

interface SnapshotWrite {
  revision: number;
  today: LocalDate;
  syncState: WidgetSnapshot["syncState"];
  pending: Promise<void>;
}

const writes = new WeakMap<Y.Doc, WeakMap<WidgetBridge, SnapshotWrite>>();

export async function writeWidgetSnapshot(
  doc: Y.Doc,
  bridge: WidgetBridge,
  today: LocalDate,
  syncState: WidgetSnapshot["syncState"] = "pending",
  options: { force?: boolean } = {},
): Promise<void> {
  const revision = documentRevision(doc);
  let bridgeWrites = writes.get(doc);
  if (bridgeWrites === undefined) {
    bridgeWrites = new WeakMap();
    writes.set(doc, bridgeWrites);
  }
  const previous = bridgeWrites.get(bridge);
  if (!options.force && previous?.revision === revision && previous.today === today && previous.syncState === syncState) {
    return previous.pending;
  }
  const snapshot = snapshotPlan(doc);
  const json = JSON.stringify(projectWidget(projectPlan(snapshot.tasks, today, snapshot.records), today, syncState));
  // Keep overlapping app/sync refreshes ordered, so an older pending snapshot
  // cannot finish after the newer synchronized one.
  const pending = (previous?.pending ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => writeSnapshotAndRefresh(bridge, json));
  const current: SnapshotWrite = { revision, today, syncState, pending };
  bridgeWrites.set(bridge, current);
  try {
    await pending;
  } catch (reason) {
    if (bridgeWrites.get(bridge) === current) bridgeWrites.delete(bridge);
    throw reason;
  }
}
