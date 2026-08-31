import type { Bucket, NewTaskInput } from "@personal-plan/core";

export interface NewTaskContext { id: string; now: string }

export function buildNewTask(title: string, bucket: Bucket, { id, now }: NewTaskContext): NewTaskInput | null {
  if (title.trim().length === 0) return null;
  return { id, title, note: null, bucket, parentId: null, order: 0, now };
}
