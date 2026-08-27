import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";

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

import {
  MORNING_TTO_SYSTEM_PROMPT,
  MORNING_TTO_WRITER_MAX_COMPLETION_TOKENS,
  MORNING_TTO_WRITER_MODEL,
  MORNING_TTO_WRITER_PROMPT_PATH,
  MORNING_TTO_WRITER_REASONING_EFFORT,
  buildMorningWriterMessages,
  writeMorningTtoBody,
} from "@/lib/morning-tto-writer";
import type { MorningCoachingBriefV1 } from "@/lib/morning-tto-coaching-brief-v1";
import type { MorningRelationshipPacket } from "@/lib/morning-tto-relationship-packet";

function samplePacket(
  overrides: Partial<MorningRelationshipPacket> = {}
): MorningRelationshipPacket {
  return {
    version: "morning_relationship_v1",
    message_for: {
      timezone: "America/Chicago",
      local_date: "2026-06-22",
      local_weekday: "Monday",
      daypart: "morning",
    },
    last_user_response: {
      at_utc: "2026-06-21T16:00:00.000Z",
      at_local: "Jun 21, 11:00 AM",
      days_since: 1,
      never_replied: false,
    },
    preferred_name: "Pat",
    current_goal: { text: "One hour of writing" },
    current_identity: { text: null },
    personal_context: [{ type: "responsibility", value: "Lead the team" }],
    hard_state: { pending_goal_change: null },
    historical_evidence: [],
    exact_thread: {
      window_days: 21,
      max_messages: 30,
      omitted_older_turn_count: 0,
      messages: [
        {
          sender: "user",
          sent_at_utc: "2026-06-21T16:00:00.000Z",
          sent_at_local: "Jun 21, 11:00 AM",
          local_day_key: "2026-06-21",
          local_weekday: "Sunday",
          day_relation_to_message: "yesterday",
          body: "Got the hour in.",
        },
      ],
    },
    ...overrides,
  };
}

