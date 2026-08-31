import type { ProjectedSection } from "@personal-plan/core";
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { useState, type CSSProperties, type KeyboardEvent, type SyntheticEvent } from "react";

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
  onEdit: (task: ProjectedTask, values: { note: string | null; title: string }) => void;
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
  onEdit,
  onToggle,
  pendingDelete = false,
  deleteProgress = 0,
  setNodeRef,
  style,
  task,
}: TaskRowProps) {
  const ownCompleted = task.completedAt !== null;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [note, setNote] = useState(task.note ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);

  const startEditing = (): void => {
    setTitle(task.title);
    setNote(task.note ?? "");
    setValidationError(null);
    setEditing(true);
  };

  const cancelEditing = (): void => {
    setValidationError(null);
    setEditing(false);
  };

  const save = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>): void => {
    event.preventDefault();
    if (title.trim().length === 0) {
      setValidationError("Введите название дела");
      return;
    }
    onEdit(task, { title, note: note.length === 0 ? null : note });
    setEditing(false);
  };

  const cancelOnEscape = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
    }
  };

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
      {editing ? (
        <form className="task-editor" onSubmit={save}>
          <input
            aria-describedby={validationError === null ? undefined : `task-edit-error-${task.id}`}
            aria-label="Название дела"
            autoFocus
            className="task-edit-input"
            onChange={(event) => {
              setTitle(event.target.value);
              setValidationError(null);
            }}
            onKeyDown={cancelOnEscape}
            value={title}
          />
          <input
            aria-label="Пояснение дела"
            className="task-edit-input task-edit-note"
            onChange={(event) => {
              setNote(event.target.value);
            }}
            onKeyDown={cancelOnEscape}
            placeholder="Пояснение"
            value={note}
          />
          {validationError === null ? null : (
            <span className="task-edit-error" id={`task-edit-error-${task.id}`} role="alert">
              {validationError}
            </span>
          )}
          <span className="task-edit-actions">
            <button aria-label="Сохранить изменения" className="task-edit-save" type="submit">
              Сохранить
            </button>
            <button className="task-edit-cancel" onClick={cancelEditing} type="button">
              Отмена
            </button>
          </span>
        </form>
      ) : <div
        aria-label={dragHandle === undefined ? undefined : `Переместить: ${task.title}`}
        className={`task-copy${dragHandle === undefined ? "" : " task-copy--draggable"}${pendingDelete ? " task-copy--pending-delete" : ""}`}
        onClick={pendingDelete ? onCancelDelete : undefined}
        onDoubleClick={pendingDelete ? undefined : startEditing}
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
      </div>}
      {editing || onDelete === undefined || pendingDelete ? null : (
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
