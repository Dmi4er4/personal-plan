import { restoreTask, setTaskCompleted, type LocalDate, type TaskSnapshot } from "@personal-plan/core";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type * as Y from "yjs";
import { buildHistoryGroups, historyDateLabel } from "./history-model";
import { styles } from "./styles";

export function HistoryScreen({ doc, history, snapshot, today, onClose }: {
  doc: Y.Doc;
  history: TaskSnapshot[];
  snapshot: Map<string, TaskSnapshot>;
  today: LocalDate;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => buildHistoryGroups(history, query), [history, query]);

  return <View style={styles.page} testID="history">
    <View style={styles.settingsHeader}>
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.settingsBack}>
        <Text style={styles.settingsBackText}>← Назад</Text>
      </Pressable>
      <Text style={styles.settingsTitle}>История</Text>
    </View>
    <TextInput
      accessibilityLabel="Поиск по истории"
      autoCapitalize="none"
      onChangeText={setQuery}
      placeholder="Поиск по названию и пояснению"
      returnKeyType="search"
      style={[styles.input, styles.historySearch]}
      value={query}
    />
    <ScrollView keyboardShouldPersistTaps="handled">
      {groups.length === 0 ? (
        <Text style={styles.settingsEmpty}>{query.trim().length === 0 ? "Пока пусто" : "Ничего не найдено"}</Text>
      ) : groups.map((group) => (
        <View key={group.date}>
          <Text style={styles.historyDate}>{historyDateLabel(group.date, today)}</Text>
          {group.blocks.map((block) => block.tasks.map((task, index) => {
            const isRoot = index === 0;
            const standaloneChild = isRoot && task.parentId !== null;
            const parent = standaloneChild && task.parentId !== null ? snapshot.get(task.parentId) : undefined;
            const action = task.deleted ? "Восстановить" : "Вернуть";
            return <View key={task.id} style={[styles.historyItem, isRoot ? undefined : styles.historyChild]}>
              <View style={styles.historyCopy}>
                <Text style={[styles.title, task.deleted ? styles.historyDeleted : styles.completed]}>{task.title}</Text>
                {task.note === null ? null : <Text style={styles.note}>{task.note}</Text>}
                {parent === undefined ? null : <Text style={styles.historyMeta}>Родитель: {parent.title}</Text>}
                {task.deleted ? <Text style={styles.historyMeta}>Удалено</Text> : null}
              </View>
              {isRoot ? <Pressable
                accessibilityLabel={`${action}: ${task.title}`}
                accessibilityRole="button"
                onPress={() => {
                  if (task.deleted) restoreTask(doc, task.id);
                  else setTaskCompleted(doc, task.id, { completed: false, at: new Date().toISOString(), on: today });
                }}
                style={styles.historyAction}
              ><Text style={styles.historyActionText}>{action}</Text></Pressable> : null}
            </View>;
          }))}
        </View>
      ))}
    </ScrollView>
  </View>;
}
