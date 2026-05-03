import OpenAI from "openai";

import type { ActiveV2CommitmentRow, V2EventRowForAi } from "@/lib/v2-commitment";
import type { V2SmsConversationContextPack } from "@/lib/v2-sms-conversation-context";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { identityAnchorLeakDetected } from "@/lib/v2-identity-anchor";
import {
  formatCoachingMemoryPromptBlock,
  type V2CoachingMemoryForPrompt,
} from "@/lib/v2-coaching-memory-prompt";
import type { V2NextMoveType } from "@/lib/v2-ai-outbound";
import type { ProofMomentPromptHint } from "@/lib/v2-proof-moment";
import {
  capPreferredNameForInboundSms,
  formatInboundFallbackPreferredOpening,
  getShortCommitmentPhraseForSms,
  messageHasKeywordPartialLanguage,
  type V2InboundEventType,
} from "@/lib/v2-sms-accountability";
import { shouldRunHumanSmsPipelineForContractConsent } from "@/lib/v2-human-sms-brain/flags";
import { isRoboticAccountabilityMenuLanguage } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";

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

/**
 * Shadow interpretation: logs evidence only — does NOT control `user_*` writes.
 * Env: explicit `true`/`1` on; explicit `false`/`0` off; unset defaults to NODE_ENV==="development".
 */
export function isV2AiInboundInterpretationShadowEnabled(): boolean {
  const v = process.env.V2_AI_INBOUND_INTERPRETATION_SHADOW_ENABLED?.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return process.env.NODE_ENV === "development";
}

/**
 * Wave 2.1: AI may adjust normal accountability outcome under server policy.
 * Env: explicit true/1 on; false/0 off; unset defaults to OFF except NODE_ENV===development.
 */
export function isV2AiInboundGatedOutcomesEnabled(): boolean {
  const v = process.env.V2_AI_INBOUND_GATED_OUTCOMES_ENABLED?.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return process.env.NODE_ENV === "development";
}

/** Run OpenAI interpretation when shadow evidence and/or gated outcomes need it. */
export function isV2InboundInterpretationRequested(): boolean {
  return isV2AiInboundInterpretationShadowEnabled() || isV2AiInboundGatedOutcomesEnabled();
}

export const V2_INBOUND_SHADOW_INTERPRETATION_PROMPT_VERSION = "v2_inbound_shadow_interp_v1";

const REASONING_SHORT_MAX = 280;
const SUGGESTED_REPLY_STORE_MAX = 280;

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
      : typeof p.message_preview === "string"
        ? truncateOneLine(p.message_preview, 100)
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

  const hygieneEarly = inboundCoachComplianceHygieneFailReason(msg);
  if (hygieneEarly) return { ok: false, reason: hygieneEarly };
  if (/\breply\s+(yes|no|partial)\b/i.test(msg)) return { ok: false, reason: "robotic_menu" };

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
  /** Wave 6: bounded RECENT_SMS_CONTEXT block from `buildV2SmsConversationContextPack`. */
  recentSmsContextBlock?: string | null;
  /** Wave 12: optional server-grounded proof moment for natural echo (medium/strong only). */
  proofMomentForPrompt?: ProofMomentPromptHint | null;
};

const SYSTEM_PROMPT = `You are Pat Summitt AI for inbound accountability SMS replies.
Voice: direct, specific, tactical, human, calm — like texting a coach, not a compliance bot.
Hold the standard without shame.
Never include STOP/START/HELP opt-out language or all-caps command menus in the SMS body.
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
  if (ctx.recentSmsContextBlock?.trim()) {
    lines.push(ctx.recentSmsContextBlock.trim());
    lines.push("");
  }
  if (ctx.preferredName?.trim()) {
    lines.push(
      `Preferred name is available for context (${truncateOneLine(ctx.preferredName, 40)}). Do not overuse it. Avoid starting with their name—the server may add a short greeting.`
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
      "USER_ONBOARDING (answered in app at signup/onboarding; may be months old—wording and empathy only—never replaces USER_MESSAGE or COMMITMENT):"
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
  if (ctx.proofMomentForPrompt) {
    lines.push("");
    lines.push("SERVER_PROOF_MOMENT (authoritative; optional—one short clause max if it fits naturally):");
    lines.push(`- type: ${ctx.proofMomentForPrompt.proof_moment_type}`);
    lines.push(`- weight: ${ctx.proofMomentForPrompt.proof_weight}`);
    lines.push(`- line: ${truncateOneLine(ctx.proofMomentForPrompt.user_visible_proof_line, 180)}`);
    lines.push(
      "- You may echo this flavor without copying verbatim; skip if the reply would already say the same thing."
    );
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
  lines.push(
    "- LIVING_PROFILE: USER_ONBOARDING lines may be stale; RECENT_SMS_CONTEXT / RECENT_EVENTS / COACHING_MEMORY can supersede when clearly reflected in the user’s latest messages. Do not quote sensitive onboarding as fact; ask before treating a life change as durable."
  );
  lines.push(
    "- Commitment bar changes are server-routed (SMS tighten/replace flows)—do not claim you rewrote the commitment from this reply."
  );
  lines.push("- Identity anchor edits require explicit user confirmation elsewhere—never overwrite from chat alone.");
  lines.push("- Keep commitment scope unchanged; do not add new goals, habits, or alternate commitments.");
  lines.push("- Do not claim unsupported personal or historical memory.");
  lines.push("- Tie the reply to this commitment (title or behavior), including paraphrase that still clearly references the same behavior.");
  lines.push(
    "- If RECENT_SMS_CONTEXT includes EVOLUTION_HINT: server advisory only—the commitment was not changed by that hint; never claim it was rewritten; if they want a smaller bar or new goal, stay human and brief (SMS tighten/replace flows handle structured changes)."
  );
  lines.push("- Use the user's actual wording when it clarifies the blocker or pattern; do not invent interpretation.");
  lines.push("- Do not default to 'what worked / what didn’t' phrasing every time.");
  lines.push(
    "- Never include STOP/START/HELP opt-out lines, \"Reply YES/NO\", or refresh-style command menus—normal coaches don't text like that."
  );
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
  smsContextPackMeta?: V2SmsConversationContextPack["meta"] | null;
}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    model: args.model,
    prompt_version: args.promptVersion,
    server_strategy: args.serverStrategy,
    message: args.message,
    confidence: args.confidence ?? null,
    fallback_used: args.fallbackUsed,
    fallback_reason: args.fallbackUsed ? (args.fallbackReason ?? "unknown") : null,
  };
  const m = args.smsContextPackMeta;
  if (m) {
    base.sms_context_pack_used = true;
    base.transcript_line_count = m.transcript_line_count;
    base.recent_event_count = m.recent_event_count;
    base.proof_highlight_used = m.proof_highlight_used;
    base.blocker_pattern_used = m.blocker_pattern_used;
  }
  return base;
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
  const ackHygiene = inboundCoachComplianceHygieneFailReason(msg);
  if (ackHygiene) return { ok: false, reason: ackHygiene };
  if (/\breply\s+(yes|no|partial)\b/i.test(msg)) return { ok: false, reason: "robotic_menu" };
  return { ok: true };
}

/** Phase 1 — skips substring/grounding checks so Human SMS Brain + validateHumanVisibleSms can finalize copy. */
function validateV2ContractConsentAckMessageLite(args: {
  kind: V2ContractConsentAckKind;
  message: string;
  modelStrategy: unknown;
}): { ok: true } | { ok: false; reason: string } {
  const msg = (args.message || "").trim().replace(/\s+/g, " ").replace(/\n+/g, " ");
  if (!msg) return { ok: false, reason: "empty_message" };
  if (msg.length > SMS_MAX_LEN) return { ok: false, reason: "too_long" };
  const expected = CONTRACT_ACK_STRATEGY[args.kind];
  if (typeof args.modelStrategy !== "string" || args.modelStrategy.trim() !== expected) {
    return { ok: false, reason: "strategy_mismatch" };
  }
  if (!passesLexicalGuards(msg)) return { ok: false, reason: "lexical_guard" };
  const ackHygiene = inboundCoachComplianceHygieneFailReason(msg);
  if (ackHygiene) return { ok: false, reason: ackHygiene };
  if (isRoboticAccountabilityMenuLanguage(msg)) return { ok: false, reason: "robotic_menu" };
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
  lines.push("You write ONE short SMS acknowledging the user's reply to a pending contract-style update.");
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
      `Preferred name is available for context (${truncateOneLine(args.preferredName, 40)}). Do not overuse it. Avoid starting with their name—the server may add a short greeting.`
    );
  }
  lines.push("");
  lines.push("RULES:");
  lines.push(`- Max ${SMS_MAX_LEN} characters. One SMS. No newlines.`);
  lines.push("- Coach Pat: calm, direct. No shame. No therapy language.");
  lines.push("- Do not mention AI. Do not add new goals.");
  lines.push("- No STOP/START/HELP opt-out wording. Say daily check-ins in plain language—not \"Text YES/NO/PARTIAL\".");
  if (args.kind === "overlay_activated_ack") {
    if (args.overlayContractKind === "recommit_same") {
      lines.push(
        "- Confirm they chose to keep the same bar steady for about a week; include BINDING_TEXT verbatim. Do not call it a smaller bar."
      );
    } else {
      lines.push("- Confirm the smaller bar is active for 7 days; BINDING_TEXT verbatim in the message.");
    }
  } else {
    lines.push("- Confirm you're keeping their current bar; tie to original_behavior_statement.");
    if (args.overlayContractKind === "recommit_same") {
      lines.push("- They declined holding the same bar steady for a week—not a shrink.");
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
    const useHumanPipelineLite = shouldRunHumanSmsPipelineForContractConsent();
    const validated = useHumanPipelineLite
      ? validateV2ContractConsentAckMessageLite({
          kind: args.kind,
          message,
          modelStrategy,
        })
      : validateV2ContractConsentAckMessage({
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

// ---- Shadow inbound interpretation (Wave 2.0: evidence only; server classifier remains authoritative) ----

export type V2InboundShadowInterpretationIntent =
  | "accountability_reply"
  | "meta_question"
  | "repair_prior"
  | "commitment_change_request"
  | "opt_out_soft"
  | "small_talk"
  | "unclear";

export type V2InboundShadowProposedOutcomeKey = "yes" | "no" | "partial";

const SHADOW_INTENTS = new Set<V2InboundShadowInterpretationIntent>([
  "accountability_reply",
  "meta_question",
  "repair_prior",
  "commitment_change_request",
  "opt_out_soft",
  "small_talk",
  "unclear",
]);

const SHADOW_SYSTEM_PROMPT = `You are Pat Summitt Mindset's silent INTERPRETER for inbound SMS accountability replies.
You ONLY output one JSON object matching the schema. No coaching text to the user is sent from this step.
You must not shame, diagnose, or invent facts. Do not claim to have changed any database or commitment before server confirmation.
If unsure about yes/no/partial, set proposed_outcome null and needs_clarification true.
Prefer null proposed_outcome over guessing partial when evidence is weak.
Life-story updates vs accountability: interpreting today's yes/no/partial does not rewrite stored profile; separate memory signals handle durable facts elsewhere.`;

