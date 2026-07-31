/**
 * OpenAI Win Recognition V1 — semantic authority for Victory Room Wins.
 * Deterministic code validates shape/lengths/enums/idempotency only; it does not
 * reinterpret whether a message is a Win (including bare user_yes).
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { runLaneOpenAiJsonWithOneRetry } from "@/lib/v3-lane-openai-json-retry";

export const WIN_RECOGNITION_VERSION = "win_v1" as const;
export const WIN_RECOGNITION_OPENAI_MODEL = "gpt-4o-mini" as const;

const OPENAI_TIMEOUT_MS = 10_000;

/** Application field length limits (mirrored by DB CHECKs). */
export const WIN_FIELD_LIMITS = {
  action_fact: 240,
  why_meaningful: 360,
  display_title: 80,
  display_body: 240,
  supporting_quote: 240,
  hidden_reason: 240,
} as const;

export type WinRelationshipTypeV1 = "goal" | "identity" | "whole_life" | "mixed";
export type WinRecognitionModeV1 = "user_identified" | "coach_recognized";

export type WinCandidateV1 = {
  ordinal: 0 | 1;
  grounded_action: string;
  why_meaningful: string | null;
  suggested_title: string;
  suggested_body: string;
  evidence_quote: string | null;
  relationship_type: WinRelationshipTypeV1;
  recognition_mode: WinRecognitionModeV1;
  user_expressed_pride: boolean;
  identity_related: boolean;
  sensitivity_caution: boolean;
  celebration_appropriate: boolean;
  model_confidence: number | null;
};

export type WinRecognitionResultV1 = {
  version: typeof WIN_RECOGNITION_VERSION;
  has_win: boolean;
  wins: WinCandidateV1[];
};

export type WinRecognitionInputV1 = {
  inboundMessage: string;
  priorOutboundOrOpenQuestion: string | null;
  recentExactThreadExcerpt: string | null;
  currentGoal: string | null;
  identityStatement: string | null;
  userFirstName: string | null;
  pendingRouteSummary: string | null;
  resolvedAccountabilityResult: string | null;
  safetyOrUrgencyOwned: boolean;
  routeOwner: string | null;
  recentWinSummary: string | null;
};

export type WinRecognitionCallMeta = {
  ok: boolean;
  skipped: boolean;
  skip_reason: string | null;
  parse_ok: boolean;
  timed_out: boolean;
  candidate_count: number;
  model: string | null;
  latency_ms: number | null;
  schema_version: typeof WIN_RECOGNITION_VERSION;
};

const RELATIONSHIP_TYPES = new Set<string>(["goal", "identity", "whole_life", "mixed"]);
const RECOGNITION_MODES = new Set<string>(["user_identified", "coach_recognized"]);

export function emptyWinRecognitionResult(): WinRecognitionResultV1 {
  return { version: WIN_RECOGNITION_VERSION, has_win: false, wins: [] };
}

function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function trimTo(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max).trimEnd();
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}

function evidenceIsExactSubstring(quote: string, inbound: string): boolean {
  if (!quote) return false;
  return inbound.includes(quote);
}

/**
 * Deterministic validation of OpenAI Win JSON.
 * On any contract failure, returns safe no-Win (caller logs parse_fail).
 */
