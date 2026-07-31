/**
 * Daily SMS cron: V2 accountability outbound only (PR6).
 * sms_send_events reservation is one row per (user, day_key, send_slot); Phase 1 writes morning only.
 */
import crypto from "crypto";
import { NextResponse } from "next/server";
import { getClerkUser } from "@/lib/clerk-rest";
import { syncSmsAudience } from "@/lib/sms-audience-sync";
import { supabaseServer } from "@/lib/supabase-server";
import { smsTimePreferenceFromClerkMetadata } from "@/lib/sms-daily-delivery-body";
import { getDateKeyInTimezone, resolveSmsUserTimezone } from "@/lib/timezone";
import { sendSMS, isTwilioReady } from "@/lib/twilio";
import {
  evaluateOutboundSmsForAccountDeletion,
  isAccountDeletionOutboundSmsError,
  reservedSendEventPatchForDeletionError,
} from "@/lib/account-deletion/deletion-guards";
import { clearStaleAdaptiveContractColumns } from "@/lib/v2-adaptive-contract";
import { shouldSendV2CadenceToday } from "@/lib/v2-cadence";
import {
  getActiveCommitment,
  hasRecentInboundAccountabilityExchange,
  getLastV2CheckSentForCommitment,
} from "@/lib/v2-commitment";
import { maybeRecordV2WeakNoReplyFromPriorAccountabilityDay } from "@/lib/v2-send-time-weak-no-reply";
import {
  buildDailySchedulingTelemetry,
  evaluateDailySendTimeWindow,
  isLocalCatchupHour,
} from "@/lib/daily-sms-scheduling";
import { fetchV2UserSendTimeProfile } from "@/lib/v2-send-time-profile";
import {
  fetchV2UserSmsCommsPreferences,
  shouldApplyUserCadenceOverride,
  shouldSkipDailyForCommsPrefs,
} from "@/lib/v2-sms-comms-preferences";
import { resolveUserFullyOnV2ForCutoverMessaging } from "@/lib/v2-cutover-gates";
import { runMorningTtoPostSendBookkeeping } from "@/lib/morning-tto-post-send-bookkeeping";
import { runMorningTtoPreSendCanonicalStateMaintenance } from "@/lib/morning-tto-canonical-state-maintenance";
import { applySundayWeeklyPauseBeforeWriterIfNeeded } from "@/lib/sms-daily-sunday-before-writer";
import {
  assertMorningTtoDraftAuthoritativeForSend,
  buildTylerTextOverviewSendMetadata,
  finalizeTylerTextOverviewDraftAfterSend,
  markTylerTextOverviewDraftSkippedAfterGuard,
  mergeTylerTextOverviewSendMetadata,
  resolveMorningTtoExactBodyImmediatelyBeforeTwilio,
  withTylerTextOverviewFinalBodyOnContext,
  type MorningTtoAuthoritativeGateSuccess,
  type MorningTtoAuthoritativeSkipReason,
  type MorningTtoExactBodyFailure,
  type TylerTextOverviewSendContext,
} from "@/lib/tyler-text-overview-send";
import { SMS_DAILY_PRODUCTION_SEND_SLOT, isTylerTextOverviewEnabled } from "@/lib/tyler-text-overview-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;
const ENV_SMS_DRY_RUN = process.env.SMS_DRY_RUN === "true";


async function shouldSkipDailyForActiveInboundThread(clerkUserId: string): Promise<boolean> {
  const ac = await getActiveCommitment(clerkUserId);
  if (!ac?.id) return false;
  return hasRecentInboundAccountabilityExchange(ac.id);
}

function timeOfDayForOutboundContext(md: Record<string, unknown>): "morning" | "evening" {
  const pref = smsTimePreferenceFromClerkMetadata(md).toLowerCase().trim();
  if (pref === "midday" || pref === "evening") return "evening";
  return "morning";
}


/** Post-Twilio success fields for sms_send_events — metadata.sent_at for notebook thread timestamps. */
function tylerTextOverviewMetadataForSend(
  ctx: TylerTextOverviewSendContext | null,
  finalBodySent: string | null
) {
  return withTylerTextOverviewFinalBodyOnContext(ctx, finalBodySent)?.metadataBlock ?? null;
}

function incrementMorningTtoAuthoritativeSkipStat(
  stats: {
    skippedTtoNoCurrentMorningDraft: number;
    skippedTtoBlankMorningBody: number;
    skippedTtoMissingGeneration: number;
    skippedTtoMachineShouldSendFalse: number;
    skippedTtoRouteNotEligibleV1: number;
    skippedTtoAuthoritativeFailClosed: number;
  },
  reason: MorningTtoAuthoritativeSkipReason | "tto_live_fallback_blocked" | "tto_draft_body_not_used" | "tto_lookup_not_usable" | "tto_authoritative_body_mismatch"
): void {
  switch (reason) {
    case "tto_no_current_morning_draft":
      stats.skippedTtoNoCurrentMorningDraft += 1;
      break;
    case "tto_blank_morning_body":
      stats.skippedTtoBlankMorningBody += 1;
      break;
    case "tto_missing_generation":
      stats.skippedTtoMissingGeneration += 1;
      break;
    case "tto_generation_send_slot_mismatch":
      stats.skippedTtoAuthoritativeFailClosed += 1;
      break;
    case "tto_machine_should_send_false":
      stats.skippedTtoMachineShouldSendFalse += 1;
      break;
    case "tto_route_not_eligible_v1":
      stats.skippedTtoRouteNotEligibleV1 += 1;
      break;
    case "tto_live_fallback_blocked":
    case "tto_draft_body_not_used":
    case "tto_lookup_not_usable":
    case "tto_authoritative_body_mismatch":
      stats.skippedTtoAuthoritativeFailClosed += 1;
      break;
    default:
      break;
  }
}

async function recordMorningTtoAuthoritativeGateFailure(args: {
  clerkUserId: string;
  todayKey: string;
  reason: string;
  hasSendEventRow: boolean;
  existingMeta?: Record<string, unknown>;
  retryCount?: number;
  timezone: string;
  localNow: Date;
  gateMetadata?: Record<string, unknown>;
}): Promise<void> {
  console.log("[daily-sms] morning_tto_authoritative_gate_blocked", {
    clerk_user_id: args.clerkUserId,
    day_key: args.todayKey,
    reason: args.reason,
    has_send_event_row: args.hasSendEventRow,
    ...(args.gateMetadata ?? {}),
  });

  if (!args.hasSendEventRow) {
    return;
  }

  await supabaseServer
    .from("sms_send_events")
    .update({
      status: "send_failed",
      metadata: {
        ...(args.existingMeta ?? {}),
        note: args.reason,
        tto_authoritative_gate: true,
        tto_authoritative_skip_reason: args.reason,
        draft_for_day_key: args.todayKey,
        send_slot: SMS_DAILY_PRODUCTION_SEND_SLOT,
        ...(args.gateMetadata ?? {}),
        retry_count: args.retryCount ?? 0,
        timezone: args.timezone,
        local_time: args.localNow.toISOString(),
      },
    })
    .eq("clerk_user_id", args.clerkUserId)
    .eq("day_key", args.todayKey)
    .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
}

