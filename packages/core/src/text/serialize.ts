import type { LocalDate, TaskSnapshot } from "../model/types.js";
import type { ProjectedPlan } from "../time/project.js";
import { formatSectionHeading, parseSectionHeading } from "./headings.js";

function encodeField(value: string): string {
  let encoded = "";
  for (const character of value) {
    if (character === "\\") encoded += "\\\\";
    else if (character === "\n") encoded += "\\n";
    else if (character === "\r") encoded += "\\r";
    else if (character === "\t") encoded += "\\t";
    else if (character !== " " && character.trim().length === 0) {
      encoded += `\\u{${character.codePointAt(0)?.toString(16) ?? "0"}}`;
    } else encoded += character;
  }
  return encoded;
}

function encodeTitle(value: string): string {
  const encoded = encodeField(value).replaceAll(": ", "\\: ");
  return encoded.startsWith("+ ") || encoded.startsWith(" ")
    ? `\\${encoded}`
    : encoded;
}

function isStructuralLine(value: string, referenceDate: LocalDate): boolean {
  return /^-{4,}$/u.test(value) || parseSectionHeading(value, referenceDate) !== null;
}

function serializeTask(task: TaskSnapshot, referenceDate: LocalDate): string {
  const indentation = task.parentId === null ? "" : "  ";
  const completion = task.completedAt === null ? "" : "+ ";
  let title = encodeTitle(task.title);
  const note = task.note === null ? "" : `: ${encodeField(task.note)}`;
  if (
    indentation.length === 0 &&
    completion.length === 0 &&
    isStructuralLine(`${title}${note}`, referenceDate)
  ) {
    title = `\\${title}`;
  }
  return `${indentation}${completion}${title}${note}`;
}

export function serializePlan(plan: ProjectedPlan, referenceDate: LocalDate): string {
  const blocks: string[] = [];
  let emittedFarDivider = false;

  for (const section of plan.active) {
    if (section.tasks.length === 0) {
      continue;
    }

    const lines = [
      formatSectionHeading(section.bucket, referenceDate),
      ...section.tasks.map((task) => serializeTask(task, referenceDate)),
    ];
    const isFar = section.bucket.kind === "later" || section.bucket.kind === "much-later";
    if (isFar && !emittedFarDivider) {
      lines.unshift("--------");
      emittedFarDivider = true;
    }
    blocks.push(lines.join("\n"));
  }

  return blocks.join("\n\n");
}
