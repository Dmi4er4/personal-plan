import * as Y from "yjs";
import {
  addTask,
  editTask,
  moveTask,
  promoteSubtask,
  reparentTask,
  removeTask,
  setTaskOrder,
  setTaskCompleted,
} from "../model/commands.js";
import { snapshotPlan } from "../model/schema.js";
import {
  bucketKey,
  type Bucket,
  type LocalDate,
  type TaskSnapshot,
} from "../model/types.js";
import { compareLocalDate } from "../time/local-date.js";
import { projectPlan } from "../time/project.js";
import type {
  ParseDiagnostic,
  ParsedPlan,
  ParsedTask,
} from "./types.js";

export type ReconcileChange =
  | {
      kind: "create";
      provisionalId: string;
      task: ParsedTask;
      bucket: Bucket;
      parentId: string | null;
      index: number;
      storedOrder?: number;
    }
  | { kind: "update"; taskId: string; task: ParsedTask }
  | {
      kind: "move";
      taskId: string;
      bucket: Bucket;
      parentId: string | null;
      index: number;
      storedOrder?: number;
    }
  | {
      kind: "remove";
      taskId: string;
      hiddenCascade?: {
        parentId: string;
        title: string;
        referenceDate: LocalDate;
        taskState: string;
        parentState: string;
      };
    };

export interface ReconcilePreview {
  source: string;
  diagnostics: ParseDiagnostic[];
  changes: ReconcileChange[];
  destructive: boolean;
  requiresConfirmation: boolean;
  baseTaskSignatures: Readonly<Record<string, string>>;
  baseContainerSignatures: readonly ReconcileContainerSignature[];
}

export interface ReconcileContainerSignature {
  bucket: Bucket;
  parentId: string | null;
  signature: string;
}

export class StaleReconcilePreviewError extends Error {
  readonly code = "reconcile_stale_preview";

  constructor(readonly target: string) {
    super(`reconcile_stale_preview:${target}`);
    this.name = "StaleReconcilePreviewError";
  }
}

export interface ApplyReconcileOptions {
  now: string;
  completedOn: LocalDate;
  idFactory: () => string;
  confirmDiagnostics?: boolean;
  confirmRisky?: boolean;
}

interface ExistingTask {
  task: TaskSnapshot;
  displayedBucket: Bucket;
  index: number;
}

interface DesiredTask {
  task: ParsedTask;
  bucket: Bucket;
  provisionalId: string;
  index: number;
  parent: DesiredTask | null;
  children: DesiredTask[];
  storedOrder?: number;
}

