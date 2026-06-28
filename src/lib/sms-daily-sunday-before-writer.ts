/**
 * Sunday weekly pause gate before expensive daily writer / notebook work.
 */

import { supabaseServer } from "@/lib/supabase-server";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  getPendingResolutionOrNull,
  isPendingResolutionExpired,
  shouldSkipPendingResolutionDailyReminderDueToRecentConfirmation,
} from "@/lib/v2-guided-resolution";
import { isReactivationNudgeDue } from "@/lib/v2-reactivation";
import {
  computeWave1ColdStartRefreshEligible,
  parseRefreshSession,
} from "@/lib/v2-refresh-session";
import type { V2UserSmsCommsPreferencesRow } from "@/lib/v2-sms-comms-preferences";
import type { DailyV3RouteKind } from "@/lib/v3-daily-relationship-lane";
import {
  buildSundayWeeklyPauseSkipMetadata,
  isSundayWeeklyPatPauseEligible,
  shouldSuppressDailyForSundayWeeklyPause,
  SUNDAY_WEEKLY_PAUSE_SKIP_STATUS,
} from "@/lib/sms-sunday-weekly-pause-eligibility";

export const DEFER_DAILY_ROUTE_TO_BUILD = "defer_to_build" as const;

export type PlannedDailyRouteKindForSunday =
  | DailyV3RouteKind
  | typeof DEFER_DAILY_ROUTE_TO_BUILD;

export async function resolvePlannedDailyRouteKindForSundaySuppression(args: {
  clerkUserId: string;
  active: ActiveV2CommitmentRow;
  now: Date;
}): Promise<PlannedDailyRouteKindForSunday> {
  const { clerkUserId, active, now } = args;
  const nowMs = now.getTime();

  if (active.accountability_phase === "low_pressure_reactivation") {
    if (
      !isReactivationNudgeDue({
        reactivationEnteredAt: active.reactivation_entered_at,
        reactivationLastSentAt: active.reactivation_last_sent_at,
        nowMs,
      })
    ) {
      return DEFER_DAILY_ROUTE_TO_BUILD;
    }
    return "low_pressure_reactivation";
  }

  const refreshSessionParsed = parseRefreshSession(active.refresh_session);
  if (refreshSessionParsed?.step === "identity") {
    return DEFER_DAILY_ROUTE_TO_BUILD;
  }

  if (
    active.accountability_phase === "active_accountability" &&
    getPendingResolutionOrNull(active) &&
    !isPendingResolutionExpired(active, nowMs)
  ) {
    const recentConfirm = shouldSkipPendingResolutionDailyReminderDueToRecentConfirmation({
      row: active,
      nowMs,
    });
    if (recentConfirm.skip) {
      return DEFER_DAILY_ROUTE_TO_BUILD;
    }
    return "pending_resolution";
  }

  if (refreshSessionParsed) {
    return "refresh_commitment";
  }

  if (active.accountability_phase === "active_accountability" && !refreshSessionParsed) {
    const { data: refreshProfileRow } = await supabaseServer
      .from("user_profiles")
      .select(
        "identity_anchor_text, identity_refresh_due_at, identity_refresh_last_prompted_at, identity_source"
      )
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();

    const identityAnchorForRefresh =
      typeof refreshProfileRow?.identity_anchor_text === "string"
        ? refreshProfileRow.identity_anchor_text.trim()
        : "";
    const identitySourceForRefresh =
      typeof refreshProfileRow?.identity_source === "string"
        ? refreshProfileRow.identity_source.trim()
        : null;
    const identityDueAt =
      typeof refreshProfileRow?.identity_refresh_due_at === "string"
        ? refreshProfileRow.identity_refresh_due_at
        : null;
    const identityLastPrompted =
      typeof refreshProfileRow?.identity_refresh_last_prompted_at === "string"
        ? refreshProfileRow.identity_refresh_last_prompted_at
        : null;

    const wave1Cold = computeWave1ColdStartRefreshEligible({
      nowMs,
      commitment: active,
      identityAnchorText: identityAnchorForRefresh,
      identitySource: identitySourceForRefresh,
      identityRefreshDueAt: identityDueAt,
      identityRefreshLastPromptedAt: identityLastPrompted,
      commitmentRefreshLastPromptedAt: active.commitment_refresh_last_prompted_at,
    });

    if (wave1Cold.ok) {
      return "refresh_identity";
    }
  }

  return "main_active_accountability";
}

export async function applySundayWeeklyPauseBeforeWriterIfNeeded(args: {
  clerkUserId: string;
  todayKey: string;
  localNow: Date;
  timezone: string;
  now: Date;
  force: boolean;
  fullyOnV2: boolean;
  commitment: ActiveV2CommitmentRow | null;
  commsPrefs: V2UserSmsCommsPreferencesRow | null;
  existingMeta?: Record<string, unknown>;
}): Promise<boolean> {
  const commitment = args.commitment;
  if (!commitment?.id || !commitment.behavior_statement?.trim()) {
    return false;
  }

  const eligible = isSundayWeeklyPatPauseEligible({
    localNow: args.localNow,
    now: args.now,
    fullyOnV2: args.fullyOnV2,
    commitment,
    commsPrefs: args.commsPrefs,
  });
  if (!eligible) {
    return false;
  }

  const plannedRoute = await resolvePlannedDailyRouteKindForSundaySuppression({
    clerkUserId: args.clerkUserId,
    active: commitment,
    now: args.now,
  });
  if (plannedRoute === DEFER_DAILY_ROUTE_TO_BUILD) {
    return false;
  }

  if (
    !shouldSuppressDailyForSundayWeeklyPause({
      routeKind: plannedRoute,
      eligible,
      force: args.force,
    })
  ) {
    return false;
  }

  await supabaseServer
    .from("sms_send_events")
    .update({
      status: SUNDAY_WEEKLY_PAUSE_SKIP_STATUS,
      sms_body: "",
      metadata: buildSundayWeeklyPauseSkipMetadata({
        routeKind: plannedRoute,
        todayKey: args.todayKey,
        localNow: args.localNow,
        timezone: args.timezone,
        existingMeta: args.existingMeta,
        beforeWriter: true,
      }),
    })
    .eq("clerk_user_id", args.clerkUserId)
    .eq("day_key", args.todayKey);

  return true;
}
