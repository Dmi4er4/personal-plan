import { bucketKey, type Bucket, type LocalDate, type TaskSnapshot } from "../model/types.js";
import { addDays, compareLocalDate } from "./local-date.js";

export interface ProjectedSection {
  bucket: Bucket;
  tasks: Array<TaskSnapshot & { effectiveCompleted: boolean }>;
}

export interface ProjectedPlan {
  active: ProjectedSection[];
  history: TaskSnapshot[];
}

type TasksById = ReadonlyMap<string, TaskSnapshot>;

export function isEffectivelyCompleted(task: TaskSnapshot, byId: TasksById): boolean {
  if (task.completedAt !== null) {
    return true;
  }
  if (task.parentId === null) {
    return false;
  }
  const parent = byId.get(task.parentId);
  return parent !== undefined && parent.completedAt !== null;
}

export function effectiveBucket(
  task: TaskSnapshot,
  byId: TasksById,
  today: LocalDate,
): Bucket {
  if (task.parentId !== null) {
    const parent = byId.get(task.parentId);
    if (parent !== undefined) {
      return effectiveBucket(parent, byId, today);
    }
  }

  if (task.completedAt !== null && task.completedOn !== null) {
    return { kind: "date", date: task.completedOn };
  }
  if (task.bucket.kind === "date" && compareLocalDate(task.bucket.date, today) < 0) {
    return { kind: "date", date: today };
  }
  return task.bucket;
}

function activeBuckets(today: LocalDate): Bucket[] {
  const dated: Bucket[] = Array.from({ length: 7 }, (_, offset) => ({
    kind: "date",
    date: addDays(today, offset),
  }));
  return [...dated, { kind: "later" }, { kind: "much-later" }];
}

export function projectPlan(
  tasks: TaskSnapshot[],
  today: LocalDate,
  records: readonly TaskSnapshot[] = tasks,
): ProjectedPlan {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const sections: ProjectedSection[] = activeBuckets(today).map((bucket) => ({
    bucket,
    tasks: [],
  }));
  const sectionsByBucket = new Map(sections.map((section) => [bucketKey(section.bucket), section]));
  const childrenByParent = new Map<string, TaskSnapshot[]>();

  for (const task of tasks) {
    if (task.parentId === null) {
      continue;
    }
    const children = childrenByParent.get(task.parentId) ?? [];
    children.push(task);
    childrenByParent.set(task.parentId, children);
  }

  const historicalGroups: Array<{
    completedOn: LocalDate;
    kind: "block" | "child";
    sequence: number;
    tasks: TaskSnapshot[];
  }> = [];
  let historySequence = 0;
  for (const parent of tasks) {
    if (parent.parentId !== null) {
      continue;
    }
    const block = [parent, ...(childrenByParent.get(parent.id) ?? [])];
    const bucket = effectiveBucket(parent, byId, today);
    if (
      isEffectivelyCompleted(parent, byId) &&
      bucket.kind === "date" &&
      compareLocalDate(bucket.date, today) < 0
    ) {
      if (parent.completedOn !== null) {
        historicalGroups.push({
          completedOn: parent.completedOn,
          kind: "block",
          sequence: historySequence,
          tasks: block,
        });
        historySequence += 1;
      }
      continue;
    }

    const section = sectionsByBucket.get(bucketKey(bucket));
    const activeBlock: TaskSnapshot[] = [parent];
    const revealStoredChildren =
      parent.completedAt === null && parent.childrenRevealedOn === today;
    for (const child of childrenByParent.get(parent.id) ?? []) {
      if (
        parent.completedAt === null &&
        !revealStoredChildren &&
        child.completedAt !== null &&
        child.completedOn !== null &&
        compareLocalDate(child.completedOn, today) < 0
      ) {
        historicalGroups.push({
          completedOn: child.completedOn,
          kind: "child",
          sequence: historySequence,
          tasks: [child],
        });
        historySequence += 1;
      } else {
        activeBlock.push(child);
      }
    }

    if (section !== undefined) {
      section.tasks.push(
        ...activeBlock.map((task) => ({
        ...task,
        effectiveCompleted: isEffectivelyCompleted(task, byId),
        })),
      );
    }
  }

  historicalGroups.sort((left, right) => {
    const dateDifference = compareLocalDate(right.completedOn, left.completedOn);
    if (dateDifference !== 0) {
      return dateDifference;
    }
    if (left.kind !== right.kind) {
      return left.kind === "block" ? -1 : 1;
    }
    return left.sequence - right.sequence;
  });

  const deletedChildrenByParent = new Map<string, TaskSnapshot[]>();
  for (const task of records) {
    if (task.parentId === null || !task.deleted || task.deletedOn === null) {
      continue;
    }
    const children = deletedChildrenByParent.get(task.parentId) ?? [];
    children.push(task);
    deletedChildrenByParent.set(task.parentId, children);
  }
  for (const parent of records) {
    if (parent.parentId !== null || !parent.deleted || parent.deletedOn === null) {
      continue;
    }
    const block = [
      parent,
      ...(deletedChildrenByParent.get(parent.id) ?? []).sort((left, right) =>
        left.order - right.order,
      ),
    ];
    historicalGroups.push({
      completedOn: parent.deletedOn,
      kind: "block",
      sequence: historySequence,
      tasks: block,
    });
    historySequence += 1;
  }

  historicalGroups.sort((left, right) => {
    const dateDifference = compareLocalDate(right.completedOn, left.completedOn);
    if (dateDifference !== 0) {
      return dateDifference;
    }
    if (left.kind !== right.kind) {
      return left.kind === "block" ? -1 : 1;
    }
    return left.sequence - right.sequence;
  });

  return {
    active: sections,
    history: historicalGroups.flatMap(({ tasks: historicalTasks }) => historicalTasks),
  };
}
