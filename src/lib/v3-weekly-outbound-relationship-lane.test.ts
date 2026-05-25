import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  __esModule: true,
  default: class MockOpenAI {
    chat = {
      completions: {
        create: createMock,
      },
    };
  },
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { isV3RelationshipVoiceReplySource } from "@/lib/north-star-coach-sms";
import { applyFinalVoiceOwnershipGate } from "@/lib/v3-sms-voice-ownership";
import type { WeeklyV3OutboundFacts } from "@/lib/v3-weekly-outbound-relationship-lane";
import {
  buildWeeklyGoalAdjustmentLaneGuardrails,
  buildWeeklyPlannedInterruptionLaneGuardrails,
  produceWeeklyV3RelationshipSms,
  weeklyLaneLocalValidation,
} from "@/lib/v3-weekly-outbound-relationship-lane";

function baseFacts(overrides?: Partial<WeeklyV3OutboundFacts>): WeeklyV3OutboundFacts {
  const core: WeeklyV3OutboundFacts = {
    user: {
      clerk_user_id: "user_weekly_test",
      preferred_name: "Jordan",
      timezone: "America/Chicago",
      local_date: "2026-05-10",
      local_time: "12:05",
      sms_engagement_summary: "Replied to 3 checks this week",
    },
    commitment: {
      active_commitment_id: "cmt_w1",
      behavior_statement: "Protect one hour for deep work before noon",
      effective_ask: "Protect one hour for deep work before noon",
      commitment_state: "active_accountability",
      identity_anchor: null,
    },
    thread: {
      latest_outbound_preview: "Where did the hour land yesterday?",
      latest_inbound_preview: "Slid to afternoon",
      recent_transcript_lines: ["Coach: Where did the hour land?", "User: Slid to afternoon"],
      recent_exact_thread_text: null,
      last_outbound_full_body: null,
      last_inbound_full_body: null,
      last_5_coach_questions: [],
      last_5_user_answers: [],
      latest_open_question: "What time is the real first block tomorrow?",
      latest_answer_after_open_question: null,
      open_question_pending: true,
      open_question_source: null,
      answer_source: null,
      projection_used: false,
      memory_packet_used: false,
      recent_exact_message_count: null,
      do_not_repeat_hints: ["Do not re-ask yesterday's exact time"],
      coaching_memory_snippet: "User prefers morning blocks.",
      memory_priority_rules: [],
    },
    weekly_proof: {
      week_start: "2026-05-04",
      week_end: "2026-05-10",
      completed_count: 4,
      missed_count: 1,
      partial_count: 1,
      blocker_count: 1,
      proof_moment_hints: ["Showed up after a miss"],
      win_hints: ["Four protected mornings"],
      comeback_hints: ["Recovered mid-week"],
      repeated_blocker_hints: [],
      notable_pattern: "Morning slips, afternoon recovery",
      silent_week: false,
      rough_week: true,
      strong_week: false,
      old_weekly_proof_body_preview: "UNIQUE_OLD_PROOF_SNIPPET_XYZ98765 for telemetry only",
      deterministic_weekly_body_preview: "UNIQUE_DETERMINISTIC_SNIPPET_ABC43210",
      legacy_reflection_preview: "UNIQUE_LEGACY_REFLECTION_SNIPPET_QRS11111",
      legacy_template_preview: "UNIQUE_LEGACY_TEMPLATE_SNIPPET_MNO22222",
    },
    route: {
      route_purpose: "weekly_proof_v2",
      fully_on_v2: true,
      reason_for_send: "sunday_weekly_touchpoint",
      legacy_weekly_branch: false,
    },
  };
  if (!overrides) return core;
  return {
    ...core,
    ...overrides,
    user: { ...core.user, ...overrides.user },
    commitment: { ...core.commitment, ...overrides.commitment },
    thread: { ...core.thread, ...overrides.thread },
    weekly_proof: { ...core.weekly_proof, ...overrides.weekly_proof },
    route: { ...core.route, ...overrides.route },
  };
}

