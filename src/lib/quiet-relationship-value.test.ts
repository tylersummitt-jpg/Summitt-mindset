import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));
import {
  assembleMorningBriefInterpreterInputV1,
  type AssembleMorningBriefInterpreterInputArgs,
} from "@/lib/morning-tto-brief-canonical-input-v1";
import {
  MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT,
  buildLowConfidenceUnknownBriefFromCanonical,
  parseAndMergeMorningBriefInterpreterResponse,
} from "@/lib/morning-tto-brief-interpreter-v1";
import { parseMorningCoachingBriefV1 } from "@/lib/morning-tto-coaching-brief-v1";
import { MORNING_TTO_SYSTEM_PROMPT, writeMorningTtoBody } from "@/lib/morning-tto-writer";
import { WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT } from "@/lib/weekly-tto-brief-interpreter";
import { ONBOARDING_IDENTITY_ANCHOR_SOURCE } from "@/lib/v2-identity-anchor-validation";
import type { MorningCoachingBriefV1 } from "@/lib/morning-tto-coaching-brief-v1";

const createMock = vi.hoisted(() => vi.fn());

vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: createMock } };
    constructor() {}
  }
  return { default: OpenAI };
});

function assembleOrThrow(overrides: Partial<AssembleMorningBriefInterpreterInputArgs> = {}) {
  const result = assembleMorningBriefInterpreterInputV1({
    timezone: "America/New_York",
    localDate: "2026-08-07",
    localWeekday: "Friday",
    daysSinceLastUserResponse: 1,
    neverReplied: false,
    recentUnansweredOutboundCount: 0,
    canonicalGoalText: "Dictate one story before noon",
    pendingGoalChange: null,
    identityAnchorText: "I am an entrepreneur and a present father",
    identitySource: ONBOARDING_IDENTITY_ANCHOR_SOURCE,
    importantPeople: [],
    lifeContextProfile: {},
    latestOutcome: null,
    latestOutcomeAt: null,
    latestOutcomeMessage: null,
    matchingOutcomeCount: 0,
    hasVerifiedProofMetadata: false,
    threadMemoryHint: null,
    exactThreadMessages: [],
    omittedOlderTurnCount: 0,
    ...overrides,
  });
  if ("ok" in result) throw new Error(result.error);
  return result;
}

function sendBrief(overrides: Partial<MorningCoachingBriefV1> = {}): MorningCoachingBriefV1 {
  return {
    version: "morning_coaching_brief_v1",
    confidence: "medium",
    human_situation: {
      most_alive: "User is on a known 2-week Europe trip",
      direct_question_or_need: null,
      relevant_life_event: "2-week Europe trip",
      context_use: "relevant",
      identity_use: "background",
      person_use: "do_not_force",
      selected_person: null,
      selected_person_reason: null,
    },
    truth_and_evidence: {
      latest_user_truth: "Heading to Europe for two weeks",
      outcome: "no_recent_evidence",
      evidence_note: "unknown",
      evidence_strength: "none",
      consistency_supported: false,
      proof_claims_allowed: {
        completion: false,
        miss: false,
        partial: false,
        proof: false,
      },
    },
    conversation_continuity: {
      already_acknowledged: [],
      answered_question: null,
      open_loop: "I'll tell you when I get back",
      stale_or_exhausted_topics: [],
      do_not_repeat: [],
    },
    goal_role_today: {
      canonical_goal: "Dictate one story before noon",
      pending_goal: null,
      goal_alignment: "unknown",
      role: "background",
      note: "not the live subject",
    },
    coaching_direction: {
      primary_move: "continue_conversation",
      question_policy: "one_useful_question",
      action_guidance: "none",
      pressure: "normal",
      proactive_decision: "send",
    },
    boundaries: {
      claims_to_avoid: [],
      topics_not_to_force: [],
      unsupported_capabilities: [],
      goal_authority_boundaries: [],
      identity_people_boundaries: [],
      coach_history_is_not_style: "Prior coach messages are history.",
    },
    ...overrides,
  };
}