function normalizeText(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

function storedNote(value: string | null): string | null {
  return value;
}

function normalizedNote(value: string | null): string | null {
  const stored = storedNote(value);
  if (stored === null) {
    return null;
  }
  return normalizeText(stored);
}

function sameBucket(left: Bucket, right: Bucket): boolean {
  return bucketKey(left) === bucketKey(right);
}

function sameRawContent(existing: ExistingTask, parsed: ParsedTask): boolean {
  const existingDepth = existing.task.parentId === null ? 0 : 1;
  return (
    existingDepth === parsed.depth &&
    existing.task.title === parsed.title &&
    existing.task.note === storedNote(parsed.note) &&
    (existing.task.completedAt !== null) === parsed.completed
  );
}

function sameNormalizedContent(existing: ExistingTask, parsed: ParsedTask): boolean {
  const existingDepth = existing.task.parentId === null ? 0 : 1;
  return (
    existingDepth === parsed.depth &&
    normalizeText(existing.task.title) === normalizeText(parsed.title) &&
    normalizedNote(existing.task.note) === normalizedNote(parsed.note) &&
    (existing.task.completedAt !== null) === parsed.completed
  );
}

function parsedRawContentKey(task: ParsedTask): string {
  return JSON.stringify([
    task.depth,
    task.title,
    storedNote(task.note),
    task.completed,
  ]);
}

function existingRawContentKey(task: ExistingTask): string {
  return JSON.stringify([
    task.task.parentId === null ? 0 : 1,
    task.task.title,
    task.task.note,
    task.task.completedAt !== null,
  ]);
}

function parsedNormalizedContentKey(task: ParsedTask): string {
  return JSON.stringify([
    task.depth,
    normalizeText(task.title),
    normalizedNote(task.note),
    task.completed,
  ]);
}

function existingNormalizedContentKey(task: ExistingTask): string {
  return JSON.stringify([
    task.task.parentId === null ? 0 : 1,
    normalizeText(task.task.title),
    normalizedNote(task.task.note),
    task.task.completedAt !== null,
  ]);
}

function parsedNormalizedTitleKey(task: ParsedTask): string {
  return JSON.stringify([task.depth, normalizeText(task.title)]);
}

function existingNormalizedTitleKey(task: ExistingTask): string {
  return JSON.stringify([
    task.task.parentId === null ? 0 : 1,
    normalizeText(task.task.title),
  ]);
}

function parsedStructuralRawContentKey(task: ParsedTask): string {
  return JSON.stringify([task.title, task.note, task.completed]);
}

function existingStructuralRawContentKey(task: ExistingTask): string {
  return JSON.stringify([
    task.task.title,
    task.task.note,
    task.task.completedAt !== null,
  ]);
}

function parsedStructuralNormalizedContentKey(task: ParsedTask): string {
  return JSON.stringify([
    normalizeText(task.title),
    normalizedNote(task.note),
    task.completed,
  ]);
}

function existingStructuralNormalizedContentKey(task: ExistingTask): string {
  return JSON.stringify([
    normalizeText(task.task.title),
    normalizedNote(task.task.note),
    task.task.completedAt !== null,
  ]);
}

function parsedStructuralTitleKey(task: ParsedTask): string {
  return normalizeText(task.title);
}

function existingStructuralTitleKey(task: ExistingTask): string {
  return normalizeText(task.task.title);
}

function desiredRawGroupKey(task: DesiredTask): string {
  return `${bucketKey(task.bucket)}:${parsedRawContentKey(task.task)}`;
}

function existingRawGroupKey(task: ExistingTask): string {
  return `${bucketKey(task.displayedBucket)}:${existingRawContentKey(task)}`;
}

function groupByExactKey<T>(
  values: readonly T[],
  key: (value: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    const group = groups.get(groupKey) ?? [];
    group.push(value);
    groups.set(groupKey, group);
  }
  return groups;
}

function duplicateGroupsRequireConfirmation<TDesired, TExisting>(
  desired: readonly TDesired[],
  existing: readonly TExisting[],
  desiredKey: (value: TDesired) => string,
  existingKey: (value: TExisting) => string,
  desiredIndex: (value: TDesired) => number,
  existingIndex: (value: TExisting) => number,
): boolean {
  const desiredGroups = groupByExactKey(desired, desiredKey);
  const existingGroups = groupByExactKey(existing, existingKey);
  const keys = new Set([...desiredGroups.keys(), ...existingGroups.keys()]);

  for (const key of keys) {
    const desiredGroup = desiredGroups.get(key) ?? [];
    const existingGroup = existingGroups.get(key) ?? [];
    if (Math.max(desiredGroup.length, existingGroup.length) <= 1) {
      continue;
    }
    if (desiredGroup.length === 0 || existingGroup.length === 0) {
      continue;
    }
    if (desiredGroup.length !== existingGroup.length) {
      return true;
    }
    if (
      desiredGroup.some(
        (candidate, index) =>
          desiredIndex(candidate) !==
          (existingGroup[index] === undefined
            ? undefined
            : existingIndex(existingGroup[index])),
      )
    ) {
      return true;
    }
  }
  return false;
}

function sameNormalizedTitle(existing: ExistingTask, parsed: ParsedTask): boolean {
  return existingNormalizedTitleKey(existing) === parsedNormalizedTitleKey(parsed);
}

function stableCandidate(
  candidates: readonly ExistingTask[],
  index: number,
): ExistingTask | null {
  return candidates.find((candidate) => candidate.index === index) ?? null;
}

function activeTasks(tasks: TaskSnapshot[], referenceDate: LocalDate): ExistingTask[] {
  const existing: ExistingTask[] = [];

  for (const section of projectPlan(tasks, referenceDate).active) {
    let topLevelIndex = 0;
    const childIndexes = new Map<string, number>();
    for (const task of section.tasks) {
      if (task.parentId === null) {
        existing.push({ task, displayedBucket: section.bucket, index: topLevelIndex });
        topLevelIndex += 1;
        continue;
      }

      const childIndex = childIndexes.get(task.parentId) ?? 0;
      existing.push({ task, displayedBucket: section.bucket, index: childIndex });
      childIndexes.set(task.parentId, childIndex + 1);
    }
  }
  return existing;
}

function parsedTasks(parsed: ParsedPlan): {
  all: DesiredTask[];
  topLevel: DesiredTask[];
} {
  const all: DesiredTask[] = [];
  const topLevel: DesiredTask[] = [];
  const topLevelIndexes = new Map<string, number>();

  for (const [sectionIndex, section] of parsed.sections.entries()) {
    let currentParent: DesiredTask | null = null;
    let childIndex = 0;

    for (const [taskIndex, task] of section.tasks.entries()) {
      const desired: DesiredTask = {
        task,
        bucket: section.bucket,
        provisionalId: `new:${String(sectionIndex)}:${String(taskIndex)}`,
        index: 0,
        parent: null,
        children: [],
      };

      if (task.depth === 0) {
        const key = bucketKey(section.bucket);
        desired.index = topLevelIndexes.get(key) ?? 0;
        topLevelIndexes.set(key, desired.index + 1);
        topLevel.push(desired);
        currentParent = desired;
        childIndex = 0;
      } else {
        desired.index = childIndex;
        childIndex += 1;
        desired.parent = currentParent;
        currentParent?.children.push(desired);
      }
      all.push(desired);
    }
  }

  return { all, topLevel };
}

function reserveExactCandidate(
  desired: DesiredTask,
  candidates: readonly ExistingTask[],
  matches: Map<DesiredTask, ExistingTask>,
  usedIds: Set<string>,
): boolean {
  if (candidates.length === 0) {
    return false;
  }
  const atPosition = stableCandidate(candidates, desired.index);
  const selected = atPosition ?? candidates[0];
  if (selected === undefined) {
    return false;
  }
  matches.set(desired, selected);
  usedIds.add(selected.task.id);
  return candidates.length > 1 && atPosition === null;
}

function desiredRawSubtreeKey(parent: DesiredTask): string {
  return JSON.stringify([
    parsedRawContentKey(parent.task),
    parent.children.map(({ task }) => parsedRawContentKey(task)),
  ]);
}

function existingRawSubtreeKey(
  parent: ExistingTask,
  existing: readonly ExistingTask[],
): string {
  return JSON.stringify([
    existingRawContentKey(parent),
    existing
      .filter(({ task }) => task.parentId === parent.task.id)
      .sort((left, right) => left.index - right.index)
      .map(existingRawContentKey),
  ]);
}

function desiredNormalizedSubtreeKey(parent: DesiredTask): string {
  return JSON.stringify([
    parsedNormalizedContentKey(parent.task),
    parent.children.map(({ task }) => parsedNormalizedContentKey(task)),
  ]);
}

function existingNormalizedSubtreeKey(
  parent: ExistingTask,
  existing: readonly ExistingTask[],
): string {
  return JSON.stringify([
    existingNormalizedContentKey(parent),
    existing
      .filter(({ task }) => task.parentId === parent.task.id)
      .sort((left, right) => left.index - right.index)
      .map(existingNormalizedContentKey),
  ]);
}

function fallbackGroupsRequireConfirmation<TDesired, TExisting>(
  desired: readonly TDesired[],
  existing: readonly TExisting[],
  desiredKey: (value: TDesired) => string,
  existingKey: (value: TExisting) => string,
): boolean {
  const desiredGroups = groupByExactKey(desired, desiredKey);
  const existingGroups = groupByExactKey(existing, existingKey);
  for (const [key, desiredGroup] of desiredGroups) {
    const existingGroup = existingGroups.get(key) ?? [];
    if (
      existingGroup.length > 0 &&
      (desiredGroup.length > 1 || existingGroup.length > 1)
    ) {
      return true;
    }
  }
  return false;
}

function cardinalityMismatchRequiresConfirmation<TDesired, TExisting>(
  desired: readonly TDesired[],
  existing: readonly TExisting[],
  desiredKey: (value: TDesired) => string,
  existingKey: (value: TExisting) => string,
): boolean {
  const desiredGroups = groupByExactKey(desired, desiredKey);
  const existingGroups = groupByExactKey(existing, existingKey);
  for (const [key, desiredGroup] of desiredGroups) {
    const existingGroup = existingGroups.get(key) ?? [];
    if (
      desiredGroup.length > 0 &&
      existingGroup.length > 0 &&
      desiredGroup.length !== existingGroup.length
    ) {
      return true;
    }
  }
  return false;
}

function crossBucketTitleGraphRequiresConfirmation(
  desired: readonly DesiredTask[],
  existing: readonly ExistingTask[],
): boolean {
  const existingDegrees = new Map<ExistingTask, number>();
  for (const desiredTask of desired) {
    let desiredDegree = 0;
    for (const existingTask of existing) {
      if (
        sameBucket(existingTask.displayedBucket, desiredTask.bucket) ||
        !sameNormalizedTitle(existingTask, desiredTask.task)
      ) {
        continue;
      }
      desiredDegree += 1;
      const existingDegree = (existingDegrees.get(existingTask) ?? 0) + 1;
      existingDegrees.set(existingTask, existingDegree);
      if (desiredDegree > 1 || existingDegree > 1) {
        return true;
      }
    }
  }
  return false;
}

function reserveTopLevelMatches(
  desired: readonly DesiredTask[],
  existing: readonly ExistingTask[],
  matches: Map<DesiredTask, ExistingTask>,
  usedIds: Set<string>,
  allowPositionalFallback = true,
): boolean {
  const topLevelExisting = existing.filter(({ task }) => task.parentId === null);
  const desiredRawSubtreeGroupKey = (candidate: DesiredTask): string =>
    `${bucketKey(candidate.bucket)}:${desiredRawSubtreeKey(candidate)}`;
  const existingRawSubtreeGroupKey = (candidate: ExistingTask): string =>
    `${bucketKey(candidate.displayedBucket)}:${existingRawSubtreeKey(candidate, existing)}`;
  let ambiguous = duplicateGroupsRequireConfirmation(
    desired,
    topLevelExisting,
    desiredRawSubtreeGroupKey,
    existingRawSubtreeGroupKey,
    ({ index }) => index,
    ({ index }) => index,
  );
  ambiguous =
    ambiguous ||
    cardinalityMismatchRequiresConfirmation(
      desired,
      topLevelExisting,
      desiredRawSubtreeKey,
      (candidate) => existingRawSubtreeKey(candidate, existing),
    );

  // Reserve exact raw parent/child blocks before considering any normalized edit
  // heuristic. This lets a subtree carry its identity through a reorder.
  for (const candidate of desired) {
    if (matches.has(candidate)) {
      continue;
    }
    const exact = existing.filter(
      (existingTask) =>
        existingTask.task.parentId === null &&
        !usedIds.has(existingTask.task.id) &&
        sameBucket(existingTask.displayedBucket, candidate.bucket) &&
        existingRawSubtreeKey(existingTask, existing) ===
          desiredRawSubtreeKey(candidate),
    );
    const exactIsAmbiguous = reserveExactCandidate(candidate, exact, matches, usedIds);
    ambiguous = ambiguous || exactIsAmbiguous;
  }

  for (const candidate of desired) {
    if (matches.has(candidate)) {
      continue;
    }
    const exactAcrossBuckets = topLevelExisting.filter(
      (existingTask) =>
        !usedIds.has(existingTask.task.id) &&
        !sameBucket(existingTask.displayedBucket, candidate.bucket) &&
        existingRawSubtreeKey(existingTask, existing) ===
          desiredRawSubtreeKey(candidate),
    );
    ambiguous = ambiguous || exactAcrossBuckets.length > 1;
    if (exactAcrossBuckets.length === 1) {
      reserveExactCandidate(candidate, exactAcrossBuckets, matches, usedIds);
    }
  }

  // A unique raw parent is stronger evidence than any normalized child-block
  // resemblance. Reserve these identities globally before normalized fallback;
  // equal raw parents remain available for subtree disambiguation below.
  const unmatchedRawParentGroups = groupByExactKey(
    desired.filter((candidate) => !matches.has(candidate)),
    (candidate) => parsedRawContentKey(candidate.task),
  );
  const unusedRawParentGroups = groupByExactKey(
    topLevelExisting.filter(({ task }) => !usedIds.has(task.id)),
    existingRawContentKey,
  );
  for (const candidate of desired) {
    if (matches.has(candidate)) {
      continue;
    }
    const key = parsedRawContentKey(candidate.task);
    const desiredGroup = unmatchedRawParentGroups.get(key) ?? [];
    const existingGroup = unusedRawParentGroups.get(key) ?? [];
    if (desiredGroup.length !== 1 || existingGroup.length !== 1) {
      continue;
    }
    const matched = existingGroup[0];
    if (matched !== undefined && !usedIds.has(matched.task.id)) {
      matches.set(candidate, matched);
      usedIds.add(matched.task.id);
    }
  }

  const unmatchedDesiredForNormalizedSubtrees = desired.filter(
    (candidate) => !matches.has(candidate),
  );
  const unusedExistingForNormalizedSubtrees = topLevelExisting.filter(
    ({ task }) => !usedIds.has(task.id),
  );
  ambiguous =
    ambiguous ||
    fallbackGroupsRequireConfirmation(
      unmatchedDesiredForNormalizedSubtrees,
      unusedExistingForNormalizedSubtrees,
      (candidate) =>
        `${bucketKey(candidate.bucket)}:${desiredNormalizedSubtreeKey(candidate)}`,
      (candidate) =>
        `${bucketKey(candidate.displayedBucket)}:${existingNormalizedSubtreeKey(candidate, existing)}`,
    );

  for (const candidate of desired) {
    if (matches.has(candidate)) {
      continue;
    }
    const normalizedSubtree = topLevelExisting.filter(
      (existingTask) =>
        !usedIds.has(existingTask.task.id) &&
        sameBucket(existingTask.displayedBucket, candidate.bucket) &&
        existingNormalizedSubtreeKey(existingTask, existing) ===
          desiredNormalizedSubtreeKey(candidate),
    );
    const fallbackIsAmbiguous = reserveExactCandidate(
      candidate,
      normalizedSubtree,
      matches,
      usedIds,
    );
    ambiguous = ambiguous || fallbackIsAmbiguous;
  }

  const unmatchedRawParents = desired.filter((candidate) => !matches.has(candidate));
  const unusedRawParents = topLevelExisting.filter(({ task }) => !usedIds.has(task.id));
  ambiguous =
    ambiguous ||
    duplicateGroupsRequireConfirmation(
      unmatchedRawParents,
      unusedRawParents,
      desiredRawGroupKey,
      existingRawGroupKey,
      ({ index }) => index,
      ({ index }) => index,
    );

  for (const candidate of desired) {
    if (matches.has(candidate)) {
      continue;
    }
    const exactParent = topLevelExisting.filter(
      (existingTask) =>
        !usedIds.has(existingTask.task.id) &&
        sameBucket(existingTask.displayedBucket, candidate.bucket) &&
        sameRawContent(existingTask, candidate.task),
    );
    const exactIsAmbiguous = reserveExactCandidate(
      candidate,
      exactParent,
      matches,
      usedIds,
    );
    ambiguous = ambiguous || exactIsAmbiguous;
  }

  const unmatchedDesiredForNormalizedParents = desired.filter(
    (candidate) => !matches.has(candidate),
  );
  const unusedExistingForNormalizedParents = topLevelExisting.filter(
    ({ task }) => !usedIds.has(task.id),
  );
  ambiguous =
    ambiguous ||
    fallbackGroupsRequireConfirmation(
      unmatchedDesiredForNormalizedParents,
      unusedExistingForNormalizedParents,
      (candidate) =>
        `${bucketKey(candidate.bucket)}:${parsedNormalizedContentKey(candidate.task)}`,
      (candidate) =>
        `${bucketKey(candidate.displayedBucket)}:${existingNormalizedContentKey(candidate)}`,
    );

  for (const candidate of desired) {
    if (matches.has(candidate)) {
      continue;
    }
    const normalizedParent = topLevelExisting.filter(
      (existingTask) =>
        !usedIds.has(existingTask.task.id) &&
        sameBucket(existingTask.displayedBucket, candidate.bucket) &&
        sameNormalizedContent(existingTask, candidate.task),
    );
    const fallbackIsAmbiguous = reserveExactCandidate(
      candidate,
      normalizedParent,
      matches,
      usedIds,
    );
    ambiguous = ambiguous || fallbackIsAmbiguous;
  }

  if (allowPositionalFallback) {
    // Structural matches must get the first chance to claim these rows. Only
    // then can the last unmatched row in a bucket or its position be evidence.
    for (const candidate of desired) {
      if (matches.has(candidate)) {
        continue;
      }
      const remainingDesired = desired.filter(
        (other) =>
          !matches.has(other) && sameBucket(other.bucket, candidate.bucket),
      );
      const remainingExisting = topLevelExisting.filter(
        (existingTask) =>
          !usedIds.has(existingTask.task.id) &&
          sameBucket(existingTask.displayedBucket, candidate.bucket),
      );
      if (remainingDesired.length === 1 && remainingExisting.length === 1) {
        const matched = remainingExisting[0];
        if (matched !== undefined) {
          matches.set(candidate, matched);
          usedIds.add(matched.task.id);
        }
      }
    }

    const desiredRawGroups = groupByExactKey(desired, desiredRawGroupKey);
    const existingRawGroups = groupByExactKey(
      topLevelExisting,
      existingRawGroupKey,
    );
    for (const candidate of desired) {
      if (matches.has(candidate)) {
        continue;
      }
      const atPosition = existing.find(
        (existingTask) =>
          existingTask.task.parentId === null &&
          !usedIds.has(existingTask.task.id) &&
          sameBucket(existingTask.displayedBucket, candidate.bucket) &&
          existingTask.index === candidate.index,
      );
      if (atPosition !== undefined) {
        matches.set(candidate, atPosition);
        usedIds.add(atPosition.task.id);
        if (
          (desiredRawGroups.get(desiredRawGroupKey(candidate))?.length ?? 0) > 1 ||
          (existingRawGroups.get(existingRawGroupKey(atPosition))?.length ?? 0) >
            1
        ) {
          ambiguous = true;
        }
      }
    }
  }

  const unmatchedDesiredForCrossBucketTitles = desired.filter(
    (candidate) => !matches.has(candidate),
  );
  const unusedExistingForCrossBucketTitles = topLevelExisting.filter(
    ({ task }) => !usedIds.has(task.id),
  );
  ambiguous =
    ambiguous ||
    crossBucketTitleGraphRequiresConfirmation(
      unmatchedDesiredForCrossBucketTitles,
      unusedExistingForCrossBucketTitles,
    );

  for (const candidate of desired) {
    if (matches.has(candidate)) {
      continue;
    }
    const sameTitleAcrossBuckets = existing.filter(
      (existingTask) =>
        existingTask.task.parentId === null &&
        !usedIds.has(existingTask.task.id) &&
        !sameBucket(existingTask.displayedBucket, candidate.bucket) &&
        sameNormalizedTitle(existingTask, candidate.task),
    );
    if (sameTitleAcrossBuckets.length === 1) {
      const matched = sameTitleAcrossBuckets[0];
      if (matched !== undefined) {
        matches.set(candidate, matched);
        usedIds.add(matched.task.id);
      }
    } else if (sameTitleAcrossBuckets.length > 1) {
      ambiguous = true;
    }
  }

  return ambiguous;
}

function reserveChildMatches(
  parents: readonly DesiredTask[],
  existing: readonly ExistingTask[],
  matches: Map<DesiredTask, ExistingTask>,
  usedIds: Set<string>,
  allowPositionalFallback = true,
): boolean {
  let ambiguous = false;

  for (const parent of parents) {
    const existingParent = matches.get(parent);
    if (existingParent === undefined) {
      continue;
    }
    const siblings = existing.filter(
      ({ task }) => task.parentId === existingParent.task.id,
    );
    const desiredGroups = groupByExactKey(parent.children, desiredRawGroupKey);
    const existingGroups = groupByExactKey(siblings, existingRawGroupKey);
    ambiguous =
      ambiguous ||
      duplicateGroupsRequireConfirmation(
        parent.children,
        siblings,
        desiredRawGroupKey,
        existingRawGroupKey,
        ({ index }) => index,
        ({ index }) => index,
      );

    for (const child of parent.children) {
      const exact = siblings.filter(
        (existingTask) =>
          !usedIds.has(existingTask.task.id) &&
          sameRawContent(existingTask, child.task),
      );
      const exactIsAmbiguous = reserveExactCandidate(
        child,
        exact,
        matches,
        usedIds,
      );
      ambiguous = ambiguous || exactIsAmbiguous;
    }

    const unmatchedChildren = parent.children.filter((child) => !matches.has(child));
    const unusedSiblings = siblings.filter(({ task }) => !usedIds.has(task.id));
    ambiguous =
      ambiguous ||
      fallbackGroupsRequireConfirmation(
        unmatchedChildren,
        unusedSiblings,
        (child) => parsedNormalizedContentKey(child.task),
        existingNormalizedContentKey,
      );

    for (const child of parent.children) {
      if (matches.has(child)) {
        continue;
      }
      const normalized = siblings.filter(
        (existingTask) =>
          !usedIds.has(existingTask.task.id) &&
          sameNormalizedContent(existingTask, child.task),
      );
      const fallbackIsAmbiguous = reserveExactCandidate(
        child,
        normalized,
        matches,
        usedIds,
      );
      ambiguous = ambiguous || fallbackIsAmbiguous;
    }

    if (allowPositionalFallback) {
      for (const child of parent.children) {
        if (matches.has(child)) {
          continue;
        }
        const atPosition = siblings.find(
          (existingTask) =>
            !usedIds.has(existingTask.task.id) &&
            existingTask.index === child.index,
        );
        if (atPosition !== undefined) {
          matches.set(child, atPosition);
          usedIds.add(atPosition.task.id);
          if (
            (desiredGroups.get(desiredRawGroupKey(child))?.length ?? 0) > 1 ||
            (existingGroups.get(existingRawGroupKey(atPosition))?.length ?? 0) > 1
          ) {
            ambiguous = true;
          }
        }
      }
    }
  }

  return ambiguous;
}

function crossesStructuralBoundary(
  desired: DesiredTask,
  existing: ExistingTask,
  matches: ReadonlyMap<DesiredTask, ExistingTask>,
): boolean {
  return (
    desiredParentId(desired, matches) !== existing.task.parentId ||
    !sameBucket(desired.bucket, existing.displayedBucket)
  );
}

function reserveUniqueStructuralGroupMatches(
  desired: readonly DesiredTask[],
  existing: readonly ExistingTask[],
  matches: Map<DesiredTask, ExistingTask>,
  usedIds: Set<string>,
  desiredKey: (task: DesiredTask) => string,
  existingKey: (task: ExistingTask) => string,
): boolean {
  const desiredGroups = groupByExactKey(
    desired.filter((candidate) => !matches.has(candidate)),
    desiredKey,
  );
  const existingGroups = groupByExactKey(
    existing.filter(({ task }) => !usedIds.has(task.id)),
    existingKey,
  );
  let ambiguous = false;

  for (const [key, desiredGroup] of desiredGroups) {
    const existingGroup = existingGroups.get(key) ?? [];
    const structuralPairs = desiredGroup.flatMap((desiredTask) =>
      existingGroup.filter((existingTask) =>
        crossesStructuralBoundary(desiredTask, existingTask, matches),
      ).map((existingTask) => ({ desiredTask, existingTask })),
    );
    if (structuralPairs.length === 0) {
      continue;
    }
    if (desiredGroup.length === 1 && existingGroup.length === 1) {
      const pair = structuralPairs[0];
      if (pair !== undefined) {
        matches.set(pair.desiredTask, pair.existingTask);
        usedIds.add(pair.existingTask.task.id);
      }
    } else {
      ambiguous = true;
    }
  }
  return ambiguous;
}

function reserveStructuralMatches(
  desired: readonly DesiredTask[],
  existing: readonly ExistingTask[],
  matches: Map<DesiredTask, ExistingTask>,
  usedIds: Set<string>,
): boolean {
  let ambiguous = reserveUniqueStructuralGroupMatches(
    desired,
    existing,
    matches,
    usedIds,
    ({ task }) => parsedStructuralRawContentKey(task),
    existingStructuralRawContentKey,
  );
  ambiguous =
    reserveUniqueStructuralGroupMatches(
      desired,
      existing,
      matches,
      usedIds,
      ({ task }) => parsedStructuralNormalizedContentKey(task),
      existingStructuralNormalizedContentKey,
    ) || ambiguous;
  ambiguous =
    reserveUniqueStructuralGroupMatches(
      desired,
      existing,
      matches,
      usedIds,
      ({ task }) => parsedStructuralTitleKey(task),
      existingStructuralTitleKey,
    ) || ambiguous;

  const remainingDesired = desired.filter((candidate) => !matches.has(candidate));
  const remainingExisting = existing.filter(({ task }) => !usedIds.has(task.id));
  const structuralPairs = remainingDesired.flatMap((desiredTask) =>
    remainingExisting
      .filter((existingTask) =>
        crossesStructuralBoundary(desiredTask, existingTask, matches),
      )
      .map((existingTask) => ({ desiredTask, existingTask })),
  );
  if (
    remainingDesired.length === 1 &&
    remainingExisting.length === 1 &&
    structuralPairs.length === 1
  ) {
    const pair = structuralPairs[0];
    if (pair !== undefined) {
      matches.set(pair.desiredTask, pair.existingTask);
      usedIds.add(pair.existingTask.task.id);
    }
  } else if (structuralPairs.length > 0) {
    ambiguous = true;
  }
  return ambiguous;
}

function taskNeedsUpdate(existing: TaskSnapshot, parsed: ParsedTask): boolean {
  return (
    existing.title !== parsed.title ||
    existing.note !== parsed.note ||
    (existing.completedAt !== null) !== parsed.completed
  );
}

function isOverdueTodayProjection(
  task: TaskSnapshot,
  desiredBucket: Bucket,
  referenceDate: LocalDate,
): boolean {
  return (
    task.bucket.kind === "date" &&
    desiredBucket.kind === "date" &&
    desiredBucket.date === referenceDate &&
    compareLocalDate(task.bucket.date, referenceDate) < 0
  );
}

function desiredParentId(
  desired: DesiredTask,
  matches: ReadonlyMap<DesiredTask, ExistingTask>,
): string | null {
  if (desired.parent === null) {
    return null;
  }
  return matches.get(desired.parent)?.task.id ?? desired.parent.provisionalId;
}

function parentDestinationBucket(
  parent: DesiredTask,
  matches: ReadonlyMap<DesiredTask, ExistingTask>,
): Bucket {
  const existingParent = matches.get(parent);
  if (
    existingParent !== undefined &&
    sameBucket(existingParent.displayedBucket, parent.bucket)
  ) {
    return existingParent.task.bucket;
  }
  return parent.bucket;
}

function assignStableChildOrders(
  parents: readonly DesiredTask[],
  existing: readonly ExistingTask[],
  storedTasks: readonly TaskSnapshot[],
  matches: ReadonlyMap<DesiredTask, ExistingTask>,
): void {
  for (const parent of parents) {
    const existingParent = matches.get(parent);
    if (existingParent === undefined) {
      continue;
    }
    const storedSiblings = storedTasks.filter(
      ({ parentId }) => parentId === existingParent.task.id,
    );
    const activeSiblings = existing.filter(
      ({ task }) => task.parentId === existingParent.task.id,
    );
    if (storedSiblings.length === activeSiblings.length) {
      continue;
    }

    const stableSlots = activeSiblings
      .map(({ task }) => task.order)
      .sort((left, right) => left - right);
    let nextOrder =
      storedSiblings.reduce(
        (maximum, task) => Math.max(maximum, task.order),
        -1,
      ) + 1;
    while (stableSlots.length < parent.children.length) {
      stableSlots.push(nextOrder);
      nextOrder += 1;
    }
    stableSlots.sort((left, right) => left - right);
    parent.children.forEach((child, index) => {
      const storedOrder = stableSlots[index];
      if (storedOrder !== undefined) {
        child.storedOrder = storedOrder;
      }
    });
  }
}

function taskState(task: TaskSnapshot): string {
  return JSON.stringify(task);
}

function rawValueState(value: unknown): unknown {
  if (value instanceof Y.Text) {
    return ["Y.Text", value.toDelta()];
  }
  if (value instanceof Y.Map) {
    return [
      "Y.Map",
      [...value.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, rawValueState(nested)]),
    ];
  }
  if (value instanceof Y.Array) {
    return ["Y.Array", value.toArray().map(rawValueState)];
  }
  if (value instanceof Uint8Array) {
    return ["Uint8Array", [...value]];
  }
  if (value instanceof ArrayBuffer) {
    return ["ArrayBuffer", [...new Uint8Array(value)]];
  }
  if (value === undefined) {
    return ["undefined"];
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return ["number", String(value)];
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return [
      "object",
      Object.keys(record)
        .sort()
        .map((key) => [key, rawValueState(record[key])]),
    ];
  }
  return [typeof value, value];
}

