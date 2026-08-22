/**
 * D2a dedicated photo-only semantic call.
 * Does not write DB, send SMS, create Wins, or receive image bytes.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { scrubOpenAiRequestErrorForCapture } from "@/lib/openai-request-error-scrub";

export const INBOUND_MMS_D2A_SEMANTIC_MODEL = "gpt-5.6-sol" as const;
export const INBOUND_MMS_D2A_SEMANTIC_REASONING_EFFORT = "low" as const;
export const INBOUND_MMS_D2A_SEMANTIC_MAX_COMPLETION_TOKENS = 400 as const;
export const INBOUND_MMS_D2A_SEMANTIC_PROMPT_PATH = "inbound_mms_d2a_v1" as const;

export type InboundMmsD2aSemanticDecision = "attach_existing_win" | "no_attach";

export type InboundMmsD2aSemanticResult =
  | {
      ok: true;
      decision: InboundMmsD2aSemanticDecision;
      target_win_id: string | null;
    }
  | { ok: false; reason: string };

export type InboundMmsD2aSemanticFacts = {
  pending_photo: {
    job_id: string;
    age_seconds: number;
    message_sid: string;
  };
  recent_thread: Array<{
    at: string;
    role: string;
    body: string;
  }>;
  candidate_wins: Array<{
    id: string;
    text: string;
    occurred_at: string;
    relationship_type: string | null;
    commitment_id: string | null;
  }>;
  current_goal: string | null;
  identity: string | null;
  open_coach_question: string | null;
};

export const INBOUND_MMS_D2A_SEMANTIC_SYSTEM_PROMPT = `You decide whether a parked inbound photo-only MMS clearly belongs to one EXISTING Win already listed in candidate_wins.

You never receive image bytes, URLs, or Storage paths. The photo itself is not shown. Use conversational context only.

Hard rules:
- CODE does not understand English. You are the only semantic brain for this photo-only job.
- You may ONLY select a target_win_id copied exactly from candidate_wins[].id. Never invent, guess, or modify a UUID.
- Elapsed time alone is never enough. Recency/sequence may be one clue together with text meaning and continuity.
- Do not pick the latest Win just because it is latest. Do not pick the nearest timestamp.
- If two Wins could reasonably fit, or the thread is unrelated, or a human could not tell: decision = no_attach, target_win_id = null.
- If Coach asked the user to send a picture of a specific existing moment and one listed Win is that moment: attach_existing_win with that exact id.
- If the user reported a Win in text shortly before this photo and the photo is the natural picture of that same moment: attach_existing_win with that exact id.
- If there is no useful recent conversation, or it is clearly about something else: no_attach.
- Do not ask questions. Do not write SMS. Do not create a new Win. Output JSON only.
- candidate_wins are unoccupied (no media yet). Do not invent other targets.

Output:
{"decision":"attach_existing_win"|"no_attach","target_win_id":"<uuid>"|null}
attach_existing_win requires target_win_id from candidate_wins.
no_attach requires target_win_id null.`;

export const INBOUND_MMS_D2A_SEMANTIC_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "inbound_mms_d2a_semantics_v1",
    strict: true as const,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["decision", "target_win_id"],
      properties: {
        decision: {
          type: "string",
          enum: ["attach_existing_win", "no_attach"],
        },
        target_win_id: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    },
  },
};

export function buildInboundMmsD2aSemanticUserPayload(
  facts: InboundMmsD2aSemanticFacts
): string {
  return JSON.stringify({
    pending_photo: facts.pending_photo,
    recent_thread: facts.recent_thread,
    candidate_wins: facts.candidate_wins,
    current_goal: facts.current_goal,
    identity: facts.identity,
    open_coach_question: facts.open_coach_question,
  });
}

export function parseInboundMmsD2aSemanticOutput(
  raw: unknown,
  allowedWinIds: Set<string>
): InboundMmsD2aSemanticResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "invalid_json" };
  }
  const rec = raw as Record<string, unknown>;
  const decision = rec.decision;
  if (decision === "no_attach") {
    return { ok: true, decision: "no_attach", target_win_id: null };
  }
  if (decision !== "attach_existing_win") {
    return { ok: false, reason: "invalid_decision" };
  }
  const id = typeof rec.target_win_id === "string" ? rec.target_win_id.trim() : "";
  if (!id) return { ok: true, decision: "no_attach", target_win_id: null };
  const allowed = [...allowedWinIds].some(
    (w) => w.trim().toLowerCase() === id.toLowerCase()
  );
  if (!allowed) {
    return { ok: true, decision: "no_attach", target_win_id: null };
  }
  const canonical = [...allowedWinIds].find(
    (w) => w.trim().toLowerCase() === id.toLowerCase()
  );
  return {
    ok: true,
    decision: "attach_existing_win",
    target_win_id: canonical ?? id,
  };
}

export type RunInboundMmsD2aSemanticDeps = {
  client?: { chat: { completions: { create: typeof OpenAI.prototype.chat.completions.create } } } | null;
};

export async function runInboundMmsD2aSemantics(
  facts: InboundMmsD2aSemanticFacts,
  deps: RunInboundMmsD2aSemanticDeps = {}
): Promise<InboundMmsD2aSemanticResult> {
  const allowed = new Set(facts.candidate_wins.map((w) => w.id.trim()).filter(Boolean));
  if (allowed.size === 0) {
    return { ok: true, decision: "no_attach", target_win_id: null };
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const client =
    deps.client === undefined
      ? apiKey
        ? new OpenAI({ apiKey })
        : null
      : deps.client;
  if (!client) {
    return { ok: false, reason: "openai_unavailable" };
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: INBOUND_MMS_D2A_SEMANTIC_SYSTEM_PROMPT },
    { role: "user", content: buildInboundMmsD2aSemanticUserPayload(facts) },
  ];

  try {
    const completion = await client.chat.completions.create({
      model: INBOUND_MMS_D2A_SEMANTIC_MODEL,
      reasoning_effort: INBOUND_MMS_D2A_SEMANTIC_REASONING_EFFORT,
      max_completion_tokens: INBOUND_MMS_D2A_SEMANTIC_MAX_COMPLETION_TOKENS,
      response_format: INBOUND_MMS_D2A_SEMANTIC_RESPONSE_FORMAT,
      messages,
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!raw) return { ok: false, reason: "empty_response" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "invalid_json" };
    }
    return parseInboundMmsD2aSemanticOutput(parsed, allowed);
  } catch (err) {
    scrubOpenAiRequestErrorForCapture(err);
    return { ok: false, reason: "openai_request_failed" };
  }
}
