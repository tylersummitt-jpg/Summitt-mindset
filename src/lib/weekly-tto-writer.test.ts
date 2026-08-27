import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.hoisted(() => vi.fn());

vi.mock("openai", () => {
  class OpenAI {
    chat = {
      completions: {
        create: createMock,
      },
    };
    constructor(_opts?: { apiKey?: string }) {}
  }
  return { default: OpenAI };
});

import { MORNING_COACHING_BRIEF_VERSION } from "@/lib/morning-tto-coaching-brief-v1";
import type { MorningCoachingBriefV1 } from "@/lib/morning-tto-coaching-brief-v1";
import type { WeeklyRelationshipPacket } from "@/lib/weekly-tto-relationship-packet";
import {
  WEEKLY_TTO_SYSTEM_PROMPT,
  WEEKLY_TTO_WRITER_MODEL,
  WEEKLY_TTO_WRITER_REASONING_EFFORT,
  WEEKLY_TTO_WRITER_TEMPERATURE,
  WEEKLY_TTO_SOL_WRITER_PROMPT_PATH,
  buildWeeklyWriterMessages,
  writeWeeklyTtoBody,
} from "@/lib/weekly-tto-writer";

function samplePacket(
  overrides: Partial<WeeklyRelationshipPacket> = {}
): WeeklyRelationshipPacket {
  return {
    version: "weekly_relationship_v1",
    message_for: {
      timezone: "America/Chicago",
      local_date: "2026-07-12",
      local_weekday: "Sunday",
      daypart: "weekly",
      week_start_local_date: "2026-07-06",
      week_end_local_date: "2026-07-12",
    },
    last_user_response: {
      at_utc: "2026-07-10T16:00:00.000Z",
      at_local: "Jul 10, 11:00 AM",
      days_since: 2,
      never_replied: false,
    },
    preferred_name: "Pat",
    current_goal: { text: "One hour of writing" },
    current_identity: { text: "I am a father who keeps his word" },
    personal_context: [{ type: "responsibility", value: "Lead the team" }],
    hard_state: { pending_goal_change: null, planned_interruption: null },
    weekly_accountability_events: [],
    coaching_memory_projection: null,
    historical_evidence: [],
    exact_thread: {
      window_days: 21,
      max_messages: 30,
      omitted_older_turn_count: 0,
      messages: [
        {
          sender: "user",
          sent_at_utc: "2026-07-10T16:00:00.000Z",
          sent_at_local: "Jul 10, 11:00 AM",
          local_day_key: "2026-07-10",
          local_weekday: "Friday",
          day_relation_to_message: "2_days_before",
          body: "Ankle is in a boot. Resting.",
        },
      ],
    },
    ...overrides,
  };
}

function sampleBrief(overrides: Partial<MorningCoachingBriefV1> = {}): MorningCoachingBriefV1 {
  return {
    version: MORNING_COACHING_BRIEF_VERSION,
    confidence: "medium",
    human_situation: {
      most_alive: "Broken ankle / recovery",
      direct_question_or_need: null,
      relevant_life_event: "injury recovery",
      context_use: "relevant",
      identity_use: "background",
      person_use: "do_not_force",
      selected_person: null,
      selected_person_reason: null,
    },
    truth_and_evidence: {
      latest_user_truth: "Ankle is in a boot. Resting.",
      outcome: "no_recent_evidence",
      evidence_note: "human update, not a goal score",
      evidence_strength: "stated_once",
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
      open_loop: null,
      stale_or_exhausted_topics: [],
      do_not_repeat: ["Did you hit your Current Goal this week?"],
    },
    goal_role_today: {
      canonical_goal: "One hour of writing",
      pending_goal: null,
      goal_alignment: "unknown",
      role: "do_not_mention",
      note: "injury outranks goal",
    },
    coaching_direction: {
      primary_move: "support",
      question_policy: "none",
      action_guidance: "none",
      pressure: "low",
      proactive_decision: "send",
    },
    boundaries: {
      claims_to_avoid: ["Do not invent consistency", "Do not praise a fake week of proof"],
      topics_not_to_force: ["Current Goal recap"],
      unsupported_capabilities: [],
      goal_authority_boundaries: [],
      identity_people_boundaries: [],
      coach_history_is_not_style: "Prior coach messages are history, not style.",
    },
    ...overrides,
  };
}

function completion(content: string) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  };
}

