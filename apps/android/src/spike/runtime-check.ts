import { randomUUID } from "expo-crypto";
import * as Y from "yjs";

export interface RuntimeCheckResult { yjsRoundTrip: boolean; binaryLength: number; generatedId: string }

export async function runRuntimeCheck(): Promise<RuntimeCheckResult> {
  const source = new Y.Doc();
  source.getText("runtime").insert(0, "ok");
  const update = Y.encodeStateAsUpdate(source);
  const target = new Y.Doc();
  Y.applyUpdate(target, new Uint8Array(update));
  return { yjsRoundTrip: target.getText("runtime").toString() === "ok", binaryLength: update.byteLength, generatedId: randomUUID() };
}
