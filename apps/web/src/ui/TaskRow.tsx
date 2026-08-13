import type { ProjectedSection } from "@personal-plan/core";
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import type { CSSProperties } from "react";

type ProjectedTask = ProjectedSection["tasks"][number];

export interface TaskRowProps {
  depth: 0 | 1;
  dragHandle?: {
    attributes: DraggableAttributes;
    listeners: DraggableSyntheticListeners;
    setActivatorNodeRef: (element: HTMLElement | null) => void;
  };
  onCancelDelete?: () => void;
  onDelete?: () => void;
  onToggle: (task: ProjectedTask) => void;
  pendingDelete?: boolean;
  deleteProgress?: number;
  setNodeRef?: (element: HTMLElement | null) => void;
  style?: CSSProperties;
  task: ProjectedTask;
}

export function TaskRow({
  depth,
  dragHandle,
  onCancelDelete,
  onDelete,
  onToggle,
  pendingDelete = false,
  deleteProgress = 0,
  setNodeRef,
  style,
  task,
}: TaskRowProps) {
  const ownCompleted = task.completedAt !== null;

  return (
    <div
      className={`task-row${pendingDelete ? " task-row--pending-delete" : ""}`}
      data-depth={depth}
      data-task-id={task.id}
      ref={setNodeRef}
      style={style}
    >
      <button
        aria-checked={ownCompleted}
        aria-label={`${ownCompleted ? "Вернуть" : "Завершить"}: ${task.title}`}
        className={`task-checkbox${ownCompleted ? " task-checkbox--checked" : ""}${pendingDelete ? " task-checkbox--pending" : ""}`}
        disabled={pendingDelete}
        onClick={() => {
          onToggle(task);
        }}
        role="checkbox"
        type="button"
      />
      <div
        aria-label={dragHandle === undefined ? undefined : `Переместить: ${task.title}`}
        className={`task-copy${dragHandle === undefined ? "" : " task-copy--draggable"}${pendingDelete ? " task-copy--pending-delete" : ""}`}
        onClick={pendingDelete ? onCancelDelete : undefined}
        onKeyDown={
          pendingDelete
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onCancelDelete?.();
                }
              }
            : undefined
        }
        role={pendingDelete ? "button" : dragHandle === undefined ? undefined : "button"}
        tabIndex={pendingDelete ? 0 : dragHandle === undefined ? undefined : 0}
        {...(dragHandle === undefined || pendingDelete ? {} : dragHandle.attributes)}
        {...(dragHandle === undefined || pendingDelete ? {} : dragHandle.listeners)}
        ref={(element) => {
          dragHandle?.setActivatorNodeRef(element);
        }}
      >
        <span
          className={`task-title${task.effectiveCompleted || pendingDelete ? " task-title--completed" : ""}`}
        >
          {task.title}
        </span>
        {task.note === null ? null : <span className="task-note">{task.note}</span>}
        {pendingDelete ? (
          <span aria-hidden="true" className="task-delete-progress">
            <span className="task-delete-progress__fill" style={{ width: `${String(Math.round(deleteProgress * 100))}%` }} />
          </span>
        ) : null}
      </div>
      {onDelete === undefined || pendingDelete ? null : (
        <button
          aria-label={`Удалить: ${task.title}`}
          className="task-delete"
          onClick={onDelete}
          type="button"
        >
          ×
        </button>
      )}
    </div>
  );
}
