import { useState } from "react";

export function RestoreServerData({ onRestore }: { onRestore: () => void }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section aria-label="Восстановить с сервера" className="settings-block">
      <h2>Восстановить с сервера</h2>
      {confirming ? (
        <>
          <p className="settings-alert" role="alert">
            Несинхронизированные изменения на этом Mac будут потеряны. Ключ подключения сохранится.
          </p>
          <div className="settings-danger-actions">
            <button className="settings-action" onClick={() => { setConfirming(false); }} type="button">Отмена</button>
            <button className="settings-danger-confirm" onClick={onRestore} type="button">Да, заменить локальный план</button>
          </div>
        </>
      ) : (
        <>
          <p>Удалить локальную копию плана на этом Mac и заново скачать данные из подключённого хранилища.</p>
          <button className="settings-action" onClick={() => { setConfirming(true); }} type="button">
            Заменить локальный план данными с сервера
          </button>
        </>
      )}
    </section>
  );
}
