import { usePlan } from "../app/PlanProvider.js";
import { History } from "./History.js";
import { DeviceSettings } from "./DeviceSettings.js";
import { RecoveryPhrase } from "./RecoveryPhrase.js";
import { ResetLocalData } from "./ResetLocalData.js";
import { RestoreServerData } from "./RestoreServerData.js";
import { SyncStatus } from "./SyncStatus.js";

export function Settings({ onClose, onResetLocalData, onRestoreServerData }: { onClose: () => void; onResetLocalData?: (() => void) | undefined; onRestoreServerData?: (() => void) | undefined }) {
  const plan = usePlan();
  const { persistence } = plan;

  return (
    <div className="settings">
      <header className="settings-header">
        <button className="settings-back" onClick={onClose} type="button">
          ← Назад
        </button>
        <h1 className="settings-title">Настройки</h1>
      </header>
      <SyncStatus />
      <RecoveryPhrase />
      <DeviceSettings />
      <History />
      {onRestoreServerData === undefined ? null : <RestoreServerData onRestore={onRestoreServerData} />}
      {onResetLocalData === undefined ? null : <ResetLocalData onReset={onResetLocalData} />}
      {persistence.status === "error" ? (
        <div className="settings-block">
          <p className="settings-alert" role="alert">
            не удалось сохранить на устройстве: {persistence.error.message}
          </p>
          <button
            className="settings-action"
            onClick={() => {
              void plan.retryPersistence().catch(() => undefined);
            }}
            type="button"
          >
            Повторить сохранение
          </button>
        </div>
      ) : (
        <p className="settings-status" role="status">
          {persistence.status === "loading"
            ? "загрузка сохранения…"
            : persistence.status === "saving"
              ? "сохранение на устройстве…"
              : "сохранено на устройстве"}
        </p>
      )}
    </div>
  );
}
