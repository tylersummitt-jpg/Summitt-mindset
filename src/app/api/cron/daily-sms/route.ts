/**
 * Daily SMS cron: Layer B only. Sequencing lives in Supabase `sms_delivery_state`
 * (not Clerk `deliveryDay`). Layer A / progression stays in Clerk (`currentDay`, etc.).
 */
import crypto from "crypto";
import { NextResponse } from "next/server";
import { getClerkUser } from "@/lib/clerk-rest";
import { syncSmsAudience } from "@/lib/sms-audience-sync";
import { supabaseServer } from "@/lib/supabase-server";
import {
  applySmsDeliveryStateAfterSuccessfulSend,
  buildSmsBodyFromDeliveryState,
  loadOrCreateSmsDeliveryState,
  smsTimePreferenceFromClerkMetadata,
  type SmsDeliveryStateRow,
} from "@/lib/sms-daily-delivery-body";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";
import { sendSMS, isTwilioReady } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;
const ENV_SMS_DRY_RUN = process.env.SMS_DRY_RUN === "true";

/**
 * Mirrors flexSlotModality in sms-daily-delivery-body (keep aligned with buildSmsBodyFromDeliveryState).
 */
function flexSlotModalityForOutboundContext(
  flexCadenceIndex: number
): "respond" | "non_response" {
  const slot = ((flexCadenceIndex % 7) + 7) % 7;
  if (slot === 2 || slot === 5) return "respond";
  return "non_response";
}

/**
 * Same effectiveContentType rules as buildSmsBodyFromDeliveryState.
 */
function effectiveContentTypeFromSnapshot(
  state: SmsDeliveryStateRow
): "respond" | "non_response" {
  const isFlex = state.sms_bucket === "flex";
  return isFlex
    ? flexSlotModalityForOutboundContext(state.flex_cadence_index)
    : state.current_content_type === "non_response"
      ? "respond"
      : state.current_content_type === "respond" &&
          state.question_attempt_count >= 3
        ? "non_response"
        : "respond";
}

function timeOfDayForOutboundContext(md: Record<string, unknown>): "morning" | "evening" {
  const pref = smsTimePreferenceFromClerkMetadata(md).toLowerCase().trim();
  if (pref === "midday" || pref === "evening") return "evening";
  return "morning";
}

async function upsertLastOutboundContextAfterDailySend(args: {
  clerkUserId: string;
  md: Record<string, unknown>;
  deliveryStateSnapshot: SmsDeliveryStateRow;
  smsBody: string;
  twilioMessageSid: string;
  /** One-time Day 2 freeform outbound (not MCQ); treat as question for coach context. */
  day2FreeformSpecial?: boolean;
}): Promise<void> {
  try {
    const effective = args.day2FreeformSpecial
      ? "respond"
      : effectiveContentTypeFromSnapshot(args.deliveryStateSnapshot);
    const messageKind = effective === "respond" ? "question" : "quote";

    const { error } = await supabaseServer.from("sms_last_outbound_context").upsert(
      {
        clerk_user_id: args.clerkUserId,
        sent_at: new Date().toISOString(),
        message_kind: messageKind,
        full_body: args.smsBody,
        question_position:
          effective === "respond" ? args.deliveryStateSnapshot.question_position : null,
        time_of_day: timeOfDayForOutboundContext(args.md),
        twilio_message_sid: args.twilioMessageSid,
        delivery_snapshot: {
          clerk_user_id: args.deliveryStateSnapshot.clerk_user_id,
          question_position: args.deliveryStateSnapshot.question_position,
          quote_position: args.deliveryStateSnapshot.quote_position,
          current_content_type: args.deliveryStateSnapshot.current_content_type,
          question_attempt_count: args.deliveryStateSnapshot.question_attempt_count,
          daily_nonresponse_cycle_count:
            args.deliveryStateSnapshot.daily_nonresponse_cycle_count,
          sms_bucket: args.deliveryStateSnapshot.sms_bucket,
          flex_cadence_index: args.deliveryStateSnapshot.flex_cadence_index,
          ...(args.day2FreeformSpecial ? { is_day2_freeform: true } : {}),
        },
      },
      { onConflict: "clerk_user_id" }
    );

    if (error) {
      console.error("[daily-sms] sms_last_outbound_context upsert failed", {
        clerk_user_id: args.clerkUserId,
        error: error.message,
      });
    }
  } catch (e) {
    console.error("[daily-sms] sms_last_outbound_context upsert threw", {
      clerk_user_id: args.clerkUserId,
      e,
    });
  }
}