export type V2InboundInterpretationShadowInput = {
  commitment: ActiveV2CommitmentRow;
  userMessage: string;
  /** Classifier result (authoritative for writes; you may disagree in fields). */
  deterministicEventType: V2InboundEventType;
  deterministicNormalizedHint: string | null;
  effectiveAsk: string;
  eventsNewestFirst: V2EventRowForAi[];
  coachingMemory: V2CoachingMemoryForPrompt | null;
  preferredName: string | null;
  lastOutboundSmsPreview: string | null;
  lastOutboundNextMove: V2NextMoveType | null;
  latestBlockerPreview: string | null;
  adaptiveProposalPending: boolean;
  pendingResolutionKind: string | null;
  pendingResolutionExpiresAt: string | null;
  /** SMS Wave 4.1 — user may be in tighten/replace flow, not daily accountability. */
  pendingResolutionSmsState: string | null;
  pendingResolutionSmsInbound: boolean;
  refreshSessionActive: boolean;
  afterSilence: boolean;
  brokePause?: boolean;
  /** Truncated onboarding context for tone only; do not treat as quotable identity. */
  relationshipContextTruncated?: string | null;
  /** Wave 6: bounded thread memory from `buildV2SmsConversationContextPack`. */
  recentSmsContextBlock?: string | null;
};

export type V2InboundShadowInterpretationParsed = {
  version: 1;
  intent: V2InboundShadowInterpretationIntent;
  proposed_outcome: V2InboundShadowProposedOutcomeKey | null;
  confidence: number;
  needs_clarification: boolean;
  clarification_question: string | null;
  is_repair: boolean;
  repair_of: "prior_misread" | "prior_event" | "unknown" | null;
  user_asks_question: boolean;
  suggests_commitment_change: boolean;
  blocker_likely: boolean;
  discouraged_or_frustrated: boolean;
  substitution_counts: boolean;
  opt_out_like_but_not_stop: boolean;
  reasoning_short: string;
  suggested_reply: string;
};

export type V2InboundShadowInterpretationResult =
  | { ok: true; data: V2InboundShadowInterpretationParsed; model: string }
  | { ok: false; shadow_ai_failed: true; reason: string; model: string | null };

export function deterministicEventTypeToProposedKey(
  eventType: V2InboundEventType
): V2InboundShadowProposedOutcomeKey {
  if (eventType === "user_yes") return "yes";
  if (eventType === "user_no") return "no";
  return "partial";
}

function truncateStore(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ").replace(/\n+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function parseRepairOf(
  v: unknown
): "prior_misread" | "prior_event" | "unknown" | null {
  if (v === "prior_misread" || v === "prior_event" || v === "unknown") return v;
  return null;
}

function parseProposedOutcome(v: unknown): V2InboundShadowProposedOutcomeKey | null {
  if (v === "yes" || v === "no" || v === "partial") return v;
  if (v == null) return null;
  return null;
}

function parseIntent(v: unknown): V2InboundShadowInterpretationIntent | null {
  if (typeof v !== "string") return null;
  const x = v.trim() as V2InboundShadowInterpretationIntent;
  return SHADOW_INTENTS.has(x) ? x : null;
}

/** Validate model JSON → typed object or null (never throws). */
export function parseAndValidateShadowInterpretation(
  raw: Record<string, unknown>
): V2InboundShadowInterpretationParsed | null {
  if (raw.version !== 1) return null;

  const intent = parseIntent(raw.intent);
  if (!intent) return null;

  const proposed_outcome = parseProposedOutcome(raw.proposed_outcome);

  let confidence = 0;
  if (typeof raw.confidence === "number" && Number.isFinite(raw.confidence)) {
    confidence = Math.min(1, Math.max(0, raw.confidence));
  } else {
    return null;
  }

  const needs_clarification = raw.needs_clarification === true;

  let clarification_question: string | null = null;
  if (typeof raw.clarification_question === "string" && raw.clarification_question.trim()) {
    clarification_question = truncateStore(raw.clarification_question, 200);
  }

  const reasoning_short =
    typeof raw.reasoning_short === "string"
      ? truncateStore(raw.reasoning_short, REASONING_SHORT_MAX)
      : "";

  let suggested_reply =
    typeof raw.suggested_reply === "string"
      ? truncateStore(raw.suggested_reply, SUGGESTED_REPLY_STORE_MAX)
      : "";

  if (!reasoning_short) return null;

  if (!suggested_reply) suggested_reply = "(empty)";

  return {
    version: 1,
    intent,
    proposed_outcome,
    confidence,
    needs_clarification,
    clarification_question,
    is_repair: raw.is_repair === true,
    repair_of: parseRepairOf(raw.repair_of),
    user_asks_question: raw.user_asks_question === true,
    suggests_commitment_change: raw.suggests_commitment_change === true,
    blocker_likely: raw.blocker_likely === true,
    discouraged_or_frustrated: raw.discouraged_or_frustrated === true,
    substitution_counts: raw.substitution_counts === true,
    opt_out_like_but_not_stop: raw.opt_out_like_but_not_stop === true,
    reasoning_short,
    suggested_reply,
  };
}

