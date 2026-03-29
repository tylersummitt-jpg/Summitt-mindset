import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { completeDay } from "@/lib/complete-day";
import { getOrCreateDailyPracticeVersion } from "@/lib/get-or-create-daily-practice-version";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";
import { coachEngine } from "@/lib/coach-engine";
import { sendSMSChunked, isTwilioReady } from "@/lib/twilio";

function translateSmsReply(raw: string, dayNumber: number): string {
  if (!raw) return raw;

  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return raw;

  const match = trimmed.match(/^(a|b|c|d)([^a-z]|$)/);
  if (!match) return raw;

  const letter = match[1];

  // Day-specific mappings (Days 2–7 first; Day 1 uses the "need most" map via <= 7)
  if (dayNumber === 2) {
    const map: Record<string, string> = {
      a: "I will rest today",
      b: "I will move my body today",
      c: "I will fuel my body today",
      d: "I will clear my mind today",
    };
    return map[letter] || raw;
  }

  if (dayNumber === 3) {
    const map: Record<string, string> = {
      a: "I will finish something I've been putting off today",
      b: "I will knock out a quick task today",
      c: "I will make progress on something important today",
      d: "I will do something that makes me feel better today",
    };
    return map[letter] || raw;
  }

  if (dayNumber === 4) {
    const map: Record<string, string> = {
      a: "I will stay focused on what matters today",
      b: "I will keep my energy steady today",
      c: "I will follow through no matter what today",
      d: "I will stay positive and composed today",
    };
    return map[letter] || raw;
  }

  if (dayNumber === 5) {
    const map: Record<string, string> = {
      a: "I will reset and start again today",
      b: "I will do one small thing today",
      c: "I will slow down and regroup today",
      d: "I will keep going no matter what today",
    };
    return map[letter] || raw;
  }

  if (dayNumber === 6) {
    const map: Record<string, string> = {
      a: "I will show up focused today",
      b: "I will show up steady today",
      c: "I will show up disciplined today",
      d: "I will show up positive today",
    };
    return map[letter] || raw;
  }

  if (dayNumber === 7) {
    const map: Record<string, string> = {
      a: "I am starting to build something",
      b: "I am showing up more consistently",
      c: "I am learning how to adjust",
      d: "I am not there yet, but I am trying",
    };
    return map[letter] || raw;
  }

  if (dayNumber <= 7) {
    const map: Record<string, string> = {
      a: "I need focus today",
      b: "I need energy today",
      c: "I need confidence today",
      d: "I need clarity today",
    };
    return map[letter] || raw;
  }

  // fallback for other days
  return raw;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Job status (text column):
 * pending → claimed → processing → generating_reply → reply_ready → sending → sent
 * failed: retriable; needs_manual_review: operator must reset (e.g. to pending) or verify Twilio
 * cancelled: user ineligible
 */
const CRON_SECRET = process.env.CRON_SECRET;

const BATCH_SIZE = 5;
const MAX_ATTEMPTS = 25;
const STALE_PROCESSING_MINUTES = 15;

const COACH_SMS_FALLBACK = "Good. Stay steady. We’ll keep building.";

const farFutureIso = () =>
  new Date(Date.now() + 86400 * 365 * 10 * 1000).toISOString();

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

  if (!hasXCronHeader && !hasAuthorizationHeader && req.method === "GET") {
    try {
      const url = new URL(req.url);
      if (url.pathname.startsWith("/api/cron/")) {
        const qSecret = url.searchParams.get("cron_secret");
        if (qSecret && timingSafeEqualUtf8(qSecret, CRON_SECRET)) {
          console.log("[sms-inbound-coach] allowed via query cron_secret fallback");
          return true;
        }
      }
    } catch {
      // ignore
    }
  }

  return false;
}

function safeDayNumber(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  if (value <= 0) return null;
  return Math.floor(value);
}

