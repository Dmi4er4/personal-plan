import { useState } from "react";

import { useWebSync } from "../sync/WebSyncProvider.js";
import { formatPairingError } from "./pairing-errors.js";

export function PairDevice({ allowConfigured = false }: { allowConfigured?: boolean }) {
  const sync = useWebSync();
  const [phrase, setPhrase] = useState("");
  const [qr, setQr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!sync.enabled || (sync.configured && !allowConfigured)) return null;
  const run = (operation: () => Promise<void>): void => {
    setError(null);
    setBusy(true);
    void operation()
      .catch((reason: unknown) => { setError(formatPairingError(reason)); })
      .finally(() => { setBusy(false); });
  };
  return (
    <section aria-label="Зашифрованная синхронизация" className={`pairing${sync.configured ? " pairing--inline" : " pairing--onboarding"}`}>
      {sync.configured ? null : <>
        <h1>Подключить личный план</h1>
        <button className="pairing-primary" disabled={busy} onClick={() => { run(() => sync.createVault()); }} type="button">Создать новое хранилище</button>
        <div aria-hidden="true" className="pairing-divider"><span>или подключить существующее</span></div>
      </>}
      <label className="pairing-field"><span>Фраза восстановления</span><textarea autoCapitalize="none" autoCorrect="off" onChange={(event) => { setPhrase(event.target.value); }} spellCheck="false" value={phrase} /></label>
      <button disabled={busy} onClick={() => { run(() => sync.restorePhrase(phrase)); }} type="button">Подключить по фразе</button>
      <label className="pairing-field"><span>Данные QR-кода</span><input onChange={(event) => { setQr(event.target.value); }} value={qr} /></label>
      <button disabled={busy} onClick={() => { run(() => sync.restoreQr(qr)); }} type="button">Подключить по QR</button>
      {error === null ? null : <p role="alert">{error}</p>}
    </section>
  );
}
