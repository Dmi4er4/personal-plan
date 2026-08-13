import { describe, expect, it } from "vitest";

import { formatPhraseValidationError, formatVaultSetupError } from "../../src/ui/pairing-errors";

describe("pairing-errors", () => {
  it("maps phrase validation errors to user-facing Russian messages", () => {
    expect(formatPhraseValidationError(new TypeError("Recovery phrase must contain exactly 24 words"))).toMatch(/24/u);
    expect(formatPhraseValidationError(new TypeError("Recovery phrase contains a word outside the English list"))).toMatch(/BIP-39/u);
    expect(formatPhraseValidationError(new TypeError("Invalid recovery phrase checksum"))).toMatch(/сумма/u);
  });

  it("passes through vault setup errors", () => {
    expect(formatVaultSetupError(new Error("Не удалось сохранить ключи"))).toBe("Не удалось сохранить ключи");
    expect(formatVaultSetupError("boom")).toMatch(/настроить хранилище/u);
  });

  it("bounds raw native errors to a generic message", () => {
    expect(formatVaultSetupError(new Error("[digest] Cannot convert '[object ArrayBuffer]' to a Kotlin type"))).toBe("Не удалось настроить хранилище на этом устройстве");
  });
});
