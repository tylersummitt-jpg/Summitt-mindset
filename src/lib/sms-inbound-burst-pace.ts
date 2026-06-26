import { supabaseServer } from "@/lib/supabase-server";

/** Quiet window before normal coach inbound jobs become worker-eligible. */
export const INBOUND_BURST_QUIET_MS = 45_000;

/** Same-user pending merge window at process time (see sms-inbound-split-coalesce). */
export const INBOUND_BURST_COALESCE_WINDOW_MS = 120_000;

export const INBOUND_COACH_IN_FLIGHT_STATUSES = [
  "processing",
  "generating_reply",
  "reply_ready",
  "sending",
] as const;

export function computeInboundBurstQuietRetryAt(nowMs = Date.now()): string {
  return new Date(nowMs + INBOUND_BURST_QUIET_MS).toISOString();
}

export function formatInboundBurstQuietDeferredLastError(args: {
  windowMs: number;
  deferredAt: string;
  deferredByMessageSid: string;
}): string {
  return `inbound_burst_quiet_deferred|w=${args.windowMs}|at=${args.deferredAt}|by=${args.deferredByMessageSid}`;
}

export function formatInboundUserInFlightDeferredLastError(args: {
  deferredAt: string;
  blockingMessageSid: string;
}): string {
  return `inbound_user_in_flight_deferred|at=${args.deferredAt}|by=${args.blockingMessageSid}`;
}

export function formatInboundNewerPendingDeferredLastError(args: {
  deferredAt: string;
  deferredByMessageSid: string;
}): string {
  return `inbound_burst_newer_pending_deferred|at=${args.deferredAt}|by=${args.deferredByMessageSid}`;
}

/**
 * Enqueue a normal coach job with burst quiet window and slide sibling pending jobs.
 * Idempotent on message_sid (PK / 23505).
 */
export async function enqueueNormalCoachJobWithBurstQuiet(args: {
  messageSid: string;
  clerkUserId: string;
  fromPhone: string;
  rawBody: string;
  nowMs?: number;
}): Promise<void> {
  const nowMs = args.nowMs ?? Date.now();
  const deferredAt = new Date(nowMs).toISOString();
  const nextRetryAt = computeInboundBurstQuietRetryAt(nowMs);
  const lastError = formatInboundBurstQuietDeferredLastError({
    windowMs: INBOUND_BURST_QUIET_MS,
    deferredAt,
    deferredByMessageSid: args.messageSid,
  });

  const row = {
    message_sid: args.messageSid,
    clerk_user_id: args.clerkUserId,
    from_phone: args.fromPhone,
    raw_body: args.rawBody,
    next_retry_at: nextRetryAt,
    last_error: lastError,
  };

  const jobRowExists = async (): Promise<boolean> => {
    const { data } = await supabaseServer
      .from("sms_inbound_coach_jobs")
      .select("message_sid")
      .eq("message_sid", args.messageSid)
      .maybeSingle();
    return Boolean(data?.message_sid);
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabaseServer.from("sms_inbound_coach_jobs").insert(row);
    if (!error) break;
    const code = (error as { code?: string })?.code;
    if (code === "23505") break;
    if (attempt === 1) throw error;
  }

  if (!(await jobRowExists())) {
    const { error } = await supabaseServer.from("sms_inbound_coach_jobs").insert(row);
    if (error) {
      const code = (error as { code?: string })?.code;
      if (code !== "23505") throw error;
    }
  }

  if (!(await jobRowExists())) {
    throw new Error("sms_inbound_coach_jobs_missing_after_enqueue_and_verify");
  }

  await slidePendingBurstJobsForUser({
    clerkUserId: args.clerkUserId,
    deferredByMessageSid: args.messageSid,
    nowMs,
  });
}

