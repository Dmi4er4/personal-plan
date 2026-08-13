import type { Bucket, TaskSnapshot } from "@personal-plan/core";

export type ProjectedTask = TaskSnapshot & { effectiveCompleted: boolean };

export interface TaskBlock {
  parent: ProjectedTask;
  tasks: ProjectedTask[];
}

export interface TimelineSectionInput {
  bucket: Bucket;
  tasks: ProjectedTask[];
}

/**
 * The timeline renders as ONE flat list: each section contributes a static
 * header row followed by its draggable task blocks. Cross-day moves are plain
 * reorders inside that single list, so no manual geometry tracking is needed.
 */
export type TimelineItem =
  | { type: "header"; key: string; bucket: Bucket; empty: boolean }
  | { type: "block"; key: string; block: TaskBlock };

export interface DropDestination {
  bucket: Bucket;
  index: number;
}

export interface ChildDropDestination extends DropDestination {
  parentId: string;
  taskId: string;
}

export function sectionKey(bucket: Bucket): string {
  return bucket.kind === "date" ? `date:${bucket.date}` : bucket.kind;
}

export function bucketsEqual(left: Bucket, right: Bucket): boolean {
  return sectionKey(left) === sectionKey(right);
}

export function taskBlocks(tasks: ProjectedTask[]): TaskBlock[] {
  return tasks.filter((task) => task.parentId === null).map((parent) => ({
    parent,
    tasks: [parent, ...tasks.filter((task) => task.parentId === parent.id)],
  }));
}

export function flattenSections(sections: TimelineSectionInput[]): TimelineItem[] {
  return sections.flatMap((section): TimelineItem[] => [
    { type: "header", key: `header:${sectionKey(section.bucket)}`, bucket: section.bucket, empty: section.tasks.length === 0 },
    ...taskBlocks(section.tasks).map((block): TimelineItem => ({ type: "block", key: `block:${block.parent.id}`, block })),
  ]);
}

/**
 * Resolves where a dragged block landed in the flattened list: the bucket is
 * the nearest header above the block's final position, the index counts the
 * blocks between that header and the block.
 */
export function resolveDropDestination(items: readonly TimelineItem[], draggedKey: string): DropDestination | null {
  const position = items.findIndex((item) => item.key === draggedKey);
  if (position < 0) {
    return null;
  }
  let bucket: Bucket | null = null;
  let index = 0;
  for (let i = 0; i < position; i += 1) {
    const item = items[i];
    if (item === undefined) {
      continue;
    }
    if (item.type === "header") {
      bucket = item.bucket;
      index = 0;
    } else {
      index += 1;
    }
  }
  return bucket === null ? null : { bucket, index };
}

/**
 * Child drag is deliberately scoped to one block. Even if the gesture leaves
 * the visual bounds of that block, the model destination keeps the child in
 * the same bucket and under the same parent.
 */
export function resolveChildDropDestination(
  block: TaskBlock,
  taskId: string,
  requestedIndex: number,
): ChildDropDestination | null {
  const children = block.tasks.filter((task) => task.parentId === block.parent.id);
  if (!children.some((task) => task.id === taskId)) {
    return null;
  }
  return {
    bucket: block.parent.bucket,
    index: Math.max(0, Math.min(Math.trunc(requestedIndex), children.length - 1)),
    parentId: block.parent.id,
    taskId,
  };
}
