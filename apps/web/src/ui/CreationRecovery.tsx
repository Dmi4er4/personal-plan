import { useWebSync } from "../sync/WebSyncProvider.js";
import { RecoveryCards } from "./RecoveryCards.js";

export function CreationRecovery() {
  const sync = useWebSync();
  const recovery = sync.creationRecovery;
  if (recovery === null) return null;
  return (
    <section aria-label="Сохранение фразы восстановления" className="creation-recovery">
      <h1>Сохраните фразу восстановления</h1>
      <p>Она понадобится для подключения телефона и восстановления доступа.</p>
      <RecoveryCards phrase={recovery.phrase} qr={recovery.qr} />
      <button className="settings-action" onClick={() => { void sync.confirmCreationRecovery(); }} type="button">Я сохранил фразу</button>
    </section>
  );
}
