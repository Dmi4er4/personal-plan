import { isLocalDate, type LocalDate } from "../model/types.js";
import { addDays } from "./local-date.js";

export const PLAN_DAY_START_HOUR = 4;

/** The hours after midnight belong to the previous planning day. */
export function getPlanDate(now = new Date()): LocalDate {
  const date = `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (!isLocalDate(date)) {
    throw new RangeError("invalid_plan_time");
  }
  return now.getHours() < PLAN_DAY_START_HOUR ? addDays(date, -1) : date;
}

export function millisecondsUntilNextPlanDay(now: Date): number {
  const next = new Date(now.getTime());
  next.setHours(PLAN_DAY_START_HOUR, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return Math.max(1, next.getTime() - now.getTime());
}

/** Refresh on resume as well, since suspended clients can miss their timer. */
export function startPlanDayClock(
  onChange: (date: LocalDate) => void,
  { clock = () => new Date(), today = () => getPlanDate(clock()) }: {
    clock?: () => Date;
    today?: () => LocalDate;
  } = {},
): { refresh: () => void; stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const refresh = (): void => {
    if (stopped) return;
    clearTimeout(timer);
    onChange(today());
    timer = setTimeout(refresh, millisecondsUntilNextPlanDay(clock()));
  };
  refresh();
  return {
    refresh,
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
