import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildInboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import {
  buildExplicitOutcomeBeforeNoSendTelemetry,
  buildInboundTruthPersistOutcomeTelemetry,
  isShortAnswerOutcomeAuthorizedForPersist,
} from "@/lib/inbound-reply-no-send-outcome-persist";
import { resolveShortAnswerContextAuthority } from "@/lib/inbound-short-answer-context";
import { defaultGatedDecision } from "@/lib/v2-ai-inbound";
import { classifyV2InboundReply } from "@/lib/v2-sms-accountability";
import { V3_REFINE_ONLY_GATED } from "@/lib/v3-sms-machine-refine";
import {
  persistInboundAccountabilityOutcomeEvent,
  shouldPersistInboundAccountabilityOutcome,
} from "@/lib/v2-inbound-accountability-outcome-persist";

const insertMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      insert: (...args: unknown[]) => insertMock(...args),
    }),
  },
}));

const livePromptCtx = {
  has_live_accountability_prompt: true,
  self_contained_accountability_answer: false,
};

const PLAN_Q = "how does staying committed to this plan feel for the rest of the week";

const OUTCOME_Q = "Did you follow through with your plan before your doctor appointment?";

const DISTRIBUTION_OUTCOME_Q =
  "What actually happened with your distribution plan since your last check-in?";

const clarifyGatedNoOutcomeWrite = {
  mode: "clarify" as const,
  final_event_type: null,
  decision_reason: "clarify_no_outcome_write",
  confidence_used: 0.85,
  should_write_outcome_event: false,
  should_open_blocker_capture: false,
  reply_style: "clarification" as const,
  overrode_deterministic: true,
};

const recentCheckSent = [
  {
    event_type: "check_sent",
    occurred_at: new Date().toISOString(),
    payload_json: {},
  },
] as never[];

function meaningForOutcomeCheck(rawBody: string, classifierEventType?: string) {
  return buildInboundMeaningFacts({
    rawInbound: rawBody,
    classifierEventType: classifierEventType ?? "user_yes",
    expectedReplySemantics: "accountability_check",
    openQuestionPending: true,
    latestOpenQuestion: OUTCOME_Q,
    latestOutboundBody: OUTCOME_Q,
    recentEventsNewestFirst: recentCheckSent,
  });
}

