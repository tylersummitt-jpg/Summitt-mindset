import { beforeEach, describe, expect, it, vi } from "vitest";

const { openAiCreate } = vi.hoisted(() => ({
  openAiCreate: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: openAiCreate,
      },
    };
  },
}));

import {
  buildWinRecognitionMessages,
  buildWinRecognitionSystemPrompt,
  buildWinRecognitionUserPrompt,
  emptyWinRecognitionResult,
  parseAndValidateWinRecognitionResult,
  parseWinRecognitionJsonString,
  recognizeWinsFromInboundV1,
  shouldRunWinRecognitionForInbound,
  toWinRecognitionFactsForV3,
  WIN_RECOGNITION_VERSION,
  type WinCandidateV1,
} from "@/lib/openai-win-recognition-v1";

function validCandidate(overrides: Partial<WinCandidateV1> = {}): WinCandidateV1 {
  return {
    ordinal: 0,
    grounded_action: "Apologized to my wife after the argument",
    why_meaningful: "Took responsibility and repaired the relationship",
    suggested_title: "Relationship repair",
    suggested_body: "You owned the miss and apologized — that took humility.",
    evidence_quote: "I finally apologized to my wife",
    relationship_type: "whole_life",
    recognition_mode: "coach_recognized",
    user_expressed_pride: false,
    identity_related: false,
    sensitivity_caution: false,
    celebration_appropriate: true,
    model_confidence: 0.86,
    ...overrides,
  };
}

function validPayload(wins: WinCandidateV1[], hasWin = true) {
  return {
    version: WIN_RECOGNITION_VERSION,
    has_win: hasWin,
    wins: hasWin ? wins : [],
  };
}

const INBOUND =
  "I didn't wake up at 6, but I finally apologized to my wife. Later I also helped my neighbor carry groceries.";

