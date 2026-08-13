import { addDays as addCalendarDays } from "date-fns";
import type { LocalDate } from "../model/types.js";

export class InvalidLocalDateError extends RangeError {
  constructor(readonly value: string) {
    super(`invalid_local_date:${value}`);
    this.name = "InvalidLocalDateError";
  }
}

function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function isLocalDate(value: string): value is LocalDate {
  return parseLocalDate(value) !== null;
}

export function localDateToUtcNoon(value: LocalDate): Date {
  const date = parseLocalDate(value);
  if (date === null) {
    throw new InvalidLocalDateError(value);
  }
  return date;
}

function formatLocalDate(date: Date): LocalDate {
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError("local_date_out_of_range");
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const value = `${String(year).padStart(4, "0")}-${month}-${day}`;
  if (!isLocalDate(value)) {
    throw new RangeError("local_date_out_of_range");
  }
  return value;
}

export function addDays(date: LocalDate, count: number): LocalDate {
  const parsedDate = localDateToUtcNoon(date);
  if (!Number.isFinite(count) || !Number.isInteger(count)) {
    throw new RangeError(`invalid_day_count:${String(count)}`);
  }
  return formatLocalDate(addCalendarDays(parsedDate, count));
}

export function compareLocalDate(left: LocalDate, right: LocalDate): number {
  return Math.sign(
    localDateToUtcNoon(left).getTime() - localDateToUtcNoon(right).getTime(),
  );
}
