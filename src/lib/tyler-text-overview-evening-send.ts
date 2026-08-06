import { recentEventsIncludeUserYesOnLocalDay } from "@/lib/north-star-sms-context-packet";
import { supabaseServer } from "@/lib/supabase-server";
import { isTwilioReady } from "@/lib/twilio";
import {
  evaluateOutboundSmsForAccountDeletion,
} from "@/lib/account-deletion/deletion-guards";
import { loadTylerTextOverviewAudienceRow } from "@/lib/tyler-text-overview-generate";
import {
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";
import { resolveUserFullyOnV2ForCutoverMessaging } from "@/lib/v2-cutover-gates";
import { getActiveCommitment } from "@/lib/v2-commitment";
import {
  fetchV2UserSmsCommsPreferences,
  isPauseActive,
} from "@/lib/v2-sms-comms-preferences";

export const EVENING_CHECKIN_SMS_MAX_LEN = 300;
export const EVENING_PREVIEW_STALE_MS = 4 * 60 * 60 * 1000;

export type TylerTextOverviewEveningSendMode = "manual_one";

export const EVENING_PROACTIVE_SEND_DISABLED = true;
export const EVENING_PROACTIVE_SEND_DISABLED_CODE =
  "evening_proactive_send_disabled" as const;
export const EVENING_PROACTIVE_SEND_DISABLED_MESSAGE =
  "Evening proactive Twilio sends are disabled. Morning is the only proactive daily lane.";

export type TylerTextOverviewEveningSendRefusalCode =
  | "evening_proactive_send_disabled"
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
  | "stale_preview"
  | "reservation_failed"
  | "twilio_failed"
  | "account_deletion_blocks_sms"
  | "deletion_lookup_failed"
  | "missing_clerk_user_id_for_outbound_sms"
  | "post_send_bookkeeping_failed";

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

type EveningDraftRow = {
  id: string;
  clerk_user_id: string;
  draft_for_day_key: string;
  send_slot: string;
  current_generation_id: string;
  current_body_to_send: string | null;
  status: string;
  updated_at: string | null;
};

type EveningGenerationRow = {
  id: string;
  commitment_id: string | null;
  machine_should_send: boolean | null;
  generation_metadata: Record<string, unknown> | null;
  generated_at: string | null;
  send_slot: string | null;
};

type V2OutboundSnapshot = {
  v2_commitment_id: string;
  v2_template_id: number;
  v2_template_family: "standard" | "recovery";
  v2_effective_ask_text: string;
  v2_prior_outcome: string | null;
  v2_blocker_preview: string | null;
};

function refuse(
  refusalCode: TylerTextOverviewEveningSendRefusalCode,
  message: string,
  extra?: Partial<Extract<TylerTextOverviewEveningSendResult, { ok: false }>>
): TylerTextOverviewEveningSendResult {
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

function readMetadataBoolean(metadata: Record<string, unknown>, key: string): boolean | null {
  const raw = metadata[key];
  if (typeof raw === "boolean") return raw;
  return null;
}

function readMetadataObject(metadata: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return asRecord(metadata[key]);
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

function parseV2OutboundSnapshot(metadata: Record<string, unknown>): V2OutboundSnapshot | null {
  const snap = readMetadataObject(metadata, "v2_outbound_snapshot");
  if (!snap) return null;
  const commitmentId = readMetadataString(snap, "v2_commitment_id");
  const templateIdRaw = snap.v2_template_id;
  const templateId =
    typeof templateIdRaw === "number" && Number.isFinite(templateIdRaw)
      ? Math.floor(templateIdRaw)
      : NaN;
  const templateFamily = snap.v2_template_family === "recovery" ? "recovery" : "standard";
  const effectiveAsk = readMetadataString(snap, "v2_effective_ask_text");
  if (!commitmentId || !Number.isFinite(templateId) || templateId <= 0 || !effectiveAsk) {
    return null;
  }
  const priorOutcome = readMetadataString(snap, "v2_prior_outcome");
  const blockerPreview = readMetadataString(snap, "v2_blocker_preview");
  return {
    v2_commitment_id: commitmentId,
    v2_template_id: templateId,
    v2_template_family: templateFamily,
    v2_effective_ask_text: effectiveAsk,
    v2_prior_outcome: priorOutcome,
    v2_blocker_preview: blockerPreview,
  };
}

export async function loadEveningDraftBundleForSend(draftId: string): Promise<
  | { ok: true; draft: EveningDraftRow; generation: EveningGenerationRow }
  | { ok: false; refusal: TylerTextOverviewEveningSendResult }
> {
  const { data: draftRow, error: draftError } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select(
      "id, clerk_user_id, draft_for_day_key, send_slot, current_generation_id, current_body_to_send, status, updated_at"
    )
    .eq("id", draftId)
    .maybeSingle();

  if (draftError) {
    return {
      ok: false,
      refusal: refuse("draft_not_found", `draft_load_failed:${draftError.message}`, { draftId }),
    };
  }
  if (!draftRow) {
    return {
      ok: false,
      refusal: refuse("draft_not_found", "Evening draft not found", { draftId }),
    };
  }

  const draft = draftRow as EveningDraftRow;
  if (draft.send_slot !== SMS_DAILY_EVENING_PREVIEW_SEND_SLOT) {
    return {
      ok: false,
      refusal: refuse("wrong_send_slot", "Draft is not an evening_checkin preview", {
        draftId: draft.id,
        clerkUserId: draft.clerk_user_id,
        draftForDayKey: draft.draft_for_day_key,
      }),
    };
  }
  if (draft.status !== "current") {
    return {
      ok: false,
      refusal: refuse("draft_not_current", `Draft status is ${draft.status}`, {
        draftId: draft.id,
        clerkUserId: draft.clerk_user_id,
        draftForDayKey: draft.draft_for_day_key,
      }),
    };
  }

  const { data: generationRow, error: generationError } = await supabaseServer
    .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
    .select("id, commitment_id, machine_should_send, generation_metadata, generated_at, send_slot")
    .eq("id", draft.current_generation_id)
    .maybeSingle();

  if (generationError || !generationRow) {
    return {
      ok: false,
      refusal: refuse("preview_body_missing", "Current generation not found", {
        draftId: draft.id,
        clerkUserId: draft.clerk_user_id,
        draftForDayKey: draft.draft_for_day_key,
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
      refusal: refuse(
        "generation_send_slot_mismatch",
        "Generation send_slot is not evening_checkin",
        {
          draftId: draft.id,
          clerkUserId: draft.clerk_user_id,
          draftForDayKey: draft.draft_for_day_key,
        }
      ),
    };
  }

  const metadata = asRecord(generationRow.generation_metadata) ?? {};
  return {
    ok: true,
    draft,
    generation: {
      id: String(generationRow.id),
      commitment_id:
        typeof generationRow.commitment_id === "string" ? generationRow.commitment_id : null,
      machine_should_send:
        typeof generationRow.machine_should_send === "boolean"
          ? generationRow.machine_should_send
          : null,
      generation_metadata: metadata,
      generated_at:
        typeof generationRow.generated_at === "string" ? generationRow.generated_at : null,
      send_slot: generationSlot,
    },
  };
}

export async function evaluateEveningSendEligibility(args: {
  draft: EveningDraftRow;
  generation: EveningGenerationRow;
  bodyToSend: string;
  now?: Date;
}): Promise<TylerTextOverviewEveningSendResult | null> {
  const now = args.now ?? new Date();
  const { draft, generation } = args;
  const base = {
    draftId: draft.id,
    clerkUserId: draft.clerk_user_id,
    draftForDayKey: draft.draft_for_day_key,
  };

  const deletion = await evaluateOutboundSmsForAccountDeletion(draft.clerk_user_id);
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
      {
        ...base,
        recoverable: false,
      }
    );
  }

  const body = args.bodyToSend.trim();
  if (!body) {
    return refuse("body_empty", "Evening body is empty", base);
  }
  if (body.length > EVENING_CHECKIN_SMS_MAX_LEN) {
    return refuse("body_too_long", `Evening body exceeds ${EVENING_CHECKIN_SMS_MAX_LEN} characters`, base);
  }

  if (generation.machine_should_send !== true) {
    return refuse("machine_should_send_false", "machine_should_send is false for this preview", base);
  }

  const staleAt = generation.generated_at ?? draft.updated_at;
  if (staleAt) {
    const ageMs = now.getTime() - new Date(staleAt).getTime();
    if (Number.isFinite(ageMs) && ageMs > EVENING_PREVIEW_STALE_MS) {
      return refuse("stale_preview", "Evening preview is older than 4 hours — regenerate first", base);
    }
  }

  const { data: audienceRaw, error: audienceError } = await supabaseServer
    .from("sms_audience")
    .select("clerk_user_id, phone_number, sms_enabled, stopped_at, timezone, summitt_subscribed")
    .eq("clerk_user_id", draft.clerk_user_id)
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

  const commsPrefs = await fetchV2UserSmsCommsPreferences(draft.clerk_user_id);
  if (isPauseActive(commsPrefs, now)) {
    return refuse("paused_or_canceled", "User SMS pause is active", base);
  }

  const v2Status = await resolveUserFullyOnV2ForCutoverMessaging(draft.clerk_user_id);
  if (!v2Status.fullyOnV2) {
    return refuse("not_fully_on_v2", "User is not fully on V2 messaging", base);
  }

  const commitmentId =
    generation.commitment_id ??
    (await getActiveCommitment(draft.clerk_user_id))?.id ??
    null;
  const timezone =
    typeof audienceRaw.timezone === "string" && audienceRaw.timezone.trim()
      ? audienceRaw.timezone.trim()
      : "America/New_York";

  if (commitmentId) {
    const { data: yesEvents, error: yesError } = await supabaseServer
      .from("v2_commitment_event")
      .select("event_type, occurred_at")
      .eq("commitment_id", commitmentId)
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
        draft.draft_for_day_key
      );
      if (hasYesToday) {
        return refuse("user_completed_today", "User already recorded user_yes for this day", base);
      }
    }
  }

  const audienceEligible = await loadTylerTextOverviewAudienceRow(draft.clerk_user_id);
  if (!audienceEligible) {
    return refuse("stopped_or_unsubscribed", "User failed SMS audience eligibility", base);
  }

  if (!isTwilioReady()) {
    return refuse("twilio_not_configured", "Twilio is not configured", base);
  }

  return null;
}

export async function readExistingEveningSendEvent(args: {
  clerkUserId: string;
  dayKey: string;
}): Promise<
  | { kind: "none" }
  | { kind: "sent"; id: string; messageSid: string }
  | { kind: "reserved"; id: string }
  | { kind: "failed"; id: string }
> {
  const { data, error } = await supabaseServer
    .from("sms_send_events")
    .select("id, status, message_sid, metadata")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("day_key", args.dayKey)
    .eq("send_slot", SMS_DAILY_EVENING_PREVIEW_SEND_SLOT)
    .maybeSingle();

  if (error || !data?.id) return { kind: "none" };

  const id = String(data.id);
  if (hasTwilioSidOnSendEvent(data)) {
    const sid =
      typeof data.message_sid === "string" && data.message_sid.trim()
        ? data.message_sid.trim()
        : "";
    return { kind: "sent", id, messageSid: sid };
  }
  const status = typeof data.status === "string" ? data.status.trim() : "";
  if (status === "reserved") return { kind: "reserved", id };
  if (status === "send_failed") return { kind: "failed", id };
  return { kind: "reserved", id };
}

export async function reserveEveningSmsSendEvent(args: {
  clerkUserId: string;
  dayKey: string;
  draftId: string;
  generationId: string;
  requestedByClerkUserId: string;
  mode: TylerTextOverviewEveningSendMode;
  machineShouldSendAtSend: boolean;
  generationMetadata: Record<string, unknown>;
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

  const metadata = {
    send_slot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
    preview_only: false,
    tto_draft_id: args.draftId,
    tto_generation_id: args.generationId,
    sent_by_clerk_user_id: args.requestedByClerkUserId,
    send_mode: args.mode,
    machine_should_send_at_send: args.machineShouldSendAtSend,
    morning_anchor_source: readMetadataString(args.generationMetadata, "morning_anchor_source"),
    morning_anchor_body_preview: readMetadataString(
      args.generationMetadata,
      "morning_anchor_body_preview"
    ),
    slot_coaching_context: readMetadataObject(args.generationMetadata, "slot_coaching_context"),
    note: "reserved_by_evening_manual_send",
  };

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
      const after = await readExistingEveningSendEvent({
        clerkUserId: args.clerkUserId,
        dayKey: args.dayKey,
      });
      if (after.kind === "sent") {
        return {
          ok: false,
          result: refuse("already_sent_evening_today", "Evening check-in already sent for this day", {
            draftId: args.draftId,
            clerkUserId: args.clerkUserId,
            draftForDayKey: args.dayKey,
          }),
        };
      }
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

export async function updateEveningGenerationMetadataAfterSend(args: {
  generationId: string;
  requestedByClerkUserId: string;
  mode: TylerTextOverviewEveningSendMode;
  smsSendEventId: string;
  twilioMessageSid: string;
  sentAtIso: string;
  existingMetadata: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: string }> {
  const merged = {
    ...args.existingMetadata,
    preview_only: false,
    sent_via: args.mode,
    sent_by_clerk_user_id: args.requestedByClerkUserId,
    sent_at: args.sentAtIso,
    twilio_message_sid: args.twilioMessageSid,
    sms_send_event_id: args.smsSendEventId,
  };

  const { error } = await supabaseServer
    .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
    .update({ generation_metadata: merged })
    .eq("id", args.generationId);

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function resolveEveningV2OutboundSnapshot(args: {
  generation: EveningGenerationRow;
  bodyToSend: string;
  clerkUserId: string;
}): Promise<V2OutboundSnapshot | null> {
  const metadata = args.generation.generation_metadata ?? {};
  const fromMeta = parseV2OutboundSnapshot(metadata);
  if (fromMeta) return fromMeta;

  const commitmentId =
    args.generation.commitment_id ?? (await getActiveCommitment(args.clerkUserId))?.id ?? null;
  if (!commitmentId) return null;

  return {
    v2_commitment_id: commitmentId,
    v2_template_id: 1,
    v2_template_family: "standard",
    v2_effective_ask_text: args.bodyToSend,
    v2_prior_outcome: readMetadataString(metadata, "route_kind"),
    v2_blocker_preview: null,
  };
}

export async function sendTylerTextOverviewEveningDraft(args: {
  draftId: string;
  requestedByClerkUserId: string;
  mode: "manual_one";
  now?: Date;
}): Promise<TylerTextOverviewEveningSendResult> {
  void args;
  // Evening proactive Twilio sends are disabled. Draft generate/review may remain dormant.
  return refuse(
    EVENING_PROACTIVE_SEND_DISABLED_CODE,
    EVENING_PROACTIVE_SEND_DISABLED_MESSAGE
  );
}
