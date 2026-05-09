import { describe, expect, it } from "vitest";
import {
  deriveFutureIntentHint,
  finalizeNorthStarCoachSms,
  finalizeNorthStarCoachSmsPreservingSuffix,
} from "./north-star-coach-sms";

const SAMPLE_COMPLIANCE_FOOTER = "Reply STOP to opt out. Reply HELP for help.";

describe("finalizeNorthStarCoachSms", () => {
  it("tomorrow plan answer must not re-ask today completion", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody:
        "Tyler, great to hear you're planning for two hours tomorrow! Did you complete the hour of distribution today? Check the app for updates if you need to adjust your plan.",
      channel: "inbound_coach_reply",
      latestInboundRaw: "I am going to do two hours tomorrow. I got this.",
      latestOutboundBody: "What's your plan for the 1 hour of distribution tomorrow?",
      behaviorStatement: "Distribution",
      effectiveAskText: "1 hour distribution",
      finalEventType: "user_yes",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("did you complete");
    expect(r.visibleBody.toLowerCase()).not.toContain("today?");
    expect(r.visibleBody.toLowerCase()).not.toContain("check the app");
    expect(r.visibleBody.toLowerCase()).toContain("tomorrow");
  });

  it("completion context rewrites duplicate today ask", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Did you get that done today?",
      channel: "inbound_coach_reply",
      latestInboundRaw: "I got it done!",
      latestOutboundBody: "That's logged as done. That's proof.",
      finalEventType: "user_yes",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("did you get that done");
  });

  it("strips app deflection coaching lines", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Check the app for updates if you need to adjust your plan.",
      channel: "inbound_coach_reply",
      latestInboundRaw: "ok",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("check the app");
    expect(r.visibleBody.toLowerCase()).not.toContain("adjust your plan");
  });

  it("cleans daily outbound reminder clichés", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Quick check: did you get a chance to finish the block today?",
      channel: "daily_outbound",
      behaviorStatement: "Focus work",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("quick check");
    expect(r.visibleBody.toLowerCase()).not.toContain("did you get a chance");
  });

  it("softens heavy recommit jargon", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Recommit to this for 7 days at the same bar.",
      channel: "contract_prompt",
      behaviorStatement: "Training",
      effectiveAskText: "30 minutes",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("recommit to this for 7 days");
  });

  it("weekly Pat Pause keeps STOP/HELP footer untouched", () => {
    const raw = `Time for a Pat Pause.\n\nQuick check: did you show up?\n\n${SAMPLE_COMPLIANCE_FOOTER}`;
    const r = finalizeNorthStarCoachSmsPreservingSuffix({
      proposedFullBody: raw,
      suffixToPreserve: SAMPLE_COMPLIANCE_FOOTER,
      channel: "weekly_sms",
      preserveNewlines: true,
    });
    expect(r.visibleBody.endsWith(SAMPLE_COMPLIANCE_FOOTER)).toBe(true);
    expect(r.visibleBody.toLowerCase()).not.toContain("quick check");
  });

  it("followup channel removes robotic quick-check phrasing when present", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Quick check — you still in?",
      channel: "followup_sms",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("quick check");
  });

  it("contextPacket todayCompleted avoids duplicate today ask without explicit finalEventType", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Did you get that done today?",
      channel: "inbound_coach_reply",
      latestInboundRaw: "thinking about tomorrow",
      contextPacket: { todayCompleted: true, source: "test" },
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("did you get that done");
  });

  it("daily outbound flavor threads commitment ask from contextPacket when proposed is thin", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "short",
      channel: "daily_outbound",
      contextPacket: { effectiveAskText: "30 minutes of focused reps", source: "test" },
    });
    expect(r.visibleBody.toLowerCase()).toContain("30 minutes");
    expect(r.visibleBody.toLowerCase()).toContain("tell the truth first");
  });
});

describe("deriveFutureIntentHint", () => {
  it("buckets tomorrow vs durable change", () => {
    expect(deriveFutureIntentHint("I'll go two hours tomorrow")).toBe("tomorrow");
    expect(deriveFutureIntentHint("New baseline from now on")).toBe("durable_change");
  });
});
