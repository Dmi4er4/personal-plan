import {
  applyReconcilePreview,
  buildReconcilePreview,
  parsePlanText,
  type LocalDate,
  type ParseDiagnostic,
} from "@personal-plan/core";
import type * as Y from "yjs";

export type TextDraftCommitResult =
  | { kind: "unchanged"; diagnostics: readonly ParseDiagnostic[] }
  | { kind: "invalid"; diagnostics: readonly ParseDiagnostic[] }
  | { kind: "applied"; diagnostics: readonly ParseDiagnostic[] };

export function commitTextDraft(
  doc: Y.Doc,
  value: string,
  canonical: string,
  today: LocalDate,
  options: { idFactory(): string; now: string },
): TextDraftCommitResult {
  if (value === canonical) {
    return { kind: "unchanged", diagnostics: [] };
  }

  const preview = buildReconcilePreview(doc, parsePlanText(value, today), today);
  const diagnostics = preview.diagnostics.filter(
    ({ severity }) => severity === "error",
  );
  if (diagnostics.length > 0) {
    return { kind: "invalid", diagnostics };
  }

  applyReconcilePreview(doc, preview, {
    completedOn: today,
    confirmDiagnostics: true,
    confirmRisky: true,
    idFactory: options.idFactory,
    now: options.now,
  });
  return { kind: "applied", diagnostics: [] };
}
