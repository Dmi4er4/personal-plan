import * as Y from "yjs";

import {
  bucketKey,
  isLocalDate,
  parseBucketKey,
  type Bucket,
  type LocalDate,
  type TaskSnapshot,
} from "./types.js";

export class PlanInvariantError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PlanInvariantError";
  }
}

export type PlanDiagnosticCode =
  | "inconsistent_task_notePresence"
  | "invalid_task_bucket"
  | "invalid_task_childrenRevealedOn"
  | "invalid_task_completedAt"
  | "invalid_task_completedOn"
  | "invalid_task_createdAt"
  | "invalid_task_deleted"
  | "invalid_task_deletedAt"
  | "invalid_task_deletedOn"
  | "invalid_task_id"
  | "invalid_task_map"
  | "invalid_task_note"
  | "invalid_task_notePresent"
  | "invalid_task_order"
  | "invalid_task_parentId"
  | "invalid_task_prunedOn"
  | "invalid_task_title"
  | "invalid_task_updatedAt"
  | "missing_task_parent";

export interface PlanDiagnostic {
  code: PlanDiagnosticCode;
  field: string | null;
  message: string;
  taskId: string;
}

export interface PlanSnapshot {
  diagnostics: PlanDiagnostic[];
  records: TaskSnapshot[];
  tasks: TaskSnapshot[];
}

const SAFE_TIMESTAMP = "1970-01-01T00:00:00.000Z";

function requireString(map: Y.Map<unknown>, key: string): string {
  const value = map.get(key);
  if (typeof value !== "string") {
    throw new PlanInvariantError(`invalid_task_${key}`);
  }
  return value;
}

function requireNullableString(map: Y.Map<unknown>, key: string): string | null {
  const value = map.get(key);
  if (value === null || typeof value === "string") {
    return value;
  }
  throw new PlanInvariantError(`invalid_task_${key}`);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/u.exec(
    value,
  );
  if (match === null) {
    return false;
  }
  const localDate = `${match[1] ?? ""}-${match[2] ?? ""}-${match[3] ?? ""}`;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  if (
    !isLocalDate(localDate) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

function requireIsoTimestamp(map: Y.Map<unknown>, key: string): string {
  const value = map.get(key);
  if (!isIsoTimestamp(value)) {
    throw new PlanInvariantError(`invalid_task_${key}`);
  }
  return value;
}

function requireNullableIsoTimestamp(
  map: Y.Map<unknown>,
  key: string,
): string | null {
  const value = map.get(key);
  if (value === null) {
    return null;
  }
  if (!isIsoTimestamp(value)) {
    throw new PlanInvariantError(`invalid_task_${key}`);
  }
  return value;
}

function requireLocalDateOrNull(
  map: Y.Map<unknown>,
  key: string,
): LocalDate | null {
  const value = map.get(key);
  if (value === null) {
    return null;
  }
  if (isLocalDate(value)) {
    return value;
  }
  throw new PlanInvariantError(`invalid_task_${key}`);
}

function readOptionalLocalDateOrNull(
  map: Y.Map<unknown>,
  key: string,
): LocalDate | null {
  if (!map.has(key)) {
    return null;
  }
  return requireLocalDateOrNull(map, key);
}

function requireOrder(map: Y.Map<unknown>): number {
  const value = map.get("order");
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new PlanInvariantError("invalid_task_order");
  }
  return value;
}

function requireText(map: Y.Map<unknown>, key: string): Y.Text {
  const value = map.get(key);
  if (!(value instanceof Y.Text)) {
    throw new PlanInvariantError(`invalid_task_${key}`);
  }
  return value;
}

function readDeleted(map: Y.Map<unknown>): boolean {
  if (!map.has("deleted")) {
    return false;
  }
  const value = map.get("deleted");
  if (typeof value !== "boolean") {
    throw new PlanInvariantError("invalid_task_deleted");
  }
  return value;
}

function readNote(map: Y.Map<unknown>): string | null {
  const note = requireText(map, "note").toJSON();
  if (!map.has("notePresent")) {
    return note.length === 0 ? null : note;
  }
  const notePresent = map.get("notePresent");
  if (typeof notePresent !== "boolean") {
    throw new PlanInvariantError("invalid_task_notePresent");
  }
  if (note.length > 0) {
    return note;
  }
  return notePresent ? "" : null;
}

function compareTasks(left: TaskSnapshot, right: TaskSnapshot): number {
  const orderDifference = left.order - right.order;
  return orderDifference === 0 ? left.id.localeCompare(right.id) : orderDifference;
}

function compareTopLevel(left: TaskSnapshot, right: TaskSnapshot): number {
  const bucketDifference = bucketKey(left.bucket).localeCompare(bucketKey(right.bucket));
  return bucketDifference === 0 ? compareTasks(left, right) : bucketDifference;
}

export function getTaskMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const value = doc.getMap<unknown>("tasks").get(id);
  if (value === undefined) {
    return undefined;
  }
  if (!(value instanceof Y.Map)) {
    throw new PlanInvariantError("invalid_task_map");
  }
  return value;
}

