/**
 * Wave 14.1 — Central SMS turn brain + Wave 14.2 control guardrails (narrow no-score pivots).
 * Classifies inbound turns; CONTROL may pivot human/meta replies without spine writes when confident.
 */

import OpenAI from "openai";

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { V2InboundGatedDecision, V2InboundShadowInterpretationResult } from "@/lib/v2-ai-inbound";
import { V2_INBOUND_AI_MODEL } from "@/lib/v2-ai-inbound";

export const CENTRAL_SMS_BRAIN_PROMPT_VERSION = "v14_1_central_sms_brain_shadow_v1";

/** Shadow flag: explicit true prod ON; unset OFF in production, ON in development. */
export function isV2CentralSmsBrainShadowEnabled(): boolean {
  const v = process.env.V2_CENTRAL_SMS_BRAIN_SHADOW_ENABLED?.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return process.env.NODE_ENV !== "production";
}

/** Control guardrails: explicit true/1 ON; unset or false ⇒ OFF (safe rollback). */
export function isV2CentralSmsBrainControlEnabled(): boolean {
  const v = process.env.V2_CENTRAL_SMS_BRAIN_CONTROL_ENABLED?.trim().toLowerCase();
  return v === "true" || v === "1";
}

export function shouldRunV2CentralSmsBrainInterpret(): boolean {
  return isV2CentralSmsBrainControlEnabled() || isV2CentralSmsBrainShadowEnabled();
}

const TURNS = [
  "accountability_answer",
  "human_conversation",
  "meta_question_or_confusion",
  "repair_or_correction",
  "commitment_change_request",
  "sms_pending_resolution_reply",
  "memory_confirmation_reply",
  "memory_update_candidate",
  "blocker_or_obstacle",
  "advice_or_coaching_request",
  "soft_opt_out_or_frustration",
  "unknown",
] as const;

export type CentralSmsTurnPurpose = (typeof TURNS)[number];

const BRANCHES = [
  "refresh",
  "sms_pending_resolution",
  "contract_overlay",
  "memory_confirmation",
  "blocker_capture",
  "normal_accountability",
  null,
] as const;

export type CentralSmsShouldUseExistingBranch = (typeof BRANCHES)[number];

export type CentralSmsTurnValidated = {
  version: 1;
  turn_purpose: CentralSmsTurnPurpose;
  confidence: number;
  should_write_accountability_event: boolean;
  proposed_event_type: "user_yes" | "user_no" | "user_partial" | null;
  should_answer_without_scoring: boolean;
  should_ask_clarification: boolean;
  should_record_memory_signal: boolean;
  should_offer_memory_confirmation: boolean;
  should_create_proof: boolean;
  should_start_or_continue_commitment_change: boolean;
  should_use_existing_branch: CentralSmsShouldUseExistingBranch;
  reply_guidance: string;
  safety_flags: string[];
  reasoning_short: string;
};

export type StoredCentralSmsTurnShadow = {
  prompt_version: string;
  central_turn_purpose: CentralSmsTurnPurpose;
  confidence: number;
  proposed_event_type: CentralSmsTurnValidated["proposed_event_type"];
  should_write_accountability_event: boolean;
  should_answer_without_scoring: boolean;
  should_ask_clarification: boolean;
  should_record_memory_signal: boolean;
  should_offer_memory_confirmation: boolean;
  should_create_proof: boolean;
  should_start_or_continue_commitment_change: boolean;
  should_use_existing_branch: NonNullable<CentralSmsShouldUseExistingBranch> | null;
  reply_guidance_preview: string;
  safety_flags: string[];
  reasoning_short: string;
  central_sms_brain_failed: boolean;
  model: string | null;
};

