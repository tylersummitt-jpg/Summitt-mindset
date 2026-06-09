import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { buildInboundFacts } from "@/sms-review-place/build-facts";
import { getScenarioById } from "@/sms-review-place/fixtures/scenarios";
import { rebuildInboundStrategyCardForReview } from "@/sms-review-place/strategy-card-review";
import {
  assertFinalGuardStillRan,
  assertInboundPipelineFinalGuardStillRan,
  assertNoStrategyCardSmsBodyLeak,
  assertNoStrategyCardSmsBodyLeakFromBodies,
  assertStrategyCardAllowedClaimsFromMetadata,
  assertStrategyCardDoesNotSpeakOldPreview,
  assertStrategyCardForbiddenMovesFromMetadata,
  assertStrategyCardListAvoidRepeating,
  assertStrategyCardListMustNotDoIncludes,
  assertStrategyCardMoveType,
  assertStrategyCardMoveTypeFromMetadata,
  assertStrategyCardRouteKind,
  evaluateInboundNormalStrategyCardExpectations,
  evaluateStrategyCardExpectations,
} from "@/sms-review-place/strategy-card-validators";
import type { StrategyCardExpectations } from "@/sms-review-place/types";

const envSnapshot = { ...process.env };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sim-invalid.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sim-service-role-key-not-real";
});

afterEach(() => {
  process.env = { ...envSnapshot };
});

describe("strategy-card-validators — inbound normal", () => {
  it("assertStrategyCardMoveTypeFromMetadata flags missing and disallowed moves", () => {
    expect(assertStrategyCardMoveTypeFromMetadata(null, ["ask_blocker"])).toContain(
      "strategy_card_move_type_missing"
    );
    expect(assertStrategyCardMoveTypeFromMetadata("ack_completion", ["ask_blocker"])).toContain(
      "strategy_card_move_type_ack_completion_not_in_allowed"
    );
    expect(assertStrategyCardMoveTypeFromMetadata("ask_blocker", ["ask_blocker", "recover_today"])).toEqual([]);
  });

  it("assertStrategyCardForbiddenMovesFromMetadata catches forbidden move types", () => {
    expect(
      assertStrategyCardForbiddenMovesFromMetadata("propose_adjustment", ["propose_adjustment"])
    ).toContain("strategy_card_forbidden_move_propose_adjustment");
  });

  it("assertStrategyCardAllowedClaimsFromMetadata compares metadata claims", () => {
    expect(
      assertStrategyCardAllowedClaimsFromMetadata({ proof: false, victory_room: false }, { proof: true })
    ).toContain("strategy_card_allowed_claims_proof_expected_true_got_false");
  });

  it("assertNoStrategyCardSmsBodyLeakFromBodies detects internal card JSON in SMS bodies", () => {
    expect(assertNoStrategyCardSmsBodyLeakFromBodies("STRATEGY_CARD_V1", "")).toHaveLength(1);
    expect(assertNoStrategyCardSmsBodyLeakFromBodies("Got it — what's next?", "Got it — what's next?")).toEqual([]);
  });

  it("assertInboundPipelineFinalGuardStillRan requires pipeline body when sending", () => {
    expect(
      assertInboundPipelineFinalGuardStillRan({
        lane: "inbound",
        laneSkipped: false,
        northStarBody: "",
        laneBody: "What got in the way today?",
        finalBody: "What got in the way today?",
        finalShouldSend: true,
        blockedReasons: [],
      })
    ).toEqual([]);
  });

  it("evaluateInboundNormalStrategyCardExpectations passes when metadata matches expectations", () => {
    const expectations: StrategyCardExpectations = {
      expectCardPresent: true,
      allowedMoveTypes: ["ask_blocker", "recover_today"],
      allowedClaims: { miss: true },
    };
    const outcome = evaluateInboundNormalStrategyCardExpectations({
      expectations,
      laneMetadata: {
        strategy_card_move_type: "ask_blocker",
        strategy_card_validation_status: "valid",
        strategy_card_allowed_claims: {
          completion: false,
          miss: true,
          partial: false,
          proof: false,
          victory_room: false,
          state_changed: false,
          proposal_active: false,
        },
      },
      laneBody: "What got in the way today?",
      finalBody: "What got in the way today?",
      lane: "inbound",
      laneSkipped: false,
      northStarBody: "What got in the way today?",
      finalShouldSend: true,
      finalSkipReason: null,
      blockedReasons: [],
    });
    expect(outcome.pass).toBe(true);
    expect(outcome.violations).toEqual([]);
  });

  it("list pattern helpers match must_not_do and avoid_repeating", () => {
    expect(assertStrategyCardListMustNotDoIncludes(["Do not claim proof"], [/proof/i])).toEqual([]);
    expect(assertStrategyCardListAvoidRepeating(["Did you calendar it?"], [/calendar/i])).toEqual([]);
    expect(assertStrategyCardListAvoidRepeating(["Other ask"], [/calendar/i])).toHaveLength(1);
  });
});