function rawTaskState(doc: Y.Doc, id: string): string {
  return JSON.stringify(rawValueState(doc.getMap<unknown>("tasks").get(id)));
}

function containerSignature(
  doc: Y.Doc,
  tasks: readonly TaskSnapshot[],
  bucket: Bucket,
  parentId: string | null,
): string {
  const expectedBucket = bucketKey(bucket);
  return JSON.stringify(
    tasks
      .filter(
        (task) =>
          bucketKey(task.bucket) === expectedBucket &&
          task.parentId === parentId,
      )
      .map((task) => [task.id, rawTaskState(doc, task.id)])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
  );
}

function captureBaseSignatures(
  doc: Y.Doc,
  records: readonly TaskSnapshot[],
  changes: readonly ReconcileChange[],
): {
  baseTaskSignatures: Readonly<Record<string, string>>;
  baseContainerSignatures: readonly ReconcileContainerSignature[];
} {
  const recordsById = new Map(records.map((task) => [task.id, task]));
  const taskIds = new Set<string>();
  const containers = new Map<
    string,
    { bucket: Bucket; parentId: string | null }
  >();
  const addContainer = (bucket: Bucket, parentId: string | null): void => {
    containers.set(JSON.stringify([bucketKey(bucket), parentId]), {
      bucket,
      parentId,
    });
  };
  const addTaskSignature = (id: string): void => {
    if (recordsById.has(id)) {
      taskIds.add(id);
    }
  };

  for (const change of changes) {
    if (change.kind === "create") {
      if (change.parentId !== null && !change.parentId.startsWith("new:")) {
        addTaskSignature(change.parentId);
      }
      continue;
    }
    const before = recordsById.get(change.taskId);
    addTaskSignature(change.taskId);
    if (before === undefined) {
      continue;
    }
    if (change.kind === "update") {
      continue;
    }

    if (change.kind === "move") {
      const rewritesSiblingOrders = !(
        change.storedOrder !== undefined &&
        before.parentId === change.parentId
      );
      if (rewritesSiblingOrders) {
        addContainer(before.bucket, before.parentId);
        addContainer(change.bucket, change.parentId);
      }
      if (change.parentId !== null && !change.parentId.startsWith("new:")) {
        addTaskSignature(change.parentId);
      }
      if (before.parentId === null) {
        for (const child of records) {
          if (child.parentId === before.id) {
            addTaskSignature(child.id);
            if (rewritesSiblingOrders) {
              addContainer(child.bucket, before.id);
              addContainer(change.bucket, before.id);
            }
          }
        }
      }
      continue;
    }

    if (before.parentId === null) {
      for (const child of records) {
        if (child.parentId === before.id) {
          addTaskSignature(child.id);
          addContainer(child.bucket, before.id);
        }
      }
    }
  }

  const baseTaskSignatures = Object.fromEntries(
    [...taskIds]
      .sort()
      .map((id) => [id, rawTaskState(doc, id)]),
  );
  const baseContainerSignatures = [...containers.values()]
    .sort((left, right) =>
      JSON.stringify([bucketKey(left.bucket), left.parentId]).localeCompare(
        JSON.stringify([bucketKey(right.bucket), right.parentId]),
      ),
    )
    .map(({ bucket, parentId }) => ({
      bucket,
      parentId,
      signature: containerSignature(doc, records, bucket, parentId),
    }));
  return { baseContainerSignatures, baseTaskSignatures };
}