async function buildSmsWithDeliveryEngine(
  clerkUserId: string,
  md: Record<string, unknown>
): Promise<
  | {
      ok: true;
      smsBody: string;
      deliveryStateSnapshot: SmsDeliveryStateRow;
      day2SpecialUsed: boolean;
    }
  | { ok: false; error: string }
> {
  const pref = smsTimePreferenceFromClerkMetadata(md);

  const rawCurrentDay = md.currentDay;
  const currentDay =
    typeof rawCurrentDay === "number" &&
    Number.isFinite(rawCurrentDay) &&
    rawCurrentDay > 0
      ? Math.floor(rawCurrentDay)
      : null;

  const stateRes = await loadOrCreateSmsDeliveryState(clerkUserId);
  if (stateRes.error || !stateRes.data) {
    return { ok: false, error: stateRes.error ?? "sms_delivery_state missing" };
  }

  const built = await buildSmsBodyFromDeliveryState({
    clerkUserId,
    state: stateRes.data,
    smsTimePreference: pref,
    currentDay,
  });

  if (!built.ok) {
    return { ok: false, error: built.error };
  }

  return {
    ok: true,
    smsBody: built.smsBody,
    deliveryStateSnapshot: stateRes.data,
    day2SpecialUsed: built.day2SpecialUsed,
  };
}

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
const SEND_HOUR_BY_PREFERENCE = {
  early_morning: 7,
  morning: 7,
  midday: 19,
  evening: 19,
} as const;

function isInSendWindow(local: Date, sendHour: number): boolean {
  return local.getHours() === sendHour;
}

