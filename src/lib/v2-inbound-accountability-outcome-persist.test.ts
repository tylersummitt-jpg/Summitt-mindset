import { beforeEach, describe, expect, it, vi } from "vitest";
import { V3_REFINE_ONLY_GATED } from "@/lib/v3-sms-machine-refine";
import { defaultGatedDecision } from "@/lib/v2-ai-inbound";
import { isClearAccountabilityCompletionReply } from "@/lib/v2-inbound-accountability-completion";
import { buildInboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import {
  persistInboundAccountabilityOutcomeEvent,
  shouldPersistInboundAccountabilityOutcome,
  resolveInboundAccountabilityOutcomeEventType,
} from "@/lib/v2-inbound-accountability-outcome-persist";

const insertMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      insert: (...args: unknown[]) => insertMock(...args),
    }),
  },
}));

describe("isClearAccountabilityCompletionReply", () => {
  it("detects I did it and similar completion phrases", () => {
    expect(isClearAccountabilityCompletionReply("I did it!")).toBe(true);
    expect(isClearAccountabilityCompletionReply("done")).toBe(true);
    expect(isClearAccountabilityCompletionReply("yes")).toBe(true);
    expect(isClearAccountabilityCompletionReply("I got it done")).toBe(true);
    expect(isClearAccountabilityCompletionReply("nope")).toBe(true);
    expect(isClearAccountabilityCompletionReply("I did my 10,000 steps yesterday!")).toBe(true);
    expect(isClearAccountabilityCompletionReply("I completed it")).toBe(true);
    expect(isClearAccountabilityCompletionReply("I made the calls")).toBe(true);
    expect(isClearAccountabilityCompletionReply("I did the workout")).toBe(true);
  });

  it("does not treat open-ended reflection as completion", () => {
    expect(isClearAccountabilityCompletionReply("because I was tired")).toBe(false);
    expect(isClearAccountabilityCompletionReply("8")).toBe(false);
  });

  it("does not treat negation, plan, wish, or uncertainty as completion", () => {
    expect(isClearAccountabilityCompletionReply("I did not do it")).toBe(false);
    expect(isClearAccountabilityCompletionReply("I made a plan")).toBe(false);
    expect(isClearAccountabilityCompletionReply("I wish I did")).toBe(false);
    expect(isClearAccountabilityCompletionReply("I did think about it")).toBe(false);
    expect(isClearAccountabilityCompletionReply("I did?")).toBe(false);
    expect(isClearAccountabilityCompletionReply("I almost did it")).toBe(false);
  });
});

describe("shouldPersistInboundAccountabilityOutcome", () => {
  const livePromptCtx = {
    has_live_accountability_prompt: true,
    self_contained_accountability_answer: false,
  };

  it("persists clear user_yes even when gated should_write_outcome_event is false", () => {
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_test_001",
      commitmentId: "commit-1",
      rawBody: "I did it!",
      classifierEventType: "user_yes",
      gatedDecision: V3_REFINE_ONLY_GATED,
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
    });
    expect(result).toMatchObject({
      persist: true,
      resolvedEventType: "user_yes",
      overrideGatedNoWrite: true,
    });
  });

  it("skips when classifier is not an accountability outcome type", () => {
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_test_002",
      commitmentId: "commit-1",
      rawBody: "what should I do?",
      classifierEventType: "user_meta" as import("@/lib/v2-sms-accountability").V2InboundEventType,
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
    });
    expect(result).toEqual({
      persist: false,
      skipReason: "classifier_not_accountability_outcome",
    });
  });

  it("skips arc clarify only lane for ambiguous replies", () => {
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_test_003",
      commitmentId: "commit-1",
      rawBody: "maybe",
      classifierEventType: "user_partial",
      gatedDecision: {
        ...defaultGatedDecision("user_partial", "test"),
        mode: "clarify",
        should_write_outcome_event: false,
      },
      laneExclusion: "arc_clarify_only",
      activeReplyContext: livePromptCtx,
    });
    expect(result).toEqual({ persist: false, skipReason: "arc_clarify_only" });
  });

  it("skips yesterday reported completion with meaning_ack_only", () => {
    const inboundMeaning = buildInboundMeaningFacts({
      rawInbound: "I did my 10,000 steps yesterday!",
      classifierEventType: "user_yes",
    });
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_yest",
      commitmentId: "commit-1",
      rawBody: "I did my 10,000 steps yesterday!",
      classifierEventType: "user_yes",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning,
    });
    expect(result).toEqual({ persist: false, skipReason: "meaning_ack_only" });
  });

  it("does not persist false-positive completion phrases as user_yes", () => {
    const missMeaning = buildInboundMeaningFacts({
      rawInbound: "I did not do it",
      classifierEventType: "user_yes",
      classifierNormalizedHint: "completion_detail",
    });
    const missResult = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_miss",
      commitmentId: "commit-1",
      rawBody: "I did not do it",
      classifierEventType: "user_yes",
      classifierNormalizedHint: "completion_detail",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: missMeaning,
    });
    expect(missResult).toMatchObject({ persist: true, resolvedEventType: "user_no" });

    const planResult = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_plan",
      commitmentId: "commit-1",
      rawBody: "I made a plan",
      classifierEventType: "user_yes",
      classifierNormalizedHint: "completion_detail",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: buildInboundMeaningFacts({
        rawInbound: "I made a plan",
        classifierEventType: "user_yes",
        classifierNormalizedHint: "completion_detail",
      }),
    });
    expect(planResult).toEqual({ persist: false, skipReason: "meaning_no_outcome_write" });
    const partialMeaning = buildInboundMeaningFacts({
      rawInbound: "I almost did it",
      classifierEventType: "user_yes",
      classifierNormalizedHint: "completion_detail",
    });
    const partialResult = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_partial",
      commitmentId: "commit-1",
      rawBody: "I almost did it",
      classifierEventType: "user_yes",
      classifierNormalizedHint: "completion_detail",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: partialMeaning,
    });
    expect(partialResult).toMatchObject({ persist: true, resolvedEventType: "user_partial" });

    const cancelResult = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_cancel",
      commitmentId: "commit-1",
      rawBody: "I need to cancel my subscription",
      classifierEventType: "user_yes",
      classifierNormalizedHint: "completion_detail",
      gatedDecision: defaultGatedDecision("user_yes", "test"),
      laneExclusion: "none",
      activeReplyContext: livePromptCtx,
      inboundMeaning: buildInboundMeaningFacts({
        rawInbound: "I need to cancel my subscription",
        classifierEventType: "user_yes",
        classifierNormalizedHint: "completion_detail",
      }),
    });
    expect(cancelResult).toEqual({ persist: false, skipReason: "meaning_no_outcome_write" });
  });

  it("skips explicit lane exclusions", () => {
    const result = shouldPersistInboundAccountabilityOutcome({
      messageSid: "SM_test_004",
      commitmentId: "commit-1",
      rawBody: "yes",
      classifierEventType: "user_yes",
      gatedDecision: {
        mode: "commitment_change_handoff",
        final_event_type: "user_yes",
        decision_reason: "test",
        confidence_used: null,
        should_write_outcome_event: false,
        should_open_blocker_capture: false,
        reply_style: "normal_outcome",
        overrode_deterministic: false,
      },
      laneExclusion: "commitment_change_handoff",
      activeReplyContext: livePromptCtx,
    });
    expect(result).toEqual({ persist: false, skipReason: "lane_excluded" });
  });
});