export function requireTaskMap(doc: Y.Doc, id: string): Y.Map<unknown> {
  const map = getTaskMap(doc, id);
  if (map === undefined) {
    throw new PlanInvariantError("task_not_found");
  }
  return map;
}

export function snapshotTask(map: Y.Map<unknown>): TaskSnapshot {
  return {
    id: requireString(map, "id"),
    title: requireText(map, "title").toJSON(),
    note: readNote(map),
    bucket: parseBucketKey(requireString(map, "bucket")),
    parentId: requireNullableString(map, "parentId"),
    order: requireOrder(map),
    completedAt: requireNullableIsoTimestamp(map, "completedAt"),
    completedOn: requireLocalDateOrNull(map, "completedOn"),
    childrenRevealedOn: readOptionalLocalDateOrNull(map, "childrenRevealedOn"),
    createdAt: requireIsoTimestamp(map, "createdAt"),
    updatedAt: requireIsoTimestamp(map, "updatedAt"),
    deleted: readDeleted(map),
    deletedAt: map.has("deletedAt") ? requireNullableIsoTimestamp(map, "deletedAt") : null,
    deletedOn: readOptionalLocalDateOrNull(map, "deletedOn"),
    prunedOn: readOptionalLocalDateOrNull(map, "prunedOn"),
    sourceParentId: null,
  };
}

function addDiagnostic(
  diagnostics: PlanDiagnostic[],
  taskId: string,
  code: PlanDiagnosticCode,
  field: string | null,
): void {
  diagnostics.push({
    code,
    field,
    message: `${code}:${taskId}`,
    taskId,
  });
}

function safeText(
  map: Y.Map<unknown>,
  key: "note" | "title",
  taskId: string,
  diagnostics: PlanDiagnostic[],
): string {
  const value = map.get(key);
  if (value instanceof Y.Text) {
    return value.toJSON();
  }
  addDiagnostic(diagnostics, taskId, `invalid_task_${key}`, key);
  return typeof value === "string" ? value : "";
}

function safeBucket(
  value: unknown,
  taskId: string,
  diagnostics: PlanDiagnostic[],
): Bucket {
  if (typeof value === "string") {
    try {
      return parseBucketKey(value);
    } catch {
      // Fall through to the deterministic safe bucket.
    }
  }
  addDiagnostic(diagnostics, taskId, "invalid_task_bucket", "bucket");
  return { kind: "later" };
}

function safeParentId(
  value: unknown,
  taskId: string,
  diagnostics: PlanDiagnostic[],
): string | null {
  if (value === null || typeof value === "string") {
    return value;
  }
  addDiagnostic(diagnostics, taskId, "invalid_task_parentId", "parentId");
  return null;
}

function safeOrder(
  value: unknown,
  taskId: string,
  diagnostics: PlanDiagnostic[],
): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  addDiagnostic(diagnostics, taskId, "invalid_task_order", "order");
  return 0;
}

function safeNullableDate(
  value: unknown,
  taskId: string,
  field: "childrenRevealedOn" | "completedOn" | "deletedOn" | "prunedOn",
  diagnostics: PlanDiagnostic[],
): LocalDate | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (isLocalDate(value)) {
    return value;
  }
  addDiagnostic(diagnostics, taskId, `invalid_task_${field}`, field);
  return null;
}

