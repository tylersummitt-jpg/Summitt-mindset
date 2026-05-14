/**
 * Inbound coach reply resolution — scored `user_yes` must not surface weak shadow `suggested_reply`.
 *
 * `validateAiSuggestedReplyForInbound` rejects generic onboarding/momentum copy for `user_yes` so
 * `resolveV2InboundCoachReplyBody` falls through to `buildOutcomeAi` / templates.
 */

import { describe, expect, it, vi } from "vitest";

/** Avoid pulling real Supabase when transitive imports load adaptive-contract. */
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import {
  defaultGatedDecision,
  decideV2InboundOutcomeFromInterpretation,
  resolveV2InboundCoachReplyBody,
  resolveV2InboundGatedDecision,
  validateAiSuggestedReplyForInbound,
  type V2InboundShadowInterpretationResult,
} from "@/lib/v2-ai-inbound";
import { buildV2InboundReplySms } from "@/lib/v2-sms-accountability";

function shadowInterpretationWithSuggested(suggested: string): V2InboundShadowInterpretationResult {
  return {
    ok: true,
    model: "gpt-4o-mini",
    data: {
      version: 1,
      intent: "accountability_reply",
      proposed_outcome: "yes",
      confidence: 0.95,
      needs_clarification: false,
      clarification_question: null,
      is_repair: false,
      repair_of: null,
      user_asks_question: false,
      suggests_commitment_change: false,
      blocker_likely: false,
      discouraged_or_frustrated: false,
      substitution_counts: false,
      opt_out_like_but_not_stop: false,
      reasoning_short: "User confirmed completion for today's bar.",
      suggested_reply: suggested,
    },
  };
}

const proofAcknowledgmentRe =
  /\b(logged|proof|counts|marking today|mark(?:ing)?.*done|complete(?!\s+step))\b/i;

const weakOnboardingRe =
  /\b(on board|next step|next on your agenda|keep the momentum|awesome,? keep)\b/i;