function clamp01(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function truncate(s: unknown, max: number): string {
  if (s == null || typeof s !== "string") return "";
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function parseTurnPurpose(v: unknown): CentralSmsTurnPurpose {
  const s = typeof v === "string" ? v.trim() : "";
  if (TURNS.includes(s as CentralSmsTurnPurpose)) return s as CentralSmsTurnPurpose;
  return "unknown";
}

function parseProposedEvent(v: unknown): CentralSmsTurnValidated["proposed_event_type"] {
  if (v === "user_yes" || v === "user_no" || v === "user_partial") return v;
  return null;
}

function parseSafetyFlags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v.slice(0, 24)) {
    if (typeof x === "string" && x.trim()) out.push(truncate(x, 96));
    if (out.length >= 20) break;
  }
  return out;
}

function parseExistingBranch(v: unknown): CentralSmsTurnValidated["should_use_existing_branch"] {
  if (v === null) return null;
  if (typeof v !== "string") return null;
  const x = v.trim();
  const allowed = BRANCHES.filter(Boolean) as string[];
  if (allowed.includes(x)) return x as NonNullable<CentralSmsTurnValidated["should_use_existing_branch"]>;
  return null;
}

function parseValidatedTurn(json: Record<string, unknown>): CentralSmsTurnValidated | null {
  if (json.version !== 1) return null;

  const reasoning_first = truncate(json.reasoning_short, 200).trim();
  if (!reasoning_first) return null;

  const turn_purpose = parseTurnPurpose(json.turn_purpose);
  const confidence = clamp01(json.confidence);

  const proposed_event_type = parseProposedEvent(json.proposed_event_type);
  const should_use_existing_branch = parseExistingBranch(json.should_use_existing_branch);

  return {
    version: 1,
    turn_purpose,
    confidence,
    should_write_accountability_event: json.should_write_accountability_event === true,
    proposed_event_type,
    should_answer_without_scoring: json.should_answer_without_scoring === true,
    should_ask_clarification: json.should_ask_clarification === true,
    should_record_memory_signal: json.should_record_memory_signal === true,
    should_offer_memory_confirmation: json.should_offer_memory_confirmation === true,
    should_create_proof: json.should_create_proof === true,
    should_start_or_continue_commitment_change: json.should_start_or_continue_commitment_change === true,
    should_use_existing_branch,
    reply_guidance: truncate(json.reply_guidance, 420),
    safety_flags: parseSafetyFlags(json.safety_flags),
    reasoning_short: reasoning_first,
  };
}

function shadowBrief(shadowRaw: V2InboundShadowInterpretationResult | null): Record<string, unknown> | null {
  if (!shadowRaw || shadowRaw.ok !== true) return null;
  const d = shadowRaw.data;
  return {
    intent: d.intent,
    proposed_outcome: d.proposed_outcome,
    confidence: d.confidence,
    needs_clarification: d.needs_clarification,
    is_repair: d.is_repair,
    suggests_commitment_change: d.suggests_commitment_change,
    blocker_likely: d.blocker_likely,
    opt_out_like_but_not_stop: d.opt_out_like_but_not_stop,
    discouraged_or_frustrated: d.discouraged_or_frustrated,
    substitution_counts: d.substitution_counts,
    user_asks_question: d.user_asks_question,
  };
}

export type InterpretCentralSmsBrainArgs = {
  clerkUserId: string;
  commitmentId: string;
  commitment: ActiveV2CommitmentRow;
  effectiveAsk: string;
  inboundText: string;
  lastOutboundPromptPreview: string | null;
  recentSmsContextBlock: string | null;
  blockerCapturePending: boolean;
  refreshSessionActive: boolean;
  smsPendingResolutionActive: boolean;
  contractOverlayProposalActive: boolean;
  memoryConfirmationPending: boolean;
  activeCommitmentPresent: boolean;
  deterministicClassifierEventType: string;
  deterministicNormalizedHint: string | null;
  gatedSummary: Pick<
    V2InboundGatedDecision,
    "mode" | "final_event_type" | "should_write_outcome_event" | "reply_style"
  > | null;
  shadowInterpretationRaw: V2InboundShadowInterpretationResult | null;
  /** Caller’s routing hint for this cron turn (truthful; model may echo or disagree in shadow only). */
  routeContext: "normal_accountability" | "blocker_capture";
};