function safeNullableTimestamp(
  value: unknown,
  taskId: string,
  field: "completedAt" | "deletedAt",
  diagnostics: PlanDiagnostic[],
): string | null {
  if (value === null) {
    return null;
  }
  if (isIsoTimestamp(value)) {
    return value;
  }
  addDiagnostic(diagnostics, taskId, `invalid_task_${field}`, field);
  return null;
}

function safeTimestamp(
  value: unknown,
  taskId: string,
  field: "createdAt" | "updatedAt",
  fallback: string,
  diagnostics: PlanDiagnostic[],
): string {
  if (isIsoTimestamp(value)) {
    return value;
  }
  addDiagnostic(diagnostics, taskId, `invalid_task_${field}`, field);
  return fallback;
}

function safeBoolean(
  value: unknown,
  taskId: string,
  field: "deleted",
  diagnostics: PlanDiagnostic[],
): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value === "boolean") {
    return value;
  }
  addDiagnostic(diagnostics, taskId, `invalid_task_${field}`, field);
  return false;
}

function safeSnapshotTask(
  value: unknown,
  rootId: string,
  diagnostics: PlanDiagnostic[],
): TaskSnapshot {
  if (!(value instanceof Y.Map)) {
    addDiagnostic(diagnostics, rootId, "invalid_task_map", null);
    return {
      id: rootId,
      title: `[Повреждённая задача ${rootId}]`,
      note: null,
      bucket: { kind: "later" },
      parentId: null,
      order: 0,
      completedAt: null,
      completedOn: null,
      childrenRevealedOn: null,
      createdAt: SAFE_TIMESTAMP,
      updatedAt: SAFE_TIMESTAMP,
      deleted: false,
      deletedAt: null,
      deletedOn: null,
      prunedOn: null,
      sourceParentId: null,
    };
  }
  const map: Y.Map<unknown> = value;

  const storedId = map.get("id");
  if (storedId !== rootId) {
    addDiagnostic(diagnostics, rootId, "invalid_task_id", "id");
  }
  const title = safeText(map, "title", rootId, diagnostics);
  const noteText = safeText(map, "note", rootId, diagnostics);
  const rawNotePresent = map.get("notePresent");
  let notePresent: boolean;
  if (!map.has("notePresent")) {
    notePresent = noteText.length > 0;
  } else if (typeof rawNotePresent === "boolean") {
    notePresent = rawNotePresent;
  } else {
    addDiagnostic(
      diagnostics,
      rootId,
      "invalid_task_notePresent",
      "notePresent",
    );
    notePresent = noteText.length > 0;
  }
  if (!notePresent && noteText.length > 0) {
    addDiagnostic(
      diagnostics,
      rootId,
      "inconsistent_task_notePresence",
      "notePresent",
    );
    notePresent = true;
  }
  const createdAt = safeTimestamp(
    map.get("createdAt"),
    rootId,
    "createdAt",
    SAFE_TIMESTAMP,
    diagnostics,
  );

  return {
    id: rootId,
    title,
    note: notePresent ? noteText : null,
    bucket: safeBucket(map.get("bucket"), rootId, diagnostics),
    parentId: safeParentId(map.get("parentId"), rootId, diagnostics),
    order: safeOrder(map.get("order"), rootId, diagnostics),
    completedAt: safeNullableTimestamp(
      map.get("completedAt"),
      rootId,
      "completedAt",
      diagnostics,
    ),
    completedOn: safeNullableDate(
      map.get("completedOn"),
      rootId,
      "completedOn",
      diagnostics,
    ),
    childrenRevealedOn: safeNullableDate(
      map.get("childrenRevealedOn"),
      rootId,
      "childrenRevealedOn",
      diagnostics,
    ),
    createdAt,
    updatedAt: safeTimestamp(
      map.get("updatedAt"),
      rootId,
      "updatedAt",
      createdAt,
      diagnostics,
    ),
    deleted: safeBoolean(
      map.has("deleted") ? map.get("deleted") : undefined,
      rootId,
      "deleted",
      diagnostics,
    ),
    deletedAt: safeNullableTimestamp(
      map.has("deletedAt") ? map.get("deletedAt") : null,
      rootId,
      "deletedAt",
      diagnostics,
    ),
    deletedOn: safeNullableDate(
      map.has("deletedOn") ? map.get("deletedOn") : null,
      rootId,
      "deletedOn",
      diagnostics,
    ),
    prunedOn: safeNullableDate(
      map.has("prunedOn") ? map.get("prunedOn") : null,
      rootId,
      "prunedOn",
      diagnostics,
    ),
    sourceParentId: null,
  };
}

