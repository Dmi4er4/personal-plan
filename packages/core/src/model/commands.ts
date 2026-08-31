import * as Y from "yjs";
import { normalizeOrders, repairInvalidTaskOrders } from "./rank.js";
import {
  PlanInvariantError,
  requireTaskMap,
  snapshotPlan,
  snapshotTask,
} from "./schema.js";
import {
  bucketKey,
  type Bucket,
  type CompletionCommand,
  type LocalDate,
  type CompletionChange,
  type EditTaskPatch,
  type MoveDestination,
  type NewTaskInput,
  type RemovalMeta,
} from "./types.js";

const APPLIED_WIDGET_COMMANDS = "appliedWidgetCommands";

function isValidOrder(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function safeTaskSnapshot(doc: Y.Doc, id: string) {
  const task = snapshotPlan(doc).records.find((candidate) => candidate.id === id);
  if (task === undefined) {
    throw new PlanInvariantError("task_not_found");
  }
  return task;
}

export function applyWidgetCompletionCommand(
  doc: Y.Doc,
  command: CompletionCommand,
): "applied" | "duplicate" {
  let result: "applied" | "duplicate" = "applied";
  doc.transact(() => {
    const applied = doc.getMap<string>(APPLIED_WIDGET_COMMANDS);
    if (applied.has(command.id)) {
      result = "duplicate";
      return;
    }
    const map = requireTaskMap(doc, command.taskId);
    const task = safeTaskSnapshot(doc, command.taskId);
    const moveToCompletionTail = command.completed && task.completedAt === null;
    map.set("completedAt", command.completed ? command.completedAt : null);
    map.set("completedOn", command.completed ? command.completedOn : null);
    map.set("prunedOn", null);
    if (task.parentId === null) {
      map.set(
        "childrenRevealedOn",
        command.completed ? null : task.completedAt === null ? task.childrenRevealedOn : command.completedOn,
      );
    }
    map.set("updatedAt", command.completedAt);
    if (moveToCompletionTail) {
      moveCompletedTaskToTail(doc, task, command.completedAt, command.completedOn);
    }
    applied.set(command.id, command.completedAt);
  }, "widget-command");
  return result;
}

export function pruneAppliedWidgetCommands(doc: Y.Doc, today: LocalDate): number {
  const threshold = new Date(`${today}T12:00:00.000Z`);
  threshold.setUTCDate(threshold.getUTCDate() - 30);
  let removed = 0;
  doc.transact(() => {
    const applied = doc.getMap<string>(APPLIED_WIDGET_COMMANDS);
    for (const [id, timestamp] of applied) {
      if (Date.parse(timestamp) < threshold.getTime()) {
        applied.delete(id);
        removed += 1;
      }
    }
  }, "widget-command-prune");
  return removed;
}

function replaceText(value: Y.Text, next: string): void {
  value.delete(0, value.length);
  value.insert(0, next);
}

function requireText(map: Y.Map<unknown>, key: "title" | "note"): Y.Text {
  const value = map.get(key);
  if (!(value instanceof Y.Text)) {
    throw new PlanInvariantError(`invalid_task_${key}`);
  }
  return value;
}

function siblingMaps(
  doc: Y.Doc,
  bucket: Bucket,
  parentId: string | null,
  excludedId: string | null,
): Y.Map<unknown>[] {
  const expectedBucket = bucketKey(bucket);
  return snapshotPlan(doc).records
    .filter((task) => {
      return (
        !task.deleted &&
        !(task.prunedOn !== null && task.completedAt !== null) &&
        (excludedId === null || task.id !== excludedId) &&
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
    .map(({ id }) => requireTaskMap(doc, id));
}

function insertAt(
  siblings: Y.Map<unknown>[],
  task: Y.Map<unknown>,
  requestedIndex: number,
): Y.Map<unknown>[] {
  const index = Math.max(0, Math.min(Math.trunc(requestedIndex), siblings.length));
  const ordered = [...siblings];
  ordered.splice(index, 0, task);
  return ordered;
}

function writeOrders(maps: readonly Y.Map<unknown>[]): void {
  maps.forEach((map, order) => {
    map.set("order", order);
  });
}

function createText(value: string | null): Y.Text {
  const text = new Y.Text();
  if (value !== null) {
    text.insert(0, value);
  }
  return text;
}

export function addTask(doc: Y.Doc, input: NewTaskInput): void {
  if (!isValidOrder(input.order)) {
    throw new PlanInvariantError("invalid_task_order");
  }
  doc.transact(() => {
    const tasks = doc.getMap<Y.Map<unknown>>("tasks");
    if (tasks.has(input.id)) {
      throw new PlanInvariantError("duplicate_task");
    }

    let bucket = input.bucket;
    if (input.parentId !== null) {
      const parent = snapshotTask(requireTaskMap(doc, input.parentId));
      if (parent.parentId !== null) {
        throw new PlanInvariantError("nested_subtask");
      }
      bucket = parent.bucket;
    }

    const map = new Y.Map<unknown>();
    map.set("id", input.id);
    map.set("title", createText(input.title));
    map.set("note", createText(input.note));
    map.set("notePresent", input.note !== null);
    map.set("bucket", bucketKey(bucket));
    map.set("parentId", input.parentId);
    map.set("order", input.order);
    map.set("completedAt", null);
    map.set("completedOn", null);
    map.set("childrenRevealedOn", null);
    map.set("createdAt", input.now);
    map.set("updatedAt", input.now);
    map.set("deleted", false);
    map.set("deletedAt", null);
    map.set("deletedOn", null);
    map.set("prunedOn", null);
    tasks.set(input.id, map);
  });
}

export function addTaskToIncompleteHead(doc: Y.Doc, input: NewTaskInput): void {
  repairInvalidTaskOrders(doc);
  doc.transact(() => {
    addTask(doc, { ...input, order: 0 });
    const task = safeTaskSnapshot(doc, input.id);
    moveTask(doc, task.id, {
      bucket: task.bucket,
      parentId: task.parentId,
      index: 0,
      now: input.now,
    });
  }, "add-task-to-incomplete-head");
}

export function editTask(doc: Y.Doc, id: string, patch: EditTaskPatch): void {
  doc.transact(() => {
    const map = requireTaskMap(doc, id);
    if (patch.title !== undefined) {
      replaceText(requireText(map, "title"), patch.title);
    }
    if (patch.note !== undefined) {
      replaceText(requireText(map, "note"), patch.note ?? "");
      map.set("notePresent", patch.note !== null);
    }
  });
}

export function setTaskCompleted(doc: Y.Doc, id: string, state: CompletionChange): void {
  doc.transact(() => {
    const map = requireTaskMap(doc, id);
    const task = safeTaskSnapshot(doc, id);
    const moveToCompletionTail =
      state.completed &&
      task.completedAt === null &&
      state.autoMoveToEnd !== false;
    map.set("completedAt", state.completed ? state.at : null);
    map.set("completedOn", state.completed ? state.on : null);
    map.set("prunedOn", null);
    if (task.parentId === null) {
      if (state.completed) {
        map.set("childrenRevealedOn", null);
      } else if (task.completedAt !== null) {
        map.set("childrenRevealedOn", state.on);
      }
    }
    map.set("updatedAt", state.at);
    if (moveToCompletionTail) {
      moveCompletedTaskToTail(doc, task, state.at, state.on);
    }
  });
}

function moveCompletedTaskToTail(
  doc: Y.Doc,
  task: ReturnType<typeof safeTaskSnapshot>,
  now: string,
  completedOn: LocalDate,
): void {
  moveTask(doc, task.id, {
    bucket: task.parentId === null
      ? { kind: "date", date: completedOn }
      : task.bucket,
    parentId: task.parentId,
    index: Number.MAX_SAFE_INTEGER,
    now,
  });
}

function validateMove(
  doc: Y.Doc,
  taskParentId: string | null,
  destination: MoveDestination,
): void {
  if (destination.parentId !== null) {
    const destinationParent = safeTaskSnapshot(doc, destination.parentId);
    if (destinationParent.parentId !== null) {
      throw new PlanInvariantError("nested_subtask");
    }
  }
  if (taskParentId !== destination.parentId) {
    throw new PlanInvariantError(
      taskParentId === null ? "demotion_not_supported" : "promotion_required",
    );
  }
}

export function moveTask(doc: Y.Doc, id: string, destination: MoveDestination): void {
  doc.transact(() => {
    const map = requireTaskMap(doc, id);
    const task = safeTaskSnapshot(doc, id);
    validateMove(doc, task.parentId, destination);

    if (
      task.parentId !== null &&
      bucketKey(task.bucket) !== bucketKey(destination.bucket)
    ) {
      const parent = safeTaskSnapshot(doc, task.parentId);
      if (bucketKey(parent.bucket) !== bucketKey(destination.bucket)) {
        throw new PlanInvariantError("subtask_bucket_change");
      }
    }

    const oldSiblings = siblingMaps(doc, task.bucket, task.parentId, id);
    const destinationSiblings =
      bucketKey(task.bucket) === bucketKey(destination.bucket) &&
      task.parentId === destination.parentId
        ? oldSiblings
        : siblingMaps(doc, destination.bucket, destination.parentId, id);
    const orderedDestination = insertAt(destinationSiblings, map, destination.index);

    map.set("bucket", bucketKey(destination.bucket));
    map.set("parentId", destination.parentId);
    map.set("updatedAt", destination.now);
    writeOrders(oldSiblings);
    writeOrders(orderedDestination);
    normalizeOrders(doc, task.bucket, task.parentId);
    normalizeOrders(doc, destination.bucket, destination.parentId);

    if (task.parentId === null && bucketKey(task.bucket) !== bucketKey(destination.bucket)) {
      for (const child of snapshotPlan(doc).records) {
        if (child.parentId === id) {
          const childMap = requireTaskMap(doc, child.id);
          childMap.set("bucket", bucketKey(destination.bucket));
          childMap.set("updatedAt", destination.now);
        }
      }
    }
  });
}

export interface ReorderTaskSequenceInput {
  bucket: Bucket;
  parentId: string | null;
  taskIds: readonly string[];
  movedTaskId: string;
  now: string;
}

/**
 * Persists the exact visible order of one projected task sequence.
 *
 * A projected day may contain incomplete tasks whose stored bucket is an older
 * date. Reordering just the dragged task cannot place a newly-created task
 * before those carry-overs, because they still belong to different stored
 * containers. This command materializes the whole visible sequence into the
 * destination container and writes its order atomically.
 */
export function reorderTaskSequence(doc: Y.Doc, input: ReorderTaskSequenceInput): void {
  const uniqueIds = new Set(input.taskIds);
  if (
    input.taskIds.length === 0 ||
    uniqueIds.size !== input.taskIds.length ||
    !uniqueIds.has(input.movedTaskId)
  ) {
    throw new PlanInvariantError("invalid_task_sequence");
  }

  const before = snapshotPlan(doc);
  const byId = new Map(before.records.map((task) => [task.id, task]));
  const orderedTasks = input.taskIds.map((id) => {
    const task = byId.get(id);
    if (task === undefined) {
      throw new PlanInvariantError("task_not_found");
    }
    if (task.deleted || task.parentId !== input.parentId) {
      throw new PlanInvariantError("invalid_task_sequence");
    }
    validateMove(doc, task.parentId, {
      bucket: input.bucket,
      parentId: input.parentId,
      index: 0,
      now: input.now,
    });
    return task;
  });
  const sourceBuckets = new Map(orderedTasks.map((task) => [bucketKey(task.bucket), task.bucket]));

  doc.transact(() => {
    const orderedMaps = orderedTasks.map((task) => requireTaskMap(doc, task.id));
    for (const [index, task] of orderedTasks.entries()) {
      const map = orderedMaps[index];
      if (map === undefined) continue;
      const bucketChanged = bucketKey(task.bucket) !== bucketKey(input.bucket);
      map.set("bucket", bucketKey(input.bucket));
      map.set("parentId", input.parentId);
      if (bucketChanged || task.id === input.movedTaskId) {
        map.set("updatedAt", input.now);
      }
      if (bucketChanged && task.parentId === null) {
        for (const child of before.records) {
          if (child.parentId === task.id) {
            const childMap = requireTaskMap(doc, child.id);
            childMap.set("bucket", bucketKey(input.bucket));
            childMap.set("updatedAt", input.now);
          }
        }
      }
    }

    const remainingDestination = siblingMaps(doc, input.bucket, input.parentId, null)
      .filter((map) => {
        const id = map.get("id");
        return typeof id !== "string" || !uniqueIds.has(id);
      });
    writeOrders([...orderedMaps, ...remainingDestination]);

    for (const [key, sourceBucket] of sourceBuckets) {
      if (key !== bucketKey(input.bucket)) {
        normalizeOrders(doc, sourceBucket, input.parentId);
      }
    }
  }, "reorder-task-sequence");
}

export function setTaskOrder(
  doc: Y.Doc,
  id: string,
  order: number,
  updatedAt: string,
): void {
  if (!isValidOrder(order)) {
    throw new PlanInvariantError("invalid_task_order");
  }
  doc.transact(() => {
    const map = requireTaskMap(doc, id);
    if (map.get("order") !== order) {
      map.set("order", order);
    }
    if (map.get("updatedAt") !== updatedAt) {
      map.set("updatedAt", updatedAt);
    }
  });
}

export function removeTask(doc: Y.Doc, id: string, meta?: RemovalMeta): void {
  const at = meta?.at ?? new Date().toISOString();
  const on = meta?.on ?? null;
  doc.transact(() => {
    const tasks = doc.getMap<Y.Map<unknown>>("tasks");
    const task = snapshotTask(requireTaskMap(doc, id));
    if (task.parentId === null) {
      for (const candidateMap of tasks.values()) {
        if (snapshotTask(candidateMap).parentId === id) {
          candidateMap.set("deleted", true);
          if (on !== null) {
            candidateMap.set("deletedAt", at);
            candidateMap.set("deletedOn", on);
          }
        }
      }
    }
    const map = requireTaskMap(doc, id);
    map.set("deleted", true);
    if (on !== null) {
      map.set("deletedAt", at);
      map.set("deletedOn", on);
    }
  });
}

export function restoreTask(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    const tasks = doc.getMap<Y.Map<unknown>>("tasks");
    const task = snapshotTask(requireTaskMap(doc, id));
    const map = requireTaskMap(doc, id);
    map.set("deleted", false);
    map.set("deletedAt", null);
    map.set("deletedOn", null);
    if (task.parentId === null) {
      for (const candidateMap of tasks.values()) {
        if (snapshotTask(candidateMap).parentId === id) {
          candidateMap.set("deleted", false);
          candidateMap.set("deletedAt", null);
          candidateMap.set("deletedOn", null);
        }
      }
    }
  });
}

export function reparentTask(
  doc: Y.Doc,
  id: string,
  destination: MoveDestination,
): void {
  doc.transact(() => {
    if (destination.parentId === null) {
      throw new PlanInvariantError("reparent_requires_parent");
    }
    if (destination.parentId === id) {
      throw new PlanInvariantError("task_cannot_parent_itself");
    }
    const tasks = doc.getMap<Y.Map<unknown>>("tasks");
    const map = requireTaskMap(doc, id);
    const task = snapshotTask(map);
    const parent = snapshotTask(requireTaskMap(doc, destination.parentId));
    if (parent.parentId !== null) {
      throw new PlanInvariantError("nested_subtask");
    }
    if (
      task.parentId === null &&
      Array.from(tasks.values()).some((candidate) => {
        const child = snapshotTask(candidate);
        return (
          child.parentId === id &&
          !child.deleted &&
          !(child.prunedOn !== null && child.completedAt !== null)
        );
      })
    ) {
      throw new PlanInvariantError("reparent_task_has_children");
    }

    const oldSiblings = siblingMaps(doc, task.bucket, task.parentId, id);
    const destinationSiblings = siblingMaps(
      doc,
      parent.bucket,
      destination.parentId,
      id,
    );
    const orderedDestination = insertAt(
      destinationSiblings,
      map,
      destination.index,
    );

    map.set("bucket", bucketKey(parent.bucket));
    map.set("parentId", destination.parentId);
    map.set("updatedAt", destination.now);
    writeOrders(oldSiblings);
    writeOrders(orderedDestination);
    normalizeOrders(doc, task.bucket, task.parentId);
    normalizeOrders(doc, parent.bucket, destination.parentId);
  });
}

export function promoteSubtask(
  doc: Y.Doc,
  id: string,
  destination: MoveDestination,
): void {
  doc.transact(() => {
    const map = requireTaskMap(doc, id);
    const task = snapshotTask(map);
    if (task.parentId === null) {
      throw new PlanInvariantError("task_not_subtask");
    }
    if (destination.parentId !== null) {
      throw new PlanInvariantError("promotion_requires_top_level_destination");
    }

    const oldSiblings = siblingMaps(doc, task.bucket, task.parentId, id);
    const destinationSiblings = siblingMaps(doc, destination.bucket, null, id);
    const orderedDestination = insertAt(destinationSiblings, map, destination.index);

    map.set("bucket", bucketKey(destination.bucket));
    map.set("parentId", null);
    map.set("updatedAt", destination.now);
    writeOrders(oldSiblings);
    writeOrders(orderedDestination);
    normalizeOrders(doc, task.bucket, task.parentId);
    normalizeOrders(doc, destination.bucket, null);
  });
}
