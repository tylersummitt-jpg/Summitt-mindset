/**
 * Sunday daily suppression before V2 Weekly Pat Pause (Slice B).
 * Fail-open: when eligibility is uncertain, do not suppress daily.
 */

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { isSmsInboundPendingResolutionActionable } from "@/lib/v2-guided-resolution";
import { isPauseActive, type V2UserSmsCommsPreferencesRow } from "@/lib/v2-sms-comms-preferences";
import type { DailyV3RouteKind } from "@/lib/v3-daily-relationship-lane";

export const SUNDAY_WEEKLY_PAUSE_SKIP_STATUS = "skipped_sunday_weekly_pause";
export const SUNDAY_WEEKLY_PAUSE_SKIP_REASON = "skipped_sunday_weekly_pause";
export const SUNDAY_WEEKLY_PAUSE_SKIP_SOURCE = "sunday_weekly_pause";
export const SUNDAY_WEEKLY_EXPECTED_SEND_WINDOW = "sunday_noon_local_12_00_12_14";

export const SUNDAY_SUPPRESSIBLE_DAILY_ROUTE_KINDS = new Set<DailyV3RouteKind>([
  "main_active_accountability",
  "low_pressure_reactivation",
  "contract_prompt",
  "refresh_identity",
  "refresh_commitment",
]);

export function isSundayWeeklyPauseFeatureEnabled(): boolean {
  return process.env.SMS_SUNDAY_SUPPRESS_DAILY_FOR_WEEKLY !== "false";
}

export function isSundayWeeklyPatPauseEligible(args: {
  localNow: Date;
  now?: Date;
  fullyOnV2: boolean;
  commitment: Pick<ActiveV2CommitmentRow, "id" | "behavior_statement"> | null;
  commsPrefs: V2UserSmsCommsPreferencesRow | null;
}): boolean {
  if (!isSundayWeeklyPauseFeatureEnabled()) return false;
  if (args.localNow.getDay() !== 0) return false;
  if (!args.fullyOnV2) return false;

  const commitment = args.commitment;
  if (!commitment?.id || !commitment.behavior_statement?.trim()) return false;

  const now = args.now ?? new Date();
  if (isPauseActive(args.commsPrefs, now)) return false;

  if (isSmsInboundPendingResolutionActionable(commitment as ActiveV2CommitmentRow, now.getTime())) {
    return false;
  }

  return true;
}

export function shouldSuppressDailyForSundayWeeklyPause(args: {
  routeKind: DailyV3RouteKind;
  eligible: boolean;
  force?: boolean;
}): boolean {
  if (args.force) return false;
  if (!args.eligible) return false;
  if (args.routeKind === "pending_resolution") return false;
  return SUNDAY_SUPPRESSIBLE_DAILY_ROUTE_KINDS.has(args.routeKind);
}

export function buildSundayWeeklyPauseSkipMetadata(args: {
  routeKind: DailyV3RouteKind;
  todayKey: string;
  localNow: Date;
  timezone: string;
  existingMeta?: Record<string, unknown>;
  beforeWriter?: boolean;
  writerInvoked?: boolean;
}): Record<string, unknown> {
  const beforeWriter = args.beforeWriter === true;
  const writerInvoked = args.writerInvoked === true;
  return {
    ...(args.existingMeta ?? {}),
    note: SUNDAY_WEEKLY_PAUSE_SKIP_REASON,
    no_send_reason: SUNDAY_WEEKLY_PAUSE_SKIP_REASON,
    skip_source: SUNDAY_WEEKLY_PAUSE_SKIP_SOURCE,
    sunday_weekly_pause_eligible: true,
    suppressed_daily_before_weekly: true,
    would_have_route_kind: args.routeKind,
    local_day: args.todayKey,
    local_time: args.localNow.toISOString(),
    timezone: args.timezone,
    weekly_expected_send_window: SUNDAY_WEEKLY_EXPECTED_SEND_WINDOW,
    twilio_send_attempted: false,
    visible_sent: false,
    sunday_suppression_applied_before_writer: beforeWriter,
    daily_writer_invoked: writerInvoked,
    daily_route_suppressed_before_writer: beforeWriter,
    ...(beforeWriter
      ? { daily_route_suppression_reason: SUNDAY_WEEKLY_PAUSE_SKIP_SOURCE }
      : writerInvoked
        ? { sunday_suppression_after_writer: true }
        : {}),
  };
}
