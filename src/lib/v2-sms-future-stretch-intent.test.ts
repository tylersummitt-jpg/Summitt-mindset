import { describe, expect, it } from "vitest";

import {
  buildFutureStretchCoachReplyDeterministic,
  buildGoalIncreaseStretchVsDurableReply,
  classifyInboundFutureStretchAndGoalIntent,
  isFutureForwardPlanInbound,
  lastOutboundHintsTomorrowFollowup,
  tryBuildForcedInboundCoachSms,
} from "@/lib/v2-sms-future-stretch-intent";

describe("v2-sms-future-stretch-intent", () => {
  it("classifies live failure inbound as future stretch + increase signals", () => {
    const inbound =
      "I'm going for 3 hours of distribution tomorrow. Let's increase the goal.";
    expect(isFutureForwardPlanInbound(inbound)).toBe(true);
    const c = classifyInboundFutureStretchAndGoalIntent(inbound);
    expect(c.kind).toBe("future_stretch_target");
  });

  it("detects tomorrow follow-up hints from last outbound preview", () => {
    expect(lastOutboundHintsTomorrowFollowup("What's the plan for tomorrow?")).toBe(true);
  });

  it("TEST 1 forced reply: tomorrow language, stretch support, bans machinery phrases", () => {
    const msg = tryBuildForcedInboundCoachSms({
      userMessage: "I'm going for 3 hours of distribution tomorrow. Let's increase the goal.",
      gatedDecision: {
        mode: "clarify",
        decision_reason: "future_forward_plan_no_today_score",
      },
      lastOutboundSmsPreview: "What happened today?",
      eventsNewestFirst: [],
      effectiveAskFloor: "1 hour of distribution daily",
      messageSid: "SM_LIVE_FAIL_1",
    });
    expect(msg).toBeTruthy();
    const lower = msg!.toLowerCase();
    expect(lower).toMatch(/tomorrow/);
    expect(lower).not.toMatch(/what'?s your plan for today/);
    expect(lower).not.toMatch(/focus on the commitment first/);
    expect(lower).not.toMatch(/for today,?\s*aim for/);
  });

  it("TEST 2 forced deterministic copy references tomorrow and planning", () => {
    const msg = buildFutureStretchCoachReplyDeterministic({
      userMessage: "Tomorrow I'm doing 3 hours.",
      effectiveAskFloor: "1 hour of distribution",
      messageSid: "SM_TEST_2",
    });
    expect(msg.toLowerCase()).toMatch(/tomorrow/);
    expect(msg.toLowerCase()).not.toMatch(/did it happen today/);
  });

  it("TEST 3 goal increase vague reply does not shut the user down", () => {
    const msg = buildGoalIncreaseStretchVsDurableReply("SM_GOAL_VAGUE");
    expect(msg.toLowerCase()).not.toMatch(/focus on the commitment first/);
    expect(msg.toLowerCase()).toMatch(/tomorrow|official|daily|stretch|paths/i);
  });

  it("goal increase alone classifies as vague increase intent", () => {
    expect(classifyInboundFutureStretchAndGoalIntent("Let's increase the goal.").kind).toBe(
      "goal_increase_vague"
    );
  });
});
