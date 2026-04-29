import OpenAI from "openai";

import type { ActiveV2CommitmentRow, V2EventRowForAi } from "@/lib/v2-commitment";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import {
  computeIdentityReferenceAllowedInbound,
  identityAnchorLeakDetected,
} from "@/lib/v2-identity-anchor";
import {
  formatCoachingMemoryPromptBlock,
  type V2CoachingMemoryForPrompt,
} from "@/lib/v2-coaching-memory-prompt";
import { parseLatestCheckSentNextMoveType, type V2NextMoveType } from "@/lib/v2-ai-outbound";
import type { V2InboundEventType } from "@/lib/v2-sms-accountability";

export const V2_INBOUND_AI_PROMPT_VERSION = "v2_inbound_v1";

export const V2_INBOUND_AI_MODEL = "gpt-4o-mini";

const SMS_MAX_LEN = 300;

export type V2InboundReplyStrategy = "reinforce_yes" | "recommit_prompt" | "tighten_partial";

export type V2AiInboundAttempt =
  | {
      ok: true;
      message: string;
      confidence: number | null;
      fallbackUsed: false;
    }
  | { ok: false; fallbackUsed: true; reason: string };

function getOpenAIClientOrNull(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return null;
  return new OpenAI({ apiKey });
}

export function isV2AiInboundEnabled(): boolean {
  return process.env.V2_AI_INBOUND_ENABLED === "true";
}

/** Server-only mapping: AI must echo this strategy in JSON (validated). */
export function strategyForInboundEventType(eventType: V2InboundEventType): V2InboundReplyStrategy {
  if (eventType === "user_yes") return "reinforce_yes";
  if (eventType === "user_no") return "recommit_prompt";
  return "tighten_partial";
}

function truncateOneLine(s: string, max: number): string {
  const x = s.trim().replace(/\s+/g, " ");
  if (x.length <= max) return x;
  return `${x.slice(0, max - 1)}…`;
}

function summarizeEventForPrompt(e: V2EventRowForAi): string {
  const p = e.payload_json || {};
  const preview =
    typeof p.message === "string"
      ? truncateOneLine(p.message, 120)
      : typeof p.body_preview === "string"
        ? truncateOneLine(p.body_preview, 80)
        : "";
  const tail = preview ? ` text="${preview}"` : "";
  return `${e.occurred_at} ${e.event_type}${tail}`;
}

/** Therapy / clinical / vendor meta (same spirit as outbound). */
const BANNED_THERAPY_META: readonly string[] = [
  "therapy",
  "therapist",
  "trauma",
  "diagnos",
  "disorder",
  "openai",
  "chatgpt",
  " language model",
  "as an ai",
  "i'm an ai",
  "guarantee you will",
  "promise you will",
];

/** Shame / guilt / character attack (word-boundary-ish; avoid substrings like "pathetic" in "empathetic"). */
const BANNED_SHAME_PATTERNS: readonly RegExp[] = [
  /\bashamed\b/i,
  /\bdisappointed in you\b/i,
  /\byou should feel guilty\b/i,
  /\bshame on you\b/i,
  /\byou failed\b/i,
  /\byou'?re a failure\b/i,
  /\byou are a failure\b/i,
  /\bpathetic\b/i,
  /\bworthless\b/i,
  /\bdisgusting\b/i,
  /\bhow could you\b/i,
  /\bwhat'?s wrong with you\b/i,
  /\bbad person\b/i,
  /\byou'?re lazy\b/i,
  /\byou are lazy\b/i,
  /\bloser\b/i,
  /\bembarrassing for you\b/i,
];

/** Fake intimacy / over-personalization (SMS coach scope). */
const BANNED_INTIMACY: readonly string[] = [
  "i love you",
  "love you so much",
  "proud of you as a person",
  "cherish you",
  "you complete me",
  "anything for you",
  "always here for you",
  "you're perfect just",
];

/** Scope creep: new goals / changing the commitment in copy. */
const BANNED_SCOPE: readonly string[] = [
  "new goal",
  "another goal",
  "add a goal",
  "different goal",
  " new habit",
  " new commitment",
  "change your commitment",
  "pick a different commitment",
  "drop this commitment",
  "abandon this commitment",
];

