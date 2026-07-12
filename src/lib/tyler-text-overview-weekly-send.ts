/**
 * Weekly TTO manual one-row send — draft-authoritative only.
 * Never live-builds. Never calls weekly writers. Never writes check_sent / sms_send_events.
 */

import { supabaseServer } from "@/lib/supabase-server";
import { isTwilioReady, sendSMS } from "@/lib/twilio";
import { loadTylerTextOverviewAudienceRow } from "@/lib/tyler-text-overview-generate";
import {
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";
import { WEEKLY_TTO_DRAFT_EXCLUDES_COMPLIANCE_FOOTER } from "@/lib/tyler-text-overview-weekly-period";
import { resolveUserFullyOnV2ForCutoverMessaging } from "@/lib/v2-cutover-gates";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { upsertCommitmentSmsThreadMemoryFromOutbound } from "@/lib/v2-commitment-sms-thread-memory";
import {
  fetchV2UserSmsCommsPreferences,
  isPauseActive,
} from "@/lib/v2-sms-comms-preferences";
import { appendPreservedSmsSuffix } from "@/lib/v3-sms-voice-ownership";

/** Same footer string as /api/cron/weekly-sms (duplicated intentionally — do not import from cron). */
export const WEEKLY_TTO_COMPLIANCE_FOOTER =
  "Reply STOP to opt out. Reply HELP for help.";

export const WEEKLY_TTO_MANUAL_SEND_SOURCE = "weekly_tto_manual" as const;

export type WeeklyTtoManualSendRefusalCode =
  | "no_draft"
  | "wrong_slot"
  | "draft_not_current"
  | "missing_generation"
  | "week_key_mismatch"
  | "blank_body"
  | "machine_should_send_false"
  | "duplicate_weekly_send"
  | "no_phone"
  | "sms_disabled"
  | "stopped_or_unsubscribed"
  | "paused_or_canceled"
  | "not_fully_on_v2"
  | "no_commitment"
  | "twilio_not_ready"
  | "twilio_failed"
  | "reservation_failed"
  | "post_send_bookkeeping_failed";

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

export function buildWeeklyTtoFinalBodyWithFooter(bodyWithoutFooter: string): string {
  return appendPreservedSmsSuffix(bodyWithoutFooter.trim(), WEEKLY_TTO_COMPLIANCE_FOOTER);
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
      "id, clerk_user_id, draft_for_day_key, send_slot, current_generation_id, current_body_to_send, status"
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

  const clerkUserId =
    typeof draftRow.clerk_user_id === "string" ? draftRow.clerk_user_id.trim() : "";
  const base = { draftId: String(draftRow.id), clerkUserId };

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

  const generationId =
    typeof draftRow.current_generation_id === "string"
      ? draftRow.current_generation_id.trim()
      : "";
  if (!generationId) {
    return {
      ok: false,
      result: refuse("missing_generation", "Draft has no current_generation_id", base),
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
        base
      ),
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
      result: refuse("week_key_mismatch", "Generation metadata is missing week_key", {
        ...base,
      }),
    };
  }

  const requestedWeekKey = args.weekKey?.trim() || "";
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
}): Promise<
  | { ok: true; eventId: string }
  | { ok: false; result: WeeklyTtoManualSendResult }
> {
  const reserveMetadata = {
    send_source: WEEKLY_TTO_MANUAL_SEND_SOURCE,
    draft_id: args.draftId,
    generation_id: args.generationId,
    week_key: args.weekKey,
    week_start: args.weekStart,
    week_end: args.weekEnd,
    draft_for_day_key: args.draftForDayKey,
    timezone: args.timezone,
    note: "reserved_by_weekly_tto_manual_send",
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
}): Promise<void> {
  await supabaseServer
    .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
    .update({
      generation_metadata: {
        ...args.existingMetadata,
        weekly_tto_manual_sent: true,
        send_source: WEEKLY_TTO_MANUAL_SEND_SOURCE,
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
    clerkUserId: draft.clerkUserId,
    weekKey: draft.weekKey,
    draftId: draft.draftId,
    generationId: draft.generationId,
    weekStart: draft.weekStart,
    weekEnd: draft.weekEnd,
    draftForDayKey: draft.draftForDayKey,
    timezone: draft.timezone,
  });
  if (!reservation.ok) return reservation.result;

  const audience = await loadTylerTextOverviewAudienceRow(draft.clerkUserId);
  const phone =
    typeof audience?.phone_number === "string" ? audience.phone_number.trim() : "";
  if (!phone) {
    await supabaseServer
      .from("sms_weekly_send_events")
      .update({
        status: "send_failed",
        metadata: {
          send_source: WEEKLY_TTO_MANUAL_SEND_SOURCE,
          draft_id: draft.draftId,
          error: "no_phone_after_reserve",
        },
      })
      .eq("clerk_user_id", draft.clerkUserId)
      .eq("week_key", draft.weekKey);
    return refuse("no_phone", "User has no phone number", {
      draftId: draft.draftId,
      clerkUserId: draft.clerkUserId,
      weekKey: draft.weekKey,
    });
  }

  const bodyWithoutFooter = draft.bodyWithoutFooter;
  const finalBody = buildWeeklyTtoFinalBodyWithFooter(bodyWithoutFooter);

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
    const message = err instanceof Error ? err.message : String(err);
    await supabaseServer
      .from("sms_weekly_send_events")
      .update({
        status: "send_failed",
        metadata: {
          send_source: WEEKLY_TTO_MANUAL_SEND_SOURCE,
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
          requested_by_clerk_user_id: args.requestedByClerkUserId,
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
    send_source: WEEKLY_TTO_MANUAL_SEND_SOURCE,
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
    requested_by_clerk_user_id: args.requestedByClerkUserId,
    sms_weekly_send_event_id: reservation.eventId,
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
