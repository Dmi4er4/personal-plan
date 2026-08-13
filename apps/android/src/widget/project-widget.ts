import type { ProjectedPlan } from "@personal-plan/core";
import type { WidgetSnapshot } from "./contracts";

const ruDays = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function labels(bucket: ProjectedPlan["active"][number]["bucket"], today: string): [string, string | null] {
  if (bucket.kind === "later") return ["Позже", null];
  if (bucket.kind === "much-later") return ["Сильно позже", null];
  const date = new Date(`${bucket.date}T12:00:00Z`);
  const offset = Math.round((Date.parse(`${bucket.date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  const primary = offset === 0 ? "Сегодня" : offset === 1 ? "Завтра" : (ruDays[date.getUTCDay()] ?? "");
  return [primary, `${date.getUTCDate()}.${String(date.getUTCMonth() + 1).padStart(2, "0")}`];
}

export function projectWidget(projected: ProjectedPlan, today: string, syncState: WidgetSnapshot["syncState"], generatedAt = new Date().toISOString()): WidgetSnapshot {
  return { version: 1, generatedAt, syncState, sections: projected.active.filter((section) => section.tasks.length > 0).map((section) => {
    const [primaryLabel, secondaryLabel] = labels(section.bucket, today);
    return { key: section.bucket.kind === "date" ? section.bucket.date : section.bucket.kind, primaryLabel, secondaryLabel, farSection: section.bucket.kind === "later", muchLaterDivider: section.bucket.kind === "much-later", tasks: section.tasks.map((task) => ({ id: task.id, title: task.title, note: task.note, completed: task.effectiveCompleted, depth: task.parentId === null ? 0 : 1 })) };
  }) };
}