export function parseAndValidateWinRecognitionResult(
  raw: unknown,
  inboundMessage: string
): WinRecognitionResultV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== WIN_RECOGNITION_VERSION) return null;
  if (typeof obj.has_win !== "boolean") return null;
  if (!Array.isArray(obj.wins)) return null;

  if (!obj.has_win) {
    if (obj.wins.length !== 0) return null;
    return emptyWinRecognitionResult();
  }

  if (obj.wins.length < 1 || obj.wins.length > 2) return null;

  const seen = new Set<number>();
  const wins: WinCandidateV1[] = [];

  for (let i = 0; i < obj.wins.length; i++) {
    const c = obj.wins[i];
    if (!c || typeof c !== "object") return null;
    const row = c as Record<string, unknown>;

    const ordinalRaw = row.ordinal;
    const ordinal =
      ordinalRaw === 0 || ordinalRaw === 1
        ? ordinalRaw
        : ordinalRaw === "0"
          ? 0
          : ordinalRaw === "1"
            ? 1
            : null;
    if (ordinal !== 0 && ordinal !== 1) return null;
    if (seen.has(ordinal)) return null;
    seen.add(ordinal);

    const grounded = typeof row.grounded_action === "string" ? row.grounded_action.trim() : "";
    const title = typeof row.suggested_title === "string" ? row.suggested_title.trim() : "";
    const body = typeof row.suggested_body === "string" ? row.suggested_body.trim() : "";
    if (!grounded || !title || !body) return null;

    const whyRaw =
      row.why_meaningful == null
        ? null
        : typeof row.why_meaningful === "string"
          ? row.why_meaningful.trim()
          : null;
    if (row.why_meaningful != null && whyRaw === null) return null;

    const rel = row.relationship_type;
    if (typeof rel !== "string" || !RELATIONSHIP_TYPES.has(rel)) return null;
    const mode = row.recognition_mode;
    if (typeof mode !== "string" || !RECOGNITION_MODES.has(mode)) return null;

    let evidence: string | null = null;
    if (row.evidence_quote != null) {
      if (typeof row.evidence_quote !== "string") return null;
      const q = row.evidence_quote.trim();
      if (q) {
        if (!evidenceIsExactSubstring(q, inboundMessage)) return null;
        evidence = trimTo(q, WIN_FIELD_LIMITS.supporting_quote);
      }
    }

    const sensitivity = asBool(row.sensitivity_caution, false);
    if (sensitivity) evidence = null;

    let confidence: number | null = null;
    if (row.model_confidence != null) {
      if (typeof row.model_confidence !== "number") return null;
      confidence = clampConfidence(row.model_confidence);
    }

    wins.push({
      ordinal,
      grounded_action: trimTo(grounded, WIN_FIELD_LIMITS.action_fact),
      why_meaningful: whyRaw ? trimTo(whyRaw, WIN_FIELD_LIMITS.why_meaningful) : null,
      suggested_title: trimTo(title, WIN_FIELD_LIMITS.display_title),
      suggested_body: trimTo(body, WIN_FIELD_LIMITS.display_body),
      evidence_quote: evidence,
      relationship_type: rel as WinRelationshipTypeV1,
      recognition_mode: mode as WinRecognitionModeV1,
      user_expressed_pride: asBool(row.user_expressed_pride, false),
      identity_related: asBool(row.identity_related, false),
      sensitivity_caution: sensitivity,
      celebration_appropriate: asBool(row.celebration_appropriate, true),
      model_confidence: confidence,
    });
  }

  wins.sort((a, b) => a.ordinal - b.ordinal);
  if (wins[0]?.ordinal !== 0) return null;
  if (wins.length === 2 && wins[1]?.ordinal !== 1) return null;

  return {
    version: WIN_RECOGNITION_VERSION,
    has_win: true,
    wins,
  };
}

export function parseWinRecognitionJsonString(
  raw: string,
  inboundMessage: string
): WinRecognitionResultV1 | null {
  const text = raw.trim();
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return parseAndValidateWinRecognitionResult(parsed, inboundMessage);
}

export function buildWinRecognitionSystemPrompt(): string {
  return `You are Coach Pat's Win recognition interpreter for Victory Room.

Victory Room preserves meaningful evidence of growth so the customer can feel proud of who they are becoming.

A Win is a meaningful, source-grounded action or growth moment — not every positive sentence, not every reply, not every yes, and not every honest miss.

OpenAI owns semantic judgment. Return structured JSON only.

Win criteria (you decide):
- Completing the Current Goal, meaningful progress, follow-through, overcoming resistance
- Courage, generosity, discipline, relationship repair, leadership, character, identity-aligned behavior
- Meaningful action unrelated to the Current Goal (whole-life)
- A substantive action the user explicitly says they are proud of
- Agency must be the user's; completed action differs from future intention
- Do not award participation trophies
- A bare "yes" may be a Win ONLY when the prior coach question clearly grounds a meaningful completed action
- A miss may coexist with an unrelated Win in the same message
- Family/team success is not automatically the user's Win unless their own meaningful action is present
- Prefer zero or one Win; return two only when the message clearly contains two distinct meaningful actions
- When uncertain whether a real meaningful action occurred, return has_win=false
- Never invent facts
- evidence_quote must be an exact substring of the current inbound message (or null)
- Sensitive material may still be a Win; set sensitivity_caution=true (quote may be omitted)
- suggested_title / suggested_body: specific, concise, human, proud — not inflated
- Do NOT write: "Win detected", "saved", "logged", "recorded", "added to Victory Room"
- Order wins by the order the actions appear in the inbound message (ordinal 0 then 1)

OUTPUT JSON schema:
{
  "version": "win_v1",
  "has_win": boolean,
  "wins": [
    {
      "ordinal": 0 | 1,
      "grounded_action": string,
      "why_meaningful": string | null,
      "suggested_title": string,
      "suggested_body": string,
      "evidence_quote": string | null,
      "relationship_type": "goal" | "identity" | "whole_life" | "mixed",
      "recognition_mode": "user_identified" | "coach_recognized",
      "user_expressed_pride": boolean,
      "identity_related": boolean,
      "sensitivity_caution": boolean,
      "celebration_appropriate": boolean,
      "model_confidence": number | null
    }
  ]
}
When has_win is false, wins must be [].
When has_win is true, wins length is 1 or 2.`;
}

