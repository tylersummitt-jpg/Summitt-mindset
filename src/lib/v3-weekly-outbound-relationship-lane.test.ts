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

import { isV3RelationshipVoiceReplySource } from "@/lib/north-star-coach-sms";
import { applyFinalVoiceOwnershipGate } from "@/lib/v3-sms-voice-ownership";
import type { WeeklyV3OutboundFacts } from "@/lib/v3-weekly-outbound-relationship-lane";
import { produceWeeklyV3RelationshipSms } from "@/lib/v3-weekly-outbound-relationship-lane";

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
      latest_open_question: "What time is the real first block tomorrow?",
      do_not_repeat_hints: ["Do not re-ask yesterday's exact time"],
      coaching_memory_snippet: "User prefers morning blocks.",
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
            content: JSON.stringify({
              should_send: true,
              body: "Rough week, but you still fought for mornings. What is the smallest guardrail before noon tomorrow?",
              no_send_reason: null,
              route_purpose: "weekly_proof_v2",
              voice_confidence: 0.78,
              used_facts: ["rough_week", "completed_count"],
              safety_notes: [],
            }),
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

  it("invalid JSON → shouldSend false, no fallback body", async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: "not-json" } }],
    });
    const r = await produceWeeklyV3RelationshipSms({
      facts: baseFacts(),
      telemetry_fact_sources: [],
    });
    expect(r.shouldSend).toBe(false);
    expect(r.body).toBe("");
    expect(r.noSendReason).toBe("invalid_json");
    expect(r.openAiOk).toBe(true);
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

  it("does not ship old weekly proof preview text as final body (mocked safe body)", async () => {
    const facts = baseFacts();
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Week had friction; one clean hour still showed up. What is the first block tomorrow?",
              no_send_reason: null,
              route_purpose: "weekly_proof_v2",
              voice_confidence: 0.7,
              used_facts: ["rough_week"],
              safety_notes: [],
            }),
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
            content: JSON.stringify({
              should_send: true,
              body: "You kept answering even when the week wobbled. What is one non-negotiable anchor for next week?",
              no_send_reason: null,
              route_purpose: "weekly_proof_v2",
              voice_confidence: 0.66,
              used_facts: ["weekly_proof"],
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
    expect(r.body).not.toContain("UNIQUE_LEGACY_REFLECTION_SNIPPET");
    expect(r.body).not.toContain("UNIQUE_LEGACY_TEMPLATE_SNIPPET");
  });

  it("blocks echo of long preview substring (fail-closed)", async () => {
    const facts = baseFacts();
    const echo = facts.weekly_proof.old_weekly_proof_body_preview!.slice(0, 48);
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: `${echo} — so that is the line.`,
              no_send_reason: null,
              route_purpose: "weekly_proof_v2",
              voice_confidence: 0.5,
              used_facts: [],
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
    expect(r.noSendReason).toBe("lane_post_validate_blocked");
    expect(r.body).toBe("");
  });

  it("isV3RelationshipVoiceReplySource recognizes v3_weekly_relationship_lane", () => {
    expect(isV3RelationshipVoiceReplySource("v3_weekly_relationship_lane")).toBe(true);
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