function passesLexicalGuards(message: string): boolean {
  const lower = message.toLowerCase();
  for (const b of BANNED_THERAPY_META) {
    if (lower.includes(b)) return false;
  }
  for (const re of BANNED_SHAME_PATTERNS) {
    if (re.test(message)) return false;
  }
  const soft = [...BANNED_INTIMACY, ...BANNED_SCOPE];
  for (const b of soft) {
    if (lower.includes(b)) return false;
  }
  if (/\bai\b/i.test(message)) return false;
  if (/\bgpt\b/i.test(lower)) return false;
  if (/\bchat bot\b/i.test(lower)) return false;
  return true;
}

function questionCount(message: string): number {
  return (message.match(/\?/g) ?? []).length;
}

function tokenizeAnchorWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w: string) => w.replace(/[^a-z0-9']/g, ""))
    .filter((w: string) => w.length >= 3)
    .slice(0, 8);
}

/** Deduped meaningful tokens from behavior + title (reduces brittleness vs behavior-only). */
function anchorWordCandidates(behaviorStatement: string, title: string, max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of [...tokenizeAnchorWords(behaviorStatement), ...tokenizeAnchorWords(title)]) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * If the model paraphrases without reusing exact tokens, still pass when a short
 * alnum run from the behavior appears in the reply (cheap fuzzy tie to commitment).
 */
function passesCompactBehaviorOverlap(messageLower: string, behaviorStatement: string): boolean {
  const compactBeh = behaviorStatement.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const compactMsg = messageLower.replace(/[^a-z0-9]/g, "");
  if (compactBeh.length < 5 || compactMsg.length < 5) return false;
  const head = compactBeh.slice(0, 40);
  for (let i = 0; i + 5 <= head.length; i++) {
    if (compactMsg.includes(head.slice(i, i + 5))) return true;
  }
  return false;
}

/**
 * Grounding: reply should tie to this commitment without rejecting good paraphrases.
 * Pass if no anchor tokens; else token hit OR compact overlap with behavior.
 */
function passesCommitmentGrounding(
  messageLower: string,
  behaviorStatement: string,
  commitmentTitle: string
): boolean {
  const words = anchorWordCandidates(behaviorStatement, commitmentTitle, 12);
  if (words.length === 0) return true;
  if (words.some((w: string) => messageLower.includes(w))) return true;
  return passesCompactBehaviorOverlap(messageLower, behaviorStatement);
}

const REENTRY_BANNED_PHRASES: readonly string[] = [
  "where have you been",
  "why didn't you",
  "about time",
  "finally you",
  "you ghosted",
  "stopped responding",
];

export function validateV2AiInboundMessage(args: {
  message: string;
  serverStrategy: V2InboundReplyStrategy;
  modelStrategy: unknown;
  behaviorStatement: string;
  commitmentTitle: string;
  afterSilence?: boolean;
  brokePause?: boolean;
  lastOutboundNextMove?: V2NextMoveType | null;
  identityReferenceAllowed?: boolean;
  identityAnchorText?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  const msg = (args.message || "").trim().replace(/\s+/g, " ").replace(/\n+/g, " ");
  if (!msg) return { ok: false, reason: "empty_message" };
  if (msg.length > SMS_MAX_LEN) return { ok: false, reason: "too_long" };

  const modelStr = typeof args.modelStrategy === "string" ? args.modelStrategy.trim() : "";
  if (modelStr !== args.serverStrategy) {
    return { ok: false, reason: "strategy_mismatch" };
  }

  if (!passesLexicalGuards(msg)) return { ok: false, reason: "lexical_guard" };

  if (args.afterSilence || args.brokePause) {
    const lower = msg.toLowerCase();
    for (const g of REENTRY_BANNED_PHRASES) {
      if (lower.includes(g)) return { ok: false, reason: "reentry_tone_guard" };
    }
  }

  if (args.lastOutboundNextMove === "reset_day") {
    const lower = msg.toLowerCase();
    if (lower.includes("max out") || lower.includes("all-in") || lower.includes("all in")) {
      return { ok: false, reason: "reset_day_intensity_guard" };
    }
  }

  const q = questionCount(msg);
  if (args.serverStrategy === "reinforce_yes") {
    if (q > 1) return { ok: false, reason: "too_many_questions" };
  } else {
    if (q !== 1) return { ok: false, reason: "need_single_question" };
  }

  const anchor = typeof args.identityAnchorText === "string" ? args.identityAnchorText.trim() : "";
  if (anchor) {
    const allowed = Boolean(args.identityReferenceAllowed);
    if (allowed) {
      if (identityAnchorLeakDetected(msg, anchor)) {
        return { ok: false, reason: "identity_anchor_partial_leak" };
      }
    } else {
      if (msg.includes(anchor)) {
        return { ok: false, reason: "identity_anchor_when_disallowed" };
      }
      if (identityAnchorLeakDetected(msg, anchor)) {
        return { ok: false, reason: "identity_anchor_partial_when_disallowed" };
      }
    }
  }

  const ml = msg.toLowerCase();
  if (!passesCommitmentGrounding(ml, args.behaviorStatement, args.commitmentTitle)) {
    return { ok: false, reason: "missing_commitment_grounding" };
  }

  return { ok: true };
}

export type V2AiInboundContext = {
  commitment: ActiveV2CommitmentRow;
  eventType: V2InboundEventType;
  serverStrategy: V2InboundReplyStrategy;
  userMessage: string;
  normalizedHint: string | null;
  eventsNewestFirst: V2EventRowForAi[];
  preferredName: string | null;
  lifeDesires: string | null;
  /** Optional one-line mirror of `user_profiles.people_summary` (wording context only). */
  peopleSummary?: string | null;
  /** Optional one-line mirror of `user_profiles.responsibility` (wording context only). */
  responsibility?: string | null;
  /** Server-derived: user reply follows a quiet/nudge silence tier (see deriveV2SilenceContext). */
  afterSilence: boolean;
  /** Present when afterSilence (for prompt + optional payload). */
  unansweredChecks?: number;
  /** Days since last user_yes/no/partial in bounded window; aligned with silence context. */
  daysIdle?: number;
  /** Latest outbound next_move from most recent check_sent (for tone alignment). */
  lastOutboundNextMove: V2NextMoveType | null;
  /** Prior memory snapshot (optional). */
  coachingMemory: V2CoachingMemoryForPrompt | null;
  /** True when this inbound reply exited low_pressure_reactivation for this send. */
  brokePause?: boolean;
  identityAnchorText?: string | null;
  identityRefreshDue?: boolean;
  identityReferenceAllowed?: boolean;
};

const SYSTEM_PROMPT = `You are Pat Summitt AI for inbound accountability SMS replies.
Voice: direct, specific, tactical, human, calm.
Hold the standard without shame.
Output strict JSON only.`;

function buildDeveloperPrompt(ctx: V2AiInboundContext): string {
  const lines: string[] = [];
  lines.push("You write ONE inbound SMS reply to the user's latest check-in response.");
  lines.push("Return ONLY valid JSON with keys: strategy, message, confidence (0-1 number or null).");
  lines.push(`server_event_type (authoritative, for tone only): ${ctx.eventType}`);
  lines.push(`server_strategy (authoritative): ${ctx.serverStrategy}`);
  lines.push("strategy in your JSON MUST exactly equal server_strategy.");
  lines.push("");
  lines.push("STRATEGY MEANINGS:");
  lines.push("- reinforce_yes: close the loop with proof language, not hype; stay on the same commitment. At most one question (zero is usually best).");
  lines.push("- recommit_prompt: honor the miss without shame; exactly ONE forward blocker question.");
  lines.push("- tighten_partial: partial means still in the fight; exactly ONE gap-closing question.");
  lines.push("");
  lines.push("COMMITMENT:");
  lines.push(`title: ${truncateOneLine(ctx.commitment.title, 80)}`);
  lines.push(
    `effective_coaching_ask (authoritative for replies): ${truncateOneLine(getEffectiveCoachingAsk(ctx.commitment), 200)}`
  );
  lines.push(
    `original_behavior_statement (long-term anchor): ${truncateOneLine(ctx.commitment.behavior_statement, 200)}`
  );
  if (ctx.commitment.success_criteria?.trim()) {
    lines.push(`success_criteria: ${truncateOneLine(ctx.commitment.success_criteria, 160)}`);
  }
  lines.push("");
  if (ctx.preferredName?.trim()) {
    lines.push(
      `Preferred name Coach Pat should use: ${truncateOneLine(ctx.preferredName, 40)}`
    );
  }
  if (ctx.lifeDesires?.trim()) {
    lines.push(
      `Legacy onboarding—what they said they want out of life right now: ${truncateOneLine(ctx.lifeDesires, 120)}`
    );
  }
  const showUpFor = ctx.peopleSummary?.trim() ?? "";
  const responsibilityText = ctx.responsibility?.trim() ?? "";
  if (showUpFor || responsibilityText) {
    lines.push("");
    lines.push(
      "USER_ONBOARDING (answered in app; wording and empathy only—never replaces USER_MESSAGE or COMMITMENT):"
    );
  }
  if (showUpFor) {
    lines.push(
      `User said they are trying to show up for right now: ${truncateOneLine(showUpFor, 200)}`
    );
  }
  if (responsibilityText) {
    lines.push(
      `Additional context they want Coach Pat to know (family, team, responsibilities): ${truncateOneLine(responsibilityText, 160)}`
    );
  }
  if (showUpFor || responsibilityText) {
    lines.push(
      "Use the above naturally when it helps the reply feel personal and grounded. Do not force into every reply. Do not guilt-trip. Do not invent details. USER_MESSAGE and COMMITMENT stay primary."
    );
    if (showUpFor && ctx.identityAnchorText?.trim()) {
      lines.push(
        "(IDENTITY_CONTEXT below may mirror this 'show up for' answer as the stored identity line—at most one grounded tie, not redundant repetition.)"
      );
    }
  }
  if (ctx.identityAnchorText?.trim()) {
    lines.push("");
    lines.push("IDENTITY_CONTEXT (user_profiles is authoritative; never invent or edit anchor):");
    lines.push(
      `Stored identity anchor for this user: ${truncateOneLine(ctx.identityAnchorText, 200)}`
    );
    lines.push(`identity_refresh_due (informational): ${ctx.identityRefreshDue ? "yes" : "no"}`);
    lines.push(
      `identity_reference_allowed_this_reply (authoritative): ${ctx.identityReferenceAllowed ? "yes" : "no"}`
    );
    lines.push(
      "- If identity_reference_allowed_this_reply is no: do not quote the stored identity anchor above; stay on the user's message and commitment."
    );
    lines.push(
      "- If yes: you MAY include at most one short grounding clause with the stored identity anchor verbatim as a substring; still tie to effective_coaching_ask; no guilt, no vague inspiration."
    );
  }
  lines.push("");
  lines.push(`USER_MESSAGE: ${truncateOneLine(ctx.userMessage, 320)}`);
  if (ctx.normalizedHint != null) {
    lines.push(`classifier_hint: ${ctx.normalizedHint}`);
  }
  lines.push("");
  const memBlock = formatCoachingMemoryPromptBlock(ctx.coachingMemory);
  if (memBlock) {
    lines.push(memBlock);
    lines.push("");
  }
  const eventSlice = ctx.coachingMemory ? 12 : 25;
  lines.push("RECENT_EVENTS (newest first, truncated):");
  for (const e of ctx.eventsNewestFirst.slice(0, eventSlice)) {
    lines.push(summarizeEventForPrompt(e));
  }
  lines.push("");
  if (ctx.lastOutboundNextMove != null) {
    lines.push(`LAST_OUTBOUND_NEXT_MOVE (from latest check_sent): ${ctx.lastOutboundNextMove}`);
    if (ctx.lastOutboundNextMove === "reset_day") {
      lines.push("- Yesterday's coach move was reset_day: keep inbound calm—no maximal pressure.");
    }
    if (ctx.lastOutboundNextMove === "shrink_ask") {
      lines.push("- Last move was shrink_ask: acknowledge the smaller bar; do not contradict it.");
    }
    if (ctx.lastOutboundNextMove === "recommit_same") {
      lines.push("- Last move was recommit_same: reinforce same commitment line.");
    }
    lines.push("");
  }

  if (ctx.brokePause) {
    lines.push(
      "BROKE_PAUSE (server-derived): User just texted while we were in low-pressure reactivation—treat as a clean return to normal accountability tone."
    );
    lines.push("- Warm, direct, zero guilt; do not scold for silence; no 'where have you been'.");
    lines.push("- Still exactly ONE concise accountability-style reply.");
  }
  if (ctx.afterSilence) {
    lines.push("REENTRY_TONE (server-derived): User is returning after a quiet stretch.");
    lines.push(
      `- after_silence: true, unanswered_checks=${ctx.unansweredChecks ?? "n/a"}, days_idle=${ctx.daysIdle ?? "n/a"}`
    );
    lines.push(
      "- Tone: clean return—warm and direct. No guilt, no 'where have you been', do not pretend nothing happened."
    );
    lines.push("- Still exactly ONE concise accountability-style reply; do not open a conversation loop.");
  }
  lines.push("");
  lines.push("RULES:");
  lines.push("VOICE_DOCTRINE:");
  lines.push("- Speak like Pat Summitt AI for accountability: direct, specific, tactical, human.");
  lines.push("- Hold the standard without shame. Keep it short.");
  lines.push("- This SMS may be the user's primary product experience.");
  lines.push(`- Max ${SMS_MAX_LEN} characters. One SMS. No newlines.`);
  lines.push("- Keep server strategy exactly. Do not change commitment state or cadence.");
  lines.push("- No fake hype, no therapy tone, no abusive or shaming language.");
  lines.push("- No invented facts; ground in USER_MESSAGE, RECENT_EVENTS, COACHING_MEMORY, and optional USER_ONBOARDING/IDENTITY context.");
  if (ctx.coachingMemory) {
    lines.push("- If COACHING_MEMORY conflicts with RECENT_EVENTS tail, trust COACHING_MEMORY structured lines.");
  }
  lines.push("- Keep commitment scope unchanged; do not add new goals, habits, or alternate commitments.");
  lines.push("- Do not claim unsupported personal or historical memory.");
  lines.push("- Tie the reply to this commitment (title or behavior), including paraphrase that still clearly references the same behavior.");
  lines.push("- Use the user's actual wording when it clarifies the blocker or pattern; do not invent interpretation.");
  lines.push("- Do not default to 'what worked / what didn’t' phrasing every time.");
  if (ctx.afterSilence || ctx.brokePause) {
    lines.push("- Avoid: where have you been, why didn't you, about time, you should have.");
  }
  lines.push("- reinforce_yes: at most ONE question mark total.");
  lines.push("- recommit_prompt and tighten_partial: exactly ONE question mark total.");
  lines.push("- For clear blocker patterns, a direct tactical next move can be better than another question.");
  lines.push("- strategy field MUST be exactly: " + ctx.serverStrategy);
  lines.push("EXAMPLES (style only, do not copy verbatim):");
  lines.push('- reinforce_yes: "Good. Logged as proof."');
  lines.push('- recommit_prompt: "No shame, let’s use the miss. What was the main blocker today?"');
  lines.push('- tighten_partial: "One hour is not nothing. What pulled you off finishing the full bar?"');
  lines.push('- after_silence tone: "Good return. Keep today simple and honest on <ask>."');
  lines.push('- clear blocker (allowed tactical): "You named it. Product tweaking was the escape hatch. Tomorrow, distribution first."');

  return lines.join("\n");
}

export async function tryGenerateV2InboundMessage(
  ctx: V2AiInboundContext
): Promise<V2AiInboundAttempt> {
  if (!isV2AiInboundEnabled()) {
    return { ok: false, fallbackUsed: true, reason: "ai_disabled" };
  }

  const client = getOpenAIClientOrNull();
  if (!client) {
    return { ok: false, fallbackUsed: true, reason: "no_openai_key" };
  }

  try {
    const completion = await client.chat.completions.create({
      model: V2_INBOUND_AI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildDeveloperPrompt(ctx) },
      ],
      temperature: 0.55,
      max_tokens: 220,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!raw) {
      return { ok: false, fallbackUsed: true, reason: "empty_model_output" };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ok: false, fallbackUsed: true, reason: "invalid_json" };
    }

    const message = typeof parsed.message === "string" ? parsed.message.trim().replace(/\n+/g, " ") : "";
    const modelStrategy = parsed.strategy;
    const validated = validateV2AiInboundMessage({
      message,
      serverStrategy: ctx.serverStrategy,
      modelStrategy,
      behaviorStatement: getEffectiveCoachingAsk(ctx.commitment),
      commitmentTitle: ctx.commitment.title,
      afterSilence: ctx.afterSilence,
      brokePause: ctx.brokePause,
      lastOutboundNextMove: ctx.lastOutboundNextMove,
      identityReferenceAllowed: ctx.identityReferenceAllowed,
      identityAnchorText: ctx.identityAnchorText ?? null,
    });
    if (!validated.ok) {
      return { ok: false, fallbackUsed: true, reason: validated.reason };
    }

    let confidence: number | null = null;
    if (typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)) {
      const c = parsed.confidence;
      if (c >= 0 && c <= 1) confidence = c;
    }

    return { ok: true, message, confidence, fallbackUsed: false };
  } catch (err) {
    console.error("[v2-ai-inbound] OpenAI call failed", err);
    return { ok: false, fallbackUsed: true, reason: "openai_error" };
  }
}

