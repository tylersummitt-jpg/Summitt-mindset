import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));
import {
  assembleMorningBriefInterpreterInputV1,
  type AssembleMorningBriefInterpreterInputArgs,
} from "@/lib/morning-tto-brief-canonical-input-v1";
import {
  buildFailSoftGoalAlignmentFromCanonical,
  buildLowConfidenceUnknownBriefFromCanonical,
  buildMorningBriefInterpreterMessages,
  buildMorningBriefInterpreterUserMessage,
  buildMorningBriefInterpreterMetadataV1,
  mergeMorningBriefWithCanonicalTruth,
  MORNING_BRIEF_INTERPRETER_MODEL,
  MORNING_BRIEF_INTERPRETER_PROVISIONAL_MODEL,
  MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT,
  parseAndMergeMorningBriefInterpreterResponse,
  runMorningBriefInterpreterV1,
  classifyMorningBriefInterpreterParseFailure,
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
      proactive_decision: "send",
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

  it("shared TEMPORAL POSTURE seals Morning/Evening coaching semantics without phrase tables", () => {
    const p = MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT;
    expect(p).toContain("TEMPORAL POSTURE");
    expect(p).toContain("shared Morning and Evening");
    expect(p).toContain("beginning-of-day receive context");
    expect(p).toContain("today's outcome is already known");
    expect(p).toContain('does not automatically mean "make a plan."');
    expect(p).toContain("near-end-of-day receive context");
    expect(p).toContain('does not automatically mean "the day is over."');
    expect(p).toContain("start-of-day framing");
    expect(p).toContain(
      "evening alone must not imply every goal/action opportunity has already happened"
    );
    expect(p).toContain("later-night action");
    expect(p).toContain("day_relation_to_message");
    expect(p).toContain("do not blindly re-anchor");
    expect(p).toContain("today / tonight / tomorrow / yesterday");
    expect(p).toContain("daypart alone never creates evidence");
    expect(p).toContain("Answer direct user questions when present");
    expect(p).toContain("Current Goal is context, not a compulsory subject");
    expect(p).toContain(
      "Return a single JSON object with sections: version, confidence, human_situation, truth_and_evidence, conversation_continuity, goal_role_today, coaching_direction, boundaries"
    );
    expect(p).toContain("EXACT SCHEMA CONTRACT");
    expect(p).toContain("primary_move=reconnect AND pressure=low");
    expect(p).toContain("never low_pressure_reconnection");
    expect(p).not.toMatch(/Never say ['"]what'?s your plan/i);
    expect(p).not.toMatch(/Never say ['"]how did today go/i);
    expect(p).not.toMatch(/if \(.*daypart/);
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/morning-tto-brief-interpreter-v1.ts"),
      "utf8"
    );
    expect(src).toContain("MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT");
    expect(src).not.toMatch(/EVENING_BRIEF_INTERPRETER_SYSTEM_PROMPT/);
    expect(src).not.toMatch(/daypart === ["']evening["'].*SYSTEM_PROMPT|SYSTEM_PROMPT.*daypart ===/);
  });

  it("same shared interpreter system prompt for morning and evening daypart inputs", () => {
    const morningMessages = buildMorningBriefInterpreterMessages(
      assembleOrThrow({ daypart: "morning" })
    );
    const eveningMessages = buildMorningBriefInterpreterMessages(
      assembleOrThrow({ daypart: "evening" })
    );
    expect(morningMessages[0]?.content).toBe(MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT);
    expect(eveningMessages[0]?.content).toBe(MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT);
    expect(morningMessages[0]?.content).toBe(eveningMessages[0]?.content);
    expect(String(morningMessages[1]?.content)).toContain('"daypart":"morning"');
    expect(String(eveningMessages[1]?.content)).toContain('"daypart":"evening"');
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

  it("uses strict json_schema response_format; at most one technical schema retry", async () => {
    const input = assembleOrThrow();
    expect(
      parseAndMergeMorningBriefInterpreterResponse({
        input,
        raw: JSON.stringify({ ...semanticBriefDraft(), body: "Hey!" }),
      })
    ).toBeNull();

    const create = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{ message: { content: "{bad" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "{still-bad" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    const client = { chat: { completions: { create } } } as never;
    const result = await runMorningBriefInterpreterV1({ input, client });
    expect(result.ok).toBe(false);
    expect(result.brief.confidence).toBe("low");
    expect(result.capture.parsed_brief).toBeNull();
    expect(result.capture.error).toBe("invalid_json");
    expect(result.capture.retry_occurred).toBe(true);
    expect(result.capture.retry_succeeded).toBe(false);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        model: "gpt-5.6-sol",
        reasoning_effort: "low",
        max_completion_tokens: 2500,
        response_format: expect.objectContaining({
          type: "json_schema",
          json_schema: expect.objectContaining({
            name: "morning_coaching_brief_v1",
            strict: true,
          }),
        }),
      })
    );
    expect(create.mock.calls[1]?.[0].model).toBe("gpt-5.6-sol");
    expect(create.mock.calls[1]?.[0].response_format).toEqual(
      create.mock.calls[0]?.[0].response_format
    );
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("temperature");
    expect(result.capture.temperature).toBeNull();
    expect(result.capture.reasoning_effort).toBe("low");
  });

  it("technical retry can recover with exact-schema JSON on second call only", async () => {
    const input = assembleOrThrow();
    const good = JSON.stringify(semanticBriefDraft());
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{ message: { content: "{bad" }, finish_reason: "stop" }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: good }, finish_reason: "stop" }],
      });
    const result = await runMorningBriefInterpreterV1({
      input,
      client: { chat: { completions: { create } } } as never,
    });
    expect(result.ok).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.capture.retry_occurred).toBe(true);
    expect(result.capture.retry_succeeded).toBe(true);
    expect(result.capture.parsed_brief?.coaching_direction.primary_move).toBe(
      "celebrate"
    );
    expect(result.brief.coaching_direction.primary_move).toBe("celebrate");
    expect(result.capture.openai_error).toBeNull();
  });

  it("persists scrubbed openai_error on thrown request while keeping openai_request_failed", async () => {
    const input = assembleOrThrow();
    const err = Object.assign(new Error("Invalid schema"), {
      status: 400,
      code: "invalid_request_error",
      type: "invalid_request_error",
      request_id: "req_interp_1",
      headers: { authorization: "Bearer sk-secret" },
      stack: "Error: Invalid schema\n    at create",
    });
    const create = vi.fn().mockRejectedValue(err);
    const result = await runMorningBriefInterpreterV1({
      input,
      client: { chat: { completions: { create } } } as never,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("openai_request_failed");
    expect(result.capture.error).toBe("openai_request_failed");
    expect(result.capture.openai_error).toEqual({
      name: "Error",
      message: "Invalid schema",
      status: 400,
      code: "invalid_request_error",
      type: "invalid_request_error",
      request_id: "req_interp_1",
    });
    expect(result.brief.confidence).toBe("low");
    expect(JSON.stringify(result.capture.openai_error)).not.toContain("sk-secret");
    expect(JSON.stringify(buildMorningBriefInterpreterMetadataV1(result.capture))).toContain(
      "openai_error"
    );
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

  it("generate path wires Brief into Sol writer (Phase 2D)", () => {
    const generateSrc = readFileSync(
      path.join(process.cwd(), "src/lib/tyler-text-overview-generate.ts"),
      "utf8"
    );
    expect(generateSrc).toMatch(/runObservationalMorningBriefInterpreter/);
    expect(generateSrc).toMatch(/morning-tto-brief-interpreter/);
    expect(generateSrc).toMatch(/writeMorningTtoBody\(\{\s*packet,\s*morningCoachingBrief/);
    const writerSrc = readFileSync(
      path.join(process.cwd(), "src/lib/morning-tto-writer.ts"),
      "utf8"
    );
    expect(writerSrc).toMatch(/MORNING_COACHING_BRIEF_V1/);
    expect(writerSrc).toMatch(/MORNING_TTO_WRITER_MODEL = "gpt-5\.6-sol"/);
    expect(writerSrc).not.toMatch(/runLaneOpenAiJsonWithOneRetry/);
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
            proactive_decision: "send",
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
            proactive_decision: "send",
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
            proactive_decision: "send",
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
            proactive_decision: "send",
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
            proactive_decision: "send",
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

describe("morning brief interpreter schema-contract fixtures", () => {
  it("rejects synonym primary_move tokens the old rich Sol shape used", () => {
    expect(
      parseMorningCoachingBriefV1(
        semanticBriefDraft({
          coaching_direction: {
            primary_move: "low_pressure_reconnection",
            question_policy: "none",
            action_guidance: "none",
            pressure: "low",
            proactive_decision: "send",
          },
        })
      )
    ).toBeNull();
    expect(
      parseMorningCoachingBriefV1(
        semanticBriefDraft({
          coaching_direction: {
            primary_move: "deliver_concise_evening_motivation",
            question_policy: "none",
            action_guidance: "none",
            pressure: "low",
            proactive_decision: "send",
          },
        })
      )
    ).toBeNull();
    expect(
      parseMorningCoachingBriefV1(
        semanticBriefDraft({
          goal_role_today: {
            role: "background_context",
            note: "x",
            goal_alignment: "aligned",
            canonical_goal: "g",
            pending_goal: null,
          },
        })
      )
    ).toBeNull();
  });

  it("accepts exact-schema reconnect + low pressure + question none (Angela-like)", () => {
    const merged = parseAndMergeMorningBriefInterpreterResponse({
      input: assembleOrThrow({
        latestOutcome: null,
        matchingOutcomeCount: 0,
        exactThreadMessages: [
          {
            sender: "user",
            sent_at_utc: "2026-08-01T18:00:00.000Z",
            sent_at_local: "2026-08-01 14:00",
            local_day_key: "2026-08-01",
            local_weekday: "Saturday",
            day_relation_to_message: "older",
            body: "I gave a conference speech yesterday and it went well.",
          },
          {
            sender: "coach",
            sent_at_utc: "2026-08-02T12:00:00.000Z",
            sent_at_local: "2026-08-02 08:00",
            local_day_key: "2026-08-02",
            local_weekday: "Sunday",
            day_relation_to_message: "older",
            body: "Proud of you. How is the bedtime goal going?",
          },
        ],
      }),
      raw: JSON.stringify(
        semanticBriefDraft({
          human_situation: {
            most_alive: "Recent conference speech success; quiet since unanswered goal question",
            relevant_life_event: "Conference speech went well",
            context_use: "relevant",
            identity_use: "background",
            person_use: "do_not_force",
          },
          conversation_continuity: {
            already_acknowledged: ["conference speech success"],
            answered_question: null,
            open_loop: null,
            stale_or_exhausted_topics: ["How is the bedtime goal going?"],
            do_not_repeat: ["How is the bedtime goal going?"],
          },
          goal_role_today: {
            role: "background",
            note: "Bedtime goal is light context; reconnect matters more",
            goal_alignment: "unknown",
            canonical_goal: "Dictate one story before noon",
            pending_goal: null,
          },
          coaching_direction: {
            primary_move: "reconnect",
            question_policy: "none",
            action_guidance: "none",
            pressure: "low",
            proactive_decision: "send",
          },
        })
      ),
    });
    expect(merged?.coaching_direction.primary_move).toBe("reconnect");
    expect(merged?.coaching_direction.pressure).toBe("low");
    expect(merged?.coaching_direction.question_policy).toBe("none");
    expect(merged?.goal_role_today.role).toBe("background");
    expect(merged?.conversation_continuity.do_not_repeat).toEqual(
      expect.arrayContaining(["How is the bedtime goal going?"])
    );
  });

  it("Dennis: explicit motivational request → support, goal background, no forced accountability", () => {
    const input = assembleOrThrow({
      daysSinceLastUserResponse: 2,
      recentUnansweredOutboundCount: 2,
      canonicalGoalText: "Walk 20 minutes",
      latestOutcome: null,
      matchingOutcomeCount: 0,
      exactThreadMessages: [
        {
          sender: "user",
          sent_at_utc: "2026-07-20T15:00:00.000Z",
          sent_at_local: "2026-07-20 11:00",
          local_day_key: "2026-07-20",
          local_weekday: "Monday",
          day_relation_to_message: "older",
          body: "Keep texting me twice a day. Motivational, energetic and focused topics.",
        },
        {
          sender: "user",
          sent_at_utc: "2026-07-25T15:00:00.000Z",
          sent_at_local: "2026-07-25 11:00",
          local_day_key: "2026-07-25",
          local_weekday: "Saturday",
          day_relation_to_message: "older",
          body: "Keep motivational texts coming.",
        },
        {
          sender: "coach",
          sent_at_utc: "2026-08-05T12:00:00.000Z",
          sent_at_local: "2026-08-05 08:00",
          local_day_key: "2026-08-05",
          local_weekday: "Wednesday",
          day_relation_to_message: "1_day_before",
          body: "You've got this — stay locked in today.",
        },
        {
          sender: "coach",
          sent_at_utc: "2026-08-06T12:00:00.000Z",
          sent_at_local: "2026-08-06 08:00",
          local_day_key: "2026-08-06",
          local_weekday: "Thursday",
          day_relation_to_message: "same_day",
          body: "Energy up. One focused block.",
        },
      ],
    });
    expect(input.mechanical.recent_unanswered_outbound_count).toBe(2);
    const merged = parseAndMergeMorningBriefInterpreterResponse({
      input,
      raw: JSON.stringify(
        semanticBriefDraft({
          human_situation: {
            most_alive:
              "User explicitly asked for ongoing motivational texts; recent coach motivation unanswered",
            context_use: "relevant",
          },
          conversation_continuity: {
            already_acknowledged: ["Keep motivational texts coming"],
            answered_question: null,
            open_loop: null,
            stale_or_exhausted_topics: [],
            do_not_repeat: [],
          },
          goal_role_today: {
            role: "background",
            note: "Walking goal is supporting context; relationship request is the live ask",
            goal_alignment: "unknown",
            canonical_goal: "Walk 20 minutes",
            pending_goal: null,
          },
          coaching_direction: {
            primary_move: "support",
            question_policy: "none",
            action_guidance: "none",
            pressure: "low",
            proactive_decision: "send",
          },
          truth_and_evidence: {
            outcome: "no_recent_evidence",
            evidence_note: "No completion/miss evidence",
            evidence_strength: "none",
            consistency_supported: false,
            latest_user_truth: null,
            proof_claims_allowed: {
              completion: false,
              miss: false,
              partial: false,
              proof: false,
            },
          },
        })
      ),
    });
    expect(merged?.coaching_direction.primary_move).toBe("support");
    expect(merged?.coaching_direction.question_policy).toBe("none");
    expect(merged?.goal_role_today.role).toBe("background");
    expect(merged?.truth_and_evidence.proof_claims_allowed).toEqual({
      completion: false,
      miss: false,
      partial: false,
      proof: false,
    });
    expect(merged?.coaching_direction.primary_move).not.toBe("challenge");
  });

  it("Angel: health recovery + open loop → continue/close_loop + one useful question", () => {
    const merged = parseAndMergeMorningBriefInterpreterResponse({
      input: assembleOrThrow({
        daypart: "evening",
        localWeekday: "Friday",
        exactThreadMessages: [
          {
            sender: "user",
            sent_at_utc: "2026-08-06T20:00:00.000Z",
            sent_at_local: "2026-08-06 16:00",
            local_day_key: "2026-08-06",
            local_weekday: "Thursday",
            day_relation_to_message: "1_day_before",
            body: "Finger is improving. I still need to make those calls.",
          },
        ],
      }),
      raw: JSON.stringify(
        semanticBriefDraft({
          human_situation: {
            most_alive: "Improving finger; calls still open",
            relevant_life_event: "Finger recovery",
            context_use: "relevant",
          },
          conversation_continuity: {
            already_acknowledged: ["finger improving"],
            answered_question: null,
            open_loop: "Make the planned calls",
            stale_or_exhausted_topics: [],
            do_not_repeat: [],
          },
          coaching_direction: {
            primary_move: "close_loop",
            question_policy: "one_useful_question",
            action_guidance: "none",
            pressure: "normal",
            proactive_decision: "send",
          },
          goal_role_today: {
            role: "background",
            note: "Calls open loop is more alive than goal homework",
            goal_alignment: "unknown",
            canonical_goal: "Dictate one story before noon",
            pending_goal: null,
          },
        })
      ),
    });
    expect(merged?.conversation_continuity.open_loop).toBe("Make the planned calls");
    expect(merged?.coaching_direction.question_policy).toBe("one_useful_question");
    expect(merged?.human_situation.relevant_life_event).toContain("Finger");
  });

  it("Anne/Cari: long silence → reconnect, low pressure, no invented miss, often no question", () => {
    const input = assembleOrThrow({
      daysSinceLastUserResponse: 57,
      neverReplied: false,
      recentUnansweredOutboundCount: 4,
      latestOutcome: null,
      matchingOutcomeCount: 0,
    });
    const merged = parseAndMergeMorningBriefInterpreterResponse({
      input,
      raw: JSON.stringify(
        semanticBriefDraft({
          human_situation: {
            most_alive: "Long silence after repeated coach check-ins",
            context_use: "do_not_force",
          },
          conversation_continuity: {
            already_acknowledged: [],
            answered_question: null,
            open_loop: null,
            stale_or_exhausted_topics: ["prior unanswered check-ins"],
            do_not_repeat: ["prior unanswered check-ins"],
          },
          coaching_direction: {
            primary_move: "reconnect",
            question_policy: "none",
            action_guidance: "none",
            pressure: "low",
            proactive_decision: "send",
          },
          truth_and_evidence: {
            outcome: "no_recent_evidence",
            evidence_note: "No usable recent user evidence",
            evidence_strength: "none",
            consistency_supported: false,
            latest_user_truth: null,
            proof_claims_allowed: {
              completion: false,
              miss: false,
              partial: false,
              proof: false,
            },
          },
        })
      ),
    });
    expect(merged?.coaching_direction.primary_move).toBe("reconnect");
    expect(merged?.coaching_direction.pressure).toBe("low");
    expect(merged?.coaching_direction.question_policy).toBe("none");
    expect(merged?.truth_and_evidence.outcome).toBe("no_recent_evidence");
    expect(merged?.truth_and_evidence.proof_claims_allowed.miss).toBe(false);
  });

  it("Cheryl evening: before-bed goal still ahead → no invented outcome; one useful question ok", () => {
    const merged = parseAndMergeMorningBriefInterpreterResponse({
      input: assembleOrThrow({
        daypart: "evening",
        canonicalGoalText: "Stretch for 10 minutes before bed",
        latestOutcome: null,
        matchingOutcomeCount: 0,
      }),
      raw: JSON.stringify(
        semanticBriefDraft({
          human_situation: {
            most_alive: "Before-bed stretch opportunity still ahead tonight",
            context_use: "relevant",
          },
          goal_role_today: {
            role: "central",
            note: "Evening target; completion window not closed",
            goal_alignment: "aligned",
            canonical_goal: "Stretch for 10 minutes before bed",
            pending_goal: null,
          },
          coaching_direction: {
            primary_move: "simplify_next_move",
            question_policy: "one_useful_question",
            action_guidance: "one_specific_next_step",
            pressure: "normal",
            proactive_decision: "send",
          },
          truth_and_evidence: {
            outcome: "no_recent_evidence",
            evidence_note: "No outcome yet for tonight's before-bed action",
            evidence_strength: "none",
            consistency_supported: false,
            latest_user_truth: null,
            proof_claims_allowed: {
              completion: false,
              miss: false,
              partial: false,
              proof: false,
            },
          },
        })
      ),
    });
    expect(merged?.goal_role_today.role).toBe("central");
    expect(merged?.truth_and_evidence.outcome).toBe("no_recent_evidence");
    expect(merged?.coaching_direction.question_policy).toBe("one_useful_question");
    expect(merged?.truth_and_evidence.proof_claims_allowed.miss).toBe(false);
  });

  it("source has no deterministic synonym mapper for rich Sol tokens", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/morning-tto-brief-interpreter-v1.ts"),
      "utf8"
    );
    const schemaSrc = readFileSync(
      path.join(process.cwd(), "src/lib/morning-tto-coaching-brief-json-schema-v1.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/low_pressure_reconnection\s*[=:]/);
    expect(src).not.toMatch(/background_context\s*→|supporting_context\s*→/);
    expect(src).not.toMatch(/mapRichSol|synonymMapper|normalizePrimaryMove/);
    expect(schemaSrc).toContain("MORNING_BRIEF_INTERPRETER_RESPONSE_FORMAT");
    expect(schemaSrc).toContain('type: "json_schema"');
  });

  it("classifyMorningBriefInterpreterParseFailure splits invalid_json vs schema", () => {
    expect(classifyMorningBriefInterpreterParseFailure("{bad")).toBe("invalid_json");
    expect(classifyMorningBriefInterpreterParseFailure(null)).toBe("invalid_json");
    expect(
      classifyMorningBriefInterpreterParseFailure(
        JSON.stringify({ version: "wrong", confidence: "low" })
      )
    ).toBe("schema_validation_failed");
  });
});