describe("resolveV2InboundCoachReplyBody — user_yes should not prefer weak ai_suggested", () => {
  const gatedDecision = defaultGatedDecision("user_yes", "test_deterministic");

  const baseResolveArgs = {
    gatedEnabled: true,
    gatedDecision,
    deterministicEventType: "user_yes" as const,
    userMessage: "Yes",
    preferredName: "Tyler",
    messageSid: "SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    effectiveAsk: "Spend an hour on distribution for the SaaS app.",
    behaviorStatement: "Spend an hour on distribution for the SaaS app.",
    trySuggestedWhenAgrees: false,
    commitmentChangeWave4Body: null,
  };

  /**
   * TEST 1 — Generic ai_suggested must not win for scored user_yes.
   */
  it("TEST 1: generic ai_suggested should not win for scored user_yes (reply_source !== ai_suggested)", async () => {
    const buildOutcomeAi = vi.fn(async () => ({
      ok: true as const,
      message: "Good. I'm marking today complete. That distribution hour counts as proof.",
      confidence: 0.85,
      fallbackUsed: false as const,
    }));

    const buildTemplate = vi.fn(() =>
      buildV2InboundReplySms({
        behaviorStatement: baseResolveArgs.behaviorStatement,
        messageSid: baseResolveArgs.messageSid,
        eventType: "user_yes",
        preferredName: null,
      })
    );

    const resolved = await resolveV2InboundCoachReplyBody({
      ...baseResolveArgs,
      interpretation: shadowInterpretationWithSuggested(
        "Great to hear! Let's keep the momentum going. What's next on your agenda?"
      ),
      buildOutcomeAi,
      buildTemplate,
    });

    expect(resolved.meta.reply_source).not.toBe("ai_suggested");
    expect(buildOutcomeAi).toHaveBeenCalled();
  });

  /**
   * TEST 2 — Final reply should acknowledge completion/proof, not generic momentum.
   */
  it("TEST 2: user_yes reply should acknowledge completion/proof (not momentum-only)", async () => {
    const buildOutcomeAi = vi.fn(async () => ({
      ok: true as const,
      message: "Logged. That hour of distribution counts as proof for today.",
      confidence: 0.9,
      fallbackUsed: false as const,
    }));

    const resolved = await resolveV2InboundCoachReplyBody({
      ...baseResolveArgs,
      interpretation: shadowInterpretationWithSuggested(
        "Great to hear! Let's keep the momentum going. What's next on your agenda?"
      ),
      buildOutcomeAi,
      buildTemplate: (finalType) =>
        buildV2InboundReplySms({
          behaviorStatement: baseResolveArgs.behaviorStatement,
          messageSid: baseResolveArgs.messageSid,
          eventType: finalType,
          preferredName: null,
        }),
    });

    const lower = resolved.replyBody.toLowerCase();
    expect(lower).toMatch(proofAcknowledgmentRe);
    expect(lower).not.toMatch(weakOnboardingRe);
  });

  /**
   * TEST 4 — Strong suggested reply remains acceptable under validation.
   */
  it("TEST 4: strong suggested_reply still passes validation for user_yes", () => {
    const strong =
      "Logged. That hour of distribution counts as proof for today.";
    const v = validateAiSuggestedReplyForInbound(strong, {
      finalEventType: "user_yes",
      gatedMode: "use_deterministic",
      replyStyle: "normal_outcome",
    });
    expect(v.ok).toBe(true);
  });

  /**
   * TEST 5 — No suggested; AI fails → template or deterministic_human fallback stays proof-safe.
   */
  it("TEST 5: AI disabled / no suggested — fallback path is safe proof tone (no next-step hustle)", async () => {
    const buildOutcomeAi = vi.fn(async () => ({
      ok: false as const,
      fallbackUsed: true as const,
      reason: "ai_disabled",
    }));

    const resolved = await resolveV2InboundCoachReplyBody({
      ...baseResolveArgs,
      interpretation: null,
      buildOutcomeAi,
      buildTemplate: (finalType) =>
        buildV2InboundReplySms({
          behaviorStatement: baseResolveArgs.behaviorStatement,
          messageSid: baseResolveArgs.messageSid,
          eventType: finalType,
          preferredName: "Tyler",
        }),
    });

    expect(["fallback", "deterministic_human"]).toContain(resolved.meta.reply_source);
    const lower = resolved.replyBody.toLowerCase();
    expect(lower).not.toMatch(/\bwhat'?s (your )?next\b|\bagenda\b|\bon board\b/i);
    expect(lower).toMatch(/\b(good|logged|counts|proof|marking|that counts)/i);
  });
});

describe("resolveV2InboundGatedDecision — future forward planning", () => {
  it("TEST 1 routing: tomorrow stretch does not stay on today's scoring spine", () => {
    const inbound =
      "I'm going for 3 hours of distribution tomorrow. Let's increase the goal.";
    const d = resolveV2InboundGatedDecision({
      gatedEnabled: true,
      interpretation: null,
      deterministicEventType: "user_partial",
      deterministicNormalizedHint: "unclear",
      rawInboundBody: inbound,
    });
    expect(d.decision_reason).toBe("future_forward_plan_no_today_score");
    expect(d.should_write_outcome_event).toBe(false);
    expect(d.mode).toBe("clarify");
  });

  it("TEST 2: pure tomorrow plan clarifies without scoring", () => {
    const d = resolveV2InboundGatedDecision({
      gatedEnabled: false,
      interpretation: null,
      deterministicEventType: "user_partial",
      deterministicNormalizedHint: "unclear",
      rawInboundBody: "Tomorrow I'm doing 3 hours.",
    });
    expect(d.decision_reason).toBe("future_forward_plan_no_today_score");
    expect(d.should_write_outcome_event).toBe(false);
  });

  it("TEST 3: goal increase without tomorrow asks stretch vs durable", () => {
    const d = resolveV2InboundGatedDecision({
      gatedEnabled: true,
      interpretation: null,
      deterministicEventType: "user_partial",
      deterministicNormalizedHint: "unclear",
      rawInboundBody: "Let's increase the goal.",
    });
    expect(d.decision_reason).toBe("goal_increase_intent_clarify_stretch_vs_durable");
    expect(d.should_write_outcome_event).toBe(false);
  });
});

describe("decideV2InboundOutcomeFromInterpretation — commitment_change_handoff (3F-4)", () => {
  it("routes to commitment_change_handoff when AI signals commitment change without clear accountability answer", () => {
    const interpretation: V2InboundShadowInterpretationResult = {
      ok: true,
      model: "gpt-4o-mini",
      data: {
        version: 1,
        intent: "commitment_change_request",
        proposed_outcome: "partial",
        confidence: 0.88,
        needs_clarification: true,
        clarification_question: null,
        is_repair: false,
        repair_of: null,
        user_asks_question: false,
        suggests_commitment_change: false,
        blocker_likely: false,
        discouraged_or_frustrated: false,
        substitution_counts: false,
        opt_out_like_but_not_stop: false,
        reasoning_short: "User wants a different bar",
        suggested_reply: null,
      },
    };
    const d = decideV2InboundOutcomeFromInterpretation({
      deterministicEventType: "user_partial",
      deterministicNormalizedHint: "unclear",
      rawInboundBody: "I need to change my goal — this bar is not right",
      interpretation,
    });
    expect(d.mode).toBe("commitment_change_handoff");
    expect(d.should_write_outcome_event).toBe(false);
  });
});

describe("validateAiSuggestedReplyForInbound — ban weak user_yes suggested copy", () => {
  const ctx = {
    finalEventType: "user_yes" as const,
    gatedMode: "use_deterministic" as const,
    replyStyle: "normal_outcome" as const,
  };

  it("rejects onboarding/momentum/next-step suggested replies for user_yes", () => {
    const weakLines = [
      "Great to hear you're on board! What's your next step?",
      "Great to hear! What's next on your agenda?",
      "Awesome, keep the momentum going!",
      "Great job! You crushed it — keep this momentum going!",
    ];

    for (const line of weakLines) {
      const v = validateAiSuggestedReplyForInbound(line, ctx);
      expect(v.ok, `expected rejection for: ${line.slice(0, 40)}…`).toBe(false);
    }
  });
});

describe("validateAiSuggestedReplyForInbound — accountability machinery tone (any path)", () => {
  const clarifyCtx = {
    finalEventType: null,
    gatedMode: "clarify" as const,
    replyStyle: "clarification" as const,
  };

  it("TEST live regression: rejects ambitious-goal / focus-on-today machinery copy", () => {
    const bad =
      "That's an ambitious goal! Let's focus on the commitment first. For today, aim for at least 1 hour of distribution, then we can build from there. What's your plan for today?";
    const v = validateAiSuggestedReplyForInbound(bad, clarifyCtx);
    expect(v.ok).toBe(false);
  });
});