describe("openai-win-recognition-v1 parse/validate", () => {
  it("accepts has_win=false with zero candidates", () => {
    const r = parseAndValidateWinRecognitionResult(validPayload([], false), INBOUND);
    expect(r).toEqual(emptyWinRecognitionResult());
  });

  it("accepts one valid candidate", () => {
    const r = parseAndValidateWinRecognitionResult(
      validPayload([validCandidate({ evidence_quote: "I finally apologized to my wife" })]),
      INBOUND
    );
    expect(r?.has_win).toBe(true);
    expect(r?.wins).toHaveLength(1);
    expect(r?.wins[0]?.ordinal).toBe(0);
  });

  it("accepts two valid candidates", () => {
    const r = parseAndValidateWinRecognitionResult(
      validPayload([
        validCandidate({ evidence_quote: "I finally apologized to my wife" }),
        validCandidate({
          ordinal: 1,
          grounded_action: "Helped neighbor carry groceries",
          suggested_title: "Neighbor help",
          suggested_body: "You showed up for your neighbor.",
          evidence_quote: "helped my neighbor carry groceries",
          relationship_type: "whole_life",
        }),
      ]),
      INBOUND
    );
    expect(r?.wins).toHaveLength(2);
    expect(r?.wins.map((w) => w.ordinal)).toEqual([0, 1]);
  });

  it("rejects more than two candidates", () => {
    const r = parseAndValidateWinRecognitionResult(
      validPayload([
        validCandidate({ evidence_quote: "I finally apologized to my wife" }),
        validCandidate({
          ordinal: 1,
          evidence_quote: "helped my neighbor carry groceries",
        }),
        validCandidate({ ordinal: 0 as 0 | 1, evidence_quote: "I didn't wake up at 6" }),
      ]),
      INBOUND
    );
    expect(r).toBeNull();
  });

  it("rejects duplicate ordinals", () => {
    const r = parseAndValidateWinRecognitionResult(
      validPayload([
        validCandidate({ evidence_quote: "I finally apologized to my wife" }),
        validCandidate({
          ordinal: 0,
          evidence_quote: "helped my neighbor carry groceries",
        }),
      ]),
      INBOUND
    );
    expect(r).toBeNull();
  });

  it("rejects blank grounded action / title / body", () => {
    expect(
      parseAndValidateWinRecognitionResult(
        validPayload([validCandidate({ grounded_action: "   ", evidence_quote: "I finally apologized to my wife" })]),
        INBOUND
      )
    ).toBeNull();
    expect(
      parseAndValidateWinRecognitionResult(
        validPayload([validCandidate({ suggested_title: "", evidence_quote: "I finally apologized to my wife" })]),
        INBOUND
      )
    ).toBeNull();
    expect(
      parseAndValidateWinRecognitionResult(
        validPayload([validCandidate({ suggested_body: " ", evidence_quote: "I finally apologized to my wife" })]),
        INBOUND
      )
    ).toBeNull();
  });

  it("rejects invalid enum", () => {
    const payload = validPayload([
      {
        ...validCandidate({ evidence_quote: "I finally apologized to my wife" }),
        relationship_type: "goalish" as never,
      },
    ]);
    expect(parseAndValidateWinRecognitionResult(payload, INBOUND)).toBeNull();
  });

  it("clamps confidence into [0,1]", () => {
    const r = parseAndValidateWinRecognitionResult(
      validPayload([
        validCandidate({
          evidence_quote: "I finally apologized to my wife",
          model_confidence: 1.7,
        }),
      ]),
      INBOUND
    );
    expect(r?.wins[0]?.model_confidence).toBe(1);
  });

  it("accepts exact evidence substring and rejects invented quote", () => {
    expect(
      parseAndValidateWinRecognitionResult(
        validPayload([validCandidate({ evidence_quote: "I finally apologized to my wife" })]),
        INBOUND
      )?.wins[0]?.evidence_quote
    ).toBe("I finally apologized to my wife");
    expect(
      parseAndValidateWinRecognitionResult(
        validPayload([validCandidate({ evidence_quote: "I climbed Everest yesterday" })]),
        INBOUND
      )
    ).toBeNull();
  });

  it("omits evidence quote when sensitivity_caution is true", () => {
    const r = parseAndValidateWinRecognitionResult(
      validPayload([
        validCandidate({
          evidence_quote: "I finally apologized to my wife",
          sensitivity_caution: true,
        }),
      ]),
      INBOUND
    );
    expect(r?.wins[0]?.evidence_quote).toBeNull();
    expect(r?.wins[0]?.sensitivity_caution).toBe(true);
  });

  it("malformed JSON string becomes null (caller treats as no-Win)", () => {
    expect(parseWinRecognitionJsonString("{not-json", INBOUND)).toBeNull();
    expect(parseWinRecognitionJsonString('{"version":"nope","has_win":false,"wins":[]}', INBOUND)).toBeNull();
  });

  it("has_win true with empty wins rejected", () => {
    expect(parseAndValidateWinRecognitionResult(validPayload([], true), INBOUND)).toBeNull();
  });

  it("has_win false with leftover wins rejected", () => {
    expect(
      parseAndValidateWinRecognitionResult(
        { version: WIN_RECOGNITION_VERSION, has_win: false, wins: [validCandidate()] },
        INBOUND
      )
    ).toBeNull();
  });
});

