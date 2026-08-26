/**
 * Unresolved coaching-focus choice — prompt law + merge regressions.
 * Interpreter-only. No writer/inbound/schema/state changes.
 */
import { readFileSync } from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

const loadMorningBriefCanonicalExtrasV1 = vi.hoisted(() => vi.fn());

vi.mock("@/lib/morning-tto-brief-canonical-load-v1", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/morning-tto-brief-canonical-load-v1")>();
  return {
    ...actual,
    loadMorningBriefCanonicalExtrasV1,
  };
});

import {
  assembleMorningBriefInterpreterInputV1,
  type AssembleMorningBriefInterpreterInputArgs,
  type MorningBriefExactThreadMessage,
} from "@/lib/morning-tto-brief-canonical-input-v1";
import {
  MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT,
  parseAndMergeMorningBriefInterpreterResponse,
} from "@/lib/morning-tto-brief-interpreter-v1";
import { MORNING_TTO_SYSTEM_PROMPT } from "@/lib/morning-tto-writer";
import {
  MORNING_COACHING_BRIEF_VERSION,
  type MorningCoachingBriefV1,
} from "@/lib/morning-tto-coaching-brief-v1";
import { ONBOARDING_IDENTITY_ANCHOR_SOURCE } from "@/lib/v2-identity-anchor-validation";
import {
  assembleWeeklyBriefInterpreterInputFromPacket,
  runWeeklyBriefInterpreterV1,
  WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT,
} from "@/lib/weekly-tto-brief-interpreter";
import type { WeeklyRelationshipPacket } from "@/lib/weekly-tto-relationship-packet";

const RACHAEL_GOAL =
  "I will give my child a calm good-morning greeting before screens or rushing.";
const RACHAEL_FOCUS_CHOICE =
  'Coach Pat here... just brainstorming since I haven\'t heard from you ... do you want to change your goal? Or should I keep checking in about the Good Morning goal/routine? Totally your call.';

function threadTurn(
  sender: "coach" | "user",
  body: string,
  day: string,
  local: string,
  rel: string,
  weekday: string
): MorningBriefExactThreadMessage {
  return {
    sender,
    sent_at_utc: `${day}T12:00:00.000Z`,
    sent_at_local: local,
    local_day_key: day,
    local_weekday: weekday,
    day_relation_to_message: rel,
    body,
  };
}

const RACHAEL_THREAD: MorningBriefExactThreadMessage[] = [
  threadTurn(
    "coach",
    'Good morning, Rachael. Before screens or the morning rush, pause for one breath, then offer a calm “good morning.” Keep it simple and let me know how it goes.',
    "2026-08-21",
    "Aug 21, 2026, 7:01 AM",
    "4 days before",
    "Friday"
  ),
  threadTurn(
    "coach",
    'Hey Rachael, just checking in ... how did the calm "good morning" greeting go yesterday and this morning?',
    "2026-08-22",
    "Aug 22, 2026, 7:01 PM",
    "3 days before",
    "Saturday"
  ),
  threadTurn(
    "coach",
    'Hope you and the family are having a wonderful Sunday, Rachael! As you rest and recover, here is a quote that fits: "Left foot, right foot, breathe."',
    "2026-08-23",
    "Aug 23, 2026, 12:01 PM",
    "2 days before",
    "Sunday"
  ),
  threadTurn(
    "coach",
    RACHAEL_FOCUS_CHOICE,
    "2026-08-24",
    "Aug 24, 2026, 7:00 AM",
    "yesterday",
    "Monday"
  ),
];

