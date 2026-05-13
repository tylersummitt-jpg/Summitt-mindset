/**
 * OpenAI-first SMS Conversation Brain — proposes structured accountability turns.
 * Server guardrails + spine writes happen in the inbound route, not here.
 */

import OpenAI from "openai";

import type { V2EventRowForAi } from "@/lib/v2-commitment";
import type { V2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory";
import { formatCoachingMemoryPromptBlock } from "@/lib/v2-coaching-memory-prompt";
import {
  parseSmsConversationBrainProposal,
  SMS_CONVERSATION_BRAIN_SCHEMA_VERSION,
  type SmsConversationBrainProposalV1,
} from "@/lib/v2-sms-turn-contract";

export const V2_SMS_CONVERSATION_BRAIN_PROMPT_VERSION = "sms_conversation_brain_v1";

function getOpenAIClientOrNull(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return null;
  return new OpenAI({ apiKey });
}

export function isV2SmsConversationBrainControlEnabled(): boolean {
  return process.env.V2_SMS_CONVERSATION_BRAIN_CONTROL_ENABLED?.trim() === "true";
}

export function isV2SmsConversationBrainAllowedForUser(clerkUserId: string): boolean {
  const raw = process.env.V2_SMS_CONVERSATION_BRAIN_ALLOWED_CLERK_IDS?.trim();
  if (!raw) return true;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(clerkUserId);
}

export function isV2SmsConversationBrainLegacyFallbackEnabled(): boolean {
  const v = process.env.V2_SMS_CONVERSATION_BRAIN_LEGACY_FALLBACK_ENABLED?.trim().toLowerCase();
  if (v === "false" || v === "0") return false;
  return true;
}

export function getConversationBrainModel(): string {
  return process.env.V2_SMS_CONVERSATION_BRAIN_MODEL?.trim() || "gpt-4o-mini";
}

export function getConversationBrainConfidenceFloor(): number {
  const raw = process.env.V2_SMS_CONVERSATION_BRAIN_CONFIDENCE_FLOOR?.trim();
  if (!raw) return 0.55;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.55;
}

export type BuildConversationBrainPromptArgs = {
  commitmentTitle: string;
  behaviorStatement: string;
  effectiveCoachingAsk: string;
  latestUserSms: string;
  lastCoachSmsExact: string | null;
  recentSmsTranscriptBlock: string | null;
  eventsNewestFirst: V2EventRowForAi[];
  coachingMemory: V2CoachingMemoryForPrompt | null;
  identityAnchorPreview: string | null;
  liveAccountabilityPromptStatus: string | null;
  blockerPendingSummary: string | null;
  deterministicClassifierEventType: string;
  deterministicClassifierNormalizedHint: string | null;
};

function compactEventLine(e: V2EventRowForAi): string {
  const p = e.payload_json || {};
  const preview =
    typeof p.message === "string"
      ? p.message.trim().replace(/\s+/g, " ").slice(0, 100)
      : typeof p.body_preview === "string"
        ? p.body_preview.trim().replace(/\s+/g, " ").slice(0, 80)
        : "";
  const tail = preview ? ` ${preview}` : "";
  const ts = e.occurred_at.length >= 19 ? e.occurred_at.slice(0, 19) : e.occurred_at;
  return `${ts} ${e.event_type}${tail}`;
}

function extractJsonObject(raw: string): unknown | null {
  const t = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t);
  const body = fence ? fence[1].trim() : t;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function buildSmsSchedulingConstraintBlock(args: {
  latestUserSms: string;
  lastCoachSmsExact: string | null;
}): string | null {
  const latest = (args.latestUserSms || "").trim();
  if (!latest) return null;
  const coach = (args.lastCoachSmsExact || "").trim();
  if (!coach) return null;
  const lower = latest.toLowerCase();
  const rejection =
    /\b(can'?t|cannot|can not|nope|no\s+i|won'?t work|not possible|impossible|without\s+(a\s+)?phone|have to be at work|at work|i'?ll be at work|i will be at work)\b/i.test(
      lower
    ) || /^no\b/i.test(lower);
  if (!rejection) return null;

  const times = new Set<string>();
  for (const m of coach.matchAll(/\b\d{1,2}:\d{2}\s*(?:am|pm)\b/gi)) {
    times.add(m[0].replace(/\s+/g, " "));
  }
  for (const m of coach.matchAll(/\b\d{1,2}\s*(?:am|pm)\b/gi)) {
    times.add(m[0].replace(/\s+/g, " "));
  }
  for (const w of ["noon", "midnight"] as const) {
    if (new RegExp(`\\b${w}\\b`, "i").test(coach)) times.add(w);
  }
  if (times.size === 0) return null;

  const list = [...times].join(", ");
  return (
    "## Server scheduling constraint (AUTHORITATIVE)\n" +
    "The latest inbound reads like a feasibility pushback relative to the coach's last SMS.\n" +
    `Clock times the coach recently named in-thread: ${list}.\n` +
    "Rules for final_sms_draft: do not propose those same clock times again unless the user explicitly accepts one. Offer a different realistic window or ask one clarifying constraint.\n"
  );
}

export function buildConversationBrainPrompt(args: BuildConversationBrainPromptArgs): string {
  const recentEventsLines = args.eventsNewestFirst.slice(0, 18).map(compactEventLine);
  const memBlock = formatCoachingMemoryPromptBlock(args.coachingMemory);

  const lines: string[] = [
    "You are the Summitt Mindset SMS accountability coach.",
    "You are inspired by Pat Summitt-style communication: direct, calm, honest, clean, no shame, no guilt trips.",
    "Write SMS that feels like one long-running human coaching conversation stretched across months of texts.",
    "Hold the user accountable without interrogation. Coach forward after misses.",
    "Interpret the latest user message using the active commitment, recent SMS thread, exact last coach message (if provided), recent events, coaching memory, and profile anchor.",
    "The deterministic classifier output below is a WEAK, NON-AUTHORITATIVE hint only — do not treat it as ground truth.",
    "Never mutate commitments or propose database updates. The server owns all writes.",
    "Never claim state changes you did not perform. Never quote internal system names (Supabase, Twilio, cron, API keys).",
    "Do not use profanity, vulgarity, sexual language, slurs, insults, shame-heavy language, edgy humor, or robotic clarification loops.",
    "Avoid repeating the user's first name in every text. Avoid repeated \"can you clarify\" phrasing.",
    "Do not ask for clarification unless the thread makes an honest score impossible; avoid repeated clarification.",
    "Prefer a reasonable accountability outcome over perfect extraction.",
    "ANSWER-FIRST: when the user asks a normal human question (examples, 'can we talk about something else', home/kids/cooking/leadership context, or 'does this count' / victory log) — final_sms_draft must answer that first in coach voice, then (if still one SMS) connect lightly to the bar. Do not yank them back to the commitment before answering.",
    "TOMORROW / FUTURE PLANS: If the user names tomorrow (hours, distribution, stories, harder push, goal increase for tomorrow), they are planning forward—not asking for another today's check. Match their timeframe (tomorrow). Coach one concrete calendar block, start time, or first step. Never tell them to focus on today's commitment first or ask what's their plan for today.",
    "STRETCH VS DURABLE CHANGE: A bigger target tomorrow is usually a one-day stretch unless they explicitly ask to permanently raise the daily commitment—support ambition without claiming you rewrote the stored bar.",
    "IDENTITY MOMENTS: short 'I want to be…' statements are gold—reflect the weight, tie to one concrete move under the active commitment, not generic praise.",
    "If the user clearly missed: propose user_no and coach forward.",
    "If partial: propose user_partial and tighten kindly.",
    "If complete: propose user_yes and reinforce with proof language—never generic cheerlead ('great job', 'momentum'); prefer one tight forward question when the thread calls for it.",
    "If they signal a blocker: set blocker_signal true and optional blocker_text_if_any.",
    "Return STRICT JSON ONLY — no markdown, no prose outside JSON — matching this shape:",
    `{"schema_version":${SMS_CONVERSATION_BRAIN_SCHEMA_VERSION},"turn_kind":"accountability_reply|meta_question|repair|commitment_change_intent|small_talk|unclear",`,
    `"interpreted_user_meaning":"string",`,
    `"accountability_outcome_candidate":"user_yes|user_no|user_partial|none",`,
    `"outcome_confidence":0.0-1.0,`,
    `"should_write_outcome_event":boolean,`,
    `"proposed_event_type":"user_yes"|"user_no"|"user_partial"|null,`,
    `"blocker_signal":boolean,`,
    `"blocker_text_if_any":string|null,`,
    `"needs_clarification":boolean,`,
    `"clarification_reason":string|null,`,
    `"repeated_clarification_risk":boolean,`,
    `"reply_strategy":"short string",`,
    `"final_sms_draft":"concise SMS body only",`,
    `"safety_notes":["short"],`,
    `"short_reason_for_logs":"compact server-safe summary without private quotes"}`,
    "",
    "## Active commitment",
    `Title: ${args.commitmentTitle}`,
    `Behavior statement: ${args.behaviorStatement}`,
    `Effective coaching ask (may reflect adaptive overlay): ${args.effectiveCoachingAsk}`,
    "",
    "## Identity anchor (optional)",
    args.identityAnchorPreview && args.identityAnchorPreview.trim()
      ? args.identityAnchorPreview.trim().slice(0, 240)
      : "(none loaded)",
    "",
    "## Live accountability prompt status (server)",
    args.liveAccountabilityPromptStatus ?? "(unknown — treat thread as primary)",
    "",
    "## Blocker capture / pending (server)",
    args.blockerPendingSummary ?? "(none reported)",
    "",
    "## Deterministic classifier (WEAK / NON-AUTHORITATIVE)",
    `event_type=${args.deterministicClassifierEventType}`,
    `normalized_hint=${args.deterministicClassifierNormalizedHint ?? "null"}`,
    "",
    "## Exact last coach SMS (if available)",
    args.lastCoachSmsExact && args.lastCoachSmsExact.trim()
      ? args.lastCoachSmsExact.trim()
      : "(not available — rely on transcript / events)",
    "",
    ...(() => {
      const b = buildSmsSchedulingConstraintBlock({
        latestUserSms: args.latestUserSms,
        lastCoachSmsExact: args.lastCoachSmsExact,
      });
      return b ? [b, ""] : [];
    })(),
    "## Recent SMS transcript (bounded)",
    args.recentSmsTranscriptBlock && args.recentSmsTranscriptBlock.trim()
      ? args.recentSmsTranscriptBlock.trim()
      : "(empty)",
    "",
    "## Recent V2 events (newest first, compact)",
    recentEventsLines.length ? recentEventsLines.join("\n") : "(none)",
    "",
    "## Coaching memory (compact)",
    memBlock.trim() || "(none)",
    "",
    "## Latest inbound SMS from user",
    args.latestUserSms.trim() || "(empty)",
  ];

  return lines.join("\n");
}

export type ProposeNormalAccountabilityTurnControlArgs = BuildConversationBrainPromptArgs & {
  timeoutMs?: number;
};

export type ProposeNormalAccountabilityTurnControlResult =
  | { ok: true; proposal: SmsConversationBrainProposalV1; model: string }
  | { ok: false; reason: string; model: string | null };

const DEFAULT_TIMEOUT_MS = 26_000;

export async function proposeNormalAccountabilityTurnControl(
  args: ProposeNormalAccountabilityTurnControlArgs
): Promise<ProposeNormalAccountabilityTurnControlResult> {
  const model = getConversationBrainModel();
  const client = getOpenAIClientOrNull();
  if (!client) {
    return { ok: false, reason: "openai_not_configured", model: null };
  }

  const prompt = buildConversationBrainPrompt(args);
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let rawText = "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const completion = await client.chat.completions.create(
      {
        model,
        temperature: 0.35,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You output strict JSON only for the Summitt SMS Conversation Brain. Follow user instructions exactly.",
          },
          { role: "user", content: prompt },
        ],
      },
      { signal: controller.signal }
    );
    clearTimeout(timer);
    rawText = completion.choices[0]?.message?.content?.trim() ?? "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const reason = msg.includes("abort") ? "openai_timeout" : `openai_error:${msg.slice(0, 160)}`;
    return { ok: false, reason, model };
  }

  if (!rawText) {
    return { ok: false, reason: "empty_model_output", model };
  }

  const parsedJson = extractJsonObject(rawText);
  if (parsedJson === null) {
    return { ok: false, reason: "invalid_json", model };
  }

  const parsed = parseSmsConversationBrainProposal(parsedJson);
  if (!parsed.ok) {
    return { ok: false, reason: `proposal_parse:${parsed.reason}`, model };
  }

  return { ok: true, proposal: parsed.data, model };
}