describe("openai-win-recognition-v1 eligibility + facts", () => {
  it("skips empty / tapback / safety / compliance / system noise", () => {
    expect(shouldRunWinRecognitionForInbound({ inboundBody: "" }).run).toBe(false);
    expect(shouldRunWinRecognitionForInbound({ inboundBody: "yes", isTapback: true }).reason).toBe(
      "tapback"
    );
    expect(
      shouldRunWinRecognitionForInbound({ inboundBody: "help", isSafetyOrCrisisOwned: true }).reason
    ).toBe("safety_or_crisis");
    expect(
      shouldRunWinRecognitionForInbound({ inboundBody: "STOP", isComplianceOrStop: true }).reason
    ).toBe("compliance_or_stop");
    expect(
      shouldRunWinRecognitionForInbound({ inboundBody: "x", isSystemNoise: true }).reason
    ).toBe("system_noise");
    expect(shouldRunWinRecognitionForInbound({ inboundBody: "I did it" }).run).toBe(true);
  });

  it("facts always keep may_claim_saved false", () => {
    const facts = toWinRecognitionFactsForV3(
      {
        version: WIN_RECOGNITION_VERSION,
        has_win: true,
        wins: [validCandidate()],
      },
      true
    );
    expect(facts.may_claim_saved).toBe(false);
    expect(facts.durable_persist_succeeded).toBe(true);
  });

  it("prompt teaches OpenAI authority and no storage claims", () => {
    const system = buildWinRecognitionSystemPrompt();
    expect(system).toMatch(/OpenAI owns semantic judgment/i);
    expect(system).toMatch(/bare "yes"/i);
    expect(system).not.toMatch(/keyword|regex|user_yes automatically/i);
    expect(system).toMatch(/Do NOT write: "Win detected"/i);
    const user = buildWinRecognitionUserPrompt({
      inboundMessage: "Yes",
      priorOutboundOrOpenQuestion: "Did you complete your two walks?",
      recentExactThreadExcerpt: "coach: walks? | user: yes",
      currentGoal: "Two 30-minute walks",
      identityStatement: "I am consistent",
      userFirstName: "Tyler",
      pendingRouteSummary: null,
      resolvedAccountabilityResult: "final_event_type=user_yes",
      safetyOrUrgencyOwned: false,
      routeOwner: "normal_inbound_reply",
      recentWinSummary: null,
    });
    expect(user).toContain("CURRENT_INBOUND_MESSAGE");
    expect(user).toContain("resolved_accountability_result");
    expect(buildWinRecognitionMessages({
      inboundMessage: "Yes",
      priorOutboundOrOpenQuestion: null,
      recentExactThreadExcerpt: null,
      currentGoal: null,
      identityStatement: null,
      userFirstName: null,
      pendingRouteSummary: null,
      resolvedAccountabilityResult: null,
      safetyOrUrgencyOwned: false,
      routeOwner: null,
      recentWinSummary: null,
    })).toHaveLength(2);
  });
});

