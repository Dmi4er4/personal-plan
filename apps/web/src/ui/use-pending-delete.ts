import { useCallback, useEffect, useRef, useState } from "react";

export const PENDING_DELETE_MS = 2000;

export function usePendingDelete(onCommit: (id: string) => void, active = true) {
  const [pending, setPending] = useState<Map<string, number>>(() => new Map());
  const [tick, setTick] = useState(0);
  const pendingRef = useRef(pending);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const replacePending = useCallback((next: Map<string, number>) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  const flushPending = useCallback(() => {
    const ids = [...pendingRef.current.keys()];
    if (ids.length === 0) {
      return;
    }
    replacePending(new Map());
    for (const id of ids) {
      onCommitRef.current(id);
    }
  }, [replacePending]);

  useEffect(() => {
    if (pending.size === 0) {
      return;
    }
    const interval = window.setInterval(() => {
      const now = Date.now();
      const current = pendingRef.current;
      const expired: string[] = [];
      const next = new Map(current);
      for (const [id, startedAt] of current) {
        if (now - startedAt >= PENDING_DELETE_MS) {
          next.delete(id);
          expired.push(id);
        }
      }
      if (expired.length > 0) {
        replacePending(next);
        for (const id of expired) {
          onCommitRef.current(id);
        }
      }
      setTick((value) => value + 1);
    }, 50);
    return () => { window.clearInterval(interval); };
  }, [pending, replacePending]);

  const requestDelete = useCallback((id: string) => {
    const next = new Map(pendingRef.current).set(id, Date.now());
    replacePending(next);
  }, [replacePending]);

  const cancelDelete = useCallback((id: string) => {
    if (!pendingRef.current.has(id)) {
      return;
    }
    const next = new Map(pendingRef.current);
    next.delete(id);
    replacePending(next);
  }, [replacePending]);

  useEffect(() => {
    if (!active) {
      flushPending();
    }
  }, [active, flushPending]);

  useEffect(() => {
    const flushWhenHidden = (): void => {
      if (document.visibilityState !== "visible") {
        flushPending();
      }
    };
    window.addEventListener("pagehide", flushPending);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flushPending);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      const ids = [...pendingRef.current.keys()];
      pendingRef.current = new Map();
      for (const id of ids) {
        onCommitRef.current(id);
      }
    };
  }, [flushPending]);

  const progress = useCallback(
    (id: string) => {
      const startedAt = pending.get(id);
      if (startedAt === undefined) {
        return 0;
      }
      return Math.min(1, (Date.now() - startedAt + tick * 0) / PENDING_DELETE_MS);
    },
    [pending, tick],
  );

  const isPending = useCallback((id: string) => pending.has(id), [pending]);

  return { requestDelete, cancelDelete, flushPending, progress, isPending };
}