export function validatedTurnToStoredPayload(
  v: CentralSmsTurnValidated | null,
  opts: {
    central_sms_brain_failed: boolean;
    model: string | null;
  }
): StoredCentralSmsTurnShadow {
  const fallbackPurpose: CentralSmsTurnPurpose = "unknown";
  const r = v;
  return {
    prompt_version: CENTRAL_SMS_BRAIN_PROMPT_VERSION,
    central_turn_purpose: r?.turn_purpose ?? fallbackPurpose,
    confidence: r?.confidence ?? 0,
    proposed_event_type: r?.proposed_event_type ?? null,
    should_write_accountability_event: r?.should_write_accountability_event ?? false,
    should_answer_without_scoring: r?.should_answer_without_scoring ?? false,
    should_ask_clarification: r?.should_ask_clarification ?? false,
    should_record_memory_signal: r?.should_record_memory_signal ?? false,
    should_offer_memory_confirmation: r?.should_offer_memory_confirmation ?? false,
    should_create_proof: r?.should_create_proof ?? false,
    should_start_or_continue_commitment_change: r?.should_start_or_continue_commitment_change ?? false,
    should_use_existing_branch:
      r?.should_use_existing_branch === null ? null : r?.should_use_existing_branch ?? null,
    reply_guidance_preview: truncate(r?.reply_guidance ?? "", 220),
    safety_flags: r?.safety_flags ?? [],
    reasoning_short: truncate(r?.reasoning_short ?? "", 200),
    central_sms_brain_failed: opts.central_sms_brain_failed,
    model: opts.model,
  };
}

function getOpenAIClientOrNull(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return null;
  return new OpenAI({ apiKey });
}

