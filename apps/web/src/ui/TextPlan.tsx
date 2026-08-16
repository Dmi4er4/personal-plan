import {
  applyReconcilePreview,
  buildReconcilePreview,
  parsePlanText,
  projectPlan,
  serializePlan,
  snapshotPlan,
  type ParseDiagnostic,
  type ReconcilePreview as ReconcilePreviewModel,
} from "@personal-plan/core";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { usePlan } from "../app/PlanProvider.js";
import { LegacyImport } from "./LegacyImport.js";

type TextEditState =
  | { kind: "clean"; value: string }
  | { kind: "editing"; value: string }
  | {
      kind: "invalid";
      value: string;
      diagnostics: readonly ParseDiagnostic[];
    }
  | { kind: "applying"; value: string };

const diagnosticMessages: Record<ParseDiagnostic["code"], string> = {
  content_before_section: "Текст находится вне раздела",
  duplicate_far_section: "Дальний раздел повторяется",
  invalid_date_heading: "Некорректная дата в заголовке",
  invalid_indentation: "Отступ должен быть 0 или 2 пробела",
  legacy_near_section_overflow:
    "Блоки после седьмого нужно перенести ниже --------",
  nested_too_deep: "Поддерживается только один уровень подзадач",
  orphan_subtask: "У подзадачи нет родительской задачи",
  unrecognized_heading: "Заголовок раздела не распознан",
};

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "неизвестная ошибка";
}

function hasBlankSeparatedBlocks(value: string): boolean {
  return value
    .replace(/\r\n/gu, "\n")
    .split(/\n[ \t]*\n/gu)
    .filter((block) => block.trim().length > 0).length >= 2;
}

