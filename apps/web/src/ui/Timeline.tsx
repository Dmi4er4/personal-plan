import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  formatSectionHeading,
  editTask,
  moveTask,
  removeTask,
  setTaskCompleted,
  type Bucket,
  type LocalDate,
  type ProjectedSection,
} from "@personal-plan/core";
import { type ReactNode, useCallback, useState } from "react";

import { usePlan } from "../app/PlanProvider.js";
import { NewTask, type NewTaskRequest } from "./NewTask.js";
import { TaskRow } from "./TaskRow.js";
import { usePendingDelete } from "./use-pending-delete.js";

type ProjectedTask = ProjectedSection["tasks"][number];

interface TaskBlock {
  parent: ProjectedTask;
  children: ProjectedTask[];
}

interface ParentDrag {
  kind: "parent";
  projectedSourceBucketKey: string;
  storedSourceBucketKey: string;
  taskId: string;
}

interface ChildDrag {
  kind: "child";
  parentId: string;
  taskId: string;
}

type ActiveDrag = ParentDrag | ChildDrag;

function dragDataParentId(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("parentId" in data)) {
    return null;
  }
  return typeof data.parentId === "string" ? data.parentId : null;
}

const timelineCollisionDetection: CollisionDetection = (args) => {
  const activeId = String(args.active.id);
  if (activeId.startsWith("child:")) {
    const parentId = dragDataParentId(args.active.data.current);
    const siblingContainers = args.droppableContainers.filter(
      (container) =>
        container.id !== args.active.id &&
        String(container.id).startsWith("child:") &&
        dragDataParentId(container.data.current) === parentId,
    );
    if (args.pointerCoordinates !== null) {
      return pointerWithin({ ...args, droppableContainers: siblingContainers });
    }
    return closestCenter({ ...args, droppableContainers: siblingContainers });
  }

  const parentContainers = args.droppableContainers.filter(
    (container) =>
      container.id !== args.active.id &&
      (String(container.id).startsWith("bucket:") ||
        String(container.id).startsWith("parent:")),
  );
  if (args.pointerCoordinates !== null) {
    return pointerWithin({
      ...args,
      droppableContainers: parentContainers,
    });
  }
  return closestCenter({ ...args, droppableContainers: parentContainers });
};

function bucketKey(bucket: Bucket): string {
  return bucket.kind === "date" ? `date:${bucket.date}` : bucket.kind;
}

function parentDragId(taskId: string): string {
  return `parent:${taskId}`;
}

function childDragId(taskId: string): string {
  return `child:${taskId}`;
}

function bucketDropId(bucket: Bucket): string {
  return `bucket:${bucketKey(bucket)}`;
}

function idSuffix(id: string, prefix: string): string | null {
  return id.startsWith(prefix) ? id.slice(prefix.length) : null;
}

function taskBlocks(tasks: ProjectedTask[]): TaskBlock[] {
  const blocks: TaskBlock[] = [];
  for (const task of tasks) {
    if (task.parentId === null) {
      blocks.push({ parent: task, children: [] });
      continue;
    }
    const parent = blocks.find((block) => block.parent.id === task.parentId);
    parent?.children.push(task);
  }
  return blocks;
}

