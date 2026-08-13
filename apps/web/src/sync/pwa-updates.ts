export const PWA_UPDATE_INTERVAL_MS = 60_000;

interface UpdatableRegistration {
  update(): Promise<unknown>;
}

export function schedulePwaUpdates(registration: UpdatableRegistration): () => void {
  const updateWhenVisible = (): void => {
    if (document.visibilityState !== "visible") return;
    void registration.update().catch(() => undefined);
  };
  const interval = window.setInterval(updateWhenVisible, PWA_UPDATE_INTERVAL_MS);
  window.addEventListener("focus", updateWhenVisible);
  document.addEventListener("visibilitychange", updateWhenVisible);
  return () => {
    window.clearInterval(interval);
    window.removeEventListener("focus", updateWhenVisible);
    document.removeEventListener("visibilitychange", updateWhenVisible);
  };
}