export function buildReconcilePreview(
  doc: Y.Doc,
  parsed: ParsedPlan,
  referenceDate: LocalDate,
): ReconcilePreview {
  const baseSnapshot = snapshotPlan(doc);
  const storedTasks = baseSnapshot.tasks;
  const projection = projectPlan(storedTasks, referenceDate);
  const existing = activeTasks(storedTasks, referenceDate);
  const desired = parsedTasks(parsed);
  const matches = new Map<DesiredTask, ExistingTask>();
  const usedIds = new Set<string>();
  const changes: ReconcileChange[] = [];
  let ambiguous = reserveTopLevelMatches(
    desired.topLevel,
    existing,
    matches,
    usedIds,
    false,
  );
  const childMatchesAreAmbiguous = reserveChildMatches(
    desired.topLevel,
    existing,
    matches,
    usedIds,
    false,
  );
  ambiguous = ambiguous || childMatchesAreAmbiguous;
  ambiguous =
    reserveStructuralMatches(desired.all, existing, matches, usedIds) ||
    ambiguous;
  ambiguous =
    reserveTopLevelMatches(
      desired.topLevel,
      existing,
      matches,
      usedIds,
      true,
    ) || ambiguous;
  ambiguous =
    reserveChildMatches(
      desired.topLevel,
      existing,
      matches,
      usedIds,
      false,
    ) || ambiguous;
  ambiguous =
    reserveStructuralMatches(desired.all, existing, matches, usedIds) ||
    ambiguous;
  ambiguous =
    reserveChildMatches(
      desired.topLevel,
      existing,
      matches,
      usedIds,
      true,
    ) || ambiguous;
  assignStableChildOrders(desired.topLevel, existing, storedTasks, matches);

  for (const candidate of desired.all) {
    const matched = matches.get(candidate);
    if (matched === undefined) {
      changes.push({
        kind: "create",
        provisionalId: candidate.provisionalId,
        task: candidate.task,
        bucket: candidate.bucket,
        parentId: desiredParentId(candidate, matches),
        index: candidate.index,
        ...(candidate.storedOrder === undefined
          ? {}
          : { storedOrder: candidate.storedOrder }),
      });
      continue;
    }

    if (taskNeedsUpdate(matched.task, candidate.task)) {
      changes.push({
        kind: "update",
        taskId: matched.task.id,
        task: candidate.task,
      });
    }

    if (candidate.parent === null) {
      if (
        matched.task.parentId !== null ||
        !isOverdueTodayProjection(matched.task, candidate.bucket, referenceDate) &&
        (!sameBucket(matched.displayedBucket, candidate.bucket) ||
          matched.index !== candidate.index)
      ) {
        const destinationBucket = sameBucket(
          matched.displayedBucket,
          candidate.bucket,
        )
          ? matched.task.bucket
          : candidate.bucket;
        changes.push({
          kind: "move",
          taskId: matched.task.id,
          bucket: destinationBucket,
          parentId: null,
          index: candidate.index,
        });
      }
      continue;
    }

    const parentId = matches.get(candidate.parent)?.task.id;
    if (parentId === undefined) {
      throw new Error("matched_child_without_matched_parent");
    }
    const destinationBucket = parentDestinationBucket(candidate.parent, matches);
    const existingParent = matches.get(candidate.parent);
    const parentCarriesChildAcrossBuckets =
      existingParent !== undefined &&
      matched.task.parentId === existingParent.task.id &&
      !sameBucket(existingParent.displayedBucket, candidate.parent.bucket);
    if (
      matched.task.parentId !== parentId ||
      (!parentCarriesChildAcrossBuckets &&
        !sameBucket(matched.task.bucket, destinationBucket)) ||
      (candidate.storedOrder === undefined
        ? matched.index !== candidate.index
        : matched.task.order !== candidate.storedOrder)
    ) {
      changes.push({
        kind: "move",
        taskId: matched.task.id,
        bucket: destinationBucket,
        parentId,
        index: candidate.index,
        ...(candidate.storedOrder === undefined
          ? {}
          : { storedOrder: candidate.storedOrder }),
      });
    }
  }

  for (const { task } of existing) {
    if (!usedIds.has(task.id)) {
      changes.push({ kind: "remove", taskId: task.id });
    }
  }

  const removedParentIds = new Set(
    changes
      .filter(
        (change): change is Extract<ReconcileChange, { kind: "remove" }> =>
          change.kind === "remove",
      )
      .map(({ taskId }) => storedTasks.find(({ id }) => id === taskId))
      .filter(
        (task): task is TaskSnapshot => task !== undefined && task.parentId === null,
      )
      .map(({ id }) => id),
  );
  const historyIds = new Set(projection.history.map(({ id }) => id));
  const storedTasksById = new Map(storedTasks.map((task) => [task.id, task]));
  const hiddenCascadeRemovals: ReconcileChange[] = projection.history.flatMap(
    (task) => {
      const parentId = task.parentId;
      if (
        parentId === null ||
        !removedParentIds.has(parentId) ||
        historyIds.has(parentId)
      ) {
        return [];
      }
      const parent = storedTasksById.get(parentId);
      if (parent === undefined) {
        throw new Error(`hidden_cascade_parent_not_found:${parentId}`);
      }
      return [
        {
          kind: "remove" as const,
          taskId: task.id,
          hiddenCascade: {
            parentId,
            title: task.title,
            referenceDate,
            taskState: taskState(task),
            parentState: taskState(parent),
          },
        },
      ];
    },
  );
  changes.push(...hiddenCascadeRemovals);

  const removalCount = changes.filter(({ kind }) => kind === "remove").length;
  const topLevelCount = existing.filter(({ task }) => task.parentId === null).length;
  const destructive =
    hiddenCascadeRemovals.length > 0 ||
    removalCount >= 3 ||
    (topLevelCount > 0 && removalCount / topLevelCount >= 0.25);
  const hasErrorDiagnostics = parsed.diagnostics.some(
    ({ severity }) => severity === "error",
  );
  const baseSignatures = captureBaseSignatures(
    doc,
    baseSnapshot.records,
    changes,
  );

  return {
    source: parsed.source,
    diagnostics: [...parsed.diagnostics],
    changes,
    destructive,
    requiresConfirmation: destructive || hasErrorDiagnostics || ambiguous,
    ...baseSignatures,
  };
}

