import "server-only";

import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { applyCanonicalSmsStop } from "@/lib/sms-canonical-stop";
import { buildRecentExactThread72h } from "@/lib/sms-recent-exact-thread-72h";
import {
  AWAITING_SMS_OPT_OUT_REVIEW_STATUS,
} from "@/lib/sms-opt-out-review-hold";
import { supabaseServer } from "@/lib/supabase-server";
import { resolveUserTimezone } from "@/lib/timezone";
import {
  fetchV2UserSmsCommsPreferences,
  isPauseActive,
} from "@/lib/v2-sms-comms-preferences";

/** Resolved by Tyler STOP TEXTS or by exact keyword STOP. Not worker-claimable. */
export const SMS_OPT_OUT_REVIEW_STOPPED_STATUS = "sms_opt_out_review_stopped";

/** Resolved by Tyler KEEP TEXTS ON. Consent was not changed. Not worker-claimable. */
export const SMS_OPT_OUT_REVIEW_KEPT_STATUS = "sms_opt_out_review_kept";

/** Resolved because the member sent exact START. Not worker-claimable. */
export const SMS_OPT_OUT_REVIEW_MEMBER_STARTED_STATUS = "sms_opt_out_review_member_started";

export const SMS_OPT_OUT_REVIEW_THREAD_TAIL = 12;

const EXACT_STOP_WORDS = ["stop", "unsubscribe", "cancel", "end"];
const EXACT_START_WORDS = ["start", "unstop"];

export type SmsOptOutReviewThreadLine = {
  role: "user" | "coach";
  body: string;
  at: string;
  atLocal: string;
};

export type SmsOptOutReviewCard = {
  messageSid: string;
  clerkUserId: string;
  memberName: string;
  receivedAt: string;
  triggeringText: string;
  thread: SmsOptOutReviewThreadLine[];
  latestInboundAt: string;
  textsAlreadyStopped: boolean;
  stopIncomplete: boolean;
  pauseStillActive: boolean;
  cadenceStillSet: boolean;
  laterInbound: boolean;
  exactStopAfterRequest: boolean;
  exactStartAfterRequest: boolean;
};

export type SmsOptOutReviewActionResult =
  | {
      ok: true;
      outcome: "kept" | "stopped" | "already_resolved" | "texts_already_stopped";
    }
  | {
      ok: false;
      status: number;
      error: string;
      outcome: "stale_thread" | "not_open" | "stop_not_verified" | "stop_failed";
      card?: SmsOptOutReviewCard;
    };

type JobRow = {
  message_sid: string;
  clerk_user_id: string;
  from_phone: string;
  raw_body: string;
  status: string;
  created_at: string;
};

