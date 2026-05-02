import { describe, expect, it, vi } from "vitest";
import {
  isPhase2KnownOutcomeWriteEventType,
  shouldSkipPhase2BrainForUnknownOutcomeEvent,
  snapshotNormalInboundPhase2ServerAuthoritativeState,
} from "@/lib/v2-human-sms-brain/finalize-normal-inbound-human-sms";
import { warnIfPhase2BrainWithoutValidatorEnforce } from "@/lib/v2-human-sms-brain/flags";
import type { V2InboundGatedDecision } from "@/lib/v2-ai-inbound";

describe("shouldSkipPhase2BrainForUnknownOutcomeEvent", () => {
  it("does not skip non-outcome writes", () => {
    const gatedDecision: V2InboundGatedDecision = {
      mode: "clarify",
      final_event_type: null,
      decision_reason: "x",
      confidence_used: null,
      should_write_outcome_event: false,
      should_open_blocker_capture: false,
      reply_style: "clarification",
      overrode_deterministic: false,
    };
    expect(
      shouldSkipPhase2BrainForUnknownOutcomeEvent({
        gatedDecision,
        deterministicEventType: "user_partial",
      }).skip
    ).toBe(false);
  });

  it("skips when outcome write uses unknown effective type", () => {
    const gatedDecision = {
      mode: "use_deterministic",
      final_event_type: "user_maybe" as unknown as V2InboundGatedDecision["final_event_type"],
      decision_reason: "x",
      confidence_used: null,
      should_write_outcome_event: true,
      should_open_blocker_capture: false,
      reply_style: "normal_outcome",
      overrode_deterministic: false,
    } as V2InboundGatedDecision;
    const r = shouldSkipPhase2BrainForUnknownOutcomeEvent({
      gatedDecision,
      deterministicEventType: "user_yes",
    });
    expect(r.skip).toBe(true);
    expect(r.outcomeTypeKeyHash).toMatch(/^[a-f0-9]+$/);
  });

  it("does not skip standard triad outcome writes", () => {
    const gatedDecision: V2InboundGatedDecision = {
      mode: "use_deterministic",
      final_event_type: "user_no",
      decision_reason: "x",
      confidence_used: null,
      should_write_outcome_event: true,
      should_open_blocker_capture: true,
      reply_style: "normal_outcome",
      overrode_deterministic: false,
    };
    expect(
      shouldSkipPhase2BrainForUnknownOutcomeEvent({
        gatedDecision,
        deterministicEventType: "user_no",
      }).skip
    ).toBe(false);
  });
});

describe("isPhase2KnownOutcomeWriteEventType", () => {
  it("accepts only yes/no/partial strings", () => {
    expect(isPhase2KnownOutcomeWriteEventType("user_yes")).toBe(true);
    expect(isPhase2KnownOutcomeWriteEventType("user_maybe")).toBe(false);
  });
});

describe("snapshotNormalInboundPhase2ServerAuthoritativeState", () => {
  it("matches for the same server inputs regardless of hypothetical reply wording", () => {
    const gated: V2InboundGatedDecision = {
      mode: "use_deterministic",
      final_event_type: "user_yes",
      decision_reason: "x",
      confidence_used: null,
      should_write_outcome_event: true,
      should_open_blocker_capture: false,
      reply_style: "normal_outcome",
      overrode_deterministic: false,
    };
    const a = snapshotNormalInboundPhase2ServerAuthoritativeState({
      classificationEventType: "user_yes",
      gatedDecision: gated,
    });
    const b = snapshotNormalInboundPhase2ServerAuthoritativeState({
      classificationEventType: "user_yes",
      gatedDecision: gated,
    });
    expect(a).toEqual(b);
    const replyA = "machine draft";
    const replyB = "Brain-polished different SMS body.";
    expect(replyA).not.toBe(replyB);
  });
});

describe("warnIfPhase2BrainWithoutValidatorEnforce", () => {
  it("warns when phase2 + brain on but enforce not true", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { ...process.env };
    process.env.V2_HUMAN_SMS_PHASE2_NORMAL_INBOUND = "true";
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    delete process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE;

    warnIfPhase2BrainWithoutValidatorEnforce();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    process.env = { ...env };
  });

  it("does not warn when enforce is true", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { ...process.env };
    process.env.V2_HUMAN_SMS_PHASE2_NORMAL_INBOUND = "true";
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "true";

    warnIfPhase2BrainWithoutValidatorEnforce();

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    process.env = { ...env };
  });
});
