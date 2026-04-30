/**
 * Wave 4.2 — AI-assisted extraction of a daily bar candidate for SMS pending-resolution (tighten/replace).
 * Does not mutate commitments; server validation + confirmation still required.
 */

import OpenAI from "openai";

export const V2_SMS_PENDING_CANDIDATE_PROMPT_VERSION = "v2_sms_pending_candidate_v1";
export const V2_SMS_PENDING_CANDIDATE_MODEL = "gpt-4o-mini";
/** Minimum model confidence to accept a candidate before deterministic validation. */
export const V2_SMS_PENDING_CANDIDATE_CONFIDENCE_MIN = 0.82;

const REASONING_SHORT_MAX = 220;
const CANDIDATE_MAX_CHARS = 480;

export type V2SmsPendingCandidateAiParsed = {
  has_candidate: boolean;
  candidate_behavior_statement: string | null;
  confidence: number;
  candidate_kind: "tighten" | "replace" | "unknown";
  reasoning_short: string;
  needs_clarification: boolean;
  clarification_question: string | null;
};

export type TryExtractV2SmsPendingResolutionCandidateAiResult =
  | { ok: true; attempted: true; data: V2SmsPendingCandidateAiParsed; model: string }
  | { ok: false; attempted: true; reason: string; model: string | null }
  | { ok: false; attempted: false; reason: string };

function getOpenAIClientOrNull(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return null;
  return new OpenAI({ apiKey });
}

function truncateOneLine(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ").replace(/\n+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

const SYSTEM_PROMPT = `You extract ONE clear daily accountability bar from an SMS. Output ONLY valid JSON matching the schema below.
Rules:
- Extract a single concrete, action-oriented daily commitment the system could hold the user to tomorrow.
- Do not invent activities, durations, or details not supported by the user's words.
- Do not moralize, coach, or judge.
- Do not claim any database or commitment was changed.
- Prefer short phrases (roughly under 240 characters) that sound like a daily bar.
- If the message is only agreement/disagreement, emotional venting, or topics with no actionable bar, set has_candidate false.
- Reject vague identity/emotional goals: "be better", "try harder", "feel healthier", "my kids", "whatever", "I don't know".
- Reject pure filler or opt-out language with no action.
- candidate_kind: "tighten" if this reads like shrinking an existing bar; "replace" if a new goal; "unknown" if unclear.
- confidence: 0–1 how sure you are that candidate_behavior_statement is a usable daily bar from THIS message alone.
- needs_clarification: true if the user should be asked for one clearer action instead of guessing.

JSON schema keys (exact):
{"has_candidate":bool,"candidate_behavior_statement":string|null,"confidence":number,"candidate_kind":"tighten"|"replace"|"unknown","reasoning_short":string,"needs_clarification":bool,"clarification_question":string|null}`;

function parseCandidateKind(v: unknown): "tighten" | "replace" | "unknown" {
  if (v === "tighten" || v === "replace" || v === "unknown") return v;
  return "unknown";
}

function parseAiPayload(raw: Record<string, unknown>): V2SmsPendingCandidateAiParsed | null {
  const has_candidate = raw.has_candidate === true;
  const cbs =
    typeof raw.candidate_behavior_statement === "string"
      ? truncateOneLine(raw.candidate_behavior_statement, CANDIDATE_MAX_CHARS)
      : null;
  let confidence = 0;
  if (typeof raw.confidence === "number" && Number.isFinite(raw.confidence)) {
    confidence = Math.min(1, Math.max(0, raw.confidence));
  } else {
    return null;
  }
  const reasoning_short =
    typeof raw.reasoning_short === "string"
      ? truncateOneLine(raw.reasoning_short, REASONING_SHORT_MAX)
      : "";
  if (!reasoning_short) return null;

  let clarification_question: string | null = null;
  if (typeof raw.clarification_question === "string" && raw.clarification_question.trim()) {
    clarification_question = truncateOneLine(raw.clarification_question, 200);
  }

  return {
    has_candidate,
    candidate_behavior_statement: cbs && cbs.length > 0 ? cbs : null,
    confidence,
    candidate_kind: parseCandidateKind(raw.candidate_kind),
    reasoning_short,
    needs_clarification: raw.needs_clarification === true,
    clarification_question,
  };
}

/**
 * Calls OpenAI to extract a daily-bar candidate. Caller runs deterministic validation afterward.
 */
export async function tryExtractV2SmsPendingResolutionCandidateAi(args: {
  rawInbound: string;
  pendingKind: "commitment_tighten" | "commitment_replace";
  behaviorStatementPreview: string;
}): Promise<TryExtractV2SmsPendingResolutionCandidateAiResult> {
  const client = getOpenAIClientOrNull();
  if (!client) {
    return { ok: false, attempted: false, reason: "no_openai_key" };
  }

  const inbound = truncateOneLine(args.rawInbound, 900);
  const pendingHint =
    args.pendingKind === "commitment_tighten"
      ? "The user is tightening/shrinking their daily bar (smaller honest version)."
      : "The user is replacing their daily commitment with a new bar.";

  const userBlock = [
    pendingHint,
    "",
    `Current_written_commitment_TRUNCATED (context only; do not quote verbatim if user proposes something new): ${truncateOneLine(args.behaviorStatementPreview, 260)}`,
    "",
    `USER_SMS: ${inbound}`,
    "",
    "Return ONLY one JSON object with the exact keys from the system schema.",
  ].join("\n");

  try {
    const completion = await client.chat.completions.create({
      model: V2_SMS_PENDING_CANDIDATE_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userBlock },
      ],
      temperature: 0.2,
      max_tokens: 350,
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) {
      return { ok: false, attempted: true, reason: "empty_model_output", model: V2_SMS_PENDING_CANDIDATE_MODEL };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { ok: false, attempted: true, reason: "invalid_json", model: V2_SMS_PENDING_CANDIDATE_MODEL };
    }

    const data = parseAiPayload(parsed);
    if (!data) {
      return { ok: false, attempted: true, reason: "validation_failed", model: V2_SMS_PENDING_CANDIDATE_MODEL };
    }

    return { ok: true, attempted: true, data, model: V2_SMS_PENDING_CANDIDATE_MODEL };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, attempted: true, reason: `openai_error:${msg}`, model: V2_SMS_PENDING_CANDIDATE_MODEL };
  }
}
