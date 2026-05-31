import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

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

import { applyFinalVoiceOwnershipGate } from "@/lib/v3-sms-voice-ownership";
import { computeRecommitBindingText } from "@/lib/v2-adaptive-contract";
import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";
import { buildSmsGoalAdjustmentLaneGuardrails } from "@/lib/sms-goal-adjustment-signal";
import { buildPlannedInterruptionLaneGuardrails } from "@/lib/sms-planned-interruption";
import { buildSmsPatternSignalLaneGuardrails } from "@/lib/sms-pattern-signal";
import { buildVictoryBackgroundLaneGuardrails } from "@/lib/sms-victory-background-context";
import { deriveTimingAnchorMemory } from "@/lib/timing-anchor-memory";
import {
  DEFAULT_CONTRACT_WRAPPER_MUST_NOT_REPEAT,
  detectContractWrapperDuplicates,
  deriveSuggestedCoachingMoveForDailyFacts,
  enrichDailyFactsWithThreadFreshness,
  produceDailyV3RelationshipSms,
} from "@/lib/v3-daily-relationship-lane";
import { buildThreadFreshnessPromptGuidance } from "@/lib/sms-thread-freshness";
import { RELATIONSHIP_MEMORY_30D_WINDOW_DAYS } from "@/lib/sms-relationship-memory-30d";

function countSubstringOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    count += 1;
    from = idx + needle.length;
  }
  return count;
}

function baseFacts(overrides?: Partial<DailyV3RelationshipFacts>): DailyV3RelationshipFacts {
  const core: DailyV3RelationshipFacts = {
    route_kind: "main_active_accountability",
    accountability_day_key: "2026-05-12",
    user: {
      clerk_user_id: "user_test",
      preferred_name: "Alex",
      timezone: "America/Chicago",
      local_time_iso: "2026-05-12T09:00:00.000Z",
      relationship_profile_summary: null,
    },
    commitment: {
      id: "cmt_1",
      title: "Morning focus",
      behavior_statement: "Two hours of deep work before noon",
      effective_ask: "Two hours of deep work before noon",
      accountability_phase: "active_accountability",
      identity_anchor_allowed: false,
      identity_anchor_short: null,
    },
    thread_memory: {
      latest_outbound_sms: "How did yesterday land?",
      latest_inbound_sms: "Rough start",
      recent_transcript_or_context_block: "Coach: …\nUser: …",
      latest_open_question: null,
      do_not_repeat_hints: [],
      coaching_memory_snippet: "COACHING_MEMORY…",
      recent_pattern_hints: null,
    },
    accountability: {
      daily_purpose: "standard_accountability_check",
      server_strategy: "standard_check",
      next_move_type: "hold_standard",
      prior_outcome: "user_no",
      yes_streak_14d: 1,
      no_count_14d: 2,
      partial_count_14d: 0,
      blocker_preview: "meetings",
      proof_or_milestone_signal: null,
      silence_tier: "none",
      unanswered_checks: 0,
      days_since_last_user_outcome: 1,
      reentry_active: false,
      overlay_active: false,
      evolution_pattern_hint: null,
      contract_proposal_mode: false,
    },
    suggested_coaching_move: "ask_completion",
    constraints: {
      max_chars: 300,
      one_sms: true,
      no_raw_title_or_behavior_paste: true,
      no_generic_motivation: true,
      if_unsafe_return_no_send: true,
    },
  };
  return { ...core, ...overrides };
}

describe("deriveSuggestedCoachingMoveForDailyFacts", () => {
  it("returns close_prior_plan_loop when pending_plan_proof is active", () => {
    const f = baseFacts({
      accountability: {
        ...baseFacts().accountability,
        pending_plan_proof: {
          active: true,
          plan_summary_hint: "plan after workout",
          anchor_phrase_hint: "after Brooke's workout",
          anchor_key: "brooke|workout",
          plan_for_day_key: "2026-05-11",
          source_answer_preview: "I will after Brooke",
          recurrence_confidence: "unknown",
          outcome_known: false,
        },
      },
    });
    expect(deriveSuggestedCoachingMoveForDailyFacts(f)).toBe("close_prior_plan_loop");
  });
});

describe("produceDailyV3RelationshipSms prompt guidance (plan proof + timing anchor)", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.clearAllMocks();
  });

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Quick check — did yesterday's block happen: done, partial, or missed?",
              no_send_reason: null,
              turn_purpose: "daily_check",
              voice_confidence: 0.8,
              used_facts: ["pending_plan_proof"],
              safety_notes: [],
            }),
          },
        },
      ],
    });
  });

  it("includes pending plan and timing anchor guidance for Brooke-style facts", async () => {
    const pending = {
      active: true as const,
      plan_summary_hint: "distribution after Brooke workout",
      anchor_phrase_hint: "after Brooke's workout",
      anchor_key: "brooke|workout",
      plan_for_day_key: "2026-05-11",
      source_answer_preview: "I'll do it after Brooke gets back from her workout.",
      recurrence_confidence: "unknown" as const,
      outcome_known: false as const,
    };
    const timing = deriveTimingAnchorMemory({
      latestAnswerAfterOpenQuestion: pending.source_answer_preview,
      pendingPlanProof: pending,
    });
    await produceDailyV3RelationshipSms({
      facts: baseFacts({
        suggested_coaching_move: "close_prior_plan_loop",
        accountability: {
          ...baseFacts().accountability,
          pending_plan_proof: pending,
          timing_anchor_memory: timing,
        },
        thread_memory: {
          ...baseFacts().thread_memory,
          latest_answer_after_open_question: pending.source_answer_preview,
          open_question_pending: false,
        },
      }),
      telemetry_fact_sources: ["test_fixture"],
    });
    const systemMsg = createMock.mock.calls[0]?.[0]?.messages?.find(
      (m: { role: string }) => m.role === "system"
    )?.content as string;
    expect(systemMsg).toContain("OPEN QUESTION / LATEST ANSWER PRIORITY");
    expect(systemMsg).toContain("PENDING PLAN PROOF");
    expect(systemMsg).toContain("TIMING ANCHOR CONFIDENCE");
    expect(systemMsg).toMatch(/plan\/intention, not proof/i);
    expect(systemMsg).toMatch(/mentioned_once/i);
    expect(systemMsg).not.toMatch(
      /If thread_memory\.open_question_pending is false and latest_answer_after_open_question is set, move forward from that answer — do not ask that open question again/
    );
  });

  it("Test 10 — repairs overconfident anchor wording via post-validate path", async () => {
    const pending = {
      active: true as const,
      plan_summary_hint: "distribution after workout",
      anchor_phrase_hint: "after Brooke's workout",
      anchor_key: "brooke|workout",
      plan_for_day_key: "2026-05-11",
      source_answer_preview: "I'll do it after Brooke gets back from her workout.",
      recurrence_confidence: "unknown" as const,
      outcome_known: false as const,
    };
    const timing = deriveTimingAnchorMemory({
      latestAnswerAfterOpenQuestion: pending.source_answer_preview,
      pendingPlanProof: pending,
    });
    const bad =
      "After Brooke's workout, dive into those two hours and make the most of that time.";
    const repaired =
      "Yesterday you named the Brooke workout window — did the two hours happen: done, partial, or missed?";
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: bad,
                no_send_reason: null,
                turn_purpose: "daily_check",
                voice_confidence: 0.8,
                used_facts: [],
                safety_notes: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: repaired,
                used_strategy: "timing_anchor_confidence_repair",
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const r = await produceDailyV3RelationshipSms({
      facts: baseFacts({
        suggested_coaching_move: "close_prior_plan_loop",
        accountability: {
          ...baseFacts().accountability,
          pending_plan_proof: pending,
          timing_anchor_memory: timing,
        },
        thread_memory: {
          ...baseFacts().thread_memory,
          latest_answer_after_open_question: pending.source_answer_preview,
          open_question_pending: false,
        },
      }),
      telemetry_fact_sources: ["test_fixture"],
    });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(r.shouldSend).toBe(true);
    expect(r.metadata.lane_repair_attempted).toBe(true);
    expect(r.metadata.lane_repair_succeeded).toBe(true);
    expect(r.metadata.original_blocked_reasons).toContain("presumed_recurring_anchor_schedule");
    expect(r.body).toMatch(/did the two hours happen/i);
  });

  it("Test 7 — close-loop daily SMS passes memory repeat guard with exemption metadata", async () => {
    const priorOutbound = "Did you get your two hours done?";
    const planAnswer = "I'll do it after Brooke gets back from her workout.";
    const pending = {
      active: true as const,
      plan_summary_hint: "distribution after workout",
      anchor_phrase_hint: "after Brooke's workout",
      anchor_key: "brooke|workout",
      plan_for_day_key: "2026-05-11",
      source_answer_preview: planAnswer,
      recurrence_confidence: "unknown" as const,
      outcome_known: false as const,
    };
    const timing = deriveTimingAnchorMemory({
      latestAnswerAfterOpenQuestion: planAnswer,
      pendingPlanProof: pending,
    });
    const closeLoop =
      "Did that Brooke workout window happen — done, partial, or missed?";
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: closeLoop,
              no_send_reason: null,
              turn_purpose: "daily_check",
              voice_confidence: 0.8,
              used_facts: [],
              safety_notes: [],
            }),
          },
        },
      ],
    });
    const r = await produceDailyV3RelationshipSms({
      facts: baseFacts({
        suggested_coaching_move: "close_prior_plan_loop",
        accountability: {
          ...baseFacts().accountability,
          pending_plan_proof: pending,
          timing_anchor_memory: timing,
        },
        thread_memory: {
          ...baseFacts().thread_memory,
          latest_open_question: priorOutbound,
          latest_answer_after_open_question: planAnswer,
          open_question_pending: false,
          last_outbound_full_body: priorOutbound,
          last_5_coach_questions: [priorOutbound],
        },
      }),
      telemetry_fact_sources: ["test_fixture"],
    });
    expect(r.shouldSend).toBe(true);
    expect(r.body).toBe(closeLoop);
    expect(r.metadata.anti_repeat_close_loop_exemption_applied).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});