/** Slide same-user pending jobs in the burst window — extends quiet period for fragments. */
export async function slidePendingBurstJobsForUser(args: {
  clerkUserId: string;
  deferredByMessageSid: string;
  nowMs?: number;
}): Promise<number> {
  const nowMs = args.nowMs ?? Date.now();
  const nextRetryAt = computeInboundBurstQuietRetryAt(nowMs);
  const deferredAt = new Date(nowMs).toISOString();
  const windowStartIso = new Date(nowMs - INBOUND_BURST_QUIET_MS).toISOString();
  const lastError = formatInboundBurstQuietDeferredLastError({
    windowMs: INBOUND_BURST_QUIET_MS,
    deferredAt,
    deferredByMessageSid: args.deferredByMessageSid,
  });

  const { data, error } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      next_retry_at: nextRetryAt,
      last_error: lastError,
      updated_at: deferredAt,
    })
    .eq("clerk_user_id", args.clerkUserId)
    .eq("status", "pending")
    .neq("message_sid", args.deferredByMessageSid)
    .gte("created_at", windowStartIso)
    .select("message_sid");

  if (error) {
    console.warn("[sms-inbound-burst] slide pending failed", {
      clerk_user_id: args.clerkUserId,
      error: error.message,
    });
    return 0;
  }

  return data?.length ?? 0;
}

export async function findUserInFlightCoachJobMessageSid(
  clerkUserId: string,
  excludeMessageSid: string
): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select("message_sid")
    .eq("clerk_user_id", clerkUserId)
    .in("status", [...INBOUND_COACH_IN_FLIGHT_STATUSES])
    .neq("message_sid", excludeMessageSid)
    .is("sent_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[sms-inbound-burst] in-flight lookup failed", {
      clerk_user_id: clerkUserId,
      error: error.message,
    });
    return null;
  }

  return typeof data?.message_sid === "string" ? data.message_sid : null;
}

export async function findNewerReadyPendingCoachJobMessageSid(args: {
  clerkUserId: string;
  messageSid: string;
  createdAt: string;
  nowIso: string;
}): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select("message_sid")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("status", "pending")
    .neq("message_sid", args.messageSid)
    .gt("created_at", args.createdAt)
    .lte("next_retry_at", args.nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[sms-inbound-burst] newer-ready lookup failed", {
      clerk_user_id: args.clerkUserId,
      error: error.message,
    });
    return null;
  }

  return typeof data?.message_sid === "string" ? data.message_sid : null;
}

export async function hasNewerReadyPendingCoachJob(args: {
  clerkUserId: string;
  messageSid: string;
  createdAt: string;
  nowIso: string;
}): Promise<boolean> {
  const sid = await findNewerReadyPendingCoachJobMessageSid(args);
  return Boolean(sid);
}

export async function deferCoachJobBurstQuiet(args: {
  messageSid: string;
  lastError: string;
  nowMs?: number;
}): Promise<void> {
  const nextRetryAt = computeInboundBurstQuietRetryAt(args.nowMs);
  await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      next_retry_at: nextRetryAt,
      last_error: args.lastError,
      updated_at: new Date().toISOString(),
    })
    .eq("message_sid", args.messageSid)
    .in("status", ["pending", "failed"]);
}

export async function deferCoachJobForUserInFlight(args: {
  messageSid: string;
  blockingMessageSid: string;
  nowMs?: number;
}): Promise<void> {
  const deferredAt = new Date(args.nowMs ?? Date.now()).toISOString();
  await deferCoachJobBurstQuiet({
    messageSid: args.messageSid,
    nowMs: args.nowMs,
    lastError: formatInboundUserInFlightDeferredLastError({
      deferredAt,
      blockingMessageSid: args.blockingMessageSid,
    }),
  });
}

export async function deferCoachJobForNewerPendingBurst(args: {
  messageSid: string;
  newerMessageSid: string;
  nowMs?: number;
}): Promise<void> {
  const deferredAt = new Date(args.nowMs ?? Date.now()).toISOString();
  await deferCoachJobBurstQuiet({
    messageSid: args.messageSid,
    nowMs: args.nowMs,
    lastError: formatInboundNewerPendingDeferredLastError({
      deferredAt,
      deferredByMessageSid: args.newerMessageSid,
    }),
  });
}
