import { addTaskToIncompleteHead, type Bucket, type LocalDate, type ProjectedPlan } from "@personal-plan/core";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { usePlan } from "../app/PlanProvider.js";

export interface NewTaskProps {
  projected: ProjectedPlan;
  request?: NewTaskRequest | null;
  today: LocalDate;
}

export interface NewTaskRequest {
  bucket: Bucket;
  sequence: number;
}

function bucketsEqual(left: Bucket, right: Bucket): boolean {
  return left.kind === right.kind && (left.kind !== "date" || (right.kind === "date" && left.date === right.date));
}

function bucketLabel(bucket: Bucket, today: LocalDate): string {
  if (bucket.kind === "later") return "Позже";
  if (bucket.kind === "much-later") return "Сильно позже";
  const delta = Math.round((Date.parse(`${bucket.date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  if (delta === 0) return "Сегодня";
  if (delta === 1) return "Завтра";
  return ["вс", "пн", "вт", "ср", "чт", "пт", "сб"][new Date(`${bucket.date}T12:00:00Z`).getUTCDay()] ?? bucket.date;
}

export function NewTask({ projected, request = null, today }: NewTaskProps) {
  const { doc } = usePlan();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [bucket, setBucket] = useState<Bucket>({ kind: "date", date: today });
  const [validationError, setValidationError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (request === null) {
      return;
    }
    setBucket(request.bucket);
    setValidationError(null);
    setEditing(true);
  }, [request]);

  useEffect(() => {
    if (editing) {
      input.current?.focus();
    }
  }, [editing, request]);

  const cancel = (): void => {
    setEditing(false);
    setTitle("");
    setValidationError(null);
  };

  const create = (): void => {
    if (title.trim().length === 0) {
      setValidationError("Введите название дела");
      return;
    }
    addTaskToIncompleteHead(doc, {
      id: crypto.randomUUID(),
      title,
      note: null,
      bucket,
      parentId: null,
      order: 0,
      now: new Date().toISOString(),
    });
    cancel();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      create();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };

  if (!editing) {
    return (
      <button
        className="new-task-trigger"
        onClick={() => {
          setBucket({ kind: "date", date: today });
          setValidationError(null);
          setEditing(true);
        }}
        type="button"
      >
        Новое дело
      </button>
    );
  }

  return (
    <div className="new-task-editor">
      <div aria-label="Раздел нового дела" className="new-task-buckets" role="group">
        {projected.active.map((section) => {
          const selected = bucketsEqual(section.bucket, bucket);
          const label = bucketLabel(section.bucket, today);
          return (
            <button
              aria-pressed={selected}
              className={`new-task-bucket${selected ? " new-task-bucket--selected" : ""}`}
              key={section.bucket.kind === "date" ? section.bucket.date : section.bucket.kind}
              onClick={() => {
                setBucket(section.bucket);
              }}
              type="button"
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="new-task-input-row">
        <input
          aria-describedby={validationError === null ? undefined : "new-task-error"}
          aria-label="Название нового дела"
          className="new-task-input"
          onChange={(event) => {
            setTitle(event.target.value);
            setValidationError(null);
          }}
          onKeyDown={handleKeyDown}
          ref={input}
          type="text"
          value={title}
        />
        <button
          aria-label="Создать дело"
          className="new-task-submit"
          onClick={create}
          type="button"
        >
          ОК
        </button>
      </div>
      {validationError === null ? null : <span className="new-task-error" id="new-task-error" role="alert">{validationError}</span>}
    </div>
  );
}