function sectionLabels(bucket: Bucket, today: LocalDate): [string, string | null] {
  if (bucket.kind === "later") return ["Позже", null];
  if (bucket.kind === "much-later") return ["Сильно позже", null];
  const date = bucket.date;
  const delta = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  const days = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  const d = new Date(`${date}T12:00:00Z`);
  return [
    delta === 0 ? "Сегодня" : delta === 1 ? "Завтра" : days[d.getUTCDay()] ?? "",
    `${String(d.getUTCDate())}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
  ];
}

interface SortableChildProps {
  activeDrag: ActiveDrag | null;
  cancelDelete: (id: string) => void;
  deleteProgress: (id: string) => number;
  isPending: (id: string) => boolean;
  onDelete: (task: ProjectedTask) => void;
  onEdit: (task: ProjectedTask, values: { note: string | null; title: string }) => void;
  onToggle: (task: ProjectedTask) => void;
  task: ProjectedTask;
}

function SortableChild({ activeDrag, cancelDelete, deleteProgress, isPending, onDelete, onEdit, onToggle, task }: SortableChildProps) {
  const disableDrop =
    activeDrag?.kind === "parent" ||
    (activeDrag?.kind === "child" && activeDrag.parentId !== task.parentId);
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: childDragId(task.id),
    data: { kind: "child", parentId: task.parentId, taskId: task.id },
    disabled: { draggable: false, droppable: disableDrop },
  });

  return (
    <TaskRow
      depth={1}
      dragHandle={{
        attributes,
        listeners,
        setActivatorNodeRef: (element) => {
          setActivatorNodeRef(element);
        },
      }}
      onDelete={() => {
        onDelete(task);
      }}
      onEdit={onEdit}
      onCancelDelete={() => {
        cancelDelete(task.id);
      }}
      pendingDelete={isPending(task.id)}
      deleteProgress={deleteProgress(task.id)}
      onToggle={onToggle}
      setNodeRef={(element) => {
        setNodeRef(element);
      }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      task={task}
    />
  );
}

interface SortableBlockProps {
  activeDrag: ActiveDrag | null;
  block: TaskBlock;
  cancelDelete: (id: string) => void;
  deleteProgress: (id: string) => number;
  isPending: (id: string) => boolean;
  onDelete: (task: ProjectedTask) => void;
  onEdit: (task: ProjectedTask, values: { note: string | null; title: string }) => void;
  onToggle: (task: ProjectedTask) => void;
}

function SortableBlock({ activeDrag, block, cancelDelete, deleteProgress, isPending, onDelete, onEdit, onToggle }: SortableBlockProps) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: parentDragId(block.parent.id),
    data: { kind: "parent", taskId: block.parent.id },
    disabled: { draggable: false, droppable: activeDrag?.kind === "child" },
  });

  return (
    <div
      className={`task-block${isDragging ? " task-block--dragging" : ""}`}
      data-drag-task-id={block.parent.id}
      ref={(element) => {
        setNodeRef(element);
      }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <TaskRow
        depth={0}
        dragHandle={{
          attributes,
          listeners,
          setActivatorNodeRef: (element) => {
            setActivatorNodeRef(element);
          },
        }}
        onDelete={() => {
          onDelete(block.parent);
        }}
        onEdit={onEdit}
        onCancelDelete={() => {
          cancelDelete(block.parent.id);
        }}
        pendingDelete={isPending(block.parent.id)}
        deleteProgress={deleteProgress(block.parent.id)}
        onToggle={onToggle}
        task={block.parent}
      />
      <SortableContext
        items={block.children.map(({ id }) => childDragId(id))}
        strategy={verticalListSortingStrategy}
      >
        {block.children.map((child) => (
          <SortableChild
            activeDrag={activeDrag}
            cancelDelete={cancelDelete}
            deleteProgress={deleteProgress}
            isPending={isPending}
            key={child.id}
            onDelete={onDelete}
            onEdit={onEdit}
            onToggle={onToggle}
            task={child}
          />
        ))}
      </SortableContext>
    </div>
  );
}

interface DroppableSectionProps {
  activeDrag: ActiveDrag | null;
  bucket: Bucket;
  children: ReactNode;
  heading: string;
  variant: "default" | "far" | "far-follow";
}

function DroppableSection({
  activeDrag,
  bucket,
  children,
  heading,
  variant,
}: DroppableSectionProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: bucketDropId(bucket),
    data: { bucket, kind: "bucket" },
    disabled:
      activeDrag?.kind === "child" ||
      (activeDrag?.kind === "parent" &&
        activeDrag.storedSourceBucketKey === bucketKey(bucket)),
  });

  return (
    <section
      aria-label={heading}
      className={`timeline-section timeline-section--${variant}${isOver ? " timeline-section--over" : ""}`}
      data-bucket-key={bucketKey(bucket)}
      ref={setNodeRef}
    >
      {children}
    </section>
  );
}

function DragPreview({ activeDrag, sections }: {
  activeDrag: ActiveDrag | null;
  sections: ProjectedSection[];
}) {
  if (activeDrag === null) {
    return null;
  }
  for (const section of sections) {
    const block = taskBlocks(section.tasks).find(({ parent }) =>
      activeDrag.kind === "parent"
        ? parent.id === activeDrag.taskId
        : parent.id === activeDrag.parentId,
    );
    if (block === undefined) {
      continue;
    }
    if (activeDrag.kind === "child") {
      const child = block.children.find(({ id }) => id === activeDrag.taskId);
      return child === undefined ? null : (
        <div className="drag-overlay" aria-hidden="true">{child.title}</div>
      );
    }
    return (
      <div className="drag-overlay" aria-hidden="true">
        <div>{block.parent.title}</div>
        {block.children.map((child) => (
          <div className="drag-overlay-child" key={child.id}>{child.title}</div>
        ))}
      </div>
    );
  }
  return null;
}

export function Timeline({ active = true }: { active?: boolean }) {
  const { doc, projected, snapshot, today } = usePlan();
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [newTaskRequest, setNewTaskRequest] = useState<NewTaskRequest | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const commitDelete = useCallback((id: string) => {
    removeTask(doc, id, { at: new Date().toISOString(), on: today });
  }, [doc, today]);
  const { requestDelete, cancelDelete, progress, isPending } = usePendingDelete(commitDelete, active);

  const toggleTask = (task: ProjectedTask): void => {
    setTaskCompleted(doc, task.id, {
      completed: task.completedAt === null,
      at: new Date().toISOString(),
      on: today,
    });
  };

  const deleteTask = (task: ProjectedTask): void => {
    requestDelete(task.id);
  };

  const editTaskValues = (
    task: ProjectedTask,
    values: { note: string | null; title: string },
  ): void => {
    editTask(doc, task.id, values);
  };

  const requestTaskCreation = (bucket: Bucket): void => {
    setNewTaskRequest((current) => ({
      bucket,
      sequence: (current?.sequence ?? 0) + 1,
    }));
  };

  const visibleSections = projected.active.filter(
    (section) =>
      activeDrag !== null ||
      section.tasks.length > 0 ||
      (section.bucket.kind === "date" && section.bucket.date === today),
  );
  const startDrag = ({ active }: DragStartEvent): void => {
    const id = String(active.id);
    const parentId = idSuffix(id, "parent:");
    if (parentId !== null) {
      const storedParent = snapshot.tasks.find(({ id: taskId }) => taskId === parentId);
      const sourceSection = projected.active.find((section) =>
        section.tasks.some(({ id: taskId }) => taskId === parentId),
      );
      if (sourceSection !== undefined && storedParent !== undefined) {
        setActiveDrag({
          kind: "parent",
          projectedSourceBucketKey: bucketKey(sourceSection.bucket),
          storedSourceBucketKey: bucketKey(storedParent.bucket),
          taskId: parentId,
        });
      }
      return;
    }
    const childId = idSuffix(id, "child:");
    const child = snapshot.tasks.find(({ id: taskId }) => taskId === childId);
    if (childId !== null && child?.parentId !== null && child?.parentId !== undefined) {
      setActiveDrag({ kind: "child", parentId: child.parentId, taskId: childId });
    }
  };

  const endDrag = ({ active, over }: DragEndEvent): void => {
    setActiveDrag(null);
    if (over === null) {
      return;
    }

    const activeId = String(active.id);
    const overId = String(over.id);
    const movingParentId = idSuffix(activeId, "parent:");
    if (movingParentId !== null) {
      let targetParentId = idSuffix(overId, "parent:");
      const targetChildId = idSuffix(overId, "child:");
      if (targetParentId === null && targetChildId !== null) {
        targetParentId = snapshot.tasks.find(({ id }) => id === targetChildId)?.parentId ?? null;
      }

      let destinationSection: ProjectedSection | undefined;
      let destinationIndex = 0;
      if (overId.startsWith("bucket:")) {
        const targetBucketKey = overId.slice("bucket:".length);
        destinationSection = projected.active.find(
          ({ bucket }) => bucketKey(bucket) === targetBucketKey,
        );
        destinationIndex =
          destinationSection === undefined ? 0 : taskBlocks(destinationSection.tasks).length;
      } else if (targetParentId !== null) {
        destinationSection = projected.active.find((section) =>
          section.tasks.some(({ id }) => id === targetParentId),
        );
        destinationIndex =
          destinationSection === undefined
            ? 0
            : taskBlocks(destinationSection.tasks).findIndex(
                ({ parent }) => parent.id === targetParentId,
              );
      }

      if (destinationSection !== undefined && destinationIndex >= 0) {
        moveTask(doc, movingParentId, {
          bucket: destinationSection.bucket,
          parentId: null,
          index: destinationIndex,
          now: new Date().toISOString(),
        });
      }
      return;
    }

    const movingChildId = idSuffix(activeId, "child:");
    const targetChildId = idSuffix(overId, "child:");
    if (movingChildId === null || targetChildId === null) {
      return;
    }
    const movingChild = snapshot.tasks.find(({ id }) => id === movingChildId);
    const targetChild = snapshot.tasks.find(({ id }) => id === targetChildId);
    if (
      movingChild?.parentId === null ||
      movingChild?.parentId === undefined ||
      targetChild?.parentId !== movingChild.parentId
    ) {
      return;
    }
    const siblings = snapshot.tasks.filter(
      ({ parentId }) => parentId === movingChild.parentId,
    );
    const destinationIndex = siblings.findIndex(({ id }) => id === targetChildId);
    if (destinationIndex < 0) {
      return;
    }
    moveTask(doc, movingChildId, {
      bucket: movingChild.bucket,
      parentId: movingChild.parentId,
      index: destinationIndex,
      now: new Date().toISOString(),
    });
  };

  return (
    <DndContext
      collisionDetection={timelineCollisionDetection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragCancel={() => {
        setActiveDrag(null);
      }}
      onDragEnd={endDrag}
      onDragStart={startDrag}
      sensors={sensors}
    >
      <div className="timeline-new-task">
        <NewTask projected={projected} request={newTaskRequest} today={today} />
      </div>
      <div className="timeline">
        {visibleSections.map((section) => {
          const key = bucketKey(section.bucket);
          const heading = formatSectionHeading(section.bucket, today);
          const [primary, secondary] = sectionLabels(section.bucket, today);
          const blocks = taskBlocks(section.tasks);
          const incompleteBlocks = blocks.filter(({ parent }) => !parent.effectiveCompleted);
          const completedBlocks = blocks.filter(({ parent }) => parent.effectiveCompleted);
          const variant = section.bucket.kind === "later"
            ? "far"
            : section.bucket.kind === "much-later"
              ? "far-follow"
              : "default";
          return (
            <DroppableSection
              activeDrag={activeDrag}
              bucket={section.bucket}
              heading={heading}
              key={key}
              variant={variant}
            >
              <button
                aria-label={`Добавить дело: ${heading}`}
                className="timeline-section-label timeline-section-label--button"
                onClick={() => {
                  requestTaskCreation(section.bucket);
                }}
                type="button"
              >
                <span className="timeline-primary">{primary}</span>
                {secondary === null ? null : (
                  <span className="timeline-secondary">{secondary}</span>
                )}
              </button>
              <div className="timeline-tasks">
                <SortableContext
                  items={incompleteBlocks.map(({ parent }) => parentDragId(parent.id))}
                  strategy={verticalListSortingStrategy}
                >
                  {incompleteBlocks.map((block) => (
                    <SortableBlock
                      activeDrag={activeDrag}
                      block={block}
                      cancelDelete={cancelDelete}
                      deleteProgress={progress}
                      isPending={isPending}
                      key={block.parent.id}
                      onDelete={deleteTask}
                      onEdit={editTaskValues}
                      onToggle={toggleTask}
                    />
                  ))}
                </SortableContext>
                {completedBlocks.length === 0 ? null : (
                  <details className="completed-cut">
                    <summary className="completed-cut-summary">
                      Выполненные ({completedBlocks.length})
                    </summary>
                    <SortableContext
                      items={completedBlocks.map(({ parent }) => parentDragId(parent.id))}
                      strategy={verticalListSortingStrategy}
                    >
                      {completedBlocks.map((block) => (
                        <SortableBlock
                          activeDrag={activeDrag}
                          block={block}
                          cancelDelete={cancelDelete}
                          deleteProgress={progress}
                          isPending={isPending}
                          key={block.parent.id}
                          onDelete={deleteTask}
                          onEdit={editTaskValues}
                          onToggle={toggleTask}
                        />
                      ))}
                    </SortableContext>
                  </details>
                )}
              </div>
            </DroppableSection>
          );
        })}
      </div>
      <DragOverlay>
        <DragPreview activeDrag={activeDrag} sections={projected.active} />
      </DragOverlay>
    </DndContext>
  );
}
