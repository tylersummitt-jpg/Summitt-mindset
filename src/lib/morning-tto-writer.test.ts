import { describe, expect, it, vi, beforeEach } from "vitest";

const runLaneOpenAiJsonWithOneRetry = vi.hoisted(() => vi.fn());

vi.mock("@/lib/v3-lane-openai-json-retry", () => ({
  runLaneOpenAiJsonWithOneRetry,
}));

import {
  MORNING_TTO_SYSTEM_PROMPT,
  MORNING_TTO_WRITER_MODEL,
  buildMorningWriterMessages,
  writeMorningTtoBody,
} from "@/lib/morning-tto-writer";
import type { MorningRelationshipPacket } from "@/lib/morning-tto-relationship-packet";

function samplePacket(): MorningRelationshipPacket {
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
  };
}

describe("morning-tto-writer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("buildMorningWriterMessages uses packet JSON and hierarchy system prompt", () => {
    const packet = samplePacket();
    const messages = buildMorningWriterMessages(packet);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toBe(MORNING_TTO_SYSTEM_PROMPT);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/RELATIONSHIP FIRST/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/GOAL RELEVANCE FOURTH/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).not.toMatch(/should_send/i);

    const user = messages[1]?.content;
    expect(typeof user).toBe("string");
    expect(user).toContain("MORNING_RELATIONSHIP_PACKET_V1");
    expect(user).toContain('"version":"morning_relationship_v1"');
    expect(user).toContain("Write JSON only.");
  });

  it("prompt contracts message_for chronology and alive-now judgment", () => {
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/message_for/);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(
      /Relative-time words inside older thread messages belong to when those messages were sent/i
    );
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/already acknowledged/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/alive now/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/old praise, question, or topic/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).not.toMatch(/relationship_category/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).not.toMatch(/selected_move/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).not.toMatch(/must mention Current Goal/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/mention no goal/i);
  });

  it("architecture: one writer, no repair/validator/category fields in prompt path", () => {
    expect(MORNING_TTO_SYSTEM_PROMPT).not.toMatch(/post-writer|repair pass|temporal validator/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).not.toMatch(/coaching_posture|open_loop|stale_topic/i);
    const user = buildMorningWriterMessages(samplePacket())[1]?.content as string;
    expect(user).toContain('"message_for"');
    expect(user).not.toContain('"current_local"');
    expect(user).not.toContain("resolved_relative_reference");
    expect(user).not.toContain("relationship_category");
  });

  it("returns openai_unavailable when API key missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await writeMorningTtoBody(samplePacket());
    expect(result).toEqual({ ok: false, error: "openai_unavailable" });
    expect(runLaneOpenAiJsonWithOneRetry).not.toHaveBeenCalled();
  });

  it("returns success with body-only schema on valid OpenAI JSON", async () => {
    runLaneOpenAiJsonWithOneRetry.mockResolvedValue({
      value: { body: "Good morning — glad you got that hour in yesterday." },
      raw: '{"body":"Good morning — glad you got that hour in yesterday."}',
      retryMeta: {},
      retryFollowUpMessages: null,
    });

    const result = await writeMorningTtoBody(samplePacket());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toBe("Good morning — glad you got that hour in yesterday.");
    expect(result.writer_prompt_path).toBe("morning_relationship_v1");
    expect(result.model).toBe(MORNING_TTO_WRITER_MODEL);
    expect(result.messages).toHaveLength(2);
    expect(result.primaryMessages).toEqual(result.messages);
    expect(result.retryMessages).toEqual([]);
    expect(result.retryOccurred).toBe(false);
    expect(runLaneOpenAiJsonWithOneRetry).toHaveBeenCalledTimes(1);
  });

  it("returns exact retry transcript when technical JSON retry occurred", async () => {
    const retryFollowUpMessages = [
      { role: "assistant" as const, content: "not-json" },
      {
        role: "user" as const,
        content:
          'Your previous response was invalid JSON or did not parse. Return strict JSON only: {"body":"<nonempty sms text>"}\n\nRespond with JSON only.',
      },
    ];
    runLaneOpenAiJsonWithOneRetry.mockResolvedValue({
      value: { body: "Retry body after fix." },
      raw: '{"body":"Retry body after fix."}',
      retryMeta: { lane_json_retry_attempted: true },
      retryFollowUpMessages,
    });

    const result = await writeMorningTtoBody(samplePacket());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toBe("Retry body after fix.");
    expect(result.retryOccurred).toBe(true);
    expect(result.retryMessages).toEqual(retryFollowUpMessages);
    expect(result.primaryMessages).toHaveLength(2);
    expect(result.messages).toEqual(result.primaryMessages);
  });

  it("returns invalid_json when parse fails after retry path", async () => {
    runLaneOpenAiJsonWithOneRetry.mockResolvedValue({
      value: null,
      raw: "not json",
      retryMeta: { lane_json_retry_attempted: true },
      retryFollowUpMessages: [
        { role: "assistant", content: "not json" },
        { role: "user", content: "retry reminder" },
      ],
    });

    const result = await writeMorningTtoBody(samplePacket());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_json");
    expect(result.messages).toHaveLength(2);
    expect(result.retryOccurred).toBe(true);
    expect(result.retryMessages).toHaveLength(2);
  });

  it("returns empty_body when JSON parses but body is blank", async () => {
    runLaneOpenAiJsonWithOneRetry.mockResolvedValue({
      value: null,
      raw: '{"body":"   "}',
      retryMeta: { lane_json_retry_attempted: true },
      retryFollowUpMessages: null,
    });

    const result = await writeMorningTtoBody(samplePacket());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("empty_body");
  });

  it("returns openai_request_failed on thrown request error", async () => {
    runLaneOpenAiJsonWithOneRetry.mockRejectedValue(new Error("network down"));

    const result = await writeMorningTtoBody(samplePacket());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("openai_request_failed");
    expect(result.messages).toHaveLength(2);
    expect(result.retryMessages).toEqual([]);
    expect(result.retryOccurred).toBe(false);
    expect(result.model).toBe(MORNING_TTO_WRITER_MODEL);
  });

  it("uses one OpenAI call helper with JSON schema reminder for body only", async () => {
    runLaneOpenAiJsonWithOneRetry.mockResolvedValue({
      value: { body: "Morning check-in." },
      raw: '{"body":"Morning check-in."}',
      retryMeta: {},
      retryFollowUpMessages: null,
    });

    await writeMorningTtoBody(samplePacket());

    const call = runLaneOpenAiJsonWithOneRetry.mock.calls[0]?.[0];
    expect(call?.jsonSchemaReminder).toMatch(/body/i);
    expect(call?.jsonSchemaReminder).not.toMatch(/should_send/i);
  });
});
