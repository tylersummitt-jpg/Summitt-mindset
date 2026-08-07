import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import {
  assembleMorningBriefInterpreterInputV1,
  type AssembleMorningBriefInterpreterInputArgs,
} from "@/lib/morning-tto-brief-canonical-input-v1";
import {
  buildFailSoftGoalAlignmentFromCanonical,
  buildLowConfidenceUnknownBriefFromCanonical,
  buildMorningBriefInterpreterMessages,
  buildMorningBriefInterpreterUserMessage,
  mergeMorningBriefWithCanonicalTruth,
  MORNING_BRIEF_INTERPRETER_MODEL,
  MORNING_BRIEF_INTERPRETER_PROVISIONAL_MODEL,
  MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT,
  parseAndMergeMorningBriefInterpreterResponse,
  runMorningBriefInterpreterV1,
} from "@/lib/morning-tto-brief-interpreter-v1";
import {
  MORNING_COACHING_BRIEF_VERSION,
  parseMorningCoachingBriefV1,
  type MorningCoachingBriefV1,
} from "@/lib/morning-tto-coaching-brief-v1";
import { ONBOARDING_IDENTITY_ANCHOR_SOURCE } from "@/lib/v2-identity-anchor-validation";

function assembleOrThrow(
  overrides: Partial<AssembleMorningBriefInterpreterInputArgs> = {}
) {
  const result = assembleMorningBriefInterpreterInputV1({
    timezone: "America/New_York",
    localDate: "2026-08-07",
    localWeekday: "Friday",
    daysSinceLastUserResponse: 1,
    neverReplied: false,
    recentUnansweredOutboundCount: 0,
    canonicalGoalText: "Dictate one story before noon",
    pendingGoalChange: null,
    identityAnchorText: "I am a father who keeps his word",
    identitySource: ONBOARDING_IDENTITY_ANCHOR_SOURCE,
    importantPeople: [
      {
        display_name: "Brooke",
        relationship_type: "spouse_partner",
        is_active: true,
        removed_at: null,
      },
      {
        display_name: "Emma",
        relationship_type: "child",
        is_active: true,
        removed_at: null,
      },
      {
        display_name: "Noah",
        relationship_type: "child",
        is_active: true,
        removed_at: null,
      },
    ],
    lifeContextProfile: {},
    latestOutcome: "user_yes",
    latestOutcomeAt: "2026-08-06T15:00:00.000Z",
    latestOutcomeMessage: "Got it done",
    matchingOutcomeCount: 1,
    hasVerifiedProofMetadata: false,
    threadMemoryHint: null,
    exactThreadMessages: [
      {
        sender: "user",
        sent_at_utc: "2026-08-06T15:00:00.000Z",
        sent_at_local: "2026-08-06 11:00",
        local_day_key: "2026-08-06",
        local_weekday: "Thursday",
        day_relation_to_message: "1_day_before",
        body: "Got it done",
      },
    ],
    ...overrides,
  });
  if ("ok" in result) throw new Error(result.error);
  return result;
}

