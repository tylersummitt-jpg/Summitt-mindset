/**
 * D2b dedicated post-grace semantic call.
 * Does not write DB, send SMS, create Wins, or receive image bytes.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { scrubOpenAiRequestErrorForCapture } from "@/lib/openai-request-error-scrub";
import type { InboundMmsD2aSemanticFacts } from "@/lib/victory-media/inbound-mms-d2a-semantics";
import { isValidInboundMmsD2bClarificationBody } from "@/lib/victory-media/inbound-mms-d2b-codes";

export const INBOUND_MMS_D2B_SEMANTIC_MODEL = "gpt-5.6-sol" as const;
export const INBOUND_MMS_D2B_SEMANTIC_REASONING_EFFORT = "low" as const;
export const INBOUND_MMS_D2B_SEMANTIC_MAX_COMPLETION_TOKENS = 400 as const;
export const INBOUND_MMS_D2B_SEMANTIC_PROMPT_PATH = "inbound_mms_d2b_v1" as const;

export type InboundMmsD2bSemanticDecision =
  | "attach_existing_win"
  | "ask_clarification"
  | "no_action";

export type InboundMmsD2bSemanticResult =
  | {
      ok: true;
      decision: "attach_existing_win";
      target_win_id: string;
      clarification_body: null;
    }
  | {
      ok: true;
      decision: "ask_clarification";
      target_win_id: null;
      clarification_body: string;
    }
  | {
      ok: true;
      decision: "no_action";
      target_win_id: null;
      clarification_body: null;
    }
  | { ok: false; reason: string };

export type InboundMmsD2bSemanticFacts = InboundMmsD2aSemanticFacts;

export const INBOUND_MMS_D2B_SEMANTIC_SYSTEM_PROMPT = `You decide what to do with a parked inbound photo-only MMS after a 10-minute grace. The photo itself is not shown. You never receive image bytes, URLs, or Storage paths.

You may:
- attach_existing_win: the conversation now makes it obvious this photo belongs to one EXISTING Win in candidate_wins.
- ask_clarification: send exactly one short natural Coach question so the user can say what the photo is.
- no_action: still unclear and a question would be wrong (unrelated thread, two equally plausible Wins, or you must not ask).

Hard rules:
- CODE does not understand English. You are the only semantic brain for this wake.
- You may ONLY select a target_win_id copied exactly from candidate_wins[].id. Never invent a UUID.
- Elapsed time alone is never enough. Do not pick the latest Win because it is latest.
- If two Wins could reasonably fit: no_action, not a guess attach.
- ask_clarification must be ONE short natural question, like: "What made this one a win for you?"
- Do NOT ask category/type/Overall vs Current Goal. No menus, options, or A/B/C.
- Do NOT say the photo was saved, attached, added, or is in the Victory Room. It is still pending.
- Do not write SMS besides clarification_body. Do not create a new Win. Output JSON only.

Output:
{"decision":"attach_existing_win"|"ask_clarification"|"no_action","target_win_id":"<uuid>"|null,"clarification_body":"<question>"|null}
attach_existing_win requires target_win_id from candidate_wins and clarification_body null.
ask_clarification requires target_win_id null and one natural question.
no_action requires both null.`;

export const INBOUND_MMS_D2B_SEMANTIC_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "inbound_mms_d2b_semantics_v1",
    strict: true as const,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["decision", "target_win_id", "clarification_body"],
      properties: {
        decision: {
          type: "string",
          enum: ["attach_existing_win", "ask_clarification", "no_action"],
        },
        target_win_id: { anyOf: [{ type: "string" }, { type: "null" }] },
        clarification_body: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    },
  },
};

export function buildInboundMmsD2bSemanticUserPayload(
  facts: InboundMmsD2bSemanticFacts
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

export function parseInboundMmsD2bSemanticOutput(
  raw: unknown,
  allowedWinIds: Set<string>
): InboundMmsD2bSemanticResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "invalid_json" };
  }
  const rec = raw as Record<string, unknown>;
  const decision = rec.decision;
  if (decision === "no_action") {
    return {
      ok: true,
      decision: "no_action",
      target_win_id: null,
      clarification_body: null,
    };
  }
  if (decision === "ask_clarification") {
    const body =
      typeof rec.clarification_body === "string"
        ? rec.clarification_body.trim()
        : "";
    if (!isValidInboundMmsD2bClarificationBody(body)) {
      return { ok: false, reason: "invalid_clarification_body" };
    }
    return {
      ok: true,
      decision: "ask_clarification",
      target_win_id: null,
      clarification_body: body,
    };
  }
  if (decision !== "attach_existing_win") {
    return { ok: false, reason: "invalid_decision" };
  }
  const id = typeof rec.target_win_id === "string" ? rec.target_win_id.trim() : "";
  if (!id) return { ok: false, reason: "invalid_target" };
  const allowed = [...allowedWinIds].some(
    (w) => w.trim().toLowerCase() === id.toLowerCase()
  );
  if (!allowed) {
    return { ok: false, reason: "unknown_target" };
  }
  const canonical = [...allowedWinIds].find(
    (w) => w.trim().toLowerCase() === id.toLowerCase()
  );
  return {
    ok: true,
    decision: "attach_existing_win",
    target_win_id: canonical ?? id,
    clarification_body: null,
  };
}

export type RunInboundMmsD2bSemanticDeps = {
  client?: {
    chat: { completions: { create: typeof OpenAI.prototype.chat.completions.create } };
  } | null;
};

export async function runInboundMmsD2bSemantics(
  facts: InboundMmsD2bSemanticFacts,
  deps: RunInboundMmsD2bSemanticDeps = {}
): Promise<InboundMmsD2bSemanticResult> {
  const allowed = new Set(
    facts.candidate_wins.map((w) => w.id.trim()).filter(Boolean)
  );

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
    { role: "system", content: INBOUND_MMS_D2B_SEMANTIC_SYSTEM_PROMPT },
    { role: "user", content: buildInboundMmsD2bSemanticUserPayload(facts) },
  ];

  try {
    const completion = await client.chat.completions.create({
      model: INBOUND_MMS_D2B_SEMANTIC_MODEL,
      reasoning_effort: INBOUND_MMS_D2B_SEMANTIC_REASONING_EFFORT,
      max_completion_tokens: INBOUND_MMS_D2B_SEMANTIC_MAX_COMPLETION_TOKENS,
      response_format: INBOUND_MMS_D2B_SEMANTIC_RESPONSE_FORMAT,
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
    return parseInboundMmsD2bSemanticOutput(parsed, allowed);
  } catch (err) {
    scrubOpenAiRequestErrorForCapture(err);
    return { ok: false, reason: "openai_request_failed" };
  }
}