export function buildWinRecognitionUserPrompt(input: WinRecognitionInputV1): string {
  const truncate = (s: string | null | undefined, max: number): string => {
    const t = (s ?? "").replace(/\s+/g, " ").trim();
    if (!t) return "(none)";
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
  };

  return `WIN_RECOGNITION_CONTEXT_V1
user_first_name: ${truncate(input.userFirstName, 40)}
route_owner: ${truncate(input.routeOwner, 80)}
safety_or_urgency_owned: ${input.safetyOrUrgencyOwned ? "true" : "false"}
pending_route_summary: ${truncate(input.pendingRouteSummary, 200)}
resolved_accountability_result: ${truncate(input.resolvedAccountabilityResult, 120)}
current_goal: ${truncate(input.currentGoal, 280)}
identity_statement: ${truncate(input.identityStatement, 280)}
prior_outbound_or_open_question: ${truncate(input.priorOutboundOrOpenQuestion, 400)}
recent_exact_thread_excerpt: ${truncate(input.recentExactThreadExcerpt, 800)}
recent_win_summary: ${truncate(input.recentWinSummary, 200)}

CURRENT_INBOUND_MESSAGE:
${truncate(input.inboundMessage, 1200)}

Decide has_win and return JSON only.`;
}

export function buildWinRecognitionMessages(
  input: WinRecognitionInputV1
): ChatCompletionMessageParam[] {
  return [
    { role: "system", content: buildWinRecognitionSystemPrompt() },
    { role: "user", content: buildWinRecognitionUserPrompt(input) },
  ];
}

function getOpenAiClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

/**
 * Call OpenAI for Win recognition. Malformed/timeout → safe no-Win.
 * Does not use accountability user_yes as fallback Win authority.
 */