function buildCentralBrainUserPrompt(args: InterpretCentralSmsBrainArgs): string {
  const lines: string[] = [];
  lines.push("You are Shadow Classifier ONLY for SMS coaching inbound turns.");
  lines.push("");
  lines.push(
    "PRODUCT: SMS is the primary UX. Users text naturally. OpenAI will eventually handle conversational replies; TODAY you only classify—you must never mutate commitments or profiles. STOP/START/HELP are filtered before you run."
  );
  lines.push("");
  lines.push("RULES:");
  lines.push("- Do not score plain human/meta questions as accountability_answer.");
  lines.push(
    '- Normal questions that are not today’s yes/no/partial on the bar (e.g. "did you like to cook", "can you give examples", "are you able to talk about other things", victory log / proof / "does this count") → human_conversation, meta_question_or_confusion, or advice_or_coaching_request; set should_answer_without_scoring true when they need an answer before scoring.'
  );
  lines.push(
    "- User identity lines (e.g. leadership, motherhood) without a clear today outcome → often human_conversation or advice_or_coaching_request; still avoid inventing scored outcomes."
  );
  lines.push('- "How are you?", small talk → human_conversation.');
  lines.push(
    '- "Not sure what to say", "what do you mean", "confusing", "don\'t understand" → meta_question_or_confusion (not blocker_or_obstacle).'
  );
  lines.push(
    '- Clear YES/NO/partial ABOUT TODAY BAR → accountability_answer + proposed_event_type aligns (yes=user_yes mapped conceptually—not DB row).'
  );
  lines.push(
    '- User names obstacle/time/life interference after a miss framing → blocker_or_obstacle (only if substantive obstacle; meta confusion ≠ blocker).'
  );
  lines.push('- Ask smaller bar / replace goal / new goal → commitment_change_request.');
  lines.push('- Life/family/identity revelations → memory_update_candidate (no profile write implied).');
  lines.push('- User corrects misunderstanding → repair_or_correction.');
  lines.push('- Coaching/advice/help request (“what should I do”) → advice_or_coaching_request.');
  lines.push('- Frustrated / quit energy but not STOP → soft_opt_out_or_frustration.');
  lines.push("- should_create_proof MUST be conservative—only true if a grounded accountability success/miss/obstacle merits proof (server will still enforce).");
  lines.push("");
  lines.push(
    "OUTPUT ONLY JSON keys: version(1), turn_purpose(one of enumerated strings), confidence(0-1), should_write_accountability_event(boolean), proposed_event_type(user_yes|user_no|user_partial|null), should_answer_without_scoring(boolean), should_ask_clarification(boolean), should_record_memory_signal(boolean), should_offer_memory_confirmation(boolean), should_create_proof(boolean), should_start_or_continue_commitment_change(boolean), should_use_existing_branch(refresh|sms_pending_resolution|contract_overlay|memory_confirmation|blocker_capture|normal_accountability|null), reply_guidance(string short), safety_flags(string[] max 16), reasoning_short(max ~2 sentences)."
  );
  lines.push("");
  lines.push(`turn_purpose ENUM: ${TURNS.join(" | ")}`);
  lines.push("");
  lines.push(`CRON_ROUTE_CONTEXT_truthful_hint: ${args.routeContext}`);
  lines.push(`clerk_user_id: ${args.clerkUserId}`);
  lines.push(`commitment_id: ${args.commitmentId}`);
  lines.push("");
  lines.push(`COMMITMENT_TITLE: ${truncate(args.commitment.title, 160)}`);
  lines.push(`BEHAVIOR_STATEMENT: ${truncate(args.commitment.behavior_statement, 280)}`);
  lines.push(`EFFECTIVE_COACHING_ASK: ${truncate(args.effectiveAsk, 280)}`);
  lines.push("");
  lines.push(`USER_INBOUND_TRUNCATED: ${truncate(args.inboundText, 400)}`);
  lines.push("");
  if (args.lastOutboundPromptPreview?.trim()) {
    lines.push(`LAST_OUTBOUND_PREVIEW: ${truncate(args.lastOutboundPromptPreview, 260)}`);
  }
  lines.push("");
  if (args.recentSmsContextBlock?.trim()) {
    lines.push("RECENT_SMS_CONTEXT_PACK:");
    lines.push(args.recentSmsContextBlock.trim().slice(0, 9500));
    lines.push("");
  }
  lines.push("STATE_FLAGS (truth from server — do not invent):");
  lines.push(JSON.stringify({
    active_commitment_present: args.activeCommitmentPresent,
    blocker_capture_pending: args.blockerCapturePending,
    refresh_session_active: args.refreshSessionActive,
    sms_pending_resolution_active: args.smsPendingResolutionActive,
    contract_overlay_proposal_active: args.contractOverlayProposalActive,
    memory_confirmation_pending: args.memoryConfirmationPending,
  }));
  lines.push("");
  lines.push("DETERMINISTIC_CLASSIFIER_HINT:");
  lines.push(JSON.stringify({
    event_type_hint: args.deterministicClassifierEventType,
    normalized_hint: args.deterministicNormalizedHint,
  }));
  lines.push("");
  if (args.gatedSummary) {
    lines.push("CURRENT_GATED_POLICY_SNAPSHOT_truthful_shadow_input_only:");
    lines.push(
      JSON.stringify({
        mode: args.gatedSummary.mode,
        final_event_type: args.gatedSummary.final_event_type,
        writes_outcome: args.gatedSummary.should_write_outcome_event,
        reply_style: args.gatedSummary.reply_style,
      })
    );
    lines.push("");
  }
  const sb = shadowBrief(args.shadowInterpretationRaw);
  if (sb) {
    lines.push("PRIOR_SHADOW_INTERPRETER_HINT (may disagree; classify independently):");
    lines.push(JSON.stringify(sb));
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Non-throwing shadow interpret. Returns stored payload shape suitable for payload_json.central_sms_turn_shadow.
 */
export async function interpretV2CentralSmsTurn(
  args: InterpretCentralSmsBrainArgs
): Promise<StoredCentralSmsTurnShadow | null> {
  if (!shouldRunV2CentralSmsBrainInterpret()) return null;

  const client = getOpenAIClientOrNull();
  if (!client) {
    const fallback = validatedTurnToStoredPayload(null, {
      central_sms_brain_failed: true,
      model: null,
    });
    fallback.reasoning_short = truncate("no_openai_key", 200);
    console.warn("[central-sms-brain] failed", { commitment_id: args.commitmentId, reason: "no_openai_key" });
    return fallback;
  }

  try {
    const completion = await client.chat.completions.create({
      model: V2_INBOUND_AI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You output ONLY compact JSON per user schema. Shadow classification for analytics—never mutate state.",
        },
        { role: "user", content: buildCentralBrainUserPrompt(args) },
      ],
      temperature: 0.25,
      max_tokens: 500,
    });

    const rawStr = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!rawStr) {
      const p = validatedTurnToStoredPayload(null, { central_sms_brain_failed: true, model: V2_INBOUND_AI_MODEL });
      p.reasoning_short = truncate("empty_model_output", 200);
      console.warn("[central-sms-brain] failed", {
        commitment_id: args.commitmentId,
        reason: "empty_model_output",
      });
      return p;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawStr) as Record<string, unknown>;
    } catch {
      const p = validatedTurnToStoredPayload(null, { central_sms_brain_failed: true, model: V2_INBOUND_AI_MODEL });
      p.reasoning_short = truncate("invalid_json", 200);
      console.warn("[central-sms-brain] failed", { commitment_id: args.commitmentId, reason: "invalid_json" });
      return p;
    }

    const validated = parseValidatedTurn(parsed);
    if (!validated) {
      const p = validatedTurnToStoredPayload(null, { central_sms_brain_failed: true, model: V2_INBOUND_AI_MODEL });
      p.reasoning_short = truncate("validation_failed", 200);
      console.warn("[central-sms-brain] failed", { commitment_id: args.commitmentId, reason: "validation_failed" });
      return p;
    }

    const stored = validatedTurnToStoredPayload(validated, {
      central_sms_brain_failed: false,
      model: V2_INBOUND_AI_MODEL,
    });
    console.log("[central-sms-brain] success", {
      commitment_id: args.commitmentId,
      turn_purpose: stored.central_turn_purpose,
      confidence: stored.confidence,
      route: args.routeContext,
    });
    return stored;
  } catch (e) {
    const p = validatedTurnToStoredPayload(null, { central_sms_brain_failed: true, model: V2_INBOUND_AI_MODEL });
    p.reasoning_short = truncate(`openai_error:${e instanceof Error ? e.message : String(e)}`.slice(0, 200), 200);
    console.warn("[central-sms-brain] failed", {
      commitment_id: args.commitmentId,
      message: e instanceof Error ? e.message : String(e),
    });
    return p;
  }
}

