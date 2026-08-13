import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { PendingDeleteQueue } from "./pending-delete-queue";

export { PENDING_DELETE_MS } from "./pending-delete-queue";

export function usePendingDelete(onCommit: (id: string) => void) {
  const queueRef = useRef<PendingDeleteQueue | null>(null);
  if (queueRef.current === null) {
    queueRef.current = new PendingDeleteQueue();
  }
  const queue = queueRef.current;
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((value) => value + 1), []);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    if (queue.size === 0) {
      return;
    }
    const interval = setInterval(() => {
      const expired = queue.collectExpired();
      for (const id of expired) {
        onCommitRef.current(id);
      }
      // Tick drives the pending progress bar even when nothing expired.
      bump();
    }, 50);
    return () => clearInterval(interval);
    // version re-arms the interval when the queue grows or drains.
  }, [queue, version, bump]);

  const flushPending = useCallback(() => {
    const ids = queue.flush();
    if (ids.length === 0) {
      return;
    }
    for (const id of ids) {
      onCommitRef.current(id);
    }
    bump();
  }, [queue, bump]);

  // Leaving the screen (tab switch, unmount) or the app (background) commits
  // pending deletes instead of silently keeping the tasks.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        flushPending();
      }
    });
    return () => {
      subscription.remove();
      flushPending();
    };
  }, [flushPending]);

  const requestDelete = useCallback((id: string) => {
    queue.request(id);
    bump();
  }, [queue, bump]);

  const cancelDelete = useCallback((id: string) => {
    if (queue.cancel(id)) {
      bump();
    }
  }, [queue, bump]);

  const progress = useCallback((id: string) => queue.progress(id), [queue]);
  const isPending = useCallback((id: string) => queue.isPending(id), [queue]);

  return { requestDelete, cancelDelete, progress, isPending, flushPending };
}
