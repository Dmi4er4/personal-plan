import { useState } from "react";

export function ResetLocalData({ onReset }: { onReset: () => void }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section aria-label="Начать заново" className="settings-danger settings-block">
      <h2>Начать заново</h2>
      {confirming ? (
        <>
          <p className="settings-alert" role="alert">
            Все дела и ключ старого хранилища будут удалены с этого Mac без возможности отмены.
          </p>
          <div className="settings-danger-actions">
            <button className="settings-action" onClick={() => { setConfirming(false); }} type="button">Отмена</button>
            <button className="settings-danger-confirm" onClick={onReset} type="button">Да, удалить всё</button>
          </div>
        </>
      ) : (
        <>
          <p>Удалить локальный план и отключиться от старого хранилища.</p>
          <button className="settings-danger-open" onClick={() => { setConfirming(true); }} type="button">
            Удалить план и создать новое хранилище
          </button>
        </>
      )}
    </section>
  );
}
