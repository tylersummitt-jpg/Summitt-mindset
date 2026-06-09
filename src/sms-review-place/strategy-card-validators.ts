/**
 * SMS Review Place — Strategy Card v1 invariant validators (inbound normal + open_question_answer).
 * Review Place only — inspects lane metadata and/or rebuilds cards from facts (read-only).
 */

import type { StrategyCardMoveType, StrategyCardV1 } from "@/lib/coaching-strategy-card-v1";
import {
  OLD_COACH_PREVIEW_NON_SPEAKABLE_MUST_NOT_DO,
  buildInboundNormalStrategyCardV1,
  buildStrategyCardContextFromSnapshot,
  openQuestionOldCoachPreviewFingerprint,
  openQuestionOldCoachPreviewText,
  validateAndRepairInboundNormalStrategyCardV1,
} from "@/lib/coaching-strategy-card-v1";
import { buildRelationshipPacketForOpenAI } from "@/lib/sms-relationship-packet-v1";
import type { InboundV3OpenQuestionFacts, InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";
import type {
  SmsReviewLane,
  SmsReviewStrategyCardExpectations,
  SmsReviewStrategyCardFailure,
  StrategyCardExpectations,
} from "@/sms-review-place/types";

const INTERNAL_CARD_LEAK_PATTERNS = [
  /\bSTRATEGY_CARD_V1\b/,
  /"must_not_do"\s*:/,
  /"allowed_claims"\s*:/,
  /"writer_constraints"\s*:/,
  /"move"\s*:\s*\{\s*"type"/,
  /strategy_card_move_type/,
  /server_truth_summary/,
];

export type StrategyCardValidatorInput = {
  expectations: StrategyCardExpectations;
  laneMetadata: Record<string, unknown>;
  inboundFacts?: InboundV3RelationshipFacts | null;
  laneBody: string;
  finalBody: string;
  lane: SmsReviewLane;
  laneSkipped: boolean;
  northStarBody: string;
  finalShouldSend: boolean;
  finalSkipReason: string | null;
  blockedReasons: string[];
};

export type StrategyCardValidationOutcome = {
  pass: boolean;
  violations: string[];
  move_type: string | null;
  validation_status: string | null;
  card: StrategyCardV1 | null;
};

export type StrategyCardValidatorFailure = SmsReviewStrategyCardFailure;

function readAllowedClaims(metadata: Record<string, unknown>): Record<string, boolean> | null {
  const raw = metadata.strategy_card_allowed_claims;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, boolean>;
}

function rebuildInboundNormalCardFromFacts(facts: InboundV3RelationshipFacts): StrategyCardV1 | null {
  try {
    const packet = buildRelationshipPacketForOpenAI({
      lane: "inbound",
      sourceFacts: facts,
      commitmentRow: null,
    });
    const ctx = buildStrategyCardContextFromSnapshot({
      facts,
      snapshot: packet.snapshotV2,
    });
    const draft = buildInboundNormalStrategyCardV1({ ctx });
    return validateAndRepairInboundNormalStrategyCardV1(draft, ctx).card;
  } catch {
    return null;
  }
}

function resolveInboundNormalCard(input: StrategyCardValidatorInput): StrategyCardV1 | null {
  if (input.inboundFacts) {
    return rebuildInboundNormalCardFromFacts(input.inboundFacts);
  }
  return null;
}

function includesPattern(items: string[], pattern: RegExp | string): boolean {
  if (typeof pattern === "string") {
    const needle = pattern.toLowerCase();
    return items.some((item) => item.toLowerCase().includes(needle));
  }
  return items.some((item) => pattern.test(item));
}

function listIncludesPattern(list: string[] | undefined, patterns: RegExp[] | undefined): string[] {
  if (!patterns?.length) return [];
  const violations: string[] = [];
  for (const re of patterns) {
    if (!(list ?? []).some((item) => re.test(item))) {
      violations.push(`strategy_card_list_missing_pattern_${re.source}`);
    }
  }
  return violations;
}

/** Inbound-normal — metadata move type assertions. */
export function assertStrategyCardMoveTypeFromMetadata(
  moveType: string | null | undefined,
  allowed?: string[]
): string[] {
  if (!allowed?.length) return [];
  if (!moveType) return ["strategy_card_move_type_missing"];
  if (!allowed.includes(moveType)) {
    return [`strategy_card_move_type_${moveType}_not_in_allowed`];
  }
  return [];
}

/** Open-question — card move type assertions. */
export function assertStrategyCardMoveType(
  card: StrategyCardV1,
  moveType: StrategyCardMoveType | StrategyCardMoveType[]
): StrategyCardValidatorFailure | null {
  const allowed = Array.isArray(moveType) ? moveType : [moveType];
  return allowed.includes(card.move.type) ? null : "strategy_card_move_mismatch";
}

export function assertStrategyCardRouteKind(
  card: StrategyCardV1,
  routeKind: StrategyCardV1["route_kind"]
): StrategyCardValidatorFailure | null {
  return card.route_kind === routeKind ? null : "strategy_card_route_kind_mismatch";
}

export function assertStrategyCardForbiddenMovesFromMetadata(
  moveType: string | null | undefined,
  forbidden?: StrategyCardMoveType[]
): string[] {
  if (!forbidden?.length || !moveType) return [];
  if (forbidden.includes(moveType as StrategyCardMoveType)) {
    return [`strategy_card_forbidden_move_${moveType}`];
  }
  return [];
}

export function assertStrategyCardForbiddenMoves(
  card: StrategyCardV1,
  forbidden: StrategyCardMoveType[]
): StrategyCardValidatorFailure | null {
  return forbidden.includes(card.move.type) ? "strategy_card_forbidden_move" : null;
}

export function assertStrategyCardAllowedClaimsFromMetadata(
  claims: Record<string, boolean> | null,
  expected?: Partial<Record<string, boolean>>
): string[] {
  if (!expected) return [];
  const violations: string[] = [];
  for (const [key, want] of Object.entries(expected)) {
    if (want === undefined) continue;
    const actual = claims?.[key];
    if (actual !== want) {
      violations.push(`strategy_card_allowed_claims_${key}_expected_${want}_got_${actual}`);
    }
  }
  return violations;
}

export function assertStrategyCardAllowedClaims(
  card: StrategyCardV1,
  claimsFalse: Array<keyof StrategyCardV1["allowed_claims"]>
): StrategyCardValidatorFailure | null {
  for (const key of claimsFalse) {
    if (card.allowed_claims[key] === true) {
      return "strategy_card_allowed_claims_not_false";
    }
  }
  return null;
}

export function assertStrategyCardListMustDoIncludes(
  mustDo: string[] | undefined,
  patterns?: RegExp[]
): string[] {
  return listIncludesPattern(mustDo, patterns);
}

export function assertStrategyCardMustDoIncludes(
  card: StrategyCardV1,
  patterns: Array<RegExp | string>
): StrategyCardValidatorFailure | null {
  for (const pattern of patterns) {
    if (!includesPattern(card.must_do, pattern)) {
      return "strategy_card_must_do_missing";
    }
  }
  return null;
}

export function assertStrategyCardListMustNotDoIncludes(
  mustNotDo: string[] | undefined,
  patterns?: RegExp[]
): string[] {
  return listIncludesPattern(mustNotDo, patterns);
}

export function assertStrategyCardMustNotDoIncludes(
  card: StrategyCardV1,
  patterns: Array<RegExp | string>
): StrategyCardValidatorFailure | null {
  for (const pattern of patterns) {
    if (!includesPattern(card.must_not_do, pattern)) {
      return "strategy_card_must_not_do_missing";
    }
  }
  return null;
}

export function assertStrategyCardListAvoidRepeating(
  avoidRepeating: string[] | undefined,
  patterns?: RegExp[]
): string[] {
  return listIncludesPattern(avoidRepeating, patterns);
}

export function assertStrategyCardAvoidRepeating(
  card: StrategyCardV1,
  patterns: Array<RegExp | string>
): StrategyCardValidatorFailure | null {
  for (const pattern of patterns) {
    if (!includesPattern(card.writer_constraints.avoid_repeating, pattern)) {
      return "strategy_card_avoid_repeating_missing";
    }
  }
  return null;
}

export function assertNoStrategyCardSmsBodyLeakFromBodies(laneBody: string, finalBody: string): string[] {
  const violations: string[] = [];
  for (const text of [laneBody, finalBody]) {
    if (!text.trim()) continue;
    for (const re of INTERNAL_CARD_LEAK_PATTERNS) {
      if (re.test(text)) {
        violations.push(`strategy_card_internal_leak_${re.source}`);
        break;
      }
    }
  }
  return violations;
}

export function assertNoStrategyCardSmsBodyLeak(args: {
  card: StrategyCardV1;
  finalBody: string;
}): StrategyCardValidatorFailure | null {
  const cardJson = JSON.stringify(args.card);
  if (args.finalBody.includes(cardJson.slice(0, 80))) {
    return "strategy_card_sms_body_leak";
  }
  if (args.finalBody.includes("STRATEGY_CARD_V1")) {
    return "strategy_card_sms_body_leak";
  }
  if (args.finalBody.includes('"must_not_do"') || args.finalBody.includes('"allowed_claims"')) {
    return "strategy_card_sms_body_leak";
  }
  return null;
}

export function assertInboundPipelineFinalGuardStillRan(input: {
  lane: SmsReviewLane;
  laneSkipped: boolean;
  northStarBody: string;
  laneBody: string;
  finalBody: string;
  finalShouldSend: boolean;
  blockedReasons: unknown;
}): string[] {
  if (input.laneSkipped || input.lane === "classifier") return [];
  const violations: string[] = [];
  const pipelineBody = input.northStarBody.trim() || input.laneBody.trim() || input.finalBody.trim();
  if (input.finalShouldSend && !pipelineBody) {
    violations.push("north_star_finalizer_missing_body");
  }
  if (!Array.isArray(input.blockedReasons)) {
    violations.push("final_voice_gate_blocked_reasons_missing");
  }
  return violations;
}

export function assertFinalGuardStillRan(args: {
  finalShouldSend: boolean;
  finalBody: string;
  laneShouldSend: boolean;
}): StrategyCardValidatorFailure | null {
  if (!args.laneShouldSend) return "strategy_card_final_guard_not_ran";
  if (!args.finalShouldSend) return "strategy_card_final_guard_not_ran";
  if (args.finalBody.trim().length <= 10) return "strategy_card_final_guard_not_ran";
  return null;
}

export function assertStrategyCardDoesNotSpeakOldPreview(args: {
  card: StrategyCardV1;
  openQuestionFacts?: InboundV3OpenQuestionFacts | null;
  finalBody?: string;
}): StrategyCardValidatorFailure | null {
  const preview = openQuestionOldCoachPreviewText(args.openQuestionFacts);
  if (!preview) return null;

  const speakableParts = [
    ...args.card.must_do,
    ...args.card.must_not_do,
    args.card.move.reason,
    args.card.turn_kind,
  ];
  if (speakableParts.some((part) => part.includes(preview))) {
    return "strategy_card_old_preview_speakable";
  }

  const hasConstraint =
    args.card.must_not_do.some((m) =>
      /prior internal coach draft preview|internal coach draft preview/i.test(m)
    ) || args.card.must_not_do.includes(OLD_COACH_PREVIEW_NON_SPEAKABLE_MUST_NOT_DO);

  const previewFp = openQuestionOldCoachPreviewFingerprint(args.openQuestionFacts);
  const hasFingerprint =
    previewFp != null &&
    args.card.writer_constraints.avoid_repeating.some(
      (a) => a.toLowerCase() === previewFp.toLowerCase()
    );

  if (!hasConstraint && !hasFingerprint) {
    return "strategy_card_old_preview_speakable";
  }

  if (args.finalBody && args.finalBody.includes(preview)) {
    return "strategy_card_old_preview_speakable";
  }

  return null;
}

export function assertNoDuplicateStrategyAuthority(
  userPromptAppendix: string
): StrategyCardValidatorFailure | null {
  const matches = userPromptAppendix.match(/STRATEGY_CARD_V1/g);
  if (matches && matches.length > 1) {
    return "strategy_card_duplicate_strategy_authority";
  }
  return null;
}

/** Inbound-normal — metadata + optional card rebuild. */
export function evaluateInboundNormalStrategyCardExpectations(
  input: StrategyCardValidatorInput
): StrategyCardValidationOutcome {
  const exp = input.expectations;
  const moveType =
    typeof input.laneMetadata.strategy_card_move_type === "string"
      ? input.laneMetadata.strategy_card_move_type
      : null;
  const validationStatus =
    typeof input.laneMetadata.strategy_card_validation_status === "string"
      ? input.laneMetadata.strategy_card_validation_status
      : null;

  const violations: string[] = [];

  if (exp.expectCardPresent) {
    if (!moveType) violations.push("strategy_card_not_present_in_lane_metadata");
    if (validationStatus !== "valid" && validationStatus !== "repaired") {
      violations.push("strategy_card_validation_status_missing_or_invalid");
    }
  } else if (!exp.expectCardPresent && moveType) {
    violations.push("strategy_card_unexpected_in_lane_metadata");
  }

  violations.push(...assertStrategyCardMoveTypeFromMetadata(moveType, exp.allowedMoveTypes));
  violations.push(
    ...assertStrategyCardForbiddenMovesFromMetadata(
      moveType,
      exp.forbiddenMoveTypes as StrategyCardMoveType[] | undefined
    )
  );

  const metadataClaims = readAllowedClaims(input.laneMetadata);
  violations.push(...assertStrategyCardAllowedClaimsFromMetadata(metadataClaims, exp.allowedClaims));

  const card = resolveInboundNormalCard(input);
  if (card) {
    violations.push(...assertStrategyCardListMustDoIncludes(card.must_do, exp.mustDoIncludes));
    violations.push(...assertStrategyCardListMustNotDoIncludes(card.must_not_do, exp.mustNotDoIncludes));
    violations.push(
      ...assertStrategyCardListAvoidRepeating(
        card.writer_constraints.avoid_repeating,
        exp.avoidRepeatingIncludes
      )
    );
  } else if (
    exp.mustDoIncludes?.length ||
    exp.mustNotDoIncludes?.length ||
    exp.avoidRepeatingIncludes?.length
  ) {
    violations.push("strategy_card_rebuild_failed_for_list_assertions");
  }

  violations.push(...assertNoStrategyCardSmsBodyLeakFromBodies(input.laneBody, input.finalBody));

  if (exp.expectFinalGuardRan !== false) {
    violations.push(
      ...assertInboundPipelineFinalGuardStillRan({
        lane: input.lane,
        laneSkipped: input.laneSkipped,
        northStarBody: input.northStarBody,
        laneBody: input.laneBody,
        finalBody: input.finalBody,
        finalShouldSend: input.finalShouldSend,
        blockedReasons: input.blockedReasons,
      })
    );
  }

  const unique = [...new Set(violations)];
  return {
    pass: unique.length === 0,
    violations: unique,
    move_type: moveType,
    validation_status: validationStatus,
    card,
  };
}

/** Open-question — rebuilt card invariants. */
export function evaluateStrategyCardExpectations(args: {
  card: StrategyCardV1 | null;
  expectations: SmsReviewStrategyCardExpectations;
  finalBody: string;
  finalShouldSend: boolean;
  laneShouldSend: boolean;
  openQuestionFacts?: InboundV3OpenQuestionFacts | null;
  userPromptAppendix?: string;
}): StrategyCardValidatorFailure[] {
  const failures: StrategyCardValidatorFailure[] = [];
  const { expectations: exp, card } = args;

  if (!card) {
    failures.push("strategy_card_missing");
    return failures;
  }

  if (exp.routeKind) {
    const f = assertStrategyCardRouteKind(card, exp.routeKind);
    if (f) failures.push(f);
  }

  if (exp.moveType) {
    const f = assertStrategyCardMoveType(card, exp.moveType);
    if (f) failures.push(f);
  }

  if (exp.forbiddenMoves?.length) {
    const f = assertStrategyCardForbiddenMoves(card, exp.forbiddenMoves);
    if (f) failures.push(f);
  }

  if (exp.maxQuestions != null && card.writer_constraints.max_questions !== exp.maxQuestions) {
    failures.push("strategy_card_max_questions_mismatch");
  }

  if (exp.mustDoIncludes?.length) {
    const f = assertStrategyCardMustDoIncludes(card, exp.mustDoIncludes);
    if (f) failures.push(f);
  }

  if (exp.mustNotDoIncludes?.length) {
    const f = assertStrategyCardMustNotDoIncludes(card, exp.mustNotDoIncludes);
    if (f) failures.push(f);
  }

  if (exp.avoidRepeatingIncludes?.length) {
    const f = assertStrategyCardAvoidRepeating(card, exp.avoidRepeatingIncludes);
    if (f) failures.push(f);
  }

  if (exp.allowedClaimsFalse?.length) {
    const f = assertStrategyCardAllowedClaims(card, exp.allowedClaimsFalse);
    if (f) failures.push(f);
  }

  if (exp.assertFinalGuardRan !== false) {
    const f = assertFinalGuardStillRan({
      finalBody: args.finalBody,
      finalShouldSend: args.finalShouldSend,
      laneShouldSend: args.laneShouldSend,
    });
    if (f) failures.push(f);
  }

  const leak = assertNoStrategyCardSmsBodyLeak({ card, finalBody: args.finalBody });
  if (leak) failures.push(leak);

  if (exp.assertOldPreviewNonSpeakable) {
    const f = assertStrategyCardDoesNotSpeakOldPreview({
      card,
      openQuestionFacts: args.openQuestionFacts,
      finalBody: args.finalBody,
    });
    if (f) failures.push(f);
  }

  if (exp.assertSingleStrategyAuthority && args.userPromptAppendix) {
    const f = assertNoDuplicateStrategyAuthority(args.userPromptAppendix);
    if (f) failures.push(f);
  }

  return failures;
}