describe("recognizeWinsFromInboundV1 OpenAI call", () => {
  beforeEach(() => {
    openAiCreate.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("returns validated wins from model JSON", async () => {
    openAiCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify(
              validPayload([validCandidate({ evidence_quote: "I finally apologized to my wife" })])
            ),
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    });
    const { result, meta } = await recognizeWinsFromInboundV1({
      inboundMessage: INBOUND,
      priorOutboundOrOpenQuestion: "Did you wake up at 6?",
      recentExactThreadExcerpt: null,
      currentGoal: "Wake at 6",
      identityStatement: null,
      userFirstName: "Tyler",
      pendingRouteSummary: null,
      resolvedAccountabilityResult: "final_event_type=user_no",
      safetyOrUrgencyOwned: false,
      routeOwner: "normal_inbound_reply",
      recentWinSummary: null,
    });
    expect(meta.parse_ok).toBe(true);
    expect(result.has_win).toBe(true);
    expect(result.wins[0]?.grounded_action).toMatch(/Apologized/);
  });

  it("malformed model output becomes no-Win", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    openAiCreate
      .mockResolvedValueOnce({
        choices: [{ message: { content: "not-json" }, finish_reason: "stop" }],
        usage: {},
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "still-bad" }, finish_reason: "stop" }],
        usage: {},
      });
    const { result, meta } = await recognizeWinsFromInboundV1({
      inboundMessage: INBOUND,
      priorOutboundOrOpenQuestion: null,
      recentExactThreadExcerpt: null,
      currentGoal: null,
      identityStatement: null,
      userFirstName: null,
      pendingRouteSummary: null,
      resolvedAccountabilityResult: "user_yes",
      safetyOrUrgencyOwned: false,
      routeOwner: "normal_inbound_reply",
      recentWinSummary: null,
    });
    expect(result.has_win).toBe(false);
    expect(meta.parse_ok).toBe(false);
    expect(openAiCreate).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      "[win_recognition_parse_fail]",
      expect.objectContaining({ schema_version: WIN_RECOGNITION_VERSION })
    );
    expect(warn).not.toHaveBeenCalledWith(
      "[win_recognition_openai_error]",
      expect.anything()
    );
    warn.mockRestore();
  });

  it("API request rejection logs openai_error not parse_fail and returns no-Win", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    openAiCreate.mockRejectedValue(
      new Error("400 Unrecognized request argument supplied: signal")
    );
    const { result, meta } = await recognizeWinsFromInboundV1({
      inboundMessage: INBOUND,
      priorOutboundOrOpenQuestion: null,
      recentExactThreadExcerpt: null,
      currentGoal: null,
      identityStatement: null,
      userFirstName: null,
      pendingRouteSummary: null,
      resolvedAccountabilityResult: null,
      safetyOrUrgencyOwned: false,
      routeOwner: "normal_inbound_reply",
      recentWinSummary: null,
    });
    expect(result.has_win).toBe(false);
    expect(meta.parse_ok).toBe(false);
    expect(meta.timed_out).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[win_recognition_openai_error]",
      expect.objectContaining({
        schema_version: WIN_RECOGNITION_VERSION,
        error: expect.stringContaining("Unrecognized request argument"),
      })
    );
    expect(warn).not.toHaveBeenCalledWith(
      "[win_recognition_parse_fail]",
      expect.anything()
    );
    warn.mockRestore();
  });

  it("passes AbortSignal via RequestOptions, not request body", async () => {
    openAiCreate.mockResolvedValue({
      choices: [
        {
          message: { content: JSON.stringify(validPayload([], false)) },
          finish_reason: "stop",
        },
      ],
      usage: {},
    });
    await recognizeWinsFromInboundV1({
      inboundMessage: INBOUND,
      priorOutboundOrOpenQuestion: null,
      recentExactThreadExcerpt: null,
      currentGoal: null,
      identityStatement: null,
      userFirstName: null,
      pendingRouteSummary: null,
      resolvedAccountabilityResult: null,
      safetyOrUrgencyOwned: false,
      routeOwner: "normal_inbound_reply",
      recentWinSummary: null,
    });
    expect(openAiCreate).toHaveBeenCalled();
    const [body, options] = openAiCreate.mock.calls[0] ?? [];
    expect(body).not.toHaveProperty("signal");
    expect(options).toEqual(
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("user_yes accountability context does not manufacture a Win when OpenAI returns none", async () => {
    openAiCreate.mockResolvedValue({
      choices: [
        {
          message: { content: JSON.stringify(validPayload([], false)) },
          finish_reason: "stop",
        },
      ],
      usage: {},
    });
    const { result } = await recognizeWinsFromInboundV1({
      inboundMessage: "yes",
      priorOutboundOrOpenQuestion: "How are you feeling today?",
      recentExactThreadExcerpt: null,
      currentGoal: "Two walks",
      identityStatement: null,
      userFirstName: null,
      pendingRouteSummary: null,
      resolvedAccountabilityResult: "final_event_type=user_yes",
      safetyOrUrgencyOwned: false,
      routeOwner: "normal_inbound_reply",
      recentWinSummary: null,
    });
    expect(result.has_win).toBe(false);
    expect(result.wins).toEqual([]);
  });

  it("timeout / abort becomes no-Win", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    openAiCreate.mockImplementation(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });
    const { result, meta } = await recognizeWinsFromInboundV1({
      inboundMessage: INBOUND,
      priorOutboundOrOpenQuestion: null,
      recentExactThreadExcerpt: null,
      currentGoal: null,
      identityStatement: null,
      userFirstName: null,
      pendingRouteSummary: null,
      resolvedAccountabilityResult: null,
      safetyOrUrgencyOwned: false,
      routeOwner: "normal_inbound_reply",
      recentWinSummary: null,
    });
    expect(result.has_win).toBe(false);
    expect(meta.timed_out).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      "[win_recognition_timeout]",
      expect.objectContaining({ schema_version: WIN_RECOGNITION_VERSION })
    );
    expect(warn).not.toHaveBeenCalledWith(
      "[win_recognition_openai_error]",
      expect.anything()
    );
    expect(warn).not.toHaveBeenCalledWith(
      "[win_recognition_parse_fail]",
      expect.anything()
    );
    warn.mockRestore();
  });

  it("safety-owned input skips OpenAI", async () => {
    const { result, meta } = await recognizeWinsFromInboundV1({
      inboundMessage: "I want to hurt myself",
      priorOutboundOrOpenQuestion: null,
      recentExactThreadExcerpt: null,
      currentGoal: null,
      identityStatement: null,
      userFirstName: null,
      pendingRouteSummary: null,
      resolvedAccountabilityResult: null,
      safetyOrUrgencyOwned: true,
      routeOwner: "safety",
      recentWinSummary: null,
    });
    expect(openAiCreate).not.toHaveBeenCalled();
    expect(meta.skipped).toBe(true);
    expect(result.has_win).toBe(false);
  });
});