async function recordMorningTtoExactBodyBlocked(args: {
  clerkUserId: string;
  todayKey: string;
  existingMeta: Record<string, unknown>;
  timezone: string;
  localNow: Date;
  retryCount?: number;
  failure: MorningTtoExactBodyFailure;
  tylerTextOverviewCtx: TylerTextOverviewSendContext | null;
}): Promise<void> {
  const failureMetadata = mergeTylerTextOverviewSendMetadata(
    {
      ...args.existingMeta,
      note: args.failure.reason,
      timezone: args.timezone,
      local_time: args.localNow.toISOString(),
      twilio_send_attempted: false,
    },
    args.tylerTextOverviewCtx?.metadataBlock ?? null
  );

  await supabaseServer
    .from("sms_send_events")
    .update({
      status: args.failure.skipStatus,
      metadata: {
        ...failureMetadata,
        ...args.failure.metadataExtras,
        retry_count: args.retryCount ?? 0,
      },
    })
    .eq("clerk_user_id", args.clerkUserId)
    .eq("day_key", args.todayKey)
    .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);

  if (args.tylerTextOverviewCtx?.lookup.draft_id) {
    await markTylerTextOverviewDraftSkippedAfterGuard({
      draftId: args.tylerTextOverviewCtx.lookup.draft_id,
      clerkUserId: args.clerkUserId,
      dayKey: args.todayKey,
    });
  }
}

type MorningTtoTwilioAttemptResult =
  | {
      outcome: "sent";
      messageSid: string;
      twilioStatus: string;
      smsBody: string;
      sendContext: TylerTextOverviewSendContext;
    }
  | { outcome: "blocked" }
  | { outcome: "failed" }
  | { outcome: "dry_run" };

async function attemptMorningTtoTwilioSend(args: {
  gate: MorningTtoAuthoritativeGateSuccess;
  clerkUserId: string;
  phoneNumber: string;
  todayKey: string;
  md: Record<string, unknown>;
  existingMeta: Record<string, unknown>;
  timezone: string;
  localNow: Date;
  retryCount?: number;
  dryRun: boolean;
}): Promise<MorningTtoTwilioAttemptResult> {
  const resolved = await resolveMorningTtoExactBodyImmediatelyBeforeTwilio({
    gate: args.gate,
    clerkUserId: args.clerkUserId,
    draftForDayKey: args.todayKey,
  });

  if (!resolved.ok) {
    await recordMorningTtoExactBodyBlocked({
      clerkUserId: args.clerkUserId,
      todayKey: args.todayKey,
      existingMeta: args.existingMeta,
      timezone: args.timezone,
      localNow: args.localNow,
      retryCount: args.retryCount,
      failure: resolved,
      tylerTextOverviewCtx: buildMorningTtoSendContextForFailure(args.gate, resolved),
    });
    return { outcome: "blocked" };
  }

  const smsBody = resolved.bodyToSend;
  const tylerTextOverviewCtx = resolved.sendContext;

  if (!isTwilioReady() || args.dryRun) {
    return { outcome: "dry_run" };
  }

  try {
    const message = await sendSMS({
      to: args.phoneNumber,
      body: smsBody,
      lastOutbound: {
        clerkUserId: args.clerkUserId,
        messageKind: "question",
        timeOfDay: timeOfDayForOutboundContext(args.md),
        questionPosition: null,
        skipLastOutboundContextUpsert: true,
      },
    });
    return {
      outcome: "sent",
      messageSid: message.sid,
      twilioStatus: message.status,
      smsBody,
      sendContext: tylerTextOverviewCtx,
    };
  } catch (err) {
    if (isAccountDeletionOutboundSmsError(err)) {
      const patch = reservedSendEventPatchForDeletionError(err);
      await supabaseServer
        .from("sms_send_events")
        .update({
          status: patch.status,
          metadata: {
            ...args.existingMeta,
            note: patch.note,
            twilio_send_attempted: false,
            retry_count: args.retryCount ?? 0,
            timezone: args.timezone,
            local_time: args.localNow.toISOString(),
          },
        })
        .eq("clerk_user_id", args.clerkUserId)
        .eq("day_key", args.todayKey)
        .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
      return { outcome: "failed" };
    }

    await supabaseServer
      .from("sms_send_events")
      .update({
        status: "send_failed",
        metadata: {
          ...args.existingMeta,
          retry_count: (args.retryCount ?? 0) + 1,
          error: String(err),
          note: args.retryCount != null ? "retry_failed" : "send_failed",
          timezone: args.timezone,
          local_time: args.localNow.toISOString(),
        },
      })
      .eq("clerk_user_id", args.clerkUserId)
      .eq("day_key", args.todayKey)
      .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
    return { outcome: "failed" };
  }
}

function buildMorningTtoSendContextForFailure(
  gate: MorningTtoAuthoritativeGateSuccess,
  failure: MorningTtoExactBodyFailure
): TylerTextOverviewSendContext | null {
  if (!isTylerTextOverviewEnabled()) return null;
  const lookup = {
    usable: false,
    send_source: "machine_draft" as const,
    draft_id: gate.draft.id,
    generation_id: gate.generation.id,
    draft_for_day_key: gate.draft.draft_for_day_key,
    current_body_to_send: gate.bodyToSend,
    current_body_source: null,
    edited_by_tyler: gate.tylerEdited,
    machine_body_hash: null,
    current_body_hash: null,
    notebook_verdict_at_generation: null,
    notebook_verdict_reason_at_generation: null,
    route_kind: gate.generation.route_kind ?? null,
    stale: false,
    stale_reason: null,
  };
  return {
    considered: true,
    draftBodyUsed: true,
    postTtoWritersBypassed: true,
    lookup,
    metadataBlock: buildTylerTextOverviewSendMetadata({
      lookup,
      effectiveSendSource: gate.tylerEdited ? "tyler_edit" : "machine_draft",
      finalBodySent: null,
      postTtoWritersBypassed: true,
    }),
  };
}

