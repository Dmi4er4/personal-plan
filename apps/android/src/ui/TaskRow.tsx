import type { TaskSnapshot } from "@personal-plan/core";
import { Pressable, Text, View } from "react-native";
import { styles } from "./styles";

export function TaskRow({
  task,
  completed,
  onToggle,
  onOpen,
  onLongPress,
  pendingDelete = false,
  deleteProgress = 0,
  onCancelDelete,
}: {
  task: TaskSnapshot;
  completed: boolean;
  onToggle(): void;
  onOpen?(): void;
  onLongPress?(): void;
  pendingDelete?: boolean;
  deleteProgress?: number;
  onCancelDelete?(): void;
}) {
  const rowPress = () => {
    if (pendingDelete) {
      onCancelDelete?.();
      return;
    }
    onOpen?.();
  };
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
      accessibilityHint={pendingDelete ? "Нажмите, чтобы отменить удаление" : "Открывает редактирование дела"}
      accessibilityLabel={task.title}
      accessibilityRole="button"
      delayLongPress={220}
      onLongPress={pendingDelete ? undefined : onLongPress}
      style={styles.taskText}
      onPress={rowPress}
    >
      <Text style={[styles.title, completed || pendingDelete ? styles.completed : undefined]}>{task.title}</Text>
      {task.note !== null ? <Text style={[styles.note, completed || pendingDelete ? styles.completed : undefined]}>{task.note}</Text> : null}
      {pendingDelete ? <View style={styles.deleteProgressTrack}><View style={[styles.deleteProgressFill, { width: `${Math.round(deleteProgress * 100)}%` }]} /></View> : null}
    </Pressable>
  </View>;
}
