import * as Y from "yjs";
import { snapshotPlan } from "../model/schema.js";
import type { LocalDate } from "../model/types.js";
import { localDateToUtcNoon } from "./local-date.js";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function pruneExpiredHistory(doc: Y.Doc, today: LocalDate): void {
  const todayDate = localDateToUtcNoon(today);
  const todayDay = todayDate.getTime() / MILLISECONDS_PER_DAY;
  const tasks = snapshotPlan(doc).records;
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const isExpired = (completedOn: LocalDate | null): boolean =>
    completedOn !== null &&
    todayDay - localDateToUtcNoon(completedOn).getTime() / MILLISECONDS_PER_DAY > 30;
  const expiredParentIds = tasks
    .filter(
      (task) =>
        !task.deleted &&
        task.prunedOn === null &&
        task.parentId === null &&
        task.completedAt !== null &&
        isExpired(task.completedOn),
    )
    .map(({ id }) => id);
  const expiredParentIdSet = new Set(expiredParentIds);
  const expiredChildIds = tasks
    .filter((task) => {
      if (
        task.parentId === null ||
        task.deleted ||
        task.prunedOn !== null ||
        task.completedAt === null ||
        !isExpired(task.completedOn) ||
        expiredParentIdSet.has(task.parentId)
      ) {
        return false;
      }
      return tasksById.get(task.parentId)?.completedAt === null;
    })
    .map(({ id }) => id);

  const idsToPrune = new Set(expiredChildIds);
  for (const parentId of expiredParentIds) {
    idsToPrune.add(parentId);
    for (const task of tasks) {
      if (task.parentId === parentId) {
        idsToPrune.add(task.id);
      }
    }
  }
  if (idsToPrune.size === 0) {
    return;
  }
  doc.transact(() => {
    const taskMap = doc.getMap<unknown>("tasks");
    for (const id of idsToPrune) {
      const value = taskMap.get(id);
      if (value instanceof Y.Map) {
        value.set("prunedOn", today);
      }
    }
  });
}
