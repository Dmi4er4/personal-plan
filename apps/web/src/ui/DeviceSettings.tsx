import { useState } from "react";
import { useWebSync } from "../sync/WebSyncProvider.js";
import { PairDevice } from "./PairDevice.js";

export function DeviceSettings() {
  const sync = useWebSync();
  const [reconnecting, setReconnecting] = useState(false);
  if (!sync.enabled || !sync.configured) return null;
  return (
    <section aria-label="Устройство" className="settings-device">
      <h2>Устройство</h2>
      <p>Mac подключён{sync.relayUrl === null ? "" : ` · ${new URL(sync.relayUrl).host}`}</p>
      <button className="settings-action" onClick={() => setReconnecting((value) => !value)} type="button">
        {reconnecting ? "Отмена" : "Переподключить устройство"}
      </button>
      {reconnecting ? <PairDevice allowConfigured /> : null}
    </section>
  );
}