/**
 * Stored on user_yes / user_no / user_partial `payload_json.ai` (aligned with outbound: stable keys, explicit nulls).
 */
export function buildUserReplyAiPayload(args: {
  model: string;
  promptVersion: string;
  serverStrategy: V2InboundReplyStrategy;
  message: string;
  confidence: number | null | undefined;
  fallbackUsed: boolean;
  fallbackReason?: string | null;
}): Record<string, unknown> {
  return {
    model: args.model,
    prompt_version: args.promptVersion,
    server_strategy: args.serverStrategy,
    message: args.message,
    confidence: args.confidence ?? null,
    fallback_used: args.fallbackUsed,
    fallback_reason: args.fallbackUsed ? (args.fallbackReason ?? "unknown") : null,
  };
}

export type V2ContractConsentAckKind = "overlay_activated_ack" | "overlay_declined_ack";

const CONTRACT_ACK_STRATEGY: Record<V2ContractConsentAckKind, string> = {
  overlay_activated_ack: "contract_ack_activated",
  overlay_declined_ack: "contract_ack_declined",
};

function validateV2ContractConsentAckMessage(args: {
  kind: V2ContractConsentAckKind;
  message: string;
  modelStrategy: unknown;
  bindingText?: string | null;
  behaviorStatement: string;
  commitmentTitle: string;
}): { ok: true } | { ok: false; reason: string } {
  const msg = (args.message || "").trim().replace(/\s+/g, " ").replace(/\n+/g, " ");
  if (!msg) return { ok: false, reason: "empty_message" };
  if (msg.length > SMS_MAX_LEN) return { ok: false, reason: "too_long" };
  const expected = CONTRACT_ACK_STRATEGY[args.kind];
  if (typeof args.modelStrategy !== "string" || args.modelStrategy.trim() !== expected) {
    return { ok: false, reason: "strategy_mismatch" };
  }
  if (!passesLexicalGuards(msg)) return { ok: false, reason: "lexical_guard" };
  const b = args.bindingText?.trim();
  if (args.kind === "overlay_activated_ack" && b) {
    const needle = b.toLowerCase().slice(0, 28);
    if (needle.length >= 12 && !msg.toLowerCase().includes(needle)) {
      return { ok: false, reason: "missing_binding_substring" };
    }
  }
  const ml = msg.toLowerCase();
  if (!passesCommitmentGrounding(ml, args.behaviorStatement, args.commitmentTitle)) {
    return { ok: false, reason: "missing_commitment_grounding" };
  }
  return { ok: true };
}

