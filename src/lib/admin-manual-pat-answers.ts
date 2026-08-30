import "server-only";

import { checkInboundCoachSmsEligibility } from "@/lib/account-deletion/inbound-coach-send-eligibility";
import {
  dispositionInboundCoachDeletionSendError,
  isAccountDeletionOutboundSmsError,
} from "@/lib/account-deletion/deletion-guards";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import { buildRecentExactThread72h } from "@/lib/sms-recent-exact-thread-72h";
import { isTwilioReady, sendSMSChunked } from "@/lib/twilio";
import { resolveUserTimezone } from "@/lib/timezone";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { upsertCommitmentSmsThreadMemoryFromOutbound } from "@/lib/v2-commitment-sms-thread-memory";

export const MANUAL_PAT_ANSWER_STATUS = "awaiting_manual_pat_answer";
export const MANUAL_PAT_THREAD_TAIL = 10;
export const SMS_NO_LONGER_ELIGIBLE_ERROR = "SMS is no longer eligible to send.";

export type ManualPatThreadLine = {
  role: "user" | "coach";
  body: string;
  at: string;
  atLocal: string;
};

export type ManualPatAnswerCard = {
  messageSid: string;
  clerkUserId: string;
  preferredName: string | null;
  receivedAt: string;
  question: string;
  replyBody: string;
  thread: ManualPatThreadLine[];
};

type JobRow = {
  message_sid: string;
  clerk_user_id: string;
  from_phone: string;
  raw_body: string;
  status: string;
  reply_body: string | null;
  sent_at: string | null;
  outbound_message_sid: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

const farFutureIso = () =>
  new Date(Date.now() + 86400 * 365 * 10 * 1000).toISOString();

function asJob(row: Record<string, unknown> | null | undefined): JobRow | null {
  if (!row || typeof row.message_sid !== "string" || !row.message_sid.trim()) {
    return null;
  }
  return {
    message_sid: row.message_sid,
    clerk_user_id: typeof row.clerk_user_id === "string" ? row.clerk_user_id : "",
    from_phone: typeof row.from_phone === "string" ? row.from_phone : "",
    raw_body: typeof row.raw_body === "string" ? row.raw_body : "",
    status: typeof row.status === "string" ? row.status : "",
    reply_body: typeof row.reply_body === "string" ? row.reply_body : null,
    sent_at: typeof row.sent_at === "string" ? row.sent_at : null,
    outbound_message_sid:
      typeof row.outbound_message_sid === "string" ? row.outbound_message_sid : null,
    last_error: typeof row.last_error === "string" ? row.last_error : null,
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
  };
}

async function loadJob(messageSid: string): Promise<JobRow | null> {
  const { data } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select(
      "message_sid, clerk_user_id, from_phone, raw_body, status, reply_body, sent_at, outbound_message_sid, last_error, created_at, updated_at"
    )
    .eq("message_sid", messageSid)
    .maybeSingle();
  return asJob((data ?? null) as Record<string, unknown> | null);
}

async function resolveTimezone(clerkUserId: string): Promise<string> {
  try {
    const md = await getClerkPublicMetadata(clerkUserId);
    return resolveUserTimezone(md?.timezone);
  } catch {
    return resolveUserTimezone(null);
  }
}

async function loadThreadTail(clerkUserId: string): Promise<ManualPatThreadLine[]> {
  const timezone = await resolveTimezone(clerkUserId);
  try {
    const result = await buildRecentExactThread72h({
      clerkUserId,
      timezone,
      path: "inbound",
      preserveUserBodyFormatting: true,
    });
    return result.messages
      .filter((m) => m.role === "user" || m.role === "coach")
      .slice(-MANUAL_PAT_THREAD_TAIL)
      .map((m) => ({
        role: m.role === "coach" ? "coach" : "user",
        body: m.body,
        at: m.at,
        atLocal: m.at_local,
      }));
  } catch (err) {
    console.warn("[admin-manual-pat-answers] exact_thread_load_failed", {
      clerk_user_id: clerkUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export async function listManualPatAnswers(): Promise<ManualPatAnswerCard[]> {
  const { data, error } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select(
      "message_sid, clerk_user_id, from_phone, raw_body, status, reply_body, sent_at, outbound_message_sid, last_error, created_at, updated_at"
    )
    .eq("status", MANUAL_PAT_ANSWER_STATUS)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message || "list_failed");
  }

  const jobs = ((data ?? []) as Record<string, unknown>[])
    .map((row) => asJob(row))
    .filter((row): row is JobRow => row != null);

  const clerkIds = [...new Set(jobs.map((j) => j.clerk_user_id).filter(Boolean))];
  const names = new Map<string, string | null>();
  if (clerkIds.length > 0) {
    const { data: profiles } = await supabaseServer
      .from("user_profiles")
      .select("clerk_user_id, preferred_name")
      .in("clerk_user_id", clerkIds);
    for (const p of profiles ?? []) {
      const id = typeof p.clerk_user_id === "string" ? p.clerk_user_id : "";
      if (!id) continue;
      const name = typeof p.preferred_name === "string" ? p.preferred_name.trim() : "";
      names.set(id, name || null);
    }
  }

  const cards: ManualPatAnswerCard[] = [];
  for (const job of jobs) {
    const thread = await loadThreadTail(job.clerk_user_id);
    cards.push({
      messageSid: job.message_sid,
      clerkUserId: job.clerk_user_id,
      preferredName: names.get(job.clerk_user_id) ?? null,
      receivedAt: job.created_at,
      question: job.raw_body,
      replyBody: job.reply_body ?? "",
      thread,
    });
  }
  return cards;
}

export async function saveManualPatDraft(args: {
  messageSid: string;
  replyBody: string;
}): Promise<{ ok: true; replyBody: string } | { ok: false; status: number; error: string }> {
  const messageSid = args.messageSid.trim();
  if (!messageSid) {
    return { ok: false, status: 400, error: "message_sid required" };
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      reply_body: args.replyBody,
      updated_at: nowIso,
    })
    .eq("message_sid", messageSid)
    .eq("status", MANUAL_PAT_ANSWER_STATUS)
    .select("message_sid, reply_body, status")
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: error.message || "save_failed" };
  }
  if (!data?.message_sid) {
    return { ok: false, status: 409, error: "This question is no longer waiting for an answer." };
  }

  return {
    ok: true,
    replyBody: typeof data.reply_body === "string" ? data.reply_body : args.replyBody,
  };
}