function getCompletionConfirmation(dayNumber: number): string {
  const options = [
    `Day ${dayNumber} is complete.`,
    `You completed Day ${dayNumber}.`,
    `That locks in Day ${dayNumber}.`,
    `Day ${dayNumber} — done.`,
    `You’re building something real. Day ${dayNumber} complete.`,
  ];
  return options[dayNumber % options.length];
}

function getSignatureLine(dayNumber: number): string {
  const options = ["— Coach", "— Coach Pat", "— Your Coach"];
  return options[dayNumber % options.length];
}

function computeNextRetryIso(attempt: number): string {
  const sec = Math.min(600, 30 * Math.max(1, attempt));
  return new Date(Date.now() + sec * 1000).toISOString();
}

type JobRow = {
  message_sid: string;
  clerk_user_id: string;
  from_phone: string;
  raw_body: string;
  status: string;
  attempt_count: number;
  next_retry_at: string;
  reply_body: string | null;
  sent_at: string | null;
  last_error: string | null;
  outbound_message_sid: string | null;
};

async function markJobFinal(args: {
  messageSid: string;
  status: string;
  lastError?: string | null;
  attemptCount?: number;
  nextRetry?: string;
}) {
  const patch: Record<string, unknown> = {
    status: args.status,
    updated_at: new Date().toISOString(),
  };
  if (args.lastError !== undefined) {
    patch.last_error = args.lastError;
  }
  if (args.nextRetry !== undefined) {
    patch.next_retry_at = args.nextRetry;
  }
  if (typeof args.attemptCount === "number") {
    patch.attempt_count = args.attemptCount;
  }

  await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update(patch)
    .eq("message_sid", args.messageSid);
}

async function repairOutboundSidWithoutSentAt(): Promise<number> {
  const { data: rows, error } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select("message_sid")
    .not("outbound_message_sid", "is", null)
    .is("sent_at", null)
    .limit(25);

  if (error || !rows?.length) return 0;

  let n = 0;
  for (const r of rows) {
    const { error: upErr } = await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("message_sid", r.message_sid);
    if (!upErr) n += 1;
  }
  if (n > 0) {
    console.log("[sms-inbound-coach] repaired partial send finalization", { count: n });
  }
  return n;
}

async function reclaimStaleJobs(nowIso: string): Promise<void> {
  const staleCutoff = new Date(
    Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000
  ).toISOString();

  const { error: e1 } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: "failed",
      last_error: "stale_processing_reclaimed",
      next_retry_at: nowIso,
      updated_at: nowIso,
    })
    .eq("status", "processing")
    .is("sent_at", null)
    .is("outbound_message_sid", null)
    .lt("updated_at", staleCutoff);

  if (e1) {
    console.error("[sms-inbound-coach] stale processing reclaim error", e1);
  }

  const { error: e2 } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: "needs_manual_review",
      last_error:
        "stale_generating_reply: coach step did not persist reply_body; operator verify coach_conversations / may reset to pending after fix",
      next_retry_at: farFutureIso(),
      updated_at: nowIso,
    })
    .eq("status", "generating_reply")
    .is("reply_body", null)
    .lt("updated_at", staleCutoff);

  if (e2) {
    console.error("[sms-inbound-coach] stale generating_reply reclaim error", e2);
  }

  const { error: e3 } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: "needs_manual_review",
      last_error:
        "stale_sending_no_outbound_sid: possible Twilio delivery unknown; operator verify before resetting",
      next_retry_at: farFutureIso(),
      updated_at: nowIso,
    })
    .eq("status", "sending")
    .is("outbound_message_sid", null)
    .is("sent_at", null)
    .lt("updated_at", staleCutoff);

  if (e3) {
    console.error("[sms-inbound-coach] stale sending reclaim error", e3);
  }
}

async function loadJob(messageSid: string): Promise<JobRow | null> {
  const { data } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select("*")
    .eq("message_sid", messageSid)
    .maybeSingle();
  return data as JobRow | null;
}

