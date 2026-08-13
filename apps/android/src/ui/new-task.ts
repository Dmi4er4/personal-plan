import type { Bucket, NewTaskInput, ProjectedPlan } from "@personal-plan/core";
import { bucketsEqual } from "./timeline-model";

export interface NewTaskContext { projected: ProjectedPlan; id: string; now: string }

export function buildNewTask(title: string, bucket: Bucket, { projected, id, now }: NewTaskContext): NewTaskInput | null {
  if (title.trim().length === 0) return null;
  const section = projected.active.find((entry) => bucketsEqual(entry.bucket, bucket));
  const orders = section?.tasks.filter((task) => task.parentId === null).map((task) => task.order) ?? [];
  return { id, title, note: null, bucket, parentId: null, order: Math.max(-1, ...orders) + 1, now };
}