function buildShadowInterpretationUserPrompt(args: V2InboundInterpretationShadowInput): string {
  const lines: string[] = [];
  lines.push("Interpret the user's latest SMS reply in the accountability check-in thread.");
  lines.push("");
  lines.push(
    "OUTPUT: Return ONLY valid JSON matching this schema (exact keys):"
  );
  lines.push(
    '{"version":1,"intent":"<accountability_reply|meta_question|repair_prior|commitment_change_request|opt_out_soft|small_talk|unclear>","proposed_outcome":"<yes|no|partial|null>","confidence":0-1,"needs_clarification":bool,"clarification_question":string|null,"is_repair":bool,"repair_of":"<prior_misread|prior_event|unknown|null>","user_asks_question":bool,"suggests_commitment_change":bool,"blocker_likely":bool,"discouraged_or_frustrated":bool,"substitution_counts":bool,"opt_out_like_but_not_stop":bool,"reasoning_short":"<max ~2 sentences>","suggested_reply":"<what Pat might text back; never sent automatically from this interpreter>"}'
  );
  lines.push("");
  lines.push("SERVER_CLASSIFIER_HINT (deterministic classifier already ran; authoritative for spine today):");
  lines.push(`- deterministic_event_type: ${args.deterministicEventType}`);
  if (args.deterministicNormalizedHint != null) {
    lines.push(`- deterministic_normalized_hint: ${args.deterministicNormalizedHint}`);
  }
  lines.push("");
  lines.push("COMMITMENT:");
  lines.push(`- title: ${truncateOneLine(args.commitment.title, 90)}`);
  lines.push(`- behavior_statement: ${truncateOneLine(args.commitment.behavior_statement, 220)}`);
  lines.push(`- effective_coaching_ask: ${truncateOneLine(args.effectiveAsk, 220)}`);
  lines.push("");
  lines.push(`USER_LATEST_REPLY: ${truncateOneLine(args.userMessage, 400)}`);
  lines.push("");
  if (args.recentSmsContextBlock?.trim()) {
    lines.push(args.recentSmsContextBlock.trim());
    lines.push("");
  }
  if (args.preferredName?.trim()) {
    lines.push(
      `Preferred name is available for context (${truncateOneLine(args.preferredName, 40)}). Do not overuse it. Avoid starting with their name—the server may add a short greeting.`
    );
  }
  if (args.relationshipContextTruncated?.trim()) {
    lines.push(
      `Relationship_context_TRUNCATED_tone_only_do_not_quote: ${truncateOneLine(args.relationshipContextTruncated, 140)}`
    );
  }
  lines.push("");
  if (args.lastOutboundSmsPreview?.trim()) {
    lines.push(`LAST_ACCOUNTABILITY_PROMPT_TRUNCATED: ${truncateOneLine(args.lastOutboundSmsPreview, 260)}`);
  } else {
    lines.push("LAST_ACCOUNTABILITY_PROMPT_TRUNCATED: (unavailable)");
  }
  if (args.lastOutboundNextMove != null) {
    lines.push(`last_check_next_move_hint: ${args.lastOutboundNextMove}`);
  }
  lines.push("");
  lines.push("STATE_FLAGS (do not mutate; factual):");
  lines.push(`- adaptive_proposal_pending: ${args.adaptiveProposalPending}`);
  lines.push(`- refresh_session_active_on_commitment_row: ${args.refreshSessionActive}`);
  lines.push(
    `- pending_resolution_kind: ${args.pendingResolutionKind ?? "null"} expires: ${args.pendingResolutionExpiresAt ?? "null"}`
  );
  if (args.pendingResolutionSmsInbound) {
    lines.push(
      "PENDING_SMS_COMMITMENT_UPDATE: user may be answering tighten/replace via SMS, not today’s accountability check."
    );
    lines.push(`- sms_pending_state: ${args.pendingResolutionSmsState ?? "unknown"}`);
    lines.push(
      "- Do not treat short replies as yes/no/partial accountability outcomes unless they clearly answer today’s check (unusual while this SMS update is open)."
    );
    lines.push("- Ask for one clear daily action when extracting a bar; do not claim any commitment mutation occurred.");
  }
  lines.push(`- after_silence_context: ${args.afterSilence}`);
  if (args.brokePause) lines.push("- user may have broken low_pressure reactivation this turn");

  const mem = formatCoachingMemoryPromptBlock(args.coachingMemory);
  if (mem) {
    lines.push("");
    lines.push(mem);
  }

  if (args.latestBlockerPreview?.trim()) {
    lines.push("");
    lines.push(
      `recent_blocker_preview_if_any: ${truncateOneLine(args.latestBlockerPreview, 140)}`
    );
  }

  lines.push("");
  lines.push(
    `RECENT_EVENTS new→old (truncate):`
  );
  for (const e of args.eventsNewestFirst.slice(0, 18)) {
    lines.push(summarizeEventForPrompt(e));
  }
  lines.push("");
  lines.push("RULES:");
  lines.push("- Your job is interpretation only.");
  lines.push(
    "- Onboarding snippets in context may be stale; prioritize USER_LATEST_REPLY + RECENT_EVENTS for what happened today—do not treat profile hints as fresh facts."
  );
  lines.push(
    "- If RECENT_SMS_CONTEXT includes EVOLUTION_HINT: that signal does not change commitments server-side; classify replies normally—commitment_change_request vs accountability_reply still applies when they ask to tighten/replace."
  );
  lines.push("- proposed_outcome=yes/no/partial when the reply clearly answers today's bar; otherwise null.");
  lines.push("- If the user corrects prior coach understanding, indicates substitution (e.g. different tool completed the same intent), asks what you meant, or says they already did it — use repair_prior or meta_question and is_repair as appropriate.");
  lines.push("- If they want a smaller commitment or different goal → commitment_change_request; do not mutate state.");
  lines.push("- discouraged_or_frustrated when tone suggests giving up frustration (not STOP). opt_out_like_but_not_stop for soft quit/stop-ish language.");
  lines.push(
    "- If they vent about the commitment (quit, done, can't, pointless) but are NOT asking to stop SMS subscription → commitment_change_request (not opt_out_soft). Reserve opt_out_soft for stopping texts."
  );
  lines.push("- needs_clarification true when ambiguous; clarification_question optional short.");
  lines.push(
    "- suggested_reply: natural Pat tone; bounded length; never include STOP/START/HELP, compliance footers, or all-caps command menus."
  );
  lines.push(
    "- suggested_reply must NOT claim the commitment was rewritten or updated unless server events already did—invite the next honest detail instead."
  );
  return lines.join("\n");
}