/** Server-side audit fields for dashboards / QA when control pivots spine (stored on payloads when persisted). */
export type CentralSmsTurnControlStored = {
  enabled: true;
  control_action: "blocked_blocker_capture" | "blocked_outcome_scoring" | "human_reply_only" | "accountability_allowed";
  no_event_reason: string;
  reply_source: "central_brain_deterministic_v14_2";
  old_path_that_would_have_run?: string;
};

const BLOCK_BLOCKER_PURPOSES: ReadonlySet<CentralSmsTurnPurpose> = new Set([
  "human_conversation",
  "meta_question_or_confusion",
  "advice_or_coaching_request",
  "repair_or_correction",
]);

const BLOCK_OUTCOME_PURPOSES: ReadonlySet<CentralSmsTurnPurpose> = new Set([
  "human_conversation",
  "meta_question_or_confusion",
  "advice_or_coaching_request",
]);

/** Wave 14.2 — Pivot out of blocker_captured without mutating commitments. */
export function shouldCentralBrainBlockBlockerCapture(args: {
  stored: StoredCentralSmsTurnShadow | null;
  controlEnabled: boolean;
}): boolean {
  if (!args.controlEnabled || !args.stored) return false;
  if (args.stored.central_sms_brain_failed === true) return false;
  const tp = args.stored.central_turn_purpose;
  if (tp === "unknown") return false;
  if (!BLOCK_BLOCKER_PURPOSES.has(tp)) return false;
  return args.stored.confidence >= 0.75 || args.stored.should_answer_without_scoring === true;
}

/**
 * Wave 14.2 — Skip user_yes / user_no / user_partial persistence for confident human/meta/advice pivots only.
 * (repair_or_correction is intentionally excluded.)
 */
