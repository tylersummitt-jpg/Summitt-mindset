/**
 * V3 SMS Brain — orchestrator for visible coaching copy (Phase 4–8).
 * V2 remains authoritative for spine events; North Star remains deterministic guard after V3 drafts OpenAI.
 */

import OpenAI from "openai";

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { V2EventRowForAi } from "@/lib/v2-commitment";
import type { V2InboundGatedDecision } from "@/lib/v2-ai-inbound";
import type { V2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory-prompt";
import type { NorthStarSmsContextPacket } from "@/lib/north-star-coach-sms";
import type { ExpectedReplySemanticsV3 } from "@/lib/north-star-sms-context-packet";
import {
  finalizeNorthStarCoachSms,
  finalizeNorthStarInboundCoachReply,
  type NorthStarInboundCoachCtx,
  type NorthStarCoachSmsResult,
} from "@/lib/north-star-coach-sms";
import {
  generateV3OpenQuestionAnswerReply,
  inboundDefersTodayForTomorrow,
  tryResolveAnswerToOpenQuestionTurn,
  type V3AnswerToOpenQuestionResult,
} from "@/lib/v3-sms-turn";
import {
  deriveV3LearningSignalsFromContext,
  type V3LearningSignals,
} from "@/lib/v3-sms-learning";
import { formatCoachingMemoryPromptBlock } from "@/lib/v2-coaching-memory-prompt";

export const V3_BRAIN_VERSION = "v3_brain_phase8_2026_05";

/** Visible SMS was produced or refined by V3 — Phase 2 / Phase 5a must not rewrite voice. */
export function isV3OwnedInboundReplySource(source: string | null | undefined): boolean {
  if (!source?.trim()) return false;
  return (
    source === "v3_sms_brain" ||
    source === "v3_deterministic_fallback" ||
    source === "v3_daily_check_in" ||
    source === "v3_daily_deterministic_fallback" ||
    source === "v3_answer_to_open_question" ||
    source === "v3_refined_prior_draft" ||
    source === "v3_refresh_refined" ||
    source === "v3_memory_confirmation_refined" ||
    source === "v3_contract_consent_refined" ||
    source === "v3_adaptive_proposal_refined" ||
    source === "v3_weekly_proof_refined" ||
    source === "v3_followup_sms_refined" ||
    source === "v3_missed_yesterday_sms_refined" ||
    source === "v3_winback_refined" ||
    source === "v3_inactivity_rescue_refined" ||
    source === "v3_machine_deterministic_fallback"
  );
}

/**
 * Final visible coach source for V3-owned inbound copy (before North Star).
 * Open-question path and prior-hint refinements get distinct labels for observability.
 */
export function inferV3InboundReplySource(
  brain: V3SmsBrainResult,
  openAiOk: boolean,
  hadPriorDraftHint: boolean
): "v3_sms_brain" | "v3_deterministic_fallback" | "v3_answer_to_open_question" | "v3_refined_prior_draft" {
  if (brain.turnPurpose === "answer_to_open_question") {
    return "v3_answer_to_open_question";
  }
  if (hadPriorDraftHint) {
    return "v3_refined_prior_draft";
  }
  return openAiOk ? "v3_sms_brain" : "v3_deterministic_fallback";
}

/** When full SMS conversation pack fails, still feed V3 + open-question logic a minimal thread. */
export function buildMinimalInboundTranscriptLines(
  convPackFull: import("@/lib/v2-sms-conversation-context").V2SmsConversationContextPack | null,
  userMessage: string,
  lastOutboundSmsPreview: string | null
): string[] {
  if (convPackFull?.recentTranscriptLines?.length) {
    return convPackFull.recentTranscriptLines;
  }
  const lines: string[] = [];
  const coach = lastOutboundSmsPreview?.trim();
  if (coach) lines.push(`Coach: ${coach.slice(0, 380)}`);
  const user = userMessage.trim();
  if (user) lines.push(`User: ${user.slice(0, 380)}`);
  if (!lines.length && user) lines.push(`User: ${user.slice(0, 380)}`);
  return lines;
}

export type V3SmsTurnPurpose =
  | "daily_check_response_completion"
  | "daily_check_response_miss"
  | "daily_check_response_partial"
  | "answer_to_open_question"
  | "future_plan"
  | "blocker_detail"
  | "proof_detail"
  | "emotional_context"
  | "user_question"
  | "goal_change_request"
  | "commitment_evolution_signal"
  | "casual_context"
  | "unclear_but_contextual";

export type V3SmsBrainResult = {
  turnPurpose: V3SmsTurnPurpose;
  confidence: "high" | "medium" | "low";
  /** When set, {@link generateV3CoachReply} routes through {@link tryGenerateV3OpenQuestionCoachReply} (OpenAI + deterministic fallback). */
  openQuestionResolution?: import("@/lib/v3-sms-turn").V3AnswerToOpenQuestionResult | null;
  answeredOpenQuestion?: boolean;
  accountabilityEventCandidate?: "user_yes" | "user_no" | "user_partial" | null;
  shouldWriteOutcomeEvent?: boolean;
  blockerSignal?: boolean;
  blockerDetail?: string | null;
  proofSignal?: boolean;
  proofSummary?: string | null;
  futurePlan?: {
    kind: "tomorrow" | "future" | "stretch" | "time_block" | "story_title" | "unknown";
    value?: string | null;
  } | null;
  commitmentChangeIntent?: "none" | "one_day_adjustment" | "durable_change_requested" | "unclear";
  learningSignal?: V3LearningSignals | null;
  nextCoachingMove?:
    | "ask_accountability"
    | "acknowledge_completion"
    | "capture_proof"
    | "name_blocker"
    | "narrow_blocker"
    | "simplify_ask"
    | "propose_experiment"
    | "shift_upstream"
    | "confirm_future_plan"
    | "clarify_goal_change"
    | "answer_human_question"
    | "identity_reinforcement"
    | "soft_comeback"
    | "direct_challenge";
  nextOpenQuestion?: string | null;
  coachReplyDraft: string;
  metadata?: Record<string, unknown>;
};

export type UnderstandV3SmsTurnArgs = {
  inboundRaw: string;
  timezone: string;
  commitment: ActiveV2CommitmentRow;
  effectiveAsk: string;
  northStarPacket: NorthStarSmsContextPacket;
  recentTranscriptLines: string[];
  expectedReplySemantics: ExpectedReplySemanticsV3;
  latestOpenQuestion: string | null;
  todayCompleted: boolean;
  coachingMemory: V2CoachingMemoryForPrompt | null;
  recentEvents: V2EventRowForAi[];
  gatedDecision: V2InboundGatedDecision;
  deterministicEventType: "user_yes" | "user_no" | "user_partial";
};

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return null;
  return new OpenAI({ apiKey });
}