function assembleOrThrow(
  overrides: Partial<AssembleMorningBriefInterpreterInputArgs> = {}
) {
  const result = assembleMorningBriefInterpreterInputV1({
    timezone: "America/New_York",
    localDate: "2026-08-25",
    localWeekday: "Tuesday",
    daypart: "evening",
    daysSinceLastUserResponse: null,
    neverReplied: true,
    recentUnansweredOutboundCount: 4,
    canonicalGoalText: RACHAEL_GOAL,
    pendingGoalChange: null,
    identityAnchorText: null,
    identitySource: ONBOARDING_IDENTITY_ANCHOR_SOURCE,
    importantPeople: [],
    lifeContextProfile: {},
    latestOutcome: null,
    latestOutcomeAt: null,
    latestOutcomeMessage: null,
    matchingOutcomeCount: 0,
    hasVerifiedProofMetadata: false,
    threadMemoryHint: {
      open_question_pending: true,
      open_question_text:
        "Or should I keep checking in about the Good Morning goal/routine?",
      open_question_answer_text: null,
    },
    exactThreadMessages: RACHAEL_THREAD,
    omittedOlderTurnCount: 0,
    quietRelationshipEligible: false,
    messageRequiredToday: false,
    ...overrides,
  });
  if ("ok" in result) throw new Error(result.error);
  return result;
}

function brief(overrides: Record<string, unknown> = {}): MorningCoachingBriefV1 {
  const base: MorningCoachingBriefV1 = {
    version: MORNING_COACHING_BRIEF_VERSION,
    confidence: "medium",
    human_situation: {
      most_alive: "Coach reopened whether the Good Morning focus remains the work",
      direct_question_or_need: null,
      relevant_life_event: null,
      context_use: "relevant",
      identity_use: "background",
      person_use: "do_not_force",
      selected_person: null,
      selected_person_reason: null,
    },
    truth_and_evidence: {
      latest_user_truth: null,
      outcome: "no_recent_evidence",
      evidence_note: "No user reply after the focus-choice question",
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
      already_acknowledged: ["Coach asked whether to keep or change the current focus"],
      answered_question: null,
      open_loop: "Member has not answered whether this coaching focus should continue",
      stale_or_exhausted_topics: [],
      do_not_repeat: ["Do not re-ask the same coaching-focus choice"],
    },
    goal_role_today: {
      canonical_goal: RACHAEL_GOAL,
      pending_goal: null,
      goal_alignment: "unknown",
      role: "unresolved",
      note: "Canonical Current Goal remains; the focus choice is unanswered",
    },
    coaching_direction: {
      primary_move: "reconnect",
      question_policy: "none",
      action_guidance: "none",
      pressure: "low",
      proactive_decision: "send",
    },
    boundaries: {
      claims_to_avoid: ["Do not treat continue / keep checking in as chosen"],
      topics_not_to_force: ["Do not assign new work on the disputed focus"],
      unsupported_capabilities: [],
      goal_authority_boundaries: [],
      identity_people_boundaries: [],
      coach_history_is_not_style: "Prior coach messages are history.",
    },
  };
  return {
    ...base,
    ...overrides,
    human_situation: {
      ...base.human_situation,
      ...((overrides.human_situation as object) ?? {}),
    },
    truth_and_evidence: {
      ...base.truth_and_evidence,
      ...((overrides.truth_and_evidence as object) ?? {}),
    },
    conversation_continuity: {
      ...base.conversation_continuity,
      ...((overrides.conversation_continuity as object) ?? {}),
    },
    goal_role_today: {
      ...base.goal_role_today,
      ...((overrides.goal_role_today as object) ?? {}),
    },
    coaching_direction: {
      ...base.coaching_direction,
      ...((overrides.coaching_direction as object) ?? {}),
    },
    boundaries: {
      ...base.boundaries,
      ...((overrides.boundaries as object) ?? {}),
    },
  } as MorningCoachingBriefV1;
}

function merge(input: ReturnType<typeof assembleOrThrow>, draft: MorningCoachingBriefV1) {
  return parseAndMergeMorningBriefInterpreterResponse({
    input,
    raw: JSON.stringify(draft),
  });
}

