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

export type TtoDashboardSelectionView = "current" | "loading_selection" | "unavailable";

/**
 * The loaded payload may be shown only when its day and slot are the selection.
 * A different day stays on the loader, or on unavailable after that day's load fails.
 * Same-day refresh keeps "current" so a failed refresh can remain visibly stale.
 */
export function resolveTtoDashboardSelectionView(args: {
  selectedDayKey: string;
  selectedSlot: string;
  loadedDayKey: string | null;
  loadedSlot: string | null;
  loading: boolean;
  selectionLoadFailed: boolean;
}): TtoDashboardSelectionView {
  const matches =
    args.loadedSlot != null &&
    args.loadedSlot === args.selectedSlot &&
    (args.loadedDayKey?.trim() ?? null) === args.selectedDayKey.trim();
  if (!matches) {
    if (args.loading || !args.selectionLoadFailed) return "loading_selection";
    return "unavailable";
  }
  if (args.loading && args.selectionLoadFailed) return "loading_selection";
  if (args.selectionLoadFailed) return "unavailable";
  return "current";
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