function semanticBriefDraft(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const base: MorningCoachingBriefV1 = {
    version: MORNING_COACHING_BRIEF_VERSION,
    confidence: "high",
    human_situation: {
      most_alive: "User celebrated finishing the story",
      direct_question_or_need: null,
      relevant_life_event: null,
      context_use: "background",
      identity_use: "background",
      person_use: "do_not_force",
      selected_person: null,
      selected_person_reason: null,
    },
    truth_and_evidence: {
      latest_user_truth: "INTERPRETER_WRONG_TRUTH",
      outcome: "missed",
      evidence_note: "interpreter note",
      evidence_strength: "verified",
      consistency_supported: true,
      proof_claims_allowed: {
        completion: true,
        miss: true,
        partial: true,
        proof: true,
      },
    },
    conversation_continuity: {
      already_acknowledged: [],
      answered_question: null,
      open_loop: null,
      stale_or_exhausted_topics: [],
      do_not_repeat: [],
    },
    goal_role_today: {
      canonical_goal: "INTERPRETER_FAKE_GOAL",
      pending_goal: null,
      goal_alignment: "aligned",
      role: "background",
      note: "ok",
    },
    coaching_direction: {
      primary_move: "celebrate",
      question_policy: "none",
      action_guidance: "none",
      pressure: "normal",
    },
    boundaries: {
      claims_to_avoid: ["interpreter claim"],
      topics_not_to_force: ["interpreter topic"],
      unsupported_capabilities: ["should be replaced"],
      goal_authority_boundaries: ["should be replaced"],
      identity_people_boundaries: ["should be replaced"],
      coach_history_is_not_style: "should be replaced",
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
  };
}

describe("morning-tto-brief-interpreter-v1", () => {
  it("system prompt forbids SMS copy and state mutation", () => {
    expect(MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT).toMatch(/Never output user-visible SMS copy/);
    expect(MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT).toMatch(/Never mutate state/);
    expect(MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT).toMatch(/Prefer honest unknown/);
    expect(MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT).toMatch(/not style examples/);
    expect(MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT).toMatch(/Answer direct user questions/);
    expect(MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT).toMatch(
      /family, faith, grief, work, celebration/
    );
    expect(MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT).toMatch(/may outrank Current Goal/);
    expect(MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT).toMatch(/Do not manufacture engagement/);
    expect(MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT).not.toMatch(/set_today_rep|hallway/);
  });

  it("provisional model constant is framed as placeholder, not a locked production choice", () => {
    expect(MORNING_BRIEF_INTERPRETER_PROVISIONAL_MODEL).toBe("gpt-5.6-sol");
    expect(MORNING_BRIEF_INTERPRETER_MODEL).toBe("gpt-5.6-sol");
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/morning-tto-brief-interpreter-v1.ts"),
      "utf8"
    );
    expect(src).toMatch(/Phase 2C locked interpreter model/);
    expect(src).toMatch(/reasoning_effort/);
    expect(src).not.toMatch(/runLaneOpenAiJsonWithOneRetry/);
  });

  it("builds exact structured messages from canonical input", () => {
    const input = assembleOrThrow();
    const messages = buildMorningBriefInterpreterMessages(input);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.role).toBe("user");
    expect(String(messages[1]?.content)).toContain("MORNING_BRIEF_INTERPRETER_INPUT_V1");
    expect(String(messages[1]?.content)).toContain(input.canonical_goal.text);
    expect(buildMorningBriefInterpreterUserMessage(input)).toContain(
      '"daypart":"morning"'
    );
  });

  it("canonical spine overwrites conflicting interpreter outcome/evidence/consistency/proof", () => {
    const input = assembleOrThrow({
      latestOutcome: "user_yes",
      matchingOutcomeCount: 1,
      hasVerifiedProofMetadata: false,
      latestOutcomeMessage: "Got it done",
    });
    const parsed = parseMorningCoachingBriefV1(semanticBriefDraft());
    expect(parsed).not.toBeNull();
    const merged = mergeMorningBriefWithCanonicalTruth({ parsed: parsed!, input });
    expect(merged.truth_and_evidence.outcome).toBe("completed");
    expect(merged.truth_and_evidence.evidence_strength).toBe("stated_once");
    expect(merged.truth_and_evidence.consistency_supported).toBe(false);
    expect(merged.truth_and_evidence.proof_claims_allowed).toEqual({
      completion: true,
      miss: false,
      partial: false,
      proof: false,
    });
    expect(merged.truth_and_evidence.latest_user_truth).toBe("Got it done");
    expect(merged.goal_role_today.canonical_goal).toBe("Dictate one story before noon");
  });

  it("rejects invented selected person; preserves valid selection and reason", () => {
    const input = assembleOrThrow();
    const invented = parseAndMergeMorningBriefInterpreterResponse({
      input,
      raw: JSON.stringify(
        semanticBriefDraft({
          human_situation: {
            person_use: "relevant",
            selected_person: { name: "InventedFriend", relationship: "other" },
            selected_person_reason: "made up",
          },
        })
      ),
    });
    expect(invented?.human_situation.selected_person).toBeNull();

    const valid = parseAndMergeMorningBriefInterpreterResponse({
      input,
      raw: JSON.stringify(
        semanticBriefDraft({
          human_situation: {
            person_use: "relevant",
            selected_person: { name: "Brooke", relationship: "spouse/partner" },
            selected_person_reason: "User mentioned Brooke in the latest reply",
          },
        })
      ),
    });
    expect(valid?.human_situation.selected_person).toEqual({
      name: "Brooke",
      relationship: "spouse/partner",
    });
    expect(valid?.human_situation.selected_person_reason).toMatch(/Brooke/);
  });

  it("pending goal stays unconfirmed and cannot become canonical goal", () => {
    const input = assembleOrThrow({
      pendingGoalChange: {
        candidate_text: "Walk 20 minutes after dinner",
        status: "awaiting_user_confirmation",
      },
    });
    const merged = parseAndMergeMorningBriefInterpreterResponse({
      input,
      raw: JSON.stringify(
        semanticBriefDraft({
          goal_role_today: {
            canonical_goal: "Walk 20 minutes after dinner",
            pending_goal: null,
            goal_alignment: "aligned",
            role: "central",
            note: "treat pending as current",
          },
        })
      ),
    });
    expect(merged?.goal_role_today.canonical_goal).toBe("Dictate one story before noon");
    expect(merged?.goal_role_today.pending_goal).toEqual({
      candidate_text: "Walk 20 minutes after dinner",
      status: "awaiting_user_confirmation",
    });
    expect(merged?.goal_role_today.goal_alignment).toBe("pending_confirmation");
    expect(merged?.goal_role_today.role).toBe("unresolved");
  });

  it("identity cannot become proof via interpreter claims", () => {
    const input = assembleOrThrow({
      latestOutcome: null,
      matchingOutcomeCount: 0,
      latestOutcomeMessage: null,
    });
    const merged = parseAndMergeMorningBriefInterpreterResponse({
      input,
      raw: JSON.stringify(
        semanticBriefDraft({
          truth_and_evidence: {
            latest_user_truth: "Identity proves consistency",
            outcome: "completed",
            evidence_note: "from identity",
            evidence_strength: "verified",
            consistency_supported: true,
            proof_claims_allowed: {
              completion: true,
              miss: false,
              partial: false,
              proof: true,
            },
          },
        })
      ),
    });
    expect(merged?.truth_and_evidence.outcome).toBe("no_recent_evidence");
    expect(merged?.truth_and_evidence.proof_claims_allowed.proof).toBe(false);
    expect(merged?.truth_and_evidence.consistency_supported).toBe(false);
    expect(merged?.boundaries.identity_people_boundaries.join(" ")).toMatch(
      /never proof of action/i
    );
  });

  it("invalid JSON becomes low-confidence unknown with canonical facts", () => {
    const input = assembleOrThrow();
    const brief = buildLowConfidenceUnknownBriefFromCanonical(input);
    expect(brief.confidence).toBe("low");
    expect(brief.human_situation.most_alive).toBe("unknown");
    expect(brief.coaching_direction.primary_move).toBe("unknown");
    expect(brief.coaching_direction.pressure).toBe("unknown");
    expect(brief.truth_and_evidence.outcome).toBe("completed");
    expect(brief.truth_and_evidence.evidence_strength).toBe("stated_once");
    expect(brief.goal_role_today.canonical_goal).toBe(input.canonical_goal.text);
    expect(brief.goal_role_today.goal_alignment).toBe("unknown");
    expect(buildFailSoftGoalAlignmentFromCanonical(input)).toBe("unknown");

    expect(
      parseAndMergeMorningBriefInterpreterResponse({
        input,
        raw: "{not-json",
      })
    ).toBeNull();
  });

  it("fail-soft goal_alignment is pending_confirmation when pending, else unknown (not aligned)", () => {
    const noPending = assembleOrThrow();
    expect(buildFailSoftGoalAlignmentFromCanonical(noPending)).toBe("unknown");
    expect(buildLowConfidenceUnknownBriefFromCanonical(noPending).goal_role_today.goal_alignment).toBe(
      "unknown"
    );

    const withPending = assembleOrThrow({
      pendingGoalChange: {
        candidate_text: "Walk 20 minutes after dinner",
        status: "awaiting_user_confirmation",
      },
    });
    expect(buildFailSoftGoalAlignmentFromCanonical(withPending)).toBe("pending_confirmation");
    const failSoft = buildLowConfidenceUnknownBriefFromCanonical(withPending);
    expect(failSoft.goal_role_today.goal_alignment).toBe("pending_confirmation");
    expect(failSoft.goal_role_today.pending_goal?.status).toBe("awaiting_user_confirmation");
    expect(failSoft.goal_role_today.role).toBe("unknown");
  });

  it("rejects body/message fields and has no retry loop requirement", async () => {
    const input = assembleOrThrow();
    expect(
      parseAndMergeMorningBriefInterpreterResponse({
        input,
        raw: JSON.stringify({ ...semanticBriefDraft(), body: "Hey!" }),
      })
    ).toBeNull();

    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "{bad" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const client = { chat: { completions: { create } } } as never;
    const result = await runMorningBriefInterpreterV1({ input, client });
    expect(result.ok).toBe(false);
    expect(result.brief.confidence).toBe("low");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        model: "gpt-5.6-sol",
        reasoning_effort: "low",
        max_completion_tokens: 2500,
        response_format: { type: "json_object" },
      })
    );
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("temperature");
    expect(result.capture.error).toBeTruthy();
    expect(result.capture.temperature).toBeNull();
    expect(result.capture.reasoning_effort).toBe("low");
  });

  it("source module has no mutation or generation imports", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/morning-tto-brief-interpreter-v1.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/supabase/i);
    expect(src).not.toMatch(/tyler-text-overview-generate/);
    expect(src).not.toMatch(/morning-tto-writer/);
    expect(src).not.toMatch(/daily-sms/);
    expect(src).not.toMatch(/from\("v2_commitment"\)/);
  });

  it("generate path wires observational interpreter without feeding writer (Phase 2C)", () => {
    const generateSrc = readFileSync(
      path.join(process.cwd(), "src/lib/tyler-text-overview-generate.ts"),
      "utf8"
    );
    expect(generateSrc).toMatch(/runObservationalMorningBriefInterpreter/);
    expect(generateSrc).toMatch(/morning-tto-brief-interpreter/);
    expect(generateSrc).toMatch(/writeMorningTtoBody\(packet\)/);
    expect(generateSrc).not.toMatch(/writeMorningTtoBody\([^)]*brief/);
    const writerSrc = readFileSync(
      path.join(process.cwd(), "src/lib/morning-tto-writer.ts"),
      "utf8"
    );
    expect(writerSrc).not.toMatch(/morning-tto-brief|coaching_brief|MORNING_BRIEF/);
    expect(writerSrc).toMatch(/MORNING_TTO_WRITER_MODEL = "gpt-4o-mini"/);
  });
});

