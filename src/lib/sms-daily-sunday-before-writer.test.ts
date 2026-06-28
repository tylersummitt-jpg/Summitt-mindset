import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFrom = vi.hoisted(() => vi.fn());
const supabaseUpdate = vi.hoisted(() => vi.fn());
const supabaseEq2 = vi.hoisted(() => vi.fn());
const supabaseEq1 = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: supabaseFrom,
  },
}));

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  applySundayWeeklyPauseBeforeWriterIfNeeded,
  DEFER_DAILY_ROUTE_TO_BUILD,
  resolvePlannedDailyRouteKindForSundaySuppression,
} from "@/lib/sms-daily-sunday-before-writer";
import { buildSundayWeeklyPauseSkipMetadata } from "@/lib/sms-sunday-weekly-pause-eligibility";

function activeRow(overrides: Partial<ActiveV2CommitmentRow> = {}): ActiveV2CommitmentRow {
  return {
    id: "cmt_1",
    clerk_user_id: "user_sunday",
    behavior_statement: "Pray every morning",
    title: "Prayer",
    accountability_phase: "active_accountability",
    started_at: new Date("2026-01-01T12:00:00.000Z").toISOString(),
    refresh_session: null,
    reactivation_entered_at: null,
    reactivation_last_sent_at: null,
    commitment_refresh_last_prompted_at: null,
    ...overrides,
  } as ActiveV2CommitmentRow;
}

describe("sms-daily-sunday-before-writer", () => {
  function mockUserProfilesSelect() {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: {
                identity_anchor_text: "",
                identity_refresh_due_at: null,
                identity_refresh_last_prompted_at: null,
                identity_source: null,
              },
              error: null,
            }),
        }),
      }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    supabaseEq2.mockReturnValue(Promise.resolve({ error: null }));
    supabaseEq1.mockReturnValue({ eq: supabaseEq2 });
    supabaseUpdate.mockReturnValue({ eq: supabaseEq1 });
    supabaseFrom.mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return mockUserProfilesSelect();
      }
      return { update: supabaseUpdate, select: vi.fn() };
    });
  });

  it("resolves main_active_accountability for normal Sunday accountability users", async () => {
    const kind = await resolvePlannedDailyRouteKindForSundaySuppression({
      clerkUserId: "user_sunday",
      active: activeRow(),
      now: new Date("2026-06-28T15:00:00.000Z"),
    });
    expect(kind).toBe("main_active_accountability");
  });

  it("defers when reactivation nudge is not due", async () => {
    const kind = await resolvePlannedDailyRouteKindForSundaySuppression({
      clerkUserId: "user_react",
      active: activeRow({
        accountability_phase: "low_pressure_reactivation",
        reactivation_entered_at: new Date("2026-06-28T10:00:00.000Z").toISOString(),
        reactivation_last_sent_at: new Date("2026-06-28T11:00:00.000Z").toISOString(),
      }),
      now: new Date("2026-06-28T12:00:00.000Z"),
    });
    expect(kind).toBe(DEFER_DAILY_ROUTE_TO_BUILD);
  });

  it("returns pending_resolution when actionable pending exists", async () => {
    const kind = await resolvePlannedDailyRouteKindForSundaySuppression({
      clerkUserId: "user_pending",
      active: activeRow({
        pending_resolution_kind: "commitment_replace",
        pending_resolution_created_at: new Date("2026-06-27T12:00:00.000Z").toISOString(),
        pending_resolution_expires_at: new Date("2026-07-01T12:00:00.000Z").toISOString(),
        pending_resolution_payload: { source: "sms_inbound", sms_state: "awaiting_candidate" },
      }),
      now: new Date("2026-06-28T15:00:00.000Z"),
    });
    expect(kind).toBe("pending_resolution");
  });

  it("buildSundayWeeklyPauseSkipMetadata sets before-writer observability", () => {
    const meta = buildSundayWeeklyPauseSkipMetadata({
      routeKind: "main_active_accountability",
      todayKey: "2026-06-28",
      localNow: new Date("2026-06-28T15:00:00.000Z"),
      timezone: "America/New_York",
      beforeWriter: true,
    });
    expect(meta.sunday_suppression_applied_before_writer).toBe(true);
    expect(meta.daily_writer_invoked).toBe(false);
    expect(meta.daily_route_suppressed_before_writer).toBe(true);
    expect(meta.daily_route_suppression_reason).toBe("sunday_weekly_pause");
    expect(meta.note).toBe("skipped_sunday_weekly_pause");
  });

  it("applySundayWeeklyPauseBeforeWriterIfNeeded suppresses eligible Sunday main route", async () => {
    const localSunday = new Date("2026-06-28T15:00:00.000Z");
    const suppressed = await applySundayWeeklyPauseBeforeWriterIfNeeded({
      clerkUserId: "user_sunday",
      todayKey: "2026-06-28",
      localNow: localSunday,
      timezone: "America/New_York",
      now: localSunday,
      force: false,
      fullyOnV2: true,
      commitment: activeRow(),
      commsPrefs: null,
    });

    expect(suppressed).toBe(true);
    expect(supabaseUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "skipped_sunday_weekly_pause",
        sms_body: "",
        metadata: expect.objectContaining({
          sunday_suppression_applied_before_writer: true,
          daily_writer_invoked: false,
          daily_route_suppressed_before_writer: true,
        }),
      })
    );
  });

  it("does not suppress pending_resolution route on Sunday", async () => {
    const localSunday = new Date("2026-06-28T15:00:00.000Z");
    const suppressed = await applySundayWeeklyPauseBeforeWriterIfNeeded({
      clerkUserId: "user_pending",
      todayKey: "2026-06-28",
      localNow: localSunday,
      timezone: "America/New_York",
      now: localSunday,
      force: false,
      fullyOnV2: true,
      commitment: activeRow({
        pending_resolution_kind: "commitment_replace",
        pending_resolution_created_at: new Date("2026-06-27T12:00:00.000Z").toISOString(),
        pending_resolution_expires_at: new Date("2026-07-01T12:00:00.000Z").toISOString(),
        pending_resolution_payload: { source: "sms_inbound", sms_state: "awaiting_candidate" },
      }),
      commsPrefs: null,
    });
    expect(suppressed).toBe(false);
    expect(supabaseUpdate).not.toHaveBeenCalled();
  });

  it("does not suppress when force bypass is set", async () => {
    const localSunday = new Date("2026-06-28T15:00:00.000Z");
    const suppressed = await applySundayWeeklyPauseBeforeWriterIfNeeded({
      clerkUserId: "user_sunday",
      todayKey: "2026-06-28",
      localNow: localSunday,
      timezone: "America/New_York",
      now: localSunday,
      force: true,
      fullyOnV2: true,
      commitment: activeRow(),
      commsPrefs: null,
    });
    expect(suppressed).toBe(false);
  });

  it("does not suppress on Monday", async () => {
    const localMonday = new Date("2026-06-29T15:00:00.000Z");
    const suppressed = await applySundayWeeklyPauseBeforeWriterIfNeeded({
      clerkUserId: "user_sunday",
      todayKey: "2026-06-29",
      localNow: localMonday,
      timezone: "America/New_York",
      now: localMonday,
      force: false,
      fullyOnV2: true,
      commitment: activeRow(),
      commsPrefs: null,
    });
    expect(suppressed).toBe(false);
  });
});
