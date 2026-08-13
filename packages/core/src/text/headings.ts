import { ru } from "date-fns/locale";
import type { Bucket, LocalDate } from "../model/types.js";
import { addDays, compareLocalDate, localDateToUtcNoon } from "../time/local-date.js";
import type { HeadingDiagnostic } from "./types.js";

export type SectionHeadingParseResult = Bucket | HeadingDiagnostic | null;

const DAYS_IN_HORIZON = 7;
const MONTH_INDEXES: readonly [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
];
const DAY_INDEXES: readonly [0, 1, 2, 3, 4, 5, 6] = [0, 1, 2, 3, 4, 5, 6];

const monthNames = MONTH_INDEXES.map((month) =>
  ru.localize.month(month, {
    width: "wide",
    context: "formatting",
  }),
);
const dayNames = DAY_INDEXES.map((day) => ({
  short: ru.localize.day(day, { width: "short" }),
  wide: ru.localize.day(day, { width: "wide" }),
}));

function dayName(day: number, width: "short" | "wide"): string {
  const names = dayNames[day];
  if (names === undefined) {
    throw new RangeError(`invalid_weekday:${String(day)}`);
  }
  return names[width];
}

function monthName(month: number): string {
  const name = monthNames[month];
  if (name === undefined) {
    throw new RangeError(`invalid_month:${String(month)}`);
  }
  return name;
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function invalidDateHeading(message: string): HeadingDiagnostic {
  return {
    code: "invalid_date_heading",
    severity: "error",
    message,
  };
}

function unrecognizedHeading(message: string): HeadingDiagnostic {
  return {
    code: "unrecognized_heading",
    severity: "error",
    message,
  };
}

function headingParts(date: LocalDate, offset: number): {
  label: string;
  weekday: string;
  day: number;
  month: string;
} {
  const parsed = localDateToUtcNoon(date);
  const weekdayIndex = parsed.getUTCDay();
  const label =
    offset === 0
      ? "Сегодня"
      : offset === 1
        ? "Завтра"
        : capitalize(dayName(weekdayIndex, "wide"));

  return {
    label,
    weekday: dayName(weekdayIndex, "short"),
    day: parsed.getUTCDate(),
    month: monthName(parsed.getUTCMonth()),
  };
}

function offsetInsideHorizon(date: LocalDate, referenceDate: LocalDate): number | null {
  for (let offset = 0; offset < DAYS_IN_HORIZON; offset += 1) {
    if (compareLocalDate(date, addDays(referenceDate, offset)) === 0) {
      return offset;
    }
  }
  return null;
}

export function formatSectionHeading(bucket: Bucket, referenceDate: LocalDate): string {
  if (bucket.kind === "later") {
    return "Позже";
  }
  if (bucket.kind === "much-later") {
    return "Сильно позже";
  }

  const offset = offsetInsideHorizon(bucket.date, referenceDate);
  if (offset === null) {
    throw new RangeError(`date_heading_outside_horizon:${bucket.date}`);
  }
  const parts = headingParts(bucket.date, offset);
  return `${parts.label} — ${parts.weekday}, ${String(parts.day)} ${parts.month}`;
}

function dateInHorizon(day: number, month: number, referenceDate: LocalDate): {
  date: LocalDate;
  offset: number;
} | null {
  for (let offset = 0; offset < DAYS_IN_HORIZON; offset += 1) {
    const date = addDays(referenceDate, offset);
    const parsed = localDateToUtcNoon(date);
    if (parsed.getUTCDate() === day && parsed.getUTCMonth() === month) {
      return { date, offset };
    }
  }
  return null;
}

export function parseSectionHeading(
  line: string,
  referenceDate: LocalDate,
): SectionHeadingParseResult {
  if (line === "Позже") {
    return { kind: "later" };
  }
  if (line === "Сильно позже") {
    return { kind: "much-later" };
  }

  const match = /^(.+?) — ([^,]+), (\d{1,2}) (\S+)$/u.exec(line);
  // «Послезавтра» is a natural alias for the offset-2 day heading.
  const knownLabels = [
    "Сегодня",
    "Завтра",
    "Послезавтра",
    ...Array.from({ length: 7 }, (_, day) => capitalize(dayName(day, "wide"))),
  ];
  const startsLikeKnownDateHeading = knownLabels.some(
    (label) =>
      line.startsWith(`${label} —`) ||
      line.startsWith(`${label} –`) ||
      line.startsWith(`${label} -`),
  );

  if (match === null) {
    if (startsLikeKnownDateHeading) {
      return invalidDateHeading("Malformed explicit date heading");
    }
    return null;
  }

  const [, label = "", weekday = "", dayText = "", monthName = ""] = match;
  if (!knownLabels.includes(label)) {
    return unrecognizedHeading("Unrecognized section heading");
  }

  const month = monthNames.indexOf(monthName);
  const day = Number(dayText);
  if (month === -1 || !Number.isInteger(day) || day < 1 || day > 31) {
    return invalidDateHeading("Invalid calendar date in section heading");
  }

  const inferred = dateInHorizon(day, month, referenceDate);
  if (inferred === null) {
    return invalidDateHeading("Section date is outside the seven-day horizon");
  }

  const expected = headingParts(inferred.date, inferred.offset);
  const labelMatches = label === "Послезавтра"
    ? inferred.offset === 2
    : label === expected.label;
  if (!labelMatches || weekday !== expected.weekday) {
    return invalidDateHeading("Section label or weekday does not agree with its date");
  }

  return { kind: "date", date: inferred.date };
}

export function isHeadingDiagnostic(
  result: Exclude<SectionHeadingParseResult, null>,
): result is HeadingDiagnostic {
  return "code" in result;
}