function validWeeklyJson(body: string) {
  return JSON.stringify({
    should_send: true,
    body,
    no_send_reason: null,
    route_purpose: "weekly_proof_v2",
    voice_confidence: 0.78,
    used_facts: ["rough_week"],
    safety_notes: [],
  });
}

describe("produceWeeklyV3RelationshipSms", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.clearAllMocks();
  });

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("happy path: valid JSON → body, shouldSend true, replySource v3_weekly_relationship_lane", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: validWeeklyJson(
              "Rough week, but you still fought for mornings. What is the smallest guardrail before noon tomorrow?"
            ),
          },
        },
      ],
    });

    const r = await produceWeeklyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: ["v2_weekly_proof_pack_fixture"],
    });
    expect(r.shouldSend).toBe(true);
    expect(r.body).toContain("smallest guardrail");
    expect(r.replySource).toBe("v3_weekly_relationship_lane");
    expect(r.routePurpose).toBe("weekly_proof_v2");
    expect(r.openAiOk).toBe(true);
    expect(r.metadata.weekly_v3_lane_used).toBe(true);
    expect(r.metadata.secondary_v3_lane_used).toBe(true);
    expect(r.metadata.old_weekly_writer_used_as_voice).toBe(false);
    expect(r.metadata.v3_lane_reply_source).toBe("v3_weekly_relationship_lane");
  });

  it("no API key → shouldSend false, empty body", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await produceWeeklyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.body).toBe("");
    expect(r.noSendReason).toBe("openai_unavailable");
    expect(r.openAiOk).toBe(false);
  });

  it("invalid JSON on first completion succeeds after one strict JSON retry", async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ message: { content: "not-json" } }] })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: validWeeklyJson(
                "You kept showing up despite friction. What is one anchor for next week?"
              ),
            },
          },
        ],
      });
    const r = await produceWeeklyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(r.shouldSend).toBe(true);
    expect(r.metadata.lane_json_retry_attempted).toBe(true);
    expect(r.metadata.lane_json_retry_succeeded).toBe(true);
  });

  it("returns shouldSend=false on invalid JSON when strict retry also fails", async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ message: { content: "not-json" } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: "{broken" } }] });
    const r = await produceWeeklyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.body).toBe("");
    expect(r.noSendReason).toBe("invalid_json");
    expect(r.openAiOk).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(r.metadata.lane_json_retry_attempted).toBe(true);
    expect(r.metadata.lane_json_retry_succeeded).toBe(false);
    expect(r.metadata.lane_stage).toBe("parse");
    expect(r.metadata.original_raw_preview).toBeDefined();
    expect(r.metadata.retry_raw_preview).toBeDefined();
  });

  it("model should_send false → shouldSend false, no fallback body", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: false,
              body: "",
              no_send_reason: "thin_context",
              route_purpose: "weekly_proof_v2",
              voice_confidence: null,
              used_facts: [],
              safety_notes: [],
            }),
          },
        },
      ],
    });
    const r = await produceWeeklyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.body).toBe("");
    expect(r.noSendReason).toBe("thin_context");
  });

  it("empty body after should_send true → shouldSend false", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "   ",
              no_send_reason: null,
              route_purpose: "weekly_proof_v2",
              voice_confidence: null,
              used_facts: [],
              safety_notes: [],
            }),
          },
        },
      ],
    });
    const r = await produceWeeklyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.body).toBe("");
    expect(r.noSendReason).toBe("empty_body_after_should_send");
  });

  it("repairable let_me_know_how_it_went triggers lane repair then sends", async () => {
    const cliche =
      "Rough week, but you still logged wins. Who showed up for you this week? Let me know how it went.";
    createMock
      .mockResolvedValueOnce({
        choices: [{ message: { content: validWeeklyJson(cliche) } }],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: "Rough week, but you still logged wins. Who showed up for you this week?",
                used_strategy: "compress_remove_cliche",
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const r = await produceWeeklyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(r.shouldSend).toBe(true);
    expect(r.body.toLowerCase()).not.toContain("let me know how it went");
    expect(r.metadata.lane_repair_attempted).toBe(true);
    expect(r.metadata.lane_repair_succeeded).toBe(true);
    expect(r.metadata.lane_stage).toBe("post_validate_repaired");
    expect(r.metadata.repaired_blocked_reasons).toEqual([]);
    expect(r.metadata.original_blocked_reasons).toContain("let_me_know_how_it_went");
    expect(r.metadata.repaired_candidate_body).toBeTruthy();
  });

  it("lane repair output is revalidated; still-failing repair no-sends", async () => {
    const wordy =
      "Great job on the week! You kept momentum and this journey felt powerful. Let me know how it went!";
    createMock
      .mockResolvedValueOnce({
        choices: [{ message: { content: validWeeklyJson(wordy) } }],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: "Still great job on the week — keep the momentum going on this journey!",
                used_strategy: "still_cliche",
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const r = await produceWeeklyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("lane_post_validate_blocked");
    expect(r.metadata.lane_stage).toBe("post_validate_repair_failed");
    expect(r.metadata.lane_repair_attempted).toBe(true);
    expect(r.metadata.lane_repair_succeeded).toBe(false);
    expect(Array.isArray(r.metadata.repaired_blocked_reasons)).toBe(true);
    expect((r.metadata.repaired_blocked_reasons as string[]).length).toBeGreaterThan(0);
  });

  it("hard local preview echo does not attempt lane repair", async () => {
    const facts = baseFacts();
    const echo = facts.weekly_proof.old_weekly_proof_body_preview!.slice(0, 48);
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: validWeeklyJson(`${echo} — so that is the line.`),
          },
        },
      ],
    });
    const r = await produceWeeklyV3RelationshipSms({
      facts,
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("lane_post_validate_blocked");
    expect(r.body).toBe("");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(r.metadata.lane_repair_attempted).toBeFalsy();
    expect(r.metadata.lane_stage).toBe("post_validate_blocked");
    expect(r.metadata.hard_blocked_reasons).toEqual(
      expect.arrayContaining(["echoes_old_proof_preview"])
    );
  });

  it("hard FVG say_it_straight does not attempt lane repair", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: validWeeklyJson("Say it straight — what is the one move for next week?"),
          },
        },
      ],
    });
    const r = await produceWeeklyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("lane_post_validate_blocked");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(r.metadata.lane_repair_attempted).toBeFalsy();
    expect(r.metadata.hard_blocked_reasons).toContain("say_it_straight");
  });

  it("repaired body is revalidated against weekly local validation (preview echo still blocked)", async () => {
    const facts = baseFacts();
    const echo = facts.weekly_proof.old_weekly_proof_body_preview!.slice(0, 48);
    const softOnly = "You had a wobbly week. Let me know how it went?";
    createMock
      .mockResolvedValueOnce({
        choices: [{ message: { content: validWeeklyJson(softOnly) } }],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: `${echo} — repaired but still echoes preview.`,
                used_strategy: "bad_echo",
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const r = await produceWeeklyV3RelationshipSms({
      facts,
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.metadata.lane_stage).toBe("post_validate_repair_failed");
    expect(r.metadata.repaired_blocked_reasons).toEqual(
      expect.arrayContaining(["echoes_old_proof_preview"])
    );
    expect(weeklyLaneLocalValidation(r.metadata.repaired_candidate_body as string, facts)).toContain(
      "echoes_old_proof_preview"
    );
  });

  it("does not ship old weekly proof preview text as final body (mocked safe body)", async () => {
    const facts = baseFacts();
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: validWeeklyJson(
              "Week had friction; one clean hour still showed up. What is the first block tomorrow?"
            ),
          },
        },
      ],
    });
    const r = await produceWeeklyV3RelationshipSms({
      facts,
      telemetry_fact_sources: ["preview_only"],
    });
    expect(r.body).not.toContain("UNIQUE_OLD_PROOF_SNIPPET");
    expect(r.body).not.toContain(facts.weekly_proof.old_weekly_proof_body_preview!.slice(0, 24));
  });

  it("does not ship legacy reflection/template preview strings in body", async () => {
    const facts = baseFacts();
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: validWeeklyJson(
              "You kept answering even when the week wobbled. What is one non-negotiable anchor for next week?"
            ),
          },
        },
      ],
    });
    const r = await produceWeeklyV3RelationshipSms({
      facts,
      telemetry_fact_sources: [],
    });
    expect(r.body).not.toContain("UNIQUE_LEGACY_REFLECTION_SNIPPET");
    expect(r.body).not.toContain("UNIQUE_LEGACY_TEMPLATE_SNIPPET");
  });

  it("isV3RelationshipVoiceReplySource recognizes v3_weekly_relationship_lane", () => {
    expect(isV3RelationshipVoiceReplySource("v3_weekly_relationship_lane")).toBe(true);
  });

  it("system prompt includes recent exact thread and projection priority (M2B-6)", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: validWeeklyJson("Solid week — one thread to carry into next week."),
          },
        },
      ],
    });
    await produceWeeklyV3RelationshipSms({
      facts: baseFacts({
        thread: {
          ...baseFacts().thread,
          memory_packet_used: true,
          projection_used: true,
          recent_exact_thread_text: "Coach: What story will you dictate today?\nUser: Sunday School",
        },
      }),
      telemetry_fact_sources: [],
    });
    const systemMsg = createMock.mock.calls[0]?.[0]?.messages?.[0]?.content as string;
    expect(systemMsg).toContain("recent_exact_thread_text");
    expect(systemMsg).toContain("projection_used");
    expect(systemMsg).toContain("last_5_coach_questions");
  });

  it("repairs repeated prior answered question on weekly (M2B-6)", async () => {
    const rbQ = "What story will you dictate today?";
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: validWeeklyJson(rbQ),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: "Sunday School, the farm, and your mother's songs are a rich thread this week — which one feels alive to start?",
                used_strategy: "memory_repeat_repair",
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const r = await produceWeeklyV3RelationshipSms({
      facts: baseFacts({
        thread: {
          ...baseFacts().thread,
          memory_packet_used: true,
          projection_used: true,
          last_5_coach_questions: [rbQ],
          latest_open_question: rbQ,
          latest_answer_after_open_question: "Sunday School, farm, songs Mother sang",
          open_question_pending: false,
          do_not_repeat_hints: [rbQ],
        },
      }),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(true);
    expect(r.body).not.toBe(rbQ);
    expect(r.metadata.memory_repeat_guard_succeeded).toBe(true);
  });

  it("no-sends when weekly memory repeat repair still repeats (M2B-6)", async () => {
    const rbQ = "What story will you dictate today?";
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: validWeeklyJson(rbQ),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: rbQ,
                used_strategy: "memory_repeat_repair",
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const r = await produceWeeklyV3RelationshipSms({
      facts: baseFacts({
        thread: {
          ...baseFacts().thread,
          memory_packet_used: true,
          last_5_coach_questions: [rbQ],
          latest_open_question: rbQ,
          latest_answer_after_open_question: "Sunday School, farm, songs Mother sang",
          open_question_pending: false,
          do_not_repeat_hints: [rbQ],
        },
      }),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("weekly_thread_memory_repeat_blocked");
    expect(r.metadata.memory_repeat_no_send_reason).toBe("still_repeated_after_repair");
  });

  it("allows weekly memory callback without re-asking (M2B-6)", async () => {
    const rbQ = "What story will you dictate today?";
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: validWeeklyJson("Use Sunday School or the farm this week."),
          },
        },
      ],
    });
    const r = await produceWeeklyV3RelationshipSms({
      facts: baseFacts({
        thread: {
          ...baseFacts().thread,
          memory_packet_used: true,
          last_5_coach_questions: [rbQ],
          latest_open_question: rbQ,
          latest_answer_after_open_question: "Sunday School, farm, songs Mother sang",
          open_question_pending: false,
          do_not_repeat_hints: [rbQ],
        },
      }),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(true);
    expect(r.metadata.memory_repeat_guard_attempted).toBeFalsy();
  });

  it("system prompt includes weekly planned interruption guardrail when active", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: validWeeklyJson(
              "Pause week — when you are back, one honest morning block is enough for next week."
            ),
          },
        },
      ],
    });
    await produceWeeklyV3RelationshipSms({
      facts: baseFacts({
        commitment: {
          ...baseFacts().commitment,
          planned_interruption_active: true,
          planned_interruption_reason_category: "vacation",
          planned_interruption_resume_hint: "next week",
        },
        weekly_proof: {
          ...baseFacts().weekly_proof,
          planned_pause_week: true,
          silent_week: true,
          rough_week: false,
        },
      }),
      telemetry_fact_sources: [],
    });
    const systemMsg = createMock.mock.calls[0]?.[0]?.messages?.[0]?.content as string;
    expect(systemMsg).toContain("planned_pause_week");
    expect(systemMsg).toContain("WEEKLY PAT PAUSE");
    expect(systemMsg).toContain("No YES/NO");
    expect(systemMsg).toContain("not failure");
  });

  it("builds when planned_interruption fields missing", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: validWeeklyJson("Solid week — one anchor for next week."),
          },
        },
      ],
    });
    const r = await produceWeeklyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(true);
    const systemMsg = createMock.mock.calls[0]?.[0]?.messages?.[0]?.content as string;
    expect(systemMsg).not.toContain("WEEKLY PAT PAUSE");
  });

  it("buildWeeklyPlannedInterruptionLaneGuardrails mentions no shame and no YES/NO menu", () => {
    const g = buildWeeklyPlannedInterruptionLaneGuardrails();
    expect(g).toMatch(/not failure|honest context/i);
    expect(g).toMatch(/Do not shame silence/i);
    expect(g).toMatch(/No YES\/NO/i);
  });

  it("system prompt includes weekly goal adjustment no-mutation guardrail", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: validWeeklyJson("Solid week — one honest standard for next week."),
          },
        },
      ],
    });
    await produceWeeklyV3RelationshipSms({
      facts: baseFacts({
        commitment: {
          ...baseFacts().commitment,
          goal_adjustment_move: "shrink_temporary",
          goal_adjustment_mention_allowed: true,
          goal_adjustment_requires_confirmation: true,
          goal_adjustment_compatible_flow: "overlay",
        },
      }),
      telemetry_fact_sources: [],
    });
    const systemMsg = createMock.mock.calls[0]?.[0]?.messages?.[0]?.content as string;
    expect(systemMsg).toContain("WEEKLY GOAL_ADJUSTMENT");
    expect(systemMsg).toMatch(/not permission to mutate/i);
    expect(systemMsg).toMatch(/Do not create a YES\/NO menu/i);
  });

  it("buildWeeklyGoalAdjustmentLaneGuardrails says raise_bar is invitation not command", () => {
    const g = buildWeeklyGoalAdjustmentLaneGuardrails();
    expect(g).toMatch(/raise_bar.*invitation/i);
    expect(g).toMatch(/not a command/i);
  });

  it("buildWeeklyGoalAdjustmentLaneGuardrails says pause_cadence honors pause", () => {
    const g = buildWeeklyGoalAdjustmentLaneGuardrails();
    expect(g).toMatch(/pause_cadence|planned_interruption_active/i);
    expect(g).toMatch(/avoid failure framing/i);
  });

  it("builds when goal_adjustment fields absent", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: validWeeklyJson("You kept showing up — what is one anchor for next week?"),
          },
        },
      ],
    });
    const r = await produceWeeklyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(true);
    const systemMsg = createMock.mock.calls[0]?.[0]?.messages?.[0]?.content as string;
    expect(systemMsg).toContain("WEEKLY GOAL_ADJUSTMENT");
    expect(baseFacts().commitment.goal_adjustment_move).toBeUndefined();
  });

  it("applyFinalVoiceOwnershipGate accepts safe weekly body with v3_weekly_relationship_lane", async () => {
    delete process.env.OPENAI_API_KEY;
    const gated = await applyFinalVoiceOwnershipGate({
      proposedBody:
        "Rough week but you still logged mornings — what is the first protected block tomorrow?",
      replySource: "v3_weekly_relationship_lane",
      channel: "weekly_sms",
      activeCommitmentId: "cmt_w1",
      effectiveAsk: "Morning hour",
      normalCoaching: true,
    });
    expect(gated.shouldSend).toBe(true);
    expect(gated.voiceOwner).toBe("v3_openai");
  });
});