describe("morning brief interpreter product scenarios", () => {
  it("1. Tyler family data available but no person selected when irrelevant", () => {
    const input = assembleOrThrow();
    const merged = parseAndMergeMorningBriefInterpreterResponse({
      input,
      raw: JSON.stringify(
        semanticBriefDraft({
          human_situation: {
            most_alive: "User confirmed they finished the story",
            person_use: "do_not_force",
            selected_person: null,
            selected_person_reason: null,
          },
        })
      ),
    });
    expect(input.available_important_people.length).toBeGreaterThan(0);
    expect(merged?.human_situation.selected_person).toBeNull();
    expect(merged?.human_situation.person_use).toBe("do_not_force");
  });

  it("2. Brooke may be selected only when thread relevance supports it", () => {
    const input = assembleOrThrow({
      exactThreadMessages: [
        {
          sender: "user",
          sent_at_utc: "2026-08-06T15:00:00.000Z",
          sent_at_local: "2026-08-06 11:00",
          local_day_key: "2026-08-06",
          local_weekday: "Thursday",
          day_relation_to_message: "1_day_before",
          body: "Brooke and I talked last night about slowing down.",
        },
      ],
    });
    const merged = parseAndMergeMorningBriefInterpreterResponse({
      input,
      raw: JSON.stringify(
        semanticBriefDraft({
          human_situation: {
            most_alive: "User shared a conversation with Brooke",
            person_use: "relevant",
            selected_person: { name: "Brooke", relationship: "spouse/partner" },
            selected_person_reason: "User mentioned Brooke in the latest reply",
            context_use: "relevant",
          },
          coaching_direction: {
            primary_move: "continue_conversation",
            question_policy: "none",
            action_guidance: "none",
            pressure: "normal",
          },
        })
      ),
    });
    expect(merged?.human_situation.selected_person?.name).toBe("Brooke");
  });

  it("3. Children are not listed merely to prove memory", () => {
    const input = assembleOrThrow();
    const merged = parseAndMergeMorningBriefInterpreterResponse({
      input,
      raw: JSON.stringify(
        semanticBriefDraft({
          human_situation: {
            person_use: "do_not_force",
            selected_person: null,
          },
        })
      ),
    });
    expect(merged?.human_situation.selected_person).toBeNull();
    expect(merged?.boundaries.identity_people_boundaries.join(" ")).toMatch(
      /never recite a list/i
    );
  });

  it("4. Direct user question permits primary_move=answer and goal background", () => {
    const merged = parseAndMergeMorningBriefInterpreterResponse({
      input: assembleOrThrow({
        exactThreadMessages: [
          {
            sender: "user",
            sent_at_utc: "2026-08-06T15:00:00.000Z",
            sent_at_local: "2026-08-06 11:00",
            local_day_key: "2026-08-06",
            local_weekday: "Thursday",
            day_relation_to_message: "1_day_before",
            body: "Should I keep the noon deadline or move it?",
          },
        ],
      }),
      raw: JSON.stringify(
        semanticBriefDraft({
          human_situation: {
            most_alive: "User asked whether to keep the noon deadline",
            direct_question_or_need: "Keep noon deadline or move it?",
            context_use: "relevant",
          },
          goal_role_today: {
            role: "background",
            note: "Answer the question; goal is context",
          },
          coaching_direction: {
            primary_move: "answer",
            question_policy: "none",
            action_guidance: "none",
            pressure: "normal",
          },
        })
      ),
    });
    expect(merged?.coaching_direction.primary_move).toBe("answer");
    expect(merged?.goal_role_today.role).toBe("background");
  });

  it("5. Meaningful life update permits support without goal centrality", () => {
    const merged = parseAndMergeMorningBriefInterpreterResponse({
      input: assembleOrThrow({
        latestOutcome: null,
        matchingOutcomeCount: 0,
        latestOutcomeMessage: null,
        exactThreadMessages: [
          {
            sender: "user",
            sent_at_utc: "2026-08-06T15:00:00.000Z",
            sent_at_local: "2026-08-06 11:00",
            local_day_key: "2026-08-06",
            local_weekday: "Thursday",
            day_relation_to_message: "1_day_before",
            body: "My dad is in the hospital. Rough night.",
          },
        ],
      }),
      raw: JSON.stringify(
        semanticBriefDraft({
          human_situation: {
            most_alive: "User's dad is in the hospital",
            relevant_life_event: "Father hospitalized",
            context_use: "relevant",
          },
          goal_role_today: {
            role: "do_not_mention",
            note: "Life event outranks goal today",
          },
          coaching_direction: {
            primary_move: "support",
            question_policy: "none",
            action_guidance: "none",
            pressure: "low",
          },
        })
      ),
    });
    expect(merged?.coaching_direction.primary_move).toBe("support");
    expect(merged?.goal_role_today.role).toBe("do_not_mention");
  });

  it("6. One completion remains stated_once, not consistency", () => {
    const input = assembleOrThrow({ matchingOutcomeCount: 1 });
    expect(input.truth_spine.evidence_strength).toBe("stated_once");
    expect(input.truth_spine.consistency_supported).toBe(false);
    const merged = parseAndMergeMorningBriefInterpreterResponse({
      input,
      raw: JSON.stringify(semanticBriefDraft()),
    });
    expect(merged?.truth_and_evidence.evidence_strength).toBe("stated_once");
    expect(merged?.truth_and_evidence.consistency_supported).toBe(false);
  });

  it("7. Answered question may be closed and not repeated", () => {
    const merged = parseAndMergeMorningBriefInterpreterResponse({
      input: assembleOrThrow(),
      raw: JSON.stringify(
        semanticBriefDraft({
          conversation_continuity: {
            answered_question: {
              question: "What will you dictate today?",
              answer: "Sunday School",
            },
            do_not_repeat: ["What will you dictate today?"],
            open_loop: null,
            already_acknowledged: [],
            stale_or_exhausted_topics: [],
          },
          coaching_direction: {
            primary_move: "close_loop",
            question_policy: "none",
            action_guidance: "none",
            pressure: "normal",
          },
        })
      ),
    });
    expect(merged?.conversation_continuity.answered_question).toEqual({
      question: "What will you dictate today?",
      answer: "Sunday School",
    });
    expect(merged?.conversation_continuity.do_not_repeat).toContain(
      "What will you dictate today?"
    );
    expect(merged?.coaching_direction.question_policy).toBe("none");
  });

  it("8. Long silence provides facts but does not deterministically choose reconnect", () => {
    const input = assembleOrThrow({
      daysSinceLastUserResponse: 18,
      recentUnansweredOutboundCount: 3,
      latestOutcome: null,
      matchingOutcomeCount: 0,
    });
    expect(input.mechanical.days_since_last_user_response).toBe(18);
    expect(input.mechanical.recent_unanswered_outbound_count).toBe(3);
    const unknown = buildLowConfidenceUnknownBriefFromCanonical(input);
    expect(unknown.coaching_direction.primary_move).toBe("unknown");
    expect(unknown.coaching_direction.pressure).toBe("unknown");
    expect(unknown.goal_role_today.goal_alignment).toBe("unknown");
  });

  it("9. Unconfirmed alternative goal remains unconfirmed", () => {
    const input = assembleOrThrow({
      pendingGoalChange: {
        candidate_text: "Read Scripture for 10 minutes",
        status: "awaiting_user_confirmation",
      },
      exactThreadMessages: [
        {
          sender: "user",
          sent_at_utc: "2026-08-06T15:00:00.000Z",
          sent_at_local: "2026-08-06 11:00",
          local_day_key: "2026-08-06",
          local_weekday: "Thursday",
          day_relation_to_message: "1_day_before",
          body: "Maybe I should switch to reading instead",
        },
      ],
    });
    const merged = parseAndMergeMorningBriefInterpreterResponse({
      input,
      raw: JSON.stringify(
        semanticBriefDraft({
          goal_role_today: {
            goal_alignment: "thread_discussing_unconfirmed_alternative",
            role: "unresolved",
            note: "Thread discussing alternative; pending unconfirmed",
          },
        })
      ),
    });
    expect(merged?.goal_role_today.goal_alignment).toBe("pending_confirmation");
    expect(merged?.goal_role_today.pending_goal?.status).toBe(
      "awaiting_user_confirmation"
    );
    expect(merged?.goal_role_today.canonical_goal).not.toBe(
      "Read Scripture for 10 minutes"
    );
  });

  it("10. Ambiguous English may remain unknown", () => {
    const merged = parseAndMergeMorningBriefInterpreterResponse({
      input: assembleOrThrow({
        latestOutcome: null,
        matchingOutcomeCount: 0,
        exactThreadMessages: [
          {
            sender: "user",
            sent_at_utc: "2026-08-06T15:00:00.000Z",
            sent_at_local: "2026-08-06 11:00",
            local_day_key: "2026-08-06",
            local_weekday: "Thursday",
            day_relation_to_message: "1_day_before",
            body: "idk maybe later whatever",
          },
        ],
      }),
      raw: JSON.stringify(
        semanticBriefDraft({
          confidence: "low",
          human_situation: {
            most_alive: "unknown",
            direct_question_or_need: "unknown",
            relevant_life_event: "unknown",
            context_use: "unknown",
            identity_use: "unknown",
            person_use: "unknown",
          },
          conversation_continuity: {
            already_acknowledged: "unknown",
            answered_question: "unknown",
            open_loop: "unknown",
            stale_or_exhausted_topics: "unknown",
            do_not_repeat: "unknown",
          },
          coaching_direction: {
            primary_move: "unknown",
            question_policy: "unknown",
            action_guidance: "unknown",
            pressure: "unknown",
          },
          goal_role_today: {
            role: "unknown",
            goal_alignment: "unknown",
            note: "unknown",
          },
        })
      ),
    });
    expect(merged?.human_situation.most_alive).toBe("unknown");
    expect(merged?.coaching_direction.primary_move).toBe("unknown");
  });
});
