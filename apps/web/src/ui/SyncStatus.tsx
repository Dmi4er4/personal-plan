import { useWebSync } from "../sync/WebSyncProvider.js";
import { syncStateLabel } from "./pairing-errors.js";

export function SyncStatus() {
  const { state } = useWebSync();
  const label = state.kind === "local-only" ? "только на этом устройстве"
    : state.kind === "syncing" ? "синхронизация…"
      : state.kind === "synced" ? "синхронизировано"
        : state.kind === "pending" ? `ожидает синхронизации (${String(state.count)})`
          : state.kind === "offline" ? `офлайн (${String(state.count)})`
            : `ошибка синхронизации: ${syncStateLabel(state.code)}`;
  return <p aria-label="Состояние синхронизации" role="status">{label}</p>;
}