describe("quiet relationship value — prompt law + clamp + writer skip", () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("shared M/E prompt expands options at 10+ days; does not force passive mode", () => {
    const p = MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT;
    expect(p).toContain("QUIET RELATIONSHIP VALUE");
    expect(p).toContain("additional proactive options become available");
    expect(p).toContain("does not force a passive posture");
    expect(p).toContain("glad this text appeared on their phone");
    expect(p).toContain("known trip is not the same as someone who has never replied");
    expect(p).toContain("domains for useful wisdom, not evidence of current circumstances");
    expect(p).toContain("do not suppress a genuinely useful conversational question");
    expect(p).toContain("Do not fabricate quotes, studies, statistics");
    expect(p).toContain("When mechanical.quiet_relationship_eligible is not true");
    expect(p).toContain("When mechanical.message_required_today is true: intentional_space is unavailable");
    expect(p).not.toMatch(/sms-silence-cadence-v1|silence_day|V3 daily relationship lane/i);
    expect(p).not.toContain("send_reentry");
    expect(p).not.toContain("standalone_value_angle");
  });

  it("writer SEND contract does not re-decide send/space and still allows one useful question", () => {
    expect(MORNING_TTO_SYSTEM_PROMPT).toContain("The interpreter already chose SEND");
    expect(MORNING_TTO_SYSTEM_PROMPT).toContain("If it is one_useful_question, you may ask that one question");
    expect(MORNING_TTO_SYSTEM_PROMPT).toContain("Identity is a domain for wisdom, not evidence of today");
    expect(MORNING_TTO_SYSTEM_PROMPT).toContain("Do not fabricate quotes, studies, statistics");
    expect(MORNING_TTO_SYSTEM_PROMPT).not.toMatch(/never ask after 10 days/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toContain(
      "Do not promise, announce, or imply future messaging cadence or future system silence unless that future behavior is actually represented in authoritative system state"
    );
    expect(MORNING_TTO_SYSTEM_PROMPT).toContain("Write only this Coach turn");
    expect(MORNING_TTO_SYSTEM_PROMPT).toContain(
      "You cannot claim future system messaging behavior the system does not actually control"
    );
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/step back from checking in/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/give this thread space/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/stop texting for a while/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/leave them alone/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/check back next week/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/stated future day/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).not.toMatch(/replace body if .*step back/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).not.toMatch(/\/I.ll give this thread some breathing room\//);
  });

  it("writer quality law forbids unearned future cadence/silence promises (prompt law, not rewrite)", () => {
    const p = MORNING_TTO_SYSTEM_PROMPT;
    expect(p).toContain("future messaging cadence");
    expect(p).toContain("future system silence");
    expect(p).toContain("authoritative system state");
    expect(p).toContain("Write only this Coach turn");
    expect(p).not.toMatch(/new RegExp|rewriteBody|replace\(.*step back/i);
    const knownRegressions = [
      "I'm going to step back from the frequent check-ins",
      "I'm going to give this thread some breathing room",
    ];
    for (const _draft of knownRegressions) {
      expect(p).toMatch(/step back from checking in/i);
      expect(p).toMatch(/give this thread space/i);
    }
  });

  it("Weekly prompt is SEND-only and does not add quiet-relationship complexity", () => {
    expect(WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT).toContain(
      "coaching_direction.proactive_decision must be send"
    );
    expect(WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT).toContain("Weekly does not use intentional_space");
    expect(WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT).not.toContain("QUIET RELATIONSHIP VALUE");
  });

  it("parser missing/invalid proactive_decision defaults to send, never SPACE", () => {
    const missing = sendBrief();
    const raw = JSON.parse(JSON.stringify(missing)) as Record<string, unknown>;
    (raw.coaching_direction as Record<string, unknown>).proactive_decision = undefined;
    delete (raw.coaching_direction as Record<string, unknown>).proactive_decision;
    expect(parseMorningCoachingBriefV1(raw)?.coaching_direction.proactive_decision).toBe("send");
    (raw.coaching_direction as Record<string, unknown>).proactive_decision = "space";
    expect(parseMorningCoachingBriefV1(raw)?.coaching_direction.proactive_decision).toBe("send");
  });

  it("active-user merge clamps SPACE to SEND; 10-day quiet may keep SPACE or SEND", () => {
    const spaceDraft = sendBrief({
      coaching_direction: {
        primary_move: "offer_perspective",
        question_policy: "none",
        action_guidance: "none",
        pressure: "low",
        proactive_decision: "intentional_space",
      },
    });

    const active = parseAndMergeMorningBriefInterpreterResponse({
      input: assembleOrThrow({
        daysSinceLastUserResponse: 9,
        quietRelationshipEligible: false,
        messageRequiredToday: false,
      }),
      raw: JSON.stringify(spaceDraft),
    });
    expect(active?.coaching_direction.proactive_decision).toBe("send");

    const quietSpace = parseAndMergeMorningBriefInterpreterResponse({
      input: assembleOrThrow({
        daysSinceLastUserResponse: 10,
        quietRelationshipEligible: true,
        messageRequiredToday: false,
      }),
      raw: JSON.stringify(spaceDraft),
    });
    expect(quietSpace?.coaching_direction.proactive_decision).toBe("intentional_space");

    const quietSend = parseAndMergeMorningBriefInterpreterResponse({
      input: assembleOrThrow({
        daysSinceLastUserResponse: 14,
        quietRelationshipEligible: true,
        messageRequiredToday: false,
      }),
      raw: JSON.stringify(sendBrief()),
    });
    expect(quietSend?.coaching_direction.proactive_decision).toBe("send");
    expect(quietSend?.coaching_direction.question_policy).toBe("one_useful_question");
    expect(quietSend?.coaching_direction.primary_move).toBe("continue_conversation");
  });

  it("required-touch clamps SPACE to SEND without inventing copy", () => {
    const merged = parseAndMergeMorningBriefInterpreterResponse({
      input: assembleOrThrow({
        daysSinceLastUserResponse: 14,
        quietRelationshipEligible: true,
        messageRequiredToday: true,
      }),
      raw: JSON.stringify(
        sendBrief({
          coaching_direction: {
            primary_move: "offer_perspective",
            question_policy: "none",
            action_guidance: "none",
            pressure: "low",
            proactive_decision: "intentional_space",
          },
        })
      ),
    });
    expect(merged?.coaching_direction.proactive_decision).toBe("send");
    expect(JSON.stringify(merged)).not.toMatch(/Just checking in/i);
  });

  it("fail-soft interpreter brief is SEND, never SPACE", () => {
    const brief = buildLowConfidenceUnknownBriefFromCanonical(
      assembleOrThrow({
        daysSinceLastUserResponse: 60,
        quietRelationshipEligible: true,
        messageRequiredToday: false,
      })
    );
    expect(brief.coaching_direction.proactive_decision).toBe("send");
  });

  it("previously engaged vacation reentry remains a legal SEND with one useful question", () => {
    const merged = parseAndMergeMorningBriefInterpreterResponse({
      input: assembleOrThrow({
        daysSinceLastUserResponse: 14,
        neverReplied: false,
        recentUnansweredOutboundCount: 4,
        quietRelationshipEligible: true,
        messageRequiredToday: false,
        exactThreadMessages: [
          {
            sender: "user",
            sent_at_utc: "2026-07-24T12:00:00.000Z",
            sent_at_local: "2026-07-24 08:00",
            local_day_key: "2026-07-24",
            local_weekday: "Friday",
            day_relation_to_message: "older",
            body: "Heading to Europe for two weeks. I'll tell you when I get back.",
          },
        ],
      }),
      raw: JSON.stringify(sendBrief()),
    });
    expect(merged?.coaching_direction.proactive_decision).toBe("send");
    expect(merged?.coaching_direction.question_policy).toBe("one_useful_question");
    expect(merged?.conversation_continuity.open_loop).toMatch(/get back/i);
    expect(MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT).toContain("travel/vacation");
    expect(MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT).toContain(
      "normal conversational coaching or one useful reentry question may be the best move"
    );
  });

  it("writer is not called for SPACE (no OpenAI)", async () => {
    const result = await writeMorningTtoBody({
      packet: {
        version: "morning_relationship_v1",
        message_for: {
          timezone: "America/New_York",
          local_date: "2026-08-07",
          local_weekday: "Friday",
          daypart: "morning",
        },
        last_user_response: {
          at_utc: null,
          at_local: null,
          days_since: 60,
          never_replied: true,
        },
        preferred_name: "Tyler",
        current_goal: { text: "Walk" },
        current_identity: { text: null },
        personal_context: [],
        hard_state: { pending_goal_change: null },
        historical_evidence: [],
        exact_thread: {
          window_days: 21,
          max_messages: 30,
          omitted_older_turn_count: 0,
          messages: [],
        },
      },
      morningCoachingBrief: sendBrief({
        coaching_direction: {
          primary_move: "offer_perspective",
          question_policy: "none",
          action_guidance: "none",
          pressure: "low",
          proactive_decision: "intentional_space",
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("intentional_space");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("does not revive old silence cadence / V3 lane / slot coaching in this feature's production files", () => {
    const files = [
      "src/lib/sms-proactive-relationship-touch.ts",
      "src/lib/morning-tto-brief-interpreter-v1.ts",
      "src/lib/morning-tto-writer.ts",
      "src/lib/tyler-text-overview-generate.ts",
      "src/lib/weekly-tto-brief-interpreter.ts",
    ];
    for (const rel of files) {
      const src = readFileSync(path.join(process.cwd(), rel), "utf8");
      expect(src).not.toMatch(/from ["']@\/lib\/sms-silence-cadence-v1["']/);
      expect(src).not.toMatch(/from ["']@\/lib\/v3-daily-relationship-lane["']/);
      expect(src).not.toMatch(/from ["']@\/lib\/slot-coaching-context/);
      expect(src).not.toMatch(/SILENCE_CADENCE_ROUTE_CARDS/);
    }
  });

  it("Weekly generate never skips writer for SPACE", () => {
    const weekly = readFileSync(
      path.join(process.cwd(), "src/lib/tyler-text-overview-weekly-generate.ts"),
      "utf8"
    );
    expect(weekly).not.toContain("isIntentionalSpaceDecision");
    expect(weekly).not.toContain("MACHINE_NO_SEND_REASON_INTENTIONAL_SPACE");
    expect(weekly).toContain("writeWeeklyTtoBody");
  });

  it("send path does not read required-touch as an override of Tyler blank or delivery prefs", () => {
    const send = readFileSync(
      path.join(process.cwd(), "src/lib/tyler-text-overview-send.ts"),
      "utf8"
    );
    expect(send).toContain("tto_blank_morning_body");
    expect(send).not.toContain("message_required_today");
    expect(send).not.toContain("intentional_space");
  });
});
