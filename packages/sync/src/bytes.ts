export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.includes("=")) {
    throw new TypeError("Invalid unpadded base64url value");
  }
  const padding = (4 - (value.length % 4)) % 4;
  let binary: string;
  try {
    binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat(padding));
  } catch {
    throw new TypeError("Invalid unpadded base64url value");
  }
  const result = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (base64UrlEncode(result) !== value) throw new TypeError("Non-canonical base64url value");
  return result;
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
