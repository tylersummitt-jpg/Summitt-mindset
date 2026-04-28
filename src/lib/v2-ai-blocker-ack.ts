import OpenAI from "openai";

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  formatCoachingMemoryPromptBlock,
  type V2CoachingMemoryForPrompt,
} from "@/lib/v2-coaching-memory-prompt";

export const V2_BLOCKER_ACK_PROMPT_VERSION = "v2_blocker_ack_v1";

export const V2_BLOCKER_ACK_AI_MODEL = "gpt-4o-mini";

export const V2_BLOCKER_ACK_SERVER_STRATEGY = "acknowledge_blocker" as const;

const SMS_MAX_LEN = 300;

export type V2AiBlockerAckAttempt =
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

export function isV2AiBlockerAckEnabled(): boolean {
  return process.env.V2_AI_BLOCKER_ACK_ENABLED === "true";
}

function truncateOneLine(s: string, max: number): string {
  const x = s.trim().replace(/\s+/g, " ");
  if (x.length <= max) return x;
  return `${x.slice(0, max - 1)}…`;
}

function tokenizeAnchorWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w: string) => w.replace(/[^a-z0-9']/g, ""))
    .filter((w: string) => w.length >= 3)
    .slice(0, 10);
}

function passesBlockerGrounding(messageLower: string, blockerText: string): boolean {
  const words = tokenizeAnchorWords(blockerText);
  if (words.length === 0) {
    const compact = blockerText.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const msg = messageLower.replace(/[^a-z0-9]/g, "");
    if (compact.length >= 4 && msg.length >= 4) {
      for (let i = 0; i + 4 <= compact.length && i < 24; i++) {
        if (msg.includes(compact.slice(i, i + 4))) return true;
      }
    }
    return blockerText.trim().length === 0;
  }
  if (words.some((w: string) => messageLower.includes(w))) return true;
  const compact = blockerText.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const msg = messageLower.replace(/[^a-z0-9]/g, "");
  if (compact.length >= 4 && msg.length >= 4) {
    for (let i = 0; i + 4 <= Math.min(32, compact.length); i++) {
      if (msg.includes(compact.slice(i, i + 4))) return true;
    }
  }
  return false;
}

const BANNED_META: readonly string[] = [
  "therapy",
  "therapist",
  "trauma",
  "diagnos",
  "disorder",
  "openai",
  "chatgpt",
  "as an ai",
  "i'm an ai",
];

const BANNED_SHAME: readonly RegExp[] = [
  /\bshame on you\b/i,
  /\byou failed\b/i,
  /\bpathetic\b/i,
  /\bworthless\b/i,
];

const BANNED_INTIMACY: readonly string[] = [
  "i love you",
  "proud of you as a person",
  "cherish you",
  "you complete me",
];

const BANNED_SCOPE: readonly string[] = [
  "new goal",
  "another goal",
  "add a goal",
  "change your commitment",
  "drop this commitment",
];

const BANNED_GUILT_PHRASES: readonly string[] = [
  "where have you been",
  "why didn't you",
  "you should have",
  "about time",
];

function passesLexicalGuards(message: string): boolean {
  const lower = message.toLowerCase();
  for (const b of BANNED_META) {
    if (lower.includes(b)) return false;
  }
  for (const re of BANNED_SHAME) {
    if (re.test(message)) return false;
  }
  for (const b of BANNED_INTIMACY) {
    if (lower.includes(b)) return false;
  }
  for (const b of BANNED_SCOPE) {
    if (lower.includes(b)) return false;
  }
  for (const b of BANNED_GUILT_PHRASES) {
    if (lower.includes(b)) return false;
  }
  if (/\bai\b/i.test(message)) return false;
  return true;
}

export function validateV2AiBlockerAckMessage(args: {
  message: string;
  modelStrategy: unknown;
  blockerText: string;
  behaviorStatement: string;
  commitmentTitle: string;
}): { ok: true } | { ok: false; reason: string } {
  const msg = (args.message || "").trim().replace(/\s+/g, " ").replace(/\n+/g, " ");
  if (!msg) return { ok: false, reason: "empty_message" };
  if (msg.length > SMS_MAX_LEN) return { ok: false, reason: "too_long" };

  const modelStr = typeof args.modelStrategy === "string" ? args.modelStrategy.trim() : "";
  if (modelStr !== V2_BLOCKER_ACK_SERVER_STRATEGY) {
    return { ok: false, reason: "strategy_mismatch" };
  }

  const q = (msg.match(/\?/g) ?? []).length;
  if (q > 1) return { ok: false, reason: "too_many_questions" };

  if (!passesLexicalGuards(msg)) return { ok: false, reason: "lexical_guard" };

  const ml = msg.toLowerCase();
  if (!passesBlockerGrounding(ml, args.blockerText)) {
    return { ok: false, reason: "missing_blocker_grounding" };
  }

  const words = [
    ...tokenizeAnchorWords(args.behaviorStatement),
    ...tokenizeAnchorWords(args.commitmentTitle),
  ].slice(0, 12);
  const seen = new Set<string>();
  const uniq = words.filter((w) => {
    if (seen.has(w)) return false;
    seen.add(w);
    return true;
  });
  if (uniq.length > 0 && !uniq.some((w: string) => ml.includes(w))) {
    const compactBeh = args.behaviorStatement.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const compactMsg = ml.replace(/[^a-z0-9]/g, "");
    if (compactBeh.length >= 5 && compactMsg.length >= 5) {
      let hit = false;
      const head = compactBeh.slice(0, 40);
      for (let i = 0; i + 5 <= head.length; i++) {
        if (compactMsg.includes(head.slice(i, i + 5))) {
          hit = true;
          break;
        }
      }
      if (!hit) return { ok: false, reason: "missing_commitment_grounding" };
    }
  }

  return { ok: true };
}

export type V2AiBlockerAckContext = {
  commitment: ActiveV2CommitmentRow;
  followingEventType: "user_no" | "user_partial";
  blockerText: string;
  preferredName: string | null;
  lifeDesires: string | null;
  /** Optional one-line mirror of `user_profiles.people_summary` (wording context only). */
  peopleSummary?: string | null;
  /** Optional one-line mirror of `user_profiles.responsibility` (wording context only). */
  responsibility?: string | null;
  coachingMemory: V2CoachingMemoryForPrompt | null;
  /** Inbound broke low-pressure reactivation pause before this ack. */
  brokePause?: boolean;
  /** Optional stored identity line—background only; never replace BLOCKER_TEXT as the lead. */
  identityAnchorText?: string | null;
};

const SYSTEM_PROMPT = `You are Coach Pat's SMS voice for a single blocker acknowledgment.
You output strict JSON only. You never break character as an AI system.`;

function buildDeveloperPrompt(ctx: V2AiBlockerAckContext): string {
  const lines: string[] = [];
  lines.push("You write ONE short SMS acknowledging the user's blocker text.");
  lines.push("Return ONLY valid JSON with keys: strategy, message, confidence (0-1 number or null).");
  lines.push(`server_strategy (authoritative): ${V2_BLOCKER_ACK_SERVER_STRATEGY}`);
  lines.push("strategy in your JSON MUST exactly equal server_strategy.");
  lines.push("");
  lines.push("COMMITMENT:");
  lines.push(`title: ${truncateOneLine(ctx.commitment.title, 80)}`);
  lines.push(`behavior_statement: ${truncateOneLine(ctx.commitment.behavior_statement, 200)}`);
  if (ctx.commitment.success_criteria?.trim()) {
    lines.push(`success_criteria: ${truncateOneLine(ctx.commitment.success_criteria, 160)}`);
  }
  lines.push(`following_event_type (context only): ${ctx.followingEventType}`);
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
      "USER_ONBOARDING (answered in app; wording and empathy only—BLOCKER_TEXT and COMMITMENT stay primary):"
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
      "Use the above naturally when it helps the ack feel personal and grounded. Do not force into every reply. Do not guilt-trip. Do not invent details."
    );
  }
  const anchor = ctx.identityAnchorText?.trim() ?? "";
  if (anchor) {
    lines.push("");
    lines.push(
      "IDENTITY_CONTEXT (background only; acknowledge BLOCKER_TEXT first—this is optional color, not a second ask):"
    );
    lines.push(`Stored identity anchor for this user: ${truncateOneLine(anchor, 200)}`);
    lines.push(
      "- Do not paste a long anchor verbatim unless it fits naturally in one short phrase; no guilt, no sermon; commitment + BLOCKER_TEXT stay primary."
    );
  }
  lines.push("");
  lines.push(`BLOCKER_TEXT: ${truncateOneLine(ctx.blockerText, 280)}`);
  lines.push("");
  if (ctx.brokePause) {
    lines.push(
      "BROKE_PAUSE: User returned from low-pressure reactivation—ack blocker briefly; no guilt about silence."
    );
    lines.push("");
  }
  const memBlock = formatCoachingMemoryPromptBlock(ctx.coachingMemory);
  if (memBlock) {
    lines.push(memBlock);
    lines.push("");
  }
  lines.push("RULES:");
  lines.push(`- Max ${SMS_MAX_LEN} characters. One SMS. No newlines.`);
  lines.push(
    "- Acknowledge what they said in BLOCKER_TEXT without inventing obstacles they did not mention or inventing profile details beyond optional USER_ONBOARDING / IDENTITY_CONTEXT lines when present."
  );
  lines.push("- No shame, no therapy language, no fake intimacy, no new goals, no changing the commitment.");
  lines.push("- Prefer zero question marks; at most one if absolutely needed.");
  lines.push("- Stay concise; no long emotional speech.");
  lines.push("- Tie lightly to behavior_statement (same commitment).");
  lines.push("- strategy field MUST be exactly: " + V2_BLOCKER_ACK_SERVER_STRATEGY);

  return lines.join("\n");
}

