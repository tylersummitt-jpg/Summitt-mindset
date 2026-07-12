/**
 * Batch Weekly TTO generation — missing drafts only.
 * Generation only: never sends SMS, never writes send/check events.
 *
 * Pre-skips current/sent/evented users before calling one-row generate,
 * because one-row weekly generate can overwrite current weekly drafts.
 */

import { getClerkUser } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import { resolveSmsUserTimezone } from "@/lib/timezone";
import { loadTylerTextOverviewAudienceRows } from "@/lib/tyler-text-overview-generate";
import {
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
  isTylerTextOverviewEnabled,
} from "@/lib/tyler-text-overview-types";
import { generateTylerTextOverviewWeeklyDraftForUser } from "@/lib/tyler-text-overview-weekly-generate";
import { resolveTylerTextOverviewWeeklyPeriod } from "@/lib/tyler-text-overview-weekly-period";

export const WEEKLY_TTO_GENERATE_ALL_MODE_MISSING_ONLY = "missing_only" as const;

export type WeeklyTtoGenerateAllMode = typeof WEEKLY_TTO_GENERATE_ALL_MODE_MISSING_ONLY;

export type WeeklyTtoGenerateAllErrorPreview = {
  clerk_user_id: string;
  week_key?: string;
  reason: string;
  error?: string;
};

export type WeeklyTtoGenerateAllResult = {
  ok: true;
  mode: WeeklyTtoGenerateAllMode;
  scanned: number;
  eligible: number;
  generated: number;
  skipped_existing_current: number;
  skipped_sent: number;
  skipped_already_weekly_event: number;
  skipped_not_eligible: number;
  failed: number;
  week_keys_seen: string[];
  draft_for_day_keys_seen: string[];
  errors_preview: WeeklyTtoGenerateAllErrorPreview[];
};

const ERRORS_PREVIEW_MAX = 25;

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

function readMetadataString(metadata: Record<string, unknown>, key: string): string | null {
  const raw = metadata[key];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

function hasNonEmptyPhone(phone: string | null | undefined): boolean {
  return typeof phone === "string" && phone.trim().length > 0;
}

export async function hasSmsWeeklySendEventForUserWeek(args: {
  clerkUserId: string;
  weekKey: string;
}): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("sms_weekly_send_events")
    .select("id")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("week_key", args.weekKey)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`sms_weekly_send_events_lookup_failed:${error.message}`);
  }

  return data != null && typeof (data as { id?: unknown }).id === "string";
}

export async function findWeeklyReviewDraftStatusesForWeek(args: {
  clerkUserId: string;
  weekKey: string;
}): Promise<{ hasCurrent: boolean; hasSent: boolean }> {
  const { data: draftRows, error: draftError } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select("id, status, current_generation_id")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("send_slot", SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT)
    .in("status", ["current", "sent"]);

  if (draftError) {
    throw new Error(`weekly_draft_lookup_failed:${draftError.message}`);
  }

  let hasCurrent = false;
  let hasSent = false;

  for (const draftRow of draftRows ?? []) {
    const generationId =
      typeof draftRow.current_generation_id === "string"
        ? draftRow.current_generation_id.trim()
        : "";
    if (!generationId) continue;

    const { data: generationRow, error: generationError } = await supabaseServer
      .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
      .select("id, generation_metadata")
      .eq("id", generationId)
      .maybeSingle();

    if (generationError || !generationRow) continue;

    const metadata = asRecord(generationRow.generation_metadata) ?? {};
    const metaWeekKey = readMetadataString(metadata, "week_key");
    if (metaWeekKey !== args.weekKey) continue;

    if (draftRow.status === "current") hasCurrent = true;
    if (draftRow.status === "sent") hasSent = true;
  }

  return { hasCurrent, hasSent };
}

export type GenerateMissingWeeklyDraftsDeps = {
  loadAudienceRows?: typeof loadTylerTextOverviewAudienceRows;
  getClerkUserFn?: typeof getClerkUser;
  hasWeeklySendEvent?: typeof hasSmsWeeklySendEventForUserWeek;
  findDraftStatuses?: typeof findWeeklyReviewDraftStatusesForWeek;
  generateForUser?: typeof generateTylerTextOverviewWeeklyDraftForUser;
};

/**
 * Generate missing weekly_review drafts for all sendable TTO audience users.
 * Sequential. missing_only. Never sends. Never overwrites current/sent drafts.
 */