export async function recognizeWinsFromInboundV1(
  input: WinRecognitionInputV1
): Promise<{ result: WinRecognitionResultV1; meta: WinRecognitionCallMeta }> {
  const baseMeta: WinRecognitionCallMeta = {
    ok: false,
    skipped: false,
    skip_reason: null,
    parse_ok: false,
    timed_out: false,
    candidate_count: 0,
    model: WIN_RECOGNITION_OPENAI_MODEL,
    latency_ms: null,
    schema_version: WIN_RECOGNITION_VERSION,
  };

  const inbound = (input.inboundMessage ?? "").trim();
  if (!inbound) {
    return {
      result: emptyWinRecognitionResult(),
      meta: { ...baseMeta, skipped: true, skip_reason: "empty_inbound", ok: true },
    };
  }

  if (input.safetyOrUrgencyOwned) {
    return {
      result: emptyWinRecognitionResult(),
      meta: { ...baseMeta, skipped: true, skip_reason: "safety_or_urgency_owned", ok: true },
    };
  }

  const client = getOpenAiClient();
  if (!client) {
    console.warn("[win_recognition] missing_openai_key");
    return {
      result: emptyWinRecognitionResult(),
      meta: { ...baseMeta, skipped: true, skip_reason: "missing_openai_key", ok: true },
    };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const primaryMessages = buildWinRecognitionMessages(input);
    const jsonOut = await runLaneOpenAiJsonWithOneRetry({
      client,
      model: WIN_RECOGNITION_OPENAI_MODEL,
      temperature: 0.2,
      maxTokens: 700,
      primaryMessages,
      jsonSchemaReminder:
        'Schema: version "win_v1", has_win boolean, wins array (0–2). Each win: ordinal 0|1, grounded_action, why_meaningful, suggested_title, suggested_body, evidence_quote, relationship_type, recognition_mode, user_expressed_pride, identity_related, sensitivity_caution, celebration_appropriate, model_confidence.',
      parse: (raw) => parseWinRecognitionJsonString(raw, inbound),
      signal: controller.signal,
      allowRetry: true,
    });

    const latency = Date.now() - started;
    if (jsonOut.value == null) {
      console.warn("[win_recognition_parse_fail]", {
        schema_version: WIN_RECOGNITION_VERSION,
        latency_ms: latency,
        lane_json_retry_attempted: jsonOut.retryMeta.lane_json_retry_attempted,
      });
      return {
        result: emptyWinRecognitionResult(),
        meta: {
          ...baseMeta,
          ok: true,
          parse_ok: false,
          latency_ms: latency,
          candidate_count: 0,
        },
      };
    }

    return {
      result: jsonOut.value,
      meta: {
        ...baseMeta,
        ok: true,
        parse_ok: true,
        latency_ms: latency,
        candidate_count: jsonOut.value.wins.length,
      },
    };
  } catch (e) {
    const latency = Date.now() - started;
    const timedOut =
      (e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message))) ||
      controller.signal.aborted;
    if (timedOut) {
      console.warn("[win_recognition_timeout]", {
        schema_version: WIN_RECOGNITION_VERSION,
        latency_ms: latency,
      });
    } else {
      console.warn("[win_recognition_parse_fail]", {
        schema_version: WIN_RECOGNITION_VERSION,
        latency_ms: latency,
        error: e instanceof Error ? e.message.slice(0, 120) : "unknown",
      });
    }
    return {
      result: emptyWinRecognitionResult(),
      meta: {
        ...baseMeta,
        ok: true,
        parse_ok: false,
        timed_out: timedOut,
        latency_ms: latency,
        candidate_count: 0,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Compact facts for V3 writer — no storage claim permission. */
export type WinRecognitionFactsForV3 = {
  version: typeof WIN_RECOGNITION_VERSION;
  has_win: boolean;
  wins: Array<{
    ordinal: 0 | 1;
    grounded_action: string;
    why_meaningful: string | null;
    suggested_title: string;
    relationship_type: WinRelationshipTypeV1;
    recognition_mode: WinRecognitionModeV1;
    celebration_appropriate: boolean;
    identity_related: boolean;
    sensitivity_caution: boolean;
  }>;
  /** True only after successful durable persist of all recognized wins. */
  durable_persist_succeeded: boolean;
  /** Never imply saved/logged/recorded/added in the creating reply. */
  may_claim_saved: false;
};

export function toWinRecognitionFactsForV3(
  result: WinRecognitionResultV1,
  durablePersistSucceeded = false
): WinRecognitionFactsForV3 {
  return {
    version: WIN_RECOGNITION_VERSION,
    has_win: result.has_win,
    wins: result.wins.map((w) => ({
      ordinal: w.ordinal,
      grounded_action: w.grounded_action,
      why_meaningful: w.why_meaningful,
      suggested_title: w.suggested_title,
      relationship_type: w.relationship_type,
      recognition_mode: w.recognition_mode,
      celebration_appropriate: w.celebration_appropriate,
      identity_related: w.identity_related,
      sensitivity_caution: w.sensitivity_caution,
    })),
    durable_persist_succeeded: durablePersistSucceeded,
    may_claim_saved: false,
  };
}

/**
 * Route eligibility for Win recognition — ownership/safety only.
 * Does not keyword-filter human messages.
 */
export function shouldRunWinRecognitionForInbound(args: {
  inboundBody: string | null | undefined;
  isTapback?: boolean;
  isEmpty?: boolean;
  isSafetyOrCrisisOwned?: boolean;
  isComplianceOrStop?: boolean;
  isSystemNoise?: boolean;
}): { run: boolean; reason: string | null } {
  const body = (args.inboundBody ?? "").trim();
  if (args.isEmpty || !body) return { run: false, reason: "empty_message" };
  if (args.isTapback) return { run: false, reason: "tapback" };
  if (args.isSafetyOrCrisisOwned) return { run: false, reason: "safety_or_crisis" };
  if (args.isComplianceOrStop) return { run: false, reason: "compliance_or_stop" };
  if (args.isSystemNoise) return { run: false, reason: "system_noise" };
  return { run: true, reason: null };
}
