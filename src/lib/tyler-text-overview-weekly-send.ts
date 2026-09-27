/**
 * Weekly TTO draft-authoritative send — manual + cron share this core.
 * Pre-send freshness may regenerate via the existing Weekly generator, persist, and re-read.
 * Never rewrites the SMS body at Twilio send time.
 */

import { supabaseServer } from "@/lib/supabase-server";
import { isTwilioReady, sendSMS } from "@/lib/twilio";
import {
  evaluateOutboundSmsForAccountDeletion,
  isAccountDeletionOutboundSmsError,
  reservedSendEventPatchForDeletionError,
} from "@/lib/account-deletion/deletion-guards";
import { loadTylerTextOverviewAudienceRow } from "@/lib/tyler-text-overview-generate";
import {
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";
import { WEEKLY_TTO_DRAFT_EXCLUDES_COMPLIANCE_FOOTER } from "@/lib/tyler-text-overview-weekly-period";
import { isTylerEditTtoDraftOverride } from "@/lib/tyler-text-overview-send";
import {
  WEEKLY_TTO_COMPLIANCE_FOOTER,
  WEEKLY_TTO_DRAFT_BODY_EXCEEDS_EDITABLE_MAX,
  WEEKLY_TTO_FINAL_BODY_EXCEEDS_TWILIO_MAX,
  buildWeeklyTtoFinalBodyWithFooter,
  weeklyEditableBodyExceedsMax,
  weeklyFinalBodyExceedsTwilioMax,
} from "@/lib/weekly-tto-length";
import { resolveUserFullyOnV2ForCutoverMessaging } from "@/lib/v2-cutover-gates";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { upsertCommitmentSmsThreadMemoryFromOutbound } from "@/lib/v2-commitment-sms-thread-memory";
import {
  fetchV2UserSmsCommsPreferences,
  isPauseActive,
} from "@/lib/v2-sms-comms-preferences";
import {
  AWAITING_MANUAL_PAT_ANSWER_SKIP_REASON,
  hasAwaitingManualPatAnswer,
} from "@/lib/has-awaiting-manual-pat-answer";
import { ensureCurrentTtoDraftFreshForSend } from "@/lib/tto-draft-fresh-for-send";

export {
  WEEKLY_TTO_COMPLIANCE_FOOTER,
  buildWeeklyTtoFinalBodyWithFooter,
};

export const WEEKLY_TTO_MANUAL_SEND_SOURCE = "weekly_tto_manual" as const;
export const WEEKLY_TTO_CRON_SEND_SOURCE = "weekly_tto_cron" as const;

export type WeeklyTtoSendSource =
  | typeof WEEKLY_TTO_MANUAL_SEND_SOURCE
  | typeof WEEKLY_TTO_CRON_SEND_SOURCE;

export type WeeklyTtoManualSendRefusalCode =
  | "no_draft"
  | "wrong_slot"
  | "draft_not_current"
  | "missing_generation"
  | "week_key_mismatch"
  | "blank_body"
  | "machine_should_send_false"
  | "body_too_long"
  | "ambiguous_weekly_draft"
  | "duplicate_weekly_send"
  | "no_phone"
  | "sms_disabled"
  | "stopped_or_unsubscribed"
  | "paused_or_canceled"
  | "not_fully_on_v2"
  | "no_commitment"
  | "twilio_not_ready"
  | "twilio_failed"
  | "account_deletion_blocks_sms"
  | "deletion_lookup_failed"
  | "missing_clerk_user_id_for_outbound_sms"
  | "reservation_failed"
  | "post_send_bookkeeping_failed"
  | "awaiting_manual_pat_answer"
  | "tto_draft_not_fresh";

/** Cron-facing skip reasons (authority failures). */
export type WeeklyTtoCronAuthoritySkipReason =
  | "skipped_tto_no_current_weekly_draft"
  | "skipped_tto_blank_weekly_body"
  | "skipped_tto_missing_generation"
  | "skipped_tto_machine_should_send_false"
  | "skipped_tto_week_key_mismatch"
  | "skipped_tto_ambiguous_weekly_draft"
  | "skipped_tto_wrong_slot";

export type WeeklyTtoManualSendResult =
  | {
      ok: true;
      draftId: string;
      clerkUserId: string;
      weekKey: string;
      messageSid: string;
      status: string;
      finalBodySent: string;
      bodyWithoutFooter: string;
    }
  | {
      ok: false;
      refusalCode: WeeklyTtoManualSendRefusalCode;
      message: string;
      draftId?: string;
      clerkUserId?: string;
      weekKey?: string;
      recoverable?: boolean;
      twilioMessageSid?: string;
    };

export type WeeklyTtoAuthoritativeDraft = {
  draftId: string;
  generationId: string;
  clerkUserId: string;
  weekKey: string;
  weekStart: string | null;
  weekEnd: string | null;
  draftForDayKey: string;
  timezone: string | null;
  bodyWithoutFooter: string;
  commitmentId: string | null;
  generationMetadata: Record<string, unknown>;
};

function refuse(
  refusalCode: WeeklyTtoManualSendRefusalCode,
  message: string,
  extra?: Partial<Extract<WeeklyTtoManualSendResult, { ok: false }>>
): WeeklyTtoManualSendResult {
  return { ok: false, refusalCode, message, ...extra };
}

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

export function mapWeeklyTtoRefusalToCronSkipReason(
  code: WeeklyTtoManualSendRefusalCode
): WeeklyTtoCronAuthoritySkipReason | "skipped_duplicate_weekly_send" | "skipped_missing_twilio" | "skipped_awaiting_manual_pat_answer" | "failed" | null {
  switch (code) {
    case "no_draft":
    case "draft_not_current":
      return "skipped_tto_no_current_weekly_draft";
    case "blank_body":
      return "skipped_tto_blank_weekly_body";
    case "missing_generation":
      return "skipped_tto_missing_generation";
    case "machine_should_send_false":
      return "skipped_tto_machine_should_send_false";
    case "body_too_long":
      return "failed";
    case "week_key_mismatch":
      return "skipped_tto_week_key_mismatch";
    case "ambiguous_weekly_draft":
      return "skipped_tto_ambiguous_weekly_draft";
    case "wrong_slot":
      return "skipped_tto_wrong_slot";
    case "duplicate_weekly_send":
      return "skipped_duplicate_weekly_send";
    case "twilio_not_ready":
      return "skipped_missing_twilio";
    case "twilio_failed":
    case "reservation_failed":
    case "post_send_bookkeeping_failed":
    case "no_phone":
    case "sms_disabled":
    case "stopped_or_unsubscribed":
    case "paused_or_canceled":
    case "not_fully_on_v2":
    case "no_commitment":
    case "deletion_lookup_failed":
    case "missing_clerk_user_id_for_outbound_sms":
      return "failed";
    case "account_deletion_blocks_sms":
      return null;
    case "awaiting_manual_pat_answer":
      return "skipped_awaiting_manual_pat_answer";
    case "tto_draft_not_fresh":
      return "failed";
    default:
      return null;
  }
}

async function materializeAuthoritativeDraftFromRows(args: {
  draftRow: Record<string, unknown>;
  generationRow: Record<string, unknown>;
  weekKeyRequired?: string | null;
}): Promise<
  | { ok: true; draft: WeeklyTtoAuthoritativeDraft }
  | { ok: false; result: WeeklyTtoManualSendResult }
> {
  const draftRow = args.draftRow;
  const generationRow = args.generationRow;
  const clerkUserId =
    typeof draftRow.clerk_user_id === "string" ? draftRow.clerk_user_id.trim() : "";
  const draftId = String(draftRow.id ?? "");
  const base = { draftId, clerkUserId };

  if (draftRow.send_slot !== SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT) {
    return {
      ok: false,
      result: refuse("wrong_slot", "Draft send_slot is not weekly_review", base),
    };
  }
  if (draftRow.status !== "current") {
    return {
      ok: false,
      result: refuse("draft_not_current", "Draft is not current", base),
    };
  }

  if (generationRow.send_slot !== SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT) {
    return {
      ok: false,
      result: refuse("wrong_slot", "Generation send_slot is not weekly_review", base),
    };
  }

  const metadata = asRecord(generationRow.generation_metadata) ?? {};
  const weekKey = readMetadataString(metadata, "week_key");
  if (!weekKey) {
    return {
      ok: false,
      result: refuse("week_key_mismatch", "Generation metadata is missing week_key", base),
    };
  }

  const requestedWeekKey = args.weekKeyRequired?.trim() || "";
  if (requestedWeekKey && requestedWeekKey !== weekKey) {
    return {
      ok: false,
      result: refuse(
        "week_key_mismatch",
        `Requested week_key ${requestedWeekKey} does not match draft week_key ${weekKey}`,
        { ...base, weekKey }
      ),
    };
  }

  const bodyWithoutFooter =
    typeof draftRow.current_body_to_send === "string"
      ? draftRow.current_body_to_send.trim()
      : "";
  if (!bodyWithoutFooter) {
    return {
      ok: false,
      result: refuse("blank_body", "Weekly draft body is empty", { ...base, weekKey }),
    };
  }

  if (generationRow.machine_should_send !== true) {
    const tylerOverride = isTylerEditTtoDraftOverride({
      edited_by_tyler: draftRow.edited_by_tyler === true,
      current_body_source:
        typeof draftRow.current_body_source === "string"
          ? draftRow.current_body_source
          : "",
    });
    if (!tylerOverride) {
      return {
        ok: false,
        result: refuse(
          "machine_should_send_false",
          typeof generationRow.machine_no_send_reason === "string" &&
            generationRow.machine_no_send_reason.trim()
            ? `machine_should_send is false: ${generationRow.machine_no_send_reason.trim()}`
            : "machine_should_send is false",
          { ...base, weekKey }
        ),
      };
    }
  }

  if (weeklyEditableBodyExceedsMax(bodyWithoutFooter)) {
    return {
      ok: false,
      result: refuse("body_too_long", WEEKLY_TTO_DRAFT_BODY_EXCEEDS_EDITABLE_MAX, {
        ...base,
        weekKey,
      }),
    };
  }
  const previewFinal = buildWeeklyTtoFinalBodyWithFooter(bodyWithoutFooter);
  if (weeklyFinalBodyExceedsTwilioMax(previewFinal)) {
    return {
      ok: false,
      result: refuse("body_too_long", WEEKLY_TTO_FINAL_BODY_EXCEEDS_TWILIO_MAX, {
        ...base,
        weekKey,
      }),
    };
  }

  const timezone =
    readMetadataString(metadata, "timezone") ||
    (typeof generationRow.timezone_snapshot === "string"
      ? generationRow.timezone_snapshot.trim()
      : null);

  const commitmentId =
    typeof generationRow.commitment_id === "string" && generationRow.commitment_id.trim()
      ? generationRow.commitment_id.trim()
      : null;

  return {
    ok: true,
    draft: {
      draftId: String(draftRow.id),
      generationId: String(generationRow.id),
      clerkUserId,
      weekKey,
      weekStart: readMetadataString(metadata, "week_start"),
      weekEnd: readMetadataString(metadata, "week_end"),
      draftForDayKey:
        typeof draftRow.draft_for_day_key === "string" ? draftRow.draft_for_day_key : "",
      timezone,
      bodyWithoutFooter,
      commitmentId,
      generationMetadata: metadata,
    },
  };
}

export async function assertWeeklyTtoDraftAuthoritativeForManualSend(args: {
  draftId: string;
  weekKey?: string | null;
}): Promise<
  | { ok: true; draft: WeeklyTtoAuthoritativeDraft }
  | { ok: false; result: WeeklyTtoManualSendResult }
> {
  const draftId = args.draftId.trim();
  if (!draftId) {
    return { ok: false, result: refuse("no_draft", "Missing draft id") };
  }

  const { data: draftRow, error: draftError } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select(
      "id, clerk_user_id, draft_for_day_key, send_slot, current_generation_id, current_body_to_send, current_body_source, edited_by_tyler, status"
    )
    .eq("id", draftId)
    .maybeSingle();

  if (draftError) {
    return {
      ok: false,
      result: refuse("no_draft", `draft_load_failed:${draftError.message}`, { draftId }),
    };
  }
  if (!draftRow) {
    return { ok: false, result: refuse("no_draft", "Draft not found", { draftId }) };
  }

  const generationId =
    typeof draftRow.current_generation_id === "string"
      ? draftRow.current_generation_id.trim()
      : "";
  if (!generationId) {
    return {
      ok: false,
      result: refuse("missing_generation", "Draft has no current_generation_id", {
        draftId: String(draftRow.id),
        clerkUserId:
          typeof draftRow.clerk_user_id === "string" ? draftRow.clerk_user_id.trim() : "",
      }),
    };
  }

  const { data: generationRow, error: generationError } = await supabaseServer
    .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
    .select(
      "id, send_slot, machine_should_send, machine_no_send_reason, commitment_id, generation_metadata, timezone_snapshot"
    )
    .eq("id", generationId)
    .maybeSingle();

  if (generationError || !generationRow) {
    return {
      ok: false,
      result: refuse(
        "missing_generation",
        generationError
          ? `generation_load_failed:${generationError.message}`
          : "Current generation not found",
        {
          draftId: String(draftRow.id),
          clerkUserId:
            typeof draftRow.clerk_user_id === "string" ? draftRow.clerk_user_id.trim() : "",
        }
      ),
    };
  }

  return materializeAuthoritativeDraftFromRows({
    draftRow: draftRow as Record<string, unknown>,
    generationRow: generationRow as Record<string, unknown>,
    weekKeyRequired: args.weekKey,
  });
}

/**
 * Cron authority: load the single current weekly_review draft for user+week_key.
 * week_key (generation_metadata) is the send truth — not draft_for_day_key alone.
 */
export async function assertWeeklyTtoDraftAuthoritativeForCronSend(args: {
  clerkUserId: string;
  weekKey: string;
}): Promise<
  | { ok: true; draft: WeeklyTtoAuthoritativeDraft }
  | { ok: false; result: WeeklyTtoManualSendResult }
> {
  const clerkUserId = args.clerkUserId.trim();
  const weekKey = args.weekKey.trim();
  if (!clerkUserId) {
    return { ok: false, result: refuse("no_draft", "Missing clerk_user_id") };
  }
  if (!weekKey) {
    return {
      ok: false,
      result: refuse("week_key_mismatch", "Missing week_key", { clerkUserId }),
    };
  }

  const { data: draftRows, error: draftError } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select(
      "id, clerk_user_id, draft_for_day_key, send_slot, current_generation_id, current_body_to_send, current_body_source, edited_by_tyler, status"
    )
    .eq("clerk_user_id", clerkUserId)
    .eq("send_slot", SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT)
    .eq("status", "current");

  if (draftError) {
    return {
      ok: false,
      result: refuse("no_draft", `draft_load_failed:${draftError.message}`, {
        clerkUserId,
        weekKey,
      }),
    };
  }

  const rows = Array.isArray(draftRows) ? draftRows : [];
  if (rows.length === 0) {
    return {
      ok: false,
      result: refuse("no_draft", "No current weekly_review draft", {
        clerkUserId,
        weekKey,
      }),
    };
  }

  const matched: Array<{
    draftRow: Record<string, unknown>;
    generationRow: Record<string, unknown>;
  }> = [];

  for (const draftRow of rows) {
    const generationId =
      typeof draftRow.current_generation_id === "string"
        ? draftRow.current_generation_id.trim()
        : "";
    if (!generationId) continue;

    const { data: generationRow, error: generationError } = await supabaseServer
      .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
      .select(
        "id, send_slot, machine_should_send, machine_no_send_reason, commitment_id, generation_metadata, timezone_snapshot"
      )
      .eq("id", generationId)
      .maybeSingle();

    if (generationError || !generationRow) continue;

    const metadata = asRecord(generationRow.generation_metadata) ?? {};
    const metaWeekKey = readMetadataString(metadata, "week_key");
    if (metaWeekKey !== weekKey) continue;

    matched.push({
      draftRow: draftRow as Record<string, unknown>,
      generationRow: generationRow as Record<string, unknown>,
    });
  }

  if (matched.length === 0) {
    // Distinguish: had current drafts but none for this week_key vs missing generation/body later
    const anyWithGeneration = rows.some(
      (r) => typeof r.current_generation_id === "string" && r.current_generation_id.trim()
    );
    if (!anyWithGeneration) {
      return {
        ok: false,
        result: refuse("missing_generation", "Current draft missing generation", {
          clerkUserId,
          weekKey,
        }),
      };
    }
    return {
      ok: false,
      result: refuse(
        "week_key_mismatch",
        `No current weekly_review draft for week_key ${weekKey}`,
        { clerkUserId, weekKey }
      ),
    };
  }

  if (matched.length > 1) {
    return {
      ok: false,
      result: refuse(
        "ambiguous_weekly_draft",
        `Multiple current weekly_review drafts for week_key ${weekKey}`,
        { clerkUserId, weekKey }
      ),
    };
  }

  return materializeAuthoritativeDraftFromRows({
    draftRow: matched[0].draftRow,
    generationRow: matched[0].generationRow,
    weekKeyRequired: weekKey,
  });
}

async function evaluateWeeklyManualSendEligibility(args: {
  clerkUserId: string;
  draftId: string;
  weekKey: string;
  now: Date;
}): Promise<WeeklyTtoManualSendResult | null> {
  const base = {
    draftId: args.draftId,
    clerkUserId: args.clerkUserId,
    weekKey: args.weekKey,
  };

  const deletion = await evaluateOutboundSmsForAccountDeletion(args.clerkUserId);
  if (deletion.decision === "blocked_due_to_deletion") {
    return refuse("account_deletion_blocks_sms", "Account deletion blocks SMS", {
      ...base,
      recoverable: false,
    });
  }
  if (
    deletion.decision === "lookup_failed" ||
    deletion.decision === "missing_clerk_user_id"
  ) {
    return refuse("deletion_lookup_failed", "Account deletion lookup failed", {
      ...base,
      recoverable: true,
    });
  }

  const audience = await loadTylerTextOverviewAudienceRow(args.clerkUserId);
  if (!audience) {
    return refuse("stopped_or_unsubscribed", "User not in sendable SMS audience", base);
  }
  const phone =
    typeof audience.phone_number === "string" ? audience.phone_number.trim() : "";
  if (!phone) {
    return refuse("no_phone", "User has no phone number", base);
  }
  if (audience.sms_enabled !== true) {
    return refuse("sms_disabled", "SMS is disabled for this user", base);
  }
  if (audience.stopped_at != null && audience.stopped_at !== "") {
    return refuse("stopped_or_unsubscribed", "User has opted out of SMS", base);
  }
  if (audience.summitt_subscribed !== true) {
    return refuse("stopped_or_unsubscribed", "User is not subscribed", base);
  }

  const commsPrefs = await fetchV2UserSmsCommsPreferences(args.clerkUserId);
  if (isPauseActive(commsPrefs, args.now)) {
    return refuse("paused_or_canceled", "User SMS pause is active", base);
  }

  const v2Status = await resolveUserFullyOnV2ForCutoverMessaging(args.clerkUserId);
  if (!v2Status.fullyOnV2) {
    return refuse("not_fully_on_v2", "User is not fully on V2 messaging", base);
  }

  if (!isTwilioReady()) {
    return refuse("twilio_not_ready", "Twilio is not configured", base);
  }

  return null;
}

type WeeklyReserveRow = {
  ok?: boolean;
  reason?: string | null;
  event_id?: string | null;
  draft_id?: string | null;
  generation_id?: string | null;
  body?: string | null;
  week_start?: string | null;
  week_end?: string | null;
  draft_for_day_key?: string | null;
  timezone?: string | null;
};

function weeklyReserveRefusal(
  reason: string,
  draft: WeeklyTtoAuthoritativeDraft
): WeeklyTtoManualSendResult {
  if (reason === "duplicate_weekly_send") {
    return refuse(
      "duplicate_weekly_send",
      "Weekly send already reserved or sent for this user/week_key",
      {
        draftId: draft.draftId,
        clerkUserId: draft.clerkUserId,
        weekKey: draft.weekKey,
      }
    );
  }
  if (reason === "blank_body") {
    return refuse("blank_body", "Weekly draft body is empty", {
      draftId: draft.draftId,
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
    });
  }
  if (reason === "ambiguous_weekly_draft") {
    return refuse("ambiguous_weekly_draft", "More than one current weekly draft matches this week", {
      draftId: draft.draftId,
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
    });
  }
  if (reason === "missing_generation") {
    return refuse("missing_generation", "Weekly draft has no generation", {
      draftId: draft.draftId,
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
    });
  }
  if (reason === "no_draft") {
    return refuse("no_draft", "No current weekly draft for this week", {
      draftId: draft.draftId,
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
    });
  }
  return refuse("reservation_failed", `weekly_tto_reserve_send refused: ${reason}`, {
    draftId: draft.draftId,
    clerkUserId: draft.clerkUserId,
    weekKey: draft.weekKey,
  });
}

async function markReservedWeeklySendFailed(args: {
  clerkUserId: string;
  weekKey: string;
  sendSource: WeeklyTtoSendSource;
  draft: WeeklyTtoAuthoritativeDraft;
  bodyWithoutFooter: string;
  error: string;
  twilioSendAttempted: boolean;
  requestedByClerkUserId?: string | null;
}): Promise<void> {
  const { error } = await supabaseServer
    .from("sms_weekly_send_events")
    .update({
      status: "send_failed",
      metadata: {
        send_source: args.sendSource,
        draft_id: args.draft.draftId,
        generation_id: args.draft.generationId,
        week_key: args.weekKey,
        week_start: args.draft.weekStart,
        week_end: args.draft.weekEnd,
        draft_for_day_key: args.draft.draftForDayKey,
        timezone: args.draft.timezone,
        body_without_footer: args.bodyWithoutFooter,
        draft_excludes_compliance_footer: WEEKLY_TTO_DRAFT_EXCLUDES_COMPLIANCE_FOOTER,
        twilio_send_attempted: args.twilioSendAttempted,
        error: args.error,
        ...(args.requestedByClerkUserId
          ? { requested_by_clerk_user_id: args.requestedByClerkUserId }
          : {}),
      },
    })
    .eq("clerk_user_id", args.clerkUserId)
    .eq("week_key", args.weekKey);
  if (error) {
    console.error("[tyler-text-overview-weekly-send] send_failed bookkeeping failed", {
      clerk_user_id: args.clerkUserId,
      week_key: args.weekKey,
      message: error.message,
    });
  }
}

async function reserveWeeklySmsSendEvent(args: {
  draft: WeeklyTtoAuthoritativeDraft;
  sendSource: WeeklyTtoSendSource;
}): Promise<
  | {
      ok: true;
      eventId: string;
      draftId: string;
      generationId: string;
      body: string;
      weekStart: string | null;
      weekEnd: string | null;
      draftForDayKey: string;
      timezone: string | null;
    }
  | { ok: false; result: WeeklyTtoManualSendResult }
> {
  const { data, error } = await supabaseServer.rpc("weekly_tto_reserve_send", {
    p_clerk_user_id: args.draft.clerkUserId,
    p_week_key: args.draft.weekKey,
    p_send_source: args.sendSource,
  });

  if (error) {
    console.error("[tyler-text-overview-weekly-send] weekly_tto_reserve_send failed", {
      clerk_user_id: args.draft.clerkUserId,
      week_key: args.draft.weekKey,
      message: error.message,
    });
    return {
      ok: false,
      result: refuse(
        "reservation_failed",
        `weekly_tto_reserve_send failed: ${error.message}`,
        {
          draftId: args.draft.draftId,
          clerkUserId: args.draft.clerkUserId,
          weekKey: args.draft.weekKey,
        }
      ),
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as WeeklyReserveRow | null | undefined;
  if (!row || row.ok !== true) {
    const reason = typeof row?.reason === "string" && row.reason.trim() ? row.reason.trim() : "reservation_failed";
    return { ok: false, result: weeklyReserveRefusal(reason, args.draft) };
  }

  const eventId = typeof row.event_id === "string" ? row.event_id.trim() : "";
  const draftId = typeof row.draft_id === "string" ? row.draft_id.trim() : "";
  const generationId = typeof row.generation_id === "string" ? row.generation_id.trim() : "";
  const body = typeof row.body === "string" ? row.body.trim() : "";
  const draftForDayKey =
    typeof row.draft_for_day_key === "string" ? row.draft_for_day_key.trim() : "";
  if (!eventId || !draftId || !generationId || !body || !draftForDayKey) {
    return {
      ok: false,
      result: refuse("reservation_failed", "weekly_tto_reserve_send returned an incomplete reservation", {
        draftId: args.draft.draftId,
        clerkUserId: args.draft.clerkUserId,
        weekKey: args.draft.weekKey,
      }),
    };
  }

  return {
    ok: true,
    eventId,
    draftId,
    generationId,
    body,
    weekStart: typeof row.week_start === "string" ? row.week_start : null,
    weekEnd: typeof row.week_end === "string" ? row.week_end : null,
    draftForDayKey,
    timezone: typeof row.timezone === "string" ? row.timezone : null,
  };
}

async function finalizeWeeklyDraftAfterSend(args: {
  draftId: string;
  weeklySendEventId: string;
  twilioMessageSid: string;
  finalBodySent: string;
  now: Date;
}): Promise<{ ok: boolean; error?: string }> {
  const nowIso = args.now.toISOString();
  const { error } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .update({
      status: "sent",
      sent_at: nowIso,
      source_sms_send_event_id: args.weeklySendEventId,
      twilio_message_sid: args.twilioMessageSid,
      final_body_sent: args.finalBodySent,
      updated_at: nowIso,
    })
    .eq("id", args.draftId)
    .eq("status", "current");

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function updateGenerationMetadataAfterWeeklySend(args: {
  generationId: string;
  existingMetadata: Record<string, unknown>;
  weeklySendEventId: string;
  twilioMessageSid: string;
  sentAtIso: string;
  bodyWithoutFooter: string;
  finalBody: string;
  sendSource: WeeklyTtoSendSource;
}): Promise<void> {
  await supabaseServer
    .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
    .update({
      generation_metadata: {
        ...args.existingMetadata,
        weekly_tto_sent: true,
        ...(args.sendSource === WEEKLY_TTO_MANUAL_SEND_SOURCE
          ? { weekly_tto_manual_sent: true }
          : { weekly_tto_cron_sent: true }),
        send_source: args.sendSource,
        sms_weekly_send_event_id: args.weeklySendEventId,
        twilio_message_sid: args.twilioMessageSid,
        sent_at: args.sentAtIso,
        body_without_footer: args.bodyWithoutFooter,
        sms_body: args.finalBody,
        draft_excludes_compliance_footer: WEEKLY_TTO_DRAFT_EXCLUDES_COMPLIANCE_FOOTER,
      },
    })
    .eq("id", args.generationId);
}

/**
 * Shared send core after authority has already passed.
 * phoneTo: required for cron (from sms_identities); optional for manual (audience reload).
 */
export async function sendWeeklyTtoDraftAuthoritative(args: {
  draft: WeeklyTtoAuthoritativeDraft;
  sendSource: WeeklyTtoSendSource;
  phoneTo: string;
  requestedByClerkUserId?: string | null;
  now?: Date;
}): Promise<WeeklyTtoManualSendResult> {
  const now = args.now ?? new Date();
  let draft = args.draft;
  const phone = args.phoneTo.trim();
  if (!phone) {
    return refuse("no_phone", "User has no phone number", {
      draftId: draft.draftId,
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
    });
  }

  // APP-041B2b: deletion check before using cached phone / reservation / send.
  // Transport re-checks immediately before messages.create.
  const deletion = await evaluateOutboundSmsForAccountDeletion(draft.clerkUserId);
  if (deletion.decision === "blocked_due_to_deletion") {
    return refuse("account_deletion_blocks_sms", "Account deletion blocks SMS", {
      draftId: draft.draftId,
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
      recoverable: false,
    });
  }
  if (deletion.decision === "lookup_failed") {
    return refuse("deletion_lookup_failed", "Account deletion lookup failed", {
      draftId: draft.draftId,
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
      recoverable: true,
    });
  }
  if (deletion.decision === "missing_clerk_user_id") {
    // Data integrity — empty draft identity cannot self-heal; no reservation.
    return refuse(
      "missing_clerk_user_id_for_outbound_sms",
      "Missing Clerk user id for outbound SMS",
      {
        draftId: draft.draftId,
        clerkUserId: draft.clerkUserId,
        weekKey: draft.weekKey,
        recoverable: false,
      }
    );
  }

  if (await hasAwaitingManualPatAnswer(draft.clerkUserId)) {
    console.log("[weekly-tto-send] skip awaiting_manual_pat_answer", {
      clerk_user_id: draft.clerkUserId,
      week_key: draft.weekKey,
      send_source: args.sendSource,
      skip_reason: AWAITING_MANUAL_PAT_ANSWER_SKIP_REASON,
    });
    return refuse(
      "awaiting_manual_pat_answer",
      "A Coach Pat question is waiting for a manual answer.",
      {
        draftId: draft.draftId,
        clerkUserId: draft.clerkUserId,
        weekKey: draft.weekKey,
      }
    );
  }

  if (!isTwilioReady()) {
    return refuse("twilio_not_ready", "Twilio is not configured", {
      draftId: draft.draftId,
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
    });
  }

  const fresh = await ensureCurrentTtoDraftFreshForSend({
    clerkUserId: draft.clerkUserId,
    sendSlot: SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
    draftForDayKey: draft.draftForDayKey,
    now,
  });
  if (!fresh.ok) {
    return refuse(
      "tto_draft_not_fresh",
      `TTO draft not fresh (${fresh.reason})`,
      {
        draftId: draft.draftId,
        clerkUserId: draft.clerkUserId,
        weekKey: draft.weekKey,
      }
    );
  }
  const authority = await assertWeeklyTtoDraftAuthoritativeForCronSend({
    clerkUserId: draft.clerkUserId,
    weekKey: draft.weekKey,
  });
  if (!authority.ok) return authority.result;
  draft = authority.draft;

  let commitmentId = draft.commitmentId;
  if (!commitmentId) {
    commitmentId = (await getActiveCommitment(draft.clerkUserId))?.id ?? null;
  }
  if (!commitmentId) {
    return refuse("no_commitment", "No active V2 commitment for thread memory", {
      draftId: draft.draftId,
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
    });
  }

  const reservation = await reserveWeeklySmsSendEvent({
    draft,
    sendSource: args.sendSource,
  });
  if (!reservation.ok) return reservation.result;

  draft = {
    ...draft,
    draftId: reservation.draftId,
    generationId: reservation.generationId,
    bodyWithoutFooter: reservation.body,
    weekStart: reservation.weekStart,
    weekEnd: reservation.weekEnd,
    draftForDayKey: reservation.draftForDayKey,
    timezone: reservation.timezone,
  };

  const { data: reservedGeneration, error: reservedGenerationError } = await supabaseServer
    .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
    .select("generation_metadata")
    .eq("id", reservation.generationId)
    .maybeSingle();
  if (reservedGenerationError) {
    await markReservedWeeklySendFailed({
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
      sendSource: args.sendSource,
      draft,
      bodyWithoutFooter: reservation.body,
      error: reservedGenerationError.message,
      twilioSendAttempted: false,
      requestedByClerkUserId: args.requestedByClerkUserId,
    });
    return refuse(
      "reservation_failed",
      `Reserved weekly generation metadata could not be read: ${reservedGenerationError.message}`,
      {
        draftId: draft.draftId,
        clerkUserId: draft.clerkUserId,
        weekKey: draft.weekKey,
      }
    );
  }
  const reservedMetadata = asRecord(reservedGeneration?.generation_metadata);
  if (reservedMetadata) {
    draft = { ...draft, generationMetadata: reservedMetadata };
  }

  const bodyWithoutFooter = reservation.body.trim();
  if (!bodyWithoutFooter) {
    await markReservedWeeklySendFailed({
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
      sendSource: args.sendSource,
      draft,
      bodyWithoutFooter,
      error: "blank_body_after_reserve",
      twilioSendAttempted: false,
      requestedByClerkUserId: args.requestedByClerkUserId,
    });
    return refuse("blank_body", "Weekly draft body is empty", {
      draftId: draft.draftId,
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
    });
  }
  if (weeklyEditableBodyExceedsMax(bodyWithoutFooter)) {
    await markReservedWeeklySendFailed({
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
      sendSource: args.sendSource,
      draft,
      bodyWithoutFooter,
      error: WEEKLY_TTO_DRAFT_BODY_EXCEEDS_EDITABLE_MAX,
      twilioSendAttempted: false,
      requestedByClerkUserId: args.requestedByClerkUserId,
    });
    return refuse("body_too_long", WEEKLY_TTO_DRAFT_BODY_EXCEEDS_EDITABLE_MAX, {
      draftId: draft.draftId,
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
    });
  }
  const finalBody = buildWeeklyTtoFinalBodyWithFooter(bodyWithoutFooter);
  if (weeklyFinalBodyExceedsTwilioMax(finalBody)) {
    await markReservedWeeklySendFailed({
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
      sendSource: args.sendSource,
      draft,
      bodyWithoutFooter,
      error: WEEKLY_TTO_FINAL_BODY_EXCEEDS_TWILIO_MAX,
      twilioSendAttempted: false,
      requestedByClerkUserId: args.requestedByClerkUserId,
    });
    return refuse("body_too_long", WEEKLY_TTO_FINAL_BODY_EXCEEDS_TWILIO_MAX, {
      draftId: draft.draftId,
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
    });
  }

  let twilioMessageSid: string;
  let twilioStatus: string;
  try {
    const message = await sendSMS({
      to: phone,
      body: finalBody,
      lastOutbound: {
        clerkUserId: draft.clerkUserId,
        messageKind: "weekly",
      },
    });
    twilioMessageSid = message.sid;
    twilioStatus = typeof message.status === "string" ? message.status : "sent";
  } catch (err) {
    if (isAccountDeletionOutboundSmsError(err)) {
      const patch = reservedSendEventPatchForDeletionError(err);
      await supabaseServer
        .from("sms_weekly_send_events")
        .update({
          status: patch.status,
          metadata: {
            send_source: args.sendSource,
            draft_id: draft.draftId,
            generation_id: draft.generationId,
            week_key: draft.weekKey,
            note: patch.note,
            twilio_send_attempted: false,
            ...(args.requestedByClerkUserId
              ? { requested_by_clerk_user_id: args.requestedByClerkUserId }
              : {}),
          },
        })
        .eq("clerk_user_id", draft.clerkUserId)
        .eq("week_key", draft.weekKey);

      if (patch.metricCategory === "blocked_due_to_deletion") {
        return refuse("account_deletion_blocks_sms", err.code, {
          draftId: draft.draftId,
          clerkUserId: draft.clerkUserId,
          weekKey: draft.weekKey,
          recoverable: false,
        });
      }
      if (patch.metricCategory === "deletion_lookup_failed") {
        // send_failed — same reservation recovery posture as Twilio failure.
        return refuse("deletion_lookup_failed", err.code, {
          draftId: draft.draftId,
          clerkUserId: draft.clerkUserId,
          weekKey: draft.weekKey,
          recoverable: true,
        });
      }
      return refuse("missing_clerk_user_id_for_outbound_sms", err.code, {
        draftId: draft.draftId,
        clerkUserId: draft.clerkUserId,
        weekKey: draft.weekKey,
        recoverable: false,
      });
    }
    const message = err instanceof Error ? err.message : String(err);
    await supabaseServer
      .from("sms_weekly_send_events")
      .update({
        status: "send_failed",
        metadata: {
          send_source: args.sendSource,
          draft_id: draft.draftId,
          generation_id: draft.generationId,
          week_key: draft.weekKey,
          week_start: draft.weekStart,
          week_end: draft.weekEnd,
          draft_for_day_key: draft.draftForDayKey,
          timezone: draft.timezone,
          body_without_footer: bodyWithoutFooter,
          draft_excludes_compliance_footer: WEEKLY_TTO_DRAFT_EXCLUDES_COMPLIANCE_FOOTER,
          twilio_send_attempted: true,
          error: message,
          ...(args.requestedByClerkUserId
            ? { requested_by_clerk_user_id: args.requestedByClerkUserId }
            : {}),
        },
      })
      .eq("clerk_user_id", draft.clerkUserId)
      .eq("week_key", draft.weekKey);

    return refuse("twilio_failed", `Twilio send failed: ${message}`, {
      draftId: draft.draftId,
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
      recoverable: true,
    });
  }

  const sentAt = now;
  const sentAtIso = sentAt.toISOString();

  const successMetadata = {
    send_source: args.sendSource,
    draft_id: draft.draftId,
    generation_id: draft.generationId,
    week_key: draft.weekKey,
    week_start: draft.weekStart,
    week_end: draft.weekEnd,
    draft_for_day_key: draft.draftForDayKey,
    timezone: draft.timezone,
    sms_body: finalBody,
    body_without_footer: bodyWithoutFooter,
    draft_excludes_compliance_footer: WEEKLY_TTO_DRAFT_EXCLUDES_COMPLIANCE_FOOTER,
    sent_at: sentAtIso,
    stripped_compliance_footer: true,
    twilio_send_attempted: true,
    visible_sent: true,
    sms_weekly_send_event_id: reservation.eventId,
    ...(args.requestedByClerkUserId
      ? { requested_by_clerk_user_id: args.requestedByClerkUserId }
      : {}),
  };

  const { error: eventUpdateError } = await supabaseServer
    .from("sms_weekly_send_events")
    .update({
      message_sid: twilioMessageSid,
      status: twilioStatus,
      metadata: successMetadata,
    })
    .eq("clerk_user_id", draft.clerkUserId)
    .eq("week_key", draft.weekKey);

  if (eventUpdateError) {
    console.error("[tyler-text-overview-weekly-send] sms_weekly_send_events finalize failed", {
      draft_id: draft.draftId,
      error: eventUpdateError.message,
      twilio_message_sid: twilioMessageSid,
      send_source: args.sendSource,
    });
  }

  const draftFinalize = await finalizeWeeklyDraftAfterSend({
    draftId: draft.draftId,
    weeklySendEventId: reservation.eventId,
    twilioMessageSid,
    finalBodySent: finalBody,
    now: sentAt,
  });
  if (!draftFinalize.ok) {
    console.error("[tyler-text-overview-weekly-send] draft finalize failed after Twilio", {
      draft_id: draft.draftId,
      error: draftFinalize.error,
      twilio_message_sid: twilioMessageSid,
      send_source: args.sendSource,
    });
    return refuse(
      "post_send_bookkeeping_failed",
      `Twilio accepted but draft finalize failed: ${draftFinalize.error ?? "unknown"}`,
      {
        draftId: draft.draftId,
        clerkUserId: draft.clerkUserId,
        weekKey: draft.weekKey,
        twilioMessageSid,
        recoverable: false,
      }
    );
  }

  await updateGenerationMetadataAfterWeeklySend({
    generationId: draft.generationId,
    existingMetadata: draft.generationMetadata,
    weeklySendEventId: reservation.eventId,
    twilioMessageSid,
    sentAtIso,
    bodyWithoutFooter,
    finalBody,
    sendSource: args.sendSource,
  });

  const mem = await upsertCommitmentSmsThreadMemoryFromOutbound({
    commitmentId,
    clerkUserId: draft.clerkUserId,
    sentBody: bodyWithoutFooter,
    sentAt,
    messageSid: twilioMessageSid,
    source: "weekly_sms",
    expectedAnswerType: null,
  });
  if (!mem.ok) {
    console.warn("[tyler-text-overview-weekly-send] thread memory upsert failed", {
      draft_id: draft.draftId,
      error: mem.error,
      twilio_message_sid: twilioMessageSid,
      send_source: args.sendSource,
    });
  }

  return {
    ok: true,
    draftId: draft.draftId,
    clerkUserId: draft.clerkUserId,
    weekKey: draft.weekKey,
    messageSid: twilioMessageSid,
    status: twilioStatus,
    finalBodySent: finalBody,
    bodyWithoutFooter,
  };
}

export async function sendWeeklyTtoDraftManually(args: {
  draftId: string;
  weekKey?: string | null;
  requestedByClerkUserId: string;
  now?: Date;
}): Promise<WeeklyTtoManualSendResult> {
  const now = args.now ?? new Date();
  const authoritative = await assertWeeklyTtoDraftAuthoritativeForManualSend({
    draftId: args.draftId,
    weekKey: args.weekKey,
  });
  if (!authoritative.ok) return authoritative.result;

  const draft = authoritative.draft;
  const eligibilityBlock = await evaluateWeeklyManualSendEligibility({
    clerkUserId: draft.clerkUserId,
    draftId: draft.draftId,
    weekKey: draft.weekKey,
    now,
  });
  if (eligibilityBlock) return eligibilityBlock;

  const audience = await loadTylerTextOverviewAudienceRow(draft.clerkUserId);
  const phone =
    typeof audience?.phone_number === "string" ? audience.phone_number.trim() : "";
  if (!phone) {
    return refuse("no_phone", "User has no phone number", {
      draftId: draft.draftId,
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
    });
  }

  return sendWeeklyTtoDraftAuthoritative({
    draft,
    sendSource: WEEKLY_TTO_MANUAL_SEND_SOURCE,
    phoneTo: phone,
    requestedByClerkUserId: args.requestedByClerkUserId,
    now,
  });
}

export async function sendWeeklyTtoDraftViaCron(args: {
  clerkUserId: string;
  weekKey: string;
  phoneTo: string;
  now?: Date;
}): Promise<WeeklyTtoManualSendResult> {
  const authoritative = await assertWeeklyTtoDraftAuthoritativeForCronSend({
    clerkUserId: args.clerkUserId,
    weekKey: args.weekKey,
  });
  if (!authoritative.ok) return authoritative.result;

  return sendWeeklyTtoDraftAuthoritative({
    draft: authoritative.draft,
    sendSource: WEEKLY_TTO_CRON_SEND_SOURCE,
    phoneTo: args.phoneTo,
    now: args.now,
  });
}
