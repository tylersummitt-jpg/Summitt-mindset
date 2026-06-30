import { describe, expect, it, vi } from "vitest";

import {
  detectInboundDidYouDoItViolation,
  detectInboundGenericWorksheetQuestionViolation,
  detectInboundReflectionReplyGuardViolations,
  isInboundProofCheckInReplyMove,
  tryRecoverInboundReflectionReplyGuardBody,
} from "@/lib/inbound-reflection-reply-guard";
import type { InboundResolvedTruth, InboundV3RelationshipLaneInput } from "@/lib/v3-inbound-relationship-lane";

vi.mock("@/lib/v3-sms-voice-ownership", () => ({
  repairV3RelationshipLaneBodyWithOpenAI: vi.fn(),
}));

import { repairV3RelationshipLaneBodyWithOpenAI } from "@/lib/v3-sms-voice-ownership";

const repairMock = vi.mocked(repairV3RelationshipLaneBodyWithOpenAI);

function baseRt(
  move: InboundResolvedTruth["required_reply_move"],
  extra?: Partial<InboundResolvedTruth>
): InboundResolvedTruth {
  return {
    latest_user_text: "I spent time encouraging the team today.",
    resolved_outcome: "unclear",
    temporal_scope: "unspecified",
    plan_detected: false,
    blocker_detected: false,
    answered_recent_ask: false,
    satisfied_recent_ask: false,
    persistence_decision: "no_outcome_write",
    required_reply_move: move,
    must_not_do: [],
    ...extra,
  };
}

function laneInput(rt: InboundResolvedTruth): InboundV3RelationshipLaneInput {
  return {
    facts: {
      route_purpose: "normal_inbound_reply",
      inbound_resolved_truth: rt,
    } as InboundV3RelationshipLaneInput["facts"],
    telemetry_fact_sources: [],
  };
}

describe("inbound reflection reply guards", () => {
  it("blocks Did you do it on acknowledge_reflection", () => {
    const rt = baseRt("acknowledge_reflection", { max_questions_override: 0 });
    expect(detectInboundDidYouDoItViolation("Did you do it?", rt)).toEqual({
      violation: true,
      reason: "inbound_did_you_do_it_wrong_move",
    });
  });

  it("allows Did you do it on acknowledge_completion", () => {
    const rt = baseRt("acknowledge_completion");
    expect(detectInboundDidYouDoItViolation("Did you do it?", rt).violation).toBe(false);
  });

  it("blocks generic worksheet phrases outside clarify_once", () => {
    const rt = baseRt("general_support");
    expect(
      detectInboundGenericWorksheetQuestionViolation(
        "What specific strategies do you think would help?",
        rt
      ).violation
    ).toBe(true);
    expect(
      detectInboundGenericWorksheetQuestionViolation("Can you share more about that feeling?", rt)
        .violation
    ).toBe(true);
  });

  it("allows generic worksheet phrasing on clarify_once", () => {
    const rt = baseRt("clarify_once");
    expect(
      detectInboundGenericWorksheetQuestionViolation("What specific steps can you take?", rt).violation
    ).toBe(false);
  });

  it("proof check-in moves are enumerated", () => {
    expect(isInboundProofCheckInReplyMove("acknowledge_partial")).toBe(true);
    expect(isInboundProofCheckInReplyMove("acknowledge_reflection")).toBe(false);
  });

  it("repair path returns repaired body when OpenAI repair succeeds", async () => {
    repairMock.mockResolvedValueOnce({
      body: "That team-unity instinct is leadership — keep building it.",
      openAiOk: true,
      metadata: {},
    });
    const rt = baseRt("acknowledge_reflection", { max_questions_override: 0 });
    const result = await tryRecoverInboundReflectionReplyGuardBody(
      "Did you do it?",
      laneInput(rt),
      ["inbound_did_you_do_it_wrong_move"],
      () => true
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).not.toMatch(/did you do it/i);
      expect(result.telemetry.inbound_reflection_reply_guard_applied).toBe(true);
    }
  });

  it("aggregates multiple guard violations", () => {
    const rt = baseRt("acknowledge_reflection");
    const violations = detectInboundReflectionReplyGuardViolations(
      "Did you do it? What specific steps can you take?",
      rt
    );
    expect(violations).toContain("inbound_did_you_do_it_wrong_move");
    expect(violations.some((v) => v.startsWith("inbound_generic_"))).toBe(true);
  });
});
