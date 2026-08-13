import { describe, expect, it } from "vitest";

import { createPairingQr, parsePairingQr, phraseToRootSecret, rootSecretToPhrase } from "../src/index.js";

describe("pairing", () => {
  it("round-trips a 24-word phrase and fragment QR payload", () => {
    const root = Uint8Array.from({ length: 32 }, (_, index) => index);
    const phrase = rootSecretToPhrase(root);
    expect(phrase.split(" ")).toHaveLength(24);
    expect(phraseToRootSecret(phrase)).toEqual(root);
    const qr = createPairingQr("http://127.0.0.1:8787", root);
    expect(qr).toContain("/pair#");
    expect(parsePairingQr(qr).relayUrl).toBe("http://127.0.0.1:8787");
    expect(() => phraseToRootSecret(`${phrase.slice(0, -4)} abandon`)).toThrow();
  });

  it("accepts phrases mangled by a mobile keyboard and rejects bounded input errors", () => {
    const root = Uint8Array.from({ length: 32 }, (_, index) => (index * 7) % 256);
    const words = rootSecretToPhrase(root).split(" ");
    // Title-cased first word, then a non-breaking space and trailing whitespace.
    const keyboardStyle = `${(words[0] ?? "").replace(/^./u, (letter) => letter.toUpperCase())}\u00a0${words.slice(1).join(" ")} `;
    expect(phraseToRootSecret(keyboardStyle)).toEqual(root);
    expect(() => phraseToRootSecret(words.slice(0, 23).join(" "))).toThrow(/exactly 24 words/u);
    expect(() => phraseToRootSecret([...words.slice(0, 23), "нетакое"].join(" "))).toThrow(/outside the English list/u);
    expect(() => phraseToRootSecret([...words.slice(0, 23), words[0] === "abandon" ? "ability" : "abandon"].join(" "))).toThrow(/checksum/u);
  });

  it("decodes the English recovery phrase when the runtime has no String.normalize", () => {
    const root = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
    const phrase = rootSecretToPhrase(root);
    const descriptor = Object.getOwnPropertyDescriptor(String.prototype, "normalize");
    Reflect.deleteProperty(String.prototype, "normalize");
    try {
      expect(phraseToRootSecret(phrase)).toEqual(root);
    } finally {
      if (descriptor !== undefined) Object.defineProperty(String.prototype, "normalize", descriptor);
    }
  });
});