function sampleBrief(
  overrides: Partial<MorningCoachingBriefV1> = {}
): MorningCoachingBriefV1 {
  return {
    version: "morning_coaching_brief_v1",
    confidence: "medium",
    human_situation: {
      most_alive: "User finished writing yesterday",
      direct_question_or_need: null,
      relevant_life_event: null,
      context_use: "background",
      identity_use: "background",
      person_use: "do_not_force",
      selected_person: null,
      selected_person_reason: null,
    },
    truth_and_evidence: {
      latest_user_truth: "Got the hour in.",
      outcome: "completed",
      evidence_note: "stated once",
      evidence_strength: "stated_once",
      consistency_supported: false,
      proof_claims_allowed: {
        completion: true,
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
      do_not_repeat: [],
    },
    goal_role_today: {
      canonical_goal: "One hour of writing",
      pending_goal: null,
      goal_alignment: "aligned",
      role: "background",
      note: "ok",
    },
    coaching_direction: {
      primary_move: "continue_conversation",
      question_policy: "none",
      action_guidance: "none",
      pressure: "normal",
      proactive_decision: "send",
    },
    boundaries: {
      claims_to_avoid: ["Do not invent consistency"],
      topics_not_to_force: ["homework"],
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

describe("morning-tto-writer Phase 2D", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("buildMorningWriterMessages includes exact Brief and packet without mutation", () => {
    const packet = samplePacket();
    const brief = sampleBrief();
    const beforePacket = JSON.stringify(packet);
    const beforeBrief = JSON.stringify(brief);
    const messages = buildMorningWriterMessages(packet, brief);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toBe(MORNING_TTO_SYSTEM_PROMPT);
    const user = messages[1]?.content as string;
    expect(user).toContain("MORNING_COACHING_BRIEF_V1");
    expect(user).toContain("MORNING_RELATIONSHIP_PACKET_V1");
    expect(user).toContain(JSON.stringify(brief));
    expect(user).toContain(JSON.stringify(packet));
    expect(user).toMatch(/Return JSON only/);
    expect(user).not.toMatch(/DAILY_SMS_WRITING_BRIEF|slot_coaching|hallway|notebook/i);
    expect(JSON.stringify(packet)).toBe(beforePacket);
    expect(JSON.stringify(brief)).toBe(beforeBrief);
  });

  it("system prompt encodes Brief authority and human coaching laws", () => {
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/Brief controls coaching meaning/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/natural language only/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/not mechanically translate/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/answered before coaching/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/primary_move is "answer"/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/not compulsory daily homework/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/Meaningful life moments may outrank/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/AVAILABLE does not mean MENTION/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/selected_person/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/claims_to_avoid/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/not style samples/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/At most one useful question/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/authoritative clock/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/not the wall-clock time/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/Do not blindly reuse/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(
      /Evening does not automatically mean every action opportunity is over/
    );
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(
      /morning does not mean today's result is already known/
    );
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/Preserve uncertainty from the Brief/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(
      /do not collapse one possibility into an asserted premise/i
    );
    expect(MORNING_TTO_SYSTEM_PROMPT).not.toMatch(/should_send/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).not.toMatch(/post-writer|repair pass/i);
  });

  it("Thursday generation / Friday message_for keeps Friday morning in exact writer input", () => {
    const packet = samplePacket({
      message_for: {
        timezone: "America/New_York",
        local_date: "2026-08-07",
        local_weekday: "Friday",
        daypart: "morning",
      },
      current_goal: { text: "Stretch before bed tonight" },
    });
    const user = buildMorningWriterMessages(packet, sampleBrief())[1]?.content as string;
    expect(user).toContain('"local_date":"2026-08-07"');
    expect(user).toContain('"local_weekday":"Friday"');
    expect(user).toContain('"daypart":"morning"');
    expect(user).toContain("Stretch before bed tonight");
    // No deterministic completion assertion tables in source
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/morning-tto-writer.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/if \(.*bed.*morning/i);
    expect(src).not.toMatch(/Tuesday\/Thursday/);
    expect(src).not.toMatch(/days_since.*reconnect/);
  });

  it("weekday-specific goal fixture does not add deterministic rule tables", () => {
    const packet = samplePacket({
      message_for: {
        timezone: "America/New_York",
        local_date: "2026-08-07",
        local_weekday: "Friday",
        daypart: "morning",
      },
      current_goal: { text: "Tuesday/Thursday gym session" },
    });
    const user = buildMorningWriterMessages(packet, sampleBrief())[1]?.content as string;
    expect(user).toContain("Tuesday/Thursday gym session");
    expect(user).toContain('"local_weekday":"Friday"');
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/morning-tto-writer.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/gym session.*today/);
    expect(src).toMatch(/Understand semantic timing with intelligence/);
  });

  it("returns openai_unavailable when API key missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await writeMorningTtoBody({
      packet: samplePacket(),
      morningCoachingBrief: sampleBrief(),
    });
    expect(result).toEqual({ ok: false, error: "openai_unavailable" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("Sol request shape: gpt-5.6-sol, low reasoning, 1200 max, json_object, no temperature", async () => {
    createMock.mockResolvedValue(
      completion('{"body":"Good morning — glad you got that hour in yesterday."}')
    );

    const result = await writeMorningTtoBody({
      packet: samplePacket(),
      morningCoachingBrief: sampleBrief(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatch(/glad you got/);
    expect(result.model).toBe("gpt-5.6-sol");
    expect(result.writer_prompt_path).toBe(MORNING_TTO_WRITER_PROMPT_PATH);
    expect(MORNING_TTO_WRITER_MODEL).toBe("gpt-5.6-sol");
    expect(MORNING_TTO_WRITER_REASONING_EFFORT).toBe("low");
    expect(MORNING_TTO_WRITER_MAX_COMPLETION_TOKENS).toBe(1200);

    const req = createMock.mock.calls[0]?.[0];
    expect(req.model).toBe("gpt-5.6-sol");
    expect(req.reasoning_effort).toBe("low");
    expect(req.max_completion_tokens).toBe(1200);
    expect(req.response_format).toEqual({ type: "json_object" });
    expect(req).not.toHaveProperty("temperature");
    expect(req).not.toHaveProperty("max_tokens");
    expect(createMock).toHaveBeenCalledTimes(1);

    expect(result.capture.raw_response).toContain('"body"');
    expect(result.capture.temperature).toBeNull();
    expect(result.capture.reasoning_effort).toBe("low");
    expect(result.capture.max_completion_tokens).toBe(1200);
    expect(result.capture.retry_occurred).toBe(false);
  });

  it("one technical JSON retry on invalid then success; same Sol model", async () => {
    createMock
      .mockResolvedValueOnce(completion("not-json"))
      .mockResolvedValueOnce(completion('{"body":"Retry body after fix."}'));

    const result = await writeMorningTtoBody({
      packet: samplePacket(),
      morningCoachingBrief: sampleBrief(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toBe("Retry body after fix.");
    expect(result.retryOccurred).toBe(true);
    expect(result.retryMessages).toHaveLength(2);
    expect(result.retryMessages[1]?.content).toMatch(/invalid JSON|strict JSON/i);
    expect(result.retryMessages[1]?.content).toMatch(/fix format only/i);
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[1]?.[0].model).toBe("gpt-5.6-sol");
    expect(result.capture.raw_response).toBe("not-json");
    expect(result.capture.raw_retry_response).toContain("Retry body");
    expect(result.capture.retry_succeeded).toBe(true);
  });

  it("invalid twice → failure with no fallback body", async () => {
    createMock
      .mockResolvedValueOnce(completion("not json"))
      .mockResolvedValueOnce(completion("still bad"));

    const result = await writeMorningTtoBody({
      packet: samplePacket(),
      morningCoachingBrief: sampleBrief(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_json");
    expect(result.retryOccurred).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(result).not.toHaveProperty("body");
  });

  it("empty body → failure", async () => {
    createMock
      .mockResolvedValueOnce(completion('{"body":"   "}'))
      .mockResolvedValueOnce(completion('{"body":""}'));

    const result = await writeMorningTtoBody({
      packet: samplePacket(),
      morningCoachingBrief: sampleBrief(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("empty_body");
  });

  it("returns openai_request_failed on thrown request error", async () => {
    const err = Object.assign(new Error("429 rate limit"), {
      status: 429,
      code: "rate_limit_exceeded",
      type: "insufficient_quota",
      request_id: "req_writer_1",
      headers: { authorization: "Bearer sk-secret" },
      stack: "Error: 429 rate limit\n    at fail",
    });
    createMock.mockRejectedValue(err);

    const result = await writeMorningTtoBody({
      packet: samplePacket(),
      morningCoachingBrief: sampleBrief(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("openai_request_failed");
    expect(result.retryOccurred).toBe(false);
    expect(result.model).toBe(MORNING_TTO_WRITER_MODEL);
    expect(result.capture?.error).toBe("openai_request_failed");
    expect(result.capture?.openai_error).toEqual({
      name: "Error",
      message: "429 rate limit",
      status: 429,
      code: "rate_limit_exceeded",
      type: "insufficient_quota",
      request_id: "req_writer_1",
    });
    expect(JSON.stringify(result.capture?.openai_error)).not.toContain("sk-secret");
    expect(JSON.stringify(result.capture?.openai_error)).not.toContain("at fail");
  });

  it("source has no lane helper, repair writer, fallback, or mini model", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/morning-tto-writer.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/runLaneOpenAiJsonWithOneRetry/);
    expect(src).not.toMatch(/gpt-4o-mini/);
    expect(src).not.toMatch(/human-sms-brain|final-voice-gate|hallway/i);
    expect(src).not.toMatch(/deterministic fallback|repair writer/i);
    expect(src).toMatch(/gpt-5\.6-sol/);
    expect(src).toMatch(/max_completion_tokens: MORNING_TTO_WRITER_MAX_COMPLETION_TOKENS/);
  });

  it("output remains body-only — no rationale keys in contract", async () => {
    createMock.mockResolvedValue(
      completion('{"body":"Hello.","rationale":"should be ignored by parser"}')
    );
    const result = await writeMorningTtoBody({
      packet: samplePacket(),
      morningCoachingBrief: sampleBrief(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toBe("Hello.");
    expect(Object.keys(result).sort()).toEqual(
      expect.arrayContaining([
        "ok",
        "body",
        "messages",
        "primaryMessages",
        "retryMessages",
        "retryOccurred",
        "writer_prompt_path",
        "model",
        "capture",
      ])
    );
  });
});
