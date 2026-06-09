import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  assertFinalGuardStillRan,
  assertNoStrategyCardSmsBodyLeak,
  assertStrategyCardAllowedClaims,
  assertStrategyCardAvoidRepeating,
  assertStrategyCardForbiddenMoves,
  assertStrategyCardMoveType,
  assertStrategyCardMustNotDoIncludes,
  evaluateStrategyCardExpectations,
} from "@/sms-review-place/strategy-card-validators";
import type { StrategyCardExpectations } from "@/sms-review-place/types";

describe("strategy-card-validators", () => {
  it("assertStrategyCardMoveType flags missing and disallowed moves", () => {
    expect(assertStrategyCardMoveType(null, ["ask_blocker"])).toContain("strategy_card_move_type_missing");
    expect(assertStrategyCardMoveType("ack_completion", ["ask_blocker"])).toContain(
      "strategy_card_move_type_ack_completion_not_in_allowed"
    );
    expect(assertStrategyCardMoveType("ask_blocker", ["ask_blocker", "recover_today"])).toEqual([]);
  });

  it("assertStrategyCardForbiddenMoves catches forbidden move types", () => {
    expect(assertStrategyCardForbiddenMoves("propose_adjustment", ["propose_adjustment"])).toContain(
      "strategy_card_forbidden_move_propose_adjustment"
    );
  });

  it("assertStrategyCardAllowedClaims compares metadata claims", () => {
    expect(
      assertStrategyCardAllowedClaims({ proof: false, victory_room: false }, { proof: true })
    ).toContain("strategy_card_allowed_claims_proof_expected_true_got_false");
  });

  it("assertNoStrategyCardSmsBodyLeak detects internal card JSON in SMS bodies", () => {
    expect(assertNoStrategyCardSmsBodyLeak("STRATEGY_CARD_V1", "")).toHaveLength(1);
    expect(assertNoStrategyCardSmsBodyLeak("Got it — what's next?", "Got it — what's next?")).toEqual([]);
  });

  it("assertFinalGuardStillRan requires pipeline body when sending", () => {
    expect(
      assertFinalGuardStillRan({
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

  it("evaluateStrategyCardExpectations passes when metadata matches expectations", () => {
    const expectations: StrategyCardExpectations = {
      expectCardPresent: true,
      allowedMoveTypes: ["ask_blocker", "recover_today"],
      allowedClaims: { miss: true },
    };
    const outcome = evaluateStrategyCardExpectations({
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
    expect(assertStrategyCardMustNotDoIncludes(["Do not claim proof"], [/proof/i])).toEqual([]);
    expect(assertStrategyCardAvoidRepeating(["Did you calendar it?"], [/calendar/i])).toEqual([]);
    expect(assertStrategyCardAvoidRepeating(["Other ask"], [/calendar/i])).toHaveLength(1);
  });
});
