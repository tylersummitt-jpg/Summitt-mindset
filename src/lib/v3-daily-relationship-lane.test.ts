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

import { applyFinalVoiceOwnershipGate } from "@/lib/v3-sms-voice-ownership";
import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";
import { produceDailyV3RelationshipSms } from "@/lib/v3-daily-relationship-lane";

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

  it("returns shouldSend=false on invalid JSON", async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: "not-json" } }],
    });
    const r = await produceDailyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe("invalid_json");
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
