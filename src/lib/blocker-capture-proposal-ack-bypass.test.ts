import { describe, expect, it } from "vitest";

import {
  inboundContainsRealBlockerCaptureSignal,
  isPureBoundedProposalAcknowledgement,
  looksLikeProposalOrAdjustmentCoachMessage,
  shouldBypassBlockerCaptureForProposalAck,
} from "@/lib/blocker-capture-proposal-ack-bypass";

const ADJUSTMENT_PROPOSAL =
  "I see you didn't hit your goal yesterday; let's adjust our approach moving forward. How does committing to one hour of distribution per day sound?";

const PLAN_CONFIRM_Q =
  "How does staying committed to taking at least 10,000 steps a day for the next 7 days feel for you? Let me know if that works or if you'd like to adjust!";

const OUTCOME_Q = "Did you get your 10,000 steps in today?";

function bypass(inbound: string, coach = ADJUSTMENT_PROPOSAL) {
  return shouldBypassBlockerCaptureForProposalAck({
    rawInbound: inbound,
    latestOutboundBody: coach,
    latestOpenQuestion: coach,
    openQuestionPending: true,
  });
}

describe("looksLikeProposalOrAdjustmentCoachMessage", () => {
  it("detects adjustment proposal sound question", () => {
    expect(looksLikeProposalOrAdjustmentCoachMessage(ADJUSTMENT_PROPOSAL)).toBe(true);
  });

  it("does not treat outcome check as proposal", () => {
    expect(looksLikeProposalOrAdjustmentCoachMessage(OUTCOME_Q)).toBe(false);
  });
});

describe("inboundContainsRealBlockerCaptureSignal", () => {
  it("detects one-word blocker time", () => {
    expect(inboundContainsRealBlockerCaptureSignal("time")).toBe(true);
  });

  it("detects distracted phrase", () => {
    expect(inboundContainsRealBlockerCaptureSignal("I got distracted")).toBe(true);
  });

  it("does not flag pure good ack", () => {
    expect(inboundContainsRealBlockerCaptureSignal("Good")).toBe(false);
  });

  it("detects mixed ack + blocker", () => {
    expect(inboundContainsRealBlockerCaptureSignal("Good, time got away from me")).toBe(true);
  });
});

