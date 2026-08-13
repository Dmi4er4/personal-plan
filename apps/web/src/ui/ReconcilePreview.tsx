import type {
  ParseDiagnostic,
  ReconcilePreview as ReconcilePreviewModel,
} from "@personal-plan/core";

interface ReconcilePreviewProps {
  documentChanged?: boolean;
  onApply: () => void;
  onCancel: () => void;
  preview: ReconcilePreviewModel;
  restoredDraft?: boolean;
}

const diagnosticMessages: Record<ParseDiagnostic["code"], string> = {
  content_before_section: "Текст находится вне раздела",
  duplicate_far_section: "Дальний раздел повторяется",
  invalid_date_heading: "Некорректная дата в заголовке",
  invalid_indentation: "Отступ должен быть 0 или 2 пробела",
  legacy_near_section_overflow:
    "Блоки после седьмого нужно перенести ниже --------",
  nested_too_deep: "Поддерживается только один уровень подзадач",
  orphan_subtask: "У подзадачи нет родительской задачи",
  unrecognized_heading: "Заголовок раздела не распознан",
};

function changeCount(
  preview: ReconcilePreviewModel,
  kind: ReconcilePreviewModel["changes"][number]["kind"],
): number {
  return preview.changes.filter((change) => change.kind === kind).length;
}

type RemoveChange = Extract<
  ReconcilePreviewModel["changes"][number],
  { kind: "remove" }
>;

export function ReconcilePreview({
  documentChanged = false,
  onApply,
  onCancel,
  preview,
  restoredDraft = false,
}: ReconcilePreviewProps) {
  const hiddenCascadeRemovals = preview.changes.filter(
    (change): change is RemoveChange =>
      change.kind === "remove" && change.hiddenCascade !== undefined,
  );

  return (
    <section aria-label="Предпросмотр изменений" className="reconcile-preview">
      <p className="reconcile-preview-title">Проверьте изменения</p>
      {documentChanged ? (
        <p className="text-conflict" role="alert">
          План изменился после начала редактирования. Проверьте предпросмотр.
        </p>
      ) : null}
      {restoredDraft ? (
        <p className="text-recovery" role="alert">
          Восстановлен черновик после перезапуска. Проверьте его и явно примените
          или отмените изменения.
        </p>
      ) : null}
      <ul className="reconcile-counts">
        <li>Добавить: {changeCount(preview, "create")}</li>
        <li>Изменить: {changeCount(preview, "update")}</li>
        <li>Переместить: {changeCount(preview, "move")}</li>
        <li>Удалить: {changeCount(preview, "remove")}</li>
      </ul>
      {hiddenCascadeRemovals.length === 0 ? null : (
        <div className="reconcile-hidden-cascade" role="alert">
          <p>Скрытые задачи из истории:</p>
          <ul>
            {hiddenCascadeRemovals.map((change) => (
              <li key={change.taskId}>
                {change.hiddenCascade?.title} ({change.taskId})
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview.diagnostics.length > 0 ? (
        <div className="text-diagnostics" role="alert">
          <p>Исправьте ошибки или подтвердите изменения:</p>
          <ul>
            {preview.diagnostics.map((item) => (
              <li key={`${String(item.line)}:${item.code}`}>
                Строка {item.line}: {diagnosticMessages[item.code]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="text-actions">
        <button onClick={onApply} type="button">
          Применить изменения
        </button>
        <button onClick={onCancel} type="button">
          Отменить
        </button>
      </div>
    </section>
  );
}
