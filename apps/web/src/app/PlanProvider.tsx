import {
  getPlanDate,
  pruneExpiredHistory,
  projectPlan,
  snapshotPlan,
  startPlanDayClock,
  type LocalDate,
} from "@personal-plan/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type * as Y from "yjs";

import type {
  PersistenceState,
  PlanStore,
} from "../storage/plan-store.js";

export interface PlanContextValue {
  doc: Y.Doc;
  today: LocalDate;
  snapshot: ReturnType<typeof snapshotPlan>;
  projected: ReturnType<typeof projectPlan>;
  draft: string | null;
  setDraft(value: string): Promise<void>;
  clearDraft(): Promise<void>;
  persistence: PersistenceState;
  retryPersistence(): Promise<void>;
  flushPersistence: () => Promise<void>;
  checkpointBytes?: ((doc: Y.Doc) => Promise<Uint8Array | null>) | undefined;
}

export interface PlanProviderProps {
  children: ReactNode;
  clock?: () => Date;
  store: PlanStore;
  today?: () => LocalDate;
}

interface LoadedPlan {
  doc: Y.Doc;
  draft: string | null;
}

const PlanContext = createContext<PlanContextValue | null>(null);

function systemClock(): Date {
  return new Date();
}

export function PlanProvider({
  children,
  clock = systemClock,
  store,
  today,
}: PlanProviderProps) {
  const todayProvider = useMemo(
    () => today ?? (() => getPlanDate(clock())),
    [clock, today],
  );
  const [localToday, setLocalToday] = useState<LocalDate>(() => todayProvider());
  const [loaded, setLoaded] = useState<LoadedPlan | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);
  const [persistence, setPersistence] = useState<PersistenceState>(() =>
    store.getPersistenceState(),
  );
  const localTodayRef = useRef(localToday);
  const lastPruned = useRef<{ date: LocalDate; doc: Y.Doc } | null>(null);
  localTodayRef.current = localToday;

  useEffect(
    () => store.subscribePersistence(setPersistence),
    [store],
  );

  useEffect(() => {
    const dayClock = startPlanDayClock(setLocalToday, { clock, today: todayProvider });
    const resume = dayClock.refresh;
    const visibilityResume = (): void => {
      if (document.visibilityState === "visible") {
        resume();
      }
    };

    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", visibilityResume);
    return () => {
      dayClock.stop();
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", visibilityResume);
    };
  }, [clock, todayProvider]);

  useEffect(() => {
    let active = true;
    let loadedDoc: Y.Doc | null = null;
    const refresh = (): void => {
      setRevision((value) => value + 1);
    };

    setLoaded(null);
    setError(null);
    void Promise.all([store.load(), store.loadDraft()])
      .then(([doc, draft]) => {
        if (!active) {
          return;
        }
        loadedDoc = doc;
        const loadedToday = localTodayRef.current;
        pruneExpiredHistory(doc, loadedToday);
        lastPruned.current = { date: loadedToday, doc };
        doc.on("update", refresh);
        setLoaded({ doc, draft });
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason : new Error("Не удалось открыть план"));
        }
      });

    return () => {
      active = false;
      loadedDoc?.off("update", refresh);
      void store.destroy().catch(() => undefined);
    };
  }, [store]);

  const loadedDoc = loaded?.doc ?? null;
  useEffect(() => {
    if (loadedDoc === null) {
      return;
    }
    const previous = lastPruned.current;
    if (previous?.doc === loadedDoc && previous.date === localToday) {
      return;
    }
    lastPruned.current = { date: localToday, doc: loadedDoc };
    pruneExpiredHistory(loadedDoc, localToday);
  }, [loadedDoc, localToday]);

  const setDraft = useCallback(
    async (value: string): Promise<void> => {
      await store.saveDraft(value);
      setLoaded((current) => (current === null ? current : { ...current, draft: value }));
    },
    [store],
  );

  const clearDraft = useCallback(async (): Promise<void> => {
    await store.clearDraft();
    setLoaded((current) => (current === null ? current : { ...current, draft: null }));
  }, [store]);

  const retryPersistence = useCallback(
    async (): Promise<void> => store.retryPersistence(),
    [store],
  );

  const flushPersistence = useCallback(
    async (): Promise<void> => store.flush?.(),
    [store],
  );
  const checkpointBytes = useMemo(() => store.checkpointBytes === undefined ? undefined : (doc: Y.Doc) => store.checkpointBytes?.(doc) ?? Promise.resolve(null), [store]);

  const value = useMemo<PlanContextValue | null>(() => {
    if (loaded === null) {
      return null;
    }
    const snapshot = snapshotPlan(loaded.doc);
    return {
      doc: loaded.doc,
      today: localToday,
      snapshot,
      projected: projectPlan(snapshot.tasks, localToday, snapshot.records),
      draft: loaded.draft,
      setDraft,
      clearDraft,
      persistence,
      retryPersistence,
      flushPersistence,
      checkpointBytes,
    };
  }, [checkpointBytes, clearDraft, flushPersistence, loaded, localToday, persistence, retryPersistence, revision, setDraft]);

  if (error !== null) {
    return <p role="alert">Не удалось открыть локальный план: {error.message}</p>;
  }
  if (value === null) {
    return <p role="status">Загрузка локального плана…</p>;
  }

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan(): PlanContextValue {
  const value = useContext(PlanContext);
  if (value === null) {
    throw new Error("usePlan must be used inside PlanProvider");
  }
  return value;
}