/**
 * ======================================================
 * Helper: try to reserve today's send slot
 * ======================================================
 *
 * We rely on your unique index: (clerk_user_id, day_key)
 * - If insert succeeds: this run owns the send attempt.
 * - If insert fails due to unique violation: SMS already reserved/sent today, skip safely.
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
    status: "reserved",
    metadata: { note: "reserved_by_cron" },
  });

  if (!error) return { reserved: true };

  // Postgres unique violation is usually 23505; Supabase error "code" often contains it.
  // If we can't detect it perfectly, we still treat any insert error as "not reserved"
  // to avoid double-sending. This favors safety over aggressive retries.
  const code = (error as any)?.code;
  const message = (error as any)?.message || String(error);

  if (code === "23505" || message.toLowerCase().includes("duplicate")) {
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
      stoppedAt: null,
      timezone: typeof md.timezone === "string" ? md.timezone : null,
      smsTimePreference:
        typeof md.smsTimePreference === "string" ? md.smsTimePreference : null,
      summittSubscribed: true,
    });

    mergedCount += 1;
    seen.add(uid);
    result.push({
      clerk_user_id: uid,
      phone_number: phone.trim(),
      sms_enabled: true,
      stopped_at: null,
      timezone: typeof md.timezone === "string" ? md.timezone : null,
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
    skippedMissingTwilio: 0,
    failed: 0,
    reservationErrors: 0,
    userLoopErrors: 0,
    recoveredReserved: 0,
    audienceSelfHealMerged: 0,
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

      let stage = "getClerkUser";
      try {
      const user = await getClerkUser(audienceUser.clerk_user_id);
      const md = user.public_metadata || {};

      if (typeof audienceUser.stopped_at === "string") {
        stats.skippedOptedOut += 1;
        continue;
      }

      const timezone = resolveUserTimezone(md.timezone ?? audienceUser.timezone);
      const now = new Date();

      // localNow = "now" interpreted in that user's timezone
      const localNow = new Date(now.toLocaleString("en-US", { timeZone: timezone }));

      // Key used for dedupe
      const todayKey = getDateKeyInTimezone(now, timezone);

      const pref = smsTimePreferenceFromClerkMetadata(md as Record<string, unknown>);
      const sendHour =
        SEND_HOUR_BY_PREFERENCE[pref as keyof typeof SEND_HOUR_BY_PREFERENCE] ?? 7;

      // STEP 1: Read existing event before reserve (and before window check)
      stage = "query_send_events";
      const { data: existingRow } = await supabaseServer
        .from("sms_send_events")
        .select("id, status, metadata, message_sid")
        .eq("clerk_user_id", audienceUser.clerk_user_id)
        .eq("day_key", todayKey)
        .maybeSingle();

      let existingEvent = existingRow;

      // Retries bypass send window; first-time sends require it
      const meta = existingEvent?.metadata as Record<string, unknown> | undefined;
      const retryCountFromMeta =
        typeof meta?.retry_count === "number" ? meta.retry_count : 0;
      const isRetryPending =
        existingEvent?.status === "send_failed" && retryCountFromMeta < 3;

      if (!existingEvent && !force && !isInSendWindow(localNow, sendHour)) {
        stats.skippedNotTime += 1;
        continue;
      }

      stats.eligible += 1;

      // STEP 2 & 3: Handle existing row or proceed to reserve
      if (existingEvent) {
        const messageSidRaw = existingEvent.message_sid;
        const hasMessageSid =
          typeof messageSidRaw === "string" && messageSidRaw.trim().length > 0;

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
            .eq("day_key", todayKey);

          existingEvent = {
            ...existingEvent,
            status: "send_failed",
            metadata: recoveredMeta,
          };
        }

        // CASE A: send_failed with retries left
        if (existingEvent.status === "send_failed") {
          const existingMeta = (existingEvent.metadata || {}) as Record<string, unknown>;
          const retryCount = typeof existingMeta.retry_count === "number" ? existingMeta.retry_count : 0;

          if (retryCount < 3) {
            // Check completion (user may have completed since failure)
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
                .eq("day_key", todayKey);
              stats.skippedAlreadyCompleted += 1;
              continue;
            }

            stage = "build_content";
            let smsBody: string;
            let deliveryStateSnapshot: SmsDeliveryStateRow | null = null;

            const built = await buildSmsWithDeliveryEngine(
              audienceUser.clerk_user_id,
              md as Record<string, unknown>
            );
            if (!built.ok) {
              await supabaseServer
                .from("sms_send_events")
                .update({
                  status: "send_failed",
                  metadata: {
                    ...existingMeta,
                    note: "new_delivery_body_failed",
                    error: built.error,
                    timezone,
                    local_time: localNow.toISOString(),
                  },
                })
                .eq("clerk_user_id", audienceUser.clerk_user_id)
                .eq("day_key", todayKey);
              stats.failed += 1;
              continue;
            }
            smsBody = built.smsBody;
            deliveryStateSnapshot = built.deliveryStateSnapshot;
            const day2SpecialUsedRetry = built.day2SpecialUsed;

            stage = "twilio_send_or_skip";
            if (!isTwilioReady() || SMS_DRY_RUN) {
              stats.alreadyReservedOrSentToday += 1;
              continue;
            }

            let retryMessage;
            try {
              const effectiveForSend = day2SpecialUsedRetry
                ? "respond"
                : effectiveContentTypeFromSnapshot(deliveryStateSnapshot);
              retryMessage = await sendSMS({
                to: audienceUser.phone_number,
                body: smsBody,
                lastOutbound: {
                  clerkUserId: audienceUser.clerk_user_id,
                  messageKind:
                    effectiveForSend === "respond" ? "question" : "quote",
                  timeOfDay: timeOfDayForOutboundContext(
                    md as Record<string, unknown>
                  ),
                  questionPosition:
                    effectiveForSend === "respond"
                      ? deliveryStateSnapshot.question_position
                      : null,
                  skipLastOutboundContextUpsert: true,
                },
              });
            } catch (err) {
              const newRetryCount = retryCount + 1;
              await supabaseServer
                .from("sms_send_events")
                .update({
                  status: "send_failed",
                  metadata: {
                    ...existingMeta,
                    retry_count: newRetryCount,
                    error: String(err),
                    note: "retry_failed",
                    timezone,
                    local_time: localNow.toISOString(),
                  },
                })
                .eq("clerk_user_id", audienceUser.clerk_user_id)
                .eq("day_key", todayKey);
              stats.failed += 1;
              continue;
            }

            const retrySuccessPayload = {
              message_sid: retryMessage.sid,
              status: retryMessage.status,
              sms_body: smsBody,
              metadata: {
                ...existingMeta,
                retry_count: retryCount + 1,
                note: "retry_success",
                timezone,
                local_time: localNow.toISOString(),
              },
            };
            let recordOk = false;
            const { error: retryUpdErr } = await supabaseServer
              .from("sms_send_events")
              .update(retrySuccessPayload)
              .eq("clerk_user_id", audienceUser.clerk_user_id)
              .eq("day_key", todayKey);
            if (!retryUpdErr) {
              recordOk = true;
            } else {
              console.error(
                "[daily-sms] sms_send_events update failed after Twilio success (retry path)",
                {
                  clerk_user_id: audienceUser.clerk_user_id,
                  todayKey,
                  message_sid: retryMessage.sid,
                  error: retryUpdErr,
                }
              );
              const { error: retryUpdErr2 } = await supabaseServer
                .from("sms_send_events")
                .update(retrySuccessPayload)
                .eq("clerk_user_id", audienceUser.clerk_user_id)
                .eq("day_key", todayKey);
              if (!retryUpdErr2) {
                recordOk = true;
              } else {
                console.error(
                  "[daily-sms] sms_send_events second update failed after Twilio success (retry path)",
                  {
                    clerk_user_id: audienceUser.clerk_user_id,
                    todayKey,
                    message_sid: retryMessage.sid,
                    error: retryUpdErr2,
                  }
                );
              }
            }
            if (recordOk) {
              stats.sent += 1;
              stats.retried += 1;
              if (deliveryStateSnapshot) {
                await upsertLastOutboundContextAfterDailySend({
                  clerkUserId: audienceUser.clerk_user_id,
                  md: md as Record<string, unknown>,
                  deliveryStateSnapshot,
                  smsBody,
                  twilioMessageSid: retryMessage.sid,
                  day2FreeformSpecial: day2SpecialUsedRetry,
                });
                const applied = await applySmsDeliveryStateAfterSuccessfulSend(
                  deliveryStateSnapshot,
                  { day2SpecialSent: day2SpecialUsedRetry }
                );
                if (!applied.ok) {
                  console.error("[daily-sms] delivery_state update failed after retry send", {
                    clerk_user_id: audienceUser.clerk_user_id,
                    error: applied.error,
                  });
                }
              }
            } else {
              console.error(
                "[daily-sms] Twilio sent but failed to record sms_send_events",
                {
                  clerkUserId: audienceUser.clerk_user_id,
                  dayKey: todayKey,
                  messageSid: retryMessage.sid,
                }
              );
              stats.failed += 1;
            }
            continue;
          }
        }
        // CASE B: any other status - skip
        stats.alreadyReservedOrSentToday += 1;
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
        } else {
          stats.reservationErrors += 1;
        }
        continue;
      }

      stats.reserved += 1;

      // If user already completed today, we skip sending the daily SMS.
      // (This matches your current behavior and avoids unnecessary pings.)
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
          .eq("day_key", todayKey);

        stats.skippedAlreadyCompleted += 1;
        continue;
      }

      stage = "build_content";
      let smsBody: string;
      let deliveryStateSnapshotMain: SmsDeliveryStateRow | null = null;

      const builtMain = await buildSmsWithDeliveryEngine(
        audienceUser.clerk_user_id,
        md as Record<string, unknown>
      );
      if (!builtMain.ok) {
        await supabaseServer
          .from("sms_send_events")
          .update({
            status: "send_failed",
            metadata: {
              note: "new_delivery_body_failed",
              error: builtMain.error,
              timezone,
              local_time: localNow.toISOString(),
            },
          })
          .eq("clerk_user_id", audienceUser.clerk_user_id)
          .eq("day_key", todayKey);
        stats.failed += 1;
        continue;
      }
      smsBody = builtMain.smsBody;
      deliveryStateSnapshotMain = builtMain.deliveryStateSnapshot;
      const day2SpecialUsedMain = builtMain.day2SpecialUsed;

      // Twilio readiness + dry run
      stage = "twilio_send_or_skip";
      if (!isTwilioReady() || SMS_DRY_RUN) {
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
          .eq("day_key", todayKey);

        if (SMS_DRY_RUN) stats.dryRun += 1;
        else stats.skippedMissingTwilio += 1;

        continue;
      }

      let mainMessage;
      try {
        const effectiveForSendMain =
          day2SpecialUsedMain
            ? "respond"
            : deliveryStateSnapshotMain != null
              ? effectiveContentTypeFromSnapshot(deliveryStateSnapshotMain)
              : "respond";
        mainMessage = await sendSMS({
          to: audienceUser.phone_number,
          body: smsBody,
          lastOutbound:
            deliveryStateSnapshotMain != null
              ? {
                  clerkUserId: audienceUser.clerk_user_id,
                  messageKind:
                    effectiveForSendMain === "respond" ? "question" : "quote",
                  timeOfDay: timeOfDayForOutboundContext(
                    md as Record<string, unknown>
                  ),
                  questionPosition:
                    effectiveForSendMain === "respond"
                      ? deliveryStateSnapshotMain.question_position
                      : null,
                  skipLastOutboundContextUpsert: true,
                }
              : undefined,
        });
      } catch (err) {
        await supabaseServer
          .from("sms_send_events")
          .update({
            status: "send_failed",
            metadata: {
              error: String(err),
              retry_count: 0,
              timezone,
              local_time: localNow.toISOString(),
            },
          })
          .eq("clerk_user_id", audienceUser.clerk_user_id)
          .eq("day_key", todayKey);

        stats.failed += 1;
      }

      if (mainMessage) {
        const mainSuccessPayload = {
          message_sid: mainMessage.sid,
          status: mainMessage.status,
          sms_body: smsBody,
          metadata: {
            note: "sent_to_twilio",
            timezone,
            local_time: localNow.toISOString(),
          },
        };
        let recordOk = false;
        const { error: mainUpdErr } = await supabaseServer
          .from("sms_send_events")
          .update(mainSuccessPayload)
          .eq("clerk_user_id", audienceUser.clerk_user_id)
          .eq("day_key", todayKey);
        if (!mainUpdErr) {
          recordOk = true;
        } else {
          console.error(
            "[daily-sms] sms_send_events update failed after Twilio success (main path)",
            {
              clerk_user_id: audienceUser.clerk_user_id,
              todayKey,
              message_sid: mainMessage.sid,
              error: mainUpdErr,
            }
          );
          const { error: mainUpdErr2 } = await supabaseServer
            .from("sms_send_events")
            .update(mainSuccessPayload)
            .eq("clerk_user_id", audienceUser.clerk_user_id)
            .eq("day_key", todayKey);
          if (!mainUpdErr2) {
            recordOk = true;
          } else {
            console.error(
              "[daily-sms] sms_send_events second update failed after Twilio success (main path)",
              {
                clerk_user_id: audienceUser.clerk_user_id,
                todayKey,
                message_sid: mainMessage.sid,
                error: mainUpdErr2,
              }
            );
          }
        }
        if (recordOk) {
          stats.sent += 1;
          if (deliveryStateSnapshotMain) {
            await upsertLastOutboundContextAfterDailySend({
              clerkUserId: audienceUser.clerk_user_id,
              md: md as Record<string, unknown>,
              deliveryStateSnapshot: deliveryStateSnapshotMain,
              smsBody,
              twilioMessageSid: mainMessage.sid,
              day2FreeformSpecial: day2SpecialUsedMain,
            });
            const applied = await applySmsDeliveryStateAfterSuccessfulSend(
              deliveryStateSnapshotMain,
              { day2SpecialSent: day2SpecialUsedMain }
            );
            if (!applied.ok) {
              console.error("[daily-sms] delivery_state update failed after main send", {
                clerk_user_id: audienceUser.clerk_user_id,
                error: applied.error,
              });
            }
          }
        } else {
          console.error(
            "[daily-sms] Twilio sent but failed to record sms_send_events",
            {
              clerkUserId: audienceUser.clerk_user_id,
              dayKey: todayKey,
              messageSid: mainMessage.sid,
            }
          );
          stats.failed += 1;
        }
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
    skippedAlreadySent: stats.alreadyReservedOrSentToday,
    skippedOptedOut: stats.skippedOptedOut,
    failed: stats.failed,
    reservationErrors: stats.reservationErrors,
    userLoopErrors: stats.userLoopErrors,
    recoveredReserved: stats.recoveredReserved,
  });

  return NextResponse.json(stats);
}