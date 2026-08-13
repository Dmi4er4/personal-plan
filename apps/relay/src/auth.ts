import { base64UrlDecode, base64UrlEncode } from "@personal-plan/sync";

export function parseBearer(request: Request): Uint8Array | null {
  const value = request.headers.get("authorization");
  if (value === null || !value.startsWith("Bearer ")) return null;
  try {
    const token = base64UrlDecode(value.slice(7));
    return token.length === 32 ? token : null;
  } catch { return null; }
}

export async function verifierFor(token: Uint8Array): Promise<string> {
  return base64UrlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", token.slice().buffer)));
}

export function constantTimeVerifierEqual(left: string, right: string): boolean {
  let leftBytes: Uint8Array;
  let rightBytes: Uint8Array;
  try { leftBytes = base64UrlDecode(left); rightBytes = base64UrlDecode(right); } catch { return false; }
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  return difference === 0;
}