describe("resolveInboundAccountabilityOutcomeEventType", () => {
  it("prefers gated final_event_type when set", () => {
    expect(
      resolveInboundAccountabilityOutcomeEventType({
        classifierEventType: "user_yes",
        gatedDecision: {
          ...defaultGatedDecision("user_yes", "test"),
          mode: "use_ai_outcome",
          final_event_type: "user_partial",
        },
      })
    ).toBe("user_partial");
  });
});

describe("persistInboundAccountabilityOutcomeEvent", () => {
  beforeEach(() => {
    insertMock.mockReset();
  });

  it("returns inserted on success", async () => {
    insertMock.mockReturnValue({
      select: () => ({
        maybeSingle: async () => ({ data: { id: "evt-1" }, error: null }),
      }),
    });

    const result = await persistInboundAccountabilityOutcomeEvent({
      commitmentId: "commit-1",
      clerkUserId: "user-1",
      messageSid: "SM_retry_001",
      rawBody: "I did it!",
      eventType: "user_yes",
      branch: "main",
      classifierEventType: "user_yes",
      classifierNormalizedHint: "completion_phrase",
      gatedDecision: defaultGatedDecision("user_yes", "use_ai_outcome"),
      liveAccountabilityPromptDetected: true,
      overrideGatedNoWrite: false,
      proofMeta: null,
      payloadJson: { ai: { message: "Nice work." } },
    });

    expect(result.status).toBe("inserted");
    if (result.status === "inserted") {
      expect(result.eventId).toBe("evt-1");
      expect(result.idempotencyKey).toBe("v2_user_yes:SM_retry_001");
    }
  });

  it("returns duplicate on Postgres 23505 without throwing", async () => {
    insertMock.mockReturnValue({
      select: () => ({
        maybeSingle: async () => ({
          data: null,
          error: { code: "23505", message: "duplicate key" },
        }),
      }),
    });

    const result = await persistInboundAccountabilityOutcomeEvent({
      commitmentId: "commit-1",
      clerkUserId: "user-1",
      messageSid: "SM_retry_001",
      rawBody: "I did it!",
      eventType: "user_yes",
      branch: "open_question",
      classifierEventType: "user_yes",
      classifierNormalizedHint: "completion_phrase",
      gatedDecision: V3_REFINE_ONLY_GATED,
      liveAccountabilityPromptDetected: true,
      overrideGatedNoWrite: true,
      proofMeta: null,
      payloadJson: {},
    });

    expect(result).toMatchObject({ status: "duplicate", eventType: "user_yes" });
  });
});