/**
 * Optional AI packaging for shrink overlay consent acknowledgments (server already decided outcome).
 */
export async function tryGenerateV2ContractConsentAckMessage(args: {
  kind: V2ContractConsentAckKind;
  bindingText: string | null;
  /** When known, steers copy away from "smaller bar" for recommit_same. */
  overlayContractKind?: "shrink_ask" | "recommit_same" | null;
  originalBehaviorStatement: string;
  commitmentTitle: string;
  preferredName: string | null;
}): Promise<V2AiInboundAttempt> {
  if (!isV2AiInboundEnabled()) {
    return { ok: false, fallbackUsed: true, reason: "ai_disabled" };
  }
  const client = getOpenAIClientOrNull();
  if (!client) return { ok: false, fallbackUsed: true, reason: "no_openai_key" };

  const serverStrategy = CONTRACT_ACK_STRATEGY[args.kind];
  const lines: string[] = [];
  lines.push("You write ONE short SMS acknowledging the user's reply to a contract proposal.");
  lines.push("Return ONLY valid JSON with keys: strategy, message, confidence (0-1 number or null).");
  lines.push(`server_strategy (authoritative): ${serverStrategy}`);
  lines.push("strategy in your JSON MUST exactly equal server_strategy.");
  lines.push(`kind: ${args.kind}`);
  if (args.overlayContractKind) {
    lines.push(`overlay_contract_kind (authoritative): ${args.overlayContractKind}`);
  }
  lines.push(`original_behavior_statement: ${truncateOneLine(args.originalBehaviorStatement, 200)}`);
  lines.push(`commitment_title: ${truncateOneLine(args.commitmentTitle, 80)}`);
  if (args.bindingText?.trim()) {
    lines.push(
      `BINDING_TEXT (must appear verbatim as substring if kind is overlay_activated_ack): ${truncateOneLine(args.bindingText, 200)}`
    );
  }
  if (args.preferredName?.trim()) {
    lines.push(
      `Preferred name Coach Pat should use: ${truncateOneLine(args.preferredName, 40)}`
    );
  }
  lines.push("");
  lines.push("RULES:");
  lines.push(`- Max ${SMS_MAX_LEN} characters. One SMS. No newlines.`);
  lines.push("- Coach Pat: calm, direct. No shame. No therapy language.");
  lines.push("- Do not mention AI. Do not add new goals.");
  if (args.kind === "overlay_activated_ack") {
    if (args.overlayContractKind === "recommit_same") {
      lines.push(
        "- Confirm the explicit same-bar recommit overlay is active for 7 days; BINDING_TEXT verbatim in the message. Do not call it a smaller bar."
      );
    } else {
      lines.push("- Confirm the smaller bar is active for 7 days; BINDING_TEXT verbatim in the message.");
    }
  } else {
    lines.push("- Confirm you're keeping their current bar; tie to original_behavior_statement.");
    if (args.overlayContractKind === "recommit_same") {
      lines.push("- They declined the temporary same-bar lock-in—not a shrink.");
    }
  }

  try {
    const completion = await client.chat.completions.create({
      model: V2_INBOUND_AI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: lines.join("\n") },
      ],
      temperature: 0.45,
      max_tokens: 160,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!raw) return { ok: false, fallbackUsed: true, reason: "empty_model_output" };
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ok: false, fallbackUsed: true, reason: "invalid_json" };
    }
    const message = typeof parsed.message === "string" ? parsed.message.trim().replace(/\n+/g, " ") : "";
    const modelStrategy = parsed.strategy;
    const validated = validateV2ContractConsentAckMessage({
      kind: args.kind,
      message,
      modelStrategy,
      bindingText: args.bindingText,
      behaviorStatement: args.originalBehaviorStatement,
      commitmentTitle: args.commitmentTitle,
    });
    if (!validated.ok) {
      return { ok: false, fallbackUsed: true, reason: validated.reason };
    }
    let confidence: number | null = null;
    if (typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)) {
      const c = parsed.confidence;
      if (c >= 0 && c <= 1) confidence = c;
    }
    return { ok: true, message, confidence, fallbackUsed: false };
  } catch (err) {
    console.error("[v2-ai-inbound] contract consent ack OpenAI failed", err);
    return { ok: false, fallbackUsed: true, reason: "openai_error" };
  }
}
