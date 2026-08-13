export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

export function error(code: string, status: number): Response {
  return json({ error: code }, status);
}

export async function readJson(request: Request, maxBytes = 2_000_000): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null && Number(length) > maxBytes) throw new HttpError("request_too_large", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new HttpError("request_too_large", 413);
  try { return JSON.parse(text) as unknown; } catch { throw new HttpError("invalid_json", 400); }
}

export class HttpError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "HttpError";
  }
}
