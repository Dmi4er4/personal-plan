import * as Y from "yjs";
import { snapshotTask } from "./schema.js";
import { bucketKey, type Bucket } from "./types.js";

export function normalizeOrders(
  tasks: Y.Map<Y.Map<unknown>>,
  bucket: Bucket,
  parentId: string | null,
): void {
  const expectedBucket = bucketKey(bucket);
  const siblings = Array.from(tasks.values())
    .filter((map) => {
      const task = snapshotTask(map);
      return (
        !task.deleted &&
        !(task.prunedOn !== null && task.completedAt !== null) &&
        bucketKey(task.bucket) === expectedBucket &&
        task.parentId === parentId
      );
    })
    .sort((left, right) => {
      const leftTask = snapshotTask(left);
      const rightTask = snapshotTask(right);
      const orderDifference = leftTask.order - rightTask.order;
      return orderDifference === 0
        ? leftTask.id.localeCompare(rightTask.id)
        : orderDifference;
    });

  siblings.forEach((map, order) => {
    map.set("order", order);
  });
}