export function mapOutcomeToPurpose(
  ft: "user_yes" | "user_no" | "user_partial" | null | undefined
): V3SmsTurnPurpose {
  if (ft === "user_yes") return "daily_check_response_completion";
  if (ft === "user_no") return "daily_check_response_miss";
  if (ft === "user_partial") return "daily_check_response_partial";
  return "unclear_but_contextual";
}

function heuristicPurposeFromInbound(raw: string): V3SmsTurnPurpose | null {
  const t = raw.trim();
  if (/can\s+i\s+change\s+(the\s+)?(goal|commitment|standard)/i.test(t)) return "goal_change_request";
  if (/\b(i\s+don'?t\s+care|nothing\s+matters|what'?s\s+the\s+point)\b/i.test(t)) return "emotional_context";
  if (/\?\s*$/.test(t) && t.length > 12 && !/^(yes|no|yep|nope)\b/i.test(t)) return "user_question";
  if (/\b(two\s+hours|stretch|tomorrow\s+i\b).*\b(hour|block)/i.test(t)) return "future_plan";
  return null;
}

function pickNextMove(p: V3SmsTurnPurpose, learning: V3LearningSignals | null): V3SmsBrainResult["nextCoachingMove"] {
  if (p === "daily_check_response_completion") return "acknowledge_completion";
  if (p === "daily_check_response_miss") {
    if (learning?.blockerPattern === "late_bedtime_upstream") return "shift_upstream";
    if (learning?.blockerPattern === "snooze_alarm") return "propose_experiment";
    if (learning?.blockerPattern === "travel_disruption") return "simplify_ask";
    if (learning?.blockerPattern === "avoidance_getting_started") return "narrow_blocker";
    return "name_blocker";
  }
  if (p === "answer_to_open_question") return "confirm_future_plan";
  if (p === "goal_change_request") return "clarify_goal_change";
  if (p === "emotional_context") return "direct_challenge";
  if (p === "user_question") return "answer_human_question";
  return "ask_accountability";
}

/**
 * Hybrid turn understanding: deterministic first (open question, heuristics, gated spine outcome), optional OpenAI for low confidence.
 */
export async function understandV3SmsTurn(args: UnderstandV3SmsTurnArgs): Promise<V3SmsBrainResult> {
  const inbound = args.inboundRaw.trim();
  const learning = deriveV3LearningSignalsFromContext({
    recentEventsNewestFirst: args.recentEvents,
    coachingMemory: args.coachingMemory,
    latestInbound: inbound,
  });

  const openTry = tryResolveAnswerToOpenQuestionTurn({
    inboundRaw: inbound,
    latestOpenQuestion: args.latestOpenQuestion,
    expectedReplySemantics: args.expectedReplySemantics,
    recentTranscriptLines: args.recentTranscriptLines,
    todayCompleted: args.todayCompleted,
    effectiveAsk: args.effectiveAsk,
    behaviorStatement: args.commitment.behavior_statement ?? "",
  });

  if (openTry) {
    return {
      turnPurpose: "answer_to_open_question",
      confidence: "high",
      openQuestionResolution: openTry,
      answeredOpenQuestion: true,
      accountabilityEventCandidate: null,
      shouldWriteOutcomeEvent: false,
      learningSignal: learning,
      nextCoachingMove: "confirm_future_plan",
      nextOpenQuestion: null,
      coachReplyDraft: "",
      metadata: { open_subkind: openTry.subkind, v3_brain_version: V3_BRAIN_VERSION },
    };
  }

  const finalFt = args.gatedDecision.final_event_type ?? args.deterministicEventType;
  let purpose = mapOutcomeToPurpose(finalFt);
  let confidence: "high" | "medium" | "low" = "high";

  const hint = heuristicPurposeFromInbound(inbound);
  if (
    hint &&
    (purpose === "unclear_but_contextual" ||
      (hint === "emotional_context" && finalFt === "user_partial"))
  ) {
    purpose = hint;
    confidence = "medium";
  }

  if (purpose === "unclear_but_contextual" && inbound.length > 8) {
    const client = getOpenAI();
    if (client) {
      try {
        const completion = await client.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0.2,
          max_tokens: 120,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                'Classify SMS reply. Respond JSON: {"turnPurpose":"<enum>","confidence":"high"|"medium"|"low"}. Enum: daily_check_response_completion, daily_check_response_miss, daily_check_response_partial, proof_detail, future_plan, blocker_detail, emotional_context, user_question, goal_change_request, casual_context, unclear_but_contextual.',
            },
            {
              role: "user",
              content: `Inbound:\n${inbound.slice(0, 500)}\nSpine classifier hint: ${args.deterministicEventType}\nGated final: ${String(args.gatedDecision.final_event_type)}`,
            },
          ],
        });
        const raw = completion.choices[0]?.message?.content?.trim() ?? "";
        const parsed = JSON.parse(raw) as { turnPurpose?: string; confidence?: string };
        if (parsed.turnPurpose && typeof parsed.turnPurpose === "string") {
          purpose = parsed.turnPurpose as V3SmsTurnPurpose;
          confidence = (parsed.confidence as "high" | "medium" | "low") ?? "low";
        }
      } catch {
        confidence = "low";
      }
    }
  }

  const groundedProofDetail =
    /\b(focused|proof|finished|dictated|wrote|completed|stayed\s+focused)\b/i.test(inbound) ||
    inbound.length > 40;
  const proofSignal =
    purpose === "daily_check_response_completion" && groundedProofDetail;

  const wiseAdjustment =
    purpose === "daily_check_response_partial" &&
    Boolean(learning?.currentExperiment || learning?.failedStrategy);
  const comebackCand =
    purpose === "daily_check_response_miss" && /\b(back|again|retry|restart|starting)\b/i.test(inbound);

  return {
    turnPurpose: purpose,
    confidence,
    accountabilityEventCandidate: args.gatedDecision.should_write_outcome_event ? finalFt : null,
    shouldWriteOutcomeEvent: args.gatedDecision.should_write_outcome_event,
    proofSignal,
    proofSummary: proofSignal ? inbound.slice(0, 120) : null,
    learningSignal: learning,
    commitmentChangeIntent: /one\s*day|just\s*today|temporary/i.test(inbound)
      ? "one_day_adjustment"
      : /new\s+standard|forever|from\s+now\s+on/i.test(inbound)
        ? "durable_change_requested"
        : "none",
    nextCoachingMove: pickNextMove(purpose, learning),
    coachReplyDraft: "",
    metadata: {
      v3_brain_version: V3_BRAIN_VERSION,
      gated_mode: args.gatedDecision.mode,
      spine_hint: args.deterministicEventType,
      wise_adjustment: wiseAdjustment,
      comeback: comebackCand,
    },
  };
}

