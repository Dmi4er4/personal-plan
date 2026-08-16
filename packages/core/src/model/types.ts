export type LocalDate = `${number}-${number}-${number}`;

export type Bucket =
  | { kind: "date"; date: LocalDate }
  | { kind: "later" }
  | { kind: "much-later" };

export interface TaskSnapshot {
  id: string;
  title: string;
  note: string | null;
  bucket: Bucket;
  parentId: string | null;
  order: number;
  completedAt: string | null;
  completedOn: LocalDate | null;
  childrenRevealedOn: LocalDate | null;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
  deletedAt: string | null;
  deletedOn: LocalDate | null;
  prunedOn: LocalDate | null;
  sourceParentId: string | null;
}

export interface NewTaskInput {
  id: string;
  title: string;
  note: string | null;
  bucket: Bucket;
  parentId: string | null;
  order: number;
  now: string;
}

export interface EditTaskPatch {
  title?: string;
  note?: string | null;
}

export interface MoveDestination {
  bucket: Bucket;
  parentId: string | null;
  index: number;
  now: string;
}

export interface CompletionCommand {
  id: string;
  taskId: string;
  completed: boolean;
  completedAt: string;
  completedOn: LocalDate;
}

export interface RemovalMeta {
  at: string;
  on: LocalDate;
}

export interface CompletionChange {
  completed: boolean;
  at: string;
  on: LocalDate;
  autoMoveToEnd?: boolean;
}

export function bucketKey(bucket: Bucket): string {
  if (bucket.kind === "date") {
    return `date:${bucket.date}`;
  }
  return bucket.kind;
}

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string") {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parseBucketKey(value: string): Bucket {
  if (value === "later") {
    return { kind: "later" };
  }
  if (value === "much-later") {
    return { kind: "much-later" };
  }
  if (value.startsWith("date:")) {
    const date = value.slice("date:".length);
    if (isLocalDate(date)) {
      return { kind: "date", date };
    }
  }
  throw new Error(`invalid_bucket_key:${value}`);
}
