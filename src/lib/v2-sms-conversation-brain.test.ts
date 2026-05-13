import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  },
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import {
  buildConversationBrainPrompt,
  getConversationBrainConfidenceFloor,
  proposeNormalAccountabilityTurnControl,
} from "@/lib/v2-sms-conversation-brain";

describe("buildConversationBrainPrompt", () => {
  const baseArgs = {
    commitmentTitle: "Morning deep work",
    behaviorStatement: "90 minutes of focused building before noon.",
    effectiveCoachingAsk: "Did you protect 90 minutes of deep work before noon?",
    latestUserSms: "I missed it today — day ran away from me.",
    lastCoachSmsExact: "Did you protect deep work before noon? Tell me straight.",
    recentSmsTranscriptBlock: "Coach: Did you protect deep work...\nUser: Not today.",
    eventsNewestFirst: [
      {
        event_type: "check_sent",
        occurred_at: "2026-05-04T12:00:00Z",
        payload_json: {},
      },
    ],
    coachingMemory: null,
    identityAnchorPreview: "Steady builder",
    liveAccountabilityPromptStatus: "fresh",
    blockerPendingSummary: null,
    deterministicClassifierEventType: "user_partial",
    deterministicClassifierNormalizedHint: "unclear",
  };

  it("includes commitment title and behavior_statement", () => {
    const p = buildConversationBrainPrompt(baseArgs);
    expect(p).toContain("Morning deep work");
    expect(p).toContain("90 minutes of focused building before noon.");
  });

  it("includes recent SMS transcript block", () => {
    const p = buildConversationBrainPrompt(baseArgs);
    expect(p).toContain("Coach: Did you protect deep work");
  });

  it("includes exact last coach SMS when provided", () => {
    const p = buildConversationBrainPrompt(baseArgs);
    expect(p).toContain("Did you protect deep work before noon? Tell me straight.");
  });

  it("labels deterministic classifier as weak / non-authoritative", () => {
    const p = buildConversationBrainPrompt(baseArgs);
    expect(p).toMatch(/non-authoritative|WEAK/i);
    expect(p).toContain("Deterministic classifier");
    expect(p).toContain("user_partial");
  });

  it("adds authoritative scheduling constraint when user rejects a proposed time", () => {
    const p = buildConversationBrainPrompt({
      ...baseArgs,
      latestUserSms: "Can't I'll be at work tomorrow at 6pm",
      lastCoachSmsExact: "Let's plan for 6 PM tomorrow to make those calls after work.",
    });
    expect(p).toContain("Server scheduling constraint");
    expect(p).toContain("6 PM");
    expect(p).toMatch(/do not propose those same clock times again/i);
  });
});

describe("getConversationBrainConfidenceFloor", () => {
  afterEach(() => {
    delete process.env.V2_SMS_CONVERSATION_BRAIN_CONFIDENCE_FLOOR;
  });

  it("defaults to 0.55 when unset", () => {
    delete process.env.V2_SMS_CONVERSATION_BRAIN_CONFIDENCE_FLOOR;
    expect(getConversationBrainConfidenceFloor()).toBe(0.55);
  });

  it("reads numeric env", () => {
    process.env.V2_SMS_CONVERSATION_BRAIN_CONFIDENCE_FLOOR = "0.72";
    expect(getConversationBrainConfidenceFloor()).toBe(0.72);
  });

  it("clamps into 0..1", () => {
    process.env.V2_SMS_CONVERSATION_BRAIN_CONFIDENCE_FLOOR = "2";
    expect(getConversationBrainConfidenceFloor()).toBe(1);
  });
});

describe("proposeNormalAccountabilityTurnControl", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    mockCreate.mockReset();
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  const minimalArgs = {
    commitmentTitle: "t",
    behaviorStatement: "b",
    effectiveCoachingAsk: "ask",
    latestUserSms: "I missed it today.",
    lastCoachSmsExact: null,
    recentSmsTranscriptBlock: null,
    eventsNewestFirst: [],
    coachingMemory: null,
    identityAnchorPreview: null,
    liveAccountabilityPromptStatus: null,
    blockerPendingSummary: null,
    deterministicClassifierEventType: "user_partial",
    deterministicClassifierNormalizedHint: "unclear",
  };

  it("returns user_no proposal when the model returns valid JSON", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              schema_version: 1,
              turn_kind: "accountability_reply",
              interpreted_user_meaning: "Miss",
              accountability_outcome_candidate: "user_no",
              outcome_confidence: 0.88,
              should_write_outcome_event: true,
              proposed_event_type: "user_no",
              blocker_signal: false,
              blocker_text_if_any: null,
              needs_clarification: false,
              clarification_reason: null,
              repeated_clarification_risk: false,
              reply_strategy: "coach_forward",
              final_sms_draft: "Got it — honest miss. What pulled you off today?",
              safety_notes: [],
              short_reason_for_logs: "miss",
            }),
          },
        },
      ],
    });

    const r = await proposeNormalAccountabilityTurnControl(minimalArgs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposal.proposed_event_type).toBe("user_no");
    }
  });

  it("returns a safe failure object when OpenAI throws", async () => {
    mockCreate.mockRejectedValue(new Error("network down"));

    const r = await proposeNormalAccountabilityTurnControl(minimalArgs);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/openai/);
    }
  });
});