export function shouldCentralBrainBlockOutcomeScoring(args: {
  stored: StoredCentralSmsTurnShadow | null;
  controlEnabled: boolean;
}): boolean {
  if (!args.controlEnabled || !args.stored) return false;
  if (args.stored.central_sms_brain_failed === true) return false;
  const tp = args.stored.central_turn_purpose;
  if (tp === "unknown") return false;
  if (!BLOCK_OUTCOME_PURPOSES.has(tp)) return false;
  return args.stored.confidence >= 0.75 || args.stored.should_answer_without_scoring === true;
}

export type CentralBrainTetherRoute = "blocker_capture" | "normal_accountability";

function didEffectiveAskTetherQuestion(askSnippet: string): string {
  const cleaned = askSnippet.replace(/\s+/g, " ").trim().replace(/\?+$/g, "").trim();
  if (
    cleaned.length >= 10 &&
    cleaned.length <= 42 &&
    !/[\n{}<>[\]]/.test(cleaned) &&
    !/^https?:\/\//i.test(cleaned)
  ) {
    const low = cleaned.toLowerCase();
    if (
      !/^(did you|were you|have you|do you|can you|tell me)\b/i.test(low) &&
      !/\b(and if|because|however|;)\b/.test(low)
    ) {
      return `Did ${cleaned} happen today?`;
    }
  }
  return "Did today's commitment happen?";
}

/** Deterministic copy + tether; no STOP/proof/commands. */
export function buildCentralBrainHumanTetherReply(args: {
  turnPurpose: CentralSmsTurnPurpose;
  inboundText: string;
  effectiveAskSnippet: string;
  lastOutboundPromptPreview?: string | null;
  route: CentralBrainTetherRoute;
}): string {
  const lower = typeof args.inboundText === "string" ? args.inboundText.trim().toLowerCase() : "";
  const askQ = didEffectiveAskTetherQuestion(args.effectiveAskSnippet);
  void args.lastOutboundPromptPreview;

  if (args.turnPurpose === "meta_question_or_confusion") {
    if (/\bwhat do you mean\b/.test(lower)) {
      return "I mean the daily bar we're tracking. Did you do it today?";
    }
    return `Fair. That was confusing. Keep it simple: ${askQ}`;
  }

  if (args.turnPurpose === "human_conversation") {
    if (/\bhow (?:are|'re) you\b/.test(lower)) {
      return `I'm doing well, thanks. How are you? And while I've got you — ${askQ}`;
    }
    return `Glad you reached out—and while I've got you, ${askQ}`;
  }

  if (args.turnPurpose === "advice_or_coaching_request") {
    return "I can help with that. First, did today's bar happen?";
  }

  if (args.turnPurpose === "repair_or_correction" && args.route === "blocker_capture") {
    return `You're right to call that out. Let's reset: ${askQ}`;
  }

  return `Got it. Let's keep this simple: ${askQ}`;
}

export function maybeLogCentralBrainDisagreement(args: {
  commitmentId: string;
  stored: StoredCentralSmsTurnShadow | null | undefined;
  /** Actual spine event type written */
  spineEventType: string;
  shouldWriteOutcome?: boolean;
}): void {
  if (!args.stored || args.stored.central_sms_brain_failed) return;
  const tp = args.stored.central_turn_purpose;
  const metaLike =
    tp === "meta_question_or_confusion" || tp === "human_conversation" || tp === "advice_or_coaching_request";

  let disagree = false;
  if (metaLike && args.spineEventType === "blocker_captured") disagree = true;
  if (metaLike && args.spineEventType === "user_partial") disagree = true;
  if (
    args.stored.should_answer_without_scoring === true &&
    args.shouldWriteOutcome === true
  ) {
    disagree = true;
  }

  if (disagree) {
    console.warn("[central-sms-brain] disagreement", {
      commitment_id: args.commitmentId,
      central_turn_purpose: tp,
      spine_event_type: args.spineEventType,
      should_answer_without_scoring_shadow: args.stored.should_answer_without_scoring,
    });
  }
}
