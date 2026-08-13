export function formatPhraseValidationError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/exactly 24 words/u.test(message)) {
    return "Нужно ровно 24 английских слова через пробел";
  }
  if (/outside the English list/u.test(message)) {
    return "Фраза содержит слово вне английского списка BIP-39";
  }
  if (/checksum/u.test(message)) {
    return "Контрольная сумма фразы не сходится — проверьте порядок слов";
  }
  return "Не удалось разобрать фразу восстановления";
}

export function formatVaultSetupError(reason: unknown): string {
  // Only bounded, user-facing messages produced by our own configure() flow may
  // reach the UI; raw native/library errors get a generic fallback.
  if (reason instanceof Error && reason.message.startsWith("Не удалось")) {
    return reason.message;
  }
  return "Не удалось настроить хранилище на этом устройстве";
}