describe("weekly-tto-writer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("writer messages are exactly Brief + packet with no hidden extra context", () => {
    const packet = samplePacket();
    const brief = sampleBrief();
    const beforePacket = JSON.stringify(packet);
    const beforeBrief = JSON.stringify(brief);
    const messages = buildWeeklyWriterMessages(packet, brief);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toBe(WEEKLY_TTO_SYSTEM_PROMPT);
    const user = String(messages[1]?.content);
    expect(user).toContain("WEEKLY_COACHING_BRIEF_V1");
    expect(user).toContain("WEEKLY_RELATIONSHIP_PACKET_V1");
    expect(user).toContain(JSON.stringify(brief));
    expect(user).toContain(JSON.stringify(packet));
    expect(user).not.toMatch(/should_send/);
    expect(JSON.stringify(packet)).toBe(beforePacket);
    expect(JSON.stringify(brief)).toBe(beforeBrief);
  });

  it("populated historical_evidence survives into Weekly writer packet JSON", () => {
    const packet = samplePacket({
      historical_evidence: [
        {
          source: "user_message",
          occurred_at: "2026-06-01",
          evidence: "Don't sugarcoat it.",
          user_quote: "Don't sugarcoat it.",
        },
      ],
    });
    const user = String(buildWeeklyWriterMessages(packet, sampleBrief())[1]?.content);
    expect(user).toContain("Don't sugarcoat it.");
    expect(user).toContain('"source":"user_message"');
  });

  it("system prompt is Brief-following Sunday writer, not a second Weekly brain", () => {
    const p = WEEKLY_TTO_SYSTEM_PROMPT;
    expect(p).toContain("The Brief controls coaching meaning. You control natural language only.");
    expect(p).toContain("Do not rediscover the relationship");
    expect(p).toContain("Do not re-interpret");
    expect(p).toContain("Sunday around noon");
    expect(p).toContain("Do not invent weekly perspective if the Brief does not contain it");
    expect(p).toContain("Write as much as this moment needs and no more");
    expect(p).toContain("little more room than a Morning or Evening text");
    expect(p).toContain("still a text message, not an essay");
    expect(p).toContain("Do not write a compliance footer");
    expect(p).toContain("Do not use Pat Pause openers");
    expect(p).toContain("fake Pat quotes");
    expect(p).toContain("No should_send");
    expect(p).toContain("Preserve uncertainty from the Brief");
    expect(p).toContain("do not recap that event as completed");
    expect(p).toContain('{"body":"<sms text>"}');
    expect(p).not.toMatch(/320/);
    expect(p).not.toContain("Keep it naturally concise");
    expect(p).not.toContain("Do not pad");
    expect(p).not.toContain("Do not aim for length");
    expect(p).not.toContain("Current Goal is context");
    expect(p).not.toContain("At most one useful question");
    expect(p).not.toContain("One completion is not consistency");
    expect(p).not.toContain("goal_role_today");
    expect(p).not.toContain("human_situation");
    expect(p).not.toMatch(/family, faith, grief/);
  });

  it("Sol request shape: gpt-5.6-sol, low reasoning, json_object, no temperature, body only", async () => {
    createMock.mockResolvedValue(completion('{"body":"Rest the ankle. The writing can wait."}'));
    const result = await writeWeeklyTtoBody({
      packet: samplePacket(),
      weeklyCoachingBrief: sampleBrief(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toBe("Rest the ankle. The writing can wait.");
    expect(result.model).toBe("gpt-5.6-sol");
    expect(result.writer_prompt_path).toBe(WEEKLY_TTO_SOL_WRITER_PROMPT_PATH);
    expect(WEEKLY_TTO_WRITER_MODEL).toBe("gpt-5.6-sol");
    expect(WEEKLY_TTO_WRITER_REASONING_EFFORT).toBe("low");
    expect(WEEKLY_TTO_WRITER_TEMPERATURE).toBeNull();
    const req = createMock.mock.calls[0]?.[0];
    expect(req.model).toBe("gpt-5.6-sol");
    expect(req.reasoning_effort).toBe("low");
    expect(req.response_format).toEqual({ type: "json_object" });
    expect(req).not.toHaveProperty("temperature");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(result.capture.temperature).toBeNull();
    expect(JSON.stringify(result.capture)).not.toContain("should_send");
  });

  it("rejects should_send in writer JSON and retries once for format only", async () => {
    createMock
      .mockResolvedValueOnce(completion('{"body":"Hi","should_send":true}'))
      .mockResolvedValueOnce(completion('{"body":"Rest is the work."}'));
    const result = await writeWeeklyTtoBody({
      packet: samplePacket(),
      weeklyCoachingBrief: sampleBrief(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toBe("Rest is the work.");
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(result.retryOccurred).toBe(true);
  });

  it("does not accept empty body even as JSON", async () => {
    createMock
      .mockResolvedValueOnce(completion('{"body":"  "}'))
      .mockResolvedValueOnce(completion('{"body":""}'));
    const result = await writeWeeklyTtoBody({
      packet: samplePacket(),
      weeklyCoachingBrief: sampleBrief(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("empty_body");
  });
});
