import { parsePlanText, type LocalDate } from "@personal-plan/core";

function hasBlankSeparatedBlocks(value: string): boolean {
  return value
    .replace(/\r\n/gu, "\n")
    .split(/\n[ \t]*\n/gu)
    .filter((block) => block.trim().length > 0).length >= 2;
}

export function shouldOfferLegacyImport(value: string, today: LocalDate): boolean {
  const parsed = parsePlanText(value, today);
  return (
    hasBlankSeparatedBlocks(value) &&
    !parsed.sections.some(({ bucket }) => bucket.kind === "date") &&
    parsed.diagnostics.some(({ code }) => code === "content_before_section")
  );
}
