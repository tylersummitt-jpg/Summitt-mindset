/**
 * Deterministic planned-interruption detection (vacation, illness, travel, pause requests).
 * Non-scoring memory via sms_memory_signal; does not replace Twilio STOP/HELP/START.
 */

import type { V2InboundGatedDecision } from "@/lib/v2-ai-inbound";
import { classifyInboundSmsSafetyTier } from "@/lib/sms-inbound-safety";

export type SmsPlannedInterruptionReason =
  | "vacation"
  | "travel"
  | "illness"
  | "family_emergency"
  | "grief"
  | "hospital_or_surgery"
  | "competition_or_camp"
  | "work_or_schedule_overload"
  | "pause_request"
  | "weekend_or_short_break"
  | "other";

export type SmsPlannedInterruptionDetection = {
  detected: boolean;
  reasonCategory: SmsPlannedInterruptionReason | null;
  resumeHint: string | null;
  confidence: "low" | "medium" | "high";
};

export type SmsPlannedInterruptionSignalRow = {
  occurredAt: string;
  memorySignal: Record<string, unknown>;
};

const PREVIEW_MAX = 120;
const RESUME_HINT_MAX = 80;
const MS_DAY = 86400000;

const EXACT_STOP_RE = /^\s*(stop|unsubscribe|cancel|end)\s*$/i;
const EXACT_HELP_START_RE = /^\s*(help|info|start|unstop)\s*$/i;

const SUBSCRIPTION_BILLING_RE =
  /\b(cancel\s+my\s+subscription|cancel\s+my\s+membership|stop\s+charging\s+me|billing\s+issue|need\s+a\s+refund|refund\s+my|pause\s+my\s+subscription)\b/i;