function resolveParentId(
  parentId: string | null,
  provisionalIds: ReadonlyMap<string, string>,
): string | null {
  if (parentId === null || !parentId.startsWith("new:")) {
    return parentId;
  }
  const resolved = provisionalIds.get(parentId);
  if (resolved === undefined) {
    throw new Error(`unresolved_provisional_parent:${parentId}`);
  }
  return resolved;
}

type RemoveChange = Extract<ReconcileChange, { kind: "remove" }>;
type CreateChange = Extract<ReconcileChange, { kind: "create" }>;
type UpdateChange = Extract<ReconcileChange, { kind: "update" }>;
type MoveChange = Extract<ReconcileChange, { kind: "move" }>;

interface MaterializedCreate {
  change: CreateChange;
  id: string;
}

interface ConcreteReconcileChanges {
  removals: RemoveChange[];
  creates: MaterializedCreate[];
  updates: UpdateChange[];
  moves: MoveChange[];
}

function replayReconcileChanges(
  doc: Y.Doc,
  changes: ConcreteReconcileChanges,
  options: Omit<
    ApplyReconcileOptions,
    "idFactory" | "confirmDiagnostics" | "confirmRisky"
  >,
): void {
  const tasksBeforeApply = new Map(
    snapshotPlan(doc).records.map((task) => [task.id, task]),
  );
  const provisionalIds = new Map<string, string>();
  const removalIds = new Set(changes.removals.map(({ taskId }) => taskId));
  const structurallyMovedIds = new Set(
    changes.moves
      .filter((change) => {
        const before = tasksBeforeApply.get(change.taskId);
        return before !== undefined && before.parentId !== change.parentId;
      })
      .map(({ taskId }) => taskId),
  );

  for (const task of tasksBeforeApply.values()) {
    if (
      task.parentId !== null &&
      removalIds.has(task.parentId) &&
      !removalIds.has(task.id) &&
      !structurallyMovedIds.has(task.id)
    ) {
      throw new Error(`reconcile_unreported_cascade:${task.id}`);
    }
  }

  doc.transact(() => {
    for (const { change, id } of changes.creates) {
      provisionalIds.set(change.provisionalId, id);
      addTask(doc, {
        id,
        title: change.task.title,
        note: change.task.note,
        bucket: change.bucket,
        parentId: resolveParentId(change.parentId, provisionalIds),
        order: change.storedOrder ?? change.index,
        now: options.now,
      });
      if (change.task.completed) {
        setTaskCompleted(doc, id, {
          completed: true,
          at: options.now,
          on: options.completedOn,
        });
      }
    }

    for (const change of changes.updates) {
      const before = tasksBeforeApply.get(change.taskId);
      if (before === undefined) {
        throw new Error(`reconcile_task_not_found:${change.taskId}`);
      }
      editTask(doc, change.taskId, {
        title: change.task.title,
        note: change.task.note,
      });
      if ((before.completedAt !== null) !== change.task.completed) {
        setTaskCompleted(doc, change.taskId, {
          completed: change.task.completed,
          at: options.now,
          on: options.completedOn,
        });
      }
    }

    for (const change of changes.moves) {
      const before = tasksBeforeApply.get(change.taskId);
      if (before === undefined) {
        throw new Error(`reconcile_task_not_found:${change.taskId}`);
      }
      const currentBefore = snapshotPlan(doc).records.find(
        ({ id }) => id === change.taskId,
      );
      if (currentBefore === undefined) {
        throw new Error(`reconcile_task_not_found:${change.taskId}`);
      }
      const parentId = resolveParentId(change.parentId, provisionalIds);
      const reorderOnly =
        before.parentId === parentId && sameBucket(before.bucket, change.bucket);
      if (
        change.storedOrder !== undefined &&
        currentBefore.parentId === parentId &&
        sameBucket(currentBefore.bucket, change.bucket)
      ) {
        setTaskOrder(
          doc,
          change.taskId,
          change.storedOrder,
          reorderOnly ? before.updatedAt : options.now,
        );
        continue;
      }
      const destination = {
        bucket: change.bucket,
        parentId,
        index: change.index,
        now: reorderOnly ? before.updatedAt : options.now,
      };
      if (currentBefore.parentId !== null && parentId === null) {
        promoteSubtask(doc, change.taskId, destination);
      } else if (parentId !== null && currentBefore.parentId !== parentId) {
        reparentTask(doc, change.taskId, destination);
      } else {
        moveTask(doc, change.taskId, destination);
      }
    }

    for (const change of [...changes.removals].sort((left, right) => {
      const leftIsChild = tasksBeforeApply.get(left.taskId)?.parentId !== null;
      const rightIsChild = tasksBeforeApply.get(right.taskId)?.parentId !== null;
      return Number(rightIsChild) - Number(leftIsChild);
    })) {
      removeTask(doc, change.taskId, { at: options.now, on: options.completedOn });
    }
  });
}

