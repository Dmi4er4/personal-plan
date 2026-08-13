import { restoreTask, serializePlan, setTaskCompleted, type LocalDate, type TaskSnapshot } from "@personal-plan/core";
import { createPairingQr, rootSecretToPhrase } from "@personal-plan/sync";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import type * as Y from "yjs";
import { useAndroidPlan } from "../app/AndroidPlanProvider";
import { RecoveryCards } from "./RecoveryCards";
import { styles } from "./styles";

function HistorySection({ doc, history, snapshot, today }: {
  doc: Y.Doc;
  history: TaskSnapshot[];
  snapshot: Map<string, TaskSnapshot>;
  today: LocalDate;
}) {
  const historyIds = new Set(history.map(({ id }) => id));
  if (history.length === 0) {
    return <Text style={styles.settingsEmpty}>Пока пусто</Text>;
  }
  return <>
    {history.map((task) => {
      const parentIsHistorical = task.parentId !== null && historyIds.has(task.parentId);
      const standaloneChild = task.parentId !== null && !parentIsHistorical;
      const canRestore = task.parentId === null || standaloneChild;
      const parent = standaloneChild && task.parentId !== null ? snapshot.get(task.parentId) : undefined;
      const deleted = task.deleted;
      const action = deleted ? "Восстановить" : "Вернуть";
      return <View key={task.id} style={[styles.historyItem, parentIsHistorical ? styles.historyChild : undefined]}>
        <View style={styles.historyCopy}>
          <Text style={[styles.title, deleted ? styles.historyDeleted : styles.completed]}>{task.title}</Text>
          {task.note === null ? null : <Text style={styles.note}>{task.note}</Text>}
          {parent === undefined ? null : <Text style={styles.historyMeta}>Родитель: {parent.title}</Text>}
          {deleted ? <Text style={styles.historyMeta}>Удалено</Text> : null}
        </View>
        {canRestore ? <Pressable
          accessibilityLabel={`${action}: ${task.title}`}
          accessibilityRole="button"
          onPress={() => {
            if (deleted) restoreTask(doc, task.id);
            else setTaskCompleted(doc, task.id, { completed: false, at: new Date().toISOString(), on: today });
          }}
          style={styles.historyAction}
        ><Text style={styles.historyActionText}>{action}</Text></Pressable> : null}
      </View>;
    })}
  </>;
}

export function SettingsScreen({ doc, history, rootSecret, relayUrl, snapshot, today, onClose }: {
  doc: Y.Doc;
  history: TaskSnapshot[];
  rootSecret: Uint8Array;
  relayUrl: string;
  snapshot: Map<string, TaskSnapshot>;
  today: LocalDate;
  onClose(): void;
}) {
  const plan = useAndroidPlan();
  const [phraseVisible, setPhraseVisible] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const phrase = phraseVisible ? rootSecretToPhrase(rootSecret) : null;
  const pairingQr = phraseVisible ? createPairingQr(relayUrl, rootSecret) : null;
  const hasUnappliedDraft = plan.draft !== null && plan.draft !== serializePlan(plan.projected, plan.today);
  const syncLabel = hasUnappliedDraft ? "есть локальные изменения — вернитесь в Текст и исправьте ошибки"
    : plan.syncState === "synced" ? "синхронизировано"
    : plan.syncState === "pending" ? "ожидает синхронизации"
      : plan.syncState === "offline" ? "офлайн — изменения сохранены локально"
        : "ошибка синхронизации";
  return <ScrollView style={styles.page} testID="settings">
    <View style={styles.settingsHeader}>
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.settingsBack}>
        <Text style={styles.settingsBackText}>← Назад</Text>
      </Pressable>
      <Text style={styles.settingsTitle}>Настройки</Text>
    </View>
    <Text style={styles.settingsSectionTitle}>Состояние синхронизации</Text>
    <Text accessibilityLabel="Состояние синхронизации" style={styles.status}>{syncLabel}</Text>
    <Text style={styles.settingsSectionTitle}>Восстановление</Text>
    {phrase === null ? (
      <Pressable accessibilityRole="button" onPress={() => setPhraseVisible(true)} style={styles.settingsActionButton}>
        <Text style={styles.secondaryButtonText}>Показать фразу восстановления</Text>
      </Pressable>
    ) : (
      pairingQr === null ? null : <RecoveryCards phrase={phrase} qr={pairingQr} />
    )}
    <Text style={styles.settingsSectionTitle}>Устройство</Text>
    <Text style={styles.status}>Android · {relayUrl.replace(/^https?:\/\//u, "")}</Text>
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        Alert.alert(
          "Заменить локальный план?",
          "Несинхронизированные изменения на этом телефоне будут потеряны. Ключ подключения сохранится.",
          [
            { text: "Отмена", style: "cancel" },
            { text: "Заменить", style: "destructive", onPress: () => {
              setRestoreError(null);
              void plan.restoreFromServer().catch(() => setRestoreError("Не удалось восстановить план с сервера"));
            } },
          ],
        );
      }}
      style={styles.settingsActionButton}
    >
      <Text style={styles.secondaryButtonText}>Заменить локальный план данными с сервера</Text>
    </Pressable>
    {restoreError ? <Text style={styles.error}>{restoreError}</Text> : null}
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        Alert.alert(
          "Подключить заново?",
          "Локальная копия плана и ключ этого телефона будут удалены.",
          [
            { text: "Отмена", style: "cancel" },
            { text: "Продолжить", onPress: () => {
              Alert.alert(
                "Фраза восстановления сохранена?",
                "Без неё этот телефон нельзя будет снова подключить к существующему плану.",
                [
                  { text: "Отмена", style: "cancel" },
                  { text: "Да, отключить", style: "destructive", onPress: () => {
                    setDisconnectError(null);
                    void plan.disconnectVault().catch(() => setDisconnectError("Не удалось отключить устройство"));
                  } },
                ],
              );
            } },
          ],
        );
      }}
      style={styles.settingsActionButton}
    >
      <Text style={styles.secondaryButtonText}>Подключить заново</Text>
    </Pressable>
    {disconnectError ? <Text style={styles.error}>{disconnectError}</Text> : null}
    <Text style={styles.settingsSectionTitle}>История</Text>
    <HistorySection doc={doc} history={history} snapshot={snapshot} today={today} />
  </ScrollView>;
}