function weeklyPacket(
  overrides: Partial<WeeklyRelationshipPacket> = {}
): WeeklyRelationshipPacket {
  return {
    version: "weekly_relationship_v1",
    message_for: {
      timezone: "America/New_York",
      local_date: "2026-08-30",
      local_weekday: "Sunday",
      daypart: "weekly",
      week_start_local_date: "2026-08-24",
      week_end_local_date: "2026-08-30",
    },
    last_user_response: {
      at_utc: null,
      at_local: null,
      days_since: null,
      never_replied: true,
    },
    preferred_name: "Rachael",
    current_goal: { text: RACHAEL_GOAL },
    current_identity: { text: null },
    personal_context: [],
    hard_state: { pending_goal_change: null, planned_interruption: null },
    weekly_accountability_events: [],
    coaching_memory_projection: null,
    exact_thread: {
      window_days: 21,
      max_messages: 30,
      omitted_older_turn_count: 0,
      messages: RACHAEL_THREAD,
    },
    ...overrides,
  };
}

describe("unresolved coaching-focus choice — prompt law", () => {
  it("Morning/Evening prompt encodes the semantic law without a phrase matcher", () => {
    const p = MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT;
    expect(p).toContain("UNRESOLVED COACHING-FOCUS CHOICE");
    expect(p).toContain("continue, change, pause, or redefine the current coaching focus");
    expect(p).toContain("preserve the unresolved choice");
    expect(p).toContain("Read that meaning from the exact thread");
    expect(p).toContain("Do not use a phrase list");
    expect(p).toContain("Current Goal remains canonical state");
    expect(p).toContain("Do not invent pending confirmation");
    expect(p).toContain("Do not assign new work on that disputed focus merely because it remains canonical");
    expect(p).toContain("independent reason");
    expect(p).toContain("Do not re-ask the same coaching-focus choice");
    expect(p).toContain("does not freeze ordinary unanswered outcome questions");
    expect(p).toContain("Do not create intentional SPACE from this law");
    expect(p).toContain("existing Quiet Relationship laws still decide SEND vs SPACE");
    expect(p).not.toContain(RACHAEL_FOCUS_CHOICE);
    expect(p).not.toMatch(/\/change your goal\/|regex/i);
  });

  it("Weekly prompt carries the same meaning and stays SEND-only", () => {
    const p = WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT;
    expect(p).toContain("UNRESOLVED COACHING-FOCUS CHOICE");
    expect(p).toContain("continue, change, pause, or redefine the current coaching focus");
    expect(p).toContain("preserve the unresolved choice");
    expect(p).toContain("Do not recap or coach the disputed focus as though it was reaffirmed");
    expect(p).toContain("coaching_direction.proactive_decision must be send");
    expect(p).toContain("Do not use intentional_space");
    expect(p).toContain("Reconnect, perspective, support, useful Sunday value");
    expect(p).not.toContain(RACHAEL_FOCUS_CHOICE);
  });

  it("writer prompt is unchanged and still follows Brief goal_role_today", () => {
    expect(MORNING_TTO_SYSTEM_PROMPT).not.toContain("UNRESOLVED COACHING-FOCUS CHOICE");
    expect(MORNING_TTO_SYSTEM_PROMPT).toContain("Follow goal_role_today");
    expect(MORNING_TTO_SYSTEM_PROMPT).toContain("Pending/unconfirmed goal is not Current Goal");
    const writerSrc = readFileSync(
      path.join(process.cwd(), "src/lib/morning-tto-writer.ts"),
      "utf8"
    );
    expect(writerSrc).not.toContain("UNRESOLVED COACHING-FOCUS CHOICE");
  });
});