describe("buildExplicitOutcomeBeforeNoSendTelemetry", () => {
  it("A/C: reports explicit completion detected and persisted on insert", () => {
    const telemetry = buildExplicitOutcomeBeforeNoSendTelemetry("I got my steps today", {
      status: "inserted",
      eventType: "user_yes",
      eventId: "evt-1",
      idempotencyKey: "v2_user_yes:SM_steps",
      overrideGatedNoWrite: true,
    });
    expect(telemetry.explicit_outcome_detected).toBe(true);
    expect(telemetry.explicit_outcome_persisted_before_no_send).toBe(true);
    expect(telemetry.explicit_outcome_persisted_event_type).toBe("user_yes");
  });

  it("D: contextless yes — detected false, not persisted", () => {
    const telemetry = buildExplicitOutcomeBeforeNoSendTelemetry("Yes", {
      status: "skipped",
      skipReason: "meaning_no_outcome_write",
    });
    expect(telemetry.explicit_outcome_detected).toBe(false);
    expect(telemetry.short_answer_outcome_authorized).toBe(false);
    expect(telemetry.explicit_outcome_persisted_before_no_send).toBe(false);
    expect(telemetry.outcome_persist_skip_reason_before_no_send).toBe("meaning_no_outcome_write");
  });

  it("J: Heck yeah! after outcome_check — short_answer_outcome_authorized true", () => {
    const body = "Heck yeah!";
    const saca = resolveShortAnswerContextAuthority({
      rawInbound: body,
      latestOpenQuestion: OUTCOME_Q,
      expectedReplySemantics: "accountability_check",
      recentEventsNewestFirst: recentCheckSent,
    });
    expect(isShortAnswerOutcomeAuthorizedForPersist(body, { shortAnswerContext: saca })).toBe(true);
    const telemetry = buildExplicitOutcomeBeforeNoSendTelemetry(
      body,
      {
        status: "inserted",
        eventType: "user_yes",
        eventId: "evt-1",
        idempotencyKey: "k",
        overrideGatedNoWrite: true,
      },
      { shortAnswerContext: saca }
    );
    expect(telemetry.short_answer_outcome_authorized).toBe(true);
    expect(telemetry.prior_question_type).toBe("outcome_check");
    expect(telemetry.outcome_proof_eligible).toBe(true);
  });

  it("L: contextless Heck yeah! — not authorized", () => {
    expect(isShortAnswerOutcomeAuthorizedForPersist("Heck yeah!")).toBe(false);
  });

  it("M: plan-confirmation Heck yeah! — not authorized", () => {
    const meaning = buildInboundMeaningFacts({
      rawInbound: "Heck yeah!",
      classifierEventType: "user_yes",
      openQuestionPending: true,
      latestOpenQuestion: PLAN_Q,
      expectedReplySemantics: "proposal_yes_no",
    });
    expect(isShortAnswerOutcomeAuthorizedForPersist("Heck yeah!", { inboundMeaning: meaning })).toBe(
      false
    );
  });

  it("N: classifier-realistic Heck yeah! is user_partial/unclear but SACA still authorizes", () => {
    const body = "Heck yeah!";
    const classification = classifyV2InboundReply(body);
    expect(classification.eventType).toBe("user_partial");
    expect(classification.normalizedHint).toBe("unclear");

    const meaning = meaningForOutcomeCheck(body, classification.eventType);
    expect(meaning.persistence_decision).toBe("write_user_yes_today");

    const saca = resolveShortAnswerContextAuthority({
      rawInbound: body,
      latestOpenQuestion: OUTCOME_Q,
      expectedReplySemantics: "accountability_check",
      recentEventsNewestFirst: recentCheckSent,
    });
    expect(saca.outcome_proof_eligible).toBe(true);
    expect(saca.reason).toMatch(/^short_affirm_to_fresh_outcome_check/);
    expect(isShortAnswerOutcomeAuthorizedForPersist(body, { shortAnswerContext: saca })).toBe(true);
  });
});

