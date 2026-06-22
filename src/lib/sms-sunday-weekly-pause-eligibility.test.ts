import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
});

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  buildSundayWeeklyPauseSkipMetadata,
  isSundayWeeklyPatPauseEligible,
  isSundayWeeklyPauseFeatureEnabled,
  shouldSuppressDailyForSundayWeeklyPause,
  SUNDAY_SUPPRESSIBLE_DAILY_ROUTE_KINDS,
  SUNDAY_WEEKLY_PAUSE_SKIP_REASON,
} from "@/lib/sms-sunday-weekly-pause-eligibility";

function sundayLocal(hour = 7): Date {
  return new Date(2026, 5, 21, hour, 0, 0);
}

function mondayLocal(hour = 7): Date {
  return new Date(2026, 5, 22, hour, 0, 0);
}

function commitment(overrides: Partial<ActiveV2CommitmentRow> = {}): ActiveV2CommitmentRow {
  return {
    id: "cmt_1",
    clerk_user_id: "user_1",
    behavior_statement: "One hour of distribution",
    status: "active",
    accountability_phase: "active_accountability",
    ...overrides,
  } as ActiveV2CommitmentRow;
}

describe("sms-sunday-weekly-pause-eligibility", () => {
  afterEach(() => {
    delete process.env.SMS_SUNDAY_SUPPRESS_DAILY_FOR_WEEKLY;
  });

  it("Sunday + fullyOnV2 + active commitment + not pending → eligible true", () => {
    expect(
      isSundayWeeklyPatPauseEligible({
        localNow: sundayLocal(),
        fullyOnV2: true,
        commitment: commitment(),
        commsPrefs: null,
      })
    ).toBe(true);
  });

  it("Monday → eligible false", () => {
    expect(
      isSundayWeeklyPatPauseEligible({
        localNow: mondayLocal(),
        fullyOnV2: true,
        commitment: commitment(),
        commsPrefs: null,
      })
    ).toBe(false);
  });

  it("non-V2 → eligible false", () => {
    expect(
      isSundayWeeklyPatPauseEligible({
        localNow: sundayLocal(),
        fullyOnV2: false,
        commitment: commitment(),
        commsPrefs: null,
      })
    ).toBe(false);
  });

  it("pending_resolution actionable → eligible false", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    expect(
      isSundayWeeklyPatPauseEligible({
        localNow: sundayLocal(),
        fullyOnV2: true,
        commitment: commitment({
          pending_resolution_kind: "commitment_replace",
          pending_resolution_created_at: new Date().toISOString(),
          pending_resolution_expires_at: future,
          pending_resolution_payload: {
            source: "sms_inbound",
            detected_intent: "sms_replace_request",
            raw_user_text: "I want a new goal",
            inbound_message_sid: "SM123",
            sms_state: "awaiting_candidate",
          },
        }),
        commsPrefs: null,
      })
    ).toBe(false);
  });

  it("user comms pause → eligible false", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    expect(
      isSundayWeeklyPatPauseEligible({
        localNow: sundayLocal(),
        fullyOnV2: true,
        commitment: commitment(),
        commsPrefs: {
          pause_until: future,
          pause_reason_category: "pause_request",
        } as never,
      })
    ).toBe(false);
  });

  it("missing commitment behavior → eligible false", () => {
    expect(
      isSundayWeeklyPatPauseEligible({
        localNow: sundayLocal(),
        fullyOnV2: true,
        commitment: commitment({ behavior_statement: "" }),
        commsPrefs: null,
      })
    ).toBe(false);
  });

  it("feature flag false disables eligibility", () => {
    process.env.SMS_SUNDAY_SUPPRESS_DAILY_FOR_WEEKLY = "false";
    expect(isSundayWeeklyPauseFeatureEnabled()).toBe(false);
    expect(
      isSundayWeeklyPatPauseEligible({
        localNow: sundayLocal(),
        fullyOnV2: true,
        commitment: commitment(),
        commsPrefs: null,
      })
    ).toBe(false);
  });

  it.each([
    "main_active_accountability",
    "low_pressure_reactivation",
    "contract_prompt",
    "refresh_identity",
    "refresh_commitment",
  ] as const)("suppresses route kind %s", (routeKind) => {
    expect(SUNDAY_SUPPRESSIBLE_DAILY_ROUTE_KINDS.has(routeKind)).toBe(true);
    expect(
      shouldSuppressDailyForSundayWeeklyPause({
        routeKind,
        eligible: true,
      })
    ).toBe(true);
  });

  it("pending_resolution does not suppress", () => {
    expect(
      shouldSuppressDailyForSundayWeeklyPause({
        routeKind: "pending_resolution",
        eligible: true,
      })
    ).toBe(false);
  });

  it("force bypasses suppression", () => {
    expect(
      shouldSuppressDailyForSundayWeeklyPause({
        routeKind: "main_active_accountability",
        eligible: true,
        force: true,
      })
    ).toBe(false);
  });

  it("buildSundayWeeklyPauseSkipMetadata includes required fields", () => {
    const meta = buildSundayWeeklyPauseSkipMetadata({
      routeKind: "main_active_accountability",
      todayKey: "2026-06-21",
      localNow: sundayLocal(),
      timezone: "America/New_York",
      existingMeta: { note: "reserved_by_cron" },
    });
    expect(meta.no_send_reason).toBe(SUNDAY_WEEKLY_PAUSE_SKIP_REASON);
    expect(meta.would_have_route_kind).toBe("main_active_accountability");
    expect(meta.suppressed_daily_before_weekly).toBe(true);
    expect(meta.visible_sent).toBe(false);
    expect(meta.twilio_send_attempted).toBe(false);
  });
});