async function finalizeTylerTextOverviewAfterOutboundBestEffort(args: {
  ctx: TylerTextOverviewSendContext | null;
  draftBodyUsed: boolean;
  clerkUserId: string;
  dayKey: string;
  smsBody: string;
  messageSid: string;
}): Promise<void> {
  if (!args.ctx?.lookup.draft_id) return;
  try {
    await finalizeTylerTextOverviewDraftAfterSend({
      draftId: args.ctx.lookup.draft_id,
      clerkUserId: args.clerkUserId,
      dayKey: args.dayKey,
      twilioMessageSid: args.messageSid,
      finalBodySent: args.smsBody,
    });
  } catch (err) {
    console.error("[daily-sms] tyler_text_overview draft finalize failed (non-blocking)", {
      clerk_user_id: args.clerkUserId,
      day_key: args.dayKey,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function dailySmsTwilioSuccessSendEventFields(args: {
  messageSid: string;
  twilioStatus: string;
  smsBody: string;
  metadata: Record<string, unknown>;
}): {
  message_sid: string;
  status: string;
  sms_body: string;
  metadata: Record<string, unknown>;
} {
  const sentAtIso = new Date().toISOString();
  return {
    message_sid: args.messageSid,
    status: args.twilioStatus,
    sms_body: args.smsBody,
    metadata: {
      ...args.metadata,
      sent_at: sentAtIso,
      twilio_send_attempted: true,
      twilio_message_sid: args.messageSid,
      message_sid: args.messageSid,
      sms_body: args.smsBody,
      final_sms_body: args.smsBody,
      twilio_status: args.twilioStatus,
    },
  };
}

function compactSupabaseErrorMessage(err: unknown): string {
  if (!err || typeof err !== "object") return String(err).slice(0, 500);
  const e = err as { message?: string; code?: string };
  return [e.code, e.message].filter(Boolean).join(": ").slice(0, 500);
}

/** True when Twilio SID is persisted top-level or in metadata (post-send idempotency guard). */
function hasAnyTwilioSidOnSendEvent(row: {
  message_sid?: unknown;
  metadata?: unknown;
}): boolean {
  const topSid = row.message_sid;
  if (typeof topSid === "string" && topSid.trim().length > 0) return true;
  const meta =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null;
  if (!meta) return false;
  for (const key of ["message_sid", "twilio_message_sid", "outbound_message_sid"] as const) {
    const v = meta[key];
    if (typeof v === "string" && v.trim().length > 0) return true;
  }
  return false;
}

type RecordDailyTwilioSuccessResult = {
  recordOk: boolean;
  usedFallback: boolean;
  orphanLogged: boolean;
};

async function recordDailyTwilioSuccessOrFallback(args: {
  clerkUserId: string;
  dayKey: string;
  pathLabel: "main" | "retry";
  primaryPayload: ReturnType<typeof dailySmsTwilioSuccessSendEventFields>;
  messageSid: string;
  smsBody: string;
  twilioStatus: string;
}): Promise<RecordDailyTwilioSuccessResult> {
  const { error: primaryErr } = await supabaseServer
    .from("sms_send_events")
    .update(args.primaryPayload)
    .eq("clerk_user_id", args.clerkUserId)
    .eq("day_key", args.dayKey)
    .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);

  if (!primaryErr) {
    return { recordOk: true, usedFallback: false, orphanLogged: false };
  }

  const primaryErrorStr = compactSupabaseErrorMessage(primaryErr);
  console.error(
    `[daily-sms] sms_send_events primary update failed after Twilio success (${args.pathLabel} path)`,
    {
      clerk_user_id: args.clerkUserId,
      day_key: args.dayKey,
      message_sid: args.messageSid,
      error: primaryErr,
    }
  );

  const baseMeta = args.primaryPayload.metadata;
  const fallbackMetadata: Record<string, unknown> = {
    ...baseMeta,
    sent_at:
      typeof baseMeta.sent_at === "string" && baseMeta.sent_at.trim()
        ? baseMeta.sent_at
        : new Date().toISOString(),
    twilio_message_sid: args.messageSid,
    message_sid: args.messageSid,
    sms_body: args.smsBody,
    final_sms_body: args.smsBody,
    twilio_status: args.twilioStatus,
    twilio_send_attempted: true,
    twilio_db_primary_update_failed: true,
    twilio_db_primary_update_error: primaryErrorStr,
    twilio_db_fallback_update_attempted: true,
    note: "sent_to_twilio_db_update_recovered",
  };

  const { error: fallbackErr } = await supabaseServer
    .from("sms_send_events")
    .update({
      status: args.twilioStatus,
      metadata: fallbackMetadata,
    })
    .eq("clerk_user_id", args.clerkUserId)
    .eq("day_key", args.dayKey)
    .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);

  if (!fallbackErr) {
    console.warn("[daily-sms] Twilio success recorded via metadata-only fallback", {
      clerk_user_id: args.clerkUserId,
      day_key: args.dayKey,
      message_sid: args.messageSid,
      path: args.pathLabel,
    });
    return { recordOk: true, usedFallback: true, orphanLogged: false };
  }

  const fallbackErrorStr = compactSupabaseErrorMessage(fallbackErr);
  console.error("[daily-sms] CRITICAL orphan Twilio send — primary and fallback DB updates failed", {
    clerk_user_id: args.clerkUserId,
    day_key: args.dayKey,
    message_sid: args.messageSid,
    sms_body_preview: args.smsBody.slice(0, 160),
    twilio_status: args.twilioStatus,
    path: args.pathLabel,
    primary_error: primaryErrorStr,
    fallback_error: fallbackErrorStr,
  });
  return { recordOk: false, usedFallback: true, orphanLogged: true };
}


/**
 * V2: active commitment → accountability templates (no legacy delivery-state body).
 * Legacy: existing delivery engine unchanged.
 */

/**
 * ======================================================
 * CRON AUTH
 * ======================================================
 * Valid CRON_SECRET required. Accept either:
 * - x-cron-secret: <CRON_SECRET>
 * - Authorization: Bearer <CRON_SECRET> (Vercel scheduled crons)
 */
function timingSafeEqualUtf8(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function validateCronSecret(req: Request): boolean {
  if (!CRON_SECRET) return false;

  const xCron = req.headers.get("x-cron-secret");
  if (xCron && timingSafeEqualUtf8(xCron, CRON_SECRET)) return true;

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token && timingSafeEqualUtf8(token, CRON_SECRET)) return true;
  }

  const hasXCronHeader = req.headers.get("x-cron-secret") != null;
  const hasAuthorizationHeader = req.headers.get("authorization") != null;

  if (!hasXCronHeader && !hasAuthorizationHeader) {
    if (req.method === "GET") {
      try {
        const url = new URL(req.url);
        if (url.pathname.startsWith("/api/cron/")) {
          const qSecret = url.searchParams.get("cron_secret");
          if (qSecret && timingSafeEqualUtf8(qSecret, CRON_SECRET)) {
            console.log("[daily-sms] allowed via query cron_secret fallback");
            return true;
          }
        }
      } catch {
        // ignore invalid URL
      }
    }
  }

  return false;
}

function logDailySmsCronAuthFailure(req: Request) {
  console.error("[daily-sms] cron auth failed", {
    cronSecretConfigured: Boolean(CRON_SECRET),
    hasXCronSecretHeader: Boolean(req.headers.get("x-cron-secret")),
    hasAuthorizationHeader: Boolean(req.headers.get("authorization")),
  });
}

/**
 * ======================================================
 * PREFERENCE-BASED SEND WINDOW
 * ======================================================
 *
 * Goal:
 * - Each user receives at most ONE SMS per local day.
 * - Send time is based on Clerk public_metadata.smsTimePreference (early_morning/morning=7 local, midday/evening=19 local).
 * - Users are eligible for the entire preferred local hour (not only the first minutes).
 * - Cron runs every 5 minutes and may attempt multiple times within that hour; reservation
 *   (unique clerk_user_id + day_key) ensures only one SMS is sent.
 */
const FIRST_14_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const SAFE_LOCAL_CUTOFF_HOUR = 22;

function isWithinFirst14Days(activationAt: string | null, now: Date): boolean {
  if (!activationAt) return false;
  const t = new Date(activationAt).getTime();
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t < FIRST_14_DAYS_MS;
}


async function resolveActiveV2CommitmentActivationAt(clerkUserId: string): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("v2_commitment")
    .select("started_at, created_at")
    .eq("clerk_user_id", clerkUserId)
    .eq("status", "active")
    .maybeSingle();
  if (error || !data) return null;
  if (typeof data.started_at === "string" && data.started_at.trim().length > 0) {
    return data.started_at;
  }
  if (typeof data.created_at === "string" && data.created_at.trim().length > 0) {
    return data.created_at;
  }
  return null;
}

