/**
 * SMS Review Place — safe V3 lane orchestration (no Twilio, no DB, no cron).
 */

import { strategyCardV1UserPromptAppendix } from "@/lib/coaching-strategy-card-v1";
import { buildDailyOutboundNorthStarContextPacket } from "@/lib/north-star-sms-context-packet";
import type { NorthStarSmsContextPacket } from "@/lib/north-star-coach-sms";
import {
  finalizeNorthStarCoachSmsAsync,
  finalizeNorthStarInboundCoachReplyAsync,
} from "@/lib/north-star-coach-sms-openai";
import type { NorthStarCoachChannel } from "@/lib/north-star-coach-sms";
import { classifyInboundSmsSafetyTier, buildInboundSmsSafetyReplyBody } from "@/lib/sms-inbound-safety";
import { detectSmsRelationshipExitIntent } from "@/lib/sms-relationship-exit-intent";
import { produceDailyV3RelationshipSms } from "@/lib/v3-daily-relationship-lane";
import { produceInboundV3RelationshipSms } from "@/lib/v3-inbound-relationship-lane";
import type { InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";
import { applyFinalVoiceOwnershipGate } from "@/lib/v3-sms-voice-ownership";
import {
  buildDailyFacts,
  buildInboundFacts,
  simulatedDayKey,
  simulatedLocalIso,
} from "@/sms-review-place/build-facts";
import { peekMockLaneBody } from "@/sms-review-place/fixtures/openai-responses";
import { getPersona } from "@/sms-review-place/fixtures/personas";
import { resolveFinalSmsOutput } from "@/sms-review-place/sms-output";
import { rebuildInboundStrategyCardForReview } from "@/sms-review-place/strategy-card-review";
import {
  evaluateInboundNormalStrategyCardExpectations,
  evaluateStrategyCardExpectations,
} from "@/sms-review-place/strategy-card-validators";
import type {
  SmsReviewScenario,
  SmsReviewScenarioStep,
  SmsReviewRunRow,
  SmsReviewStrategyCardExpectations,
  StrategyCardExpectations,
} from "@/sms-review-place/types";
import {
  buildSoftReviewFields,
  evaluateHardFlags,
  scenarioPass,
  type ValidatorInput,
} from "@/sms-review-place/validators";

const TELEMETRY = ["sms_review_place"];

function dailyChannel(routeKind: string): NorthStarCoachChannel {
  if (routeKind === "pending_resolution") return "pending_resolution";
  if (routeKind === "refresh_identity" || routeKind === "refresh_commitment") return "refresh";
  if (routeKind === "low_pressure_reactivation") return "reactivation";
  if (routeKind === "contract_prompt") return "contract_prompt";
  return "daily_outbound";
}

function praiseFromLaneMeta(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const ctx = metadata.praise_policy_context;
  if (ctx && typeof ctx === "object" && !Array.isArray(ctx)) {
    return ctx as Record<string, unknown>;
  }
  return undefined;
}

function mockKeyForStep(scenario: SmsReviewScenario, step: SmsReviewScenarioStep): string {
  return step.mockKey ?? `${scenario.id}:${step.lane}`;
}

function supplementalBodiesForStep(scenario: SmsReviewScenario, step: SmsReviewScenarioStep): string[] {
  if (process.env.SMS_REVIEW_USE_MOCK_SUPPLEMENTAL === "0") return [];
  if (!scenario.expectHardFlags?.length) return [];
  const body = peekMockLaneBody(mockKeyForStep(scenario, step));
  return body ? [body] : [];
}

function isOpenQuestionStrategyCardExpectations(
  exp: StrategyCardExpectations | SmsReviewStrategyCardExpectations
): exp is SmsReviewStrategyCardExpectations {
  return "routeKind" in exp;
}

function baseRow(
  scenario: SmsReviewScenario,
  stepIndex: number,
  step: SmsReviewScenarioStep
): Pick<
  SmsReviewRunRow,
  | "scenario_id"
  | "persona_id"
  | "step_index"
  | "lane"
  | "simulated_local_iso"
  | "current_goal"
  | "thread_summary"
  | "memory_summary"
  | "expected_behavior"
  | "bug_category"
  | "expect_clean"
  | "expect_hard_flags"
  | "soft_review"
  | "human_notes"
  | "run_mode"
> {
  return {
    scenario_id: scenario.id,
    persona_id: scenario.personaId,
    step_index: stepIndex,
    lane: step.lane,
    simulated_local_iso: simulatedLocalIso(),
    current_goal: scenario.effectiveAsk,
    thread_summary: scenario.threadSummary,
    memory_summary: scenario.memorySummary,
    expected_behavior: scenario.expectedBehavior,
    bug_category: scenario.bugCategory,
    expect_clean: scenario.expectClean === true,
    expect_hard_flags: scenario.expectHardFlags ?? [],
    soft_review: buildSoftReviewFields(),
    human_notes: "",
    run_mode: "mock",
  };
}

function passForRow(
  scenario: SmsReviewScenario,
  hardFlags: SmsReviewRunRow["hard_flags"],
  row: Pick<
    SmsReviewRunRow,
    | "lane"
    | "lane_skipped_reason"
    | "final_should_send"
    | "final_body"
    | "final_body_raw"
    | "lane_should_send"
    | "expect_clean"
    | "expect_hard_flags"
    | "strategy_card_pass"
    | "strategy_card_failures"
  >
): boolean {
  if (row.strategy_card_pass === false) return false;
  if (row.strategy_card_failures.length > 0) return false;
  return scenarioPass(scenario, {
    hard_flags: hardFlags,
    lane: row.lane,
    lane_skipped_reason: row.lane_skipped_reason,
    final_should_send: row.final_should_send,
    final_body: row.final_body,
    final_body_raw: row.final_body_raw,
    lane_should_send: row.lane_should_send,
    expect_clean: row.expect_clean,
    expect_hard_flags: row.expect_hard_flags,
  });
}

function emptyStrategyCardFields(): Pick<
  SmsReviewRunRow,
  | "strategy_card_failures"
  | "strategy_card_move_type"
  | "strategy_card_route_kind"
  | "strategy_card_validation_status"
  | "strategy_card_violations"
  | "strategy_card_pass"
> {
  return {
    strategy_card_failures: [],
    strategy_card_move_type: null,
    strategy_card_route_kind: null,
    strategy_card_validation_status: null,
    strategy_card_violations: [],
    strategy_card_pass: null,
  };
}

function evaluateInboundStrategyCardFields(args: {
  scenario: SmsReviewScenario;
  facts: InboundV3RelationshipFacts;
  laneMetadata: Record<string, unknown>;
  laneBody: string;
  finalBody: string;
  northStarBody: string;
  finalShouldSend: boolean;
  finalSkipReason: string | null;
  laneShouldSend: boolean;
  blockedReasons: string[];
}): Pick<
  SmsReviewRunRow,
  | "strategy_card_failures"
  | "strategy_card_move_type"
  | "strategy_card_route_kind"
  | "strategy_card_validation_status"
  | "strategy_card_violations"
  | "strategy_card_pass"
> {
  if (!args.scenario.strategyCard) return emptyStrategyCardFields();

  if (isOpenQuestionStrategyCardExpectations(args.scenario.strategyCard)) {
    const card = rebuildInboundStrategyCardForReview(args.facts);
    const userPromptAppendix = card ? strategyCardV1UserPromptAppendix(card) : "";
    const failures = evaluateStrategyCardExpectations({
      card,
      expectations: args.scenario.strategyCard,
      finalBody: args.finalBody,
      finalShouldSend: args.finalShouldSend,
      laneShouldSend: args.laneShouldSend,
      openQuestionFacts: args.facts.open_question_facts,
      userPromptAppendix,
    });
    return {
      strategy_card_failures: failures,
      strategy_card_move_type: card?.move.type ?? null,
      strategy_card_route_kind: card?.route_kind ?? null,
      strategy_card_validation_status: null,
      strategy_card_violations: [],
      strategy_card_pass: failures.length === 0,
    };
  }

  const outcome = evaluateInboundNormalStrategyCardExpectations({
    expectations: args.scenario.strategyCard,
    laneMetadata: args.laneMetadata,
    inboundFacts: args.facts,
    laneBody: args.laneBody,
    finalBody: args.finalBody,
    lane: "inbound",
    laneSkipped: false,
    northStarBody: args.northStarBody,
    finalShouldSend: args.finalShouldSend,
    finalSkipReason: args.finalSkipReason,
    blockedReasons: args.blockedReasons,
  });
  const routeKind =
    typeof args.laneMetadata.strategy_card_route_kind === "string"
      ? args.laneMetadata.strategy_card_route_kind
      : null;
  return {
    strategy_card_failures: [],
    strategy_card_move_type: outcome.move_type,
    strategy_card_route_kind: routeKind,
    strategy_card_validation_status: outcome.validation_status,
    strategy_card_violations: outcome.violations,
    strategy_card_pass: outcome.pass,
  };
}

export async function runDailyPipeline(
  scenario: SmsReviewScenario,
  step: SmsReviewScenarioStep,
  stepIndex: number
): Promise<SmsReviewRunRow> {
  const facts = buildDailyFacts(scenario);
  const lane = await produceDailyV3RelationshipSms({
    facts,
    telemetry_fact_sources: TELEMETRY,
  });

  const channel = dailyChannel(facts.route_kind);
  const ns = await finalizeNorthStarCoachSmsAsync({
    proposedBody: lane.body,
    channel,
    behaviorStatement: facts.commitment.behavior_statement,
    effectiveAskText: facts.commitment.effective_ask,
    replySource: "v3_daily_relationship_lane",
    contextPacket: buildDailyOutboundNorthStarContextPacket({
      commitmentId: facts.commitment.id,
      effectiveAskText: facts.commitment.effective_ask,
      priorOutcome: facts.accountability.prior_outcome,
      blockerPreview: facts.accountability.blocker_preview,
    }),
    metadata: { sms_review_place: true, scenario_id: scenario.id },
  });

  const fvg = await applyFinalVoiceOwnershipGate({
    proposedBody: ns.visibleBody,
    replySource: "v3_daily_relationship_lane",
    channel,
    activeCommitmentId: facts.commitment.id,
    effectiveAsk: facts.commitment.effective_ask,
    behaviorStatement: facts.commitment.behavior_statement,
    contextPacket: buildDailyOutboundNorthStarContextPacket({
      commitmentId: facts.commitment.id,
      effectiveAskText: facts.commitment.effective_ask,
      priorOutcome: facts.accountability.prior_outcome,
      blockerPreview: facts.accountability.blocker_preview,
    }),
    northStarMeta: ns.meta,
    normalCoaching: true,
    bindingVerbatim: null,
    v3BrainMetadata: praiseFromLaneMeta(lane.metadata)
      ? { praise_policy_context: praiseFromLaneMeta(lane.metadata) }
      : undefined,
  });

  const resolved = resolveFinalSmsOutput({
    fvgShouldSend: fvg.shouldSend,
    fvgBody: fvg.body ?? "",
  });

  const validatorInput: ValidatorInput = {
    scenario,
    lane: "daily",
    laneBody: lane.body,
    laneShouldSend: lane.shouldSend,
    laneNoSendReason: lane.noSendReason,
    finalBody: resolved.final_body,
    finalBodyRaw: resolved.final_body_raw,
    finalShouldSend: resolved.final_should_send,
    finalSkipReason: fvg.skipReason ?? null,
    blockedReasons: fvg.blockedReasons,
    latestUserReply: null,
    dailyFacts: facts,
    temporalContract: facts.temporal_contract ?? null,
    laneSkipped: false,
    supplementalCoachBodies: supplementalBodiesForStep(scenario, step),
  };

  const hardFlags = evaluateHardFlags(validatorInput);

  const rowBase = {
    ...baseRow(scenario, stepIndex, step),
    accountability_day_key: simulatedDayKey(),
    latest_user_reply: null,
    relationship_packet_version:
      typeof lane.metadata.relationship_packet_version === "string"
        ? lane.metadata.relationship_packet_version
        : null,
    relationship_packet_truncated: lane.metadata.relationship_packet_truncated === true,
    lane_body: lane.body,
    lane_should_send: lane.shouldSend,
    lane_no_send_reason: lane.noSendReason,
    north_star_body: ns.visibleBody,
    final_body: resolved.final_body,
    final_body_raw: resolved.final_body_raw,
    final_should_send: resolved.final_should_send,
    final_skip_reason: fvg.skipReason ?? null,
    blocked_reasons: fvg.blockedReasons,
    hard_flags: hardFlags,
    lane_skipped_reason: null,
    classifier_results: null,
    ...emptyStrategyCardFields(),
  };

  return {
    ...rowBase,
    pass: passForRow(scenario, hardFlags, rowBase),
  };
}

export async function runInboundPipeline(
  scenario: SmsReviewScenario,
  step: SmsReviewScenarioStep,
  stepIndex: number
): Promise<SmsReviewRunRow> {
  const userReply = step.userReply ?? "done";
  const facts = buildInboundFacts(scenario, userReply);
  const lane = await produceInboundV3RelationshipSms({
    facts,
    telemetry_fact_sources: TELEMETRY,
  });

  const inboundContextPacket: NorthStarSmsContextPacket = {
    activeCommitmentId: facts.commitment.id,
    behaviorStatement: facts.commitment.behavior_statement,
    effectiveAskText: facts.commitment.effective_ask,
    latestInboundRaw: userReply,
    latestOutboundBody: facts.thread.latest_outbound_coach_sms,
    latestOpenQuestion: facts.thread.latest_open_question,
    expectedReplySemantics: facts.thread.expected_reply_semantics,
    todayCompleted: facts.v2_accountability.today_completed,
    finalEventType: facts.v2_accountability.deterministic_classifier_event,
    proofSignal: facts.v2_accountability.proof_signal,
    missSignal: facts.v2_accountability.miss_signal,
    blockerSignal: facts.v2_accountability.blocker_signal,
    source: "sms_review_place",
  };

  const ns = await finalizeNorthStarInboundCoachReplyAsync({
    proposedBody: lane.body,
    channel: "inbound_coach_reply",
    ctx: {
      userMessage: userReply,
      effectiveBehavior: facts.commitment.effective_ask,
      behaviorStatement: facts.commitment.behavior_statement,
      finalEventType: facts.v2_accountability.deterministic_classifier_event,
      replySource: "v3_inbound_relationship_lane",
      contextPacket: inboundContextPacket,
      lastOutboundSmsPreview: facts.thread.latest_outbound_coach_sms,
      alreadyCompletedToday: facts.v2_accountability.today_completed,
    },
  });

  const fvg = await applyFinalVoiceOwnershipGate({
    proposedBody: ns.visibleBody,
    replySource: "v3_inbound_relationship_lane",
    channel: "inbound_coach_reply",
    activeCommitmentId: facts.commitment.id,
    effectiveAsk: facts.commitment.effective_ask,
    behaviorStatement: facts.commitment.behavior_statement,
    latestInboundRaw: userReply,
    latestOutboundBody: facts.thread.latest_outbound_coach_sms,
    latestOpenQuestion: facts.thread.latest_open_question,
    contextPacket: inboundContextPacket,
    northStarMeta: ns.meta,
    normalCoaching: true,
    finalEventType: facts.v2_accountability.deterministic_classifier_event,
    todayCompleted: facts.v2_accountability.today_completed,
    v3BrainMetadata: praiseFromLaneMeta(lane.metadata)
      ? { praise_policy_context: praiseFromLaneMeta(lane.metadata) }
      : undefined,
  });

  const resolved = resolveFinalSmsOutput({
    fvgShouldSend: fvg.shouldSend,
    fvgBody: fvg.body ?? "",
  });

  const proofSavedAllowed =
    facts.v2_accountability.proof_callout_hint?.proof_callout_claim_saved_allowed === true;

  const validatorInput: ValidatorInput = {
    scenario,
    lane: "inbound",
    laneBody: lane.body,
    laneShouldSend: lane.shouldSend,
    laneNoSendReason: lane.noSendReason,
    finalBody: resolved.final_body,
    finalBodyRaw: resolved.final_body_raw,
    finalShouldSend: resolved.final_should_send,
    finalSkipReason: fvg.skipReason ?? null,
    blockedReasons: fvg.blockedReasons,
    latestUserReply: userReply,
    inboundFacts: facts,
    temporalContract: facts.temporal_contract ?? null,
    laneSkipped: false,
    supplementalCoachBodies: supplementalBodiesForStep(scenario, step),
    proofClaimSavedAllowed: proofSavedAllowed,
  };

  const hardFlags = evaluateHardFlags(validatorInput);

  const strategyCardFields = evaluateInboundStrategyCardFields({
    scenario,
    facts,
    laneMetadata: lane.metadata,
    laneBody: lane.body,
    finalBody: resolved.final_body,
    northStarBody: ns.visibleBody,
    finalShouldSend: resolved.final_should_send,
    finalSkipReason: fvg.skipReason ?? null,
    laneShouldSend: lane.shouldSend,
    blockedReasons: fvg.blockedReasons,
  });

  const rowBase = {
    ...baseRow(scenario, stepIndex, step),
    accountability_day_key: simulatedDayKey(),
    latest_user_reply: userReply,
    relationship_packet_version:
      typeof lane.metadata.relationship_packet_version === "string"
        ? lane.metadata.relationship_packet_version
        : null,
    relationship_packet_truncated: lane.metadata.relationship_packet_truncated === true,
    lane_body: lane.body,
    lane_should_send: lane.shouldSend,
    lane_no_send_reason: lane.noSendReason,
    north_star_body: ns.visibleBody,
    final_body: resolved.final_body,
    final_body_raw: resolved.final_body_raw,
    final_should_send: resolved.final_should_send,
    final_skip_reason: fvg.skipReason ?? null,
    blocked_reasons: fvg.blockedReasons,
    hard_flags: hardFlags,
    lane_skipped_reason: null,
    classifier_results: null,
    ...strategyCardFields,
  };

  return {
    ...rowBase,
    pass: passForRow(scenario, hardFlags, rowBase),
  };
}

const EXACT_STOP_RE = /^\s*(stop|unsubscribe|cancel|end)\s*$/i;
const EXACT_HELP_RE = /^\s*(help|info)\s*$/i;

export async function runClassifierPipeline(
  scenario: SmsReviewScenario,
  step: SmsReviewScenarioStep,
  stepIndex: number
): Promise<SmsReviewRunRow> {
  const text = step.userReply ?? "";
  const safety = classifyInboundSmsSafetyTier(text);
  const exit = detectSmsRelationshipExitIntent(text);
  const isExactStop = EXACT_STOP_RE.test(text.trim());
  const isExactHelp = EXACT_HELP_RE.test(text.trim());

  const classifierResults: Record<string, unknown> = {
    exact_stop: isExactStop,
    exact_help: isExactHelp,
    safety_tier: safety.tier,
    safety_should_skip_v3: safety.shouldSkipV3,
    safety_reply_variant: safety.replyVariant,
    safety_reply_preview: buildInboundSmsSafetyReplyBody(safety)?.slice(0, 120) ?? null,
    exit_detected: exit.detected,
    exit_category: exit.category,
    exit_confidence: exit.confidence,
  };

  const hardFlags = evaluateHardFlags({
    scenario,
    lane: "classifier",
    laneBody: "",
    laneShouldSend: false,
    laneNoSendReason: "classifier_only",
    finalBody: "",
    finalBodyRaw: null,
    finalShouldSend: false,
    finalSkipReason: "classifier_only",
    blockedReasons: [],
    latestUserReply: text,
    laneSkipped: true,
  });

  if (scenario.id === "crisis-safety-boundary" && safety.tier !== "crisis") {
    hardFlags.push("boundary_leak_into_coaching");
  }
  if (scenario.id === "stop-help-start-boundary" && !isExactStop) {
    hardFlags.push("boundary_leak_into_coaching");
  }
  if (scenario.id === "support-cancel-boundary" && !exit.detected) {
    hardFlags.push("boundary_leak_into_coaching");
  }

  const uniqueFlags = [...new Set(hardFlags)];

  const rowBase = {
    ...baseRow(scenario, stepIndex, step),
    accountability_day_key: null,
    latest_user_reply: text,
    relationship_packet_version: null,
    relationship_packet_truncated: null,
    lane_body: "",
    lane_should_send: false,
    lane_no_send_reason: "classifier_only",
    north_star_body: "",
    final_body: "",
    final_body_raw: null,
    final_should_send: false,
    final_skip_reason: "classifier_only",
    blocked_reasons: [] as string[],
    hard_flags: uniqueFlags,
    lane_skipped_reason: "classifier_only",
    classifier_results: classifierResults,
    ...emptyStrategyCardFields(),
  };

  return {
    ...rowBase,
    pass: passForRow(scenario, uniqueFlags, rowBase),
  };
}

export async function runScenarioStep(
  scenario: SmsReviewScenario,
  step: SmsReviewScenarioStep,
  stepIndex: number
): Promise<SmsReviewRunRow> {
  if (step.lane === "daily") return runDailyPipeline(scenario, step, stepIndex);
  if (step.lane === "inbound") return runInboundPipeline(scenario, step, stepIndex);
  if (step.lane === "weekly") {
    throw new Error("Weekly lane deferred in Sim-1");
  }
  return runClassifierPipeline(scenario, step, stepIndex);
}

export function getPersonaLabel(personaId: string): string {
  return getPersona(personaId).preferredName;
}
