import { addTaskToIncompleteHead, editTask, moveTask, projectPlan, removeTask, reorderTaskSequence, setTaskCompleted, snapshotPlan, type Bucket, type ProjectedPlan, type LocalDate, type TaskSnapshot } from "@personal-plan/core";
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Keyboard, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import DraggableFlatList, { type RenderItemParams } from "react-native-draggable-flatlist";
import { ReduceMotion } from "react-native-reanimated";
import type * as Y from "yjs";
import {
  bucketsEqual,
  flattenSections,
  incompleteBlockIdsForBucket,
  resolveChildDropDestination,
  resolveDropDestination,
  sameTimelineOrder,
  sectionKey,
  type TimelineItem,
} from "./timeline-model";
import { TaskRow } from "./TaskRow";
import { buildNewSubtask, buildNewTask, newTaskValidationError } from "./new-task";
import { styles } from "./styles";
import { usePendingDelete } from "./use-pending-delete";

interface TimelineListHandle {
  scrollToOffset: (options: { animated: boolean; offset: number }) => void;
}

const DRAG_ANIMATION_CONFIG = {
  reduceMotion: ReduceMotion.Always,
} as const;

function renderDragPlaceholder({ item }: { item: TimelineItem }) {
  return item.type === "block" ? <View style={styles.dragPlaceholder} /> : null;
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
  const [newTaskError, setNewTaskError] = useState<string | null>(null);
  const [newTaskBucket, setNewTaskBucket] = useState<Bucket>({ kind: "date", date: today });
  const [expandedCompletedSections, setExpandedCompletedSections] = useState<Set<string>>(() => new Set());
  const [editingTask, setEditingTask] = useState<TaskSnapshot | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editValidationError, setEditValidationError] = useState<string | null>(null);
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [newSubtaskError, setNewSubtaskError] = useState<string | null>(null);
  const [optimisticItems, setOptimisticItems] = useState<TimelineItem[] | null>(null);
  const [dragLayoutGeneration, setDragLayoutGeneration] = useState(0);
  const listRef = useRef<TimelineListHandle | null>(null);
  const newTaskInputRef = useRef<TextInput>(null);
  const activeKeyRef = useRef<string | null>(null);

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

  const cancelCreating = useCallback(() => {
    setCreating(false);
    setNewTitle("");
    setNewTaskError(null);
    Keyboard.dismiss();
  }, []);

  useEffect(() => {
    if (!creating) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      cancelCreating();
      return true;
    });
    return () => subscription.remove();
  }, [cancelCreating, creating]);

  // The list data must stay referentially stable while a drag gesture is in
  // flight: swapping `data` mid-gesture makes DraggableFlatList silently cancel
  // the drag (no onDragEnd) and leaves the UI stuck in drag mode. All sections
  // therefore stay in the list at all times — headers have constant height, so
  // empty days double as always-available drop targets for cross-day moves.
  const items = useMemo(
    () => flattenSections(projected.active, expandedCompletedSections),
    [expandedCompletedSections, projected.active],
  );

  useEffect(() => {
    if (optimisticItems === null) return;
    if (sameTimelineOrder(optimisticItems, items)) {
      setOptimisticItems(null);
      return;
    }
    const timer = setTimeout(() => {
      setOptimisticItems(null);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [items, optimisticItems]);

  // Freeze the rendered data for the duration of a drag: async doc updates
  // (sync downloads, widget commands) would otherwise swap `data` mid-gesture
  // and cancel the drop. The frozen copy refreshes on the next render after
  // the gesture ends.
  const frozenItemsRef = useRef<TimelineItem[] | null>(null);
  const listItems = frozenItemsRef.current ?? optimisticItems ?? items;

  const finishDrag = useCallback((data: TimelineItem[]) => {
    frozenItemsRef.current = null;
    setOptimisticItems(data);
    setDragLayoutGeneration((generation) => generation + 1);
    activeKeyRef.current = null;
  }, []);

  const handleDragBegin = useCallback((index: number) => {
    frozenItemsRef.current = items;
    const item = items[index];
    activeKeyRef.current = item !== undefined && item.type === "block" && !item.block.parent.effectiveCompleted
      ? item.key
      : null;
  }, [items]);

  const handleDragEnd = useCallback(({ from, to, data }: { from: number; to: number; data: TimelineItem[] }) => {
    const draggedKey = activeKeyRef.current;
    const resolved = draggedKey === null ? null : resolveDropDestination(data, draggedKey);
    if (draggedKey !== null && from !== to) {
      const destination = resolved;
      const item = data.find((entry) => entry.key === draggedKey);
      if (destination !== null && item !== undefined && item.type === "block") {
        const taskIds = incompleteBlockIdsForBucket(data, destination.bucket);
        if (taskIds.includes(item.block.parent.id)) {
          try {
            reorderTaskSequence(doc, {
              bucket: destination.bucket,
              parentId: null,
              taskIds,
              movedTaskId: item.block.parent.id,
              now: new Date().toISOString(),
            });
            const snapshot = snapshotPlan(doc);
            const projectedAfterDrop = projectPlan(snapshot.tasks, today, snapshot.records);
            finishDrag(flattenSections(projectedAfterDrop.active, expandedCompletedSections));
            return;
          } catch (reason) {
            console.warn("task reorder failed", reason instanceof Error ? reason.message : String(reason));
          }
        }
      }
    }
    finishDrag(items);
  }, [doc, expandedCompletedSections, finishDrag, items, today]);

  const createTask = () => {
    const validationError = newTaskValidationError(newTitle);
    if (validationError !== null) {
      setNewTaskError(validationError);
      return;
    }
    const input = buildNewTask(newTitle, newTaskBucket, { id: randomUUID(), now: new Date().toISOString() });
    if (input === null) return;
    addTaskToIncompleteHead(doc, input);
    setNewTitle("");
    setNewTaskError(null);
    setCreating(false);
  };

  const startCreating = (bucket: Bucket = { kind: "date", date: today }) => {
    setNewTaskBucket(bucket);
    setNewTaskError(null);
    setCreating(true);
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ animated: true, offset: 0 });
      newTaskInputRef.current?.focus();
    });
  };

  const toggleCompletedSection = (bucket: Bucket): void => {
    const key = sectionKey(bucket);
    setExpandedCompletedSections((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const startEditing = (task: TaskSnapshot): void => {
    setEditingTask(task);
    setEditTitle(task.title);
    setEditNote(task.note ?? "");
    setEditValidationError(null);
    setAddingSubtask(false);
    setNewSubtaskTitle("");
    setNewSubtaskError(null);
  };

  const cancelEditing = (): void => {
    setEditingTask(null);
    setEditValidationError(null);
    setAddingSubtask(false);
    setNewSubtaskTitle("");
    setNewSubtaskError(null);
  };

  const saveTaskEdit = (): void => {
    if (editingTask === null) return;
    if (editTitle.trim().length === 0) {
      setEditValidationError("Введите название дела");
      return;
    }
    editTask(doc, editingTask.id, {
      title: editTitle,
      note: editNote.length === 0 ? null : editNote,
    });
    cancelEditing();
  };

  const editingChildren = useMemo(() => {
    if (editingTask === null || editingTask.parentId !== null) return [];
    return snapshotPlan(doc).tasks.filter(({ parentId }) => parentId === editingTask.id);
  }, [doc, editingTask, projected]);

  const createSubtask = (): void => {
    if (editingTask === null || editingTask.parentId !== null) return;
    const parent = snapshotPlan(doc).tasks.find(({ id }) => id === editingTask.id);
    if (parent === undefined) {
      setNewSubtaskError("Родительское дело больше не существует");
      return;
    }
    const validationError = newTaskValidationError(newSubtaskTitle);
    if (validationError !== null) {
      setNewSubtaskError(validationError);
      return;
    }
    const input = buildNewSubtask(newSubtaskTitle, parent, {
      id: randomUUID(),
      now: new Date().toISOString(),
    });
    if (input === null) return;
    addTaskToIncompleteHead(doc, input);
    setNewSubtaskTitle("");
    setNewSubtaskError(null);
    setAddingSubtask(false);
  };

  const renderTask = (task: TaskSnapshot, completed: boolean, drag?: () => void) => (
    <TaskRow
      key={task.id}
      task={task}
      completed={completed}
      pendingDelete={isPending(task.id)}
      deleteProgress={progress(task.id)}
      onCancelDelete={() => cancelDelete(task.id)}
      onOpen={() => startEditing(task)}
      {...(drag !== undefined ? { onLongPress: drag } : {})}
      onToggle={() => setTaskCompleted(doc, task.id, { completed: task.completedAt === null, at: new Date().toISOString(), on: today })}
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
          <View style={[styles.tasks, styles.tasksContainer, item.empty ? styles.sectionHeaderLineEmpty : styles.sectionHeaderLine]}>
            {item.bucket.kind === "date" && item.key !== items[0]?.key ? (
              <View pointerEvents="none" style={styles.dayDivider} />
            ) : null}
          </View>
        </View>
      );
    }
    if (item.type === "completed-header") {
      return (
        <View style={styles.blockRow}>
          <View style={styles.sectionLabelSpacer} />
          <Pressable
            accessibilityLabel={`${item.expanded ? "Скрыть" : "Показать"} выполненные дела: ${item.count}`}
            accessibilityRole="button"
            accessibilityState={{ expanded: item.expanded }}
            onPress={() => toggleCompletedSection(item.bucket)}
            style={({ pressed }) => [styles.completedCut, pressed ? styles.completedCutPressed : undefined]}
          >
            <Text style={styles.completedCutText}>
              {item.expanded ? "▾" : "▸"} Выполненные ({item.count})
            </Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={[styles.blockRow, isActive ? styles.dragging : undefined]}>
        <View style={styles.sectionLabelSpacer} />
        <View style={[styles.tasks, styles.tasksContainer]}>
          <View style={styles.taskBlock}>
            {renderTask(
              item.block.parent,
              item.block.parent.effectiveCompleted,
              item.block.parent.effectiveCompleted ? undefined : drag,
            )}
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
                  setDragLayoutGeneration((generation) => generation + 1);
                }}
                renderItem={({ item: child, drag: dragChild, isActive: childActive }) => (
                  <View style={childActive ? styles.dragging : undefined}>
                    {renderTask(child, child.effectiveCompleted, child.effectiveCompleted ? undefined : dragChild)}
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
              onChangeText={(value) => {
                setNewTitle(value);
                setNewTaskError(null);
              }}
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
            <Pressable
              accessibilityLabel="Отменить создание дела"
              accessibilityRole="button"
              onPress={cancelCreating}
              style={styles.newTaskCancel}
            >
              <Text style={styles.newTaskCancelText}>Отмена</Text>
            </Pressable>
          </View>
          {newTaskError === null ? null : <Text accessibilityRole="alert" style={styles.error}>{newTaskError}</Text>}
        </View>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => startCreating()}>
          <Text style={styles.newTask}>Новое дело</Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <>
      <DraggableFlatList
        activationDistance={8}
        animationConfig={DRAG_ANIMATION_CONFIG}
        autoscrollSpeed={80}
        autoscrollThreshold={72}
        containerStyle={styles.timelineContainer}
        data={listItems}
        dragItemOverflow
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => `${String(dragLayoutGeneration)}:${item.key}`}
        ListHeaderComponent={header}
        onDragBegin={handleDragBegin}
        onDragEnd={handleDragEnd}
        ref={captureListRef}
        renderItem={renderItem}
        renderPlaceholder={renderDragPlaceholder}
        testID="timeline"
      />
      <Modal
        animationType="fade"
        onRequestClose={cancelEditing}
        transparent
        visible={editingTask !== null}
      >
        <View style={styles.editModalBackdrop}>
          <View style={styles.editModalCard}>
            <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.editModalTitle}>Редактировать дело</Text>
            <Text style={styles.inputLabel}>Название</Text>
            <TextInput
              accessibilityLabel="Название дела"
              autoFocus
              onChangeText={(value) => {
                setEditTitle(value);
                setEditValidationError(null);
              }}
              onSubmitEditing={saveTaskEdit}
              returnKeyType="done"
              style={styles.input}
              value={editTitle}
            />
            <Text style={styles.inputLabel}>Пояснение</Text>
            <TextInput
              accessibilityLabel="Пояснение дела"
              onChangeText={setEditNote}
              placeholder="Пояснение"
              style={styles.input}
              value={editNote}
            />
            {editValidationError === null ? null : (
              <Text accessibilityRole="alert" style={styles.error}>{editValidationError}</Text>
            )}
            {editingTask === null || editingTask.parentId !== null ? null : (
              <View style={styles.subtaskEditor}>
                {editingChildren.length === 0 ? null : (
                  <>
                    <Text style={styles.inputLabel}>Подзадачи</Text>
                    {editingChildren.map((child) => (
                      <View key={child.id} style={styles.subtaskPreview}>
                        <View style={[styles.checkbox, child.completedAt === null ? undefined : styles.checkboxDone]}>
                          {child.completedAt === null ? null : <Text style={styles.check}>✓</Text>}
                        </View>
                        <Text style={[styles.subtaskPreviewText, child.completedAt === null ? undefined : styles.completed]}>{child.title}</Text>
                      </View>
                    ))}
                  </>
                )}
                {editingTask.completedAt !== null ? null : addingSubtask ? (
                  <>
                    <View style={styles.subtaskInputRow}>
                      <TextInput
                        accessibilityLabel="Название новой подзадачи"
                        autoFocus
                        onChangeText={(value) => {
                          setNewSubtaskTitle(value);
                          setNewSubtaskError(null);
                        }}
                        onSubmitEditing={createSubtask}
                        placeholder="Название подзадачи"
                        returnKeyType="done"
                        style={[styles.input, styles.subtaskInput]}
                        value={newSubtaskTitle}
                      />
                      <Pressable accessibilityRole="button" onPress={createSubtask} style={styles.subtaskAddButton}>
                        <Text style={styles.subtaskAddButtonText}>Добавить</Text>
                      </Pressable>
                    </View>
                    {newSubtaskError === null ? null : <Text accessibilityRole="alert" style={styles.error}>{newSubtaskError}</Text>}
                  </>
                ) : (
                  <Pressable accessibilityRole="button" onPress={() => setAddingSubtask(true)} style={styles.inlineAction}>
                    <Text style={styles.inlineActionText}>+ Добавить подзадачу</Text>
                  </Pressable>
                )}
              </View>
            )}
            <View style={styles.editModalActions}>
              <Pressable
                accessibilityLabel="Сохранить изменения"
                accessibilityRole="button"
                onPress={saveTaskEdit}
                style={styles.button}
              >
                <Text style={styles.buttonText}>Сохранить</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={cancelEditing}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>Отмена</Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityLabel={`Удалить: ${editingTask?.title ?? "дело"}`}
              accessibilityRole="button"
              onPress={() => {
                if (editingTask === null) return;
                const id = editingTask.id;
                cancelEditing();
                requestDelete(id);
              }}
              style={styles.destructiveButton}
            >
              <Text style={styles.destructiveButtonText}>Удалить дело</Text>
            </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
