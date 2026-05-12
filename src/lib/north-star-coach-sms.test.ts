import { describe, expect, it } from "vitest";
import {
  deriveFutureIntentHint,
  finalizeNorthStarCoachSms,
  finalizeNorthStarCoachSmsPreservingSuffix,
  inboundSignalsCompletion,
} from "./north-star-coach-sms";

const SAMPLE_COMPLIANCE_FOOTER = "Reply STOP to opt out. Reply HELP for help.";

describe("inboundSignalsCompletion", () => {
  it("treats sure did as completion", () => {
    expect(inboundSignalsCompletion("Sure did!")).toBe(true);
  });
  it("treats I have!! as completion", () => {
    expect(inboundSignalsCompletion("I have!!")).toBe(true);
  });
  it("treats yes already as completion", () => {
    expect(inboundSignalsCompletion("Yes already")).toBe(true);
  });
});

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

  it("rewrites did it happen with daily opener even without a question mark", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody:
        "Did it happen with I want to keep a clear and accurate big picture mindset",
      channel: "daily_outbound",
      effectiveAskText: "big picture mindset",
      behaviorStatement: "I want to keep a clear and accurate big picture mindset",
    });
    expect(r.visibleBody.toLowerCase()).toContain("did you protect");
    expect(r.visibleBody.toLowerCase()).not.toContain("did it happen with");
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

  it("daily outbound flavor uses one clean ask when proposed is thin", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "short",
      channel: "daily_outbound",
      contextPacket: { effectiveAskText: "30 minutes of focused reps", source: "test" },
    });
    expect(r.visibleBody.toLowerCase()).toContain("30 minutes");
    expect(r.visibleBody.toLowerCase()).toMatch(/did you (protect|dictate)/);
    expect(r.visibleBody).toMatch(/\?$/);
  });

  it("repeat-kill / structural: proposed coach reply must not echo the same question after the user answered", () => {
    const q = "What's the smallest honest next step you can still do today - 10 minutes or less?";
    const r = finalizeNorthStarCoachSms({
      proposedBody: `Got it. ${q}`,
      channel: "inbound_coach_reply",
      latestInboundRaw: "It's late so I'll have to get it done tomorrow",
      latestOutboundBody: q,
      contextPacket: { latestOpenQuestion: q, source: "test" },
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("smallest honest");
    expect(
      r.meta.blockedReasons.includes("structural_guard_rewrite") ||
        r.meta.repeated_question_guard_fired === true
    ).toBe(true);
  });

  it("repeat-kill fires when structural guards do not apply", () => {
    const q = "What's the real blocker — time, energy, or avoidance?";
    const r = finalizeNorthStarCoachSms({
      proposedBody: q,
      channel: "inbound_coach_reply",
      latestInboundRaw: "Mostly energy.",
      latestOutboundBody: q,
      contextPacket: { latestOpenQuestion: q, source: "test" },
    });
    expect(r.visibleBody.toLowerCase()).not.toBe(q.toLowerCase());
    expect(r.meta.repeated_question_guard_fired).toBe(true);
  });

  it("daily outbound scrubs did you manage essay phrasing", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "How did your focus go today and did you manage to finish the block?",
      channel: "daily_outbound",
      contextPacket: { effectiveAskText: "30 min focus", behaviorStatement: "Focus", source: "test" },
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("did you manage");
  });

  it("rewrites malformed Did it happen with + behavior_statement stitching", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Did it happen with I want to keep a clear mindset today?",
      channel: "daily_outbound",
      effectiveAskText: "protect 30 min workout",
      behaviorStatement: "I want to keep a clear mindset",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("did it happen with");
    expect(r.visibleBody.toLowerCase()).toMatch(/did you protect/);
  });

  it("fixes Let's Did contraction", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Hey Nate! Let's Did you protect 30 min daily workout today?",
      channel: "daily_outbound",
      effectiveAskText: "30 min daily workout",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("let's did");
  });

  it("scrubs broken It's Acknowledging lead-in", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "It's Acknowledging your needs is essential today.",
      channel: "inbound_coach_reply",
      latestInboundRaw: "I'm wiped.",
    });
    expect(r.visibleBody.startsWith("It's Acknowledging")).toBe(false);
    expect(r.visibleBody.toLowerCase()).toContain("acknowledging");
  });

  it("replaces Good morning when local hour is evening", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Good morning, Diane! Quick check — did you protect the rep?",
      channel: "daily_outbound",
      effectiveAskText: "the rep",
      localHour: 19,
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("good morning");
  });
  it("Hoover-like gratitude completion: strips vaping drift from bad draft", () => {
    const q = "Did you take a moment to thank someone for being present today?";
    const r = finalizeNorthStarCoachSms({
      proposedBody:
        "I see you've taken the time to acknowledge those around you. As you focus on cutting back on vaping, that awareness counts.",
      channel: "inbound_coach_reply",
      latestInboundRaw: "I have!!",
      latestOutboundBody: q,
      contextPacket: { latestOpenQuestion: q, source: "test" },
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("vap");
  });

  it("repeat kill after daily gratitude + I have!! does not emit Got it or next concrete move", () => {
    const q = "Did you take a moment to thank someone for being present today?";
    const r = finalizeNorthStarCoachSms({
      proposedBody: q,
      channel: "inbound_coach_reply",
      latestInboundRaw: "I have!!",
      latestOutboundBody: q,
      contextPacket: { latestOpenQuestion: q, source: "test" },
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("got it");
    expect(r.visibleBody.toLowerCase()).not.toContain("next concrete move");
  });

  it("emotional inbound repeat-kill avoids quote echo", () => {
    const q = "Did you protect the rep today?";
    const r = finalizeNorthStarCoachSms({
      proposedBody: q,
      channel: "inbound_coach_reply",
      latestInboundRaw: "Having an anxious morning",
      latestOutboundBody: q,
      contextPacket: { latestOpenQuestion: q, source: "test" },
    });
    expect(r.visibleBody.toLowerCase()).not.toContain('got it — "');
    expect(r.visibleBody.toLowerCase()).not.toContain("…");
  });

  it("long proof inbound repeat-kill does not quote user text", () => {
    const q = "Did you thank your teams today?";
    const longProof =
      "I tried talking with all the teams today in a positive tone and thanked each member for all they do for our patients";
    const r = finalizeNorthStarCoachSms({
      proposedBody: q,
      channel: "inbound_coach_reply",
      latestInboundRaw: longProof,
      latestOutboundBody: q,
      contextPacket: { latestOpenQuestion: q, source: "test" },
    });
    expect(r.visibleBody).not.toContain("I tried talking");
    expect(r.visibleBody.toLowerCase()).toContain("proof");
  });

  it("let me think repeat-kill avoids quote echo", () => {
    const q = "Want to lock tomorrow's block?";
    const r = finalizeNorthStarCoachSms({
      proposedBody: q,
      channel: "inbound_coach_reply",
      latestInboundRaw: "Let me think about it",
      latestOutboundBody: q,
      contextPacket: { latestOpenQuestion: q, source: "test" },
    });
    expect(r.visibleBody.toLowerCase()).not.toContain('got it');
    expect(r.visibleBody.toLowerCase()).not.toContain("next concrete move");
    expect(r.visibleBody.toLowerCase()).toContain("think");
  });

  it("broken transcript echo guard rewrites Got it quote draft", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: `Got it — "Let me think about it" — what's the next concrete move?`,
      channel: "inbound_coach_reply",
      latestInboundRaw: "Let me think about it",
      latestOutboundBody: "What time works tomorrow?",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain('got it — "');
    expect(r.visibleBody.toLowerCase()).not.toContain("next concrete move");
  });

  it("daily rewrites Did you protect keep a clear… malformed opener", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Did you protect keep a clear and accurate big picture mindset. today?",
      channel: "daily_outbound",
      effectiveAskText: "Keep a clear and accurate big picture mindset",
    });
    expect(r.visibleBody.toLowerCase()).toContain("big-picture mindset");
  });

  it("daily rewrites Did you protect Use AI malformed opener", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "You're making strides! Did you protect Use AI & dictate at least one story today?",
      channel: "daily_outbound",
      effectiveAskText: "Use AI & dictate at least one story",
    });
    expect(r.visibleBody.toLowerCase()).toContain("dictate one story");
  });

  it("daily rewrites chopped part of the ending", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody:
        "Did you take a deep breath today and ask yourself if the situation is worth being anxious about? Remember, letting go of what you can't control is part of the",
      channel: "daily_outbound",
      effectiveAskText: "pause when anxious",
      behaviorStatement: "Take a breath when anxious",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("part of the");
    expect(r.visibleBody).toMatch(/\?$/);
  });
});

describe("deriveFutureIntentHint", () => {
  it("buckets tomorrow vs durable change", () => {
    expect(deriveFutureIntentHint("I'll go two hours tomorrow")).toBe("tomorrow");
    expect(deriveFutureIntentHint("New baseline from now on")).toBe("durable_change");
  });
});
