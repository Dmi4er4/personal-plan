import { addDays, type LocalDate, type TaskSnapshot } from "@personal-plan/core";

export interface HistoryBlock {
  root: TaskSnapshot;
  tasks: TaskSnapshot[];
  date: LocalDate;
}

export interface HistoryGroup {
  date: LocalDate;
  blocks: HistoryBlock[];
}

function historyDate(task: TaskSnapshot): LocalDate | null {
  return task.deleted ? task.deletedOn : task.completedOn;
}

function matches(block: HistoryBlock, query: string): boolean {
  if (query.length === 0) return true;
  return block.tasks.some((task) =>
    task.title.toLowerCase().includes(query) ||
    (task.note?.toLowerCase().includes(query) ?? false),
  );
}

export function buildHistoryGroups(
  history: readonly TaskSnapshot[],
  query: string,
): HistoryGroup[] {
  const historyIds = new Set(history.map(({ id }) => id));
  const blocks: HistoryBlock[] = [];
  const blocksByRootId = new Map<string, HistoryBlock>();

  for (const task of history) {
    if (task.parentId !== null && historyIds.has(task.parentId)) {
      const parentBlock = blocksByRootId.get(task.parentId);
      if (parentBlock !== undefined) {
        parentBlock.tasks.push(task);
        continue;
      }
    }
    const date = historyDate(task);
    if (date === null) continue;
    const block = { root: task, tasks: [task], date };
    blocks.push(block);
    blocksByRootId.set(task.id, block);
  }

  const normalizedQuery = query.trim().toLowerCase();
  const groups: HistoryGroup[] = [];
  const groupsByDate = new Map<LocalDate, HistoryGroup>();
  for (const block of blocks) {
    if (!matches(block, normalizedQuery)) continue;
    let group = groupsByDate.get(block.date);
    if (group === undefined) {
      group = { date: block.date, blocks: [] };
      groupsByDate.set(block.date, group);
      groups.push(group);
    }
    group.blocks.push(block);
  }
  return groups;
}

export function historyDateLabel(date: LocalDate, today: LocalDate): string {
  if (date === today) return "Сегодня";
  if (date === addDays(today, -1)) return "Вчера";
  const parsed = new Date(`${date}T12:00:00Z`);
  return `${parsed.getUTCDate()}.${String(parsed.getUTCMonth() + 1).padStart(2, "0")}.${String(parsed.getUTCFullYear())}`;
}