/** Non-throwing; safe for cron. Does not mutate. */
export async function interpretV2InboundAccountabilityReply(
  args: V2InboundInterpretationShadowInput
): Promise<V2InboundShadowInterpretationResult> {
  if (!isV2InboundInterpretationRequested()) {
    return { ok: false, shadow_ai_failed: true, reason: "interpretation_disabled", model: null };
  }

  const client = getOpenAIClientOrNull();
  if (!client) {
    return { ok: false, shadow_ai_failed: true, reason: "no_openai_key", model: null };
  }

  try {
    const completion = await client.chat.completions.create({
      model: V2_INBOUND_AI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SHADOW_SYSTEM_PROMPT },
        { role: "user", content: buildShadowInterpretationUserPrompt(args) },
      ],
      temperature: 0.35,
      max_tokens: 450,
    });

    const rawStr = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!rawStr) {
      return { ok: false, shadow_ai_failed: true, reason: "empty_model_output", model: V2_INBOUND_AI_MODEL };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawStr) as Record<string, unknown>;
    } catch {
      return { ok: false, shadow_ai_failed: true, reason: "invalid_json", model: V2_INBOUND_AI_MODEL };
    }

    const data = parseAndValidateShadowInterpretation(parsed);
    if (!data) {
      return { ok: false, shadow_ai_failed: true, reason: "validation_failed", model: V2_INBOUND_AI_MODEL };
    }

    return { ok: true, data, model: V2_INBOUND_AI_MODEL };
  } catch (err) {
    console.error("[v2-ai-inbound] shadow interpretation OpenAI failed", err);
    return { ok: false, shadow_ai_failed: true, reason: "openai_error", model: V2_INBOUND_AI_MODEL };
  }
}

/** Compact storable blob for `v2_commitment_event.payload_json.shadow_interpretation` (bounded). */
export function buildStoredShadowInterpretationPayload(args: {
  interpretationResult: V2InboundShadowInterpretationResult;
  deterministicEventType: V2InboundEventType;
  deterministicNormalizedHint: string | null;
  smsContextPackMeta?: V2SmsConversationContextPack["meta"] | null;
}): Record<string, unknown> {
  const detKey = deterministicEventTypeToProposedKey(args.deterministicEventType);
  const base: Record<string, unknown> = {
    prompt_version: V2_INBOUND_SHADOW_INTERPRETATION_PROMPT_VERSION,
    deterministic_event_type: args.deterministicEventType,
    deterministic_normalized_hint: args.deterministicNormalizedHint,
    deterministic_outcome_key: detKey,
  };
  const scm = args.smsContextPackMeta;
  if (scm) {
    base.sms_context_pack_used = true;
    base.transcript_line_count = scm.transcript_line_count;
    base.recent_event_count = scm.recent_event_count;
    base.proof_highlight_used = scm.proof_highlight_used;
    base.blocker_pattern_used = scm.blocker_pattern_used;
  }

  if (!args.interpretationResult.ok) {
    return {
      ...base,
      shadow_ai_failed: true,
      failure_reason: args.interpretationResult.reason,
      model: args.interpretationResult.model,
    };
  }

  const d = args.interpretationResult.data;
  const aiAgrees =
    d.proposed_outcome != null && d.proposed_outcome === detKey;
  const wouldClarify = d.needs_clarification === true;

  return {
    ...base,
    shadow_ai_failed: false,
    model: args.interpretationResult.model,
    ai_intent: d.intent,
    ai_proposed_outcome: d.proposed_outcome,
    ai_confidence: d.confidence,
    ai_needs_clarification: d.needs_clarification,
    ai_is_repair: d.is_repair,
    ai_repair_of: d.repair_of,
    ai_user_asks_question: d.user_asks_question,
    ai_suggests_commitment_change: d.suggests_commitment_change,
    ai_blocker_likely: d.blocker_likely,
    ai_discouraged_or_frustrated: d.discouraged_or_frustrated,
    ai_substitution_counts: d.substitution_counts,
    ai_opt_out_like_but_not_stop: d.opt_out_like_but_not_stop,
    ai_reasoning_short: d.reasoning_short,
    ai_suggested_reply_truncated: d.suggested_reply,
    ai_clarification_question: d.clarification_question,
    ai_agrees_with_classifier: aiAgrees,
    ai_would_have_asked_clarification: wouldClarify,
  };
}

// ---- Wave 2.1: server-gated inbound outcomes (normal accountability path only) ----

export const V2_INBOUND_GATED_HIGH_CONFIDENCE = 0.85;
export const V2_INBOUND_GATED_MID_CONFIDENCE = 0.7;
export const V2_INBOUND_GATED_PARTIAL_ACCEPT_CONFIDENCE = 0.85;
export const V2_INBOUND_GATED_EXTREME_OVERRIDE_CONFIDENCE = 0.92;

export type V2InboundGatedMode =
  | "use_deterministic"
  | "use_ai_outcome"
  | "clarify"
  | "repair_reply_only"
  | "commitment_change_handoff"
  | "soft_opt_out_reply";

export type V2InboundGatedReplyStyle =
  | "normal_outcome"
  | "clarification"
  | "repair"
  | "commitment_change"
  | "soft_opt_out";

export type V2InboundGatedDecision = {
  mode: V2InboundGatedMode;
  final_event_type: V2InboundEventType | null;
  decision_reason: string;
  confidence_used: number | null;
  should_write_outcome_event: boolean;
  should_open_blocker_capture: boolean;
  reply_style: V2InboundGatedReplyStyle;
  clarification_question?: string;
  repair_note?: string;
  overrode_deterministic: boolean;
  supplement_commitment_change_guidance?: boolean;
};

function proposedKeyToEventType(k: V2InboundShadowProposedOutcomeKey): V2InboundEventType {
  if (k === "yes") return "user_yes";
  if (k === "no") return "user_no";
  return "user_partial";
}

function hasClearAccountabilityAnswer(
  det: V2InboundEventType,
  ai: V2InboundShadowInterpretationParsed
): boolean {
  if (det === "user_yes" || det === "user_no") return true;
  if (
    (ai.proposed_outcome === "yes" || ai.proposed_outcome === "no") &&
    ai.confidence >= V2_INBOUND_GATED_HIGH_CONFIDENCE &&
    !ai.needs_clarification &&
    (ai.intent === "accountability_reply" || ai.intent === "repair_prior")
  ) {
    return true;
  }
  return false;
}

export function defaultGatedDecision(det: V2InboundEventType, reason: string): V2InboundGatedDecision {
  return {
    mode: "use_deterministic",
    final_event_type: det,
    decision_reason: reason,
    confidence_used: null,
    should_write_outcome_event: true,
    should_open_blocker_capture: det === "user_no" || det === "user_partial",
    reply_style: "normal_outcome",
    overrode_deterministic: false,
  };
}

/**
 * When gated outcomes are off or interpretation failed, returns deterministic spine.
 * Otherwise applies conservative server policy to AI interpretation.
 */
export function resolveV2InboundGatedDecision(args: {
  gatedEnabled: boolean;
  interpretation: V2InboundShadowInterpretationResult | null;
  deterministicEventType: V2InboundEventType;
  deterministicNormalizedHint: string | null;
  rawInboundBody: string;
}): V2InboundGatedDecision {
  if (!args.gatedEnabled) {
    return defaultGatedDecision(args.deterministicEventType, "gated_disabled");
  }
  if (!args.interpretation) {
    return defaultGatedDecision(args.deterministicEventType, "no_interpretation_result");
  }
  return decideV2InboundOutcomeFromInterpretation({
    deterministicEventType: args.deterministicEventType,
    deterministicNormalizedHint: args.deterministicNormalizedHint,
    rawInboundBody: args.rawInboundBody,
    interpretation: args.interpretation,
  });
}

