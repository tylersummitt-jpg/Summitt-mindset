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
    current_local: {
      timezone: "America/Chicago",
      local_date: "2026-06-22",
      local_weekday: "Monday",
      local_time: "10:30",
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
      messages: [
        {
          sender: "user",
          sent_at_utc: "2026-06-21T16:00:00.000Z",
          sent_at_local: "Jun 21, 11:00 AM",
          local_weekday: "Sunday",
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
    });

    const result = await writeMorningTtoBody(samplePacket());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toBe("Good morning — glad you got that hour in yesterday.");
    expect(result.writer_prompt_path).toBe("morning_relationship_v1");
    expect(result.model).toBe(MORNING_TTO_WRITER_MODEL);
    expect(result.messages).toHaveLength(2);
    expect(runLaneOpenAiJsonWithOneRetry).toHaveBeenCalledTimes(1);
  });

  it("returns invalid_json when parse fails after retry path", async () => {
    runLaneOpenAiJsonWithOneRetry.mockResolvedValue({
      value: null,
      raw: "not json",
      retryMeta: { lane_json_retry_attempted: true },
    });

    const result = await writeMorningTtoBody(samplePacket());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_json");
    expect(result.messages).toHaveLength(2);
  });

  it("returns empty_body when JSON parses but body is blank", async () => {
    runLaneOpenAiJsonWithOneRetry.mockResolvedValue({
      value: null,
      raw: '{"body":"   "}',
      retryMeta: { lane_json_retry_attempted: true },
    });

    const result = await writeMorningTtoBody(samplePacket());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("empty_body");
  });

  it("returns openai_request_failed on thrown request error", async () => {
    runLaneOpenAiJsonWithOneRetry.mockRejectedValue(new Error("network down"));

    const result = await writeMorningTtoBody(samplePacket());
    expect(result).toEqual({
      ok: false,
      error: "openai_request_failed",
      messages: expect.any(Array),
    });
  });

  it("uses one OpenAI call helper with JSON schema reminder for body only", async () => {
    runLaneOpenAiJsonWithOneRetry.mockResolvedValue({
      value: { body: "Morning check-in." },
      raw: '{"body":"Morning check-in."}',
      retryMeta: {},
    });

    await writeMorningTtoBody(samplePacket());

    const call = runLaneOpenAiJsonWithOneRetry.mock.calls[0]?.[0];
    expect(call?.jsonSchemaReminder).toMatch(/body/i);
    expect(call?.jsonSchemaReminder).not.toMatch(/should_send/i);
  });
});