/**
 * ======================================================
 * Helper: try to reserve today's send slot
 * ======================================================
 *
 * We rely on unique index: (clerk_user_id, day_key, send_slot)
 * Phase 1 production writes send_slot = morning only.
 * - If insert succeeds: this run owns the send attempt.
 * - If insert fails due to unique violation: SMS already reserved/sent for this slot, skip safely.
 */
async function reserveTodaySendOrSkip({
  userId,
  todayKey,
}: {
  userId: string;
  todayKey: string;
}): Promise<{ reserved: boolean; reason?: string }> {
  const { error } = await supabaseServer.from("sms_send_events").insert({
    clerk_user_id: userId,
    day_key: todayKey,
    send_slot: SMS_DAILY_PRODUCTION_SEND_SLOT,
    status: "reserved",
    metadata: { note: "reserved_by_cron", send_slot: SMS_DAILY_PRODUCTION_SEND_SLOT },
  });

  if (!error) return { reserved: true };

  // Postgres unique violation is usually 23505; Supabase error "code" often contains it.
  // If we can't detect it perfectly, we still treat any insert error as "not reserved"
  // to avoid double-sending. This favors safety over aggressive retries.
  const errorObj = error as { code?: string; message?: string } | null;
  const code = errorObj?.code;
  const message = errorObj?.message || String(error);

  if (code === "23505" || message.toLowerCase().includes("duplicate")) {
    return { reserved: false, reason: "already_reserved_or_sent_today" };
  }

  // Ambiguous insert failures: read-after-fail to avoid both duplicates and silent misses.
  const { data: existingAfterFail } = await supabaseServer
    .from("sms_send_events")
    .select("id")
    .eq("clerk_user_id", userId)
    .eq("day_key", todayKey)
    .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT)
    .maybeSingle();
  if (existingAfterFail?.id) {
    console.warn("[daily-sms] reservation insert failed but row already exists", {
      clerk_user_id: userId,
      day_key: todayKey,
      code,
      message,
    });
    return { reserved: false, reason: "already_reserved_or_sent_today" };
  }

  return { reserved: false, reason: "reservation_insert_failed" };
}

type SmsAudienceCronRow = {
  clerk_user_id: string;
  phone_number: string;
  sms_enabled: boolean;
  stopped_at: string | null;
  timezone: string | null;
  summitt_subscribed: boolean;
};

/**
 * Users who should get daily SMS can be missing from sms_audience if prior sync used
 * update-only or failed. Merge in Clerk-eligible rows from sms_identities and upsert via syncSmsAudience.
 */