async function processJob(claimedJob: JobRow): Promise<void> {
  const fresh = await loadJob(claimedJob.message_sid);
  if (!fresh) {
    throw new Error("job_missing");
  }

  let job = fresh;

  if (job.outbound_message_sid && !job.sent_at) {
    console.log("[sms-inbound-coach] repair sent_at from outbound sid", job.message_sid);
    await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("message_sid", job.message_sid);
    return;
  }

  if (job.sent_at) {
    await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        status: "sent",
        updated_at: new Date().toISOString(),
      })
      .eq("message_sid", job.message_sid);
    return;
  }

  const userId = job.clerk_user_id;

  const { data: identity } = await supabaseServer
    .from("sms_identities")
    .select("phone_number, clerk_user_id, sms_enabled, stopped_at")
    .eq("phone_number", job.from_phone)
    .maybeSingle();

  if (!identity?.clerk_user_id || identity.clerk_user_id !== userId) {
    console.log("[sms-inbound-coach] cancelled: identity missing", job.message_sid);
    await markJobFinal({
      messageSid: job.message_sid,
      status: "cancelled",
      lastError: "identity_missing",
      nextRetry: farFutureIso(),
    });
    return;
  }

  if (identity.sms_enabled !== true || typeof identity.stopped_at === "string") {
    console.log("[sms-inbound-coach] cancelled: sms disabled", job.message_sid);
    await markJobFinal({
      messageSid: job.message_sid,
      status: "cancelled",
      lastError: "sms_disabled",
      nextRetry: farFutureIso(),
    });
    return;
  }

  const md = await getClerkPublicMetadata(userId);
  if (md.smsEnabled !== true) {
    console.log("[sms-inbound-coach] cancelled: clerk sms off", job.message_sid);
    await markJobFinal({
      messageSid: job.message_sid,
      status: "cancelled",
      lastError: "clerk_sms_disabled",
      nextRetry: farFutureIso(),
    });
    return;
  }

  const currentDay = safeDayNumber(md.currentDay);
  if (!currentDay) {
    console.log("[sms-inbound-coach] cancelled: no currentDay", job.message_sid);
    await markJobFinal({
      messageSid: job.message_sid,
      status: "cancelled",
      lastError: "no_current_day",
      nextRetry: farFutureIso(),
    });
    return;
  }

  const timezone = resolveUserTimezone(md.timezone);
  const todayKey = getDateKeyInTimezone(new Date(), timezone);

  const { data: existingCompletion } = await supabaseServer
    .from("daily_completion_events")
    .select("id")
    .eq("clerk_user_id", userId)
    .eq("day_key", todayKey)
    .maybeSingle();

  const alreadyCompleted = !!existingCompletion;

  let dayForThread = currentDay;

  if (
    typeof md.activeCoachDay === "number" &&
    Number.isFinite(md.activeCoachDay) &&
    md.activeCoachDay > 0 &&
    typeof md.activeCoachDayKey === "string" &&
    md.activeCoachDayKey === todayKey
  ) {
    dayForThread = Math.floor(md.activeCoachDay);
  }

  const processedMessage = translateSmsReply(job.raw_body, dayForThread);

  let didCompleteToday = false;

  if (!alreadyCompleted) {
    console.log("[sms-inbound-coach] completion start", job.message_sid);
    const version = await getOrCreateDailyPracticeVersion({
      userId,
      dayNumber: dayForThread,
    });

    await supabaseServer.from("journal_entries").upsert(
      {
        clerk_user_id: userId,
        day_number: dayForThread,
        content: processedMessage,
        action_item: version.actionItem,
        reflection_prompt: version.reflectionPrompt,
        source: "sms",
      },
      { onConflict: "clerk_user_id,day_number" }
    );

    const completionResult = await completeDay({
      userId,
      source: "sms",
    });

    if (completionResult.ok) {
      didCompleteToday = true;
    }
    console.log("[sms-inbound-coach] completion done", job.message_sid, {
      ok: completionResult.ok,
    });
  }

  job = (await loadJob(job.message_sid)) ?? job;
  let replyBody = (job.reply_body || "").trim();

  if (!replyBody) {
    if (job.status === "processing") {
      await supabaseServer
        .from("sms_inbound_coach_jobs")
        .update({
          status: "generating_reply",
          updated_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("message_sid", job.message_sid)
        .eq("status", "processing")
        .is("reply_body", null);
    }

    job = (await loadJob(job.message_sid)) ?? job;
    replyBody = (job.reply_body || "").trim();

    if (!replyBody && job.status !== "generating_reply") {
      throw new Error(`unexpected_state_before_coach: ${job.status}`);
    }

    if (!replyBody) {
      let coachOk = false;
      let coachText = COACH_SMS_FALLBACK;

      try {
        const coachResult = await coachEngine({
          userId,
          dayNumber: dayForThread,
          userMessage: processedMessage,
          source: "sms",
        });

        if (coachResult.ok) {
          coachOk = true;
          coachText = coachResult.coachText;
        } else {
          coachText = COACH_SMS_FALLBACK;
        }
      } catch (err) {
        console.error("[sms-inbound-coach] coachEngine threw", job.message_sid, err);
        coachText = COACH_SMS_FALLBACK;
        coachOk = false;
      }

      if (coachOk && didCompleteToday) {
        replyBody =
          `${getCompletionConfirmation(dayForThread)}\n\n` +
          `${coachText}\n\n` +
          `${getSignatureLine(dayForThread)}`;
      } else {
        replyBody = coachText;
      }

      const now = new Date().toISOString();
      const { data: persisted, error: persistErr } = await supabaseServer
        .from("sms_inbound_coach_jobs")
        .update({
          reply_body: replyBody,
          status: "reply_ready",
          next_retry_at: now,
          updated_at: now,
          last_error: null,
        })
        .eq("message_sid", job.message_sid)
        .eq("status", "generating_reply")
        .select()
        .maybeSingle();

      if (persistErr) {
        throw new Error(`reply_ready persist failed: ${persistErr.message}`);
      }
      if (!persisted) {
        job = (await loadJob(job.message_sid)) ?? job;
        replyBody = (job.reply_body || "").trim();
        if (!replyBody) {
          throw new Error("reply_ready persist race lost and reply_body still empty");
        }
      }

      console.log("[sms-inbound-coach] coach reply stored, reply_ready", job.message_sid);
    }
  }

  job = (await loadJob(job.message_sid)) ?? job;
  replyBody = (job.reply_body || "").trim();
  if (!replyBody) {
    throw new Error("missing_reply_body_before_send");
  }

  if (job.sent_at || job.outbound_message_sid) {
    if (job.outbound_message_sid && !job.sent_at) {
      await supabaseServer
        .from("sms_inbound_coach_jobs")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("message_sid", job.message_sid);
    }
    return;
  }

  const { data: sendClaim } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: "sending",
      updated_at: new Date().toISOString(),
    })
    .eq("message_sid", job.message_sid)
    .eq("status", "reply_ready")
    .select()
    .maybeSingle();

  if (!sendClaim) {
    job = (await loadJob(job.message_sid)) ?? job;
    if (job.status === "sending" && job.outbound_message_sid) {
      await supabaseServer
        .from("sms_inbound_coach_jobs")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("message_sid", job.message_sid);
      return;
    }
    if (job.sent_at) return;
    throw new Error("send_claim_lost: could not move reply_ready → sending");
  }

  if (!isTwilioReady()) {
    await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        status: "reply_ready",
        next_retry_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error: "twilio_not_configured_reverted_to_reply_ready",
      })
      .eq("message_sid", job.message_sid)
      .eq("status", "sending");
    throw new Error("twilio_not_configured");
  }

  console.log("[sms-inbound-coach] sending sms", job.message_sid);
  const sendResult = await sendSMSChunked({
    to: job.from_phone,
    body: replyBody,
  });

  const sid =
    sendResult.firstSid && sendResult.firstSid.length > 0
      ? sendResult.firstSid
      : null;

  const { error: sidErr } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      outbound_message_sid: sid,
      updated_at: new Date().toISOString(),
    })
    .eq("message_sid", job.message_sid)
    .eq("status", "sending");

  if (sidErr) {
    throw new Error(`outbound_message_sid persist failed: ${sidErr.message}`);
  }

  const { error: finalErr } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("message_sid", job.message_sid)
    .eq("status", "sending");

  if (finalErr) {
    throw new Error(`sent_at finalization failed: ${finalErr.message}`);
  }

  console.log("[sms-inbound-coach] sms sent", job.message_sid, {
    chunkCount: sendResult.chunkCount,
    firstSid: sendResult.firstSid,
  });
}