describe("produceDailyV3RelationshipSms", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.clearAllMocks();
  });

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("returns lane result when OpenAI returns valid JSON with should_send true", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "What is the smallest win you can lock before noon?",
              no_send_reason: null,
              turn_purpose: "daily_accountability",
              voice_confidence: 0.82,
              used_facts: ["prior_outcome", "blocker_preview"],
              safety_notes: [],
            }),
          },
        },
      ],
    });

    const r = await produceDailyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: ["test_fixture"],
    });
    expect(r.shouldSend).toBe(true);
    expect(r.body).toContain("smallest win");
    expect(r.replySource).toBe("v3_daily_relationship_lane");
    expect(r.openAiOk).toBe(true);
    expect(r.metadata.daily_v3_lane_used).toBe(true);
    expect(r.metadata.old_daily_writer_used_as_voice).toBe(false);
    expect(r.metadata.relationship_packet_version).toBe("1.8");
    expect(r.metadata.relationship_packet_budget_chars).toBe(12000);
  });

  it("includes recent exact thread priority in system prompt when thread_memory has packet fields", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Let's build on Sunday School and the farm stories today.",
              no_send_reason: null,
              turn_purpose: "daily_accountability",
              voice_confidence: 0.8,
              used_facts: ["thread_memory"],
              safety_notes: [],
            }),
          },
        },
      ],
    });

    await produceDailyV3RelationshipSms({
      facts: baseFacts({
        thread_memory: {
          ...baseFacts().thread_memory,
          recent_exact_thread_text:
            "Coach: What story will you dictate today?\nUser: Sunday School, farm, songs Mother sang",
          latest_open_question: "What story will you dictate today?",
          latest_answer_after_open_question: "Sunday School, farm, songs Mother sang",
          last_5_coach_questions: ["What story will you dictate today?"],
          do_not_repeat_hints: ["What story will you dictate today?"],
          memory_priority_rules: ["RECENT_EXACT_THREAD overrides COACHING_SUMMARY when they conflict."],
        },
      }),
      telemetry_fact_sources: ["test_fixture"],
    });

    const systemMsg = createMock.mock.calls[0]?.[0]?.messages?.[0]?.content as string;
    expect(systemMsg).toContain("recent_exact_thread");
    expect(systemMsg).toContain("last_5_coach_questions");
    const userMsg = createMock.mock.calls[0]?.[0]?.messages?.[1]?.content as string;
    expect(userMsg).toContain("RELATIONSHIP_PACKET_V1");
    expect(userMsg).toContain("Sunday School, farm, songs Mother sang");
    expect(userMsg).not.toContain("ACCOUNTABILITY_FACTS_JSON");
  });

  it("returns shouldSend=false when OpenAI is unavailable", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await produceDailyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("openai_unavailable");
    expect(r.openAiOk).toBe(false);
  });

  it("returns shouldSend=false on invalid JSON when strict retry also fails", async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ message: { content: "not-json" } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: "{broken" } }] });
    const r = await produceDailyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("invalid_json");
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(r.metadata.lane_json_retry_attempted).toBe(true);
    expect(r.metadata.lane_json_retry_succeeded).toBe(false);
  });

  it("invalid JSON on first completion succeeds after one strict JSON retry", async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ message: { content: "not-json" } }] })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: "What is the smallest win you can lock before noon?",
                no_send_reason: null,
                turn_purpose: "daily_accountability",
                voice_confidence: 0.8,
                used_facts: [],
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const r = await produceDailyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(r.shouldSend).toBe(true);
    expect(r.metadata.lane_json_retry_attempted).toBe(true);
    expect(r.metadata.lane_json_retry_succeeded).toBe(true);
  });

  it("did_you_manage triggers lane repair then sends when repair removes the phrase", async () => {
    const bad = "Welcome back, Angel! Did you manage to make the calls as planned at 2 PM?";
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: bad,
                no_send_reason: null,
                turn_purpose: "daily",
                voice_confidence: 0.7,
                used_facts: [],
                safety_notes: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: "Welcome back, Angel — did the 2 PM calls land the way you planned?",
                used_strategy: "rewrite_accountability_check",
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const r = await produceDailyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(r.shouldSend).toBe(true);
    expect(r.body.toLowerCase()).not.toContain("did you manage");
    expect(r.metadata.lane_repair_attempted).toBe(true);
    expect(r.metadata.lane_repair_succeeded).toBe(true);
  });

  it("did_you_manage lane repair that still outputs Did you manage no-sends", async () => {
    const bad = "Welcome back! Did you manage to make the calls?";
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: bad,
                no_send_reason: null,
                turn_purpose: "daily",
                voice_confidence: 0.7,
                used_facts: [],
                safety_notes: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: "Did you manage to finish those anyway?",
                used_strategy: "bad",
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const r = await produceDailyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.metadata.lane_repair_attempted).toBe(true);
    expect(r.metadata.lane_repair_succeeded).toBe(false);
  });

  it("malformed Did raw phrase happen today stays hard no-send without lane repair", async () => {
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "You made a comeback yesterday! Did Focused on work without distractions happen today?",
              no_send_reason: null,
              turn_purpose: "daily",
              voice_confidence: 0.7,
              used_facts: [],
              safety_notes: [],
            }),
          },
        },
      ],
    });
    const r = await produceDailyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(r.metadata.blocked_reasons).toContain("malformed_did_raw_phrase_happen_today");
    expect(r.metadata.lane_repair_attempted).toBeUndefined();
  });

  it("does not use deterministic daily fallback — blocked copy yields no_send from post-validate", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Did the rep happen today?",
              no_send_reason: null,
              turn_purpose: "bad",
              voice_confidence: null,
              used_facts: [],
              safety_notes: [],
            }),
          },
        },
      ],
    });
    const r = await produceDailyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("lane_post_validate_blocked");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("May 14-style repairable copy triggers lane repair then sends", async () => {
    const may14 =
      "As you reflect on your day, who did you thank for being present? Sharing that gratitude can really strengthen your connections. Let me know how it went!";
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: may14,
                no_send_reason: null,
                turn_purpose: "daily",
                voice_confidence: 0.72,
                used_facts: [],
                safety_notes: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: "Who did you thank today for showing up for you?",
                used_strategy: "compress_remove_cliche",
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const r = await produceDailyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: ["test_fixture"],
    });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(r.shouldSend).toBe(true);
    expect(r.body).toContain("thank");
    expect(r.metadata.lane_repair_attempted).toBe(true);
    expect(r.metadata.lane_repair_succeeded).toBe(true);
    expect(r.metadata.lane_stage).toBe("post_validate_repaired");
    expect(r.metadata.repaired_blocked_reasons).toEqual([]);
    expect(Array.isArray(r.metadata.original_blocked_reasons)).toBe(true);
    expect(r.metadata.repair_snapshot_kind).toBe("lane_post_validate");
    const repairUserMsg = createMock.mock.calls[1]?.[0]?.messages?.[1]?.content as string;
    expect(repairUserMsg).toMatch(/REPAIR_RELATIONSHIP_SNAPSHOT_V1/);
    expect(repairUserMsg).not.toMatch(/OPTIONAL_ACCOUNTABILITY_FACTS_JSON/);
  });

  it("lane repair output is revalidated; still-failing repair no-sends", async () => {
    const wordy =
      "Great to hear you made those calls, Angel! How did you feel about the conversations? Reflecting on them can help us prepare for tomorrow's 2 PM commitment. Let me know how it went!";
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: wordy,
                no_send_reason: null,
                turn_purpose: "x",
                voice_confidence: 0.7,
                used_facts: [],
                safety_notes: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: "Still really really weak as a coach line here.",
                used_strategy: "still_rambly_after_repair",
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const r = await produceDailyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.metadata.lane_repair_attempted).toBe(true);
    expect(r.metadata.lane_repair_succeeded).toBe(false);
    expect(r.metadata.lane_stage).toBe("post_validate_repair_failed");
  });

  it("contract_prompt skips lane repair even when blocks are repairable-only", async () => {
    const binding = "Today only: 30 minutes deep work. Reply YES or NO.";
    const wordy =
      "As you reflect on your day, who did you thank? Sharing gratitude strengthens bonds. Let me know how it went!";
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: wordy,
              no_send_reason: null,
              turn_purpose: "contract_overlay",
              voice_confidence: 0.7,
              used_facts: [],
              safety_notes: [],
            }),
          },
        },
      ],
    });
    const base = baseFacts();
    const r = await produceDailyV3RelationshipSms({
      facts: {
        ...base,
        route_kind: "contract_prompt",
        accountability: {
          ...base.accountability,
          daily_purpose: "contract_overlay_proposal",
          contract_proposal_mode: true,
        },
        contract_proposal: {
          binding_text_verbatim: binding,
          contract_kind: "shrink_ask",
          required_reply_semantics: "yes_no_binding_only",
        },
        constraints: {
          ...base.constraints,
          required_verbatim_substrings: [binding],
        },
      },
      telemetry_fact_sources: ["v2_contract_binding_facts"],
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(r.shouldSend).toBe(false);
    expect(r.metadata.lane_stage).toBe("post_validate_blocked");
    expect(r.metadata.lane_repair_attempted).toBeUndefined();
  });

  it("contract_prompt: no_send when body omits required binding verbatim (consent safety)", async () => {
    const base = baseFacts();
    const binding = "Today only: 30 minutes deep work. Reply YES or NO.";
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Quick pulse before noon — what is one tiny move you can make?",
              no_send_reason: null,
              turn_purpose: "contract_overlay",
              voice_confidence: 0.8,
              used_facts: [],
              safety_notes: [],
            }),
          },
        },
      ],
    });
    const r = await produceDailyV3RelationshipSms({
      facts: {
        ...base,
        route_kind: "contract_prompt",
        accountability: {
          ...base.accountability,
          daily_purpose: "contract_overlay_proposal",
          contract_proposal_mode: true,
        },
        contract_proposal: {
          binding_text_verbatim: binding,
          contract_kind: "shrink_ask",
          required_reply_semantics: "yes_no_binding_only",
        },
        constraints: {
          ...base.constraints,
          required_verbatim_substrings: [binding],
        },
      },
      telemetry_fact_sources: ["v2_contract_binding_facts"],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("missing_required_verbatim");
    expect(r.metadata.daily_v3_lane_used).toBe(true);
    expect(r.metadata.old_daily_writer_used_as_voice).toBe(false);
    expect(r.metadata.route_purpose).toBe("contract_prompt");
  });

  it("contract_prompt (semantic daily): sends natural proposal without binding_text_verbatim", async () => {
    const base = baseFacts();
    const ask = "30 minutes of deep work";
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: `For the next few days, want to keep ${ask} as your bar — or would you rather dial it back a notch?`,
              no_send_reason: null,
              turn_purpose: "contract_overlay",
              voice_confidence: 0.8,
              used_facts: [],
              safety_notes: [],
            }),
          },
        },
      ],
    });
    const r = await produceDailyV3RelationshipSms({
      facts: {
        ...base,
        route_kind: "contract_prompt",
        accountability: {
          ...base.accountability,
          daily_purpose: "contract_overlay_proposal",
          contract_proposal_mode: true,
        },
        contract_proposal: {
          contract_kind: "shrink_ask",
          required_reply_semantics: "yes_no_binding_only",
          semantic_daily_contract_v1: true,
          daily_contract_semantic_facts: {
            proposal_kind: "shrink_ask",
            duration_days: 7,
            base_behavior_statement: base.commitment.behavior_statement,
            proposed_overlay_ask: ask,
            proposed_behavior_preview: ask,
            desired_response_semantics: "natural_confirmation_or_decline_or_adjustment",
            must_not_claim_goal_updated: true,
            forbidden_phrases: [],
          },
        },
        constraints: {
          ...base.constraints,
          required_verbatim_substrings: [],
        },
      },
      telemetry_fact_sources: ["v1_semantic_daily"],
    });
    expect(r.shouldSend).toBe(true);
    expect(r.body.toLowerCase()).toContain("deep work");
    expect(r.body.toLowerCase()).not.toMatch(/\breply\s+yes\b/);
    expect(r.body.toLowerCase()).not.toMatch(/this is the standard/);
  });

  it("contract_prompt (semantic daily): no_send when body contains forbidden menu language", async () => {
    const base = baseFacts();
    const ask = "30 minutes of deep work";
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: `Let’s make it simple: ${ask}. Reply YES to confirm or NO to discard.`,
              no_send_reason: null,
              turn_purpose: "contract_overlay",
              voice_confidence: 0.7,
              used_facts: [],
              safety_notes: [],
            }),
          },
        },
      ],
    });
    const r = await produceDailyV3RelationshipSms({
      facts: {
        ...base,
        route_kind: "contract_prompt",
        accountability: {
          ...base.accountability,
          daily_purpose: "contract_overlay_proposal",
          contract_proposal_mode: true,
        },
        contract_proposal: {
          contract_kind: "shrink_ask",
          required_reply_semantics: "yes_no_binding_only",
          semantic_daily_contract_v1: true,
          daily_contract_semantic_facts: {
            proposal_kind: "shrink_ask",
            duration_days: 7,
            base_behavior_statement: base.commitment.behavior_statement,
            proposed_overlay_ask: ask,
            proposed_behavior_preview: ask,
            desired_response_semantics: "natural_confirmation_or_decline_or_adjustment",
            must_not_claim_goal_updated: true,
            forbidden_phrases: [],
          },
        },
      },
      telemetry_fact_sources: ["v1_semantic_daily"],
    });
    expect(r.shouldSend).toBe(false);
    expect(String(r.noSendReason)).toMatch(/^semantic_daily_contract_blocked:/);
    expect(r.metadata.lane_stage).toBe("semantic_daily_contract_validator_failed");
  });

  it("contract_prompt (semantic daily): no_send when body does not reference proposed bar", async () => {
    const base = baseFacts();
    const ask = "30 minutes of deep work";
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: `Want to keep that for the week, or adjust it?`,
              no_send_reason: null,
              turn_purpose: "contract_overlay",
              voice_confidence: 0.7,
              used_facts: [],
              safety_notes: [],
            }),
          },
        },
      ],
    });
    const r = await produceDailyV3RelationshipSms({
      facts: {
        ...base,
        route_kind: "contract_prompt",
        accountability: {
          ...base.accountability,
          daily_purpose: "contract_overlay_proposal",
          contract_proposal_mode: true,
        },
        contract_proposal: {
          contract_kind: "shrink_ask",
          required_reply_semantics: "yes_no_binding_only",
          semantic_daily_contract_v1: true,
          daily_contract_semantic_facts: {
            proposal_kind: "shrink_ask",
            duration_days: 7,
            base_behavior_statement: base.commitment.behavior_statement,
            proposed_overlay_ask: ask,
            proposed_behavior_preview: ask,
            desired_response_semantics: "natural_confirmation_or_decline_or_adjustment",
            must_not_claim_goal_updated: true,
            forbidden_phrases: [],
          },
        },
      },
      telemetry_fact_sources: ["v1_semantic_daily"],
    });
    expect(r.shouldSend).toBe(false);
    expect(String(r.noSendReason)).toContain("missing_proposed_behavior_signal");
  });

  it("computeRecommitBindingText returns server-owned 7-day standard binding unchanged", () => {
    expect(computeRecommitBindingText("I will text or call each day")).toBe(
      "This is the standard for the next 7 days: I will text or call each day"
    );
    expect(computeRecommitBindingText("   ")).toBe("This is the standard for the next 7 days.");
    expect(computeRecommitBindingText("I will text or call each day")).not.toMatch(
      /same commitment[—-]keep this line/i
    );
  });

  it("detectContractWrapperDuplicates flags wrapper restating binding phrases", () => {
    const binding = computeRecommitBindingText("Call one person each day");
    const bad = `Let's keep this line for 7 days: ${binding} Reply YES or NO?`;
    const hits = detectContractWrapperDuplicates(
      bad,
      binding,
      DEFAULT_CONTRACT_WRAPPER_MUST_NOT_REPEAT
    );
    expect(hits.some((h) => h.startsWith("contract_wrapper_duplicate:"))).toBe(true);
  });

  it("contract_prompt: duplicate wrapper only triggers contract_wrapper snapshot repair then sends", async () => {
    const binding = computeRecommitBindingText("I will text or call each day");
    const duplicated = `keep this line — ${binding} — happy to keep this line with you this week.`;
    const cleaned = `Diane — here's the bar. ${binding} Want me to hold it here with you this week?`;
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: duplicated,
                no_send_reason: null,
                turn_purpose: "contract_overlay",
                voice_confidence: 0.8,
                used_facts: [],
                safety_notes: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: cleaned,
                used_strategy: "contract_wrapper_dedup",
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const base = baseFacts();
    const r = await produceDailyV3RelationshipSms({
      facts: {
        ...base,
        route_kind: "contract_prompt",
        accountability: {
          ...base.accountability,
          daily_purpose: "contract_overlay_proposal",
          contract_proposal_mode: true,
        },
        contract_proposal: {
          binding_text_verbatim: binding,
          contract_kind: "recommit_same",
          required_reply_semantics: "yes_no_binding_only",
        },
        constraints: {
          ...base.constraints,
          required_verbatim_substrings: [binding],
          wrapper_must_not_repeat_substrings: [...DEFAULT_CONTRACT_WRAPPER_MUST_NOT_REPEAT],
        },
      },
      telemetry_fact_sources: ["v2_contract_binding_facts"],
    });
    expect(createMock.mock.calls.length).toBe(2);
    const contractRepairUser = createMock.mock.calls[1]?.[0]?.messages?.[1]?.content as string;
    expect(contractRepairUser).toMatch(/REPAIR_RELATIONSHIP_SNAPSHOT_V1/);
    expect(contractRepairUser).not.toMatch(/ACCOUNTABILITY_FACTS_JSON/);
    expect(contractRepairUser).not.toMatch(/OPTIONAL_ACCOUNTABILITY_FACTS_JSON/);
    expect(contractRepairUser).toMatch(/contract_wrapper/);
    expect(createMock.mock.calls[1]?.[0]?.messages?.[0]?.content).toMatch(/REPAIR_SNAPSHOT_AUTHORITY/);
    expect(r.shouldSend).toBe(true);
    expect(r.body).toContain(binding);
    expect(countSubstringOccurrences(r.body, binding)).toBe(1);
    expect(r.metadata.contract_wrapper_repair_succeeded).toBe(true);
    expect(r.metadata.repair_snapshot_kind).toBe("contract_wrapper");
    expect(r.metadata.repair_snapshot_version).toBe("1.0");
    expect(r.metadata.robot_consent_menu_repair_attempted).toBeUndefined();
  });

  it("contract_prompt: contract wrapper repair fail-closed when binding missing from repair output", async () => {
    const binding = computeRecommitBindingText("I will text or call each day");
    const duplicated = `keep this line — ${binding} — we'll keep this line steady.`;
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: duplicated,
                no_send_reason: null,
                turn_purpose: "contract_overlay",
                voice_confidence: 0.7,
                used_facts: [],
                safety_notes: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: "Quick check — want the smaller bar this week?",
                used_strategy: "bad_drop_binding",
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const base = baseFacts();
    const r = await produceDailyV3RelationshipSms({
      facts: {
        ...base,
        route_kind: "contract_prompt",
        accountability: {
          ...base.accountability,
          daily_purpose: "contract_overlay_proposal",
          contract_proposal_mode: true,
        },
        contract_proposal: {
          binding_text_verbatim: binding,
          contract_kind: "recommit_same",
          required_reply_semantics: "yes_no_binding_only",
        },
        constraints: {
          ...base.constraints,
          required_verbatim_substrings: [binding],
        },
      },
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("contract_wrapper_duplicate");
    expect(r.metadata.contract_wrapper_repair_attempted).toBe(true);
    expect(r.metadata.contract_wrapper_repair_succeeded).toBe(false);
    const contractRepairUser = createMock.mock.calls[1]?.[0]?.messages?.[1]?.content as string;
    expect(contractRepairUser).toMatch(/REPAIR_RELATIONSHIP_SNAPSHOT_V1/);
    expect(contractRepairUser).not.toMatch(/ACCOUNTABILITY_FACTS_JSON/);
  });

  it("contract_prompt: contract wrapper repair fail-closed when binding duplicated in repair output", async () => {
    const binding = computeRecommitBindingText("I will text or call each day");
    const duplicated = `keep this line — ${binding} — we'll keep this line steady.`;
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: duplicated,
                no_send_reason: null,
                turn_purpose: "contract_overlay",
                voice_confidence: 0.7,
                used_facts: [],
                safety_notes: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: `${binding} and again ${binding}`,
                used_strategy: "bad_duplicate_binding",
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const base = baseFacts();
    const r = await produceDailyV3RelationshipSms({
      facts: {
        ...base,
        route_kind: "contract_prompt",
        accountability: {
          ...base.accountability,
          daily_purpose: "contract_overlay_proposal",
          contract_proposal_mode: true,
        },
        contract_proposal: {
          binding_text_verbatim: binding,
          contract_kind: "recommit_same",
          required_reply_semantics: "yes_no_binding_only",
        },
        constraints: {
          ...base.constraints,
          required_verbatim_substrings: [binding],
        },
      },
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.metadata.contract_wrapper_repair_succeeded).toBe(false);
    expect(r.metadata.repair_snapshot_kind).toBeUndefined();
  });

  it("contract_prompt: duplicate wrapper triggers binding-preserving repair then sends", async () => {
    const binding = computeRecommitBindingText("I will text or call each day");
    const duplicated = `Welcome back, Diane! To maintain your commitment, let's keep this line for 7 days: ${binding} Do you agree? Reply YES or NO.`;
    const cleaned = `Diane — here's the line. ${binding} Want me to keep the bar right here for the week?`;
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: duplicated,
                no_send_reason: null,
                turn_purpose: "contract_overlay",
                voice_confidence: 0.8,
                used_facts: [],
                safety_notes: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: cleaned,
                used_strategy: "strip_duplicate_wrapper",
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const base = baseFacts();
    const r = await produceDailyV3RelationshipSms({
      facts: {
        ...base,
        route_kind: "contract_prompt",
        accountability: {
          ...base.accountability,
          daily_purpose: "contract_overlay_proposal",
          contract_proposal_mode: true,
        },
        contract_proposal: {
          binding_text_verbatim: binding,
          contract_kind: "recommit_same",
          required_reply_semantics: "yes_no_binding_only",
        },
        constraints: {
          ...base.constraints,
          required_verbatim_substrings: [binding],
          wrapper_must_not_repeat_substrings: [...DEFAULT_CONTRACT_WRAPPER_MUST_NOT_REPEAT],
        },
      },
      telemetry_fact_sources: ["v2_contract_binding_facts"],
    });
    expect(createMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    const robotRepairUser = createMock.mock.calls[1]?.[0]?.messages?.[1]?.content as string;
    expect(robotRepairUser).toMatch(/REPAIR_RELATIONSHIP_SNAPSHOT_V1/);
    expect(robotRepairUser).not.toMatch(/ACCOUNTABILITY_FACTS_JSON/);
    expect(robotRepairUser).toMatch(/robot_consent_menu/);
    expect(createMock.mock.calls[1]?.[0]?.messages?.[0]?.content).toMatch(/REPAIR_SNAPSHOT_AUTHORITY/);
    expect(r.shouldSend).toBe(true);
    expect(r.body).toContain(binding);
    expect(countSubstringOccurrences(r.body, binding)).toBe(1);
    expect(r.body.toLowerCase()).not.toMatch(/let's keep this line for 7 days/);
    expect(r.body.toLowerCase()).not.toMatch(/\breply\s+yes\b/);
    expect(r.body.toLowerCase()).not.toMatch(/\breply\s+no\b/);
    expect(r.metadata.robot_consent_menu_repair_succeeded).toBe(true);
    expect(r.metadata.repair_snapshot_kind).toBe("robot_consent_menu");
    expect(r.metadata.repair_snapshot_version).toBe("1.0");
  });

  it("contract_prompt: robotic Reply YES/NO no-sends when repair cannot naturalize", async () => {
    const binding = computeRecommitBindingText("I will text or call each day");
    const robotic = `Let's make this simple. ${binding} Reply YES to confirm or NO to discard.`;
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: robotic,
                no_send_reason: null,
                turn_purpose: "contract_overlay",
                voice_confidence: 0.8,
                used_facts: [],
                safety_notes: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: `Still robotic. ${binding} Reply YES or NO.`,
                used_strategy: "failed_naturalize",
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const base = baseFacts();
    const r = await produceDailyV3RelationshipSms({
      facts: {
        ...base,
        route_kind: "contract_prompt",
        accountability: {
          ...base.accountability,
          daily_purpose: "contract_overlay_proposal",
          contract_proposal_mode: true,
        },
        contract_proposal: {
          binding_text_verbatim: binding,
          contract_kind: "recommit_same",
          required_reply_semantics: "yes_no_binding_only",
        },
        constraints: {
          ...base.constraints,
          required_verbatim_substrings: [binding],
        },
      },
      telemetry_fact_sources: ["v2_contract_binding_facts"],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("robotic_contract_menu_language");
    const robotRepairUser = createMock.mock.calls[1]?.[0]?.messages?.[1]?.content as string;
    expect(robotRepairUser).toMatch(/REPAIR_RELATIONSHIP_SNAPSHOT_V1/);
    expect(robotRepairUser).not.toMatch(/ACCOUNTABILITY_FACTS_JSON/);
    expect(r.metadata.lane_stage).toBe("robot_consent_menu_blocked");
    expect(r.metadata.robot_consent_menu_repair_attempted).toBe(true);
    expect(r.metadata.robot_consent_menu_repair_succeeded).toBe(false);
  });

  it("contract_prompt: duplicate wrapper repair that drops binding verbatim no-sends", async () => {
    const binding = computeRecommitBindingText("I will text or call each day");
    const duplicated = `Let's keep this line for 7 days: ${binding}`;
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: duplicated,
                no_send_reason: null,
                turn_purpose: "contract_overlay",
                voice_confidence: 0.7,
                used_facts: [],
                safety_notes: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: "Quick check — reply YES or NO if you want the smaller bar.",
                used_strategy: "bad_drop_binding",
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const base = baseFacts();
    const r = await produceDailyV3RelationshipSms({
      facts: {
        ...base,
        route_kind: "contract_prompt",
        accountability: {
          ...base.accountability,
          daily_purpose: "contract_overlay_proposal",
          contract_proposal_mode: true,
        },
        contract_proposal: {
          binding_text_verbatim: binding,
          contract_kind: "recommit_same",
          required_reply_semantics: "yes_no_binding_only",
        },
        constraints: {
          ...base.constraints,
          required_verbatim_substrings: [binding],
        },
      },
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("robotic_contract_menu_language");
    const robotRepairUser = createMock.mock.calls[1]?.[0]?.messages?.[1]?.content as string;
    expect(robotRepairUser).toMatch(/REPAIR_RELATIONSHIP_SNAPSHOT_V1/);
    expect(robotRepairUser).not.toMatch(/ACCOUNTABILITY_FACTS_JSON/);
    expect(r.metadata.robot_consent_menu_repair_succeeded).toBe(false);
  });

  it("contract_prompt: robot consent repair fail-closed when binding duplicated in repair output", async () => {
    const binding = computeRecommitBindingText("I will text or call each day");
    const robotic = `${binding} Reply YES or NO.`;
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: robotic,
                no_send_reason: null,
                turn_purpose: "contract_overlay",
                voice_confidence: 0.8,
                used_facts: [],
                safety_notes: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: `${binding} and again ${binding} — still want this bar?`,
                used_strategy: "bad_duplicate_binding",
                safety_notes: [],
              }),
            },
          },
        ],
      });
    const base = baseFacts();
    const r = await produceDailyV3RelationshipSms({
      facts: {
        ...base,
        route_kind: "contract_prompt",
        accountability: {
          ...base.accountability,
          daily_purpose: "contract_overlay_proposal",
          contract_proposal_mode: true,
        },
        contract_proposal: {
          binding_text_verbatim: binding,
          contract_kind: "recommit_same",
          required_reply_semantics: "yes_no_binding_only",
        },
        constraints: {
          ...base.constraints,
          required_verbatim_substrings: [binding],
        },
      },
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.metadata.robot_consent_menu_repair_attempted).toBe(true);
    expect(r.metadata.robot_consent_menu_repair_succeeded).toBe(false);
    expect(r.metadata.repair_snapshot_kind).toBeUndefined();
  });

  it("contract_prompt: sends when binding verbatim is embedded in relationship wrapper", async () => {
    const base = baseFacts();
    const binding = "Today only: 30 minutes deep work. Reply YES or NO.";
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: `One beat — ${binding}`,
              no_send_reason: null,
              turn_purpose: "contract_overlay",
              voice_confidence: 0.85,
              used_facts: ["binding"],
              safety_notes: [],
            }),
          },
        },
      ],
    });
    const r = await produceDailyV3RelationshipSms({
      facts: {
        ...base,
        route_kind: "contract_prompt",
        accountability: {
          ...base.accountability,
          daily_purpose: "contract_overlay_proposal",
          contract_proposal_mode: true,
        },
        contract_proposal: {
          binding_text_verbatim: binding,
          contract_kind: "shrink_ask",
          required_reply_semantics: "yes_no_binding_only",
        },
        constraints: {
          ...base.constraints,
          required_verbatim_substrings: [binding],
        },
      },
      telemetry_fact_sources: ["v2_contract_binding_facts"],
    });
    expect(r.shouldSend).toBe(true);
    expect(r.body).toContain(binding);
    expect(r.metadata.route_purpose).toBe("contract_prompt");
  });

  it("refresh_commitment: no_send when effective ask verbatim is missing", async () => {
    const base = baseFacts();
    const bar = "Two hours of deep work before noon.";
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "What is one hour you can protect tomorrow morning?",
              no_send_reason: null,
              turn_purpose: "refresh_commitment",
              voice_confidence: 0.7,
              used_facts: [],
              safety_notes: [],
            }),
          },
        },
      ],
    });
    const r = await produceDailyV3RelationshipSms({
      facts: {
        ...base,
        route_kind: "refresh_commitment",
        refresh: {
          refresh_step: "commitment_daily",
          effective_ask_for_bar: bar,
        },
        constraints: {
          ...base.constraints,
          required_verbatim_substrings: [bar],
        },
      },
      telemetry_fact_sources: ["v2_refresh_commitment_facts"],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("missing_required_verbatim");
    expect(r.metadata.route_purpose).toBe("refresh_commitment");
  });

  it("refresh_identity: no_send when identity anchor verbatim is missing", async () => {
    const base = baseFacts();
    const anchor = "You said you want to show up as a steady parent.";
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "What is one way you want to feel by tonight?",
              no_send_reason: null,
              turn_purpose: "refresh_identity",
              voice_confidence: 0.7,
              used_facts: [],
              safety_notes: [],
            }),
          },
        },
      ],
    });
    const r = await produceDailyV3RelationshipSms({
      facts: {
        ...base,
        route_kind: "refresh_identity",
        refresh: {
          refresh_step: "identity_first",
          identity_anchor_text: anchor,
        },
        constraints: {
          ...base.constraints,
          required_verbatim_substrings: [anchor],
        },
      },
      telemetry_fact_sources: ["v2_refresh_identity_facts"],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("missing_required_verbatim");
    expect(r.metadata.route_purpose).toBe("refresh_identity");
  });

  it("pending_resolution route writes lane metadata and does not use old writer as voice", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Before we lock the swap: what feels most honest about the smaller bar for this week?",
              no_send_reason: null,
              turn_purpose: "pending_resolution",
              voice_confidence: 0.75,
              used_facts: ["pending_resolution"],
              safety_notes: [],
            }),
          },
        },
      ],
    });
    const base = baseFacts();
    const r = await produceDailyV3RelationshipSms({
      facts: {
        ...base,
        route_kind: "pending_resolution",
        pending_resolution: {
          resolution_kind: "replace",
          expires_at: null,
          payload_source: "v2",
          sms_state: "awaiting_confirm",
          detected_intent: "replace",
          candidate_behavior_snippet: "Walk 10 minutes",
          awaiting_user_confirmation: true,
        },
      },
      telemetry_fact_sources: ["v2_pending_resolution_facts"],
    });
    expect(r.shouldSend).toBe(true);
    expect(r.metadata.route_purpose).toBe("pending_resolution");
    expect(r.metadata.daily_v3_lane_used).toBe(true);
    expect(r.metadata.old_daily_writer_used_as_voice).toBe(false);
    expect(r.metadata.v3_lane_reply_source).toBe("v3_daily_relationship_lane");
  });

  it("repairs repeated prior coach question on main accountability (M2B-5)", async () => {
    const priorQ = "What story will you dictate today?";
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: priorQ,
                no_send_reason: null,
                turn_purpose: "daily_accountability",
                voice_confidence: 0.8,
                used_facts: [],
                safety_notes: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: "Sunday School, the farm, and your mother's songs are a rich thread — which one feels alive to dictate today?",
                used_strategy: "next_first_step",
                safety_notes: [],
              }),
            },
          },
        ],
      });

    const r = await produceDailyV3RelationshipSms({
      facts: baseFacts({
        thread_memory: {
          ...baseFacts().thread_memory,
          latest_open_question: priorQ,
          latest_answer_after_open_question: "Sunday School, farm, songs Mother sang",
          last_5_coach_questions: [priorQ],
          do_not_repeat_hints: [priorQ],
          projection_used: true,
        },
      }),
      telemetry_fact_sources: ["test_memory_repeat"],
    });

    expect(r.shouldSend).toBe(true);
    expect(r.body).not.toBe(priorQ);
    expect(r.metadata.memory_repeat_guard_succeeded).toBe(true);
  });

  it("no-sends when memory repeat repair still repeats answered open question", async () => {
    const priorQ = "What story will you dictate today?";
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                should_send: true,
                body: priorQ,
                no_send_reason: null,
                turn_purpose: "daily_accountability",
                voice_confidence: 0.8,
                used_facts: [],
                safety_notes: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: "What's the first story thread you'll dictate today?",
                used_strategy: "next_first_step",
                safety_notes: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                body: "What would the standard require for the story you'll dictate today?",
                used_strategy: "identity_tie_back",
                safety_notes: [],
              }),
            },
          },
        ],
      });

    const r = await produceDailyV3RelationshipSms({
      facts: baseFacts({
        thread_memory: {
          ...baseFacts().thread_memory,
          latest_open_question: priorQ,
          latest_answer_after_open_question: "Sunday School, farm, songs Mother sang",
          last_5_coach_questions: [priorQ],
          do_not_repeat_hints: [priorQ],
        },
      }),
      telemetry_fact_sources: [],
    });

    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("thread_memory_repeat_blocked");
    expect(r.metadata.memory_repeat_no_send_reason).toBe("still_repeated_after_repair");
    expect(r.metadata.forced_second_repair_attempted).toBe(true);
  });

  describe("fresh-angle memory repeat repair", () => {
    it("Kathy hike follow-up repairs into fresh angle and shouldSend true", async () => {
      const kathyPrior =
        "That sounds like a fantastic plan, Kathy! Enjoy your hike into the mountains and let your chosen Pat Summitt quote inspire you. Also, consider starting suspension training to build strength and endurance. Looking forward to hearing how it goes!";
      const kathyCandidate =
        "How did your hike go, Kathy? Did you find a Pat Summitt quote that inspired you during your time in the mountains?";
      const kathyRepair =
        "Give me the honest status on the hike today — protected, partial, or missed?";

      createMock
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  should_send: true,
                  body: kathyCandidate,
                  no_send_reason: null,
                  turn_purpose: "daily_accountability",
                  voice_confidence: 0.8,
                  used_facts: [],
                  safety_notes: [],
                }),
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  body: kathyRepair,
                  used_strategy: "binary_truth_check",
                  safety_notes: [],
                }),
              },
            },
          ],
        });

      const r = await produceDailyV3RelationshipSms({
        facts: baseFacts({
          user: { ...baseFacts().user, preferred_name: "Kathy" },
          commitment: {
            ...baseFacts().commitment,
            behavior_statement: "Weekly hike with Pat Summitt quote reflection",
          },
          thread_memory: {
            ...baseFacts().thread_memory,
            last_outbound_full_body: kathyPrior,
            latest_outbound_sms: kathyPrior,
            last_5_coach_questions: [kathyPrior],
            do_not_repeat_hints: [kathyPrior],
          },
        }),
        telemetry_fact_sources: ["test_kathy_hike_repeat"],
      });

      expect(r.shouldSend).toBe(true);
      expect(r.body).toBe(kathyRepair);
      expect(r.metadata.memory_repeat_guard_succeeded).toBe(true);
      expect(r.metadata.repeat_repair_succeeded).toBe(true);
      expect(r.metadata.repeat_repair_strategy).toBe("binary_truth_check");
      expect(r.metadata.repeat_detected).toBe(true);
      expect(r.metadata.repeat_repair_system).toBe("fresh_angle_v2");
    });

    it("Tyler distribution follow-up repairs into fresh angle and shouldSend true", async () => {
      const tylerPrior =
        "Tyler, it's great to see you focused on your distribution time today. After Brooke's workout, dive into those two hours and let me know how it goes.";
      const tylerCandidate =
        "After Brooke's workout, were you able to spend those two hours on distribution?";
      const tylerRepair =
        "Protected, partial, or missed on the distribution block today?";

      createMock
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  should_send: true,
                  body: tylerCandidate,
                  no_send_reason: null,
                  turn_purpose: "daily_accountability",
                  voice_confidence: 0.8,
                  used_facts: [],
                  safety_notes: [],
                }),
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  body: tylerRepair,
                  used_strategy: "binary_truth_check",
                  safety_notes: [],
                }),
              },
            },
          ],
        });

      const r = await produceDailyV3RelationshipSms({
        facts: baseFacts({
          user: { ...baseFacts().user, preferred_name: "Tyler" },
          commitment: {
            ...baseFacts().commitment,
            behavior_statement: "Two hours of distribution after Brooke's workout",
          },
          thread_memory: {
            ...baseFacts().thread_memory,
            last_outbound_full_body: tylerPrior,
            latest_outbound_sms: tylerPrior,
            last_5_coach_questions: [tylerPrior],
            do_not_repeat_hints: [tylerPrior],
          },
        }),
        telemetry_fact_sources: ["test_tyler_distribution_repeat"],
      });

      expect(r.shouldSend).toBe(true);
      expect(r.body).toBe(tylerRepair);
      expect(r.metadata.repeat_repair_succeeded).toBe(true);
      expect(r.metadata.repeat_repair_strategy).toBe("binary_truth_check");
      expect(r.metadata.repeat_detected).toBe(true);
      expect(r.metadata.repeat_repair_system).toBe("fresh_angle_v2");
    });

    it("repetitive self-care paraphrase still no-sends when repair stays repetitive", async () => {
      const prior =
        "As you think about being kind to yourself today, what nurturing action can you take? Reflect on something that feels supportive and share your plan!";
      const paraphrase =
        "What nurturing action are you considering today to show yourself kindness? Your commitment to self-care is important.";

      createMock
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  should_send: true,
                  body: paraphrase,
                  no_send_reason: null,
                  turn_purpose: "daily_accountability",
                  voice_confidence: 0.8,
                  used_facts: [],
                  safety_notes: [],
                }),
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  body: paraphrase,
                  used_strategy: "binary_truth_check",
                  safety_notes: [],
                }),
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  body: "What got in the way of taking that nurturing action to show kindness to yourself today?",
                  used_strategy: "barrier_check",
                  safety_notes: [],
                }),
              },
            },
          ],
        });

      const r = await produceDailyV3RelationshipSms({
        facts: baseFacts({
          thread_memory: {
            ...baseFacts().thread_memory,
            last_5_coach_questions: [prior],
            do_not_repeat_hints: [prior],
          },
        }),
        telemetry_fact_sources: ["test_self_care_repeat"],
      });

      expect(r.shouldSend).toBe(false);
      expect(r.noSendReason).toBe("thread_memory_repeat_blocked");
      expect(r.metadata.forced_second_repair_attempted).toBe(true);
    });
  });

  it("does not block contract_prompt required binding with anti-repeat guard", async () => {
    const binding = computeRecommitBindingText("I will text or call each day");
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: `Diane — here's the line. ${binding} Want me to keep the bar right here for the week?`,
              no_send_reason: null,
              turn_purpose: "contract_overlay",
              voice_confidence: 0.9,
              used_facts: ["contract"],
              safety_notes: [],
            }),
          },
        },
      ],
    });

    const base = baseFacts();
    const r = await produceDailyV3RelationshipSms({
      facts: {
        ...base,
        route_kind: "contract_prompt",
        accountability: {
          ...base.accountability,
          daily_purpose: "contract_overlay_proposal",
          contract_proposal_mode: true,
        },
        contract_proposal: {
          binding_text_verbatim: binding,
          contract_kind: "recommit_same",
          required_reply_semantics: "yes_no_binding_only",
        },
        constraints: {
          ...base.constraints,
          required_verbatim_substrings: [binding],
        },
        thread_memory: {
          ...base.thread_memory,
          latest_open_question: binding,
          last_5_coach_questions: [binding],
          do_not_repeat_hints: [binding],
        },
      },
      telemetry_fact_sources: [],
    });

    expect(r.shouldSend).toBe(true);
    expect(r.body).toContain(binding);
    expect(r.metadata.memory_repeat_guard_attempted).toBeFalsy();
  });
});