export function decideV2InboundOutcomeFromInterpretation(args: {
  deterministicEventType: V2InboundEventType;
  deterministicNormalizedHint: string | null;
  rawInboundBody: string;
  interpretation: V2InboundShadowInterpretationResult;
}): V2InboundGatedDecision {
  const det = args.deterministicEventType;
  if (!args.interpretation.ok) {
    return defaultGatedDecision(det, "ai_interpretation_failed");
  }
  const raw = args.rawInboundBody.trim();
  const ai = args.interpretation.data;
  const conf = ai.confidence;
  const aiKey = ai.proposed_outcome;

  const commitmentSignals =
    ai.intent === "commitment_change_request" || ai.suggests_commitment_change === true;
  const clearAnswer = hasClearAccountabilityAnswer(det, ai);

  if (ai.intent === "opt_out_soft" || ai.opt_out_like_but_not_stop === true) {
    return {
      mode: "soft_opt_out_reply",
      final_event_type: null,
      decision_reason: "soft_opt_out_intent",
      confidence_used: conf,
      should_write_outcome_event: false,
      should_open_blocker_capture: false,
      reply_style: "soft_opt_out",
      overrode_deterministic: false,
    };
  }

  if (commitmentSignals && !clearAnswer) {
    return {
      mode: "commitment_change_handoff",
      final_event_type: null,
      decision_reason: "commitment_change_without_clear_accountability_answer",
      confidence_used: conf,
      should_write_outcome_event: false,
      should_open_blocker_capture: false,
      reply_style: "commitment_change",
      overrode_deterministic: false,
    };
  }

  if (ai.intent === "meta_question" || ai.user_asks_question === true) {
    return {
      mode: "clarify",
      final_event_type: null,
      decision_reason: "meta_question_or_user_asks_question",
      confidence_used: conf,
      should_write_outcome_event: false,
      should_open_blocker_capture: false,
      reply_style: "clarification",
      clarification_question: ai.clarification_question ?? undefined,
      overrode_deterministic: false,
    };
  }

  if (ai.needs_clarification === true) {
    return {
      mode: "clarify",
      final_event_type: null,
      decision_reason: "ai_needs_clarification",
      confidence_used: conf,
      should_write_outcome_event: false,
      should_open_blocker_capture: false,
      reply_style: "clarification",
      clarification_question: ai.clarification_question ?? undefined,
      overrode_deterministic: false,
    };
  }

  const repairish = ai.intent === "repair_prior" || ai.is_repair === true;
  if (repairish) {
    const partialOk =
      aiKey !== "partial" ||
      (aiKey === "partial" && messageHasKeywordPartialLanguage(raw));
    if (aiKey != null && conf >= V2_INBOUND_GATED_HIGH_CONFIDENCE && partialOk) {
      const finalT = proposedKeyToEventType(aiKey);
      const overrode = finalT !== det;
      return {
        mode: "use_ai_outcome",
        final_event_type: finalT,
        decision_reason: "repair_with_high_confidence_outcome",
        confidence_used: conf,
        should_write_outcome_event: true,
        should_open_blocker_capture: finalT === "user_no" || finalT === "user_partial",
        reply_style: "repair",
        repair_note: ai.reasoning_short,
        overrode_deterministic: overrode,
        supplement_commitment_change_guidance:
          commitmentSignals && clearAnswer ? true : undefined,
      };
    }
    return {
      mode: "repair_reply_only",
      final_event_type: null,
      decision_reason: "repair_low_confidence_or_no_actionable_outcome",
      confidence_used: conf,
      should_write_outcome_event: false,
      should_open_blocker_capture: false,
      reply_style: "repair",
      repair_note: ai.reasoning_short,
      overrode_deterministic: false,
    };
  }

  if (det === "user_partial") {
    if (aiKey === "yes" && conf >= V2_INBOUND_GATED_HIGH_CONFIDENCE) {
      return {
        mode: "use_ai_outcome",
        final_event_type: "user_yes",
        decision_reason: "override_partial_to_yes_high_confidence",
        confidence_used: conf,
        should_write_outcome_event: true,
        should_open_blocker_capture: false,
        reply_style: "normal_outcome",
        overrode_deterministic: true,
        supplement_commitment_change_guidance:
          commitmentSignals && clearAnswer ? true : undefined,
      };
    }
    if (aiKey === "no" && conf >= V2_INBOUND_GATED_HIGH_CONFIDENCE) {
      return {
        mode: "use_ai_outcome",
        final_event_type: "user_no",
        decision_reason: "override_partial_to_no_high_confidence",
        confidence_used: conf,
        should_write_outcome_event: true,
        should_open_blocker_capture: true,
        reply_style: "normal_outcome",
        overrode_deterministic: true,
        supplement_commitment_change_guidance:
          commitmentSignals && clearAnswer ? true : undefined,
      };
    }
    if (
      aiKey === "partial" &&
      conf >= V2_INBOUND_GATED_PARTIAL_ACCEPT_CONFIDENCE &&
      messageHasKeywordPartialLanguage(raw)
    ) {
      return {
        mode: "use_ai_outcome",
        final_event_type: "user_partial",
        decision_reason: "ai_partial_explicit_language_high_confidence",
        confidence_used: conf,
        should_write_outcome_event: true,
        should_open_blocker_capture: true,
        reply_style: "normal_outcome",
        overrode_deterministic: args.deterministicNormalizedHint !== "keyword_partial",
        supplement_commitment_change_guidance:
          commitmentSignals && clearAnswer ? true : undefined,
      };
    }
  }

  if (det === "user_yes" || det === "user_no") {
    const opposite =
      (det === "user_yes" && aiKey === "no") || (det === "user_no" && aiKey === "yes");
    if (
      opposite &&
      aiKey != null &&
      conf >= V2_INBOUND_GATED_EXTREME_OVERRIDE_CONFIDENCE
    ) {
      const finalT = proposedKeyToEventType(aiKey);
      return {
        mode: "use_ai_outcome",
        final_event_type: finalT,
        decision_reason: "extreme_confidence_override_of_deterministic_yes_no",
        confidence_used: conf,
        should_write_outcome_event: true,
        should_open_blocker_capture: finalT === "user_no" || finalT === "user_partial",
        reply_style: "normal_outcome",
        overrode_deterministic: true,
        supplement_commitment_change_guidance:
          commitmentSignals && clearAnswer ? true : undefined,
      };
    }
    if (opposite && aiKey != null) {
      return {
        mode: "clarify",
        final_event_type: null,
        decision_reason: "deterministic_vs_ai_disagree_prefer_clarify",
        confidence_used: conf,
        should_write_outcome_event: false,
        should_open_blocker_capture: false,
        reply_style: "clarification",
        overrode_deterministic: false,
      };
    }
  }

  const supplement = commitmentSignals && clearAnswer;
  return {
    mode: "use_deterministic",
    final_event_type: det,
    decision_reason: "default_deterministic_classifier",
    confidence_used: conf,
    should_write_outcome_event: true,
    should_open_blocker_capture: det === "user_no" || det === "user_partial",
    reply_style: "normal_outcome",
    overrode_deterministic: false,
    supplement_commitment_change_guidance: supplement ? true : undefined,
  };
}

function validateGatedAuxiliarySms(s: string): boolean {
  const t = s.trim();
  if (t.length < 8 || t.length > SMS_MAX_LEN) return false;
  const lower = t.toLowerCase();
  if (inboundCoachComplianceHygieneFailReason(t)) return false;
  if (/\breply\s+(yes|no|partial)\b/i.test(lower)) return false;
  if (lower.includes("guarantee you will")) return false;
  if (/\bchatgpt\b/i.test(lower)) return false;
  return true;
}

/** Appended when server supplements commitment-change guidance (Phase 5A may preserve this substring). */
export const COMMITMENT_APPEND_FOR_SCORED =
  "If the bar still needs to move, tell me what would be honest to hold you to.";

/**
 * Short SMS for non-outcome gated modes (clarify, repair-only, handoff, soft opt-out).
 * Prefer `resolveV2InboundCoachReplyBody` in the inbound coach worker.
 */
