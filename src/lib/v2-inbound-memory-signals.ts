/**
 * Wave 9 — Living profile / memory freshness signals from inbound SMS (detection only).
 * Does not mutate user_profiles or commitments; stores bounded metadata on commitment events.
 */

import OpenAI from "openai";

import { supabaseServer } from "@/lib/supabase-server";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { V2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory";
import {
  formatCoachingMemoryPromptBlock,
} from "@/lib/v2-coaching-memory-prompt";
import { V2_INBOUND_AI_MODEL } from "@/lib/v2-ai-inbound";
import { isQuotableIdentitySource } from "@/lib/v2-identity-anchor";

export const V9_MEMORY_SIGNAL_PROMPT_VERSION = "v9_memory_signal_v1";

const STORE_SUMMARY_MAX = 220;
const STORE_REASONING_MAX = 200;
const STORE_CONFIRM_Q_MAX = 180;
const STORE_CANDIDATE_FIELD_MAX = 120;

function truncateStore(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ").replace(/\n+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function getOpenAIClientOrNull(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return null;
  return new OpenAI({ apiKey });
}

/**
 * Env: explicit true/1 on; false/0 off; unset defaults same as shadow (development on).
 */
export function isV2InboundMemorySignalsEnabled(): boolean {
  const v = process.env.V2_INBOUND_MEMORY_SIGNALS_ENABLED?.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return process.env.NODE_ENV === "development";
}

/**
 * Wave 9.1 — Avoid redundant OpenAI calls on trivial inbound lines when interpretation is off.
 * When `forceBecauseInterpretation` is true (shadow/gated interpreter runs), always attempt — paired call is already justified.
 */
export function shouldAttemptInboundMemorySignalInterpretation(
  rawBody: string,
  opts: { forceBecauseInterpretation: boolean }
): boolean {
  if (opts.forceBecauseInterpretation) return true;
  const t = rawBody.trim();
  if (!t) return false;
  const low = t.toLowerCase();
  if (/^(stop|start|help|unstop|cancel)$/i.test(low)) return false;
  if (t.length <= 8 && /^(ok|yes|no|y|n|yeah|nope|thanks?|thx|cool|sure)\.?$/i.test(low)) return false;
  if (t.length >= 22) return true;
  const wc = t.split(/\s+/).filter(Boolean).length;
  if (wc >= 5) return true;
  if (
    /\b(kid|kids|wife|husband|married|baby|born|family|commitment|goal|goals|quit|wrong|listen|misunderstood|meant|grok|smaller|minutes|minute)\b/i.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

/** Keys allowed into pending_resolution JSON (bounded). */
export function pickBoundedMemorySnapshotForPending(stored: Record<string, unknown>): Record<string, unknown> {
  const allow = new Set([
    "prompt_version",
    "memory_signal_detected",
    "memory_signal_failed",
    "failure_reason",
    "memory_signal_type",
    "memory_signal_confidence",
    "memory_signal_summary",
    "requires_user_confirmation",
    "sensitive",
    "should_not_quote_directly",
    "confirmation_question_preview",
    "reasoning_short",
    "candidate_people_summary_preview",
    "candidate_responsibility_preview",
    "candidate_identity_anchor_preview",
    "profile_update_applied",
    "profile_update_reason",
    "model",
  ]);
  const out: Record<string, unknown> = {};
  for (const k of allow) {
    if (k in stored) out[k] = stored[k];
  }
  return out;
}

/**
 * Non-outcome durable row — does not score accountability; idempotent per inbound MessageSid.
 *
 * Deployment (Wave 9.2): `event_type = sms_memory_signal` requires migration
 * `20260430120000_v2_sms_memory_signal_event.sql`. Inserts are additive only — failures must never
 * block inbound SMS; callers rely on this function not throwing.
 */
export async function insertV2SmsMemorySignalEvent(args: {
  commitmentId: string;
  clerkUserId: string;
  messageSid: string;
  messagePreview: string;
  gatedMode: string;
  memorySignal: Record<string, unknown>;
  /** Wave 11 — durable pending confirmation state (same event_type + idempotency key). */
  wave11ConfirmationPending?: {
    memory_confirmation_pending: true;
    pending_memory_kind: "identity_anchor_update" | "relationship_context_update";
    candidate_identity_anchor_text?: string | null;
    candidate_people_summary?: string | null;
    candidate_responsibility?: string | null;
    confirmation_question: string;
    expires_at: string;
    source_message_sid: string;
    status: "awaiting_confirmation";
  };
}): Promise<void> {
  const preview = truncateStore(args.messagePreview, 280);
  const payloadJson: Record<string, unknown> = {
    message_sid: args.messageSid,
    message_preview: preview,
    gated_mode: args.gatedMode,
    memory_signal: args.memorySignal,
  };
  if (args.wave11ConfirmationPending != null) {
    Object.assign(payloadJson, args.wave11ConfirmationPending);
  }
  try {
    const { error } = await supabaseServer.from("v2_commitment_event").insert({
      commitment_id: args.commitmentId,
      clerk_user_id: args.clerkUserId,
      event_type: "sms_memory_signal",
      source: "sms_v2_memory_signal",
      payload_json: payloadJson,
      idempotency_key: `v2_sms_memory_signal:${args.messageSid}`,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") return;
      logSmsMemorySignalInsertSkipped(args.commitmentId, error.message, code);
    }
  } catch (err) {
    logSmsMemorySignalInsertSkipped(
      args.commitmentId,
      err instanceof Error ? err.message : String(err),
      undefined
    );
  }
}

/** Non-blocking: coach reply and accountability spine must proceed without this row. */
function logSmsMemorySignalInsertSkipped(
  commitmentId: string,
  message: string,
  postgresCode: string | undefined
): void {
  console.warn("[wave9.2] sms_memory_signal insert skipped (non-blocking)", {
    commitment_id: commitmentId,
    postgres_code: postgresCode ?? null,
    message,
    migration_hint:
      "Apply supabase/migrations/20260430120000_v2_sms_memory_signal_event.sql if CHECK disallows sms_memory_signal.",
  });
}

export type V2InboundMemorySignalType =
  | "relationship_context_changed"
  | "identity_shift"
  | "commitment_context_changed"
  | "new_blocker_pattern"
  | "profile_fact_update"
  | "none";

export type V2InboundMemorySignalsParsed = {
  version: 1;
  has_memory_signal: boolean;
  signal_type: V2InboundMemorySignalType;
  confidence: number;
  summary: string;
  candidate_profile_updates: {
    people_summary: string | null;
    responsibility: string | null;
    identity_anchor_text: string | null;
  };
  requires_user_confirmation: boolean;
  confirmation_question: string | null;
  sensitive: boolean;
  should_not_quote_directly: boolean;
  reasoning_short: string;
};

export type V2InboundMemorySignalsInput = {
  userMessage: string;
  commitment: ActiveV2CommitmentRow;
  coachingMemory: V2CoachingMemoryForPrompt | null;
  preferredName: string | null;
  peopleSummaryToneHint: string | null;
  responsibilityToneHint: string | null;
  identityAnchorQuotablePreview: string | null;
  identitySource: string | null;
  recentSmsContextBlock: string | null;
  effectiveAsk: string;
};

const SIGNAL_TYPES = new Set<V2InboundMemorySignalType>([
  "relationship_context_changed",
  "identity_shift",
  "commitment_context_changed",
  "new_blocker_pattern",
  "profile_fact_update",
  "none",
]);

function parseSignalType(v: unknown): V2InboundMemorySignalType {
  if (typeof v !== "string") return "none";
  const x = v.trim() as V2InboundMemorySignalType;
  return SIGNAL_TYPES.has(x) ? x : "none";
}

function parseCandidates(raw: unknown): V2InboundMemorySignalsParsed["candidate_profile_updates"] {
  const empty = { people_summary: null, responsibility: null, identity_anchor_text: null };
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const o = raw as Record<string, unknown>;
  const ps = typeof o.people_summary === "string" ? truncateStore(o.people_summary, STORE_CANDIDATE_FIELD_MAX) : null;
  const rs = typeof o.responsibility === "string" ? truncateStore(o.responsibility, STORE_CANDIDATE_FIELD_MAX) : null;
  const ia =
    typeof o.identity_anchor_text === "string"
      ? truncateStore(o.identity_anchor_text, STORE_CANDIDATE_FIELD_MAX)
      : null;
  return {
    people_summary: ps && ps.length > 0 ? ps : null,
    responsibility: rs && rs.length > 0 ? rs : null,
    identity_anchor_text: ia && ia.length > 0 ? ia : null,
  };
}

export function parseAndValidateMemorySignals(raw: Record<string, unknown>): V2InboundMemorySignalsParsed | null {
  if (raw.version !== 1) return null;

  let confidence = 0;
  if (typeof raw.confidence === "number" && Number.isFinite(raw.confidence)) {
    confidence = Math.min(1, Math.max(0, raw.confidence));
  } else {
    return null;
  }

  const signal_type = parseSignalType(raw.signal_type);
  const summary =
    typeof raw.summary === "string" ? truncateStore(raw.summary, STORE_SUMMARY_MAX) : "";
  const reasoning_short =
    typeof raw.reasoning_short === "string"
      ? truncateStore(raw.reasoning_short, STORE_REASONING_MAX)
      : "";

  if (!reasoning_short.trim()) return null;

  let confirmation_question: string | null = null;
  if (typeof raw.confirmation_question === "string" && raw.confirmation_question.trim()) {
    confirmation_question = truncateStore(raw.confirmation_question, STORE_CONFIRM_Q_MAX);
  }

  /** Signal type is authoritative; do not treat stray booleans as signals when type is none. */
  const has_memory_signal = signal_type !== "none";

  return {
    version: 1,
    has_memory_signal,
    signal_type,
    confidence,
    summary: summary || "(none)",
    candidate_profile_updates: parseCandidates(raw.candidate_profile_updates),
    requires_user_confirmation: raw.requires_user_confirmation === true,
    confirmation_question,
    sensitive: raw.sensitive === true,
    should_not_quote_directly: raw.should_not_quote_directly !== false,
    reasoning_short,
  };
}

const MEMORY_SYSTEM_PROMPT = `You are Pat Summitt Mindset's MEMORY SIGNAL detector for inbound accountability SMS.
You ONLY output one JSON object. No coaching text to the user is sent from this step.
Rules:
- Never invent facts not clearly stated or strongly implied in USER_MESSAGE.
- Do not treat venting or one hard day as a permanent identity change.
- Identity line changes need clear user intent; set requires_user_confirmation true unless they explicitly confirm a new line.
- spouse/kids/health/money: mark sensitive true and should_not_quote_directly true unless user is explicit and factual.
- If user wants a different commitment/bar, signal_type commitment_context_changed — server routes commitment changes separately; do not assume mutation.
- Blocker/pattern-only updates: new_blocker_pattern.
- Life/relationship facts evolving: relationship_context_changed or profile_fact_update.
- If nothing notable: signal_type "none", has_memory_signal false.
Output strict JSON only.`;

function truncateOneLine(s: string, max: number): string {
  const x = s.trim().replace(/\s+/g, " ");
  if (x.length <= max) return x;
  return `${x.slice(0, max - 1)}…`;
}

function buildMemorySignalsUserPrompt(args: V2InboundMemorySignalsInput): string {
  const lines: string[] = [];
  lines.push("Detect whether this inbound SMS reveals durable profile/memory updates vs normal accountability.");
  lines.push("");
  lines.push("OUTPUT: Return ONLY valid JSON with keys:");
  lines.push(
    '{"version":1,"has_memory_signal":bool,"signal_type":"<relationship_context_changed|identity_shift|commitment_context_changed|new_blocker_pattern|profile_fact_update|none>","confidence":0-1,"summary":"<short>","candidate_profile_updates":{"people_summary":string|null,"responsibility":string|null,"identity_anchor_text":string|null},"requires_user_confirmation":bool,"confirmation_question":string|null,"sensitive":bool,"should_not_quote_directly":bool,"reasoning_short":"<max ~2 sentences>"}'
  );
  lines.push("");
  lines.push(`USER_MESSAGE: ${truncateOneLine(args.userMessage, 420)}`);
  lines.push("");
  lines.push("COMMITMENT (authoritative bar for context):");
  lines.push(`- effective_coaching_ask: ${truncateOneLine(args.effectiveAsk, 200)}`);
  lines.push(`- behavior_statement: ${truncateOneLine(args.commitment.behavior_statement, 180)}`);
  lines.push("");
  lines.push("STORED_PROFILE_HINTS (may be older onboarding — SMS may be newer):");
  if (args.preferredName?.trim()) {
    lines.push(`- preferred_name: ${truncateOneLine(args.preferredName, 48)}`);
  }
  if (args.peopleSummaryToneHint?.trim()) {
    lines.push(`- people_summary_on_file (may be stale): ${truncateOneLine(args.peopleSummaryToneHint, 160)}`);
  }
  if (args.responsibilityToneHint?.trim()) {
    lines.push(`- responsibility_on_file (may be stale): ${truncateOneLine(args.responsibilityToneHint, 140)}`);
  }
  if (args.identityAnchorQuotablePreview?.trim()) {
    lines.push(
      `- identity_anchor_on_file_quotable (trusted source only): ${truncateOneLine(args.identityAnchorQuotablePreview, 160)}`
    );
  } else if (args.identitySource && !isQuotableIdentitySource(args.identitySource)) {
    lines.push("- identity_anchor_on_file: not quotable / relationship-derived — treat as tone-only if present elsewhere.");
  }
  lines.push("");
  const mem = formatCoachingMemoryPromptBlock(args.coachingMemory);
  if (mem) {
    lines.push(mem);
    lines.push("");
  }
  if (args.recentSmsContextBlock?.trim()) {
    lines.push("RECENT_SMS_CONTEXT (bounded):");
    lines.push(truncateOneLine(args.recentSmsContextBlock, 2400));
    lines.push("");
  }
  lines.push("RULES:");
  lines.push("- candidate_profile_updates: only fields the user clearly implies updating; use null otherwise.");
  lines.push("- Do not fill identity_anchor_text from relationship-only phrases (e.g. my kids).");
  lines.push("- commitment_context_changed when user describes wanting a different daily bar/commitment.");
  lines.push("- If unsure, signal_type none or low confidence.");
  return lines.join("\n");
}

export type V2InboundMemorySignalsResult =
  | { ok: true; data: V2InboundMemorySignalsParsed; model: string }
  | { ok: false; memory_signal_failed: true; reason: string; model: string | null };

export async function interpretV2InboundMemorySignals(
  args: V2InboundMemorySignalsInput
): Promise<V2InboundMemorySignalsResult> {
  if (!isV2InboundMemorySignalsEnabled()) {
    return { ok: false, memory_signal_failed: true, reason: "memory_signals_disabled", model: null };
  }

  const client = getOpenAIClientOrNull();
  if (!client) {
    return { ok: false, memory_signal_failed: true, reason: "no_openai_key", model: null };
  }

  try {
    const completion = await client.chat.completions.create({
      model: V2_INBOUND_AI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: MEMORY_SYSTEM_PROMPT },
        { role: "user", content: buildMemorySignalsUserPrompt(args) },
      ],
      temperature: 0.25,
      max_tokens: 450,
    });

    const rawStr = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!rawStr) {
      return { ok: false, memory_signal_failed: true, reason: "empty_model_output", model: V2_INBOUND_AI_MODEL };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawStr) as Record<string, unknown>;
    } catch {
      return { ok: false, memory_signal_failed: true, reason: "invalid_json", model: V2_INBOUND_AI_MODEL };
    }

    const data = parseAndValidateMemorySignals(parsed);
    if (!data) {
      return { ok: false, memory_signal_failed: true, reason: "validation_failed", model: V2_INBOUND_AI_MODEL };
    }

    return { ok: true, data, model: V2_INBOUND_AI_MODEL };
  } catch (err) {
    console.error("[v9-memory-signals] OpenAI failed", err);
    return { ok: false, memory_signal_failed: true, reason: "openai_error", model: V2_INBOUND_AI_MODEL };
  }
}

