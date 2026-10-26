import type { Bucket, NewTaskInput, TaskSnapshot } from "@personal-plan/core";

export interface NewTaskContext { id: string; now: string }

export function newTaskValidationError(title: string): string | null {
  return title.trim().length === 0 ? "Введите название дела" : null;
}

export function buildNewTask(title: string, bucket: Bucket, { id, now }: NewTaskContext): NewTaskInput | null {
  if (newTaskValidationError(title) !== null) return null;
  return { id, title, note: null, bucket, parentId: null, order: 0, now };
}

export function buildNewSubtask(
  title: string,
  parent: TaskSnapshot,
  { id, now }: NewTaskContext,
): NewTaskInput | null {
  if (parent.parentId !== null || parent.completedAt !== null || parent.deleted || newTaskValidationError(title) !== null) return null;
  return {
    id,
    title,
    note: null,
    bucket: parent.bucket,
    parentId: parent.id,
    order: 0,
    now,
  };
}