export function buildV2GatedSpecialReply(args: {
  decision: V2InboundGatedDecision;
  preferredName: string | null;
  messageSid: string;
  aiSuggestedReply: string | null;
}): string {
  const tryAi =
    args.aiSuggestedReply &&
    validateGatedAuxiliarySms(args.aiSuggestedReply) &&
    args.decision.reply_style !== "soft_opt_out";

  if (tryAi && args.aiSuggestedReply) {
    const merged = prefixName(
      args.preferredName,
      args.aiSuggestedReply.trim().replace(/\s+/g, " ")
    );
    return merged.length <= SMS_MAX_LEN ? merged : merged.slice(0, SMS_MAX_LEN - 1) + "…";
  }

  const d = args.decision;
  let body: string;
  if (d.mode === "soft_opt_out_reply") {
    body = humanSoftOptOutReply();
  } else if (d.mode === "commitment_change_handoff") {
    body = humanCommitmentChangeHandoffReply();
  } else if (d.mode === "repair_reply_only") {
    body = REPAIR_NO_OUTCOME_LINES[sidPick(args.messageSid, REPAIR_NO_OUTCOME_LINES.length)]!;
  } else {
    body = CLARIFY_HUMAN_LINES[sidPick(args.messageSid, CLARIFY_HUMAN_LINES.length)]!;
  }

  const out = prefixName(args.preferredName, body);
  return out.length <= SMS_MAX_LEN ? out : out.slice(0, SMS_MAX_LEN - 1) + "…";
}

export function buildAiGatedDecisionPayload(args: {
  enabled: boolean;
  decision: V2InboundGatedDecision;
  deterministicEventType: V2InboundEventType;
  deterministicNormalizedHint: string | null;
  repairContext?: Record<string, unknown> | null;
}): Record<string, unknown> | undefined {
  if (!args.enabled) return undefined;
  const d = args.decision;
  return {
    enabled: true,
    mode: d.mode,
    final_event_type: d.final_event_type,
    decision_reason: d.decision_reason,
    confidence_used: d.confidence_used,
    overrode_deterministic: d.overrode_deterministic,
    repair_context: args.repairContext ?? null,
    clarification_avoided_event: !d.should_write_outcome_event,
    deterministic_event_type: args.deterministicEventType,
    deterministic_normalized_hint: args.deterministicNormalizedHint,
  };
}

export function appendCommitmentChangeNoteIfNeeded(
  base: string,
  decision: V2InboundGatedDecision
): string {
  if (!decision.supplement_commitment_change_guidance) return base;
  const tail = " " + COMMITMENT_APPEND_FOR_SCORED;
  const merged = base.trimEnd() + tail;
  return merged.length <= SMS_MAX_LEN ? merged : base;
}

// ---- Wave 2.2: human inbound coach replies ----

export type V2InboundCoachReplyResolutionMeta = {
  reply_source: "ai_suggested" | "ai_generated" | "deterministic_human" | "fallback";
  reply_mode: string;
  suggested_reply_used: boolean;
  suggested_reply_rejected_reason: string | null;
  final_event_type: V2InboundEventType | null;
  gated_mode: string | null;
};

const ROBOTIC_YES_NO_PARTIAL =
  /\breply\s+(yes|no|partial)\b/i;
const REFRESH_COMMAND_TOKENS =
  /\b(reply\s+)?(still|change|keep|tighten|new)\b.*\b(check|commitment|refresh)\b/i;
const MUTATION_CLAIM_RE =
  /\b(i\s+)?(changed|updated|rewrote|reset)\s+(your|the)\s+commitment\b/i;
const DONE_CLAIM_RE = /\b(counting (?:that |it )?as done|mark(?:ing)?(?: it)? done|that counts as done)\b/i;
const MISS_CLAIM_RE =
  /\b(that'?s (?:a )?miss|marking (?:that |it )?(?:as )?(?:a )?miss|not done|didn'?t happen)\b/i;

/**
 * Scored user_yes — shadow suggested_reply must acknowledge proof/completion (Wave 2.3).
 * Rejects generic onboarding / momentum / next-step coaching without logged completion tone.
 */
const USER_YES_SUGGESTED_PROOF_ACK_RE =
  /\b(logged|proof|that\s+counts|\bcounts\b|counting|marking\s+today|done\s+for\s+today|saved\s+as\s+proof|same\s+bar\s+tomorrow|same\s+standard\s+tomorrow|mark(?:ing)?\s+(?:it\s+)?(?:as\s+)?done|got\s+the\s+bar\s+done)\b/i;