describe("Rachael regression — unanswered coaching-focus choice", () => {
  it("next proactive Brief preserves the unresolved choice without assigning the disputed focus", () => {
    const input = assembleOrThrow();
    expect(input.canonical_goal.text).toBe(RACHAEL_GOAL);
    expect(input.pending_goal_change).toBeNull();
    expect(input.mechanical.quiet_relationship_eligible).toBe(false);
    expect(JSON.stringify(input.exact_thread.messages)).toContain(RACHAEL_FOCUS_CHOICE);

    const merged = merge(input, brief());
    expect(merged).not.toBeNull();
    expect(merged?.goal_role_today.canonical_goal).toBe(RACHAEL_GOAL);
    expect(merged?.goal_role_today.pending_goal).toBeNull();
    expect(merged?.goal_role_today.goal_alignment).not.toBe("pending_confirmation");
    expect(merged?.goal_role_today.role).not.toBe("central");
    expect(["unresolved", "background"]).toContain(merged?.goal_role_today.role);
    expect(merged?.goal_role_today.note).toMatch(/unanswered|canonical/i);
    expect(String(merged?.conversation_continuity.open_loop)).toMatch(
      /focus|choice|continue/i
    );
    expect(merged?.coaching_direction.action_guidance).toBe("none");
    expect(merged?.coaching_direction.question_policy).toBe("none");
    expect(merged?.coaching_direction.proactive_decision).toBe("send");
    expect(JSON.stringify(merged?.conversation_continuity.do_not_repeat)).toMatch(
      /focus-choice|same coaching-focus/i
    );
  });

  it("merge does not invent pending confirmation or mutate Current Goal on the Rachael input", () => {
    const merged = merge(
      assembleOrThrow(),
      brief({
        goal_role_today: {
          canonical_goal: "FAKE MUTATION",
          pending_goal: null,
          goal_alignment: "pending_confirmation",
          role: "unresolved",
          note: "Canonical Current Goal remains; the focus choice is unanswered",
        },
      })
    );
    expect(merged?.goal_role_today.canonical_goal).toBe(RACHAEL_GOAL);
    expect(merged?.goal_role_today.pending_goal).toBeNull();
    expect(merged?.goal_role_today.goal_alignment).toBe("unknown");
  });
});

