import type { TaskSnapshot } from "@personal-plan/core";
import { Pressable, Text, View } from "react-native";
import { styles } from "./styles";

export function TaskRow({
  task,
  completed,
  onToggle,
  onOpen,
  onLongPress,
  onDelete,
  pendingDelete = false,
  deleteProgress = 0,
  onCancelDelete,
}: {
  task: TaskSnapshot;
  completed: boolean;
  onToggle(): void;
  onOpen?(): void;
  onLongPress?(): void;
  onDelete?(): void;
  pendingDelete?: boolean;
  deleteProgress?: number;
  onCancelDelete?(): void;
}) {
  const rowPress = pendingDelete
    ? onCancelDelete
    : onOpen;
  return <View style={[styles.task, task.parentId === null ? undefined : styles.child, pendingDelete ? styles.taskPendingDelete : undefined]}>
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: completed }}
      accessibilityLabel={`${completed ? "Выполнено" : "Не выполнено"}: ${task.title}`}
      disabled={pendingDelete}
      onPress={onToggle}
      style={[styles.checkboxHitArea, pendingDelete ? styles.checkboxPending : undefined]}
    >
      <View style={[styles.checkbox, completed ? styles.checkboxDone : undefined]}>
        {completed ? <Text style={styles.check}>✓</Text> : null}
      </View>
    </Pressable>
    <Pressable
      accessibilityHint={pendingDelete ? "Нажмите, чтобы отменить удаление" : undefined}
      accessibilityRole="button"
      style={styles.taskText}
      onPress={rowPress}
      onLongPress={pendingDelete ? undefined : onLongPress}
      delayLongPress={220}
    >
      <Text style={[styles.title, completed || pendingDelete ? styles.completed : undefined]}>{task.title}</Text>
      {task.note !== null ? <Text style={[styles.note, completed || pendingDelete ? styles.completed : undefined]}>{task.note}</Text> : null}
      {pendingDelete ? <View style={styles.deleteProgressTrack}><View style={[styles.deleteProgressFill, { width: `${Math.round(deleteProgress * 100)}%` }]} /></View> : null}
    </Pressable>
    {onDelete !== undefined && !pendingDelete ? <Pressable accessibilityRole="button" accessibilityLabel={`Удалить: ${task.title}`} onPress={onDelete} style={styles.deleteButton}><Text style={styles.deleteButtonText}>×</Text></Pressable> : null}
  </View>;
}