function normalizeCommand(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function isExactStopWord(text: string): boolean {
  return EXACT_STOP_WORDS.includes(normalizeCommand(text));
}

function isExactStartWord(text: string): boolean {
  return EXACT_START_WORDS.includes(normalizeCommand(text));
}

function asJob(row: Record<string, unknown> | null | undefined): JobRow | null {
  if (!row || typeof row.message_sid !== "string" || !row.message_sid.trim()) return null;
  return {
    message_sid: row.message_sid,
    clerk_user_id: typeof row.clerk_user_id === "string" ? row.clerk_user_id : "",
    from_phone: typeof row.from_phone === "string" ? row.from_phone : "",
    raw_body: typeof row.raw_body === "string" ? row.raw_body : "",
    status: typeof row.status === "string" ? row.status : "",
    created_at: typeof row.created_at === "string" ? row.created_at : "",
  };
}

async function loadJob(messageSid: string): Promise<JobRow | null> {
  const { data, error } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select("message_sid, clerk_user_id, from_phone, raw_body, status, created_at")
    .eq("message_sid", messageSid)
    .maybeSingle();
  if (error) throw new Error(error.message || "review_load_failed");
  return asJob((data ?? null) as Record<string, unknown> | null);
}

function rowIsStopped(row: { sms_enabled?: unknown; stopped_at?: unknown } | null): boolean {
  return (
    row?.sms_enabled === false &&
    typeof row.stopped_at === "string" &&
    row.stopped_at.trim().length > 0
  );
}

function rowIsOn(row: { sms_enabled?: unknown; stopped_at?: unknown } | null): boolean {
  return row?.sms_enabled === true && (row.stopped_at == null || row.stopped_at === "");
}

export async function readCanonicalSmsStopState(args: {
  clerkUserId: string;
  phoneNumber: string;
}): Promise<"on" | "stopped" | "partial" | "unknown"> {
  const phone = args.phoneNumber.trim();
  const clerkUserId = args.clerkUserId.trim();
  if (!phone || !clerkUserId) return "unknown";

  const [identityRes, audienceRes] = await Promise.all([
    supabaseServer
      .from("sms_identities")
      .select("sms_enabled, stopped_at")
      .eq("phone_number", phone)
      .maybeSingle(),
    supabaseServer
      .from("sms_audience")
      .select("sms_enabled, stopped_at")
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle(),
  ]);

  if (identityRes.error || audienceRes.error) return "unknown";

  const identity = identityRes.data as { sms_enabled?: unknown; stopped_at?: unknown } | null;
  const audience = audienceRes.data as { sms_enabled?: unknown; stopped_at?: unknown } | null;
  const identityStopped = rowIsStopped(identity);
  const audienceStopped = rowIsStopped(audience);
  if (identityStopped && audienceStopped) return "stopped";
  if (rowIsOn(identity) && rowIsOn(audience)) return "on";
  return "partial";
}

async function loadThread(clerkUserId: string): Promise<SmsOptOutReviewThreadLine[]> {
  let timezone = "America/New_York";
  try {
    const md = await getClerkPublicMetadata(clerkUserId);
    timezone = resolveUserTimezone(md?.timezone);
  } catch {
    timezone = resolveUserTimezone(null);
  }
  try {
    const result = await buildRecentExactThread72h({
      clerkUserId,
      timezone,
      path: "inbound",
      preserveUserBodyFormatting: true,
    });
    return result.messages
      .filter((m) => m.role === "user" || m.role === "coach")
      .slice(-SMS_OPT_OUT_REVIEW_THREAD_TAIL)
      .map((m) => ({
        role: m.role === "coach" ? "coach" : "user",
        body: m.body,
        at: m.at,
        atLocal: m.at_local,
      }));
  } catch (err) {
    console.warn("[sms-opt-out-review] thread_load_failed", {
      clerk_user_id: clerkUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

function latestInboundAt(thread: SmsOptOutReviewThreadLine[], fallback: string): string {
  const userLines = thread.filter((line) => line.role === "user" && line.at);
  const last = userLines[userLines.length - 1];
  return last?.at || fallback;
}

function happenedAfter(at: string, receivedAt: string): boolean {
  const left = new Date(at).getTime();
  const right = new Date(receivedAt).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return left > right;
}

async function loadNames(clerkIds: string[]): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  if (clerkIds.length === 0) return names;
  const { data } = await supabaseServer
    .from("user_profiles")
    .select("clerk_user_id, preferred_name")
    .in("clerk_user_id", clerkIds);
  for (const p of data ?? []) {
    const id = typeof p.clerk_user_id === "string" ? p.clerk_user_id : "";
    if (!id) continue;
    const name = typeof p.preferred_name === "string" ? p.preferred_name.trim() : "";
    names.set(id, name || null);
  }
  return names;
}

async function cardFromJob(
  job: JobRow,
  names: Map<string, string | null>
): Promise<SmsOptOutReviewCard> {
  const [thread, stopState, prefs] = await Promise.all([
    loadThread(job.clerk_user_id),
    readCanonicalSmsStopState({
      clerkUserId: job.clerk_user_id,
      phoneNumber: job.from_phone,
    }),
    fetchV2UserSmsCommsPreferences(job.clerk_user_id).catch(() => null),
  ]);
  const laterUserLines = thread.filter(
    (line) => line.role === "user" && happenedAfter(line.at, job.created_at)
  );
  return {
    messageSid: job.message_sid,
    clerkUserId: job.clerk_user_id,
    memberName: names.get(job.clerk_user_id)?.trim() || "Unnamed member",
    receivedAt: job.created_at,
    triggeringText: job.raw_body,
    thread,
    latestInboundAt: latestInboundAt(thread, job.created_at),
    textsAlreadyStopped: stopState === "stopped",
    stopIncomplete: stopState === "partial" || stopState === "unknown",
    pauseStillActive: isPauseActive(prefs),
    cadenceStillSet: Boolean(prefs?.cadence_override),
    laterInbound: laterUserLines.length > 0,
    exactStopAfterRequest: laterUserLines.some((line) => isExactStopWord(line.body)),
    exactStartAfterRequest: laterUserLines.some((line) => isExactStartWord(line.body)),
  };
}

export async function listOpenSmsOptOutReviews(): Promise<SmsOptOutReviewCard[]> {
  const { data, error } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select("message_sid, clerk_user_id, from_phone, raw_body, status, created_at")
    .eq("status", AWAITING_SMS_OPT_OUT_REVIEW_STATUS)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message || "list_failed");

  const jobs = ((data ?? []) as Record<string, unknown>[])
    .map((row) => asJob(row))
    .filter((row): row is JobRow => row != null);

  const names = await loadNames([...new Set(jobs.map((j) => j.clerk_user_id).filter(Boolean))]);
  const cards: SmsOptOutReviewCard[] = [];
  for (const job of jobs) {
    cards.push(await cardFromJob(job, names));
  }
  return cards;
}

async function closeReview(args: {
  messageSid: string;
  status: string;
  tag: string;
}): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: args.status,
      updated_at: now,
      last_error: JSON.stringify({ tag: args.tag }).slice(0, 1900),
    })
    .eq("message_sid", args.messageSid)
    .eq("status", AWAITING_SMS_OPT_OUT_REVIEW_STATUS)
    .select("message_sid")
    .maybeSingle();

  if (error) {
    console.warn("[sms-opt-out-review] close_failed", {
      message_sid: args.messageSid,
      error: error.message,
    });
    return false;
  }
  return typeof data?.message_sid === "string" && data.message_sid.length > 0;
}