describe("strategy-card-validators — open_question_answer", () => {
  it("assertStrategyCardRouteKind passes for open_question_answer", () => {
    const scenario = getScenarioById("open-question-clear-answer")!;
    const facts = buildInboundFacts(scenario, scenario.steps[0]!.userReply!);
    const card = rebuildInboundStrategyCardForReview(facts);
    expect(card).toBeTruthy();
    expect(assertStrategyCardRouteKind(card!, "open_question_answer")).toBeNull();
  });

  it("assertStrategyCardMoveType accepts allowed move list", () => {
    const scenario = getScenarioById("open-question-clear-answer")!;
    const facts = buildInboundFacts(scenario, scenario.steps[0]!.userReply!);
    const card = rebuildInboundStrategyCardForReview(facts)!;
    expect(assertStrategyCardMoveType(card, ["close_loop", "clarify"])).toBeNull();
    expect(assertStrategyCardMoveType(card, "ask_blocker")).toBe("strategy_card_move_mismatch");
  });

  it("assertStrategyCardDoesNotSpeakOldPreview requires constraint and fingerprint", () => {
    const scenario = getScenarioById("open-question-old-preview-non-speakable")!;
    const facts = buildInboundFacts(scenario, scenario.steps[0]!.userReply!);
    const card = rebuildInboundStrategyCardForReview(facts)!;
    expect(
      assertStrategyCardDoesNotSpeakOldPreview({
        card,
        openQuestionFacts: facts.open_question_facts,
      })
    ).toBeNull();
  });

  it("assertNoStrategyCardSmsBodyLeak rejects strategy JSON in final body", () => {
    const scenario = getScenarioById("open-question-clear-answer")!;
    const facts = buildInboundFacts(scenario, scenario.steps[0]!.userReply!);
    const card = rebuildInboundStrategyCardForReview(facts)!;
    expect(
      assertNoStrategyCardSmsBodyLeak({
        card,
        finalBody: "STRATEGY_CARD_V1 primary coaching move",
      })
    ).toBe("strategy_card_sms_body_leak");
    expect(
      assertNoStrategyCardSmsBodyLeak({
        card,
        finalBody: "Human coaching SMS without card leak.",
      })
    ).toBeNull();
  });

  it("assertFinalGuardStillRan requires lane and final send", () => {
    expect(
      assertFinalGuardStillRan({
        laneShouldSend: true,
        finalShouldSend: true,
        finalBody: "Human-readable coaching SMS body here.",
      })
    ).toBeNull();
    expect(
      assertFinalGuardStillRan({
        laneShouldSend: false,
        finalShouldSend: false,
        finalBody: "",
      })
    ).toBe("strategy_card_final_guard_not_ran");
  });

  it("evaluateStrategyCardExpectations has no exact SMS copy assertions", () => {
    const scenario = getScenarioById("open-question-clear-answer")!;
    const facts = buildInboundFacts(scenario, scenario.steps[0]!.userReply!);
    const card = rebuildInboundStrategyCardForReview(facts);
    const failures = evaluateStrategyCardExpectations({
      card,
      expectations: scenario.strategyCard!,
      finalBody: "Any human coaching SMS — not asserted verbatim.",
      finalShouldSend: true,
      laneShouldSend: true,
      openQuestionFacts: facts.open_question_facts,
    });
    expect(failures).toEqual([]);
  });
});