function validateHiddenCascadeAnnotations(
  doc: Y.Doc,
  changes: readonly ReconcileChange[],
): void {
  const tasks = snapshotPlan(doc).tasks;
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const historyByDate = new Map<LocalDate, Set<string>>();

  for (const change of changes) {
    if (change.kind !== "remove" || change.hiddenCascade === undefined) {
      continue;
    }
    const annotation = change.hiddenCascade;
    const task = tasksById.get(change.taskId);
    const parent = tasksById.get(annotation.parentId);
    let historyIds = historyByDate.get(annotation.referenceDate);
    if (historyIds === undefined) {
      historyIds = new Set(
        projectPlan(tasks, annotation.referenceDate).history.map(({ id }) => id),
      );
      historyByDate.set(annotation.referenceDate, historyIds);
    }
    if (
      task === undefined ||
      parent === undefined ||
      task.parentId !== annotation.parentId ||
      taskState(task) !== annotation.taskState ||
      taskState(parent) !== annotation.parentState ||
      !historyIds.has(task.id) ||
      historyIds.has(parent.id)
    ) {
      throw new Error(`reconcile_stale_cascade:${change.taskId}`);
    }
  }
}

function validatePreviewBaseSignatures(
  doc: Y.Doc,
  preview: ReconcilePreview,
): void {
  const current = snapshotPlan(doc).records;
  const currentById = new Map(current.map((task) => [task.id, task]));
  for (const [id, signature] of Object.entries(preview.baseTaskSignatures)) {
    const task = currentById.get(id);
    if (task === undefined) {
      throw new StaleReconcilePreviewError(`task_not_found:${id}`);
    }
    const rawSignature = rawTaskState(doc, id);
    if (task.deleted && rawSignature !== signature) {
      throw new StaleReconcilePreviewError(`task_not_found:${id}`);
    }
    if (rawSignature !== signature) {
      throw new StaleReconcilePreviewError(`task_changed:${id}`);
    }
  }

  const removedParentIds = new Set(
    preview.changes
      .filter(
        (change): change is RemoveChange => change.kind === "remove",
      )
      .map(({ taskId }) => taskId)
      .filter((id) => currentById.get(id)?.parentId === null),
  );
  const knownIds = new Set(Object.keys(preview.baseTaskSignatures));
  for (const task of current) {
    if (
      task.parentId !== null &&
      removedParentIds.has(task.parentId) &&
      !knownIds.has(task.id)
    ) {
      throw new StaleReconcilePreviewError(
        `reconcile_unreported_cascade:${task.id}`,
      );
    }
  }

  for (const container of preview.baseContainerSignatures) {
    if (
      containerSignature(doc, current, container.bucket, container.parentId) !==
      container.signature
    ) {
      throw new StaleReconcilePreviewError(
        `container_changed:${bucketKey(container.bucket)}:${
          container.parentId ?? "root"
        }`,
      );
    }
  }
}