const NORMAL_MISS_RE =
  /\b(i\s+)?(missed(\s+it)?|didn'?t\s+(do|make|get)|failed\s+today|blew\s+it)\b/i;

const DAY_NAMES =
  "monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun";

type Rule = {
  reason: SmsPlannedInterruptionReason;
  pattern: RegExp;
  confidence: "medium" | "high";
};

const PLANNED_RULES: Rule[] = [
  { reason: "vacation", pattern: /\b(on\s+)?vacation\b/i, confidence: "high" },
  { reason: "travel", pattern: /\b(out\s+of\s+town|traveling|travelling|on\s+a\s+trip|trip\s+this\s+week)\b/i, confidence: "high" },
  { reason: "illness", pattern: /\b(sick|flu|illness|ill\b|fever)\b/i, confidence: "high" },
  { reason: "family_emergency", pattern: /\bfamily\s+emergency\b/i, confidence: "high" },
  { reason: "grief", pattern: /\b(grieving|grief)\b/i, confidence: "high" },
  { reason: "hospital_or_surgery", pattern: /\b(hospital|surgery|post[- ]?op)\b/i, confidence: "high" },
  {
    reason: "competition_or_camp",
    pattern: /\b(tournament|coaching\s+camp|at\s+camp\b|summer\s+camp)\b/i,
    confidence: "high",
  },
  { reason: "work_or_schedule_overload", pattern: /\bthis\s+week\s+is\s+impossible\b/i, confidence: "high" },
  { reason: "work_or_schedule_overload", pattern: /\bnot\s+this\s+week\b/i, confidence: "medium" },
  { reason: "pause_request", pattern: /\bpause\s+(me\s+)?(until|texts)\b/i, confidence: "high" },
  { reason: "pause_request", pattern: /\bpause\s+texts\b/i, confidence: "high" },
  { reason: "pause_request", pattern: /\bstop\s+for\s+a\s+few\s+days\b/i, confidence: "high" },
  { reason: "pause_request", pattern: /\btext\s+me\s+less\b/i, confidence: "high" },
  { reason: "pause_request", pattern: /\bneed\s+a\s+break\b/i, confidence: "medium" },
  { reason: "weekend_or_short_break", pattern: /\bdon'?t\s+text\s+me\s+this\s+weekend\b/i, confidence: "high" },
  { reason: "pause_request", pattern: /\bnext\s+week\b/i, confidence: "medium" },
  {
    reason: "pause_request",
    pattern: new RegExp(`\\b(can'?t|cannot)\\s+do\\s+(this\\s+)?until\\s+(${DAY_NAMES})\\b`, "i"),
    confidence: "high",
  },
  {
    reason: "pause_request",
    pattern: new RegExp(`\\btext\\s+me\\s+next\\s+(${DAY_NAMES})\\b`, "i"),
    confidence: "high",
  },
  {
    reason: "pause_request",
    pattern: new RegExp(`\\bpause\\s+me\\s+until\\s+(${DAY_NAMES})\\b`, "i"),
    confidence: "high",
  },
];

function truncate(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function isExcludedFromPlannedInterruption(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  if (EXACT_STOP_RE.test(t) || EXACT_HELP_START_RE.test(t)) return true;
  if (SUBSCRIPTION_BILLING_RE.test(t)) return true;
  if (NORMAL_MISS_RE.test(t) && !/\b(vacation|sick|travel|emergency|hospital|grief|pause|break)\b/i.test(t)) {
    return true;
  }
  const safety = classifyInboundSmsSafetyTier(t);
  if (safety.tier !== "safe") return true;
  return false;
}

function extractResumeHint(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const hints: string[] = [];
  const untilDay = t.match(
    new RegExp(`\\b(?:until|pause\\s+me\\s+until|can'?t\\s+until|text\\s+me\\s+next)\\s+(${DAY_NAMES})\\b`, "i")
  );
  if (untilDay?.[1]) hints.push(`until ${untilDay[1].toLowerCase()}`);
  if (/\bnext\s+week\b/i.test(t)) hints.push("next week");
  if (/\bthis\s+weekend\b/i.test(t)) hints.push("this weekend");
  if (/\bafter\s+vacation\b/i.test(t)) hints.push("after vacation");
  if (/\btomorrow\b/i.test(t)) hints.push("tomorrow");
  if (/\ba\s+few\s+days\b/i.test(t)) hints.push("a few days");
  if (/\bfor\s+a\s+week\b/i.test(t)) hints.push("for a week");
  if (hints.length === 0) return null;
  return truncate(hints[0]!, RESUME_HINT_MAX);
}

export function detectSmsPlannedInterruption(
  raw: string | null | undefined
): SmsPlannedInterruptionDetection {
  const t = (raw ?? "").trim();
  if (!t || isExcludedFromPlannedInterruption(t)) {
    return { detected: false, reasonCategory: null, resumeHint: null, confidence: "low" };
  }

  let best: { reason: SmsPlannedInterruptionReason; confidence: "medium" | "high" } | null = null;
  for (const rule of PLANNED_RULES) {
    if (!rule.pattern.test(t)) continue;
    if (!best || rule.confidence === "high") {
      best = { reason: rule.reason, confidence: rule.confidence };
    }
    if (rule.confidence === "high") break;
  }

  if (!best) {
    return { detected: false, reasonCategory: null, resumeHint: null, confidence: "low" };
  }

  return {
    detected: true,
    reasonCategory: best.reason,
    resumeHint: extractResumeHint(t),
    confidence: best.confidence,
  };
}

/** Medium/high confidence — use for scoring suppression and memory insert. */
export function isPlannedInterruptionActionable(
  detection: SmsPlannedInterruptionDetection
): boolean {
  return (
    detection.detected &&
    (detection.confidence === "medium" || detection.confidence === "high")
  );
}

export function buildPlannedInterruptionMemorySignalPayload(args: {
  raw: string;
  messageSid?: string | null;
  reasonCategory: SmsPlannedInterruptionReason;
  resumeHint?: string | null;
  confidence: "low" | "medium" | "high";
  sourcePath: string;
}): Record<string, unknown> {
  const detectedAt = new Date().toISOString();
  return {
    planned_interruption: true,
    reason_category: args.reasonCategory,
    confidence: args.confidence,
    resume_hint: args.resumeHint ?? null,
    message_sid: args.messageSid ?? null,
    source_path: args.sourcePath,
    message_preview: truncate(args.raw, PREVIEW_MAX),
    detected_at: detectedAt,
  };
}

function parsePayloadMemorySignal(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const ms = (payload as Record<string, unknown>).memory_signal;
  if (!ms || typeof ms !== "object" || Array.isArray(ms)) return null;
  return ms as Record<string, unknown>;
}

function ttlMsForResumeHint(resumeHint: string | null): number {
  const h = (resumeHint ?? "").toLowerCase();
  if (/\btomorrow\b/.test(h)) return 2 * MS_DAY;
  if (/\bthis\s+weekend\b/.test(h)) return 4 * MS_DAY;
  if (/\bnext\s+week\b/.test(h) || /\bfor\s+a\s+week\b/.test(h)) return 10 * MS_DAY;
  return 7 * MS_DAY;
}

export function isActivePlannedInterruptionSignal(
  payload: unknown,
  now: Date = new Date()
): boolean {
  const ms = parsePayloadMemorySignal(payload);
  if (!ms || ms.planned_interruption !== true) return false;

  const detectedAt =
    typeof ms.detected_at === "string"
      ? ms.detected_at
      : typeof (payload as Record<string, unknown>)?.occurred_at === "string"
        ? String((payload as Record<string, unknown>).occurred_at)
        : null;
  if (!detectedAt) return false;

  const t = new Date(detectedAt).getTime();
  if (!Number.isFinite(t)) return false;

  const resumeHint = typeof ms.resume_hint === "string" ? ms.resume_hint : null;
  const ttl = ttlMsForResumeHint(resumeHint);
  const nowMs = now.getTime();
  return nowMs >= t && nowMs <= t + ttl;
}

export function applyPlannedInterruptionGatedOverride(
  decision: V2InboundGatedDecision
): V2InboundGatedDecision {
  return {
    mode: "clarify",
    final_event_type: null,
    decision_reason: "planned_interruption_detected",
    confidence_used: decision.confidence_used,
    should_write_outcome_event: false,
    should_open_blocker_capture: false,
    reply_style: "clarification",
    overrode_deterministic: true,
    clarification_question: decision.clarification_question,
    supplement_commitment_change_guidance: false,
  };
}

/** Non-blocking insert; idempotent per MessageSid. */
export async function insertSmsPlannedInterruptionMemorySignal(args: {
  commitmentId: string;
  clerkUserId: string;
  messageSid: string;
  messagePreview: string;
  gatedMode: string;
  memorySignal: Record<string, unknown>;
}): Promise<void> {
  const preview = truncate(args.messagePreview, PREVIEW_MAX);
  const payloadJson: Record<string, unknown> = {
    message_sid: args.messageSid,
    message_preview: preview,
    gated_mode: args.gatedMode,
    memory_signal: args.memorySignal,
  };
  try {
    const { supabaseServer } = await import("@/lib/supabase-server");
    const { error } = await supabaseServer.from("v2_commitment_event").insert({
      commitment_id: args.commitmentId,
      clerk_user_id: args.clerkUserId,
      event_type: "sms_memory_signal",
      source: "sms_v2_planned_interruption",
      payload_json: payloadJson,
      idempotency_key: `v2_sms_planned_interruption:${args.messageSid}`,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") return;
      console.warn("[sms-planned-interruption] insert skipped (non-blocking)", {
        commitment_id: args.commitmentId,
        message: error.message,
        postgres_code: code ?? null,
      });
    }
  } catch (err) {
    console.warn("[sms-planned-interruption] insert skipped (non-blocking)", {
      commitment_id: args.commitmentId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function loadRecentPlannedInterruptionSignalForCommitment(args: {
  commitmentId: string;
  clerkUserId: string;
  now?: Date;
}): Promise<SmsPlannedInterruptionSignalRow | null> {
  const now = args.now ?? new Date();
  const lookbackMs = 10 * MS_DAY;
  const cutoff = new Date(now.getTime() - lookbackMs).toISOString();

  try {
    const { supabaseServer } = await import("@/lib/supabase-server");
    const { data, error } = await supabaseServer
      .from("v2_commitment_event")
      .select("occurred_at, payload_json")
      .eq("commitment_id", args.commitmentId)
      .eq("clerk_user_id", args.clerkUserId)
      .eq("event_type", "sms_memory_signal")
      .gte("occurred_at", cutoff)
      .order("occurred_at", { ascending: false })
      .limit(12);

    if (error) {
      console.warn("[sms-planned-interruption] load failed (fail open)", {
        commitment_id: args.commitmentId,
        message: error.message,
      });
      return null;
    }

    for (const row of data ?? []) {
      const payload = row.payload_json;
      const ms = parsePayloadMemorySignal(payload);
      if (!ms || ms.planned_interruption !== true) continue;
      if (!isActivePlannedInterruptionSignal(payload, now)) continue;
      return {
        occurredAt: typeof row.occurred_at === "string" ? row.occurred_at : now.toISOString(),
        memorySignal: ms,
      };
    }
    return null;
  } catch (err) {
    console.warn("[sms-planned-interruption] load failed (fail open)", {
      commitment_id: args.commitmentId,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export function buildPlannedInterruptionLaneGuardrails(): string {
  return `
PLANNED_INTERRUPTION (when planned_interruption_active is true):
- Vacation, illness, travel, family emergency, grief, hospital, tournament/camp, or explicit pause requests are honest context — not failure or avoidance.
- Do not shame, lecture, or use blocker-capture language.
- Do not ask YES/NO accountability for the interruption announcement itself.
- Offer empathy, a smaller version if helpful, or a simple pause/resume question (use resume_hint when present).
- Do not claim cadence or commitment changed unless server state already shows it.
- Safety/crisis tier overrides this block. STOP/HELP/START are compliance outside this lane.`;
}

export function dailyServerStrategyDuringPlannedInterruption(
  serverStrategy: string
): string {
  if (serverStrategy === "silence_nudge") return "standard_check";
  return serverStrategy;
}