export async function tryGenerateV2BlockerAckMessage(
  ctx: V2AiBlockerAckContext
): Promise<V2AiBlockerAckAttempt> {
  if (!isV2AiBlockerAckEnabled()) {
    return { ok: false, fallbackUsed: true, reason: "ai_disabled" };
  }

  const client = getOpenAIClientOrNull();
  if (!client) {
    return { ok: false, fallbackUsed: true, reason: "no_openai_key" };
  }

  try {
    const completion = await client.chat.completions.create({
      model: V2_BLOCKER_ACK_AI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildDeveloperPrompt(ctx) },
      ],
      temperature: 0.5,
      max_tokens: 180,
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
    const validated = validateV2AiBlockerAckMessage({
      message,
      modelStrategy,
      blockerText: ctx.blockerText,
      behaviorStatement: ctx.commitment.behavior_statement,
      commitmentTitle: ctx.commitment.title,
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
    console.error("[v2-ai-blocker-ack] OpenAI call failed", err);
    return { ok: false, fallbackUsed: true, reason: "openai_error" };
  }
}

export function buildBlockerAckAiPayload(args: {
  model: string;
  promptVersion: string;
  message: string;
  confidence: number | null | undefined;
  fallbackUsed: boolean;
  fallbackReason?: string | null;
}): Record<string, unknown> {
  return {
    model: args.model,
    prompt_version: args.promptVersion,
    server_strategy: V2_BLOCKER_ACK_SERVER_STRATEGY,
    message: args.message,
    confidence: args.confidence ?? null,
    fallback_used: args.fallbackUsed,
    fallback_reason: args.fallbackUsed ? (args.fallbackReason ?? "unknown") : null,
  };
}