function isIntrinsicallyVisible(
  task: TaskSnapshot,
  recordsById: ReadonlyMap<string, TaskSnapshot>,
): boolean {
  if (task.deleted) {
    return false;
  }
  if (task.prunedOn === null) {
    return true;
  }
  if (task.completedAt !== null) {
    return false;
  }
  if (task.parentId === null) {
    return true;
  }
  const parent = recordsById.get(task.parentId);
  return parent === undefined || parent.completedAt === null;
}

export function snapshotPlan(doc: Y.Doc): PlanSnapshot {
  const diagnostics: PlanDiagnostic[] = [];
  const records = Array.from(doc.getMap<unknown>("tasks").entries(), ([id, value]) =>
    safeSnapshotTask(value, id, diagnostics),
  ).sort((left, right) => left.id.localeCompare(right.id));
  const recordsById = new Map(records.map((task) => [task.id, task]));
  const rawChildrenByParent = new Map<string, TaskSnapshot[]>();
  for (const task of records) {
    if (task.parentId === null) {
      continue;
    }
    const children = rawChildrenByParent.get(task.parentId) ?? [];
    children.push(task);
    rawChildrenByParent.set(task.parentId, children);
  }

  const visibleIds = new Set<string>();
  for (const task of records) {
    if (isIntrinsicallyVisible(task, recordsById)) {
      visibleIds.add(task.id);
    }
  }
  for (const task of records) {
    if (
      task.parentId === null &&
      !visibleIds.has(task.id) &&
      (rawChildrenByParent.get(task.id) ?? []).some((child) =>
        isIntrinsicallyVisible(child, recordsById),
      )
    ) {
      visibleIds.add(task.id);
    }
  }

  const visible: TaskSnapshot[] = [];
  for (const task of records) {
    if (!visibleIds.has(task.id)) {
      continue;
    }
    if (task.parentId === null) {
      visible.push(task);
      continue;
    }
    const parent = recordsById.get(task.parentId);
    if (
      parent !== undefined &&
      parent.parentId === null &&
      visibleIds.has(parent.id)
    ) {
      visible.push({ ...task, bucket: parent.bucket });
      continue;
    }
    addDiagnostic(
      diagnostics,
      task.id,
      "missing_task_parent",
      "parentId",
    );
    visible.push({
      ...task,
      parentId: null,
      sourceParentId: task.parentId,
    });
  }

  const parents = visible
    .filter(({ parentId }) => parentId === null)
    .sort(compareTopLevel);
  const childrenByParent = new Map<string, TaskSnapshot[]>();
  for (const task of visible) {
    if (task.parentId === null) {
      continue;
    }
    const children = childrenByParent.get(task.parentId) ?? [];
    children.push(task);
    childrenByParent.set(task.parentId, children);
  }

  const tasks: TaskSnapshot[] = [];
  for (const parent of parents) {
    tasks.push(parent);
    tasks.push(...(childrenByParent.get(parent.id) ?? []).sort(compareTasks));
  }
  diagnostics.sort((left, right) => {
    const taskDifference = left.taskId.localeCompare(right.taskId);
    if (taskDifference !== 0) {
      return taskDifference;
    }
    const codeDifference = left.code.localeCompare(right.code);
    return codeDifference === 0
      ? (left.field ?? "").localeCompare(right.field ?? "")
      : codeDifference;
  });
  return { diagnostics, records, tasks };
}
