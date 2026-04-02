import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { completeDay } from "@/lib/complete-day";
import { getOrCreateDailyPracticeVersion } from "@/lib/get-or-create-daily-practice-version";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";
import { coachEngine } from "@/lib/coach-engine";
import type { SmsCoachDeliveryContext } from "@/lib/coach-reply-generator";
import { normalizeSmsReply } from "@/lib/normalize-sms-reply";
import {
  smsTimePreferenceFromClerkMetadata,
  useEveningPromptForPreference,
} from "@/lib/sms-daily-delivery-body";
import { reconcileSmsDeliveryStateAfterCompletion } from "@/lib/sms-delivery-on-complete";
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

/** Matches completeDay journal normalization so verification aligns with completion gate. */
function normalizeJournalTextForCompletion(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

function getCompletionConfirmation(dayNumber: number): string {
  const options = [
    "You showed up today.",
    "That matters.",
    "Strong finish today.",
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

function isStrongMCQReply(
  textNormalized: string,
  qRow: {
    option_a: string | null;
    option_b: string | null;
    option_c: string | null;
  } | null
): boolean {
  if (!qRow) return false;

  const text = textNormalized.toLowerCase();

  const letterMatch =
    text === "a" ||
    text === "b" ||
    text === "c" ||
    text === "a!" ||
    text === "b!" ||
    text === "c!" ||
    /^[abc]\s/.test(text);

  const MIN_LENGTH = 3;

  const options = [qRow.option_a, qRow.option_b, qRow.option_c]
    .filter(Boolean)
    .map((o) => String(o).toLowerCase());

  const optionMatch = options.some((opt) => {
    if (!opt) return false;
    if (text.length < MIN_LENGTH) return false;

    return text.includes(opt) || opt.includes(text);
  });

  return letterMatch || optionMatch;
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

  const { data: smsDeliveryState } = await supabaseServer
    .from("sms_delivery_state")
    .select(
      "clerk_user_id, question_position, quote_position, current_content_type, question_attempt_count, daily_nonresponse_cycle_count, sms_bucket, onboarding_step"
    )
    .eq("clerk_user_id", userId)
    .maybeSingle();

  const { data: lastOutboundFetched, error: lastOutboundError } =
    await supabaseServer
      .from("sms_last_outbound_context")
      .select("*")
      .eq("clerk_user_id", userId)
      .maybeSingle();

  let lastOutboundContext = lastOutboundFetched ?? null;

  if (lastOutboundError) {
    console.error(
      "[sms-inbound-coach] sms_last_outbound_context read failed",
      {
        clerk_user_id: userId,
        error: lastOutboundError.message,
      }
    );
  }

  const isOnboardingActive =
    typeof smsDeliveryState?.onboarding_step === "number" &&
    smsDeliveryState.onboarding_step < 6;

  const deliverySnap = lastOutboundContext?.delivery_snapshot;
  const isValidOnboardingContext =
    deliverySnap !== null &&
    typeof deliverySnap === "object" &&
    !Array.isArray(deliverySnap) &&
    (deliverySnap as Record<string, unknown>).is_onboarding === true;

  if (isOnboardingActive && !isValidOnboardingContext) {
    lastOutboundContext = null;
  }

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

  const RECENT_COACH_WINDOW_MINUTES = 60;

  const { data: lastCoachRow } = await supabaseServer
    .from("coach_conversations")
    .select("created_at")
    .eq("clerk_user_id", userId)
    .eq("day_number", dayForThread)
    .eq("role", "coach")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastCoachAt =
    lastCoachRow?.created_at != null
      ? String(lastCoachRow.created_at)
      : null;

  let recentCoachInteraction = false;
  if (lastCoachAt) {
    const lastMs = new Date(lastCoachAt).getTime();
    if (Number.isFinite(lastMs)) {
      const ageMs = Date.now() - lastMs;
      recentCoachInteraction =
        ageMs >= 0 && ageMs <= RECENT_COACH_WINDOW_MINUTES * 60_000;
    }
  }

  console.log({
    event: "sms_inbound_recent_coach_check",
    recentCoachInteraction,
    lastCoachAt,
  });

  /** Trim + single-space collapse; does not extract MCQ letters (for short_text / open_text). */
  const textNormalized = (job.raw_body || "").trim().replace(/\s+/g, " ");
  const normalizedForMcq = normalizeSmsReply(job.raw_body);

  let interpreted_meaning_for_journal: string | null = null;
  let smsDeliveryContext: SmsCoachDeliveryContext | undefined;

  let qRow: {
    prompt_morning: string;
    prompt_evening: string;
    response_type: string;
    option_a: string | null;
    option_b: string | null;
    option_c: string | null;
  } | null = null;

  if (!alreadyCompleted) {
    const questionPosition =
      lastOutboundContext?.question_position ??
      smsDeliveryState?.question_position;
    if (typeof questionPosition === "number" && Number.isFinite(questionPosition)) {
      const { data } = await supabaseServer
        .from("respond_day_questions")
        .select(
          "position, prompt_morning, prompt_evening, response_type, option_a, option_b, option_c"
        )
        .eq("position", questionPosition)
        .eq("active", true)
        .maybeSingle();
      qRow = data ?? null;
    }
  }

  let interpretMode: "question" | "non_question" = "non_question";

  if (alreadyCompleted) {
    interpretMode = "non_question";
  } else if (lastOutboundContext?.message_kind === "quote") {
    interpretMode = "non_question";
  } else if (
    smsDeliveryState?.current_content_type === "respond" &&
    isStrongMCQReply(textNormalized, qRow)
  ) {
    interpretMode = "question";
  } else if (recentCoachInteraction) {
    interpretMode = "non_question";
  } else {
    interpretMode =
      lastOutboundContext?.message_kind === "question"
        ? "question"
        : lastOutboundContext?.message_kind
          ? "non_question"
          : smsDeliveryState?.current_content_type === "respond"
            ? "question"
            : "non_question";
  }

  console.log({
    event: "sms_inbound_routing_decision",
    interpretMode,
    alreadyCompleted,
    recentCoachInteraction,
    lastMessageKind: lastOutboundContext?.message_kind,
    currentContentType: smsDeliveryState?.current_content_type,
  });

  const isRespondMcq =
    interpretMode === "question" && qRow?.response_type === "multiple_choice";

  const normUpper = normalizedForMcq.trim().toUpperCase();
  const looksLikeMcqLetterOnly =
    normUpper.length === 1 && /^[A-D]$/.test(normUpper);
  /** Letter A–D counts as MCQ only when the active question is multiple_choice. */
  const isMcqLetter = isRespondMcq && looksLikeMcqLetterOnly;

  if (interpretMode === "question" && qRow) {
    let evening: boolean;
    if (lastOutboundContext?.time_of_day === "evening") {
      evening = true;
    } else if (lastOutboundContext?.time_of_day === "morning") {
      evening = false;
    } else {
      const pref = smsTimePreferenceFromClerkMetadata(md as Record<string, unknown>);
      evening = useEveningPromptForPreference(pref);
    }
    let questionText = (
      evening ? qRow.prompt_evening : qRow.prompt_morning
    ).trim();
    if (
      lastOutboundContext?.message_kind === "question" &&
      typeof lastOutboundContext.full_body === "string" &&
      lastOutboundContext.full_body.trim().length > 0
    ) {
      questionText = lastOutboundContext.full_body.trim();
    }
    const choices: SmsCoachDeliveryContext["choices"] = {
      A: (qRow.option_a ?? "").trim(),
      B: (qRow.option_b ?? "").trim(),
      C: (qRow.option_c ?? "").trim(),
    };

    let interpreted_meaning: string | null = null;
    if (isRespondMcq) {
      if (normUpper === "A" && choices.A) interpreted_meaning = choices.A;
      else if (normUpper === "B" && choices.B) interpreted_meaning = choices.B;
      else if (normUpper === "C" && choices.C) interpreted_meaning = choices.C;
    }

    if (isRespondMcq && interpreted_meaning === null) {
      const hay = textNormalized.toLowerCase();
      if (hay.length > 0) {
        const ordered: readonly (keyof typeof choices)[] = ["A", "B", "C"];
        for (const key of ordered) {
          const opt = choices[key];
          if (!opt) continue;
          if (hay === opt.toLowerCase()) {
            interpreted_meaning = opt;
            break;
          }
        }
        if (interpreted_meaning === null) {
          for (const key of ordered) {
            const opt = choices[key];
            if (!opt) continue;
            const needle = opt.toLowerCase();
            if (needle.length > 0 && hay.includes(needle)) {
              interpreted_meaning = opt;
              break;
            }
          }
        }
      }
    }

    interpreted_meaning_for_journal = interpreted_meaning;

    smsDeliveryContext = {
      question_text: questionText,
      question_type: String(qRow.response_type ?? "multiple_choice"),
      choices,
      normalized_reply: isRespondMcq ? normalizedForMcq.trim() : textNormalized,
      raw_reply: (job.raw_body || "").trim(),
      interpreted_meaning,
    };
  }

  let processedMessage: string;
  if (isMcqLetter) {
    processedMessage =
      interpreted_meaning_for_journal ?? normUpper;
  } else if (looksLikeMcqLetterOnly && interpretMode !== "question") {
    /* Non-respond days: lone A–D stays literal (matches prior MCQ-letter branch). */
    processedMessage = normUpper;
  } else if (
    interpretMode === "question" &&
    qRow &&
    qRow.response_type !== "multiple_choice"
  ) {
    processedMessage = textNormalized;
  } else {
    processedMessage = translateSmsReply(normalizedForMcq, dayForThread);
  }

  let didCompleteToday = false;

  if (!alreadyCompleted) {
    console.log("[sms-inbound-coach] completion start", job.message_sid);
    const version = await getOrCreateDailyPracticeVersion({
      userId,
      dayNumber: dayForThread,
    });

    const { error: journalUpsertError } = await supabaseServer
      .from("journal_entries")
      .upsert(
        {
          clerk_user_id: userId,
          day_number: dayForThread,
          content: processedMessage,
          action_item: version.actionItem,
          reflection_prompt: version.reflectionPrompt,
          source: "sms",
          time_of_day: lastOutboundContext?.time_of_day ?? null,
        },
        { onConflict: "clerk_user_id,day_number" }
      );

    if (journalUpsertError) {
      throw new Error(
        `journal_upsert_failed: ${journalUpsertError.message || String(journalUpsertError)}`
      );
    }

    const { data: journalVerifyRow, error: journalVerifyError } =
      await supabaseServer
        .from("journal_entries")
        .select("content")
        .eq("clerk_user_id", userId)
        .eq("day_number", dayForThread)
        .maybeSingle();

    if (journalVerifyError) {
      throw new Error(
        `journal_verify_read_failed: ${journalVerifyError.message || String(journalVerifyError)}`
      );
    }

    const verifiedJournal = normalizeJournalTextForCompletion(
      journalVerifyRow?.content ?? ""
    );
    if (!verifiedJournal) {
      throw new Error("journal_verify_empty_after_upsert");
    }

    const completionResult = await completeDay({
      userId,
      source: "sms",
    });

    if (completionResult.ok) {
      didCompleteToday = true;

      const reconcileResult =
        await reconcileSmsDeliveryStateAfterCompletion(userId);
      if (!reconcileResult.ok) {
        console.error(
          "[sms-inbound-coach] sms_delivery_state reconcile failed after completeDay",
          {
            message_sid: job.message_sid,
            clerk_user_id: userId,
            error: reconcileResult.error,
          }
        );
      }
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
        let coachMessageKind = lastOutboundContext?.message_kind;
        if (interpretMode === "question") {
          coachMessageKind = "question";
        }

        const coachResult = await coachEngine({
          userId,
          dayNumber: dayForThread,
          userMessage: processedMessage,
          source: "sms",
          smsDeliveryContext,
          coachSmsMessageKind: coachMessageKind,
          coachSmsTimeOfDay: lastOutboundContext?.time_of_day ?? undefined,
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
    lastOutbound: {
      clerkUserId: userId,
      messageKind: "coach",
    },
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
