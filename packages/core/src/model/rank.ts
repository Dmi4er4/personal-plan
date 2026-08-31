import * as Y from "yjs";
import { snapshotPlan } from "./schema.js";
import { bucketKey, type Bucket } from "./types.js";

function containerKey(bucket: Bucket, parentId: string | null): string {
  return JSON.stringify([bucketKey(bucket), parentId]);
}

export function repairInvalidTaskOrders(doc: Y.Doc): number {
  const snapshot = snapshotPlan(doc);
  const invalidIds = new Set(
    snapshot.diagnostics
      .filter(({ code }) => code === "invalid_task_order")
      .map(({ taskId }) => taskId),
  );
  if (invalidIds.size === 0) {
    return 0;
  }

  const tasks = doc.getMap<unknown>("tasks");
  const affectedContainers = new Set<string>();
  const recordsByContainer = new Map<
    string,
    Array<{ id: string; map: Y.Map<unknown>; order: number }>
  >();
  for (const task of snapshot.records) {
    const map = tasks.get(task.id);
    if (!(map instanceof Y.Map)) {
      continue;
    }
    const key = containerKey(task.bucket, task.parentId);
    if (invalidIds.has(task.id)) {
      affectedContainers.add(key);
    }
    const records = recordsByContainer.get(key) ?? [];
    records.push({ id: task.id, map, order: task.order });
    recordsByContainer.set(key, records);
  }

  let changed = 0;
  doc.transact(() => {
    for (const key of [...affectedContainers].sort()) {
      const records = recordsByContainer.get(key) ?? [];
      records.sort((left, right) => {
        const orderDifference = left.order - right.order;
        return orderDifference === 0
          ? left.id.localeCompare(right.id)
          : orderDifference;
      });
      records.forEach(({ map }, order) => {
        if (map.get("order") !== order) {
          map.set("order", order);
          changed += 1;
        }
      });
    }
  }, "repair-invalid-task-orders");
  return changed;
}

export function normalizeOrders(
  doc: Y.Doc,
  bucket: Bucket,
  parentId: string | null,
): void {
  const expectedBucket = bucketKey(bucket);
  const tasks = doc.getMap<unknown>("tasks");
  const siblings = snapshotPlan(doc).records
    .filter((task) => {
      return (
        !task.deleted &&
        !(task.prunedOn !== null && task.completedAt !== null) &&
        bucketKey(task.bucket) === expectedBucket &&
        task.parentId === parentId
      );
    })
    .sort((left, right) => {
      const orderDifference = left.order - right.order;
      return orderDifference === 0
        ? left.id.localeCompare(right.id)
        : orderDifference;
    })
    .flatMap(({ id }) => {
      const map = tasks.get(id);
      return map instanceof Y.Map ? [map] : [];
    });

  siblings.forEach((map, order) => {
    if (map.get("order") !== order) {
      map.set("order", order);
    }
  });
}
