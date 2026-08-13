import type { LocalDate } from "../model/types.js";
import { isHeadingDiagnostic, parseSectionHeading } from "./headings.js";
import type {
  ParseDiagnostic,
  ParsedPlan,
  ParsedSection,
  ParsedTask,
} from "./types.js";

function diagnostic(
  line: number,
  code: ParseDiagnostic["code"],
  message: string,
): ParseDiagnostic {
  return { line, code, severity: "error", message };
}

function firstUnescapedNoteSeparator(content: string): number {
  for (let index = 0; index < content.length - 1; index += 1) {
    if (content[index] === "\\") {
      index += 1;
      continue;
    }
    if (content[index] === ":" && content[index + 1] === " ") {
      return index;
    }
  }
  return -1;
}

function decodeField(value: string, decodeColon: boolean): string {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (character !== "\\" || index === value.length - 1) {
      decoded += character;
      continue;
    }

    const escaped = value[index + 1] ?? "";
    if (escaped === "\\") {
      decoded += "\\";
      index += 1;
    } else if (escaped === "n") {
      decoded += "\n";
      index += 1;
    } else if (escaped === "r") {
      decoded += "\r";
      index += 1;
    } else if (escaped === "t") {
      decoded += "\t";
      index += 1;
    } else if (escaped === "u") {
      const unicodeEscape = /^u\{([0-9a-f]{1,6})\}/iu.exec(value.slice(index + 1));
      const codePoint = unicodeEscape === null ? Number.NaN : Number.parseInt(unicodeEscape[1] ?? "", 16);
      if (unicodeEscape !== null && codePoint <= 0x10ffff) {
        decoded += String.fromCodePoint(codePoint);
        index += unicodeEscape[0].length;
      } else {
        decoded += "\\";
      }
    } else if (decodeColon && escaped === ":") {
      decoded += ":";
      index += 1;
    } else {
      decoded += "\\";
    }
  }
  return decoded;
}

function parseTaskLine(line: string, depth: 0 | 1, lineNumber: number): ParsedTask {
  let content = line;
  let completed = false;

  if (content.startsWith("+ ")) {
    completed = true;
    content = content.slice(2);
  }
  if (content.startsWith("\\+ ") || content.startsWith("\\ ")) {
    content = content.slice(1);
  }

  const noteSeparator = firstUnescapedNoteSeparator(content);
  const encodedTitle = noteSeparator === -1 ? content : content.slice(0, noteSeparator);
  const encodedNote = noteSeparator === -1 ? null : content.slice(noteSeparator + 2);
  const title = decodeField(encodedTitle, true);
  const note = encodedNote === null ? null : decodeField(encodedNote, false);

  return { line: lineNumber, title, note, completed, depth };
}

export function parsePlanText(text: string, referenceDate: LocalDate): ParsedPlan {
  const source = text.replace(/\r\n/g, "\n");
  const sections: ParsedSection[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  const seenFarSections = new Set<"later" | "much-later">();
  let currentSection: ParsedSection | null = null;
  let hasParentInCurrentSection = false;

  for (const [index, sourceLine] of source.split("\n").entries()) {
    const lineNumber = index + 1;
    if (sourceLine.trim().length === 0) {
      continue;
    }

    const leadingTabs = /^\t*/u.exec(sourceLine)?.[0].length ?? 0;
    const leadingSpaces = leadingTabs === 0
      ? /^ */u.exec(sourceLine)?.[0].length ?? 0
      : 0;
    if (leadingTabs >= 2 || leadingSpaces >= 4) {
      diagnostics.push(
        diagnostic(lineNumber, "nested_too_deep", "Only one subtask level is supported"),
      );
      continue;
    }
    if (leadingTabs === 0 && (leadingSpaces === 1 || leadingSpaces === 3)) {
      diagnostics.push(
        diagnostic(
          lineNumber,
          "invalid_indentation",
          "Task indentation must be zero or exactly two spaces",
        ),
      );
      continue;
    }

    const depth: 0 | 1 = leadingTabs === 1 || leadingSpaces === 2 ? 1 : 0;
    const taskContent = sourceLine.slice(
      leadingTabs === 1 ? 1 : depth === 1 ? 2 : 0,
    );
    const structurallyEscapedTask =
      depth === 0 &&
      sourceLine.startsWith("\\") &&
      (/^-{4,}$/u.test(sourceLine.slice(1)) ||
        parseSectionHeading(sourceLine.slice(1), referenceDate) !== null)
        ? sourceLine.slice(1)
        : null;

    // Canonical divider is exactly 8 dashes; accept any run of 4+ dashes.
    if (structurallyEscapedTask === null && depth === 0 && /^-{4,}$/u.test(sourceLine)) {
      currentSection = null;
      hasParentInCurrentSection = false;
      continue;
    }

    if (structurallyEscapedTask === null && depth === 0) {
      const heading = parseSectionHeading(sourceLine, referenceDate);
      if (heading !== null) {
        if (isHeadingDiagnostic(heading)) {
          diagnostics.push({ line: lineNumber, ...heading });
          currentSection = null;
          hasParentInCurrentSection = false;
          continue;
        }

        if (heading.kind === "later" || heading.kind === "much-later") {
          if (seenFarSections.has(heading.kind)) {
            diagnostics.push(
              diagnostic(
                lineNumber,
                "duplicate_far_section",
                `Duplicate ${heading.kind} section`,
              ),
            );
          }
          seenFarSections.add(heading.kind);
        }

        currentSection = { bucket: heading, heading: sourceLine, tasks: [] };
        sections.push(currentSection);
        hasParentInCurrentSection = false;
        continue;
      }
    }

    if (currentSection === null) {
      diagnostics.push(
        diagnostic(lineNumber, "content_before_section", "Task content has no section heading"),
      );
      continue;
    }

    const task = parseTaskLine(
      structurallyEscapedTask ?? taskContent,
      depth,
      lineNumber,
    );
    currentSection.tasks.push(task);

    if (depth === 0) {
      hasParentInCurrentSection = true;
    } else if (!hasParentInCurrentSection) {
      diagnostics.push(
        diagnostic(lineNumber, "orphan_subtask", "Subtask has no preceding parent task"),
      );
    }
  }

  return { legacyCounts: null, mode: "canonical", source, sections, diagnostics };
}