async function mergeEligibleAudienceFromIdentities(
  baseRows: SmsAudienceCronRow[]
): Promise<{ rows: SmsAudienceCronRow[]; mergedCount: number }> {
  const seen = new Set(baseRows.map((r) => r.clerk_user_id));
  const result = [...baseRows];
  let mergedCount = 0;

  const { data: identities, error: idErr } = await supabaseServer
    .from("sms_identities")
    .select("clerk_user_id, phone_number")
    .eq("sms_enabled", true)
    .is("stopped_at", null);

  if (idErr) {
    console.error(
      "[daily-sms] sms_identities list for audience self-heal failed:",
      idErr
    );
    return { rows: result, mergedCount: 0 };
  }

  for (const row of identities ?? []) {
    const uid = row.clerk_user_id;
    const phone = row.phone_number;
    if (!uid || typeof phone !== "string" || !phone.trim()) continue;
    if (seen.has(uid)) continue;

    // APP-041B2b: never heal/push deleting users into the in-memory send set.
    const deletionGate = await evaluateOutboundSmsForAccountDeletion(uid);
    if (deletionGate.decision !== "allowed") {
      continue;
    }

    let user;
    try {
      user = await getClerkUser(uid);
    } catch (e) {
      console.error("[daily-sms] audience self-heal getClerkUser failed", uid, e);
      continue;
    }

    const md = user.public_metadata || {};
    if (md.summittSubscribed !== true) continue;
    if (md.smsEnabled !== true) continue;

    await syncSmsAudience({
      userId: uid,
      phoneNumber: phone.trim(),
      smsEnabled: true,
      timezone: typeof md.timezone === "string" ? md.timezone : null,
      smsTimePreference:
        typeof md.smsTimePreference === "string" ? md.smsTimePreference : null,
      summittSubscribed: true,
    });

    // Re-check after sync: sync may no-op during deletion; do not push blindly.
    const afterSync = await evaluateOutboundSmsForAccountDeletion(uid);
    if (afterSync.decision !== "allowed") {
      continue;
    }

    const { data: audienceRow } = await supabaseServer
      .from("sms_audience")
      .select("clerk_user_id, phone_number, sms_enabled, stopped_at, timezone, summitt_subscribed")
      .eq("clerk_user_id", uid)
      .maybeSingle();

    if (
      !audienceRow ||
      audienceRow.sms_enabled !== true ||
      typeof audienceRow.stopped_at === "string" ||
      audienceRow.summitt_subscribed !== true ||
      typeof audienceRow.phone_number !== "string" ||
      !audienceRow.phone_number.trim()
    ) {
      continue;
    }

    mergedCount += 1;
    seen.add(uid);
    result.push({
      clerk_user_id: uid,
      phone_number: audienceRow.phone_number.trim(),
      sms_enabled: true,
      stopped_at: null,
      timezone:
        typeof audienceRow.timezone === "string"
          ? audienceRow.timezone
          : typeof md.timezone === "string"
            ? md.timezone
            : null,
      summitt_subscribed: true,
    });
  }

  return { rows: result, mergedCount };
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  if (!validateCronSecret(req)) {
    logDailySmsCronAuthFailure(req);
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const force = url.searchParams.get("force") === "1";
  const dryRunOverride = url.searchParams.get("dryRun") === "1";
  const SMS_DRY_RUN = ENV_SMS_DRY_RUN || dryRunOverride;

  const stats = {
    ok: true,
    scanned: 0,
    eligible: 0,
    reserved: 0,
    alreadyReservedOrSentToday: 0,
    sent: 0,
    retried: 0,
    dryRun: 0,
    skippedNotTime: 0,
    skippedMissingIdentity: 0,
    skippedOptedOut: 0,
    skippedAlreadyCompleted: 0,
    skippedCadence: 0,
    skippedSilenceCadenceSpace: 0,
    skippedActiveInboundThread: 0,
    skippedReactivationCooldown: 0,
    skippedRefreshIdentityAwaiting: 0,
    skippedPendingResolutionRecentConfirmation: 0,
    skippedNotFullyOnV2Daily: 0,
    skippedMissingTwilio: 0,
    failed: 0,
    sendFailed: 0,
    reservationErrors: 0,
    userLoopErrors: 0,
    recoveredReserved: 0,
    audienceSelfHealMerged: 0,
    expectedDailyAttemptUsers: 0,
    expectedNewActiveUsers: 0,
    expectedNormalActiveUsers: 0,
    skippedIntentional: 0,
    skippedUnexpected: 0,
    catchupEligible: 0,
    catchupAttempted: 0,
    skippedPreferredWindowWaiting: 0,
    skippedPastSafeLocalCutoff: 0,
    skippedUserPause: 0,
    skippedUserWeekendPolicy: 0,
    twilioAccepted: 0,
    skippedNoSafeV3Voice: 0,
    skippedSundayWeeklyPause: 0,
    skippedTtoNoCurrentMorningDraft: 0,
    skippedTtoBlankMorningBody: 0,
    skippedTtoMissingGeneration: 0,
    skippedTtoMachineShouldSendFalse: 0,
    skippedTtoRouteNotEligibleV1: 0,
    skippedTtoAuthoritativeFailClosed: 0,
    skippedAccountDeletion: 0,
    skippedDeletionLookupFailed: 0,
  };

  const { data: audienceQueryRows } = await supabaseServer
    .from("sms_audience")
    .select("clerk_user_id, phone_number, sms_enabled, stopped_at, timezone, summitt_subscribed")
    .eq("summitt_subscribed", true)
    .eq("sms_enabled", true);

  let audienceUsers = (audienceQueryRows ?? []) as SmsAudienceCronRow[];

  if (audienceUsers.length === 0) {
    const healedEmpty = await mergeEligibleAudienceFromIdentities([]);
    audienceUsers = healedEmpty.rows;
    stats.audienceSelfHealMerged = healedEmpty.mergedCount;
    if (audienceUsers.length === 0) {
      return NextResponse.json(stats);
    }
  } else {
    const healed = await mergeEligibleAudienceFromIdentities(audienceUsers);
    audienceUsers = healed.rows;
    stats.audienceSelfHealMerged = healed.mergedCount;
  }

  for (const audienceUser of audienceUsers) {
      stats.scanned += 1;

      // APP-041B2b: early skip so we do not do expensive work for deleting users.
      // Transport still re-checks immediately before messages.create.
      const earlyDeletion = await evaluateOutboundSmsForAccountDeletion(
        audienceUser.clerk_user_id
      );
      if (earlyDeletion.decision === "blocked_due_to_deletion") {
        stats.skippedAccountDeletion += 1;
        stats.skippedIntentional += 1;
        continue;
      }
      if (earlyDeletion.decision === "lookup_failed") {
        stats.skippedDeletionLookupFailed += 1;
        stats.skippedUnexpected += 1;
        // No send_event written — later cron pass in-window can retry.
        continue;
      }
      if (earlyDeletion.decision === "missing_clerk_user_id") {
        stats.skippedUnexpected += 1;
        continue;
      }

      let stage = "getClerkUser";
      try {
      const user = await getClerkUser(audienceUser.clerk_user_id);
      const md = user.public_metadata || {};

      if (typeof audienceUser.stopped_at === "string") {
        stats.skippedOptedOut += 1;
        continue;
      }

      const commsPrefs = await fetchV2UserSmsCommsPreferences(audienceUser.clerk_user_id);

      const tzResolved = resolveSmsUserTimezone({
        clerkMetadataTimezone: md.timezone,
        audienceTimezone: audienceUser.timezone,
      });
      const timezone = tzResolved.timezone;
      const now = new Date();

      // localNow = "now" interpreted in that user's timezone
      const localNow = new Date(now.toLocaleString("en-US", { timeZone: timezone }));

      const commsSkip = shouldSkipDailyForCommsPrefs(commsPrefs, localNow, now);
      if (commsSkip.skip && commsSkip.reason === "user_pause") {
        stats.skippedUserPause += 1;
        stats.skippedIntentional += 1;
        continue;
      }
      if (commsSkip.skip && commsSkip.reason === "weekend_policy") {
        stats.skippedUserWeekendPolicy += 1;
        stats.skippedIntentional += 1;
        continue;
      }

      // Key used for dedupe
      const todayKey = getDateKeyInTimezone(now, timezone);

      await maybeRecordV2WeakNoReplyFromPriorAccountabilityDay({
        clerkUserId: audienceUser.clerk_user_id,
        timezone,
        now,
      });

      const v2CutoverStatus = await resolveUserFullyOnV2ForCutoverMessaging(
        audienceUser.clerk_user_id
      );
      const skipLegacyDailyCompletionCheck = v2CutoverStatus.fullyOnV2;
      const activeForPolicy = v2CutoverStatus.fullyOnV2
        ? await getActiveCommitment(audienceUser.clerk_user_id)
        : null;
      const hasActiveBehavior = Boolean(activeForPolicy?.behavior_statement?.trim());
      const activationAt =
        v2CutoverStatus.fullyOnV2 && hasActiveBehavior
          ? await resolveActiveV2CommitmentActivationAt(audienceUser.clerk_user_id)
          : null;
      const isNewActive14Days = Boolean(
        v2CutoverStatus.fullyOnV2 && hasActiveBehavior && isWithinFirst14Days(activationAt, now)
      );
      const isExpectedDailyAttemptUser = Boolean(v2CutoverStatus.fullyOnV2 && hasActiveBehavior);
      if (isExpectedDailyAttemptUser) {
        stats.expectedDailyAttemptUsers += 1;
        if (isNewActive14Days) stats.expectedNewActiveUsers += 1;
        else stats.expectedNormalActiveUsers += 1;
      }

      const learnedProfForWindow = hasActiveBehavior
        ? await fetchV2UserSendTimeProfile(audienceUser.clerk_user_id)
        : null;

      const pref = smsTimePreferenceFromClerkMetadata(md as Record<string, unknown>);

      // STEP 1: Read existing event before reserve (and before window check)
      stage = "query_send_events";
      const { data: existingRow } = await supabaseServer
        .from("sms_send_events")
        .select("id, status, metadata, message_sid")
        .eq("clerk_user_id", audienceUser.clerk_user_id)
        .eq("day_key", todayKey)
        .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT)
        .maybeSingle();

      let existingEvent = existingRow;
      const bypassWindowGate = Boolean(existingEvent) || force;

      const sendWindowEval = evaluateDailySendTimeWindow({
        now,
        timezone,
        clerkSmsTimePreference: pref,
        commsPrefs,
        learnedProfile: learnedProfForWindow,
        bypassWindowGate,
      });
      const computedLocalHour = sendWindowEval.computedLocalHour;

      // Retries bypass send window; first-time sends require it (+ 7AM product floor).
      let sendTimeWindowOk = sendWindowEval.sendTimeWindowOk;

      if (!existingEvent && !force && !sendTimeWindowOk) {
        const canCatchupNow =
          isExpectedDailyAttemptUser && isLocalCatchupHour(computedLocalHour);
        if (canCatchupNow) {
          stats.catchupEligible += 1;
          stats.catchupAttempted += 1;
          sendTimeWindowOk = true;
        } else {
          if (isExpectedDailyAttemptUser && computedLocalHour >= SAFE_LOCAL_CUTOFF_HOUR) {
            stats.skippedPastSafeLocalCutoff += 1;
          } else if (sendWindowEval.productFloorBlockedWithoutBypass) {
            stats.skippedPreferredWindowWaiting += 1;
          } else {
            stats.skippedPreferredWindowWaiting += 1;
          }
          stats.skippedIntentional += 1;
          stats.skippedNotTime += 1;
          continue;
        }
      }

      if (!existingEvent && !force && !sendTimeWindowOk) {
        stats.skippedNotTime += 1;
        continue;
      }

      const retryOutsideWindow =
        bypassWindowGate &&
        !force &&
        (!sendWindowEval.sendTimeWindowOkWithoutBypass ||
          sendWindowEval.productFloorBlockedWithoutBypass);
      const schedulingTelemetry = buildDailySchedulingTelemetry({
        timezone,
        evaluation: sendWindowEval,
        retryOutsideWindow,
      });

      stats.eligible += 1;

      // STEP 2 & 3: Handle existing row or proceed to reserve
      if (existingEvent) {
        const hasMessageSid = hasAnyTwilioSidOnSendEvent(existingEvent);

        // Unsent stuck "reserved" (insert succeeded, send/update never completed)
        if (existingEvent.status === "reserved" && !hasMessageSid) {
          const priorStatus = existingEvent.status;
          const reservedMeta = (existingEvent.metadata || {}) as Record<
            string,
            unknown
          >;
          const recoveredMeta = {
            ...reservedMeta,
            retry_count: 0,
            note: "recovered_stuck_reserved",
            recovered_at: new Date().toISOString(),
          };

          console.log("[daily-sms] recovered stuck reserved row", {
            clerk_user_id: audienceUser.clerk_user_id,
            priorStatus,
            messageSidPresent: hasMessageSid,
          });

          stats.recoveredReserved += 1;

          await supabaseServer
            .from("sms_send_events")
            .update({
              status: "send_failed",
              metadata: recoveredMeta,
            })
            .eq("clerk_user_id", audienceUser.clerk_user_id)
            .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);

          existingEvent = {
            ...existingEvent,
            status: "send_failed",
            metadata: recoveredMeta,
          };
        }

        // CASE A: send_failed with retries left (never retry after Twilio SID is known)
        if (existingEvent.status === "send_failed") {
          if (hasMessageSid) {
            stats.alreadyReservedOrSentToday += 1;
            stats.skippedIntentional += 1;
            continue;
          }

          const existingMeta = (existingEvent.metadata || {}) as Record<string, unknown>;
          const retryCount = typeof existingMeta.retry_count === "number" ? existingMeta.retry_count : 0;

          if (retryCount < 3) {
            // Legacy app completion only; V2 accountability does not use daily_completion_events.
            if (!skipLegacyDailyCompletionCheck) {
              const { data: completed } = await supabaseServer
                .from("daily_completion_events")
                .select("id")
                .eq("clerk_user_id", audienceUser.clerk_user_id)
                .eq("day_key", todayKey)
                .limit(1);

              if (completed && completed.length > 0) {
                await supabaseServer
                  .from("sms_send_events")
                  .update({
                    status: "skipped_already_completed",
                    metadata: { ...existingMeta, note: "user_completed_today" },
                  })
                  .eq("clerk_user_id", audienceUser.clerk_user_id)
                  .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
                stats.skippedAlreadyCompleted += 1;
                stats.skippedIntentional += 1;
                continue;
              }
            }

            stage = "active_inbound_thread_gate";
            if (await shouldSkipDailyForActiveInboundThread(audienceUser.clerk_user_id)) {
              await supabaseServer
                .from("sms_send_events")
                .update({
                  status: "skipped_active_inbound_thread",
                  metadata: {
                    note: "recent_inbound_accountability_exchange",
                    window_ms: 3 * 60 * 60 * 1000,
                    timezone,
                    local_time: localNow.toISOString(),
                  },
                })
                .eq("clerk_user_id", audienceUser.clerk_user_id)
                .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);

              stats.skippedActiveInboundThread += 1;
              stats.skippedIntentional += 1;
              continue;
            }

            if (
              await applySundayWeeklyPauseBeforeWriterIfNeeded({
                clerkUserId: audienceUser.clerk_user_id,
                todayKey,
                localNow,
                timezone,
                now,
                force,
                fullyOnV2: skipLegacyDailyCompletionCheck,
                commitment: activeForPolicy,
                commsPrefs,
                existingMeta,
              })
            ) {
              stats.skippedSundayWeeklyPause += 1;
              stats.skippedIntentional += 1;
              continue;
            }

            stage = "canonical_state_maintenance";
            await runMorningTtoPreSendCanonicalStateMaintenance({
              clerkUserId: audienceUser.clerk_user_id,
              commitment: activeForPolicy,
              nowMs: now.getTime(),
            });

            stage = "morning_tto_authoritative_gate";
            const morningTtoAuthoritativeGateRetry = await assertMorningTtoDraftAuthoritativeForSend({
              clerkUserId: audienceUser.clerk_user_id,
              draftForDayKey: todayKey,
            });
            if (!morningTtoAuthoritativeGateRetry.ok) {
              await recordMorningTtoAuthoritativeGateFailure({
                clerkUserId: audienceUser.clerk_user_id,
                todayKey,
                reason: morningTtoAuthoritativeGateRetry.reason,
                hasSendEventRow: true,
                existingMeta,
                retryCount,
                timezone,
                localNow,
                gateMetadata: morningTtoAuthoritativeGateRetry.metadata,
              });
              incrementMorningTtoAuthoritativeSkipStat(stats, morningTtoAuthoritativeGateRetry.reason);
              stats.skippedIntentional += 1;
              continue;
            }

            stage = "resolve_morning_tto_body";
            const retrySendAttempt = await attemptMorningTtoTwilioSend({
              gate: morningTtoAuthoritativeGateRetry,
              clerkUserId: audienceUser.clerk_user_id,
              phoneNumber: audienceUser.phone_number,
              todayKey,
              md: md as Record<string, unknown>,
              existingMeta,
              timezone,
              localNow,
              retryCount,
              dryRun: SMS_DRY_RUN,
            });
            if (retrySendAttempt.outcome === "blocked") {
              stats.skippedUnexpected += 1;
              stats.skippedIntentional += 1;
              continue;
            }
            if (retrySendAttempt.outcome === "dry_run") {
              stats.alreadyReservedOrSentToday += 1;
              continue;
            }
            if (retrySendAttempt.outcome === "failed") {
              stats.failed += 1;
              stats.sendFailed += 1;
              stats.skippedUnexpected += 1;
              continue;
            }

            const {
              messageSid: retryMessageSid,
              twilioStatus: retryTwilioStatus,
              smsBody,
              sendContext: tylerTextOverviewCtx,
            } = retrySendAttempt;
            stats.twilioAccepted += 1;

            const retrySuccessPayload = dailySmsTwilioSuccessSendEventFields({
              messageSid: retryMessageSid,
              twilioStatus: retryTwilioStatus,
              smsBody,
              metadata: {
                ...existingMeta,
                ...schedulingTelemetry,
                retry_count: retryCount + 1,
                note: "retry_success",
                timezone,
                local_time: localNow.toISOString(),
                ...mergeTylerTextOverviewSendMetadata(
                  {},
                  tylerTextOverviewMetadataForSend(tylerTextOverviewCtx, smsBody)
                ),
              },
            });
            const recordResult = await recordDailyTwilioSuccessOrFallback({
              clerkUserId: audienceUser.clerk_user_id,
              dayKey: todayKey,
              pathLabel: "retry",
              primaryPayload: retrySuccessPayload,
              messageSid: retryMessageSid,
              smsBody,
              twilioStatus: retryTwilioStatus,
            });
            if (recordResult.recordOk) {
              if (!recordResult.usedFallback) {
                stats.sent += 1;
                stats.retried += 1;
              }
              await finalizeTylerTextOverviewAfterOutboundBestEffort({
                ctx: tylerTextOverviewCtx,
                draftBodyUsed: true,
                clerkUserId: audienceUser.clerk_user_id,
                dayKey: todayKey,
                smsBody,
                messageSid: retryMessageSid,
              });
              if (!recordResult.usedFallback && activeForPolicy?.id) {
                await runMorningTtoPostSendBookkeeping({
                  commitmentId: activeForPolicy.id,
                  clerkUserId: audienceUser.clerk_user_id,
                  dayKey: todayKey,
                  sentBody: smsBody,
                  messageSid: retryMessageSid,
                });
              }
            } else if (recordResult.orphanLogged) {
              stats.failed += 1;
              stats.sendFailed += 1;
              stats.skippedUnexpected += 1;
            }
            continue;
          }
        }
        // CASE B: any other status - skip
        stats.alreadyReservedOrSentToday += 1;
        stats.skippedIntentional += 1;
        continue;
      }

      // V2 cadence gate (explicit override only; silence cadence decoupled).
      stage = "cadence_gate";
      let activeCadence = await getActiveCommitment(audienceUser.clerk_user_id);
      if (activeCadence?.behavior_statement?.trim()) {
        await clearStaleAdaptiveContractColumns(activeCadence.id);
        const refreshedCadence = await getActiveCommitment(audienceUser.clerk_user_id);
        if (refreshedCadence?.behavior_statement?.trim()) {
          activeCadence = refreshedCadence;
        }
        const nowCadence = new Date();
        const userCadenceOverride = shouldApplyUserCadenceOverride(commsPrefs, nowCadence);
        if (userCadenceOverride != null) {
          const lastCheckCadence = await getLastV2CheckSentForCommitment(activeCadence.id);
          if (
            !shouldSendV2CadenceToday({
              lastSuccessfulCheckSentDayKey: lastCheckCadence?.day_key ?? null,
              todayLocalDayKey: todayKey,
              cadenceLevel: userCadenceOverride,
            })
          ) {
            stats.skippedCadence += 1;
            stats.skippedIntentional += 1;
            continue;
          }
        }
      }

      stage = "canonical_state_maintenance";
      const stateMaintenance = await runMorningTtoPreSendCanonicalStateMaintenance({
        clerkUserId: audienceUser.clerk_user_id,
        commitment: activeCadence?.behavior_statement?.trim()
          ? activeCadence
          : activeForPolicy,
        nowMs: now.getTime(),
      });
      if (stateMaintenance.commitment?.behavior_statement?.trim()) {
        activeCadence = stateMaintenance.commitment;
      }

      stage = "morning_tto_authoritative_gate";
      const morningTtoAuthoritativeGateMain = await assertMorningTtoDraftAuthoritativeForSend({
        clerkUserId: audienceUser.clerk_user_id,
        draftForDayKey: todayKey,
      });
      if (!morningTtoAuthoritativeGateMain.ok) {
        await recordMorningTtoAuthoritativeGateFailure({
          clerkUserId: audienceUser.clerk_user_id,
          todayKey,
          reason: morningTtoAuthoritativeGateMain.reason,
          hasSendEventRow: false,
          timezone,
          localNow,
          gateMetadata: morningTtoAuthoritativeGateMain.metadata,
        });
        incrementMorningTtoAuthoritativeSkipStat(stats, morningTtoAuthoritativeGateMain.reason);
        stats.skippedIntentional += 1;
        continue;
      }

      // STEP 3: Only reserve if no row exists
      stage = "reserve";
      const reservation = await reserveTodaySendOrSkip({
        userId: audienceUser.clerk_user_id,
        todayKey,
      });

      if (!reservation.reserved) {
        if (reservation.reason === "already_reserved_or_sent_today") {
          stats.alreadyReservedOrSentToday += 1;
          stats.skippedIntentional += 1;
        } else {
          stats.reservationErrors += 1;
          stats.skippedUnexpected += 1;
        }
        continue;
      }

      stats.reserved += 1;

      // Legacy: skip send if old app completion row exists for today. Not used for full V2 path.
      if (!skipLegacyDailyCompletionCheck) {
        const { data: completed } = await supabaseServer
          .from("daily_completion_events")
          .select("id")
          .eq("clerk_user_id", audienceUser.clerk_user_id)
          .eq("day_key", todayKey)
          .limit(1);

        if (completed && completed.length > 0) {
          await supabaseServer
            .from("sms_send_events")
            .update({
              status: "skipped_already_completed",
              metadata: { note: "user_completed_today" },
            })
            .eq("clerk_user_id", audienceUser.clerk_user_id)
            .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);

          stats.skippedAlreadyCompleted += 1;
          stats.skippedIntentional += 1;
          continue;
        }
      }

      stage = "active_inbound_thread_gate";
      if (await shouldSkipDailyForActiveInboundThread(audienceUser.clerk_user_id)) {
        await supabaseServer
          .from("sms_send_events")
          .update({
            status: "skipped_active_inbound_thread",
            metadata: {
              note: "recent_inbound_accountability_exchange",
              window_ms: 3 * 60 * 60 * 1000,
              timezone,
              local_time: localNow.toISOString(),
            },
          })
          .eq("clerk_user_id", audienceUser.clerk_user_id)
                  .eq("day_key", todayKey)
                  .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);

        stats.skippedActiveInboundThread += 1;
        stats.skippedIntentional += 1;
        continue;
      }

      if (
        await applySundayWeeklyPauseBeforeWriterIfNeeded({
          clerkUserId: audienceUser.clerk_user_id,
          todayKey,
          localNow,
          timezone,
          now,
          force,
          fullyOnV2: skipLegacyDailyCompletionCheck,
          commitment: activeForPolicy,
          commsPrefs,
        })
      ) {
        stats.skippedSundayWeeklyPause += 1;
        stats.skippedIntentional += 1;
        continue;
      }

      stage = "resolve_morning_tto_body";
      const mainSendAttempt = await attemptMorningTtoTwilioSend({
        gate: morningTtoAuthoritativeGateMain,
        clerkUserId: audienceUser.clerk_user_id,
        phoneNumber: audienceUser.phone_number,
        todayKey,
        md: md as Record<string, unknown>,
        existingMeta: { note: "reserved_by_cron" },
        timezone,
        localNow,
        dryRun: SMS_DRY_RUN,
      });
      if (mainSendAttempt.outcome === "blocked") {
        stats.skippedUnexpected += 1;
        stats.skippedIntentional += 1;
        continue;
      }
      if (mainSendAttempt.outcome === "dry_run") {
        await supabaseServer
          .from("sms_send_events")
          .update({
            status: SMS_DRY_RUN ? "dry_run" : "skipped_missing_twilio",
            metadata: {
              note: SMS_DRY_RUN ? "dry_run_enabled" : "twilio_not_ready",
              timezone,
              local_time: localNow.toISOString(),
            },
          })
          .eq("clerk_user_id", audienceUser.clerk_user_id)
          .eq("day_key", todayKey)
          .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);

        if (SMS_DRY_RUN) stats.dryRun += 1;
        else {
          stats.skippedMissingTwilio += 1;
          stats.skippedUnexpected += 1;
        }
        continue;
      }
      if (mainSendAttempt.outcome === "failed") {
        stats.failed += 1;
        stats.sendFailed += 1;
        stats.skippedUnexpected += 1;
        continue;
      }

      const {
        messageSid: mainMessageSid,
        twilioStatus: mainTwilioStatus,
        smsBody,
        sendContext: tylerTextOverviewCtx,
      } = mainSendAttempt;
      stats.twilioAccepted += 1;

      const mainSuccessPayload = dailySmsTwilioSuccessSendEventFields({
        messageSid: mainMessageSid,
        twilioStatus: mainTwilioStatus,
        smsBody,
        metadata: {
          ...schedulingTelemetry,
          note: "sent_to_twilio",
          timezone,
          local_time: localNow.toISOString(),
          ...mergeTylerTextOverviewSendMetadata(
            {},
            tylerTextOverviewMetadataForSend(tylerTextOverviewCtx, smsBody)
          ),
        },
      });
      const recordResult = await recordDailyTwilioSuccessOrFallback({
        clerkUserId: audienceUser.clerk_user_id,
        dayKey: todayKey,
        pathLabel: "main",
        primaryPayload: mainSuccessPayload,
        messageSid: mainMessageSid,
        smsBody,
        twilioStatus: mainTwilioStatus,
      });
      if (recordResult.recordOk) {
        if (!recordResult.usedFallback) {
          stats.sent += 1;
        }
        await finalizeTylerTextOverviewAfterOutboundBestEffort({
          ctx: tylerTextOverviewCtx,
          draftBodyUsed: true,
          clerkUserId: audienceUser.clerk_user_id,
          dayKey: todayKey,
          smsBody,
          messageSid: mainMessageSid,
        });
        if (!recordResult.usedFallback && activeForPolicy?.id) {
          await runMorningTtoPostSendBookkeeping({
            commitmentId: activeForPolicy.id,
            clerkUserId: audienceUser.clerk_user_id,
            dayKey: todayKey,
            sentBody: smsBody,
            messageSid: mainMessageSid,
          });
        }
      } else if (recordResult.orphanLogged) {
        stats.failed += 1;
        stats.sendFailed += 1;
        stats.skippedUnexpected += 1;
      }
      } catch (userErr: unknown) {
        const message =
          userErr instanceof Error ? userErr.message : String(userErr);
        console.error("[daily-sms] user processing error", {
          clerk_user_id: audienceUser.clerk_user_id,
          stage,
          message,
        });
        stats.userLoopErrors += 1;
        stats.skippedUnexpected += 1;
        continue;
      }
  }

  // Persist daily summary for observability (do not block cron success)
  const dayKey = getDateKeyInTimezone(new Date(), "UTC");
  try {
    await supabaseServer.from("sms_daily_stats").upsert(
      {
        day_key: dayKey,
        total_users: stats.scanned,
        eligible: stats.eligible,
        sent: stats.sent,
        failed: stats.failed,
        retried: stats.retried,
        skipped_not_time: stats.skippedNotTime,
        skipped_missing_identity: stats.skippedMissingIdentity,
        skipped_already_completed: stats.skippedAlreadyCompleted,
        skipped_not_fully_on_v2: stats.skippedNotFullyOnV2Daily,
        user_loop_errors: stats.userLoopErrors,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "day_key" }
    );
  } catch (err) {
    console.error("[daily-sms] sms_daily_stats upsert failed:", err);
  }

  console.log("[daily-sms] run summary", {
    scanned: stats.scanned,
    audienceSelfHealMerged: stats.audienceSelfHealMerged,
    eligible: stats.eligible,
    reserved: stats.reserved,
    sent: stats.sent,
    skippedAlreadyCompleted: stats.skippedAlreadyCompleted,
    skippedOutOfWindow: stats.skippedNotTime,
    skippedPreferredWindowWaiting: stats.skippedPreferredWindowWaiting,
    skippedPastSafeLocalCutoff: stats.skippedPastSafeLocalCutoff,
    skippedAlreadySent: stats.alreadyReservedOrSentToday,
    skippedOptedOut: stats.skippedOptedOut,
    skippedCadence: stats.skippedCadence,
    skippedActiveInboundThread: stats.skippedActiveInboundThread,
    skippedNotFullyOnV2Daily: stats.skippedNotFullyOnV2Daily,
    failed: stats.failed,
    reservationErrors: stats.reservationErrors,
    userLoopErrors: stats.userLoopErrors,
    recoveredReserved: stats.recoveredReserved,
    expectedDailyAttemptUsers: stats.expectedDailyAttemptUsers,
    expectedNewActiveUsers: stats.expectedNewActiveUsers,
    expectedNormalActiveUsers: stats.expectedNormalActiveUsers,
    skippedIntentional: stats.skippedIntentional,
    skippedUnexpected: stats.skippedUnexpected,
    catchupEligible: stats.catchupEligible,
    catchupAttempted: stats.catchupAttempted,
    sendFailed: stats.sendFailed,
    twilioAccepted: stats.twilioAccepted,
  });
  console.log(
    JSON.stringify({
      event: "daily_sms_alert_metrics",
      day_key: dayKey,
      skipped_not_fully_on_v2: stats.skippedNotFullyOnV2Daily,
      user_loop_errors: stats.userLoopErrors,
      sent: stats.sent,
      failed: stats.failed,
      expected_daily_attempt_users: stats.expectedDailyAttemptUsers,
      expected_new_active_users: stats.expectedNewActiveUsers,
      expected_normal_active_users: stats.expectedNormalActiveUsers,
      catchup_eligible: stats.catchupEligible,
      catchup_attempted: stats.catchupAttempted,
      skipped_preferred_window_waiting: stats.skippedPreferredWindowWaiting,
      skipped_past_safe_local_cutoff: stats.skippedPastSafeLocalCutoff,
      skipped_intentional: stats.skippedIntentional,
      skipped_unexpected: stats.skippedUnexpected,
      twilio_accepted: stats.twilioAccepted,
    })
  );

  return NextResponse.json(stats);
}