import { restoreTask, setTaskCompleted } from "@personal-plan/core";

import { usePlan } from "../app/PlanProvider.js";

export function History() {
  const { doc, projected, snapshot, today } = usePlan();
  const historyIds = new Set(projected.history.map(({ id }) => id));
  const tasksById = new Map(snapshot.records.map((task) => [task.id, task]));

  return (
    <section aria-label="История" className="history">
      <h2 className="history-heading">История</h2>
      {projected.history.length === 0 ? (
        <p className="history-empty">Пока пусто</p>
      ) : (
        <div className="history-items">
          {projected.history.map((task) => {
            const parentIsHistorical =
              task.parentId !== null && historyIds.has(task.parentId);
            const standaloneChild = task.parentId !== null && !parentIsHistorical;
            const canRestore = task.parentId === null || standaloneChild;
            const parent =
              standaloneChild && task.parentId !== null
                ? tasksById.get(task.parentId)
                : undefined;
            const deleted = task.deleted;

            return (
              <article
                className={`history-item${deleted ? " history-item--deleted" : ""}`}
                data-depth={parentIsHistorical ? 1 : 0}
                data-history-task-id={task.id}
                key={task.id}
              >
                <div className="history-copy">
                  <span className={`task-title${deleted ? "" : " task-title--completed"}`}>
                    {task.title}
                  </span>
                  {task.note === null ? null : (
                    <span className="task-note">{task.note}</span>
                  )}
                  {parent === undefined ? null : (
                    <span className="history-parent">Родитель: {parent.title}</span>
                  )}
                  {deleted ? <span className="history-parent">Удалено</span> : null}
                </div>
                {canRestore ? (
                  <button
                    aria-label={`${deleted ? "Восстановить" : "Вернуть из истории"}: ${task.title}`}
                    onClick={() => {
                      if (deleted) {
                        restoreTask(doc, task.id);
                        return;
                      }
                      setTaskCompleted(doc, task.id, {
                        completed: false,
                        at: new Date().toISOString(),
                        on: today,
                      });
                    }}
                    type="button"
                  >
                    {deleted ? "Восстановить" : "Вернуть"}
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