describe("prompt fixture coverage (mocked outputs)", () => {
  beforeEach(() => {
    openAiCreate.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  async function runWithMock(inbound: string, payload: unknown) {
    openAiCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }],
      usage: {},
    });
    return recognizeWinsFromInboundV1({
      inboundMessage: inbound,
      priorOutboundOrOpenQuestion: "Did you finish today's commitment?",
      recentExactThreadExcerpt: "coach: check | user: prior",
      currentGoal: "Wake at 6am",
      identityStatement: "I keep promises",
      userFirstName: "Sam",
      pendingRouteSummary: null,
      resolvedAccountabilityResult: null,
      safetyOrUrgencyOwned: false,
      routeOwner: "normal_inbound_reply",
      recentWinSummary: null,
    });
  }

  it("goal completion win", async () => {
    const inbound = "I woke up at 6 and got it done.";
    const { result } = await runWithMock(
      inbound,
      validPayload([
        validCandidate({
          grounded_action: "Woke up at 6 as committed",
          relationship_type: "goal",
          evidence_quote: "I woke up at 6 and got it done",
        }),
      ])
    );
    expect(result.wins[0]?.relationship_type).toBe("goal");
  });

  it("bare yes grounded by prior question can be a win when model says so", async () => {
    const { result } = await runWithMock(
      "yes",
      validPayload([
        validCandidate({
          grounded_action: "Completed the two walks",
          evidence_quote: "yes",
          relationship_type: "goal",
          recognition_mode: "coach_recognized",
        }),
      ])
    );
    expect(result.has_win).toBe(true);
  });

  it("future intention returns no win when model returns none", async () => {
    const { result } = await runWithMock(
      "I'm going to apologize tomorrow",
      validPayload([], false)
    );
    expect(result.has_win).toBe(false);
  });

  it("miss plus apology can return one win", async () => {
    const inbound = "Missed the 6am alarm, but I apologized to my wife.";
    const { result } = await runWithMock(
      inbound,
      validPayload([
        validCandidate({
          grounded_action: "Apologized to wife",
          evidence_quote: "I apologized to my wife",
          relationship_type: "whole_life",
        }),
      ])
    );
    expect(result.has_win).toBe(true);
    expect(result.wins).toHaveLength(1);
  });

  it("two distinct actions", async () => {
    const inbound = "Finished both walks and also called Mom to apologize.";
    const { result } = await runWithMock(
      inbound,
      validPayload([
        validCandidate({
          grounded_action: "Finished both walks",
          evidence_quote: "Finished both walks",
          relationship_type: "goal",
        }),
        validCandidate({
          ordinal: 1,
          grounded_action: "Called Mom to apologize",
          suggested_title: "Called Mom",
          suggested_body: "You repaired with Mom.",
          evidence_quote: "called Mom to apologize",
          relationship_type: "whole_life",
        }),
      ])
    );
    expect(result.wins).toHaveLength(2);
  });

  it("sensitive material omits quote after validation", async () => {
    const inbound = "I told my therapist the hard truth about my drinking.";
    const { result } = await runWithMock(
      inbound,
      validPayload([
        validCandidate({
          grounded_action: "Told therapist a hard truth",
          evidence_quote: "I told my therapist the hard truth about my drinking",
          sensitivity_caution: true,
        }),
      ])
    );
    expect(result.wins[0]?.sensitivity_caution).toBe(true);
    expect(result.wins[0]?.evidence_quote).toBeNull();
  });
});