describe("lane no-send explicit outcome persistence eligibility", () => {
  it("A/B/C: I got my steps today persists on lane-style no-send args", () => {
    const body = "I got my steps today";
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_lane_main",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: buildInboundMeaningFacts({
        rawInbound: body,
        classifierEventType: "user_yes",
      }),
    });
    expect(result.persist).toBe(true);
    if (result.persist) expect(result.resolvedEventType).toBe("user_yes");
  });

  it("D: contextless Yes does not persist", () => {
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_lane_yes",
      commitmentId: "commit-1",
      rawBody: "Yes",
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: buildInboundMeaningFacts({
        rawInbound: "Yes",
        classifierEventType: "user_yes",
        openQuestionPending: false,
      }),
    });
    expect(result.persist).toBe(false);
  });

  it("E: plan-confirmation Yes does not persist user_yes", () => {
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_lane_plan_yes",
      commitmentId: "commit-1",
      rawBody: "Yes",
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: buildInboundMeaningFacts({
        rawInbound: "Yes",
        classifierEventType: "user_yes",
        openQuestionPending: true,
        latestOpenQuestion: PLAN_Q,
        expectedReplySemantics: "proposal_yes_no",
      }),
    });
    expect(result.persist).toBe(false);
  });

  it("J: lane no-send Heck yeah! after outcome_check persists user_yes", () => {
    const body = "Heck yeah!";
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_lane_heck_yeah",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: meaningForOutcomeCheck(body),
    });
    expect(result.persist).toBe(true);
    if (result.persist) expect(result.resolvedEventType).toBe("user_yes");
  });

  it("K: final-guard style no-send Heck yeah! after outcome_check persists user_yes", () => {
    const body = "Heck yeah!";
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_final_heck_yeah",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_yes",
      gatedDecision: { ...defaultGatedDecision("user_yes", "test"), should_write_outcome_event: false },
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: meaningForOutcomeCheck(body),
    });
    expect(result.persist).toBe(true);
    if (result.persist) expect(result.resolvedEventType).toBe("user_yes");
  });

  it("L: contextless Heck yeah! does not persist", () => {
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_ctxless_heck",
      commitmentId: "commit-1",
      rawBody: "Heck yeah!",
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: buildInboundMeaningFacts({
        rawInbound: "Heck yeah!",
        classifierEventType: "user_yes",
        openQuestionPending: false,
      }),
    });
    expect(result.persist).toBe(false);
  });

  it("M: plan-confirmation Heck yeah! does not persist user_yes", () => {
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_plan_heck",
      commitmentId: "commit-1",
      rawBody: "Heck yeah!",
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: buildInboundMeaningFacts({
        rawInbound: "Heck yeah!",
        classifierEventType: "user_yes",
        openQuestionPending: true,
        latestOpenQuestion: PLAN_Q,
        expectedReplySemantics: "proposal_yes_no",
      }),
    });
    expect(result.persist).toBe(false);
  });

  it("N: classifier-realistic Heck yeah! after outcome_check persists user_yes despite user_partial", () => {
    const body = "Heck yeah!";
    const classification = classifyV2InboundReply(body);
    expect(classification.eventType).toBe("user_partial");

    const meaning = meaningForOutcomeCheck(body, classification.eventType);
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_heck_classifier_partial",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: classification.eventType,
      gatedDecision: defaultGatedDecision(classification.eventType, "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: meaning,
    });
    expect(result.persist).toBe(true);
    if (result.persist) expect(result.resolvedEventType).toBe("user_yes");
  });

  it("O: classifier-realistic contextless Heck yeah! does not persist", () => {
    const body = "Heck yeah!";
    const classification = classifyV2InboundReply(body);
    expect(classification.eventType).toBe("user_partial");

    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_ctxless_classifier_partial",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: classification.eventType,
      gatedDecision: defaultGatedDecision(classification.eventType, "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: buildInboundMeaningFacts({
        rawInbound: body,
        classifierEventType: classification.eventType,
        openQuestionPending: false,
      }),
    });
    expect(result.persist).toBe(false);
  });

  it("P: classifier-realistic plan-confirmation Heck yeah! does not persist", () => {
    const body = "Heck yeah!";
    const classification = classifyV2InboundReply(body);
    expect(classification.eventType).toBe("user_partial");

    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_plan_classifier_partial",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: classification.eventType,
      gatedDecision: defaultGatedDecision(classification.eventType, "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: buildInboundMeaningFacts({
        rawInbound: body,
        classifierEventType: classification.eventType,
        openQuestionPending: true,
        latestOpenQuestion: PLAN_Q,
        expectedReplySemantics: "proposal_yes_no",
      }),
    });
    expect(result.persist).toBe(false);
  });

  it("F: No, I missed persists user_no", () => {
    const body = "No, I missed";
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_lane_miss",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_no",
      gatedDecision: defaultGatedDecision("user_no", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: buildInboundMeaningFacts({
        rawInbound: body,
        classifierEventType: "user_no",
      }),
    });
    expect(result.persist).toBe(true);
    if (result.persist) expect(result.resolvedEventType).toBe("user_no");
  });

  it("G: I did half persists user_partial", () => {
    const body = "I did half";
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_lane_partial",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_partial",
      gatedDecision: defaultGatedDecision("user_partial", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: buildInboundMeaningFacts({
        rawInbound: body,
        classifierEventType: "user_partial",
      }),
    });
    expect(result.persist).toBe(true);
    if (result.persist) expect(result.resolvedEventType).toBe("user_partial");
  });

  it("P0-B: I missed it yesterday + clarify gated no-send path persists user_no", () => {
    const body = "I missed it yesterday";
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: body,
      classifierEventType: "user_no",
      expectedReplySemantics: "accountability_check",
      openQuestionPending: true,
      latestOpenQuestion: DISTRIBUTION_OUTCOME_Q,
      latestOutboundBody: DISTRIBUTION_OUTCOME_Q,
      recentEventsNewestFirst: recentCheckSent,
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_nosend_missed_yesterday",
      commitmentId: "commit-1",
      rawBody: body,
      classifierEventType: "user_no",
      gatedDecision: clarifyGatedNoOutcomeWrite,
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result.persist).toBe(true);
    if (result.persist) {
      expect(result.resolvedEventType).toBe("user_no");
      expect(result.overrideGatedNoWrite).toBe(true);
    }
    const telemetry = buildExplicitOutcomeBeforeNoSendTelemetry(body, {
      status: result.persist ? "inserted" : "skipped",
      ...(result.persist
        ? {
            eventType: "user_no" as const,
            eventId: "evt-miss",
            idempotencyKey: "v2_user_no:SM_nosend_missed_yesterday",
            overrideGatedNoWrite: true,
          }
        : { skipReason: "gated_non_outcome_mode" as const }),
    });
    expect(telemetry.explicit_outcome_detected).toBe(true);
    expect(telemetry.explicit_outcome_persisted_before_no_send).toBe(true);
    expect(telemetry.outcome_persist_skip_reason_before_no_send).toBeUndefined();
  });
});

