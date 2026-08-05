import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MORNING_TTO_FOCUS_REFRESH_COOLDOWN_MS,
  shouldShowTtoBackgroundRefreshing,
  shouldShowTtoFullPageLoader,
  shouldSkipMorningTtoFocusRefresh,
} from "@/lib/tyler-text-overview-dashboard-refresh";

describe("shouldShowTtoFullPageLoader", () => {
  it("shows full loader on initial empty load", () => {
    expect(
      shouldShowTtoFullPageLoader({
        loading: true,
        rowCount: 0,
        hasCompletedSuccessfulLoad: false,
      })
    ).toBe(true);
  });

  it("never shows full loader when a successful load has completed", () => {
    expect(
      shouldShowTtoFullPageLoader({
        loading: true,
        rowCount: 0,
        hasCompletedSuccessfulLoad: true,
      })
    ).toBe(false);
    expect(
      shouldShowTtoFullPageLoader({
        loading: true,
        rowCount: 12,
        hasCompletedSuccessfulLoad: true,
      })
    ).toBe(false);
  });

  it("keeps list mounted when rows already exist during loading", () => {
    expect(
      shouldShowTtoFullPageLoader({
        loading: true,
        rowCount: 3,
        hasCompletedSuccessfulLoad: false,
      })
    ).toBe(false);
  });

  it("hides loader when not loading", () => {
    expect(
      shouldShowTtoFullPageLoader({
        loading: false,
        rowCount: 0,
        hasCompletedSuccessfulLoad: false,
      })
    ).toBe(false);
  });
});

describe("shouldShowTtoBackgroundRefreshing", () => {
  it("is true only for non-destructive loading", () => {
    expect(
      shouldShowTtoBackgroundRefreshing({ loading: true, showFullPageLoader: false })
    ).toBe(true);
    expect(
      shouldShowTtoBackgroundRefreshing({ loading: true, showFullPageLoader: true })
    ).toBe(false);
    expect(
      shouldShowTtoBackgroundRefreshing({ loading: false, showFullPageLoader: false })
    ).toBe(false);
  });
});

describe("shouldSkipMorningTtoFocusRefresh", () => {
  const base = {
    visibilityState: "visible" as const,
    hasUnsavedEdits: false,
    loadInFlight: false,
    lastSuccessfulRefreshAtMs: null as number | null,
    nowMs: 1_000_000,
  };

  it("skips when document is hidden", () => {
    expect(
      shouldSkipMorningTtoFocusRefresh({ ...base, visibilityState: "hidden" })
    ).toEqual({ skip: true, reason: "hidden" });
  });

  it("skips when dirty edits exist", () => {
    expect(
      shouldSkipMorningTtoFocusRefresh({ ...base, hasUnsavedEdits: true })
    ).toEqual({ skip: true, reason: "dirty" });
  });

  it("skips when a load is already in flight (dedupes focus+visibility)", () => {
    expect(
      shouldSkipMorningTtoFocusRefresh({ ...base, loadInFlight: true })
    ).toEqual({ skip: true, reason: "in_flight" });
  });

  it("skips within cooldown after successful refresh", () => {
    const last = base.nowMs - (MORNING_TTO_FOCUS_REFRESH_COOLDOWN_MS - 1);
    expect(
      shouldSkipMorningTtoFocusRefresh({
        ...base,
        lastSuccessfulRefreshAtMs: last,
      })
    ).toEqual({ skip: true, reason: "cooldown" });
  });

  it("allows refresh after cooldown", () => {
    const last = base.nowMs - (MORNING_TTO_FOCUS_REFRESH_COOLDOWN_MS + 1);
    expect(
      shouldSkipMorningTtoFocusRefresh({
        ...base,
        lastSuccessfulRefreshAtMs: last,
      })
    ).toEqual({ skip: false, reason: null });
  });

  it("allows refresh when never successfully refreshed", () => {
    expect(shouldSkipMorningTtoFocusRefresh(base)).toEqual({ skip: false, reason: null });
  });
});

describe("TTO dashboard non-destructive refresh architecture", () => {
  const src = readFileSync(
    join(process.cwd(), "src/app/admin/tyler-text-overview/tyler-text-overview-dashboard.tsx"),
    "utf8"
  );

  it("gates the list-replacing loader on showFullPageLoader, not bare loading", () => {
    expect(src).toContain("showFullPageLoader ?");
    expect(src).toContain("Loading sendable users…");
    expect(src).not.toMatch(/\{loading \?\s*\(\s*<p className="text-sm text-gray-500">Loading sendable users/);
  });

  it("shows background Refreshing indicator without unmounting list", () => {
    expect(src).toContain("backgroundRefreshing");
    expect(src).toContain("Refreshing…");
    expect(src).toContain("shouldShowTtoFullPageLoader");
    expect(src).toContain("shouldShowTtoBackgroundRefreshing");
  });

  it("keeps focus refresh with cooldown and in-flight dedupe", () => {
    expect(src).toContain("shouldSkipMorningTtoFocusRefresh");
    expect(src).toContain("loadInFlightRef");
    expect(src).toContain('addEventListener("focus"');
    expect(src).toContain('addEventListener("visibilitychange"');
  });

  it("preserves Save → full authoritative reload without router/location reload", () => {
    expect(src).toContain("preserveUnsaved: true");
    expect(src).toContain("forceOverwrite: false");
    expect(src).toContain("verifyPersistedSaveRow");
    expect(src).not.toContain("router.refresh");
    expect(src).not.toContain("location.reload");
    expect(src).not.toContain("scrollTo(0");
  });

  it("keeps stable row keys and dirty merge", () => {
    expect(src).toContain("rowListKey");
    expect(src).toContain("mergeEditsPreservingDirty");
    expect(src).toContain("hasCompletedSuccessfulLoad");
  });

  it("manual Refresh still calls load with forceOverwrite (bypasses focus cooldown)", () => {
    expect(src).toContain("handleManualRefresh");
    expect(src).toMatch(/handleManualRefresh[\s\S]*forceOverwrite:\s*true/);
  });
});
