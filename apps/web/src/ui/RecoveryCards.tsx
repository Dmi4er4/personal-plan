import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";

function CopyIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
      <rect height="13" rx="2" stroke="currentColor" strokeWidth="1.75" width="13" x="8" y="8" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path d="M5 12.5 9.5 17 19 7.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
    </svg>
  );
}

export function RecoveryCards({ phrase, qr }: { phrase: string; qr: string | null }) {
  const [copied, setCopied] = useState(false);
  const copyPhrase = (): void => {
    void navigator.clipboard.writeText(phrase).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={`recovery-revealed${qr === null ? "" : " recovery-revealed--with-qr"}`}>
      <p className="recovery-warning">Любой, кто получит эту фразу, получит полный доступ к плану.</p>
      <div className="recovery-phrase-card">
        <div className="recovery-card-header">
          <span className="recovery-card-label">Фраза</span>
          <button
            aria-label={copied ? "Скопировано" : "Копировать фразу"}
            className="recovery-icon-btn"
            onClick={copyPhrase}
            title={copied ? "Скопировано" : "Копировать"}
            type="button"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
        <output aria-label="Фраза восстановления" className="recovery-phrase-text">{phrase}</output>
      </div>
      {qr === null ? null : (
        <div aria-label="QR-код хранилища" className="recovery-qr-card">
          <span className="recovery-card-label">QR</span>
          <QRCodeSVG level="M" marginSize={4} size={168} value={qr} />
        </div>
      )}
    </div>
  );
}
