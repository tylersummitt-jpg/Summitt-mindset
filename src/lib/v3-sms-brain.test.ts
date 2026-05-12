import { afterEach, describe, expect, it } from "vitest";
import { generateV3DailyCheckIn, understandV3SmsTurn, tryGenerateV3OpenQuestionCoachReply } from "./v3-sms-brain";
import type { NorthStarSmsContextPacket } from "./north-star-coach-sms";
import type { ActiveV2CommitmentRow } from "./v2-commitment";

describe("tryGenerateV3OpenQuestionCoachReply", () => {
  const prevKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
  });

  it("uses deterministic fallback when OpenAI is unavailable and does not loop empty", async () => {
    delete process.env.OPENAI_API_KEY;
    const pkt: NorthStarSmsContextPacket = {
      latestOpenQuestion: "What story are you writing tomorrow?",
      expectedReplySemantics: "future_plan_story_title",
      recentTranscriptLines: ["Coach: What story tomorrow?", "User: Grammar school recollections."],
      todayCompleted: false,
    };
    const r = await tryGenerateV3OpenQuestionCoachReply({
      resolution: {
        turnPurpose: "answer_to_open_question",
        subkind: "future_plan_story_title",
        answeredOpenQuestion: true,
        shouldWriteOutcomeEvent: false,
        shouldAskTodayCompletionAgain: false,
        replyStrategy: "confirm_tomorrow_story_title",
        extractedAnswer: "Grammar school recollections",
      },
      inboundRaw: "Grammar school recollections",
      messageSid: "SM_openq_fallback",
      todayCompleted: false,
      effectiveAsk: "write daily",
      behaviorStatement: "writing",
      northStarPacket: pkt,
      coachingMemory: null,
      latestOpenQuestion: pkt.latestOpenQuestion ?? null,
      expectedReplySemantics: "future_plan_story_title",
      learningSignal: null,
    });
    expect(r.text.length).toBeGreaterThan(12);
    expect(r.openQuestionReplySource).toBe("deterministic_fallback");
    expect(r.text.toLowerCase()).not.toContain("what story are you");
  });
});

const commitment: ActiveV2CommitmentRow = {
  id: "c_test",
  clerk_user_id: "u_test",
  status: "active",
  behavior_statement: "dictate one story",
  title: "Story dictation",
  success_criteria: null,
  blocker_capture_expires_at: null,
  blocker_capture_after_event: null,
  adaptive_ask_text: null,
  adaptive_ask_active_from: null,
  adaptive_ask_expires_at: null,
  adaptive_proposal_text: null,
  adaptive_proposal_created_at: null,
  adaptive_proposal_expires_at: null,
  accountability_phase: "active_accountability",
  reactivation_entered_at: null,
  reactivation_last_sent_at: null,
  reactivation_entry_reason_code: null,
  refresh_session: null,
  commitment_refresh_last_prompted_at: null,
  pending_resolution_kind: null,
  pending_resolution_created_at: null,
  pending_resolution_expires_at: null,
  pending_resolution_payload: null,
  updated_at: null,
  started_at: null,
};

function baseTurnArgs(inboundRaw: string) {
  const pkt: NorthStarSmsContextPacket = {
    latestOpenQuestion: "Did you dictate one story today?",
    expectedReplySemantics: "accountability_check",
    effectiveAskText: "dictate one story",
    behaviorStatement: "dictate one story",
  };
  return {
    inboundRaw,
    timezone: "America/New_York",
    commitment,
    effectiveAsk: "dictate one story",
    northStarPacket: pkt,
    recentTranscriptLines: ["Coach: Did you dictate one story today?", `User: ${inboundRaw}`],
    expectedReplySemantics: "accountability_check" as const,
    latestOpenQuestion: pkt.latestOpenQuestion ?? null,
    todayCompleted: false,
    coachingMemory: null,
    recentEvents: [],
    gatedDecision: {
      mode: "use_ai_outcome" as const,
      final_event_type: "user_yes" as const,
      decision_reason: "test",
      confidence_used: 0.9,
      should_write_outcome_event: true,
      should_open_blocker_capture: false,
      reply_style: "normal_outcome" as const,
      overrode_deterministic: false,
    },
    deterministicEventType: "user_yes" as const,
  };
}

describe("understandV3SmsTurn — future and context are not completions", () => {
  it("classifies job interview context away from completion", async () => {
    const r = await understandV3SmsTurn(baseTurnArgs("Go to job interview"));
    expect(r.turnPurpose).toBe("life_context");
    expect(r.accountabilityEventCandidate).toBeNull();
    expect(r.shouldWriteOutcomeEvent).toBe(false);
  });

  it("classifies later/tomorrow as deferral or future plan", async () => {
    await expect(understandV3SmsTurn(baseTurnArgs("I'll do it later"))).resolves.toMatchObject({
      turnPurpose: "deferral",
    });
    await expect(understandV3SmsTurn(baseTurnArgs("I'll do it tomorrow"))).resolves.toMatchObject({
      turnPurpose: "future_plan",
    });
  });

  it("classifies let me think as thinking deferral", async () => {
    const r = await understandV3SmsTurn(baseTurnArgs("Let me think about it"));
    expect(r.turnPurpose).toBe("thinking_deferral");
  });
});

describe("generateV3DailyCheckIn — deterministic daily fallback", () => {
  it("does not paste raw behavior into Did you protect when OpenAI is unavailable", async () => {
    const prevKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const r = await generateV3DailyCheckIn({
        commitmentId: "c_test",
        effectiveAsk: "Use AI & dictate at least one story",
        behaviorStatement: "Use AI & dictate at least one story",
        priorOutcome: null,
        coachingMemory: null,
        serverStrategy: "standard_check",
        silenceTier: "none",
        blockerPreview: null,
        recentSmsContextBlock: null,
      });

      expect(r.openAiOk).toBe(false);
      expect(r.text).toBe("Did you dictate one story today?");
      expect(r.text.toLowerCase()).not.toContain("did you protect use");
    } finally {
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
    }
  });
});