describe("buildInboundTruthPersistOutcomeTelemetry", () => {
  it("before_writer success telemetry", () => {
    const telemetry = buildInboundTruthPersistOutcomeTelemetry(
      {
        status: "inserted",
        eventType: "user_yes",
        eventId: "evt-1",
        idempotencyKey: "v2_user_yes:SM1",
        overrideGatedNoWrite: true,
      },
      { stage: "before_writer", persistenceDecision: "write_user_yes_today" }
    );
    expect(telemetry.inbound_truth_persist_attempted_before_writer).toBe(true);
    expect(telemetry.inbound_truth_persist_succeeded_before_writer).toBe(true);
    expect(telemetry.inbound_truth_persist_event_type).toBe("user_yes");
    expect(telemetry.persistence_decision_at_no_send).toBe("write_user_yes_today");
  });

  it("on_no_send skip telemetry", () => {
    const telemetry = buildInboundTruthPersistOutcomeTelemetry(
      { status: "skipped", skipReason: "meaning_no_outcome_write" },
      { stage: "on_no_send", noSendReason: "turn_understanding_stale_ask_blocked" }
    );
    expect(telemetry.inbound_truth_persist_attempted_on_no_send).toBe(true);
    expect(telemetry.inbound_truth_persist_succeeded_on_no_send).toBe(false);
    expect(telemetry.inbound_truth_persist_skipped_reason).toBe("meaning_no_outcome_write");
    expect(telemetry.inbound_reply_no_send_reason).toBe(
      "turn_understanding_stale_ask_blocked"
    );
  });
});

describe("idempotency on reply no-send then retry", () => {
  beforeEach(() => {
    insertMock.mockReset();
  });

  it("H: duplicate insert returns duplicate without throwing", async () => {
    insertMock.mockReturnValue({
      select: () => ({
        maybeSingle: async () => ({
          data: null,
          error: { code: "23505", message: "duplicate key" },
        }),
      }),
    });

    const first = await persistInboundAccountabilityOutcomeEvent({
      commitmentId: "commit-1",
      clerkUserId: "user-1",
      messageSid: "SM_lane_retry",
      rawBody: "I got my steps today",
      eventType: "user_yes",
      branch: "main",
      classifierEventType: "user_yes",
      classifierNormalizedHint: null,
      gatedDecision: V3_REFINE_ONLY_GATED,
      liveAccountabilityPromptDetected: true,
      overrideGatedNoWrite: true,
      proofMeta: null,
      payloadJson: { lane_no_send_before_final_guard: true },
      idempotencyKey: "v2_user_yes:SM_lane_retry",
    });

    expect(first.status).toBe("duplicate");
    expect(first.eventType).toBe("user_yes");

    const telemetry = buildExplicitOutcomeBeforeNoSendTelemetry("I got my steps today", first);
    expect(telemetry.explicit_outcome_persisted_before_no_send).toBe(true);
  });
});