export async function generateMissingWeeklyDraftsForAllSendableUsers(args?: {
  mode?: WeeklyTtoGenerateAllMode;
  now?: Date;
  deps?: GenerateMissingWeeklyDraftsDeps;
}): Promise<WeeklyTtoGenerateAllResult> {
  const mode = args?.mode ?? WEEKLY_TTO_GENERATE_ALL_MODE_MISSING_ONLY;
  if (mode !== WEEKLY_TTO_GENERATE_ALL_MODE_MISSING_ONLY) {
    throw new Error(`unsupported_mode:${String(mode)}`);
  }

  if (!isTylerTextOverviewEnabled()) {
    throw new Error("tyler_text_overview_disabled");
  }

  const deps = args?.deps ?? {};
  const loadAudience = deps.loadAudienceRows ?? loadTylerTextOverviewAudienceRows;
  const getClerk = deps.getClerkUserFn ?? getClerkUser;
  const hasEvent = deps.hasWeeklySendEvent ?? hasSmsWeeklySendEventForUserWeek;
  const findDrafts = deps.findDraftStatuses ?? findWeeklyReviewDraftStatusesForWeek;
  const generateForUser = deps.generateForUser ?? generateTylerTextOverviewWeeklyDraftForUser;
  const now = args?.now ?? new Date();

  const audience = await loadAudience();
  const weekKeysSeen = new Set<string>();
  const draftForDayKeysSeen = new Set<string>();
  const errorsPreview: WeeklyTtoGenerateAllErrorPreview[] = [];

  let scanned = 0;
  let generated = 0;
  let skippedExistingCurrent = 0;
  let skippedSent = 0;
  let skippedAlreadyWeeklyEvent = 0;
  let skippedNotEligible = 0;
  let failed = 0;

  function pushError(entry: WeeklyTtoGenerateAllErrorPreview) {
    if (errorsPreview.length < ERRORS_PREVIEW_MAX) {
      errorsPreview.push(entry);
    }
  }

  for (const row of audience) {
    scanned += 1;
    const clerkUserId = row.clerk_user_id.trim();

    if (!hasNonEmptyPhone(row.phone_number)) {
      skippedNotEligible += 1;
      continue;
    }

    let weekKey = "";
    let draftForDayKey = "";

    try {
      const user = await getClerk(clerkUserId);
      const md = (user.public_metadata ?? {}) as Record<string, unknown>;
      const tzResolved = resolveSmsUserTimezone({
        clerkMetadataTimezone: md.timezone,
        audienceTimezone: row.timezone,
      });
      const period = resolveTylerTextOverviewWeeklyPeriod({
        now,
        timezone: tzResolved.timezone,
      });
      weekKey = period.weekKey;
      draftForDayKey = period.draftForDayKey;
      weekKeysSeen.add(weekKey);
      draftForDayKeysSeen.add(draftForDayKey);
    } catch (e) {
      failed += 1;
      pushError({
        clerk_user_id: clerkUserId,
        reason: "clerk_or_period_failed",
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    try {
      if (await hasEvent({ clerkUserId, weekKey })) {
        skippedAlreadyWeeklyEvent += 1;
        continue;
      }

      const draftStatuses = await findDrafts({ clerkUserId, weekKey });
      if (draftStatuses.hasCurrent) {
        skippedExistingCurrent += 1;
        continue;
      }
      if (draftStatuses.hasSent) {
        skippedSent += 1;
        continue;
      }
    } catch (e) {
      failed += 1;
      pushError({
        clerk_user_id: clerkUserId,
        week_key: weekKey,
        reason: "skip_lookup_failed",
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    try {
      const result = await generateForUser({ clerkUserId, now });
      if (result.ok) {
        generated += 1;
        weekKeysSeen.add(result.weekKey);
        draftForDayKeysSeen.add(result.draftForDayKey);
        continue;
      }

      if (
        result.reason === "audience" ||
        result.reason === "comms_prefs" ||
        result.reason === "not_v2" ||
        result.reason === "no_commitment" ||
        result.reason === "disabled"
      ) {
        skippedNotEligible += 1;
        continue;
      }

      failed += 1;
      pushError({
        clerk_user_id: clerkUserId,
        week_key: weekKey,
        reason: result.reason,
        error: result.error,
      });
    } catch (e) {
      failed += 1;
      pushError({
        clerk_user_id: clerkUserId,
        week_key: weekKey,
        reason: "generate_threw",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const eligible = scanned - skippedNotEligible;

  return {
    ok: true,
    mode,
    scanned,
    eligible,
    generated,
    skipped_existing_current: skippedExistingCurrent,
    skipped_sent: skippedSent,
    skipped_already_weekly_event: skippedAlreadyWeeklyEvent,
    skipped_not_eligible: skippedNotEligible,
    failed,
    week_keys_seen: [...weekKeysSeen].sort(),
    draft_for_day_keys_seen: [...draftForDayKeysSeen].sort(),
    errors_preview: errorsPreview,
  };
}
