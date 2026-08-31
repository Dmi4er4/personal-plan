export interface ForegroundSyncPollingOptions {
  intervalMs?: number;
  isActive(): boolean;
  run(): void;
}

export function startForegroundSyncPolling({
  intervalMs = 5_000,
  isActive,
  run,
}: ForegroundSyncPollingOptions): () => void {
  const timer = setInterval(() => {
    if (isActive()) {
      run();
    }
  }, intervalMs);
  return () => {
    clearInterval(timer);
  };
}