describe("applyFinalVoiceOwnershipGate + v3_daily_relationship_lane", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it("treats v3_daily_relationship_lane as V3-owned and passes clean body without repair", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: "What time are you protecting for the deep work block?",
      replySource: "v3_daily_relationship_lane",
      channel: "daily_outbound",
      activeCommitmentId: "cmt_1",
      effectiveAsk: "Two hours deep work",
      behaviorStatement: "Two hours deep work",
      contextPacket: {
        source: "daily",
        effectiveAskText: "Two hours deep work",
        behaviorStatement: "Two hours deep work",
      },
      northStarMeta: {
        source: "approved",
        blockedReasons: [],
        originalBody: "What time are you protecting for the deep work block?",
        visibleBody: "What time are you protecting for the deep work block?",
      } as import("@/lib/north-star-coach-sms").NorthStarCoachSmsMeta,
      normalCoaching: true,
    });
    expect(r.shouldSend).toBe(true);
    expect(r.voiceOwner).toBe("v3_daily");
  });

  it("no-sends when lane body is blocked and repair is unavailable", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: "Great job! Keep the momentum going today.",
      replySource: "v3_daily_relationship_lane",
      channel: "daily_outbound",
      activeCommitmentId: "cmt_1",
      effectiveAsk: "x",
      behaviorStatement: "x",
      contextPacket: { source: "daily", effectiveAskText: "x", behaviorStatement: "x" },
      northStarMeta: {
        source: "approved",
        blockedReasons: [],
        originalBody: "Great job! Keep the momentum going today.",
        visibleBody: "Great job! Keep the momentum going today.",
      } as import("@/lib/north-star-coach-sms").NorthStarCoachSmsMeta,
      normalCoaching: true,
    });
    expect(r.shouldSend).toBe(false);
    expect(r.skipReason).toBe("no_safe_v3_voice");
  });
});

