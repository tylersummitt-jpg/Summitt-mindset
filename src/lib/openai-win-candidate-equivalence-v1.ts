/**
 * Item #2 corrective — semantic same vs distinct for recognized Win candidates
 * relative to a confirmed user_yes accountability completion.
 *
 * OpenAI owns ONLY the same/distinct judgment.
 * Server owns user_yes truth, accountability Win existence, max-two, idempotency.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import type {
  WinCandidateV1,
  WinRelationshipTypeV1,
} from "@/lib/openai-win-recognition-v1";
import { runLaneOpenAiJsonWithOneRetry } from "@/lib/v3-lane-openai-json-retry";

export const WIN_EQUIVALENCE_VERSION = "win_eq_v1" as const;
export const WIN_EQUIVALENCE_OPENAI_MODEL = "gpt-4o-mini" as const;
const OPENAI_TIMEOUT_MS = 8_000;

export type WinEquivalenceJudgment = "same" | "distinct";

export type WinCandidateEquivalenceJudgment = {
  ordinal: 0 | 1;
  equivalence: WinEquivalenceJudgment;
  confidence: number | null;
};

export type WinCandidateEquivalenceBatchResult = {
  judgments: WinCandidateEquivalenceJudgment[];
  source: "openai" | "fallback";
  ok: boolean;
  parse_ok: boolean;
  timed_out: boolean;
  skipped: boolean;
  skip_reason: string | null;
};

/**
 * Conservative failure fallback (product truth):
 * - whole_life / identity → distinct (do not casually discard independent Wins)
 * - goal / mixed → same (prefer avoiding duplicate completion Wins)
 */
export function fallbackEquivalenceForRelationship(
  relationshipType: WinRelationshipTypeV1
): WinEquivalenceJudgment {
  if (relationshipType === "whole_life" || relationshipType === "identity") {
    return "distinct";
  }
  return "same";
}

export function fallbackEquivalenceJudgmentsForCandidates(
  candidates: WinCandidateV1[]
): WinCandidateEquivalenceJudgment[] {
  return candidates.map((c) => ({
    ordinal: c.ordinal === 1 ? 1 : 0,
    equivalence: fallbackEquivalenceForRelationship(c.relationship_type),
    confidence: null,
  }));
}

function trimCtx(s: string | null | undefined, max: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "(none)";
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export function buildWinCandidateEquivalenceSystemPrompt(): string {
  return `You classify whether a recognized Victory Room Win candidate is the SAME accomplishment as a confirmed commitment follow-through (user_yes), or a DISTINCT second accomplishment in the same inbound message.

Return JSON only.

Rules:
- "same" = restatement, paraphrase, or detail of completing the Current Goal / accountability follow-through already confirmed by user_yes
- "distinct" = a genuinely separate meaningful accomplishment (may still be goal-linked, mixed, identity, or whole-life)
- Example same: "Yep, did it" / "got the workout done" / "lifted for 30 minutes" when Current Goal is lift 30 minutes
- Example distinct: first 300-lb deadlift mentioned alongside confirming the workout; a promotion; an identity moment unrelated to merely saying yes
- Do not decide whether user_yes occurred
- Do not decide whether any Win should be persisted
- Judge each candidate independently against the accountability completion

OUTPUT:
{
  "version": "win_eq_v1",
  "judgments": [
    { "ordinal": 0 | 1, "equivalence": "same" | "distinct", "confidence": number | null }
  ]
}`;
}

export function buildWinCandidateEquivalenceUserPrompt(args: {
  currentGoal: string | null;
  inboundMessage: string;
  accountabilityActionFact: string;
  candidates: WinCandidateV1[];
}): string {
  const lines = args.candidates.map((c) => {
    return [
      `candidate_ordinal: ${c.ordinal}`,
      `relationship_type: ${c.relationship_type}`,
      `grounded_action: ${trimCtx(c.grounded_action, 240)}`,
      `why_meaningful: ${trimCtx(c.why_meaningful, 240)}`,
      `suggested_title: ${trimCtx(c.suggested_title, 80)}`,
    ].join("\n");
  });

  return `WIN_CANDIDATE_EQUIVALENCE_V1
current_goal: ${trimCtx(args.currentGoal, 280)}
accountability_action_fact: ${trimCtx(args.accountabilityActionFact, 240)}
inbound_message: ${trimCtx(args.inboundMessage, 1200)}

CANDIDATES:
${lines.length > 0 ? lines.join("\n---\n") : "(none)"}

Return judgments for every candidate ordinal listed. JSON only.`;
}

function parseEquivalenceBatch(
  raw: string,
  expectedOrdinals: Array<0 | 1>
): WinCandidateEquivalenceJudgment[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== WIN_EQUIVALENCE_VERSION) return null;
  if (!Array.isArray(obj.judgments)) return null;

  const byOrdinal = new Map<number, WinCandidateEquivalenceJudgment>();
  for (const row of obj.judgments) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const ordinal = r.ordinal === 1 ? 1 : r.ordinal === 0 ? 0 : null;
    if (ordinal == null) continue;
    if (r.equivalence !== "same" && r.equivalence !== "distinct") continue;
    const confidence =
      typeof r.confidence === "number" && r.confidence >= 0 && r.confidence <= 1
        ? r.confidence
        : null;
    byOrdinal.set(ordinal, {
      ordinal,
      equivalence: r.equivalence,
      confidence,
    });
  }

  if (expectedOrdinals.length === 0) return [];
  const out: WinCandidateEquivalenceJudgment[] = [];
  for (const ord of expectedOrdinals) {
    const hit = byOrdinal.get(ord);
    if (!hit) return null;
    out.push(hit);
  }
  return out;
}

function getOpenAiClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

/**
 * Classify each recognized candidate as same vs distinct vs the accountability completion.
 * On any failure/unavailable: apply fallbackEquivalenceForRelationship per candidate.
 */
export async function classifyWinCandidatesEquivalenceV1(args: {
  currentGoal: string | null;
  inboundMessage: string;
  accountabilityActionFact: string;
  candidates: WinCandidateV1[];
}): Promise<WinCandidateEquivalenceBatchResult> {
  const candidates = args.candidates;
  const fallback = (): WinCandidateEquivalenceBatchResult => ({
    judgments: fallbackEquivalenceJudgmentsForCandidates(candidates),
    source: "fallback",
    ok: true,
    parse_ok: false,
    timed_out: false,
    skipped: true,
    skip_reason: "fallback",
  });

  if (candidates.length === 0) {
    return {
      judgments: [],
      source: "fallback",
      ok: true,
      parse_ok: true,
      timed_out: false,
      skipped: true,
      skip_reason: "no_candidates",
    };
  }

  const inbound = (args.inboundMessage ?? "").trim();
  if (!inbound) {
    return { ...fallback(), skip_reason: "empty_inbound" };
  }

  const client = getOpenAiClient();
  if (!client) {
    return { ...fallback(), skip_reason: "missing_openai_key" };
  }

  const expectedOrdinals = candidates.map((c) => (c.ordinal === 1 ? 1 : 0) as 0 | 1);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const primaryMessages: ChatCompletionMessageParam[] = [
      { role: "system", content: buildWinCandidateEquivalenceSystemPrompt() },
      {
        role: "user",
        content: buildWinCandidateEquivalenceUserPrompt({
          currentGoal: args.currentGoal,
          inboundMessage: inbound,
          accountabilityActionFact: args.accountabilityActionFact,
          candidates,
        }),
      },
    ];

    const jsonOut = await runLaneOpenAiJsonWithOneRetry({
      client,
      model: WIN_EQUIVALENCE_OPENAI_MODEL,
      temperature: 0,
      maxTokens: 300,
      primaryMessages,
      jsonSchemaReminder:
        'Schema: version "win_eq_v1", judgments array of { ordinal: 0|1, equivalence: "same"|"distinct", confidence: number|null }.',
      parse: (raw) => parseEquivalenceBatch(raw, expectedOrdinals),
      signal: controller.signal,
      allowRetry: true,
    });

    if (jsonOut.value == null) {
      console.warn("[win_candidate_equivalence_parse_fail]", {
        schema_version: WIN_EQUIVALENCE_VERSION,
      });
      return { ...fallback(), skip_reason: "parse_fail" };
    }

    return {
      judgments: jsonOut.value,
      source: "openai",
      ok: true,
      parse_ok: true,
      timed_out: false,
      skipped: false,
      skip_reason: null,
    };
  } catch (e) {
    const timedOut =
      (e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message))) ||
      controller.signal.aborted;
    if (timedOut) {
      console.warn("[win_candidate_equivalence_timeout]", {
        schema_version: WIN_EQUIVALENCE_VERSION,
      });
      return { ...fallback(), timed_out: true, skip_reason: "timeout" };
    }
    console.warn("[win_candidate_equivalence_openai_error]", {
      schema_version: WIN_EQUIVALENCE_VERSION,
      error: e instanceof Error ? e.message.slice(0, 120) : "unknown",
    });
    return { ...fallback(), skip_reason: "openai_error" };
  } finally {
    clearTimeout(timer);
  }
}

export function equivalenceMapFromJudgments(
  judgments: WinCandidateEquivalenceJudgment[]
): Record<number, WinEquivalenceJudgment> {
  const out: Record<number, WinEquivalenceJudgment> = {};
  for (const j of judgments) {
    out[j.ordinal] = j.equivalence;
  }
  return out;
}