export function TextPlan() {
  const plan = usePlan();
  const { doc, draft, projected, today } = plan;
  const planRef = useRef(plan);
  planRef.current = plan;
  const canonical = useMemo(
    () => serializePlan(projected, today),
    [projected, today],
  );
  const [state, setState] = useState<TextEditState>(() => {
    if (draft !== null && draft !== canonical) {
      return { kind: "editing", value: draft };
    }
    return { kind: "clean", value: canonical };
  });
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [applySchedule, setApplySchedule] = useState(() =>
    draft !== null && draft !== canonical ? 1 : 0,
  );
  const focused = useRef(false);
  const mounted = useRef(true);
  const editVersion = useRef(0);
  const documentRevision = useRef(0);
  const valueRevision = useRef(0);
  const matchingRestoredDraft = useRef(draft !== null && draft === canonical);
  const persistenceBusy = useRef(false);
  const persistenceTail = useRef<Promise<void>>(Promise.resolve());

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  useEffect(() => {
    const recordUpdate = (): void => {
      documentRevision.current += 1;
    };
    doc.on("update", recordUpdate);
    return () => {
      doc.off("update", recordUpdate);
    };
  }, [doc]);

  const enqueuePersistence = useCallback(
    (operation: () => Promise<void>): Promise<void> => {
      let result: Promise<void>;
      if (persistenceBusy.current) {
        result = persistenceTail.current.then(operation);
      } else {
        persistenceBusy.current = true;
        try {
          result = operation();
        } catch (reason: unknown) {
          result = Promise.reject(
            reason instanceof Error ? reason : new Error(errorMessage(reason)),
          );
        }
      }

      const settled = result.catch(() => undefined);
      persistenceTail.current = settled;
      void settled.finally(() => {
        if (persistenceTail.current === settled) {
          persistenceBusy.current = false;
        }
      });
      return result;
    },
    [],
  );

  const currentCanonical = useCallback(
    () => serializePlan(projectPlan(snapshotPlan(doc).tasks, today), today),
    [doc, today],
  );

  const clearPersistedDraft = useCallback(
    (version: number): void => {
      void enqueuePersistence(() => planRef.current.clearDraft())
        .then(() => {
          if (mounted.current && editVersion.current === version) {
            setPersistenceError(null);
          }
        })
        .catch((reason: unknown) => {
          if (mounted.current && editVersion.current === version) {
            setPersistenceError(
              `Не удалось удалить черновик: ${errorMessage(reason)}`,
            );
          }
        });
    },
    [enqueuePersistence],
  );

  const applyPreview = useCallback(
    (
      preview: ReconcilePreviewModel,
      value: string,
      version: number,
      autoMoveCompletedToEnd = true,
    ): void => {
      if (!mounted.current || editVersion.current !== version) {
        return;
      }
      setState({ kind: "applying", value });
      try {
        applyReconcilePreview(doc, preview, {
          autoMoveCompletedToEnd,
          completedOn: today,
          confirmDiagnostics: true,
          confirmRisky: true,
          idFactory: () => crypto.randomUUID(),
          now: new Date().toISOString(),
        });
      } catch (reason: unknown) {
        if (editVersion.current === version) {
          setPersistenceError(
            `Не удалось применить изменения: ${errorMessage(reason)}`,
          );
          setState({ kind: "editing", value });
        }
        return;
      }

      const nextValue = !focused.current ? currentCanonical() : value;
      valueRevision.current = documentRevision.current;
      setState({ kind: "clean", value: nextValue });
      clearPersistedDraft(version);
    },
    [clearPersistedDraft, currentCanonical, doc, today],
  );

  useEffect(() => {
    if (!matchingRestoredDraft.current) {
      return;
    }
    matchingRestoredDraft.current = false;
    clearPersistedDraft(editVersion.current);
  }, [clearPersistedDraft]);

  useEffect(() => {
    if (state.kind !== "editing") {
      return undefined;
    }
    const value = state.value;
    const version = editVersion.current;
    const timer = window.setTimeout(() => {
      if (!mounted.current || editVersion.current !== version) {
        return;
      }
      const preview = buildReconcilePreview(
        doc,
        parsePlanText(value, today),
        today,
      );
      const errors = preview.diagnostics.filter(
        ({ severity }) => severity === "error",
      );
      if (errors.length > 0) {
        setState({ kind: "invalid", diagnostics: errors, value });
        return;
      }
      applyPreview(preview, value, version);
    }, 400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [applyPreview, applySchedule, doc, state.kind, state.value, today]);

  useEffect(() => {
    if (draft === null || draft === canonical || state.kind !== "clean") {
      return;
    }
    editVersion.current += 1;
    setApplySchedule((tick) => tick + 1);
    setState({ kind: "editing", value: draft });
  }, [canonical, draft, state.kind]);

  useEffect(() => {
    if (!focused.current && state.kind === "clean") {
      valueRevision.current = documentRevision.current;
      if (state.value !== canonical) {
        setState({ kind: "clean", value: canonical });
      }
    }
  }, [canonical, state]);

  const parsedForDetection = useMemo(
    () => parsePlanText(state.value, today),
    [state.value, today],
  );
  const canImportLegacy =
    hasBlankSeparatedBlocks(state.value) &&
    !parsedForDetection.sections.some(({ bucket }) => bucket.kind === "date") &&
    parsedForDetection.diagnostics.some(
      ({ code }) => code === "content_before_section",
    );

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = event.currentTarget.value;
    editVersion.current += 1;
    const version = editVersion.current;
    setPersistenceError(null);
    setApplySchedule((tick) => tick + 1);
    setState({ kind: "editing", value });
    void enqueuePersistence(() => planRef.current.setDraft(value)).catch(
      (reason: unknown) => {
        if (mounted.current && editVersion.current === version) {
          setPersistenceError(
            `Не удалось сохранить черновик: ${errorMessage(reason)}`,
          );
        }
      },
    );
  };

  const importLegacy = (preview: ReconcilePreviewModel): void => {
    applyPreview(preview, preview.source, editVersion.current, false);
  };

  return (
    <div className="text-plan">
      <label className="text-plan-label" htmlFor="plan-text">
        Текст плана
      </label>
      <textarea
        aria-describedby={persistenceError === null ? undefined : "text-plan-error"}
        id="plan-text"
        onBlur={() => {
          focused.current = false;
          if (state.kind === "clean") {
            valueRevision.current = documentRevision.current;
            setState({ kind: "clean", value: currentCanonical() });
          }
        }}
        onChange={handleChange}
        onFocus={() => {
          focused.current = true;
        }}
        spellCheck="true"
        value={state.value}
      />
      {persistenceError === null ? null : (
        <p id="text-plan-error" role="alert">
          {persistenceError}
        </p>
      )}
      {state.kind === "invalid" ? (
        <div className="text-diagnostics" role="alert">
          <p>Исправьте ошибки в тексте:</p>
          <ul>
            {state.diagnostics.map((item) => (
              <li key={`${String(item.line)}:${item.code}`}>
                Строка {item.line}: {diagnosticMessages[item.code]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {canImportLegacy ? (
        <LegacyImport
          doc={doc}
          onImport={importLegacy}
          source={state.value}
          today={today}
        />
      ) : null}
    </div>
  );
}