function userYesSuggestedWeakOnboardingReason(lower: string): string | null {
  if (/\bon\s+board\b/i.test(lower)) return "user_yes_weak_onboarding_tone";
  if (/\bwhat'?s\s+your\s+next\s+step\b/i.test(lower)) return "user_yes_weak_onboarding_tone";
  if (/\bwhat'?s\s+next\s+on\s+your\s+agenda\b/i.test(lower)) return "user_yes_weak_onboarding_tone";
  if (/\bnext\s+on\s+your\s+agenda\b/i.test(lower)) return "user_yes_weak_onboarding_tone";
  if (/\bkeep\s+the\s+momentum\b/i.test(lower)) return "user_yes_weak_onboarding_tone";
  if (/\bmomentum\s+going\b/i.test(lower)) return "user_yes_weak_onboarding_tone";
  if (/\bawesome,?\s+keep\b/i.test(lower) && /\bmomentum\b/i.test(lower)) return "user_yes_weak_onboarding_tone";
  return null;
}

function userYesSuggestedHasProofAcknowledgment(lower: string): boolean {
  return USER_YES_SUGGESTED_PROOF_ACK_RE.test(lower);
}

function shameLikeSuggested(t: string): boolean {
  const lower = t.toLowerCase();
  if (/\byou failed\b/i.test(lower)) return true;
  if (/\bpathetic\b/i.test(lower)) return true;
  if (/\bworthless\b/i.test(lower)) return true;
  return false;
}

export type V2InboundSuggestedReplyContext = {
  finalEventType: V2InboundEventType | null;
  gatedMode: V2InboundGatedMode;
  replyStyle: V2InboundGatedReplyStyle;
};

/** Wave 3.1: normal coach SMS must not carry Twilio-style compliance or command menus. */
function inboundCoachComplianceHygieneFailReason(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\breply\s+stop\b/i.test(lower)) return "compliance_stop_copy";
  if (/\btext\s+stop\b/i.test(lower)) return "compliance_stop_copy";
  if (/\bstop\s+to\s+opt\b/i.test(lower)) return "compliance_stop_copy";
  if (/\bstop\s+to\s+cancel\b/i.test(lower)) return "compliance_stop_copy";
  if (/\breply\s+start\b/i.test(lower)) return "compliance_start_copy";
  if (/\breply\s+help\b/i.test(lower)) return "compliance_help_copy";
  if (/\btext\s+help\b/i.test(lower)) return "compliance_help_copy";
  if (/\bhelp\s+for\s+help\b/i.test(lower)) return "compliance_help_copy";
  return null;
}

export function validateAiSuggestedReplyForInbound(
  text: string,
  ctx: V2InboundSuggestedReplyContext
): { ok: true } | { ok: false; reason: string } {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length < 10 || t.length > SMS_MAX_LEN) return { ok: false, reason: "length" };
  if (/^\s*\{/.test(t) || /"\s*strategy\s*"/i.test(t)) return { ok: false, reason: "json_like" };
  if (ROBOTIC_YES_NO_PARTIAL.test(t)) return { ok: false, reason: "robotic_menu" };
  if (REFRESH_COMMAND_TOKENS.test(t)) return { ok: false, reason: "refresh_tokens" };
  if (MUTATION_CLAIM_RE.test(t)) return { ok: false, reason: "mutation_claim" };
  if (shameLikeSuggested(t)) return { ok: false, reason: "shame_tone" };
  const compliance = inboundCoachComplianceHygieneFailReason(t);
  if (compliance) return { ok: false, reason: compliance };
  const lower = t.toLowerCase();

  const ft = ctx.finalEventType;
  if (ft === "user_yes") {
    if (MISS_CLAIM_RE.test(lower) && !/misunderstood|read that wrong/i.test(lower)) {
      return { ok: false, reason: "contradicts_yes" };
    }
    const weakTone = userYesSuggestedWeakOnboardingReason(lower);
    if (weakTone) return { ok: false, reason: weakTone };
    if (!userYesSuggestedHasProofAcknowledgment(lower)) {
      return { ok: false, reason: "user_yes_suggested_missing_proof_ack" };
    }
  }
  if (ft === "user_no") {
    if (DONE_CLAIM_RE.test(lower)) return { ok: false, reason: "contradicts_no" };
  }
  if (ft === "user_partial") {
    if (/\bonly a full miss\b/i.test(lower) && !/partial|half|partly/i.test(lower)) {
      return { ok: false, reason: "contradicts_partial" };
    }
  }

  return { ok: true };
}

function sidPick(messageSid: string, modulo: number): number {
  let h = 0;
  for (let i = 0; i < messageSid.length; i++) h = (h * 31 + messageSid.charCodeAt(i)) >>> 0;
  return h % modulo;
}

const CLARIFY_HUMAN_LINES = [
  "I don't want to score that wrong — did today count as done, partly done, or not done?",
  "I may be reading that wrong. Did you finish the commitment today?",
  "Help me read that right: done, partly done, or not done?",
];

const REPAIR_NO_OUTCOME_LINES = [
  "You're right to call that out. I may have read it wrong — did today count as done, partly done, or not done?",
  "Fair — I may have scored that wrong. Did it count as done, partly done, or not done?",
];

/** Part C: repair + scored outcome */
function humanRepairOutcomeReply(finalType: V2InboundEventType, messageSid: string): string {
  const v = sidPick(messageSid, 3);
  if (finalType === "user_yes") {
    const lines = [
      "You're right — I read that wrong. I'm counting today as done. Same bar tomorrow.",
      "Got it — I misunderstood. I'm counting that as done today. Same standard tomorrow.",
      "Fair call. That counts as done for today. I'll hold the same bar tomorrow.",
    ];
    return lines[v]!;
  }
  if (finalType === "user_no") {
    const lines = [
      "You're right — I misunderstood. I'm marking that honestly as a miss, not a failure. What got in the way?",
      "Got it. That's a miss for today, not an identity label. What blocked you?",
      "Understood — I'll score that as a miss. What got in the way today?",
    ];
    return lines[v]!;
  }
  const lines = [
    "Got it — I read that too flat. I'm counting it as partial because you moved but didn't finish the full bar. What was the gap?",
    "Fair — I'm scoring that as partial. What kept it from the full bar?",
    "Thanks for the correction — partial for today. What was missing for the full standard?",
  ];
  return lines[v]!;
}

function humanSoftOptOutReply(): string {
  return "I hear you. If the commitment is the problem, we can adjust it—tell me what needs to change. I won't force the same bar if it's wrong.";
}

function humanCommitmentChangeHandoffReply(): string {
  return "That may need a change. I won't rewrite it without you, but we can tighten it or replace it. Tell me what needs to change.";
}

/** Part E: nuanced outcome fallbacks when AI/template fail */
function humanOutcomeFallbackReply(
  eventType: V2InboundEventType,
  userMessage: string,
  _shortPhrase: string,
  messageSid: string
): string {
  const u = userMessage.toLowerCase();
  const v = sidPick(messageSid, 2);
  const kids = /kid|children|son|daughter|family|spouse|wife|husband/i.test(userMessage);
  const time = /time|ran out|busy|hectic|hours/i.test(u);
  const tool = /grok|chatgpt|tool|app|cursor|ai\b/i.test(userMessage);
  const confuse = /what do you mean|confus|unclear/i.test(u);

  if (eventType === "user_yes") {
    if (tool) return "Good — that still counts for how you got it done. I'm marking today as done.";
    if (kids)
      return v === 0
        ? "Good. Family noise happens — I'm counting today as done."
        : "That counts. I'm marking today done.";
    if (time) return "That's still a win for today. I'm counting it as done.";
    if (confuse) return "Good. I'm counting today as done — clear answer.";
    const yesLines = [
      "Good. I'm counting that as done. That's proof.",
      "That counts. You got the bar done today.",
    ];
    return yesLines[v]!;
  }
  if (eventType === "user_no") {
    if (kids)
      return "Got it — honest miss. What got in the way with family/life today?";
    if (time) return "Got it. What ran out of runway today?";
    const noLines = [
      "Got it. That's a miss, not an identity. What got in the way?",
      "Thank you for being honest. What blocked it today?",
    ];
    return noLines[v]!;
  }
  if (kids)
    return "Partial counts as honesty. What kept it from the full bar with everything on your plate?";
  if (time)
    return "Partial is honest. What ran short — time, energy, or something else?";
  const pLines = [
    "Partial counts as honesty. What kept it from being fully done?",
    "You moved, but not all the way. What got in the way?",
  ];
  return pLines[v]!;
}

/** Remove a clearly duplicate second use of the preferred name in the first sentence only (conservative). */
function dedupeSecondPreferredNameInOpeningSentence(text: string, cap: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  const esc = cap.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const firstBreak = normalized.search(/[.!?](?=\s|$)/);
  const firstSentence = firstBreak === -1 ? normalized : normalized.slice(0, firstBreak + 1);
  const rest = firstBreak === -1 ? "" : normalized.slice(firstBreak + 1).replace(/^\s+/, "");
  const re = new RegExp(`\\b${esc}\\b`, "gi");
  const matches = [...firstSentence.matchAll(re)];
  if (matches.length < 2) return normalized;
  const firstM = matches[0]!;
  const lastM = matches[matches.length - 1]!;
  if (lastM.index === undefined || firstM.index === undefined || lastM.index <= firstM.index) {
    return normalized;
  }
  const gap = lastM.index - (firstM.index + firstM[0].length);
  if (gap < 10) return normalized;
  const beforeLast = firstSentence.slice(0, lastM.index).replace(/,\s*$/, "").trimEnd();
  const afterLast = firstSentence.slice(lastM.index + lastM[0].length);
  const fixedFirst = (beforeLast + afterLast).replace(/\s+/g, " ").trim();
  if (!fixedFirst || !new RegExp(`^${esc}\\b`, "i").test(fixedFirst)) return normalized;
  return rest ? `${fixedFirst} ${rest}`.replace(/\s+/g, " ").trim() : fixedFirst;
}

function prefixName(preferredName: string | null, body: string): string {
  const opening = formatInboundFallbackPreferredOpening(preferredName);
  const cap = capPreferredNameForInboundSms(preferredName);
  const normalized = body.trim().replace(/\s+/g, " ");
  if (!normalized) return opening;

  let combined: string;
  if (cap) {
    const esc = cap.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const startsWithName = new RegExp(`^${esc}(,|\\s+|$)`, "i").test(normalized);
    combined = startsWithName ? normalized : opening + normalized;
    combined = dedupeSecondPreferredNameInOpeningSentence(combined, cap);
  } else {
    combined = opening + normalized;
  }
  return combined;
}

function clip(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= SMS_MAX_LEN ? t : t.slice(0, SMS_MAX_LEN - 1) + "…";
}

export type V2ResolveInboundCoachReplyArgs = {
  gatedEnabled: boolean;
  gatedDecision: V2InboundGatedDecision;
  interpretation: V2InboundShadowInterpretationResult | null;
  deterministicEventType: V2InboundEventType;
  userMessage: string;
  preferredName: string | null;
  messageSid: string;
  effectiveAsk: string;
  behaviorStatement: string;
  /** When true, prefer suggested when it agrees with deterministic (shadow eval). */
  trySuggestedWhenAgrees: boolean;
  /** Wave 4: human SMS for commitment_change_handoff (skips generic app handoff line). */
  commitmentChangeWave4Body?: string | null;
  buildOutcomeAi: () => Promise<V2AiInboundAttempt>;
  buildTemplate: (finalType: V2InboundEventType) => { body: string; replyTemplateId: string };
};

/**
 * Central server-owned selection of the SMS body: suggested_reply, AI generate, human banks, template.
 */
export async function resolveV2InboundCoachReplyBody(
  args: V2ResolveInboundCoachReplyArgs
): Promise<{
  replyBody: string;
  meta: V2InboundCoachReplyResolutionMeta;
  aiTry: V2AiInboundAttempt;
  replyTemplateId: string | undefined;
}> {
  const shortPhrase = getShortCommitmentPhraseForSms({
    effectiveAsk: args.effectiveAsk,
    behaviorStatement: args.behaviorStatement,
  });

  const interp = args.interpretation;
  const suggestedRaw =
    interp && interp.ok ? interp.data.suggested_reply?.trim() ?? null : null;

  // ---- Non-outcome (clarify, repair-only, handoff, soft opt) ----
  if (!args.gatedDecision.should_write_outcome_event) {
    const d = args.gatedDecision;
    const valCtx: V2InboundSuggestedReplyContext = {
      finalEventType: null,
      gatedMode: d.mode,
      replyStyle: d.reply_style,
    };
    let rejected: string | null = null;
    if (suggestedRaw) {
      const v = validateAiSuggestedReplyForInbound(suggestedRaw, valCtx);
      if (v.ok) {
        return {
          replyBody: clip(prefixName(args.preferredName, suggestedRaw)),
          meta: {
            reply_source: "ai_suggested",
            reply_mode: d.mode,
            suggested_reply_used: true,
            suggested_reply_rejected_reason: null,
            final_event_type: null,
            gated_mode: d.mode,
          },
          aiTry: { ok: false, fallbackUsed: true, reason: "non_outcome_suggested" },
          replyTemplateId: undefined,
        };
      }
      rejected = v.reason;
    }

    let body: string;
    if (d.mode === "soft_opt_out_reply") {
      body = humanSoftOptOutReply();
    } else if (d.mode === "commitment_change_handoff") {
      body = args.commitmentChangeWave4Body?.trim() || humanCommitmentChangeHandoffReply();
    } else if (d.mode === "repair_reply_only") {
      body = REPAIR_NO_OUTCOME_LINES[sidPick(args.messageSid, REPAIR_NO_OUTCOME_LINES.length)]!;
    } else {
      body = CLARIFY_HUMAN_LINES[sidPick(args.messageSid, CLARIFY_HUMAN_LINES.length)]!;
    }

    return {
      replyBody: clip(prefixName(args.preferredName, body)),
      meta: {
        reply_source: "deterministic_human",
        reply_mode: d.mode,
        suggested_reply_used: false,
        suggested_reply_rejected_reason: rejected,
        final_event_type: null,
        gated_mode: d.mode,
      },
      aiTry: { ok: false, fallbackUsed: true, reason: `non_outcome_human:${d.mode}` },
      replyTemplateId: undefined,
    };
  }

  // ---- Outcome path ----
  const finalType = args.gatedDecision.final_event_type ?? args.deterministicEventType;
  const d = args.gatedDecision;
  const repairOutcome =
    d.reply_style === "repair" && d.mode === "use_ai_outcome" && d.should_write_outcome_event;

  let suggestedRejected: string | null = null;
  if (suggestedRaw) {
    const v = validateAiSuggestedReplyForInbound(suggestedRaw, {
      finalEventType: finalType,
      gatedMode: d.mode,
      replyStyle: d.reply_style,
    });
    if (!v.ok) {
      suggestedRejected = v.reason;
    } else {
      const detKey = deterministicEventTypeToProposedKey(args.deterministicEventType);
      const prop = interp && interp.ok ? interp.data.proposed_outcome : null;
      const classifierAligned =
        prop == null || prop === detKey;
      const useSuggested =
        args.gatedEnabled ||
        !args.trySuggestedWhenAgrees ||
        classifierAligned;
      if (useSuggested) {
        return {
          replyBody: clip(prefixName(args.preferredName, suggestedRaw)),
          meta: {
            reply_source: "ai_suggested",
            reply_mode: d.mode,
            suggested_reply_used: true,
            suggested_reply_rejected_reason: null,
            final_event_type: finalType,
            gated_mode: d.mode,
          },
          aiTry: { ok: false, fallbackUsed: true, reason: "used_suggested_validated" },
          replyTemplateId: undefined,
        };
      }
      suggestedRejected = "does_not_agree_with_classifier";
    }
  }

  const aiTry = await args.buildOutcomeAi();
  const tmpl = args.buildTemplate(finalType);

  if (aiTry.ok) {
    const vGen = validateAiSuggestedReplyForInbound(aiTry.message, {
      finalEventType: finalType,
      gatedMode: d.mode,
      replyStyle: d.reply_style,
    });
    if (vGen.ok) {
      if (repairOutcome) {
        const ack = humanRepairOutcomeReply(finalType, args.messageSid);
        const combined = clip(`${ack} ${aiTry.message}`);
        if (combined.length <= SMS_MAX_LEN && validateAiSuggestedReplyForInbound(combined, {
          finalEventType: finalType,
          gatedMode: d.mode,
          replyStyle: "repair",
        }).ok) {
          return {
            replyBody: clip(prefixName(args.preferredName, combined)),
            meta: {
              reply_source: "ai_generated",
              reply_mode: "repair_then_coach",
              suggested_reply_used: false,
              suggested_reply_rejected_reason: suggestedRejected,
              final_event_type: finalType,
              gated_mode: d.mode,
            },
            aiTry,
            replyTemplateId: tmpl.replyTemplateId,
          };
        }
        return {
          replyBody: clip(prefixName(args.preferredName, ack)),
          meta: {
            reply_source: "deterministic_human",
            reply_mode: "repair_ack_only",
            suggested_reply_used: false,
            suggested_reply_rejected_reason: suggestedRejected,
            final_event_type: finalType,
            gated_mode: d.mode,
          },
          aiTry,
          replyTemplateId: tmpl.replyTemplateId,
        };
      }
      return {
        replyBody: clip(prefixName(args.preferredName, aiTry.message)),
        meta: {
          reply_source: "ai_generated",
          reply_mode: d.mode,
          suggested_reply_used: false,
          suggested_reply_rejected_reason: suggestedRejected,
          final_event_type: finalType,
          gated_mode: d.mode,
        },
        aiTry,
        replyTemplateId: tmpl.replyTemplateId,
      };
    }
  }

  if (repairOutcome) {
    const ackOnly = humanRepairOutcomeReply(finalType, args.messageSid);
    return {
      replyBody: clip(prefixName(args.preferredName, ackOnly)),
      meta: {
        reply_source: "deterministic_human",
        reply_mode: "repair_fallback",
        suggested_reply_used: false,
        suggested_reply_rejected_reason:
          suggestedRejected ?? (aiTry.ok ? "generated_failed_validation" : null),
        final_event_type: finalType,
        gated_mode: d.mode,
      },
      aiTry,
      replyTemplateId: tmpl.replyTemplateId,
    };
  }

  const humanFb = humanOutcomeFallbackReply(finalType, args.userMessage, shortPhrase, args.messageSid);
  const humanVal = validateAiSuggestedReplyForInbound(humanFb, {
    finalEventType: finalType,
    gatedMode: d.mode,
    replyStyle: d.reply_style,
  });
  if (humanVal.ok) {
    return {
      replyBody: clip(prefixName(args.preferredName, humanFb)),
      meta: {
        reply_source: "deterministic_human",
        reply_mode: "nuance_fallback",
        suggested_reply_used: false,
        suggested_reply_rejected_reason:
          suggestedRejected ?? (aiTry.ok ? "generated_failed_validation" : null),
        final_event_type: finalType,
        gated_mode: d.mode,
      },
      aiTry,
      replyTemplateId: tmpl.replyTemplateId,
    };
  }

  return {
    replyBody: clip(prefixName(args.preferredName, tmpl.body)),
    meta: {
      reply_source: "fallback",
      reply_mode: d.mode,
      suggested_reply_used: false,
      suggested_reply_rejected_reason: suggestedRejected,
      final_event_type: finalType,
      gated_mode: d.mode,
    },
    aiTry,
    replyTemplateId: tmpl.replyTemplateId,
  };
}