export function applyReconcilePreview(
  doc: Y.Doc,
  preview: ReconcilePreview,
  options: ApplyReconcileOptions,
): void {
  if (
    preview.diagnostics.some(
      ({ code }) => code === "legacy_near_section_overflow",
    )
  ) {
    throw new Error("reconcile_blocking_diagnostic");
  }
  const hasErrorDiagnostics = preview.diagnostics.some(
    ({ severity }) => severity === "error",
  );
  if (hasErrorDiagnostics && options.confirmDiagnostics !== true) {
    throw new Error("reconcile_diagnostics_require_confirmation");
  }
  const hasHiddenCascade = preview.changes.some(
    (change) => change.kind === "remove" && change.hiddenCascade !== undefined,
  );
  if (hasHiddenCascade && options.confirmRisky !== true) {
    throw new Error("reconcile_risky_changes_require_confirmation");
  }
  try {
    validateHiddenCascadeAnnotations(doc, preview.changes);
  } catch (reason: unknown) {
    if (reason instanceof Error) {
      throw new StaleReconcilePreviewError(reason.message);
    }
    throw reason;
  }
  validatePreviewBaseSignatures(doc, preview);

  const removals = preview.changes.filter(
    (change): change is RemoveChange =>
      change.kind === "remove",
  );
  const creates = preview.changes.filter(
    (change): change is CreateChange =>
      change.kind === "create",
  );
  const updates = preview.changes.filter(
    (change): change is UpdateChange =>
      change.kind === "update",
  );
  const moves = preview.changes.filter(
    (change): change is MoveChange =>
      change.kind === "move",
  );
  const concreteChanges: ConcreteReconcileChanges = {
    removals,
    creates: creates.map((change) => ({ change, id: options.idFactory() })),
    updates,
    moves,
  };
  const replayOptions = {
    completedOn: options.completedOn,
    now: options.now,
  };
  const preflightDoc = new Y.Doc();
  try {
    Y.applyUpdate(preflightDoc, Y.encodeStateAsUpdate(doc));
    replayReconcileChanges(preflightDoc, concreteChanges, replayOptions);
  } finally {
    preflightDoc.destroy();
  }

  replayReconcileChanges(doc, concreteChanges, replayOptions);
}
