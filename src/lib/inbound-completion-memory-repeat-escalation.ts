/**
 * Prior inbound memory-repeat no-send context for duplicate completion escalation.
 * OpenAI repair uses this in the repair snapshot — no deterministic SMS fallback.
 */

export type InboundPriorMemoryRepeatNoSendContext = {
  prior_message_sid: string;
  prior_no_send_reason: string;
  prior_cancelled_at: string;
  normalized_inbound_text: string;
  repeated_question_preview: string | null;
  escalation_attempt: true;
};

import { supabaseServer } from "@/lib/supabase-server";

export const INBOUND_MEMORY_REPEAT_ESCALATION_WINDOW_MS = 6 * 60 * 60 * 1000;

export function normalizeInboundTextForEscalation(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseInboundLaneNoSendLastError(
  lastError: string | null | undefined
): {
  noSendReason: string | null;
  repeatedQuestion: string | null;
} | null {
  if (!lastError?.trim()) return null;
  try {
    const parsed = JSON.parse(lastError) as Record<string, unknown>;
    const tag = typeof parsed.tag === "string" ? parsed.tag : null;
    if (tag !== "inbound_v3_lane_no_send") return null;
    const noSendReason = typeof parsed.no_send_reason === "string" ? parsed.no_send_reason : null;
    const laneMeta =
      parsed.lane_metadata != null && typeof parsed.lane_metadata === "object"
        ? (parsed.lane_metadata as Record<string, unknown>)
        : null;
    const repeatedQuestion =
      laneMeta != null && typeof laneMeta.repeated_question === "string"
        ? laneMeta.repeated_question
        : null;
    return { noSendReason, repeatedQuestion };
  } catch {
    return null;
  }
}

export function buildPriorMemoryRepeatNoSendContextFromJob(args: {
  messageSid: string;
  lastError: string | null | undefined;
  cancelledAt: string;
  normalizedInboundText: string;
}): InboundPriorMemoryRepeatNoSendContext | null {
  const parsed = parseInboundLaneNoSendLastError(args.lastError);
  if (!parsed?.noSendReason?.includes("thread_memory_repeat_blocked")) return null;
  return {
    prior_message_sid: args.messageSid,
    prior_no_send_reason: parsed.noSendReason,
    prior_cancelled_at: args.cancelledAt,
    normalized_inbound_text: args.normalizedInboundText,
    repeated_question_preview: parsed.repeatedQuestion,
    escalation_attempt: true,
  };
}

type PriorJobRow = {
  message_sid: string;
  last_error: string | null;
  updated_at: string;
};

/**
 * Loads prior duplicate inbound memory-repeat no-send within escalation window (production path).
 */
export async function loadPriorInboundMemoryRepeatNoSendContext(args: {
  clerkUserId: string;
  commitmentId: string;
  normalizedInboundText: string;
  excludeMessageSid: string;
  windowMs?: number;
}): Promise<InboundPriorMemoryRepeatNoSendContext | null> {
  const windowMs = args.windowMs ?? INBOUND_MEMORY_REPEAT_ESCALATION_WINDOW_MS;
  const since = new Date(Date.now() - windowMs).toISOString();
  const { data, error } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select("message_sid,last_error,updated_at")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("commitment_id", args.commitmentId)
    .eq("status", "cancelled")
    .gte("updated_at", since)
    .neq("message_sid", args.excludeMessageSid)
    .order("updated_at", { ascending: false })
    .limit(12);

  if (error || !data?.length) return null;

  for (const row of data as PriorJobRow[]) {
    const ctx = buildPriorMemoryRepeatNoSendContextFromJob({
      messageSid: row.message_sid,
      lastError: row.last_error,
      cancelledAt: row.updated_at,
      normalizedInboundText: args.normalizedInboundText,
    });
    if (ctx && ctx.normalized_inbound_text === args.normalizedInboundText) {
      return ctx;
    }
  }
  return null;
}