async function closeAllOpenReviewsForMember(args: {
  clerkUserId: string;
  status: string;
  tag: string;
}): Promise<void> {
  const clerkUserId = args.clerkUserId.trim();
  if (!clerkUserId) return;
  try {
    const now = new Date().toISOString();
    const { error } = await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        status: args.status,
        updated_at: now,
        last_error: JSON.stringify({ tag: args.tag }).slice(0, 1900),
      })
      .eq("clerk_user_id", clerkUserId)
      .eq("status", AWAITING_SMS_OPT_OUT_REVIEW_STATUS);
    if (error) {
      console.warn("[sms-opt-out-review] member_close_failed", {
        clerk_user_id: clerkUserId,
        error: error.message,
      });
    }
  } catch (err) {
    console.warn("[sms-opt-out-review] member_close_failed", {
      clerk_user_id: clerkUserId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** After exact STOP has already succeeded. Does not stop anyone itself. Never throws. */
export async function closeOpenSmsOptOutReviewsAfterMemberStop(
  clerkUserId: string
): Promise<void> {
  await closeAllOpenReviewsForMember({
    clerkUserId,
    status: SMS_OPT_OUT_REVIEW_STOPPED_STATUS,
    tag: "sms_opt_out_review_stopped_by_exact_stop",
  });
}

/** After exact START has already succeeded. Does not change consent. Never throws. */
export async function closeOpenSmsOptOutReviewsAfterMemberStart(
  clerkUserId: string
): Promise<void> {
  await closeAllOpenReviewsForMember({
    clerkUserId,
    status: SMS_OPT_OUT_REVIEW_MEMBER_STARTED_STATUS,
    tag: "sms_opt_out_review_resolved_by_exact_start",
  });
}

export async function keepSmsOptOutReviewTextsOn(args: {
  messageSid: string;
  latestInboundAt: string;
}): Promise<SmsOptOutReviewActionResult> {
  const messageSid = args.messageSid.trim();
  const seenAt = args.latestInboundAt.trim();
  if (!messageSid || !seenAt) {
    return { ok: false, status: 400, error: "This review could not be read.", outcome: "not_open" };
  }

  const job = await loadJob(messageSid);
  if (!job || job.status !== AWAITING_SMS_OPT_OUT_REVIEW_STATUS) {
    return {
      ok: true,
      outcome: "already_resolved",
    };
  }

  const card = await cardFromJob(job, await loadNames([job.clerk_user_id]));
  if (card.latestInboundAt !== seenAt) {
    return {
      ok: false,
      status: 409,
      error: "The conversation changed. Look again before deciding.",
      outcome: "stale_thread",
      card,
    };
  }

  if (card.stopIncomplete) {
    return {
      ok: false,
      status: 409,
      error: "Stopping texts did not finish. Press STOP TEXTS.",
      outcome: "stop_not_verified",
    };
  }

  if (card.textsAlreadyStopped) {
    const closed = await closeReview({
      messageSid,
      status: SMS_OPT_OUT_REVIEW_STOPPED_STATUS,
      tag: "sms_opt_out_review_stopped_already",
    });
    if (!closed) {
      return {
        ok: false,
        status: 409,
        error: "Texts are already stopped. This review is still open.",
        outcome: "not_open",
      };
    }
    return { ok: true, outcome: "texts_already_stopped" };
  }

  const closed = await closeReview({
    messageSid,
    status: SMS_OPT_OUT_REVIEW_KEPT_STATUS,
    tag: "sms_opt_out_review_kept",
  });
  if (!closed) {
    return {
      ok: true,
      outcome: "already_resolved",
    };
  }
  return { ok: true, outcome: "kept" };
}

export async function stopSmsOptOutReviewTexts(args: {
  messageSid: string;
  latestInboundAt: string;
}): Promise<SmsOptOutReviewActionResult> {
  const messageSid = args.messageSid.trim();
  const seenAt = args.latestInboundAt.trim();
  if (!messageSid || !seenAt) {
    return { ok: false, status: 400, error: "This review could not be read.", outcome: "not_open" };
  }

  const job = await loadJob(messageSid);
  if (!job || job.status !== AWAITING_SMS_OPT_OUT_REVIEW_STATUS) {
    return { ok: true, outcome: "already_resolved" };
  }

  const card = await cardFromJob(job, await loadNames([job.clerk_user_id]));
  if (card.latestInboundAt !== seenAt) {
    return {
      ok: false,
      status: 409,
      error: "The conversation changed. Look again before deciding.",
      outcome: "stale_thread",
      card,
    };
  }

  if (!card.textsAlreadyStopped) {
    try {
      await applyCanonicalSmsStop({
        userId: job.clerk_user_id,
        phoneNumber: job.from_phone,
      });
    } catch (err) {
      console.warn("[sms-opt-out-review] canonical_stop_failed", {
        message_sid: messageSid,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        status: 500,
        error: "Texts could not be stopped. This review is still open.",
        outcome: "stop_failed",
      };
    }

    const verified = await readCanonicalSmsStopState({
      clerkUserId: job.clerk_user_id,
      phoneNumber: job.from_phone,
    });
    if (verified !== "stopped") {
      return {
        ok: false,
        status: 500,
        error: "Texts could not be confirmed stopped. This review is still open.",
        outcome: "stop_not_verified",
      };
    }
  }

  const closed = await closeReview({
    messageSid,
    status: SMS_OPT_OUT_REVIEW_STOPPED_STATUS,
    tag: "sms_opt_out_review_stopped",
  });
  if (!closed) {
    return { ok: true, outcome: "stopped" };
  }
  return { ok: true, outcome: "stopped" };
}