/** Bounded blob for v2_commitment_event.payload_json.memory_signal */
export function buildStoredMemorySignalPayload(args: {
  result: V2InboundMemorySignalsResult;
}): Record<string, unknown> {
  const r = args.result;
  if (!r.ok) {
    return {
      prompt_version: V9_MEMORY_SIGNAL_PROMPT_VERSION,
      memory_signal_detected: false,
      memory_signal_failed: true,
      failure_reason: r.reason,
      model: r.model,
    };
  }

  const d = r.data;
  return {
    prompt_version: V9_MEMORY_SIGNAL_PROMPT_VERSION,
    memory_signal_detected: d.has_memory_signal,
    memory_signal_type: d.signal_type,
    memory_signal_confidence: d.confidence,
    memory_signal_summary: truncateStore(d.summary, STORE_SUMMARY_MAX),
    requires_user_confirmation: d.requires_user_confirmation,
    sensitive: d.sensitive,
    should_not_quote_directly: d.should_not_quote_directly,
    confirmation_question_preview: d.confirmation_question
      ? truncateStore(d.confirmation_question, STORE_CONFIRM_Q_MAX)
      : null,
    reasoning_short: d.reasoning_short,
    candidate_people_summary_preview: d.candidate_profile_updates.people_summary,
    candidate_responsibility_preview: d.candidate_profile_updates.responsibility,
    candidate_identity_anchor_preview: d.candidate_profile_updates.identity_anchor_text,
    profile_update_applied: false,
    profile_update_reason: null,
    model: r.model,
  };
}
