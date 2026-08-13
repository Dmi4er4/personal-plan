import { entropyToMnemonic, mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

import { base64UrlDecode, base64UrlEncode } from "./bytes.js";

export interface PairingPayloadV1 {
  version: 1;
  relayUrl: string;
  rootSecret: string;
}

const PHRASE_WORD_COUNT = 24;

// Mobile keyboards routinely title-case the first word and insert non-breaking
// or ideographic spaces. The English BIP-39 wordlist is entirely lowercase, so
// folding case and collapsing whitespace stays unambiguous.
function normalizedPhrase(phrase: string): string {
  const nfkd = typeof String.prototype.normalize === "function" ? phrase.normalize("NFKD") : phrase;
  return nfkd.toLowerCase().trim().split(/\s+/u).join(" ");
}

function validateRelayUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError("Invalid relay URL"); }
  const localHttp = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !localHttp) throw new TypeError("Relay URL must use HTTPS");
  if (url.username !== "" || url.password !== "") throw new TypeError("Relay URL must not contain credentials");
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/u, "");
}

export function rootSecretToPhrase(rootSecret: Uint8Array): string {
  if (rootSecret.length !== 32) throw new RangeError("Root secret must contain exactly 32 bytes");
  return entropyToMnemonic(rootSecret, wordlist);
}

export function phraseToRootSecret(phrase: string): Uint8Array {
  const normalized = normalizedPhrase(phrase);
  const words = normalized === "" ? [] : normalized.split(" ");
  if (words.length !== PHRASE_WORD_COUNT) throw new TypeError("Recovery phrase must contain exactly 24 words");
  if (!words.every((word) => wordlist.includes(word))) throw new TypeError("Recovery phrase contains a word outside the English list");
  let result: Uint8Array;
  if (typeof String.prototype.normalize === "function") {
    try { result = mnemonicToEntropy(normalized, wordlist); } catch { throw new TypeError("Invalid recovery phrase checksum"); }
  } else {
    Object.defineProperty(String.prototype, "normalize", { configurable: true, value(this: string) { return this; } });
    try { result = mnemonicToEntropy(normalized, wordlist); } catch { throw new TypeError("Invalid recovery phrase checksum"); } finally { Reflect.deleteProperty(String.prototype, "normalize"); }
  }
  if (result.length !== 32) throw new TypeError("Recovery phrase must encode 32 bytes");
  return result;
}

export function createPairingQr(relayUrl: string, rootSecret: Uint8Array): string {
  if (rootSecret.length !== 32) throw new RangeError("Root secret must contain exactly 32 bytes");
  const params = new URLSearchParams({ v: "1", r: validateRelayUrl(relayUrl), s: base64UrlEncode(rootSecret) });
  return `https://plan.local/pair#${params.toString()}`;
}

export function parsePairingQr(value: string): PairingPayloadV1 {
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError("Invalid pairing QR payload"); }
  if (url.origin !== "https://plan.local" || url.pathname !== "/pair") throw new TypeError("Invalid pairing QR payload");
  const params = new URLSearchParams(url.hash.slice(1));
  if (params.get("v") !== "1" || params.get("r") === null || params.get("s") === null) throw new TypeError("Unsupported pairing QR payload");
  const rootSecret = base64UrlDecode(params.get("s") ?? "");
  if (rootSecret.length !== 32) throw new TypeError("Pairing root secret must contain exactly 32 bytes");
  return { version: 1, relayUrl: validateRelayUrl(params.get("r") ?? ""), rootSecret: base64UrlEncode(rootSecret) };
}
