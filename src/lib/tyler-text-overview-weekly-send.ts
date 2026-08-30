/**
 * Weekly TTO draft-authoritative send — manual + cron share this core.
 * Never live-builds. Never calls weekly writers. Never writes check_sent / sms_send_events.
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
  | "awaiting_manual_pat_answer";

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

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  return (error.message ?? "").toLowerCase().includes("duplicate");
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

async function reserveWeeklySmsSendEvent(args: {
  clerkUserId: string;
  weekKey: string;
  draftId: string;
  generationId: string;
  weekStart: string | null;
  weekEnd: string | null;
  draftForDayKey: string;
  timezone: string | null;
  sendSource: WeeklyTtoSendSource;
}): Promise<
  | { ok: true; eventId: string }
  | { ok: false; result: WeeklyTtoManualSendResult }
> {
  const reserveMetadata = {
    send_source: args.sendSource,
    draft_id: args.draftId,
    generation_id: args.generationId,
    week_key: args.weekKey,
    week_start: args.weekStart,
    week_end: args.weekEnd,
    draft_for_day_key: args.draftForDayKey,
    timezone: args.timezone,
    note:
      args.sendSource === WEEKLY_TTO_CRON_SEND_SOURCE
        ? "reserved_by_weekly_tto_cron"
        : "reserved_by_weekly_tto_manual_send",
  };

  const { data, error } = await supabaseServer
    .from("sms_weekly_send_events")
    .insert({
      clerk_user_id: args.clerkUserId,
      week_key: args.weekKey,
      status: "reserved",
      metadata: reserveMetadata,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        result: refuse(
          "duplicate_weekly_send",
          "Weekly send already reserved or sent for this user/week_key",
          {
            draftId: args.draftId,
            clerkUserId: args.clerkUserId,
            weekKey: args.weekKey,
          }
        ),
      };
    }
    return {
      ok: false,
      result: refuse(
        "reservation_failed",
        `sms_weekly_send_events reservation failed: ${error.message}`,
        {
          draftId: args.draftId,
          clerkUserId: args.clerkUserId,
          weekKey: args.weekKey,
        }
      ),
    };
  }

  if (!data?.id) {
    return {
      ok: false,
      result: refuse("reservation_failed", "sms_weekly_send_events reservation returned no id", {
        draftId: args.draftId,
        clerkUserId: args.clerkUserId,
        weekKey: args.weekKey,
      }),
    };
  }

  return { ok: true, eventId: String(data.id) };
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
  const draft = args.draft;
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

  const bodyWithoutFooter = draft.bodyWithoutFooter;
  if (weeklyEditableBodyExceedsMax(bodyWithoutFooter)) {
    return refuse("body_too_long", WEEKLY_TTO_DRAFT_BODY_EXCEEDS_EDITABLE_MAX, {
      draftId: draft.draftId,
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
    });
  }
  const finalBody = buildWeeklyTtoFinalBodyWithFooter(bodyWithoutFooter);
  if (weeklyFinalBodyExceedsTwilioMax(finalBody)) {
    return refuse("body_too_long", WEEKLY_TTO_FINAL_BODY_EXCEEDS_TWILIO_MAX, {
      draftId: draft.draftId,
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
    });
  }

  const reservation = await reserveWeeklySmsSendEvent({
    clerkUserId: draft.clerkUserId,
    weekKey: draft.weekKey,
    draftId: draft.draftId,
    generationId: draft.generationId,
    weekStart: draft.weekStart,
    weekEnd: draft.weekEnd,
    draftForDayKey: draft.draftForDayKey,
    timezone: draft.timezone,
    sendSource: args.sendSource,
  });
  if (!reservation.ok) return reservation.result;

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