describe("daily V3 victory_background", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.clearAllMocks();
  });

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("passes victory_background in relationship packet to OpenAI when present", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Quick check on your bar today?",
              no_send_reason: null,
              turn_purpose: "daily_check",
              voice_confidence: 0.8,
              used_facts: ["commitment"],
              safety_notes: [],
            }),
          },
        },
      ],
    });

    await produceDailyV3RelationshipSms({
      facts: baseFacts({
        victory_background: {
          active_season_label: "Spring Focus",
          active_season_started_at: "2026-01-01T00:00:00Z",
          pat_read_strength: "Showing up steady",
          pat_read_pattern: null,
          pat_read_next_move: "Protect morning block",
        },
      }),
      telemetry_fact_sources: [],
    });

    const userMsg = createMock.mock.calls[0]?.[0]?.messages?.find(
      (m: { role: string }) => m.role === "user"
    )?.content as string;
    expect(userMsg).toContain("RELATIONSHIP_PACKET_V1");
    expect(userMsg).toContain("Spring Focus");
    expect(userMsg).toContain("active_season_label");
    const systemMsg = createMock.mock.calls[0]?.[0]?.messages?.find(
      (m: { role: string }) => m.role === "system"
    )?.content as string;
    expect(systemMsg).toContain(buildVictoryBackgroundLaneGuardrails().trim().slice(0, 40));
    expect(systemMsg).toContain(buildSmsPatternSignalLaneGuardrails().trim().slice(0, 20));
    expect(systemMsg).toContain(buildSmsGoalAdjustmentLaneGuardrails().trim().slice(0, 20));
    expect(systemMsg).toContain(buildPlannedInterruptionLaneGuardrails().trim().slice(0, 24));
    expect(systemMsg).toMatch(/not a diagnosis/i);
    expect(systemMsg).toMatch(/not permission to mutate/i);
    expect(systemMsg).toMatch(/pause_cadence/i);
    expect(systemMsg).toMatch(/raise_bar/i);
    expect(systemMsg).toMatch(/Dashboard/i);
    expect(systemMsg).toMatch(/do not invent/i);
  });

  it("passes structured relationship_memory_30d pat_read_snapshot when memory packet present", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "One clean rep on the bar today?",
              no_send_reason: null,
              turn_purpose: "daily_check",
              voice_confidence: 0.8,
              used_facts: [],
              safety_notes: [],
            }),
          },
        },
      ],
    });

    await produceDailyV3RelationshipSms({
      facts: baseFacts({
        thread_memory: {
          ...baseFacts().thread_memory,
          relationship_memory_30d: {
            window_days: RELATIONSHIP_MEMORY_30D_WINDOW_DAYS,
            built_at: "2026-05-18T12:00:00.000Z",
            commitment_id: "cmt_1",
            season: null,
            outcome_counts_30d: {
              yes: 0,
              no: 0,
              partial: 0,
              blockers: 0,
              checks_sent: 0,
              overlay_activated: 0,
              overlay_declined: 0,
              reactivation_yes: 0,
            },
            recurring_blockers: [],
            meaningful_proof: [],
            adjustments: [],
            goal_changes: [],
            comebacks: [],
            voice_preferences: null,
            pat_read_snapshot: [
              {
                field: "strength",
                text: "Discipline Yourself",
                source: "v2_victory_pat_read_snapshot",
                is_ai_snapshot: true,
                commitment_id: "cmt_1",
              },
            ],
            meta: { item_count: 1, sources_used: ["v2_victory_pat_read_snapshot"] },
          },
        },
        victory_background: {
          active_season_label: null,
          active_season_started_at: null,
          pat_read_strength: "Discipline Yourself",
          pat_read_pattern: null,
          pat_read_next_move: null,
          pat_principles: {
            focus_next_title: "Discipline Yourself",
            focus_next_text: "Protect the morning block this week.",
            living_well_title: null,
            living_well_text: null,
          },
        },
      }),
      telemetry_fact_sources: [],
    });

    const userMsg = createMock.mock.calls[0]?.[0]?.messages?.find(
      (m: { role: string }) => m.role === "user"
    )?.content as string;
    expect(userMsg).toContain("relationship_memory_30d_or_season");
    expect(userMsg).toContain("pat_read_snapshot");
    expect(userMsg).toContain("Discipline Yourself");
    expect(userMsg).not.toContain("pat_principles");
    const systemMsg = createMock.mock.calls[0]?.[0]?.messages?.find(
      (m: { role: string }) => m.role === "system"
    )?.content as string;
    expect(systemMsg).toMatch(/do not invent principle/i);
    expect(systemMsg).toMatch(/primary anchor/i);
  });

  it("builds without victory_background when omitted", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "How did the bar land today?",
              no_send_reason: null,
              turn_purpose: "daily_check",
              voice_confidence: 0.8,
              used_facts: [],
              safety_notes: [],
            }),
          },
        },
      ],
    });

    const f = baseFacts();
    expect(f.victory_background).toBeUndefined();

    await produceDailyV3RelationshipSms({
      facts: f,
      telemetry_fact_sources: [],
    });
    const userMsg = createMock.mock.calls[0]?.[0]?.messages?.find(
      (m: { role: string }) => m.role === "user"
    )?.content as string;
    expect(userMsg).not.toContain("victory_background");
  });
});

