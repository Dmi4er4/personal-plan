import * as Y from "yjs";

function sharedContent(type: Y.AbstractType<unknown>): unknown {
  const map = Object.fromEntries([...type._map].filter(([, item]) => !item.deleted).map(([key, item]) => [key, item.content.getContent()]));
  const sequence: unknown[] = [];
  let text = "";
  const flushText = (): void => { if (text !== "") { sequence.push(["text", text]); text = ""; } };
  for (let item = type._start; item !== null; item = item.right) {
    if (item.deleted) continue;
    if (item.content instanceof Y.ContentString) { text += item.content.str; continue; }
    flushText();
    if (item.content instanceof Y.ContentFormat) sequence.push(["format", item.content.key, item.content.value]);
    else for (const value of item.content.getContent()) sequence.push(["value", value]);
  }
  flushText();
  return { map, sequence };
}

function canonical(value: unknown): string {
  if (value instanceof Y.Doc) throw new TypeError("unsupported_checkpoint_subdocument");
  if (value instanceof Y.AbstractType) return canonical(sharedContent(value));
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return `${String(value)}n`;
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}

/** Stable logical content; the sync layer also binds it to clocks/deletions. */
export function planCheckpointContent(doc: Y.Doc): Uint8Array | null {
  // Inspect logical entries directly: replayed root types can still be
  // unmaterialized, and old documents may contain additional shared roots.
  // Omit empty roots, which carry no operations and are not encoded by Yjs.
  const roots = [...doc.share].filter(([, type]) => [...type._map.values()].some((item) => !item.deleted) || type._start !== null);
  try { return new TextEncoder().encode(canonical(Object.fromEntries(roots))); }
  catch { return null; }
}
