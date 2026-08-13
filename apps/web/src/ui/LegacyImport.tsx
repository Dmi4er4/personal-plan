import {
  buildReconcilePreview,
  parseLegacyNote,
  type LocalDate,
  type ParsedPlan,
  type ReconcilePreview,
} from "@personal-plan/core";
import { useState } from "react";
import type * as Y from "yjs";

interface LegacyImportProps {
  doc: Y.Doc;
  onImport: (preview: ReconcilePreview) => void;
  source: string;
  today: LocalDate;
}

interface LegacyPreview {
  parsed: ParsedPlan;
  reconcile: ReconcilePreview;
  source: string;
}

function countTasks(parsed: ParsedPlan): number {
  return parsed.sections.reduce((count, section) => count + section.tasks.length, 0);
}

function countCompletedTasks(parsed: ParsedPlan): number {
  return parsed.sections.reduce(
    (count, section) =>
      count + section.tasks.filter((task) => task.completed).length,
    0,
  );
}

export function LegacyImport({ doc, onImport, source, today }: LegacyImportProps) {
  const [preview, setPreview] = useState<LegacyPreview | null>(null);
  const currentPreview = preview?.source === source ? preview : null;

  const recognize = (): void => {
    const parsed = parseLegacyNote(source, today);
    setPreview({
      parsed,
      reconcile: buildReconcilePreview(doc, parsed, today),
      source,
    });
  };

  const nearSectionCount =
    currentPreview?.parsed.legacyCounts?.nearSections ??
    currentPreview?.parsed.sections.filter(({ bucket }) => bucket.kind === "date")
      .length ??
    0;
  const farSectionCount =
    currentPreview?.parsed.legacyCounts?.farSections ??
    currentPreview?.parsed.sections.filter(({ bucket }) => bucket.kind !== "date")
      .length ??
    0;
  const taskCount =
    currentPreview?.parsed.legacyCounts?.tasks ??
    (currentPreview === null ? 0 : countTasks(currentPreview.parsed));
  const completedTaskCount =
    currentPreview?.parsed.legacyCounts?.completedTasks ??
    (currentPreview === null ? 0 : countCompletedTasks(currentPreview.parsed));
  const hasBlockingOverflow =
    currentPreview?.parsed.diagnostics.some(
      ({ code }) => code === "legacy_near_section_overflow",
    ) ?? false;

  return (
    <section aria-label="Импорт старой заметки" className="legacy-import">
      <button onClick={recognize} type="button">
        Распознать старую заметку
      </button>
      {currentPreview === null ? null : (
        <div className="legacy-preview">
          <ul>
            <li>Ближних разделов: {nearSectionCount}</li>
            <li>Дальних разделов: {farSectionCount}</li>
            <li>Задач: {taskCount}</li>
            <li>Выполнено: {completedTaskCount}</li>
          </ul>
          {hasBlockingOverflow ? (
            <p className="legacy-blocking" role="alert">
              Блоки после седьмого нужно перенести ниже --------.
            </p>
          ) : null}
          <button
            disabled={hasBlockingOverflow}
            onClick={() => {
              if (!hasBlockingOverflow) {
                onImport(currentPreview.reconcile);
              }
            }}
            type="button"
          >
            Импортировать
          </button>
        </div>
      )}
    </section>
  );
}