describe("false-positive regressions — ordinary unanswered questions stay coachable", () => {
  it("A. unanswered workout check does not freeze later goal coaching", () => {
    const input = assembleOrThrow({
      neverReplied: false,
      daysSinceLastUserResponse: 1,
      recentUnansweredOutboundCount: 1,
      canonicalGoalText: "Complete today's workout",
      threadMemoryHint: {
        open_question_pending: true,
        open_question_text: "Did you get your workout done?",
        open_question_answer_text: null,
      },
      exactThreadMessages: [
        threadTurn(
          "coach",
          "Did you get your workout done?",
          "2026-08-24",
          "Aug 24, 7:00 PM",
          "yesterday",
          "Monday"
        ),
      ],
    });
    const merged = merge(
      input,
      brief({
        conversation_continuity: {
          open_loop: "Workout check is unanswered",
          do_not_repeat: ["Did you get your workout done?"],
          already_acknowledged: [],
          answered_question: null,
          stale_or_exhausted_topics: [],
        },
        goal_role_today: {
          canonical_goal: "Complete today's workout",
          pending_goal: null,
          goal_alignment: "aligned",
          role: "central",
          note: "Ordinary accountability remains legal",
        },
        coaching_direction: {
          primary_move: "simplify_next_move",
          question_policy: "none",
          action_guidance: "one_specific_next_step",
          pressure: "normal",
          proactive_decision: "send",
        },
      })
    );
    expect(merged?.goal_role_today.role).toBe("central");
    expect(merged?.coaching_direction.action_guidance).toBe("one_specific_next_step");
    expect(merged?.coaching_direction.proactive_decision).toBe("send");
    expect(merged?.goal_role_today.pending_goal).toBeNull();
  });

  it("B. unanswered vacation question still allows natural reentry", () => {
    const merged = merge(
      assembleOrThrow({
        neverReplied: false,
        daysSinceLastUserResponse: 2,
        recentUnansweredOutboundCount: 1,
        threadMemoryHint: null,
        exactThreadMessages: [
          threadTurn(
            "coach",
            "How is vacation going?",
            "2026-08-23",
            "Aug 23, 10:00 AM",
            "2 days before",
            "Sunday"
          ),
        ],
      }),
      brief({
        goal_role_today: {
          role: "background",
          goal_alignment: "aligned",
          canonical_goal: RACHAEL_GOAL,
          pending_goal: null,
          note: "Life question unanswered; reentry is legal",
        },
        coaching_direction: {
          primary_move: "reconnect",
          question_policy: "one_useful_question",
          action_guidance: "none",
          pressure: "low",
          proactive_decision: "send",
        },
      })
    );
    expect(merged?.coaching_direction.primary_move).toBe("reconnect");
    expect(merged?.coaching_direction.proactive_decision).toBe("send");
    expect(merged?.goal_role_today.role).not.toBe("do_not_mention");
  });

  it("C. unanswered operational detail still allows later practical coaching", () => {
    const merged = merge(
      assembleOrThrow({
        neverReplied: false,
        daysSinceLastUserResponse: 1,
        recentUnansweredOutboundCount: 1,
        canonicalGoalText: "Test a working weight this week",
        threadMemoryHint: null,
        exactThreadMessages: [
          threadTurn(
            "coach",
            "What weight will you test next?",
            "2026-08-24",
            "Aug 24, 7:00 AM",
            "yesterday",
            "Monday"
          ),
        ],
      }),
      brief({
        goal_role_today: {
          canonical_goal: "Test a working weight this week",
          pending_goal: null,
          goal_alignment: "aligned",
          role: "central",
          note: "Operational detail unanswered; practical coaching remains legal",
        },
        coaching_direction: {
          primary_move: "simplify_next_move",
          question_policy: "none",
          action_guidance: "one_specific_next_step",
          pressure: "normal",
          proactive_decision: "send",
        },
      })
    );
    expect(merged?.goal_role_today.role).toBe("central");
    expect(merged?.coaching_direction.action_guidance).toBe("one_specific_next_step");
  });

  it("D. unanswered coaching-method menu does not freeze the whole focus", () => {
    const merged = merge(
      assembleOrThrow({
        neverReplied: false,
        daysSinceLastUserResponse: 1,
        recentUnansweredOutboundCount: 1,
        threadMemoryHint: null,
        exactThreadMessages: [
          threadTurn(
            "coach",
            "Would challenge, habits, or reflection help you most?",
            "2026-08-24",
            "Aug 24, 7:00 AM",
            "yesterday",
            "Monday"
          ),
        ],
      }),
      brief({
        goal_role_today: {
          canonical_goal: RACHAEL_GOAL,
          pending_goal: null,
          goal_alignment: "aligned",
          role: "background",
          note: "Method menu unanswered; value remains legal",
        },
        coaching_direction: {
          primary_move: "offer_perspective",
          question_policy: "none",
          action_guidance: "none",
          pressure: "low",
          proactive_decision: "send",
        },
      })
    );
    expect(merged?.coaching_direction.primary_move).toBe("offer_perspective");
    expect(merged?.goal_role_today.role).not.toBe("do_not_mention");
    expect(merged?.coaching_direction.proactive_decision).toBe("send");
  });
});

