import {
  applyReconcilePreview,
  buildReconcilePreview,
  parseLegacyNote,
  projectPlan,
  serializePlan,
  snapshotPlan,
  type ParseDiagnostic,
  type ParsedPlan,
  type ReconcilePreview,
} from "@personal-plan/core";
import { randomUUID } from "expo-crypto";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useAndroidPlan } from "../app/AndroidPlanProvider";
import { shouldOfferLegacyImport } from "./legacy-import";
import { styles } from "./styles";
import { commitTextDraft } from "./text-draft";

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

function applyErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "неизвестная ошибка";
}

interface LegacyPreview {
  parsed: ParsedPlan;
  reconcile: ReconcilePreview;
  source: string;
}

export function TextPlanScreen() {
  const plan = useAndroidPlan();
  const canonical = useMemo(
    () => serializePlan(plan.projected, plan.today),
    [plan.projected, plan.today],
  );
  const [value, setValue] = useState(plan.draft ?? canonical);
  const [diagnostics, setDiagnostics] = useState<readonly ParseDiagnostic[]>(
    [],
  );
  const [applyError, setApplyError] = useState<string | null>(null);
  const [legacyPreview, setLegacyPreview] = useState<LegacyPreview | null>(null);
  const editVersion = useRef(0);
  const lastCanonicalRef = useRef(canonical);
  const pendingDraftRef = useRef({ canonical, value });
  const flushDraftRef = useRef<(updateUi: boolean) => void>(() => undefined);
  const canImportLegacy = useMemo(
    () => shouldOfferLegacyImport(value, plan.today),
    [plan.today, value],
  );
  const currentLegacyPreview =
    legacyPreview?.source === value ? legacyPreview : null;

  pendingDraftRef.current = { canonical, value };

  const flushDraft = (draftValue: string, baseCanonical: string, updateUi: boolean) => {
    try {
      const result = commitTextDraft(plan.doc, draftValue, baseCanonical, plan.today, {
        idFactory: randomUUID,
        now: new Date().toISOString(),
      });
      if (result.kind === "invalid") {
        if (updateUi) {
          setDiagnostics(result.diagnostics);
          setApplyError(null);
        }
        return;
      }
      if (updateUi) {
        setDiagnostics([]);
        setApplyError(null);
      }
      void plan.clearDraft();
    } catch (reason: unknown) {
      if (updateUi) {
        setApplyError(
          `Не удалось применить изменения: ${applyErrorMessage(reason)}`,
        );
      }
    }
  };
  flushDraftRef.current = (updateUi) => {
    const pending = pendingDraftRef.current;
    flushDraft(pending.value, pending.canonical, updateUi);
  };

  useEffect(() => () => {
    // Switching to Settings or another tab unmounts the editor. Flush the
    // latest valid draft synchronously so it reaches Yjs and the sync outbox.
    flushDraftRef.current(false);
  }, []);

  useEffect(() => {
    if (canonical !== lastCanonicalRef.current) {
      // The plan changed underneath the editor (sync from another device, a
      // pending delete committing on tab switch, ...). If the user has not
      // typed anything since, follow the fresh canonical text instead of
      // reconciling the stale buffer back over the change.
      const userEdited = value !== lastCanonicalRef.current;
      lastCanonicalRef.current = canonical;
      if (!userEdited) {
        setValue(canonical);
        return;
      }
    }
    if (value === canonical) {
      return;
    }
    const version = editVersion.current;
    const timer = setTimeout(() => {
      if (editVersion.current !== version) {
        return;
      }
      flushDraft(value, canonical, true);
    }, 400);
    return () => clearTimeout(timer);
  }, [canonical, plan, value]);

  return (
    <View style={{ flex: 1 }}>
      <TextInput
        accessibilityLabel="Текст плана"
        multiline
        onBlur={() => flushDraftRef.current(true)}
        onChangeText={(next) => {
          editVersion.current += 1;
          setValue(next);
          setDiagnostics([]);
          setApplyError(null);
          setLegacyPreview(null);
          void plan.saveDraft(next);
        }}
        style={styles.textarea}
        textAlignVertical="top"
        value={value}
      />
      {applyError === null ? null : (
        <Text accessibilityRole="alert" style={styles.status}>
          {applyError}
        </Text>
      )}
      {diagnostics.length === 0 ? null : (
        <View>
          <Text accessibilityRole="alert" style={styles.status}>
            Исправьте ошибки в тексте:
          </Text>
          {diagnostics.map((item) => (
            <Text key={`${String(item.line)}:${item.code}`} style={styles.status}>
              Строка {item.line}: {diagnosticMessages[item.code]}
            </Text>
          ))}
        </View>
      )}
      {!canImportLegacy ? null : (
        <View accessibilityLabel="Импорт старой заметки">
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              const parsed = parseLegacyNote(value, plan.today);
              setLegacyPreview({
                parsed,
                reconcile: buildReconcilePreview(plan.doc, parsed, plan.today),
                source: value,
              });
            }}
            style={styles.settingsActionButton}
          >
            <Text style={styles.secondaryButtonText}>Распознать старую заметку</Text>
          </Pressable>
          {currentLegacyPreview === null ? null : (
            <View style={styles.legacyPreview}>
              <Text style={styles.status}>
                Ближних разделов: {currentLegacyPreview.parsed.legacyCounts?.nearSections ?? 0} · Дальних: {currentLegacyPreview.parsed.legacyCounts?.farSections ?? 0}
              </Text>
              <Text style={styles.status}>
                Задач: {currentLegacyPreview.parsed.legacyCounts?.tasks ?? 0} · Выполнено: {currentLegacyPreview.parsed.legacyCounts?.completedTasks ?? 0}
              </Text>
              {currentLegacyPreview.parsed.diagnostics.some(
                ({ code }) => code === "legacy_near_section_overflow",
              ) ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  Блоки после седьмого нужно перенести ниже --------.
                </Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    try {
                      applyReconcilePreview(plan.doc, currentLegacyPreview.reconcile, {
                        completedOn: plan.today,
                        confirmDiagnostics: true,
                        confirmRisky: true,
                        idFactory: randomUUID,
                        now: new Date().toISOString(),
                      });
                      const snapshot = snapshotPlan(plan.doc);
                      const nextCanonical = serializePlan(
                        projectPlan(snapshot.tasks, plan.today, snapshot.records),
                        plan.today,
                      );
                      lastCanonicalRef.current = nextCanonical;
                      setValue(nextCanonical);
                      setDiagnostics([]);
                      setApplyError(null);
                      setLegacyPreview(null);
                      void plan.clearDraft();
                    } catch (reason: unknown) {
                      setApplyError(
                        `Не удалось импортировать заметку: ${applyErrorMessage(reason)}`,
                      );
                    }
                  }}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>Импортировать</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}