export async function GET(req: Request) {
  if (!validateCronSecret(req)) {
    console.error("[sms-inbound-coach] unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const stats = {
    ok: true as boolean,
    scanned: 0,
    claimed: 0,
    completed: 0,
    errors: 0,
    repairedPartialSends: 0,
  };

  const nowIso = new Date().toISOString();

  stats.repairedPartialSends = await repairOutboundSidWithoutSentAt();
  await reclaimStaleJobs(nowIso);

  const { data: candidates, error: listErr } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select("*")
    .in("status", ["pending", "failed", "reply_ready"])
    .lte("next_retry_at", nowIso)
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("next_retry_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (listErr) {
    console.error("[sms-inbound-coach] list error", listErr);
    return NextResponse.json(
      { ok: false, error: listErr.message },
      { status: 500 }
    );
  }

  stats.scanned = candidates?.length ?? 0;

  for (const row of candidates ?? []) {
    const job = row as JobRow;

    const { data: claimed } = await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        status: "processing",
        updated_at: new Date().toISOString(),
      })
      .eq("message_sid", job.message_sid)
      .in("status", ["pending", "failed", "reply_ready"])
      .select()
      .maybeSingle();

    if (!claimed) {
      continue;
    }

    stats.claimed += 1;
    const claimedJob = claimed as JobRow;

    try {
      await processJob(claimedJob);
      stats.completed += 1;
    } catch (err) {
      stats.errors += 1;
      const msg =
        err instanceof Error ? err.message : typeof err === "string" ? err : "unknown_error";

      console.error("[sms-inbound-coach] job failed", claimedJob.message_sid, err);

      const nextAttempt = claimedJob.attempt_count + 1;
      const terminal = nextAttempt >= MAX_ATTEMPTS;

      const failState = await loadJob(claimedJob.message_sid);
      const orphanedCoach =
        failState?.status === "generating_reply" &&
        !(failState.reply_body || "").trim();

      if (orphanedCoach) {
        await supabaseServer
          .from("sms_inbound_coach_jobs")
          .update({
            status: "needs_manual_review",
            attempt_count: nextAttempt,
            last_error: `coach_step_failed_or_incomplete_persist (no_auto_retry): ${msg.slice(
              0,
              1700
            )}`,
            next_retry_at: farFutureIso(),
            updated_at: new Date().toISOString(),
          })
          .eq("message_sid", claimedJob.message_sid);
        console.error(
          "[sms-inbound-coach] needs_manual_review orphan generating_reply",
          claimedJob.message_sid
        );
        continue;
      }

      await supabaseServer
        .from("sms_inbound_coach_jobs")
        .update({
          status: terminal ? "needs_manual_review" : "failed",
          attempt_count: nextAttempt,
          last_error: terminal
            ? `max_attempts_exceeded_no_auto_retry (attempts=${nextAttempt}): ${msg.slice(0, 1500)}`
            : msg.slice(0, 2000),
          next_retry_at: terminal
            ? farFutureIso()
            : computeNextRetryIso(nextAttempt),
          updated_at: new Date().toISOString(),
        })
        .eq("message_sid", claimedJob.message_sid);

      if (terminal) {
        console.error(
          "[sms-inbound-coach] needs_manual_review (max attempts)",
          claimedJob.message_sid,
          { attempts: nextAttempt }
        );
      }
    }
  }

  return NextResponse.json(stats);
}
