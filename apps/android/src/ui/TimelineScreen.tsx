import { addTask, moveTask, removeTask, setTaskCompleted, type Bucket, type ProjectedPlan, type LocalDate, type TaskSnapshot } from "@personal-plan/core";
import { randomUUID } from "expo-crypto";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import DraggableFlatList, { type RenderItemParams } from "react-native-draggable-flatlist";
import type * as Y from "yjs";
import {
  bucketsEqual,
  flattenSections,
  resolveChildDropDestination,
  resolveDropDestination,
  sectionKey,
  type TimelineItem,
} from "./timeline-model";
import { TaskRow } from "./TaskRow";
import { buildNewTask } from "./new-task";
import { styles } from "./styles";
import { usePendingDelete } from "./use-pending-delete";

interface TimelineListHandle {
  scrollToOffset: (options: { animated: boolean; offset: number }) => void;
}

function sectionLabels(bucket: ProjectedPlan["active"][number]["bucket"], today: LocalDate): [string, string | null] {
  if (bucket.kind === "later") return ["Позже", null];
  if (bucket.kind === "much-later") return ["Сильно позже", null];
  const d = new Date(`${bucket.date}T12:00:00Z`);
  const delta = Math.round((Date.parse(`${bucket.date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  const days = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  return [delta === 0 ? "Сегодня" : delta === 1 ? "Завтра" : days[d.getUTCDay()] ?? "", `${d.getUTCDate()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`];
}

function sectionMarginStyle(bucket: Bucket): typeof styles.farSection | typeof styles.farSectionFollow | undefined {
  if (bucket.kind === "later") return styles.farSection;
  if (bucket.kind === "much-later") return styles.farSectionFollow;
  return undefined;
}

export function TimelineScreen({ doc, projected, today }: { doc: Y.Doc; projected: ProjectedPlan; today: LocalDate }) {
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newTaskBucket, setNewTaskBucket] = useState<Bucket>({ kind: "date", date: today });
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const listRef = useRef<TimelineListHandle | null>(null);
  const newTaskInputRef = useRef<TextInput>(null);

  const captureListRef = useCallback((instance: unknown) => {
    if (
      typeof instance === "object" &&
      instance !== null &&
      "scrollToOffset" in instance &&
      typeof instance.scrollToOffset === "function"
    ) {
      listRef.current = instance as TimelineListHandle;
    } else {
      listRef.current = null;
    }
  }, []);

  const commitDelete = useCallback((id: string) => {
    removeTask(doc, id, { at: new Date().toISOString(), on: today });
  }, [doc, today]);
  const { requestDelete, cancelDelete, progress, isPending } = usePendingDelete(commitDelete);

  // The list data must stay referentially stable while a drag gesture is in
  // flight: swapping `data` mid-gesture makes DraggableFlatList silently cancel
  // the drag (no onDragEnd) and leaves the UI stuck in drag mode. All sections
  // therefore stay in the list at all times — headers have constant height, so
  // empty days double as always-available drop targets for cross-day moves.
  const items = useMemo(() => flattenSections(projected.active), [projected.active]);

  // Freeze the rendered data for the duration of a drag: async doc updates
  // (sync downloads, widget commands) would otherwise swap `data` mid-gesture
  // and cancel the drop. The frozen copy refreshes on the next render after
  // the gesture ends.
  const frozenItemsRef = useRef<TimelineItem[] | null>(null);
  const listItems = frozenItemsRef.current ?? items;

  const resetDrag = useCallback(() => {
    frozenItemsRef.current = null;
    setActiveKey(null);
  }, []);

  const handleDragBegin = useCallback((index: number) => {
    frozenItemsRef.current = items;
    const item = items[index];
    if (item !== undefined && item.type === "block") {
      setActiveKey(item.key);
    }
  }, [items]);

  const handleDragEnd = useCallback(({ from, to, data }: { from: number; to: number; data: TimelineItem[] }) => {
    const draggedKey = activeKey;
    const resolved = draggedKey === null ? null : resolveDropDestination(data, draggedKey);
    if (draggedKey !== null && from !== to) {
      const destination = resolved;
      const item = data.find((entry) => entry.key === draggedKey);
      if (destination !== null && item !== undefined && item.type === "block") {
        moveTask(doc, item.block.parent.id, {
          bucket: destination.bucket,
          parentId: null,
          index: destination.index,
          now: new Date().toISOString(),
        });
      }
    }
    resetDrag();
  }, [activeKey, doc, resetDrag]);

  const createTask = () => {
    const input = buildNewTask(newTitle, newTaskBucket, { projected, id: randomUUID(), now: new Date().toISOString() });
    if (input === null) return;
    addTask(doc, input);
    setNewTitle("");
    setCreating(false);
  };

  const startCreating = (bucket: Bucket = { kind: "date", date: today }) => {
    setNewTaskBucket(bucket);
    setCreating(true);
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ animated: true, offset: 0 });
      newTaskInputRef.current?.focus();
    });
  };

  const renderTask = (task: TaskSnapshot, completed: boolean, drag?: () => void) => (
    <TaskRow
      key={task.id}
      task={task}
      completed={completed}
      pendingDelete={isPending(task.id)}
      deleteProgress={progress(task.id)}
      onCancelDelete={() => cancelDelete(task.id)}
      onDelete={() => requestDelete(task.id)}
      onToggle={() => setTaskCompleted(doc, task.id, { completed: task.completedAt === null, at: new Date().toISOString(), on: today })}
      {...(drag !== undefined ? { onLongPress: drag } : {})}
    />
  );

  const renderItem = ({ item, drag, isActive }: RenderItemParams<TimelineItem>) => {
    if (item.type === "header") {
      const [primary, secondary] = sectionLabels(item.bucket, today);
      return (
        <View style={[styles.blockRow, sectionMarginStyle(item.bucket)]}>
          <Pressable
            accessibilityHint="Открывает форму нового дела для этого раздела"
            accessibilityLabel={`Добавить дело: ${primary}${secondary === null ? "" : ` ${secondary}`}`}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => startCreating(item.bucket)}
            style={({ pressed }) => [styles.sectionLabel, pressed ? styles.sectionLabelPressed : undefined]}
          >
            <Text style={styles.primary}>{primary}</Text>
            {secondary ? <Text style={styles.secondary}>{secondary}</Text> : null}
          </Pressable>
          <View style={[styles.tasks, styles.tasksContainer, item.empty ? styles.sectionHeaderLineEmpty : styles.sectionHeaderLine]} />
        </View>
      );
    }
    return (
      <View style={[styles.blockRow, isActive ? styles.dragging : undefined]}>
        <View style={styles.sectionLabelSpacer} />
        <View style={[styles.tasks, styles.tasksContainer]}>
          <View style={styles.taskBlock}>
            {renderTask(item.block.parent, item.block.parent.effectiveCompleted, drag)}
            {item.block.tasks.length <= 1 ? null : (
              <DraggableFlatList
                activationDistance={8}
                data={item.block.tasks.slice(1)}
                keyExtractor={(task) => task.id}
                onDragEnd={({ data, from, to }) => {
                  if (from === to) return;
                  const moved = data[to];
                  if (moved === undefined) return;
                  const destination = resolveChildDropDestination(item.block, moved.id, to);
                  if (destination === null) return;
                  moveTask(doc, destination.taskId, {
                    bucket: destination.bucket,
                    parentId: destination.parentId,
                    index: destination.index,
                    now: new Date().toISOString(),
                  });
                }}
                renderItem={({ item: child, drag: dragChild, isActive: childActive }) => (
                  <View style={childActive ? styles.dragging : undefined}>
                    {renderTask(child, child.effectiveCompleted, dragChild)}
                  </View>
                )}
                scrollEnabled={false}
              />
            )}
          </View>
        </View>
      </View>
    );
  };

  const header = (
    <View style={styles.newTaskHeader}>
      {creating ? (
        <View>
          <View style={styles.sectionChips}>
            {projected.active.map((section) => {
              const [chipLabel] = sectionLabels(section.bucket, today);
              const selected = bucketsEqual(section.bucket, newTaskBucket);
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={sectionKey(section.bucket)}
                  onPress={() => setNewTaskBucket(section.bucket)}
                  style={[styles.sectionChip, selected ? styles.sectionChipActive : undefined]}
                >
                  <Text style={styles.sectionChipText}>{chipLabel}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.newTaskInputRow}>
            <TextInput
              accessibilityLabel="Название нового дела"
              autoFocus
              onChangeText={setNewTitle}
              onSubmitEditing={createTask}
              ref={newTaskInputRef}
              returnKeyType="done"
              style={[styles.input, styles.newTaskInput]}
              value={newTitle}
            />
            <Pressable
              accessibilityLabel="Создать дело"
              accessibilityRole="button"
              onPress={createTask}
              style={styles.newTaskConfirm}
            >
              <Text style={styles.newTaskConfirmText}>ОК</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => startCreating()}>
          <Text style={styles.newTask}>Новое дело</Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <DraggableFlatList
      activationDistance={8}
      containerStyle={styles.timelineContainer}
      data={listItems}
      dragItemOverflow
      keyboardShouldPersistTaps="handled"
      keyExtractor={(item) => item.key}
      ListHeaderComponent={header}
      onDragBegin={handleDragBegin}
      onDragEnd={handleDragEnd}
      ref={captureListRef}
      renderItem={renderItem}
      testID="timeline"
    />
  );
}