async function revertSendingToAwaiting(messageSid: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: MANUAL_PAT_ANSWER_STATUS,
      updated_at: nowIso,
    })
    .eq("message_sid", messageSid)
    .eq("status", "sending");
  if (error) {
    console.error("[admin-manual-pat-answers] revert_to_awaiting_failed", {
      message_sid: messageSid,
      error: error.message,
    });
  }
}

async function cancelJob(messageSid: string, lastError: string): Promise<void> {
  const nowIso = new Date().toISOString();
  await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: "cancelled",
      last_error: lastError,
      next_retry_at: farFutureIso(),
      updated_at: nowIso,
    })
    .eq("message_sid", messageSid);
}

async function persistSent(args: {
  messageSid: string;
  outboundMessageSid: string | null;
  sentAt: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error: sidErr } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      outbound_message_sid: args.outboundMessageSid,
      updated_at: args.sentAt,
    })
    .eq("message_sid", args.messageSid)
    .eq("status", "sending");
  if (sidErr) {
    return { ok: false, error: sidErr.message };
  }

  const { error: finalErr } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: "sent",
      sent_at: args.sentAt,
      updated_at: args.sentAt,
      last_error: null,
    })
    .eq("message_sid", args.messageSid)
    .eq("status", "sending");
  if (finalErr) {
    return { ok: false, error: finalErr.message };
  }
  return { ok: true };
}

/**
 * Operator send for a parked manual Pat answer.
 * CAS awaiting_manual_pat_answer → sending. Never uses reply_ready.
 */
export async function sendManualPatCoachReply(messageSid: string): Promise<
  | { ok: true; outboundMessageSid: string | null; sentAt: string; bodySent: string }
  | { ok: false; status: number; error: string }
