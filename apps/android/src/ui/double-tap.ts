export const DOUBLE_TAP_DELAY_MS = 350;

export interface DoubleTapState {
  activated: boolean;
  lastTapAt: number | null;
}

export function registerTap(lastTapAt: number | null, tappedAt: number): DoubleTapState {
  if (
    lastTapAt !== null &&
    tappedAt >= lastTapAt &&
    tappedAt - lastTapAt <= DOUBLE_TAP_DELAY_MS
  ) {
    return { activated: true, lastTapAt: null };
  }
  return { activated: false, lastTapAt: tappedAt };
}
