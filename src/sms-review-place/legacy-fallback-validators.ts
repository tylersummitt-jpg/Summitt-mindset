/**
 * SMS Review Place — legacy fallback (conversation_brain_unavailable) validators.
 * Review Place only — proves no Strategy Card, template preview non-speakable, final guard ran.
 */

import { isStrategyCardEligible } from "@/lib/coaching-strategy-card-v1";
import type { InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";
import type {
  SmsReviewLegacyFallbackExpectations,
  SmsReviewLegacyFallbackFailure,
} from "@/sms-review-place/types";

const INTERNAL_LEGACY_LABEL_PATTERNS = [
  /\bconversation_brain_unavailable\b/i,
  /\bconversation_brain_legacy_disabled_lane\b/i,
  /\bROUTE\s*\(\s*conversation_brain_unavailable\s*\)/i,
  /\bdeterministic_template_preview\b/i,
  /\blegacy_fallback_reason\b/i,
  /\bSTRATEGY_CARD_V1\b/,
  /"must_not_do"\s*:/,
  /"allowed_claims"\s*:/,
  /strategy_card_route_kind/,
  /strategy_card_move_type/,
];

export type LegacyFallbackValidatorInput = {
  expectations: SmsReviewLegacyFallbackExpectations;
  facts: InboundV3RelationshipFacts;
  laneMetadata: Record<string, unknown>;
  laneBody: string;
  finalBody: string;
  finalShouldSend: boolean;
  laneShouldSend: boolean;
};

function bodyContainsInternalLabel(text: string): boolean {
  return INTERNAL_LEGACY_LABEL_PATTERNS.some((re) => re.test(text));
}

export function assertNoStrategyCardPresentForLegacyFallback(
  facts: InboundV3RelationshipFacts,
  laneMetadata: Record<string, unknown>,
  laneBody: string,
  finalBody: string
): SmsReviewLegacyFallbackFailure | null {
  if (isStrategyCardEligible(facts)) {
    return "legacy_fallback_strategy_card_present";
  }
  if (typeof laneMetadata.strategy_card_route_kind === "string") {
    return "legacy_fallback_strategy_card_present";
  }
  if (typeof laneMetadata.strategy_card_move_type === "string") {
    return "legacy_fallback_strategy_card_present";
  }
  if (laneBody.includes("STRATEGY_CARD_V1") || finalBody.includes("STRATEGY_CARD_V1")) {
    return "legacy_fallback_strategy_card_present";
  }
  return null;
}

export function assertNoLegacyFallbackTemplatePreviewSpoken(args: {
  facts: InboundV3RelationshipFacts;
  laneBody: string;
  finalBody: string;
}): SmsReviewLegacyFallbackFailure | null {
  const preview = args.facts.conversation_brain_fallback_facts?.deterministic_template_preview?.trim();
  if (!preview || preview.length < 8) return null;

  const bodies = [args.laneBody, args.finalBody];
  if (bodies.some((b) => b.includes(preview))) {
    return "legacy_fallback_template_preview_speakable";
  }

  const fingerprint = preview.slice(0, 48);
  if (fingerprint.length >= 12 && bodies.some((b) => b.includes(fingerprint))) {
    return "legacy_fallback_template_preview_speakable";
  }

  return null;
}

export function assertLegacyFallbackFinalGuardRan(args: {
  finalShouldSend: boolean;
  finalBody: string;
  laneShouldSend: boolean;
}): SmsReviewLegacyFallbackFailure | null {
  if (!args.laneShouldSend) return "legacy_fallback_final_guard_not_ran";
  if (!args.finalShouldSend) return "legacy_fallback_final_guard_not_ran";
  if (args.finalBody.trim().length <= 10) return "legacy_fallback_final_guard_not_ran";
  return null;
}

export function assertLegacyFallbackRoutePurpose(
  facts: InboundV3RelationshipFacts,
  expected: "conversation_brain_unavailable"
): SmsReviewLegacyFallbackFailure | null {
  if (facts.route_purpose !== expected) return "legacy_fallback_route_purpose_mismatch";
  if (facts.branch_name !== "conversation_brain_legacy_disabled_lane") {
    return "legacy_fallback_route_purpose_mismatch";
  }
  if (!facts.conversation_brain_fallback_facts) {
    return "legacy_fallback_route_purpose_mismatch";
  }
  return null;
}

export function assertTuSuppressesLegacyFallback(
  facts: InboundV3RelationshipFacts
): SmsReviewLegacyFallbackFailure | null {
  if (facts.conversation_brain_fallback_suppressed_by_turn_understanding !== true) {
    return "legacy_fallback_tu_not_suppressing_fallback";
  }
  if (facts.coaching_move_source !== "turn_understanding") {
    return "legacy_fallback_tu_not_suppressing_fallback";
  }
  return null;
}

export function assertNoLegacyFallbackInternalLabels(
  laneBody: string,
  finalBody: string
): SmsReviewLegacyFallbackFailure | null {
  if (bodyContainsInternalLabel(laneBody) || bodyContainsInternalLabel(finalBody)) {
    return "legacy_fallback_internal_label_leak";
  }
  return null;
}

export function evaluateLegacyFallbackExpectations(
  input: LegacyFallbackValidatorInput
): SmsReviewLegacyFallbackFailure[] {
  const exp = input.expectations;
  const failures: SmsReviewLegacyFallbackFailure[] = [];

  if (exp.assertRoutePurpose) {
    const f = assertLegacyFallbackRoutePurpose(input.facts, exp.assertRoutePurpose);
    if (f) failures.push(f);
  }

  if (exp.assertNoStrategyCard !== false) {
    const f = assertNoStrategyCardPresentForLegacyFallback(
      input.facts,
      input.laneMetadata,
      input.laneBody,
      input.finalBody
    );
    if (f) failures.push(f);
  }

  if (exp.assertTemplatePreviewNonSpeakable) {
    const f = assertNoLegacyFallbackTemplatePreviewSpoken({
      facts: input.facts,
      laneBody: input.laneBody,
      finalBody: input.finalBody,
    });
    if (f) failures.push(f);
  }

  if (exp.assertFinalGuardRan) {
    const f = assertLegacyFallbackFinalGuardRan({
      finalShouldSend: input.finalShouldSend,
      finalBody: input.finalBody,
      laneShouldSend: input.laneShouldSend,
    });
    if (f) failures.push(f);
  }

  if (exp.assertTuSuppressesFallback) {
    const f = assertTuSuppressesLegacyFallback(input.facts);
    if (f) failures.push(f);
  }

  const labelLeak = assertNoLegacyFallbackInternalLabels(input.laneBody, input.finalBody);
  if (labelLeak) failures.push(labelLeak);

  return failures;
}