> {
  const sid = messageSid.trim();
  if (!sid) {
    return { ok: false, status: 400, error: "message_sid required" };
  }

  const job = await loadJob(sid);
  if (!job) {
    return { ok: false, status: 404, error: "Job not found." };
  }
  if (job.status !== MANUAL_PAT_ANSWER_STATUS) {
    return { ok: false, status: 409, error: "This question is no longer waiting for an answer." };
  }

  const draft = (job.reply_body || "").trim();
  if (!draft) {
    return { ok: false, status: 400, error: "Answer is empty." };
  }

  const nowIso = new Date().toISOString();
  const { data: claimed } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: "sending",
      updated_at: nowIso,
    })
    .eq("message_sid", sid)
    .eq("status", MANUAL_PAT_ANSWER_STATUS)
    .select()
    .maybeSingle();

  if (!claimed) {
    return { ok: false, status: 409, error: "This question is no longer waiting for an answer." };
  }

  const latest = (await loadJob(sid)) ?? asJob(claimed as Record<string, unknown>);
  if (!latest) {
    await revertSendingToAwaiting(sid);
    return { ok: false, status: 500, error: "Could not reload job after claim." };
  }

  const bodyToSend = (latest.reply_body || "").trim() || draft;
  const userId = latest.clerk_user_id;
  const toPhone = latest.from_phone;

  const eligibility = await checkInboundCoachSmsEligibility({
    clerkUserId: userId,
    destinationPhone: toPhone,
    messageSid: sid,
    expectedJobStatuses: ["sending"],
  });
  if (!eligibility.ok) {
    await cancelJob(sid, eligibility.lastErrorCode);
    return { ok: false, status: 409, error: SMS_NO_LONGER_ELIGIBLE_ERROR };
  }

  if (!isTwilioReady()) {
    await revertSendingToAwaiting(sid);
    return { ok: false, status: 503, error: "SMS is not configured." };
  }

  let firstSid: string | null = null;
  try {
    const sendResult = await sendSMSChunked({
      to: toPhone,
      body: bodyToSend,
      lastOutbound: {
        clerkUserId: userId,
        messageKind: "coach",
      },
    });
    firstSid =
      sendResult.firstSid && sendResult.firstSid.length > 0 ? sendResult.firstSid : null;
  } catch (sendErr) {
    if (isAccountDeletionOutboundSmsError(sendErr)) {
      const disposition = dispositionInboundCoachDeletionSendError(sendErr);
      if (disposition.action === "terminal_cancel") {
        await cancelJob(sid, disposition.lastError);
        return { ok: false, status: 409, error: SMS_NO_LONGER_ELIGIBLE_ERROR };
      }
    }
    await revertSendingToAwaiting(sid);
    return {
      ok: false,
      status: 502,
      error: sendErr instanceof Error ? sendErr.message : "Send failed.",
    };
  }

  if (!firstSid) {
    await revertSendingToAwaiting(sid);
    return { ok: false, status: 502, error: "Send failed." };
  }

  const sentAt = new Date().toISOString();
  const persisted = await persistSent({
    messageSid: sid,
    outboundMessageSid: firstSid,
    sentAt,
  });
  if (!persisted.ok) {
    console.error("[admin-manual-pat-answers] sent_persist_failed_after_twilio", {
      message_sid: sid,
      error: persisted.error,
    });
    return { ok: false, status: 502, error: "Sent, but could not record delivery. Do not retry yet." };
  }

  try {
    const commitment = await getActiveCommitment(userId);
    if (commitment?.id) {
      const mem = await upsertCommitmentSmsThreadMemoryFromOutbound({
        commitmentId: commitment.id,
        clerkUserId: userId,
        sentBody: bodyToSend,
        sentAt: new Date(sentAt),
        messageSid: firstSid,
        source: "inbound_coach_reply",
      });
      if (!mem.ok) {
        console.warn("[admin-manual-pat-answers] thread_memory_upsert_failed", {
          message_sid: sid,
          error: mem.error,
        });
      }
    }
  } catch (err) {
    console.warn("[admin-manual-pat-answers] thread_memory_upsert_failed", {
      message_sid: sid,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    ok: true,
    outboundMessageSid: firstSid,
    sentAt,
    bodySent: bodyToSend,
  };
}
