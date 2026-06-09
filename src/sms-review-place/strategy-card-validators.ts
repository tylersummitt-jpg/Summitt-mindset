/**
 * SMS Review Place — Strategy Card v1 invariant validators (inbound normal).
 * Inspects lane metadata and optionally rebuilds the card from facts (read-only).
 */

import {
  buildInboundNormalStrategyCardV1,
  buildStrategyCardContextFromSnapshot,
  validateAndRepairInboundNormalStrategyCardV1,
  type StrategyCardMoveType,
  type StrategyCardV1,
} from "@/lib/coaching-strategy-card-v1";
import { buildRelationshipPacketForOpenAI } from "@/lib/sms-relationship-packet-v1";
import type { InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";
import type {
  SmsReviewLane,
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

function readAllowedClaims(metadata: Record<string, unknown>): Record<string, boolean> | null {
  const raw = metadata.strategy_card_allowed_claims;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, boolean>;
}

function rebuildCardFromFacts(facts: InboundV3RelationshipFacts): StrategyCardV1 | null {
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

function resolveCard(input: StrategyCardValidatorInput): StrategyCardV1 | null {
  if (input.inboundFacts) {
    return rebuildCardFromFacts(input.inboundFacts);
  }
  return null;
}

export function assertStrategyCardMoveType(
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

export function assertStrategyCardForbiddenMoves(
  moveType: string | null | undefined,
  forbidden?: StrategyCardMoveType[]
): string[] {
  if (!forbidden?.length || !moveType) return [];
  if (forbidden.includes(moveType as StrategyCardMoveType)) {
    return [`strategy_card_forbidden_move_${moveType}`];
  }
  return [];
}

export function assertStrategyCardAllowedClaims(
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

export function assertStrategyCardMustDoIncludes(
  mustDo: string[] | undefined,
  patterns?: RegExp[]
): string[] {
  return listIncludesPattern(mustDo, patterns);
}

export function assertStrategyCardMustNotDoIncludes(
  mustNotDo: string[] | undefined,
  patterns?: RegExp[]
): string[] {
  return listIncludesPattern(mustNotDo, patterns);
}

export function assertStrategyCardAvoidRepeating(
  avoidRepeating: string[] | undefined,
  patterns?: RegExp[]
): string[] {
  return listIncludesPattern(avoidRepeating, patterns);
}

export function assertNoStrategyCardSmsBodyLeak(laneBody: string, finalBody: string): string[] {
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

export function assertFinalGuardStillRan(input: {
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

export function evaluateStrategyCardExpectations(
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

  violations.push(...assertStrategyCardMoveType(moveType, exp.allowedMoveTypes));
  violations.push(
    ...assertStrategyCardForbiddenMoves(
      moveType,
      exp.forbiddenMoveTypes as StrategyCardMoveType[] | undefined
    )
  );

  const metadataClaims = readAllowedClaims(input.laneMetadata);
  violations.push(...assertStrategyCardAllowedClaims(metadataClaims, exp.allowedClaims));

  const card = resolveCard(input);
  if (card) {
    violations.push(...assertStrategyCardMustDoIncludes(card.must_do, exp.mustDoIncludes));
    violations.push(...assertStrategyCardMustNotDoIncludes(card.must_not_do, exp.mustNotDoIncludes));
    violations.push(
      ...assertStrategyCardAvoidRepeating(card.writer_constraints.avoid_repeating, exp.avoidRepeatingIncludes)
    );
  } else if (
    exp.mustDoIncludes?.length ||
    exp.mustNotDoIncludes?.length ||
    exp.avoidRepeatingIncludes?.length
  ) {
    violations.push("strategy_card_rebuild_failed_for_list_assertions");
  }

  violations.push(...assertNoStrategyCardSmsBodyLeak(input.laneBody, input.finalBody));

  if (exp.expectFinalGuardRan !== false) {
    violations.push(
      ...assertFinalGuardStillRan({
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