export type GenerateV3CoachReplyArgs = {
  understanding: V3SmsBrainResult;
  inboundRaw: string;
  messageSid: string;
  effectiveAsk: string;
  behaviorStatement: string;
  northStarPacket: NorthStarSmsContextPacket;
  coachingMemory: V2CoachingMemoryForPrompt | null;
  preferredName?: string | null;
  /** Prior visible SMS from advisory layers (conversation brain, pivot, clarify). V3 rewrites into final voice. */
  priorDraftHint?: { source: string; text: string } | null;
};

export type OpenQuestionReplyGenerationMeta = {
  openQuestionReplySource: "openai" | "deterministic_fallback";
  deterministicFallbackReason?: string | null;
};

const BANNED_LINE =
  "Never say: yes/no/partial menu, reply yes or no, great job, keep momentum, let me know how it went, staying consistent is key, it's important to, check the app, contract, overlay, pending resolution, V2, Pat Summitt's name more than once.";

/**
 * Open-question replies prefer OpenAI with full thread context; deterministic templates are emergency-only
 * (plus vetted safe paths like explicit defer-to-tomorrow routing).
 */
export async function tryGenerateV3OpenQuestionCoachReply(args: {
  resolution: V3AnswerToOpenQuestionResult;
  inboundRaw: string;
  messageSid: string;
  todayCompleted: boolean;
  effectiveAsk: string;
  behaviorStatement: string;
  northStarPacket: NorthStarSmsContextPacket;
  coachingMemory: V2CoachingMemoryForPrompt | null;
  latestOpenQuestion: string | null;
  expectedReplySemantics: ExpectedReplySemanticsV3;
  learningSignal?: V3LearningSignals | null;
}): Promise<{ text: string; openAiOk: boolean } & OpenQuestionReplyGenerationMeta> {
  const sub = args.resolution.subkind;
  /** Audited safe deterministic — avoids repeating the micro-step-today question; no extra LLM spend. */
  if (sub === "defer_today_micro_step_to_tomorrow") {
    return {
      text: generateV3OpenQuestionAnswerReply({
        v3: args.resolution,
        messageSid: args.messageSid,
        todayCompleted: args.todayCompleted,
        effectiveAsk: args.effectiveAsk,
      }),
      openAiOk: true,
      openQuestionReplySource: "deterministic_fallback",
      deterministicFallbackReason: "defer_today_micro_step_safe_template",
    };
  }

  const client = getOpenAI();
  if (!client) {
    return {
      text: generateV3OpenQuestionAnswerReply({
        v3: args.resolution,
        messageSid: args.messageSid,
        todayCompleted: args.todayCompleted,
        effectiveAsk: args.effectiveAsk,
      }),
      openAiOk: false,
      openQuestionReplySource: "deterministic_fallback",
      deterministicFallbackReason: "no_openai_key",
    };
  }

  const transcript =
    args.northStarPacket.recentTranscriptLines?.slice(-12).join("\n") ??
    args.northStarPacket.recentTranscriptSnippet ??
    "";
  const memoryBlock = formatCoachingMemoryPromptBlock(args.coachingMemory);
  const dnr = args.learningSignal?.doNotRepeat?.trim() ?? null;

  const system = `You write ONE outbound SMS as an accountability coach (Pat Summitt principles: direct, warm-not-soft, human).
The user ALREADY answered the coach's latest question. Your reply must respond to their answer — never repeat or re-ask that same question.
Never output menus (yes/no/partial), "did you manage," "let me know how it went," hollow motivation, or "check the app."
If they defer today to tomorrow / it's late: close today and make tomorrow concrete (time or first protected block).
If they gave a time, confirm it in plain language. If they gave a story title or concrete detail, acknowledge it briefly then one forward move.
Max ~300 characters. Single SMS. No bullet lists.`;

  const user = `Routing subkind: ${sub}
Extracted answer (may be partial): ${args.resolution.extractedAnswer ?? "(none)"}
Latest coach question (do NOT repeat this): ${args.latestOpenQuestion ?? "(unknown)"}
Expected reply semantics: ${args.expectedReplySemantics}
Today already completed (server): ${String(args.todayCompleted)}
Effective ask: ${args.effectiveAsk}
Behavior: ${args.behaviorStatement}
User's latest inbound: ${args.inboundRaw.trim()}
Do-not-repeat coaching hint: ${dnr || "(none)"}
Memory snapshot:
${memoryBlock.slice(0, 1200)}
Recent transcript:
${transcript.slice(0, 1400)}
Write the SMS body only.`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.35,
      max_tokens: 220,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("empty");
    const cleaned = text.replace(/^["']|["']$/g, "").trim();
    return {
      text: cleaned,
      openAiOk: true,
      openQuestionReplySource: "openai",
      deterministicFallbackReason: null,
    };
  } catch {
    return {
      text: generateV3OpenQuestionAnswerReply({
        v3: args.resolution,
        messageSid: args.messageSid,
        todayCompleted: args.todayCompleted,
        effectiveAsk: args.effectiveAsk,
      }),
      openAiOk: false,
      openQuestionReplySource: "deterministic_fallback",
      deterministicFallbackReason: "openai_failed_or_empty",
    };
  }
}

/**
 * Produces visible SMS body; open-question path prefers OpenAI with deterministic emergency fallback.
 */
export async function generateV3CoachReply(args: GenerateV3CoachReplyArgs): Promise<{
  text: string;
  openAiOk: boolean;
  confidence: number | null;
  openQuestionReplyMeta?: OpenQuestionReplyGenerationMeta | null;
}> {
  const openRes = args.understanding.openQuestionResolution;
  if (openRes) {
    const oq = await tryGenerateV3OpenQuestionCoachReply({
      resolution: openRes,
      inboundRaw: args.inboundRaw,
      messageSid: args.messageSid,
      todayCompleted: args.northStarPacket.todayCompleted === true,
      effectiveAsk: args.effectiveAsk,
      behaviorStatement: args.behaviorStatement,
      northStarPacket: args.northStarPacket,
      coachingMemory: args.coachingMemory,
      latestOpenQuestion: args.northStarPacket.latestOpenQuestion ?? null,
      expectedReplySemantics:
        (args.northStarPacket.expectedReplySemantics as ExpectedReplySemanticsV3) ?? "unknown",
      learningSignal: args.understanding.learningSignal ?? null,
    });
    return {
      text: oq.text,
      openAiOk: oq.openAiOk,
      confidence: oq.openQuestionReplySource === "openai" ? 0.9 : 0.5,
      openQuestionReplyMeta: {
        openQuestionReplySource: oq.openQuestionReplySource,
        deterministicFallbackReason: oq.deterministicFallbackReason ?? null,
      },
    };
  }

  const client = getOpenAI();
  if (!client) {
    return {
      text: fallbackInboundReply(args.understanding, args.effectiveAsk, {
        inboundRaw: args.inboundRaw,
        northStarPacket: args.northStarPacket,
      }),
      openAiOk: false,
      confidence: null,
    };
  }

  const memoryBlock = formatCoachingMemoryPromptBlock(args.coachingMemory);
  const transcript =
    args.northStarPacket.recentTranscriptLines?.slice(-10).join("\n") ?? args.northStarPacket.recentTranscriptSnippet ?? "";

  const system = `You are the SMS voice of an accountability coach inspired by Pat Summitt's principles: direct, warm-not-soft, emotionally intelligent, short, specific, never robotic.
${BANNED_LINE}
Stay anchored to the ONE active commitment (effective ask) and the latest turn in the transcript. Do not jump to unrelated topics from long-term memory (gratitude prompts, other habits, side goals) unless the user explicitly raised them this message.
Formula: acknowledge reality → interpret what it means → one useful question OR one clear next action.
Max ~320 characters. Single SMS. No bullet lists.`;

  const hint =
    args.priorDraftHint?.text?.trim() && args.priorDraftHint.source
      ? `\nPrior draft (${args.priorDraftHint.source}) — keep intent, rewrite in V3 voice:\n${args.priorDraftHint.text.trim().slice(0, 520)}\n`
      : "";

  const dnr = args.understanding.learningSignal?.doNotRepeat?.trim();
  const dnrLine = dnr ? `\nDo not repeat this coaching angle again: ${dnr}. Ask a fresh question.\n` : "";

  const user = `Turn purpose: ${args.understanding.turnPurpose}
Next move: ${args.understanding.nextCoachingMove ?? "coach"}
Confidence: ${args.understanding.confidence}
Learning hints: ${JSON.stringify(args.understanding.learningSignal ?? {})}
Effective ask: ${args.effectiveAsk}
User said: ${args.inboundRaw.trim()}
${dnrLine}${hint}Transcript context:
${transcript}
Memory snapshot:
${memoryBlock.slice(0, 1800)}
Draft the reply SMS only.`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.45,
      max_tokens: 220,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("empty");
    return { text: text.replace(/^["']|["']$/g, "").trim(), openAiOk: true, confidence: 0.85 };
  } catch {
    return {
      text: fallbackInboundReply(args.understanding, args.effectiveAsk, {
        inboundRaw: args.inboundRaw,
        northStarPacket: args.northStarPacket,
      }),
      openAiOk: false,
      confidence: null,
    };
  }
}

function inboundLooksAnsweredOpenQuestion(inbound: string, latestQ: string): boolean {
  if (!latestQ || inbound.length < 8) return false;
  if (/^(yes|no|yep|nope|ok|k)\b/i.test(inbound) && inbound.length < 16) return false;
  return true;
}

function fallbackInboundReply(
  u: V3SmsBrainResult,
  effectiveAsk: string,
  ctx?: Pick<GenerateV3CoachReplyArgs, "inboundRaw" | "northStarPacket">
): string {
  const ask = effectiveAsk.trim().slice(0, 80) || "the rep";
  const learn = u.learningSignal;
  const inbound = ctx?.inboundRaw?.trim() ?? "";
  const pkt = ctx?.northStarPacket;
  const latestQ = pkt?.latestOpenQuestion?.trim() ?? "";
  const todayDone = pkt?.todayCompleted === true;

  if (inbound && inboundDefersTodayForTomorrow(inbound)) {
    return `Fair — I'm closing today. What time tomorrow protects your first real move on ${ask}?`;
  }

  if (
    latestQ &&
    inboundLooksAnsweredOpenQuestion(inbound, latestQ) &&
    !/^(yes|no|yep|nope)\s*$/i.test(inbound.trim())
  ) {
    return `Got it. I'm not circling the same ask — what's the next concrete move on ${ask}?`;
  }

  if (todayDone && inbound.length > 8 && !/\b(miss|didn'?t|failed|nope)\b/i.test(inbound.toLowerCase())) {
    return `That tracks — what's tomorrow's first protected block?`;
  }

  const missDetail =
    learn?.blockerPattern === "late_bedtime_upstream"
      ? "sleep timing"
      : learn?.blockerPattern === "travel_disruption"
        ? "travel"
        : learn?.blockerPattern === "snooze_alarm"
          ? "alarm routine"
          : learn?.blockerPattern === "avoidance_getting_started"
            ? "getting started"
            : null;

  switch (u.turnPurpose) {
    case "daily_check_response_completion":
      return `That counts. What made it possible today?`;
    case "daily_check_response_miss":
      return missDetail != null
        ? `That's honest. What broke — was it ${missDetail}, time, or environment?`
        : `That's honest. What broke — time, size, or environment?`;
    case "daily_check_response_partial":
      return `Partial still tells us something. What got done, and what broke?`;
    case "blocker_detail":
      return `That's the real obstacle. What part needs to change tomorrow?`;
    case "future_plan":
      return `Good. Make tomorrow concrete. What time does it start?`;
    case "proof_detail":
      return `Noted. What’s the one detail that made it real today?`;
    case "emotional_context":
      return `That's different. Are you done with the goal, or tired of failing at the current version?`;
    case "goal_change_request":
      return `Yes. Is this a one-day adjustment, or a new daily standard you want me to hold you to?`;
    case "user_question":
      return `I'll answer direct where I can — what's the real question behind this text about ${ask}?`;
    default: {
      const dnr = learn?.doNotRepeat;
      if (dnr === "repeat_what_got_in_the_way_question" || dnr === "narrow_blocker_not_generic_why") {
        return `Name one concrete block—one line, not a story. What was it?`;
      }
      return `I'm not going to guess. What actually happened with ${ask} today?`;
    }
  }
}

export type GenerateV3DailyCheckInArgs = {
  commitmentId: string;
  effectiveAsk: string;
  behaviorStatement: string;
  priorOutcome: string | null;
  coachingMemory: V2CoachingMemoryForPrompt | null;
  serverStrategy: string;
  silenceTier: string;
  blockerPreview: string | null;
  recentSmsContextBlock: string | null;
  preferredName?: string | null;
  identityAnchor?: string | null;
  recentEventsNewestFirst?: V2EventRowForAi[];
  /** Server truth only — binding proposal / evolution semantics; V3 styles the visible line. */
  dailyPurpose?: string | null;
  contractProposalKind?: string | null;
  contractBindingText?: string | null;
  evolutionPatternHint?: string | null;
  resolvedTemplateFallback?: string | null;
};

/**
 * Memory-aware daily check-in line (replaces generic template body).
 */
export async function generateV3DailyCheckIn(args: GenerateV3DailyCheckInArgs): Promise<{
  text: string;
  openAiOk: boolean;
}> {
  const client = getOpenAI();
  const learning = deriveV3LearningSignalsFromContext({
    recentEventsNewestFirst: args.recentEventsNewestFirst ?? [],
    coachingMemory: args.coachingMemory,
    latestInbound: null,
  });

  const styleHint =
    args.priorOutcome === "user_yes"
      ? "after_a_win"
      : args.priorOutcome === "user_no"
        ? "after_a_miss"
        : args.silenceTier !== "none"
          ? "silence_recovery"
          : "normal";

  if (!client) {
    return {
      text: fallbackDailyBody(args, learning, styleHint),
      openAiOk: false,
    };
  }

  const system = `You write ONE short daily accountability SMS for someone keeping a commitment.
${BANNED_LINE}
Stay anchored to the ONE effective ask below; memory/thread hints are texture only — do not pivot to unrelated topics (gratitude exercises, other habits) unless that pivot is already explicit in server binding/daily purpose.
Ask if they did the rep today in fresh words — not a reminder app. No yes/no/partial menu.
Style: ${styleHint}. Strategy context: ${args.serverStrategy}.
Max ~280 characters.`;

  const binding =
    args.dailyPurpose === "evolution_pattern_check" && args.evolutionPatternHint?.trim()
      ? `Evolution check (server topic): ${args.evolutionPatternHint.trim().slice(0, 240)}`
      : args.contractBindingText?.trim()
        ? `Contract proposal (server binding; do not change terms): kind=${args.contractProposalKind ?? "unknown"} text=${args.contractBindingText.trim().slice(0, 280)}`
        : "";

  const seed =
    args.resolvedTemplateFallback?.trim() && args.resolvedTemplateFallback.length > 8
      ? `\nTemplate seed (paraphrase freely): ${args.resolvedTemplateFallback.trim().slice(0, 360)}\n`
      : "";

  const memDaily = formatCoachingMemoryPromptBlock(args.coachingMemory);

  const user = `Effective ask: ${args.effectiveAsk}
Daily purpose: ${args.dailyPurpose ?? "standard"}
Prior outcome: ${args.priorOutcome ?? "unknown"}
Blocker hint: ${args.blockerPreview ?? "none"}
Learning: ${JSON.stringify(learning)}
Memory snapshot (authoritative context; includes [v3_notebook] lines):
${memDaily.slice(0, 1400)}
${binding ? `${binding}\n` : ""}${seed}Recent thread:
${(args.recentSmsContextBlock ?? "").slice(0, 1200)}
Write the daily check SMS only.`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 200,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("empty");
    return { text: text.replace(/^["']|["']$/g, "").trim(), openAiOk: true };
  } catch {
    return { text: fallbackDailyBody(args, learning, styleHint), openAiOk: false };
  }
}

function fallbackDailyBody(
  args: GenerateV3DailyCheckInArgs,
  learning: V3LearningSignals,
  styleHint: string
): string {
  const core = args.effectiveAsk.trim().slice(0, 72) || "your commitment";

  if (styleHint === "silence_recovery") {
    return `Still here with you. ${core} — tell me straight where you landed today.`;
  }

  if (learning.workingCondition === "phone_blocked_or_protected" || learning.workingCondition === "early_start") {
    return `That setup worked last time. Did you protect it again for ${core}?`;
  }
  if (learning.workingCondition === "before_nap_window") {
    return `Last time the blocker was getting started before nap. What's the first version you'll protect today?`;
  }

  if (styleHint === "after_a_win") {
    return `You got it yesterday. Did you back it up today?`;
  }
  if (styleHint === "after_a_miss") {
    if (learning.blockerPattern === "late_bedtime_upstream") {
      return `Morning starts tonight. What time is lights out before tomorrow's ${core}?`;
    }
    return `Today is the response. Did you show back up on ${core}?`;
  }

  if (learning.blockerPattern === "travel_disruption") {
    return `We need the travel version. What's the smallest honest rep on ${core}?`;
  }
  if (learning.blockerPattern === "avoidance_getting_started") {
    return `First 10 minutes only — what version will you start on ${core}?`;
  }
  if (learning.blockerPattern === "snooze_alarm") {
    return `Phone across the room tonight. Are you willing to do it before tomorrow's ${core}?`;
  }
  if (learning.blockerPattern === "late_bedtime_upstream") {
    return `Morning starts tonight. What time is lights out before ${core}?`;
  }

  return `One honest rep on ${core} — what happened today?`;
}

/** Deterministic V3 daily line when OpenAI fails or throws — never raw template resolution. */
export function generateV3DailyDeterministicFallback(args: GenerateV3DailyCheckInArgs): string {
  const learning = deriveV3LearningSignalsFromContext({
    recentEventsNewestFirst: args.recentEventsNewestFirst ?? [],
    coachingMemory: args.coachingMemory,
    latestInbound: null,
  });
  const styleHint =
    args.priorOutcome === "user_yes"
      ? "after_a_win"
      : args.priorOutcome === "user_no"
        ? "after_a_miss"
        : args.silenceTier !== "none"
          ? "silence_recovery"
          : "normal";
  return fallbackDailyBody(args, learning, styleHint);
}

/** Deterministic North Star pass for V3 inbound (no OpenAI finalizer). */
export function finalizeV3SmsReply(args: {
  proposedBody: string;
  ctx: NorthStarInboundCoachCtx;
  channel?: import("@/lib/north-star-coach-sms").NorthStarCoachChannel;
}): NorthStarCoachSmsResult {
  return finalizeNorthStarInboundCoachReply({
    proposedBody: args.proposedBody,
    ctx: args.ctx,
    channel: args.channel ?? "inbound_coach_reply",
  });
}

export function finalizeV3DailyThroughNorthStar(args: {
  proposedBody: string;
  contextPacket: NorthStarSmsContextPacket;
}): NorthStarCoachSmsResult {
  return finalizeNorthStarCoachSms({
    proposedBody: args.proposedBody,
    channel: "daily_outbound",
    contextPacket: args.contextPacket,
    replySource: "v3_daily_check_in",
    effectiveAskText: args.contextPacket.effectiveAskText ?? undefined,
    behaviorStatement: args.contextPacket.behaviorStatement ?? undefined,
  });
}

export type ProduceV3InboundCoachDraftArgs = {
  userMessage: string;
  messageSid: string;
  commitment: ActiveV2CommitmentRow;
  effectiveAsk: string;
  timezone: string;
  northStarPacket: NorthStarSmsContextPacket;
  convPackRecentLines: string[];
  expectedReplySemantics: ExpectedReplySemanticsV3;
  latestOpenQuestion: string | null;
  todayCompleted: boolean;
  coachingMemory: V2CoachingMemoryForPrompt | null;
  recentEvents: V2EventRowForAi[];
  gatedDecision: V2InboundGatedDecision;
  deterministicEventType: "user_yes" | "user_no" | "user_partial";
  priorDraftHint?: { source: string; text: string } | null;
};

function mergeBrainWithCoachGenerateMeta(
  understanding: V3SmsBrainResult,
  gen: Awaited<ReturnType<typeof generateV3CoachReply>>
): V3SmsBrainResult {
  const metaExtra: Record<string, unknown> = {};
  if (gen.openQuestionReplyMeta) {
    metaExtra.open_question_reply_source = gen.openQuestionReplyMeta.openQuestionReplySource;
    metaExtra.deterministic_fallback_reason = gen.openQuestionReplyMeta.deterministicFallbackReason ?? null;
    metaExtra.deterministic_fallback_used =
      gen.openQuestionReplyMeta.openQuestionReplySource === "deterministic_fallback";
  } else if (!gen.openAiOk) {
    metaExtra.deterministic_fallback_used = true;
    metaExtra.deterministic_fallback_reason = "v3_inbound_openai_unavailable_or_failed";
  }
  return Object.keys(metaExtra).length > 0
    ? { ...understanding, metadata: { ...understanding.metadata, ...metaExtra } }
    : understanding;
}

/** Raw SMS draft for inbound (North Star applied once downstream). Always returns a draft for accountable routing. */
export async function produceV3InboundCoachDraft(
  args: ProduceV3InboundCoachDraftArgs
): Promise<{ draft: string; brain: V3SmsBrainResult; openAiOk: boolean }> {
  const understanding = await understandV3SmsTurn({
    inboundRaw: args.userMessage,
    timezone: args.timezone,
    commitment: args.commitment,
    effectiveAsk: args.effectiveAsk,
    northStarPacket: args.northStarPacket,
    recentTranscriptLines: args.convPackRecentLines,
    expectedReplySemantics: args.expectedReplySemantics,
    latestOpenQuestion: args.latestOpenQuestion,
    todayCompleted: args.todayCompleted,
    coachingMemory: args.coachingMemory,
    recentEvents: args.recentEvents,
    gatedDecision: args.gatedDecision,
    deterministicEventType: args.deterministicEventType,
  });

  const gen = await generateV3CoachReply({
    understanding,
    inboundRaw: args.userMessage,
    messageSid: args.messageSid,
    effectiveAsk: args.effectiveAsk,
    behaviorStatement: args.commitment.behavior_statement ?? "",
    northStarPacket: args.northStarPacket,
    coachingMemory: args.coachingMemory,
    priorDraftHint: args.priorDraftHint ?? null,
  });

  return { draft: gen.text, brain: mergeBrainWithCoachGenerateMeta(understanding, gen), openAiOk: gen.openAiOk };
}

/** Deterministic V3-shaped fallback when OpenAI is unavailable or throws (still North Star guarded downstream). */
export function v3DeterministicInboundFallbackBody(
  u: V3SmsBrainResult,
  effectiveAsk: string,
  ctx?: Pick<ProduceV3InboundCoachDraftArgs, "userMessage" | "northStarPacket">
): string {
  if (!ctx) return fallbackInboundReply(u, effectiveAsk);
  return fallbackInboundReply(u, effectiveAsk, {
    inboundRaw: ctx.userMessage,
    northStarPacket: ctx.northStarPacket,
  });
}

function buildSyntheticEmergencyV3Brain(args: ProduceV3InboundCoachDraftArgs): V3SmsBrainResult {
  const inbound = args.userMessage.trim();
  const learning = deriveV3LearningSignalsFromContext({
    recentEventsNewestFirst: args.recentEvents,
    coachingMemory: args.coachingMemory,
    latestInbound: inbound,
  });
  const finalFt = args.gatedDecision.final_event_type ?? args.deterministicEventType;
  let purpose = mapOutcomeToPurpose(finalFt);
  const hint = heuristicPurposeFromInbound(inbound);
  if (hint && purpose === "unclear_but_contextual") {
    purpose = hint;
  }
  return {
    turnPurpose: purpose,
    confidence: "low",
    accountabilityEventCandidate: args.gatedDecision.should_write_outcome_event ? finalFt : null,
    shouldWriteOutcomeEvent: args.gatedDecision.should_write_outcome_event,
    learningSignal: learning,
    commitmentChangeIntent: "none",
    nextCoachingMove: pickNextMove(purpose, learning),
    coachReplyDraft: "",
    metadata: {
      v3_brain_version: V3_BRAIN_VERSION,
      emergency_deterministic_fallback: true,
    },
  };
}

/**
 * When {@link produceV3InboundCoachDraft} throws, recover via understand → generate (conversation brain text may be priorDraftHint only).
 * Final SMS is always V3-shaped deterministic fallback at minimum — never raw conversation-brain visible copy.
 */
/**
 * Synchronous last resort for normal-coaching inbound: always returns V3-shaped deterministic text.
 * Use when async paths were skipped or failed unexpectedly — never exposes legacy template voice.
 */
export function guaranteeV3InboundCoachDraft(args: ProduceV3InboundCoachDraftArgs): {
  draft: string;
  brain: V3SmsBrainResult;
  openAiOk: boolean;
} {
  const brain = buildSyntheticEmergencyV3Brain(args);
  return {
    draft: v3DeterministicInboundFallbackBody(brain, args.effectiveAsk, args),
    brain,
    openAiOk: false,
  };
}

export async function recoverV3InboundCoachDraftFromArgs(
  args: ProduceV3InboundCoachDraftArgs
): Promise<{ draft: string; brain: V3SmsBrainResult; openAiOk: boolean }> {
  try {
    return await produceV3InboundCoachDraft(args);
  } catch (e) {
    console.warn("[v3-sms-brain] recover_produce_failed", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
  try {
    const understanding = await understandV3SmsTurn({
      inboundRaw: args.userMessage,
      timezone: args.timezone,
      commitment: args.commitment,
      effectiveAsk: args.effectiveAsk,
      northStarPacket: args.northStarPacket,
      recentTranscriptLines: args.convPackRecentLines,
      expectedReplySemantics: args.expectedReplySemantics,
      latestOpenQuestion: args.latestOpenQuestion,
      todayCompleted: args.todayCompleted,
      coachingMemory: args.coachingMemory,
      recentEvents: args.recentEvents,
      gatedDecision: args.gatedDecision,
      deterministicEventType: args.deterministicEventType,
    });
    const gen = await generateV3CoachReply({
      understanding,
      inboundRaw: args.userMessage,
      messageSid: args.messageSid,
      effectiveAsk: args.effectiveAsk,
      behaviorStatement: args.commitment.behavior_statement ?? "",
      northStarPacket: args.northStarPacket,
      coachingMemory: args.coachingMemory,
      priorDraftHint: args.priorDraftHint ?? null,
    });
    return {
      draft: gen.text,
      brain: mergeBrainWithCoachGenerateMeta(understanding, gen),
      openAiOk: gen.openAiOk,
    };
  } catch (e2) {
    console.warn("[v3-sms-brain] recover_understand_generate_failed", {
      message: e2 instanceof Error ? e2.message : String(e2),
    });
    const brain = buildSyntheticEmergencyV3Brain(args);
    return {
      draft: v3DeterministicInboundFallbackBody(brain, args.effectiveAsk, args),
      brain,
      openAiOk: false,
    };
  }
}

/**
 * Full {@link V3SmsBrainResult} for deterministic open-question answers (still architecturally V3-owned).
 */
export function buildAnswerToOpenQuestionV3BrainPackage(args: {
  resolution: V3AnswerToOpenQuestionResult;
  learning: V3LearningSignals;
  latestOpenQuestion: string | null;
  expectedSemantics: string | null;
}): V3SmsBrainResult {
  const fp =
    args.resolution.subkind === "future_plan_story_title"
      ? { kind: "story_title" as const, value: args.resolution.extractedAnswer ?? null }
      : args.resolution.subkind === "time_or_schedule"
        ? { kind: "time_block" as const, value: args.resolution.extractedAnswer ?? null }
        : null;

  return {
    turnPurpose: "answer_to_open_question",
    confidence: "high",
    openQuestionResolution: args.resolution,
    answeredOpenQuestion: true,
    accountabilityEventCandidate: null,
    shouldWriteOutcomeEvent: false,
    learningSignal: args.learning,
    nextCoachingMove: "confirm_future_plan",
    nextOpenQuestion: null,
    coachReplyDraft: "",
    futurePlan: fp,
    proofSignal: /\b(proof|focused|locked)\b/i.test(args.resolution.extractedAnswer ?? ""),
    proofSummary: args.resolution.extractedAnswer?.slice(0, 120) ?? null,
    metadata: {
      v3_brain_version: V3_BRAIN_VERSION,
      open_subkind: args.resolution.subkind,
      v3_extracted_answer: args.resolution.extractedAnswer ?? null,
      identity_signal: /\b(i am|i'?m becoming|this is who)\b/i.test(args.resolution.extractedAnswer ?? ""),
      comeback: /\b(back at it|try again|starting again)\b/i.test(args.resolution.extractedAnswer ?? ""),
    },
  };
}

export function buildV3BrainMetadata(args: {
  brain: V3SmsBrainResult;
  latestOpenQuestion: string | null;
  expectedSemantics: string | null;
  coachReplySource: string;
  /** Merged North Star gate + telemetry (structural / repeat-kill). */
  northStarGate?: Record<string, unknown> | null;
  priorDraftSource?: string | null;
}): Record<string, unknown> {
  const extracted =
    args.brain.openQuestionResolution &&
    typeof args.brain.openQuestionResolution.extractedAnswer === "string"
      ? args.brain.openQuestionResolution.extractedAnswer
      : null;

  return {
    v3_brain_version: V3_BRAIN_VERSION,
    v3_turn_purpose: args.brain.turnPurpose,
    v3_confidence: args.brain.confidence,
    v3_next_coaching_move: args.brain.nextCoachingMove ?? null,
    v3_accountability_event_candidate: args.brain.accountabilityEventCandidate ?? null,
    v3_should_write_outcome_event: args.brain.shouldWriteOutcomeEvent ?? null,
    v3_answered_open_question: args.brain.answeredOpenQuestion ?? false,
    v3_latest_open_question: args.latestOpenQuestion,
    v3_expected_reply_semantics: args.expectedSemantics,
    v3_learning_signals: args.brain.learningSignal ?? null,
    v3_memory_used: true,
    v3_coach_reply_source: args.coachReplySource,
    v3_extracted_answer: extracted,
    prior_draft_source: args.priorDraftSource ?? null,
    proof_signal: args.brain.proofSignal ?? null,
    proof_summary: args.brain.proofSummary ?? null,
    blocker_pattern: args.brain.learningSignal?.blockerPattern ?? null,
    working_condition: args.brain.learningSignal?.workingCondition ?? null,
    failed_strategy: args.brain.learningSignal?.failedStrategy ?? null,
    current_experiment: args.brain.learningSignal?.currentExperiment ?? null,
    upstream_cause: args.brain.learningSignal?.upstreamCause ?? null,
    do_not_repeat_coaching_move: args.brain.learningSignal?.doNotRepeat ?? null,
    future_plan: args.brain.futurePlan ?? null,
    identity_signal: Boolean(args.brain.metadata?.identity_signal),
    comeback_candidate: Boolean(args.brain.metadata?.comeback),
    wise_adjustment_candidate: Boolean(args.brain.metadata?.wise_adjustment),
    victory_candidate: args.brain.proofSignal === true,
    north_star_gate: args.northStarGate ?? null,
    open_question_reply_source:
      (args.brain.metadata?.open_question_reply_source as string | undefined) ?? null,
    deterministic_fallback_used: args.brain.metadata?.deterministic_fallback_used ?? null,
    deterministic_fallback_reason:
      (args.brain.metadata?.deterministic_fallback_reason as string | undefined) ?? null,
  };
}
