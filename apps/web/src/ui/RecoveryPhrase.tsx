import { useState } from "react";

import { useWebSync } from "../sync/WebSyncProvider.js";
import { RecoveryCards } from "./RecoveryCards.js";

export function RecoveryPhrase() {
  const sync = useWebSync();
  const [phrase, setPhrase] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  if (!sync.enabled || !sync.configured) return null;

  return (
    <section aria-label="Восстановление" className="recovery-section">
      <button
        className="recovery-reveal-btn"
        onClick={() => { void Promise.all([sync.revealPhrase(), sync.pairingQr()]).then(([nextPhrase, nextQr]) => { setPhrase(nextPhrase); setQr(nextQr); }); }}
        type="button"
      >
        Показать фразу восстановления
      </button>
      {phrase === null ? null : <RecoveryCards phrase={phrase} qr={qr} />}
    </section>
  );
}
