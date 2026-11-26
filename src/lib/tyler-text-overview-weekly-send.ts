/**
 * Weekly TTO delivery is retired.
 * Authority readers remain for historical draft inspection.
 * The send functions do not reserve a delivery or submit SMS.
 */

import { supabaseServer } from "@/lib/supabase-server";
import {
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";
import { isTylerEditTtoDraftOverride } from "@/lib/tyler-text-overview-send";
import {
  WEEKLY_TTO_COMPLIANCE_FOOTER,
  WEEKLY_TTO_DRAFT_BODY_EXCEEDS_EDITABLE_MAX,
  WEEKLY_TTO_FINAL_BODY_EXCEEDS_TWILIO_MAX,
  buildWeeklyTtoFinalBodyWithFooter,
  weeklyEditableBodyExceedsMax,
  weeklyFinalBodyExceedsTwilioMax,
} from "@/lib/weekly-tto-length";

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
  | "awaiting_sms_opt_out_review"
  | "tto_draft_not_fresh"
  | "weekly_delivery_retired";

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
): WeeklyTtoCronAuthoritySkipReason | "skipped_duplicate_weekly_send" | "skipped_missing_twilio" | "skipped_awaiting_manual_pat_answer" | "skipped_awaiting_sms_opt_out_review" | "failed" | null {
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
    case "awaiting_sms_opt_out_review":
      return "skipped_awaiting_sms_opt_out_review";
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

export async function sendWeeklyTtoDraftAuthoritative(args: {
  draft: WeeklyTtoAuthoritativeDraft;
  sendSource: WeeklyTtoSendSource;
  phoneTo: string;
  requestedByClerkUserId?: string | null;
  now?: Date;
}): Promise<WeeklyTtoManualSendResult> {
  return refuse("weekly_delivery_retired", "Weekly delivery is retired", {
    draftId: args.draft.draftId,
    clerkUserId: args.draft.clerkUserId,
    weekKey: args.draft.weekKey,
    recoverable: false,
  });
}

export async function sendWeeklyTtoDraftManually(args: {
  draftId: string;
  weekKey?: string | null;
  requestedByClerkUserId: string;
  now?: Date;
}): Promise<WeeklyTtoManualSendResult> {
  return refuse("weekly_delivery_retired", "Weekly delivery is retired", {
    draftId: args.draftId,
    recoverable: false,
  });
}

export async function sendWeeklyTtoDraftViaCron(args: {
  clerkUserId: string;
  weekKey: string;
  phoneTo: string;
  now?: Date;
}): Promise<WeeklyTtoManualSendResult> {
  return refuse("weekly_delivery_retired", "Weekly delivery is retired", {
    clerkUserId: args.clerkUserId,
    weekKey: args.weekKey,
    recoverable: false,
  });
}
