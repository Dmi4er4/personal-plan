import type { Bucket, LocalDate } from "../model/types.js";
import { addDays } from "../time/local-date.js";
import { formatSectionHeading } from "./headings.js";
import type { ParsedPlan, ParsedSection, ParsedTask } from "./types.js";

interface SourceLine {
  line: number;
  text: string;
}

function splitBlocks(lines: readonly SourceLine[]): SourceLine[][] {
  const blocks: SourceLine[][] = [];
  let block: SourceLine[] = [];

  for (const line of lines) {
    if (line.text.trim().length === 0) {
      if (block.length > 0) {
        blocks.push(block);
        block = [];
      }
      continue;
    }
    block.push(line);
  }

  if (block.length > 0) {
    blocks.push(block);
  }
  return blocks;
}

function parseTask(sourceLine: SourceLine): ParsedTask {
  let content = sourceLine.text;
  let depth: 0 | 1 = 0;
  let completed = false;

  const indentation = /^[ \t]+/u.exec(content)?.[0] ?? "";
  const indentationWidth = Array.from(indentation).reduce(
    (width, character) => width + (character === "\t" ? 2 : 1),
    0,
  );
  if (indentationWidth >= 2) {
    depth = 1;
    content = content.slice(indentation.length);
  }

  if (content.startsWith("- ")) {
    depth = 1;
    content = content.slice(2);
  }
  if (content.startsWith("✓ ")) {
    completed = true;
    content = content.slice(2);
  }

  const noteSeparator = content.indexOf(": ");
  const title = noteSeparator === -1 ? content : content.slice(0, noteSeparator);
  const note = noteSeparator === -1 ? null : content.slice(noteSeparator + 2);

  return {
    line: sourceLine.line,
    title,
    note,
    completed,
    depth,
  };
}

function section(
  block: readonly SourceLine[],
  bucket: Bucket,
  referenceDate: LocalDate,
): ParsedSection {
  return {
    bucket,
    heading: formatSectionHeading(bucket, referenceDate),
    tasks: block.map(parseTask),
  };
}

export function parseLegacyNote(text: string, referenceDate: LocalDate): ParsedPlan {
  const source = text.replace(/\r\n/g, "\n");
  const lines = source.split("\n").map((line, index) => ({
    line: index + 1,
    text: line,
  }));
  const dividerIndex = lines.findIndex(({ text: line }) => line === "--------");
  const nearLines = dividerIndex === -1 ? lines : lines.slice(0, dividerIndex);
  const farLines = dividerIndex === -1 ? [] : lines.slice(dividerIndex + 1);
  const nearBlocks = splitBlocks(nearLines);
  const farBlocks = splitBlocks(farLines);
  const supportedNearBlocks = nearBlocks.slice(0, 7);
  const overflowNearBlocks = nearBlocks.slice(7);
  const sections: ParsedSection[] = supportedNearBlocks.map((block, index) => {
    const bucket: Bucket = { kind: "date", date: addDays(referenceDate, index) };
    return section(block, bucket, referenceDate);
  });

  for (const [index, block] of farBlocks.entries()) {
    const bucket: Bucket = index === 0 ? { kind: "later" } : { kind: "much-later" };
    sections.push(section(block, bucket, referenceDate));
  }

  const parsedTasks = [...nearBlocks, ...farBlocks].flatMap((block) =>
    block.map(parseTask),
  );
  return {
    legacyCounts: {
      completedTasks: parsedTasks.filter(({ completed }) => completed).length,
      farSections: farBlocks.length,
      nearSections: nearBlocks.length,
      tasks: parsedTasks.length,
    },
    mode: "legacy",
    source,
    sections,
    diagnostics: overflowNearBlocks.map((block) => ({
      code: "legacy_near_section_overflow" as const,
      line: block[0]?.line ?? lines.length,
      message:
        "Legacy near blocks after the seventh must be moved below --------",
      severity: "error" as const,
    })),
  };
}
