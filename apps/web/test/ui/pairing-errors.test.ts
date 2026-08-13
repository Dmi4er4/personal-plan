import { describe, expect, it } from "vitest";
import { RelayHttpError } from "../../src/sync/http-relay-transport";
import { formatPairingError, syncStateLabel } from "../../src/ui/pairing-errors";

describe("web pairing error labels", () => {
  it("maps validation, relay, and native errors to bounded Russian text", () => {
    expect(formatPairingError(new Error("Recovery phrase must contain exactly 24 words"))).toMatch(/24/u);
    expect(formatPairingError(new RelayHttpError("vault_not_found", 404))).toMatch(/нет хранилища/u);
    expect(formatPairingError(new DOMException("The operation timed out", "TimeoutError"))).toMatch(/сервером/u);
    expect(formatPairingError(new Error("[digest] raw internal code"))).toBe("Не удалось подключить устройство");
  });

  it("does not expose internal sync codes", () => {
    expect(syncStateLabel("integrity_error")).toBe("получены повреждённые данные");
    expect(syncStateLabel("some_internal_code")).toBe("не удалось синхронизировать план");
  });
});
