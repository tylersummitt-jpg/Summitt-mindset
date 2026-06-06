import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildInboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import {
  buildExplicitOutcomeBeforeNoSendTelemetry,
} from "@/lib/inbound-reply-no-send-outcome-persist";
import { defaultGatedDecision } from "@/lib/v2-ai-inbound";
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
    expect(telemetry.explicit_outcome_persisted_before_no_send).toBe(false);
    expect(telemetry.outcome_persist_skip_reason_before_no_send).toBe("meaning_no_outcome_write");
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