describe("thread_freshness in V3 daily lane", () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env = { ...env };
    vi.clearAllMocks();
  });

  it("enrichDailyFactsWithThreadFreshness derives facts from thread_memory", () => {
    const transcript = [
      "Coach: How do you feel about calls tomorrow?",
      "User: Early afternoon I have work early morning",
      "User: Text before calling",
    ].join("\n");
    const enriched = enrichDailyFactsWithThreadFreshness(
      baseFacts({
        thread_memory: {
          ...baseFacts().thread_memory,
          recent_exact_thread_text: transcript,
          recent_transcript_or_context_block: transcript,
          latest_inbound_sms: "Text before calling",
          latest_open_question: "How do you feel about calls tomorrow?",
          last_5_user_answers: [
            "Early afternoon I have work early morning",
            "Text before calling",
          ],
        },
      })
    );

    expect(enriched.thread_freshness?.active_temporal_frame).toBe("tomorrow");
    expect(enriched.thread_freshness?.temporal_anchors).toEqual(
      expect.arrayContaining(["tomorrow", "early afternoon"])
    );
  });

  it("produceDailyV3RelationshipSms system prompt includes THREAD_FRESHNESS authority", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Early afternoon works — text before you call tomorrow.",
              no_send_reason: null,
              turn_purpose: "daily_check",
              voice_confidence: 0.8,
              used_facts: [],
              safety_notes: [],
            }),
          },
        },
      ],
    });

    const transcript = [
      "Coach: How do you feel about calls tomorrow?",
      "User: Early afternoon I have work early morning",
      "User: Text before calling",
    ].join("\n");

    await produceDailyV3RelationshipSms({
      facts: baseFacts({
        thread_memory: {
          ...baseFacts().thread_memory,
          recent_exact_thread_text: transcript,
          recent_transcript_or_context_block: transcript,
          latest_inbound_sms: "Text before calling",
          latest_open_question: "How do you feel about calls tomorrow?",
        },
      }),
      telemetry_fact_sources: [],
    });

    const systemMsg = createMock.mock.calls.at(-1)?.[0]?.messages?.find(
      (m: { role: string }) => m.role === "system"
    )?.content as string;
    expect(systemMsg).toContain("THREAD_FRESHNESS");
    expect(systemMsg).toContain("RELATIONSHIP_PACKET_AUTHORITY");
    expect(systemMsg).toContain(buildThreadFreshnessPromptGuidance().trim().slice(0, 40));

    const userMsg = createMock.mock.calls.at(-1)?.[0]?.messages?.find(
      (m: { role: string }) => m.role === "user"
    )?.content as string;
    expect(userMsg).toContain("thread_freshness");
    expect(userMsg).toContain("RELATIONSHIP_PACKET_V1");
    expect(userMsg).toMatch(/active_temporal_frame.*tomorrow/s);
  });
});