describe("resolution and canonical-but-unresolved", () => {
  it("E. explicit keep resumes normal Current Goal coaching without new pending state", () => {
    const merged = merge(
      assembleOrThrow({
        neverReplied: false,
        daysSinceLastUserResponse: 0,
        recentUnansweredOutboundCount: 0,
        threadMemoryHint: {
          open_question_pending: false,
          open_question_text:
            "Or should I keep checking in about the Good Morning goal/routine?",
          open_question_answer_text: "Keep it",
        },
        exactThreadMessages: [
          ...RACHAEL_THREAD,
          threadTurn(
            "user",
            "Keep it",
            "2026-08-25",
            "Aug 25, 8:00 AM",
            "today",
            "Tuesday"
          ),
        ],
      }),
      brief({
        conversation_continuity: {
          open_loop: null,
          answered_question: {
            question: "Or should I keep checking in about the Good Morning goal/routine?",
            answer: "Keep it",
          },
          already_acknowledged: ["Member reaffirmed the current focus"],
          do_not_repeat: [],
          stale_or_exhausted_topics: [],
        },
        goal_role_today: {
          canonical_goal: RACHAEL_GOAL,
          pending_goal: null,
          goal_alignment: "aligned",
          role: "central",
          note: "Member reaffirmed the current focus",
        },
        coaching_direction: {
          primary_move: "simplify_next_move",
          question_policy: "none",
          action_guidance: "one_specific_next_step",
          pressure: "normal",
          proactive_decision: "send",
        },
      })
    );
    expect(merged?.goal_role_today.canonical_goal).toBe(RACHAEL_GOAL);
    expect(merged?.goal_role_today.pending_goal).toBeNull();
    expect(merged?.goal_role_today.role).toBe("central");
    expect(merged?.coaching_direction.action_guidance).toBe("one_specific_next_step");
    expect(merged?.goal_role_today.goal_alignment).toBe("aligned");
  });

  it("F. explicit change leaves existing pending-goal machinery authoritative", () => {
    const candidate = "Walk 20 minutes after dinner";
    const input = assembleOrThrow({
      neverReplied: false,
      daysSinceLastUserResponse: 0,
      recentUnansweredOutboundCount: 0,
      pendingGoalChange: {
        candidate_text: candidate,
        status: "awaiting_user_confirmation",
      },
      exactThreadMessages: [
        ...RACHAEL_THREAD,
        threadTurn(
          "user",
          "Let's change it to walking after dinner",
          "2026-08-25",
          "Aug 25, 8:00 AM",
          "today",
          "Tuesday"
        ),
      ],
    });
    const merged = merge(
      input,
      brief({
        goal_role_today: {
          canonical_goal: RACHAEL_GOAL,
          pending_goal: null,
          goal_alignment: "aligned",
          role: "central",
          note: "Interpreter must not treat pending as Current Goal",
        },
      })
    );
    expect(merged?.goal_role_today.canonical_goal).toBe(RACHAEL_GOAL);
    expect(merged?.goal_role_today.pending_goal).toEqual({
      candidate_text: candidate,
      status: "awaiting_user_confirmation",
    });
    expect(merged?.goal_role_today.goal_alignment).toBe("pending_confirmation");
    expect(merged?.goal_role_today.role).toBe("unresolved");
  });

  it("canonical Current Goal X can remain while the focus choice stays conversationally unresolved", () => {
    const merged = merge(assembleOrThrow(), brief());
    expect(merged?.goal_role_today.canonical_goal).toBe(RACHAEL_GOAL);
    expect(merged?.goal_role_today.pending_goal).toBeNull();
    expect(merged?.goal_role_today.role).not.toBe("central");
    expect(merged?.coaching_direction.action_guidance).not.toBe("one_specific_next_step");
    expect(merged?.goal_role_today.goal_alignment).not.toBe("aligned");
  });
});

