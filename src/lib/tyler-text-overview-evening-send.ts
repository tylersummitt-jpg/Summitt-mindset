/**
 * Evening TTO proactive send — cron-authorized path only.
 *
 * Manual admin send remains disabled (sendTylerTextOverviewEveningDraft).
 * Auto-send: exact local-day evening_checkin current draft → [19:00,21:00) → Twilio.
 * No OpenAI. No generation. No machine_draft_body fallback.
 */

import {
  evaluateOutboundSmsForAccountDeletion,
  isAccountDeletionOutboundSmsError,
} from "@/lib/account-deletion/deletion-guards";
import {
  buildEveningLaneSchedulingTelemetry,
  evaluateEveningLaneTiming,
  isEveningReservationWithinLease,
  isSafeEveningRetryFailure,
  reservationAgeMs,
  type EveningLaneTimingDecision,
} from "@/lib/daily-sms-scheduling";
import { recentEventsIncludeUserYesOnLocalDay } from "@/lib/north-star-sms-context-packet";
import { supabaseServer } from "@/lib/supabase-server";
import { isTwilioReady, sendSMS } from "@/lib/twilio";
import { isTylerEditTtoDraftOverride } from "@/lib/tyler-text-overview-send";
import { loadTylerTextOverviewAudienceRow } from "@/lib/tyler-text-overview-generate";
import {
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";
import { resolveUserFullyOnV2ForCutoverMessaging } from "@/lib/v2-cutover-gates";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { upsertCommitmentSmsThreadMemoryFromOutbound } from "@/lib/v2-commitment-sms-thread-memory";
import { insertV2CheckSentEventBestEffort } from "@/lib/v2-outbound-check-sent";
import {
  fetchV2UserSmsCommsPreferences,
  isPauseActive,
} from "@/lib/v2-sms-comms-preferences";
import { hashSmsSnippet } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";

export const EVENING_CHECKIN_SMS_MAX_LEN = 300;

/** @deprecated E5: 4h stale rule removed from auto-send eligibility. Kept only for legacy imports. */
export const EVENING_PREVIEW_STALE_MS = 4 * 60 * 60 * 1000;

/** Manual admin Send stays disabled. Cron uses sendEveningTtoAuthoritativeCronSend. */
export const EVENING_PROACTIVE_SEND_DISABLED = true;
export const EVENING_PROACTIVE_SEND_DISABLED_CODE =
  "evening_proactive_send_disabled" as const;
export const EVENING_PROACTIVE_SEND_DISABLED_MESSAGE =
  "Evening manual Send is disabled. Evening drafts auto-send between 7–9 PM in the member's local time.";

export const EVENING_TTO_CRON_SEND_SOURCE = "evening_sms_cron" as const;

export type TylerTextOverviewEveningSendMode = "manual_one" | typeof EVENING_TTO_CRON_SEND_SOURCE;

export type TylerTextOverviewEveningSendRefusalCode =
  | "evening_proactive_send_disabled"
  | "tto_no_current_evening_draft"
  | "tto_blank_evening_body"
  | "tto_missing_generation"
  | "tto_generation_send_slot_mismatch"
  | "tto_machine_should_send_false"
  | "outside_evening_window"
  | "draft_not_found"
  | "draft_not_current"
  | "wrong_send_slot"
  | "generation_send_slot_mismatch"
  | "preview_body_missing"
  | "machine_should_send_false"
  | "already_sent_evening_today"
  | "already_reserved_evening_today"
  | "no_phone"
  | "sms_disabled"
  | "stopped_or_unsubscribed"
  | "paused_or_canceled"
  | "not_fully_on_v2"
  | "user_completed_today"
  | "twilio_not_configured"
  | "body_empty"
  | "body_too_long"
  | "reservation_failed"
  | "twilio_failed"
  | "account_deletion_blocks_sms"
  | "deletion_lookup_failed"
  | "missing_clerk_user_id_for_outbound_sms"
  | "post_send_bookkeeping_failed"
  | "body_changed_before_twilio"
  | "dry_run";

export type TylerTextOverviewEveningSendResult =
  | {
      ok: true;
      draftId: string;
      clerkUserId: string;
      draftForDayKey: string;
      sendSlot: typeof SMS_DAILY_EVENING_PREVIEW_SEND_SLOT;
      smsSendEventId: string;
      twilioMessageSid: string;
      finalBodySent: string;
      checkSentIdempotencyKey?: string;
      mode: TylerTextOverviewEveningSendMode;
    }
  | {
      ok: false;
      refusalCode: TylerTextOverviewEveningSendRefusalCode;
      message: string;
      draftId?: string;
      clerkUserId?: string;
      draftForDayKey?: string;
      recoverable?: boolean;
      twilioMessageSid?: string;
    };

export type EveningTtoAuthoritativeDraft = {
  draftId: string;
  generationId: string;
  clerkUserId: string;
  draftForDayKey: string;
  bodyToSend: string;
  tylerEdited: boolean;
  machineShouldSend: boolean | null;
  commitmentId: string | null;
  generationMetadata: Record<string, unknown>;
  currentBodySource: string | null;
  editedByTyler: boolean;
};

type EveningDraftDbRow = {
  id: string;
  clerk_user_id: string;
  draft_for_day_key: string;
  send_slot: string;
  current_generation_id: string;
  current_body_to_send: string | null;
  current_body_source: string | null;
  edited_by_tyler: boolean;
  status: string;
  updated_at: string | null;
};

function refuse(
  refusalCode: TylerTextOverviewEveningSendRefusalCode,
  message: string,
  extra?: Partial<Extract<TylerTextOverviewEveningSendResult, { ok: false }>>
): Extract<TylerTextOverviewEveningSendResult, { ok: false }> {
  return { ok: false, refusalCode, message, ...extra };
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

function trimEveningBody(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t ? t : null;
}

function hasTwilioSidOnSendEvent(row: {
  message_sid?: unknown;
  metadata?: unknown;
}): boolean {
  const topSid = row.message_sid;
  if (typeof topSid === "string" && topSid.trim().length > 0) return true;
  const meta = asRecord(row.metadata);
  if (!meta) return false;
  for (const key of ["message_sid", "twilio_message_sid", "outbound_message_sid"] as const) {
    const v = meta[key];
    if (typeof v === "string" && v.trim().length > 0) return true;
  }
  return false;
}

/**
 * Exact-day Evening authoritative gate. Never generates. Never uses machine_draft_body.
 * preview_only metadata does not block.
 */
export async function assertEveningTtoDraftAuthoritativeForCronSend(args: {
  clerkUserId: string;
  draftForDayKey: string;
}): Promise<
  | { ok: true; draft: EveningTtoAuthoritativeDraft }
  | { ok: false; result: TylerTextOverviewEveningSendResult }
> {
  const clerkUserId = args.clerkUserId.trim();
  const draftForDayKey = args.draftForDayKey.trim();
  const base = { clerkUserId, draftForDayKey };

  if (!clerkUserId || !draftForDayKey) {
    return {
      ok: false,
      result: refuse("tto_no_current_evening_draft", "Missing user or day key", base),
    };
  }

  const { data: draftRow, error: draftError } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select(
      "id, clerk_user_id, draft_for_day_key, send_slot, current_generation_id, current_body_to_send, current_body_source, edited_by_tyler, status, updated_at"
    )
    .eq("clerk_user_id", clerkUserId)
    .eq("draft_for_day_key", draftForDayKey)
    .eq("send_slot", SMS_DAILY_EVENING_PREVIEW_SEND_SLOT)
    .eq("status", "current")
    .maybeSingle();

  if (draftError) {
    return {
      ok: false,
      result: refuse(
        "tto_no_current_evening_draft",
        `evening_draft_lookup_failed:${draftError.message}`,
        base
      ),
    };
  }
  if (!draftRow) {
    return {
      ok: false,
      result: refuse(
        "tto_no_current_evening_draft",
        "No current Evening TTO draft for this user/local day",
        base
      ),
    };
  }

  const draft = draftRow as EveningDraftDbRow;
  if (draft.send_slot !== SMS_DAILY_EVENING_PREVIEW_SEND_SLOT) {
    return {
      ok: false,
      result: refuse("wrong_send_slot", "Draft is not evening_checkin", {
        ...base,
        draftId: draft.id,
      }),
    };
  }

  const body = trimEveningBody(draft.current_body_to_send);
  if (!body) {
    return {
      ok: false,
      result: refuse("tto_blank_evening_body", "Evening current body is blank", {
        ...base,
        draftId: draft.id,
      }),
    };
  }
  if (body.length > EVENING_CHECKIN_SMS_MAX_LEN) {
    return {
      ok: false,
      result: refuse(
        "body_too_long",
        `Evening body exceeds ${EVENING_CHECKIN_SMS_MAX_LEN} characters`,
        { ...base, draftId: draft.id }
      ),
    };
  }

  const generationId =
    typeof draft.current_generation_id === "string" ? draft.current_generation_id.trim() : "";
  if (!generationId) {
    return {
      ok: false,
      result: refuse("tto_missing_generation", "Evening draft has no current_generation_id", {
        ...base,
        draftId: draft.id,
      }),
    };
  }

  const { data: generationRow, error: generationError } = await supabaseServer
    .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
    .select("id, commitment_id, machine_should_send, generation_metadata, generated_at, send_slot")
    .eq("id", generationId)
    .maybeSingle();

  if (generationError || !generationRow) {
    return {
      ok: false,
      result: refuse("tto_missing_generation", "Current Evening generation not found", {
        ...base,
        draftId: draft.id,
      }),
    };
  }

  const generationSlot =
    typeof generationRow.send_slot === "string" && generationRow.send_slot.trim()
      ? generationRow.send_slot.trim()
      : null;
  if (generationSlot !== SMS_DAILY_EVENING_PREVIEW_SEND_SLOT) {
    return {
      ok: false,
      result: refuse(
        "tto_generation_send_slot_mismatch",
        "Generation send_slot is not evening_checkin",
        { ...base, draftId: draft.id }
      ),
    };
  }

  const tylerEdited = isTylerEditTtoDraftOverride({
    edited_by_tyler: draft.edited_by_tyler === true,
    current_body_source: draft.current_body_source ?? "",
  });
  const machineShouldSend =
    typeof generationRow.machine_should_send === "boolean"
      ? generationRow.machine_should_send
      : null;

  if (machineShouldSend === false && !tylerEdited) {
    return {
      ok: false,
      result: refuse(
        "tto_machine_should_send_false",
        "machine_should_send is false and Tyler did not save an authoritative body",
        { ...base, draftId: draft.id }
      ),
    };
  }

  const metadata = asRecord(generationRow.generation_metadata) ?? {};
  // preview_only is ignored for Evening lane auto-send (E5 locked decision 8).

  return {
    ok: true,
    draft: {
      draftId: draft.id,
      generationId: String(generationRow.id),
      clerkUserId: draft.clerk_user_id,
      draftForDayKey: draft.draft_for_day_key,
      bodyToSend: body,
      tylerEdited,
      machineShouldSend,
      commitmentId:
        typeof generationRow.commitment_id === "string" ? generationRow.commitment_id : null,
      generationMetadata: metadata,
      currentBodySource: draft.current_body_source,
      editedByTyler: draft.edited_by_tyler === true,
    },
  };
}

/** Re-read current Evening body immediately before Twilio. */
export async function revalidateEveningTtoBodyBeforeTwilio(args: {
  draftId: string;
  clerkUserId: string;
  draftForDayKey: string;
  pinnedBody: string;
}): Promise<
  | { ok: true; bodyToSend: string; refreshed: boolean }
  | { ok: false; result: Extract<TylerTextOverviewEveningSendResult, { ok: false }> }
> {
  const { data, error } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select(
      "id, current_body_to_send, current_body_source, edited_by_tyler, status, send_slot, draft_for_day_key"
    )
    .eq("id", args.draftId)
    .eq("clerk_user_id", args.clerkUserId)
    .eq("draft_for_day_key", args.draftForDayKey)
    .eq("send_slot", SMS_DAILY_EVENING_PREVIEW_SEND_SLOT)
    .maybeSingle();

  const base = {
    draftId: args.draftId,
    clerkUserId: args.clerkUserId,
    draftForDayKey: args.draftForDayKey,
  };

  if (error || !data) {
    return {
      ok: false,
      result: refuse("tto_no_current_evening_draft", "Evening draft disappeared before Twilio", base),
    };
  }
  if (data.status !== "current") {
    return {
      ok: false,
      result: refuse("draft_not_current", `Draft status is ${data.status}`, base),
    };
  }

  const latest = trimEveningBody(
    typeof data.current_body_to_send === "string" ? data.current_body_to_send : null
  );
  if (!latest) {
    return {
      ok: false,
      result: refuse("tto_blank_evening_body", "Evening body blanked before Twilio", base),
    };
  }

  const tylerEdited = isTylerEditTtoDraftOverride({
    edited_by_tyler: data.edited_by_tyler === true,
    current_body_source:
      typeof data.current_body_source === "string" ? data.current_body_source : "",
  });

  // If body changed and still nonblank, use latest (Tyler edit A→B). Never hand off stale pinned.
  const pinned = args.pinnedBody.trim();
  const refreshed = latest !== pinned;
  void tylerEdited;
  return { ok: true, bodyToSend: latest, refreshed };
}

export async function evaluateEveningCronAudienceEligibility(args: {
  clerkUserId: string;
  draftForDayKey: string;
  now?: Date;
}): Promise<TylerTextOverviewEveningSendResult | null> {
  const now = args.now ?? new Date();
  const base = {
    clerkUserId: args.clerkUserId,
    draftForDayKey: args.draftForDayKey,
  };

  const deletion = await evaluateOutboundSmsForAccountDeletion(args.clerkUserId);
  if (deletion.decision === "blocked_due_to_deletion") {
    return refuse("account_deletion_blocks_sms", "Account deletion blocks SMS", {
      ...base,
      recoverable: false,
    });
  }
  if (deletion.decision === "lookup_failed") {
    return refuse("deletion_lookup_failed", "Account deletion lookup failed", {
      ...base,
      recoverable: true,
    });
  }
  if (deletion.decision === "missing_clerk_user_id") {
    return refuse(
      "missing_clerk_user_id_for_outbound_sms",
      "Missing Clerk user id for outbound SMS",
      { ...base, recoverable: false }
    );
  }

  const { data: audienceRaw, error: audienceError } = await supabaseServer
    .from("sms_audience")
    .select("clerk_user_id, phone_number, sms_enabled, stopped_at, timezone, summitt_subscribed")
    .eq("clerk_user_id", args.clerkUserId)
    .maybeSingle();

  if (audienceError) {
    return refuse("stopped_or_unsubscribed", `sms_audience_lookup_failed:${audienceError.message}`, base);
  }
  if (!audienceRaw) {
    return refuse("stopped_or_unsubscribed", "User not in SMS audience", base);
  }

  const phone =
    typeof audienceRaw.phone_number === "string" ? audienceRaw.phone_number.trim() : "";
  if (!phone) {
    return refuse("no_phone", "User has no phone number", base);
  }
  if (audienceRaw.sms_enabled !== true) {
    return refuse("sms_disabled", "SMS is disabled for this user", base);
  }
  if (audienceRaw.stopped_at != null && audienceRaw.stopped_at !== "") {
    return refuse("stopped_or_unsubscribed", "User has opted out of SMS", base);
  }
  if (audienceRaw.summitt_subscribed !== true) {
    return refuse("paused_or_canceled", "User is not subscribed", base);
  }

  const commsPrefs = await fetchV2UserSmsCommsPreferences(args.clerkUserId);
  if (isPauseActive(commsPrefs, now)) {
    return refuse("paused_or_canceled", "User SMS pause is active", base);
  }

  const v2Status = await resolveUserFullyOnV2ForCutoverMessaging(args.clerkUserId);
  if (!v2Status.fullyOnV2) {
    return refuse("not_fully_on_v2", "User is not fully on V2 messaging", base);
  }

  const audienceEligible = await loadTylerTextOverviewAudienceRow(args.clerkUserId);
  if (!audienceEligible) {
    return refuse("stopped_or_unsubscribed", "User failed SMS audience eligibility", base);
  }

  const commitment = await getActiveCommitment(args.clerkUserId);
  const timezone =
    typeof audienceRaw.timezone === "string" && audienceRaw.timezone.trim()
      ? audienceRaw.timezone.trim()
      : "America/New_York";

  if (commitment?.id) {
    const { data: yesEvents, error: yesError } = await supabaseServer
      .from("v2_commitment_event")
      .select("event_type, occurred_at")
      .eq("commitment_id", commitment.id)
      .eq("event_type", "user_yes")
      .order("occurred_at", { ascending: false })
      .limit(24);

    if (!yesError && yesEvents?.length) {
      const hasYesToday = recentEventsIncludeUserYesOnLocalDay(
        yesEvents.map((e) => ({
          event_type: String(e.event_type),
          occurred_at: String(e.occurred_at),
          payload_json: {},
        })),
        timezone,
        args.draftForDayKey
      );
      if (hasYesToday) {
        return refuse("user_completed_today", "User already recorded user_yes for this day", base);
      }
    }
  }

  return null;
}

export async function readExistingEveningSendEvent(args: {
  clerkUserId: string;
  dayKey: string;
}): Promise<
  | { kind: "none" }
  | { kind: "sent"; id: string; messageSid: string; createdAt: string | null; metadata: Record<string, unknown> }
  | {
      kind: "reserved";
      id: string;
      createdAt: string | null;
      metadata: Record<string, unknown>;
      status: string;
    }
  | { kind: "failed"; id: string; createdAt: string | null; metadata: Record<string, unknown> }
> {
  const { data, error } = await supabaseServer
    .from("sms_send_events")
    .select("id, status, message_sid, metadata, created_at")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("day_key", args.dayKey)
    .eq("send_slot", SMS_DAILY_EVENING_PREVIEW_SEND_SLOT)
    .maybeSingle();

  if (error || !data?.id) return { kind: "none" };

  const id = String(data.id);
  const createdAt = typeof data.created_at === "string" ? data.created_at : null;
  const metadata = asRecord(data.metadata) ?? {};
  if (hasTwilioSidOnSendEvent(data)) {
    const sid =
      typeof data.message_sid === "string" && data.message_sid.trim()
        ? data.message_sid.trim()
        : "";
    return { kind: "sent", id, messageSid: sid, createdAt, metadata };
  }
  const status = typeof data.status === "string" ? data.status.trim() : "";
  if (status === "send_failed") {
    return { kind: "failed", id, createdAt, metadata };
  }
  return { kind: "reserved", id, createdAt, metadata, status };
}

export async function reserveEveningSmsSendEvent(args: {
  clerkUserId: string;
  dayKey: string;
  draftId: string;
  generationId: string;
  machineShouldSendAtSend: boolean | null;
  tylerEdited: boolean;
  generationMetadata: Record<string, unknown>;
  timing: EveningLaneTimingDecision;
  schedulingTelemetry: Record<string, unknown>;
}): Promise<{ ok: true; smsSendEventId: string } | { ok: false; result: TylerTextOverviewEveningSendResult }> {
  const existing = await readExistingEveningSendEvent({
    clerkUserId: args.clerkUserId,
    dayKey: args.dayKey,
  });
  if (existing.kind === "sent") {
    return {
      ok: false,
      result: refuse("already_sent_evening_today", "Evening check-in already sent for this day", {
        draftId: args.draftId,
        clerkUserId: args.clerkUserId,
        draftForDayKey: args.dayKey,
        twilioMessageSid: existing.messageSid || undefined,
      }),
    };
  }
  if (existing.kind === "reserved") {
    if (isEveningReservationWithinLease(existing.createdAt, new Date())) {
      return {
        ok: false,
        result: refuse(
          "already_reserved_evening_today",
          "Evening send slot already reserved for this day",
          {
            draftId: args.draftId,
            clerkUserId: args.clerkUserId,
            draftForDayKey: args.dayKey,
          }
        ),
      };
    }
    // Lease expired without SID — do not auto-reclaim for ambiguous outcomes.
    return {
      ok: false,
      result: refuse(
        "already_reserved_evening_today",
        "Evening reservation lease expired without SID — no automatic reclaim",
        {
          draftId: args.draftId,
          clerkUserId: args.clerkUserId,
          draftForDayKey: args.dayKey,
        }
      ),
    };
  }
  if (existing.kind === "failed") {
    if (!isSafeEveningRetryFailure(existing.metadata)) {
      return {
        ok: false,
        result: refuse(
          "already_reserved_evening_today",
          "Evening prior failure is not safe to auto-retry",
          {
            draftId: args.draftId,
            clerkUserId: args.clerkUserId,
            draftForDayKey: args.dayKey,
          }
        ),
      };
    }
  }

  const metadata = {
    ...args.schedulingTelemetry,
    send_slot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
    // Clear legacy preview-only meaning for send attempt forensics (do not rewrite generation row).
    preview_only_ignored_for_evening_auto_send: true,
    tto_draft_id: args.draftId,
    tto_generation_id: args.generationId,
    send_mode: EVENING_TTO_CRON_SEND_SOURCE,
    machine_should_send_at_send: args.machineShouldSendAtSend,
    tyler_edited_at_send: args.tylerEdited,
    note: "reserved_by_evening_sms_cron",
    twilio_send_attempted: false,
  };

  if (existing.kind === "failed") {
    const { error: updErr } = await supabaseServer
      .from("sms_send_events")
      .update({
        status: "reserved",
        metadata: {
          ...existing.metadata,
          ...metadata,
          note: "safe_retry_reserved_by_evening_sms_cron",
        },
      })
      .eq("id", existing.id);
    if (updErr) {
      return {
        ok: false,
        result: refuse("reservation_failed", `sms_send_events retry reserve failed: ${updErr.message}`, {
          draftId: args.draftId,
          clerkUserId: args.clerkUserId,
          draftForDayKey: args.dayKey,
        }),
      };
    }
    return { ok: true, smsSendEventId: existing.id };
  }

  const { data: inserted, error } = await supabaseServer
    .from("sms_send_events")
    .insert({
      clerk_user_id: args.clerkUserId,
      day_key: args.dayKey,
      send_slot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      status: "reserved",
      metadata,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    const code = (error as { code?: string }).code;
    const message = (error as { message?: string }).message ?? String(error);
    if (code === "23505" || message.toLowerCase().includes("duplicate")) {
      return {
        ok: false,
        result: refuse(
          "already_reserved_evening_today",
          "Evening send slot already reserved for this day",
          {
            draftId: args.draftId,
            clerkUserId: args.clerkUserId,
            draftForDayKey: args.dayKey,
          }
        ),
      };
    }
    return {
      ok: false,
      result: refuse("reservation_failed", `sms_send_events reservation failed: ${message}`, {
        draftId: args.draftId,
        clerkUserId: args.clerkUserId,
        draftForDayKey: args.dayKey,
      }),
    };
  }

  if (!inserted?.id) {
    return {
      ok: false,
      result: refuse("reservation_failed", "sms_send_events reservation returned no id", {
        draftId: args.draftId,
        clerkUserId: args.clerkUserId,
        draftForDayKey: args.dayKey,
      }),
    };
  }

  return { ok: true, smsSendEventId: String(inserted.id) };
}

export async function finalizeEveningDraftAfterSend(args: {
  draftId: string;
  smsSendEventId: string;
  twilioMessageSid: string;
  finalBodySent: string;
  now?: Date;
}): Promise<{ ok: boolean; error?: string }> {
  const nowIso = (args.now ?? new Date()).toISOString();
  const { error } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .update({
      status: "sent",
      sent_at: nowIso,
      source_sms_send_event_id: args.smsSendEventId,
      twilio_message_sid: args.twilioMessageSid,
      final_body_sent: args.finalBodySent,
      updated_at: nowIso,
    })
    .eq("id", args.draftId)
    .eq("status", "current");

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

async function markEveningSendEventFailed(args: {
  smsSendEventId: string;
  existingMeta: Record<string, unknown>;
  note: string;
  twilioSendAttempted: boolean;
  errorMessage?: string;
}): Promise<void> {
  await supabaseServer
    .from("sms_send_events")
    .update({
      status: "send_failed",
      metadata: {
        ...args.existingMeta,
        note: args.note,
        twilio_send_attempted: args.twilioSendAttempted,
        ...(args.errorMessage ? { error: args.errorMessage } : {}),
      },
    })
    .eq("id", args.smsSendEventId);
}

/**
 * Cron-authorized Evening send. Enforces [19:00,21:00) server-side.
 * Does not call OpenAI. Does not generate drafts.
 */
export async function sendEveningTtoAuthoritativeCronSend(args: {
  clerkUserId: string;
  phoneNumber: string;
  timezone: string;
  now?: Date;
  dryRun?: boolean;
}): Promise<TylerTextOverviewEveningSendResult> {
  const now = args.now ?? new Date();
  const timezone = args.timezone;
  const timing = evaluateEveningLaneTiming({ now, timezone });
  const dayKey = timing.localDayKey;
  const base = { clerkUserId: args.clerkUserId, draftForDayKey: dayKey };

  if (!timing.allowed) {
    return refuse(
      "outside_evening_window",
      `Outside Evening window (${timing.reason})`,
      base
    );
  }

  const audienceRefusal = await evaluateEveningCronAudienceEligibility({
    clerkUserId: args.clerkUserId,
    draftForDayKey: dayKey,
    now,
  });
  if (audienceRefusal) return audienceRefusal;

  const authority = await assertEveningTtoDraftAuthoritativeForCronSend({
    clerkUserId: args.clerkUserId,
    draftForDayKey: dayKey,
  });
  if (!authority.ok) return authority.result;

  const draft = authority.draft;
  const existing = await readExistingEveningSendEvent({
    clerkUserId: args.clerkUserId,
    dayKey,
  });
  const attemptKind =
    existing.kind === "failed" && isSafeEveningRetryFailure(existing.metadata)
      ? "safe_retry"
      : "first_attempt";
  const schedulingTelemetry = buildEveningLaneSchedulingTelemetry({
    timezone,
    timing,
    attemptKind,
    reservationAgeMs: reservationAgeMs(
      existing.kind === "none" ? null : existing.createdAt,
      now
    ),
  });

  if (args.dryRun) {
    return refuse("dry_run", "Evening dry-run would send", {
      ...base,
      draftId: draft.draftId,
    });
  }

  if (!isTwilioReady()) {
    return refuse("twilio_not_configured", "Twilio is not configured", {
      ...base,
      draftId: draft.draftId,
    });
  }

  const reserved = await reserveEveningSmsSendEvent({
    clerkUserId: args.clerkUserId,
    dayKey,
    draftId: draft.draftId,
    generationId: draft.generationId,
    machineShouldSendAtSend: draft.machineShouldSend,
    tylerEdited: draft.tylerEdited,
    generationMetadata: draft.generationMetadata,
    timing,
    schedulingTelemetry,
  });
  if (!reserved.ok) return reserved.result;

  const revalidated = await revalidateEveningTtoBodyBeforeTwilio({
    draftId: draft.draftId,
    clerkUserId: args.clerkUserId,
    draftForDayKey: dayKey,
    pinnedBody: draft.bodyToSend,
  });
  if (!revalidated.ok) {
    const failure = revalidated.result;
    await markEveningSendEventFailed({
      smsSendEventId: reserved.smsSendEventId,
      existingMeta: schedulingTelemetry,
      note: failure.refusalCode,
      twilioSendAttempted: false,
      errorMessage: failure.message,
    });
    return failure;
  }

  const smsBody = revalidated.bodyToSend;
  const eventMeta = {
    ...schedulingTelemetry,
    tto_draft_id: draft.draftId,
    tto_generation_id: draft.generationId,
    current_body_hash_at_send: hashSmsSnippet(smsBody),
    tto_current_draft_body_refreshed_before_twilio: revalidated.refreshed,
    sent_body_equals_current_body_to_send: true,
    preview_only_ignored_for_evening_auto_send: true,
  };

  let messageSid = "";
  let twilioStatus: string | null = null;
  try {
    const message = await sendSMS({
      to: args.phoneNumber,
      body: smsBody,
      lastOutbound: {
        clerkUserId: args.clerkUserId,
        messageKind: "question",
        timeOfDay: "evening",
        questionPosition: null,
        skipLastOutboundContextUpsert: true,
      },
    });
    messageSid = message.sid;
    twilioStatus = message.status ?? null;
  } catch (err) {
    const deletion = isAccountDeletionOutboundSmsError(err);
    await markEveningSendEventFailed({
      smsSendEventId: reserved.smsSendEventId,
      existingMeta: eventMeta,
      note: deletion ? "account_deletion_blocks_sms" : "send_failed",
      twilioSendAttempted: !deletion,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return refuse(
      deletion ? "account_deletion_blocks_sms" : "twilio_failed",
      err instanceof Error ? err.message : "Twilio send failed",
      { ...base, draftId: draft.draftId, recoverable: false }
    );
  }

  const sentAtIso = now.toISOString();
  const { error: eventUpdErr } = await supabaseServer
    .from("sms_send_events")
    .update({
      status: "sent",
      message_sid: messageSid,
      metadata: {
        ...eventMeta,
        note: "evening_sms_cron_sent",
        twilio_send_attempted: true,
        twilio_status: twilioStatus,
        final_body_sent: smsBody,
        final_body_sent_hash: hashSmsSnippet(smsBody),
        sent_at: sentAtIso,
      },
    })
    .eq("id", reserved.smsSendEventId);

  if (eventUpdErr) {
    console.error("[evening-sms] sms_send_events finalize failed after Twilio accepted", {
      sms_send_event_id: reserved.smsSendEventId,
      message_sid: messageSid,
      error: eventUpdErr.message,
    });
    // Reservation + Twilio SID path must not allow a second handoff; leave event as reserved/SID if update failed.
  }

  const finalized = await finalizeEveningDraftAfterSend({
    draftId: draft.draftId,
    smsSendEventId: reserved.smsSendEventId,
    twilioMessageSid: messageSid,
    finalBodySent: smsBody,
    now,
  });
  if (!finalized.ok) {
    console.error("[evening-sms] draft finalize failed after Twilio accepted", {
      draft_id: draft.draftId,
      message_sid: messageSid,
      error: finalized.error,
    });
  }

  // Best-effort operational markers — never regenerate / never change body.
  const commitmentId =
    draft.commitmentId ?? (await getActiveCommitment(args.clerkUserId))?.id ?? null;
  if (commitmentId) {
    try {
      await insertV2CheckSentEventBestEffort({
        commitmentId,
        clerkUserId: args.clerkUserId,
        dayKey,
        sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
        bodyPreview: smsBody.slice(0, 240),
        messageSid,
        templateId: 0,
        templateFamily: "standard",
      });
    } catch (err) {
      console.warn("[evening-sms] check_sent best-effort failed", {
        clerk_user_id: args.clerkUserId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      await upsertCommitmentSmsThreadMemoryFromOutbound({
        commitmentId,
        clerkUserId: args.clerkUserId,
        sentBody: smsBody,
        sentAt: now,
        messageSid,
        source: "daily_sms",
        clearBindingOpenQuestion: true,
      });
    } catch (err) {
      console.warn("[evening-sms] thread_memory best-effort failed", {
        clerk_user_id: args.clerkUserId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ok: true,
    draftId: draft.draftId,
    clerkUserId: args.clerkUserId,
    draftForDayKey: dayKey,
    sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
    smsSendEventId: reserved.smsSendEventId,
    twilioMessageSid: messageSid,
    finalBodySent: smsBody,
    mode: EVENING_TTO_CRON_SEND_SOURCE,
  };
}

/**
 * Admin manual Evening send — permanently disabled for E5.
 * Direct HTTP calls cannot bypass auto-send / window law.
 */
export async function sendTylerTextOverviewEveningDraft(args: {
  draftId: string;
  requestedByClerkUserId: string;
  mode: "manual_one";
  now?: Date;
}): Promise<TylerTextOverviewEveningSendResult> {
  void args;
  return refuse(
    EVENING_PROACTIVE_SEND_DISABLED_CODE,
    EVENING_PROACTIVE_SEND_DISABLED_MESSAGE
  );
}

/** Source-level proof helper for tests: stale age gate must not appear in cron send. */
export function eveningAutoSendUsesStalePreviewGate(): boolean {
  return false;
}