describe("shouldBypassBlockerCaptureForProposalAck — P0 Step E", () => {
  it("1: Good after adjustment proposal bypasses blocker capture", () => {
    const r = bypass("Good");
    expect(r.bypass).toBe(true);
    expect(r.saca.prior_question_type).toBe("plan_confirmation");
    expect(r.saca.allowed_persistence).toBe("no_outcome_write");
    expect(r.saca.response_intent_hint).toBe("acknowledge_plan_confirmation");
  });

  it("1b: Fine after adjustment proposal bypasses blocker capture", () => {
    const r = bypass("Fine");
    expect(r.bypass).toBe(true);
    expect(r.saca.outcome_proof_eligible).toBe(false);
  });

  it("1c: Great after adjustment proposal bypasses blocker capture", () => {
    const r = bypass("Great");
    expect(r.bypass).toBe(true);
    expect(r.saca.outcome_proof_eligible).toBe(false);
  });

  it("2: Sounds good bypasses", () => {
    expect(bypass("Sounds good").bypass).toBe(true);
  });

  it("3: Okay bypasses", () => {
    expect(bypass("Okay").bypass).toBe(true);
  });

  it("4: Yes is proposal ack path with no outcome write (not completion)", () => {
    const r = bypass("Yes");
    expect(r.bypass).toBe(true);
    expect(r.saca.outcome_proof_eligible).toBe(false);
    expect(r.saca.allowed_persistence).toBe("no_outcome_write");
  });

  it("5: Good, time got away from me does not bypass as pure ack", () => {
    expect(bypass("Good, time got away from me").bypass).toBe(false);
  });

  it("6: time with blocker pending still captures blocker", () => {
    expect(bypass("time").bypass).toBe(false);
  });

  it("7: I got distracted still captures blocker", () => {
    expect(bypass("I got distracted").bypass).toBe(false);
  });

  it("8: Good after outcome check does not bypass as proposal ack", () => {
    const r = shouldBypassBlockerCaptureForProposalAck({
      rawInbound: "Good",
      latestOutboundBody: OUTCOME_Q,
      latestOpenQuestion: OUTCOME_Q,
      openQuestionPending: true,
    });
    expect(r.bypass).toBe(false);
    expect(r.reason).toBe("outcome_check_prior");
    expect(r.saca.outcome_proof_eligible).toBe(false);
  });

  it("8b: Fine/Great after outcome check do not bypass and do not prove outcome", () => {
    for (const phrase of ["Fine", "Great"] as const) {
      const r = shouldBypassBlockerCaptureForProposalAck({
        rawInbound: phrase,
        latestOutboundBody: OUTCOME_Q,
        latestOpenQuestion: OUTCOME_Q,
        openQuestionPending: true,
      });
      expect(r.bypass).toBe(false);
      expect(r.saca.outcome_proof_eligible).toBe(false);
    }
  });

  it("9: Good after plan confirmation bypasses with no outcome write", () => {
    const r = shouldBypassBlockerCaptureForProposalAck({
      rawInbound: "Good",
      latestOutboundBody: PLAN_CONFIRM_Q,
      latestOpenQuestion: PLAN_CONFIRM_Q,
      expectedReplySemantics: "proposal_yes_no",
      openQuestionPending: true,
    });
    expect(r.bypass).toBe(true);
    expect(r.saca.allowed_persistence).toBe("no_outcome_write");
  });

  it("10: isPureBoundedProposalAcknowledgement covers good/fine", () => {
    expect(isPureBoundedProposalAcknowledgement("Good")).toBe(true);
    expect(isPureBoundedProposalAcknowledgement("fine")).toBe(true);
    expect(isPureBoundedProposalAcknowledgement("works for me")).toBe(true);
  });

  describe("P0-E hardening — recovery/open_reflection must not bypass", () => {
    const RECOVERY_PRIORS = [
      "Why did you miss it?",
      "What blocked you?",
      "What got in the way?",
      "What actually happened?",
      "Tell me what happened.",
      "What led to that?",
    ] as const;

    it.each(RECOVERY_PRIORS)("Good after %s does not bypass", (prior) => {
      const r = shouldBypassBlockerCaptureForProposalAck({
        rawInbound: "Good",
        latestOutboundBody: prior,
        latestOpenQuestion: prior,
        openQuestionPending: true,
      });
      expect(r.bypass).toBe(false);
      expect(r.saca.outcome_proof_eligible).toBe(false);
    });
  });

  it("contextless Good does not bypass and has no outcome write", () => {
    const r = shouldBypassBlockerCaptureForProposalAck({
      rawInbound: "Good",
      latestOutboundBody: null,
      latestOpenQuestion: null,
      openQuestionPending: false,
    });
    expect(r.bypass).toBe(false);
    expect(r.saca.allowed_persistence).toBe("no_outcome_write");
    expect(r.saca.outcome_proof_eligible).toBe(false);
  });

  it("Does this 7-day plan work? + Good still bypasses via explicit proposal shape", () => {
    const prior = "Does this 7-day plan work?";
    expect(looksLikeProposalOrAdjustmentCoachMessage(prior)).toBe(true);
    const r = shouldBypassBlockerCaptureForProposalAck({
      rawInbound: "Good",
      latestOutboundBody: prior,
      latestOpenQuestion: prior,
      openQuestionPending: true,
    });
    expect(r.bypass).toBe(true);
    expect(r.saca.allowed_persistence).toBe("no_outcome_write");
  });
});

describe("blocker-capture route wiring (static)", () => {
  it("blocker pending branch checks proposal ack bypass before processV2BlockerCapture", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const route = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts"),
      "utf8"
    );
    const start = route.indexOf("if (isBlockerCapturePendingActive(c))");
    expect(start).toBeGreaterThanOrEqual(0);
    const slice = route.slice(start, start + 3500);
    expect(slice).toContain("shouldBypassBlockerCaptureForProposalAck");
    expect(slice).toContain("blocker_capture_bypassed_proposal_ack");
    expect(slice).toContain("processV2NormalInboundOutcome");
    const bypassIdx = slice.indexOf("shouldBypassBlockerCaptureForProposalAck");
    const captureIdx = slice.indexOf("processV2BlockerCapture");
    expect(bypassIdx).toBeGreaterThanOrEqual(0);
    expect(captureIdx).toBeGreaterThan(bypassIdx);
  });
});