describe("active-user shield and quiet user", () => {
  it("active user (<10 days, not quiet-eligible) cannot get SPACE from this law", () => {
    const merged = merge(
      assembleOrThrow({
        daysSinceLastUserResponse: 4,
        neverReplied: false,
        quietRelationshipEligible: false,
        messageRequiredToday: false,
      }),
      brief({
        coaching_direction: {
          primary_move: "reconnect",
          question_policy: "none",
          action_guidance: "none",
          pressure: "low",
          proactive_decision: "intentional_space",
        },
      })
    );
    expect(merged?.coaching_direction.proactive_decision).toBe("send");
    expect(merged?.goal_role_today.role).toBe("unresolved");
  });

  it("quiet-eligible SPACE vs SEND remains the existing quiet clamp, not a new cadence", () => {
    const space = merge(
      assembleOrThrow({
        daysSinceLastUserResponse: 12,
        neverReplied: false,
        quietRelationshipEligible: true,
        messageRequiredToday: false,
      }),
      brief({
        coaching_direction: {
          primary_move: "offer_perspective",
          question_policy: "none",
          action_guidance: "none",
          pressure: "low",
          proactive_decision: "intentional_space",
        },
      })
    );
    expect(space?.coaching_direction.proactive_decision).toBe("intentional_space");
    expect(space?.goal_role_today.role).toBe("unresolved");

    const send = merge(
      assembleOrThrow({
        daysSinceLastUserResponse: 12,
        neverReplied: false,
        quietRelationshipEligible: true,
        messageRequiredToday: false,
      }),
      brief()
    );
    expect(send?.coaching_direction.proactive_decision).toBe("send");
    expect(send?.goal_role_today.canonical_goal).toBe(RACHAEL_GOAL);
  });
});

describe("Weekly SEND-only with unanswered focus choice", () => {
  beforeEach(() => {
    loadMorningBriefCanonicalExtrasV1.mockResolvedValue({
      importantPeople: [],
      outcomeSpine: {
        latestOutcome: null,
        latestOutcomeAt: null,
        latestOutcomeMessage: null,
        matchingOutcomeCount: 0,
        hasVerifiedProofMetadata: false,
      },
      threadMemoryHint: {
        open_question_pending: true,
        open_question_text:
          "Or should I keep checking in about the Good Morning goal/routine?",
        open_question_answer_text: null,
      },
    });
  });

  it("Weekly input keeps canonical goal, null pending, and the unanswered choice in exact_thread", () => {
    const assembled = assembleWeeklyBriefInterpreterInputFromPacket({
      packet: weeklyPacket(),
      extras: {
        importantPeople: [],
        outcomeSpine: {
          latestOutcome: null,
          latestOutcomeAt: null,
          latestOutcomeMessage: null,
          matchingOutcomeCount: 0,
          hasVerifiedProofMetadata: false,
        },
        threadMemoryHint: {
          open_question_pending: true,
          open_question_text:
            "Or should I keep checking in about the Good Morning goal/routine?",
          open_question_answer_text: null,
        },
      },
    });
    if ("ok" in assembled) throw new Error(assembled.error);
    expect(assembled.canonical_goal.text).toBe(RACHAEL_GOAL);
    expect(assembled.pending_goal_change).toBeNull();
    expect(assembled.mechanical.quiet_relationship_eligible).toBe(false);
    expect(JSON.stringify(assembled.exact_thread.messages)).toContain(RACHAEL_FOCUS_CHOICE);
  });

  it("Weekly merge stays SEND, does not treat the disputed focus as reaffirmed, and does not mutate the goal", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      choices: [
        {
          message: { content: JSON.stringify(brief()) },
          finish_reason: "stop",
        },
      ],
    });
    const result = await runWeeklyBriefInterpreterV1({
      packet: weeklyPacket(),
      clerkUserId: "user_3ICQjMlnB2Jootz7tIPCjXrpNeh",
      commitmentId: "115449bc-adda-451d-a086-d1a144642a58",
      client: { chat: { completions: { create } } } as never,
    });
    expect(result.ok).toBe(true);
    expect(result.brief.coaching_direction.proactive_decision).toBe("send");
    expect(result.brief.goal_role_today.canonical_goal).toBe(RACHAEL_GOAL);
    expect(result.brief.goal_role_today.pending_goal).toBeNull();
    expect(result.brief.goal_role_today.role).not.toBe("central");
    expect(result.brief.coaching_direction.action_guidance).not.toBe(
      "one_specific_next_step"
    );
    expect(result.brief.goal_role_today.goal_alignment).not.toBe("pending_confirmation");
    expect(JSON.stringify(result.brief)).not.toContain("should_send");
  });
});
