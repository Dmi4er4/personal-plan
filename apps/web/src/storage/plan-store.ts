import type * as Y from "yjs";

export type PersistenceState =
  | { error: null; status: "loading" | "saving" | "saved" }
  | { error: Error; status: "error" };

export interface PlanStore {
  load(): Promise<Y.Doc>;
  loadDraft(): Promise<string | null>;
  saveDraft(value: string): Promise<void>;
  clearDraft(): Promise<void>;
  getPersistenceState(): PersistenceState;
  subscribePersistence(listener: (state: PersistenceState) => void): () => void;
  retryPersistence(): Promise<void>;
  destroy(): Promise<void>;
}
