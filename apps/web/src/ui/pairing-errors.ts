import { RelayHttpError } from "../sync/http-relay-transport.js";

function isTimeout(reason: unknown): boolean {
  if (typeof reason !== "object" || reason === null || !("name" in reason)) return false;
  const name = reason.name;
  return name === "AbortError" || name === "TimeoutError";
}

export function formatPairingError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : "";
  if (/exactly 24 words/u.test(message)) return "Нужно ровно 24 английских слова через пробел";
  if (/outside the English list/u.test(message)) return "Фраза содержит слово вне английского списка BIP-39";
  if (/checksum/u.test(message)) return "Контрольная сумма фразы не сходится — проверьте порядок слов";
  if (message === "vault_mismatch") return "Эта фраза относится к другому плану. Текущий локальный план не изменён";
  if (reason instanceof RelayHttpError && reason.status === 404) return "На сервере нет хранилища с этой фразой";
  if (reason instanceof RelayHttpError && (reason.status === 401 || reason.status === 403)) return "Фраза не подходит к хранилищу на сервере";
  if (reason instanceof RelayHttpError && reason.status === 409) return "На сервере уже есть другое хранилище с таким идентификатором";
  if (reason instanceof TypeError || isTimeout(reason)) return "Не удалось связаться с сервером — проверьте сеть";
  return "Не удалось подключить устройство";
}

export function syncStateLabel(kind: string): string {
  if (kind === "integrity_error") return "получены повреждённые данные";
  if (kind === "network_unavailable" || kind === "timeout") return "сервер временно недоступен";
  return "не удалось синхронизировать план";
}
