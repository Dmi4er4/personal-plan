import type * as Y from "yjs";

const revisions = new WeakMap<Y.Doc, { value: number }>();

/** Tracks deletions as well as insertions, without serializing the document. */
export function documentRevision(doc: Y.Doc): number {
  let revision = revisions.get(doc);
  if (revision === undefined) {
    revision = { value: 0 };
    revisions.set(doc, revision);
    const counter = revision;
    doc.on("update", () => { counter.value += 1; });
  }
  return revision.value;
}
