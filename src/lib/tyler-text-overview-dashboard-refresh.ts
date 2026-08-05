/**
 * Morning TTO dashboard refresh UI helpers — non-destructive background refresh.
 * Keeps authoritative load() behavior; only changes when the full-page loader shows.
 */

/** Skip focus/visibility auto-refresh when a successful refresh was this recent. */
export const MORNING_TTO_FOCUS_REFRESH_COOLDOWN_MS = 30_000;

/**
 * Full-page list-replacing loader only for the first empty load.
 * Once any successful refresh has landed (or rows already exist), keep the list mounted.
 */
export function shouldShowTtoFullPageLoader(args: {
  loading: boolean;
  rowCount: number;
  hasCompletedSuccessfulLoad: boolean;
}): boolean {
  if (!args.loading) return false;
  if (args.hasCompletedSuccessfulLoad) return false;
  if (args.rowCount > 0) return false;
  return true;
}

export function shouldShowTtoBackgroundRefreshing(args: {
  loading: boolean;
  showFullPageLoader: boolean;
}): boolean {
  return args.loading && !args.showFullPageLoader;
}

/**
 * Focus/visibility auto-refresh gate (Morning). Manual Refresh must not use this.
 * Dedupes in-flight loads and applies a short cooldown after success.
 */
export function shouldSkipMorningTtoFocusRefresh(args: {
  visibilityState: DocumentVisibilityState | string;
  hasUnsavedEdits: boolean;
  loadInFlight: boolean;
  lastSuccessfulRefreshAtMs: number | null;
  nowMs: number;
  cooldownMs?: number;
}): { skip: boolean; reason: "hidden" | "dirty" | "in_flight" | "cooldown" | null } {
  if (args.visibilityState === "hidden") {
    return { skip: true, reason: "hidden" };
  }
  if (args.hasUnsavedEdits) {
    return { skip: true, reason: "dirty" };
  }
  if (args.loadInFlight) {
    return { skip: true, reason: "in_flight" };
  }
  const cooldown = args.cooldownMs ?? MORNING_TTO_FOCUS_REFRESH_COOLDOWN_MS;
  if (
    args.lastSuccessfulRefreshAtMs != null &&
    Number.isFinite(args.lastSuccessfulRefreshAtMs) &&
    args.nowMs - args.lastSuccessfulRefreshAtMs < cooldown
  ) {
    return { skip: true, reason: "cooldown" };
  }
  return { skip: false, reason: null };
}
