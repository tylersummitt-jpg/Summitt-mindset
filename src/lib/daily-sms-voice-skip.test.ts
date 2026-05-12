import { describe, expect, it } from "vitest";

import { dailySmsVoiceSkipEventPatch, isDailySmsWithheldByFinalVoiceGate } from "./daily-sms-voice-skip";

describe("daily SMS final voice fail-closed wiring", () => {
  it("isDailySmsWithheldByFinalVoiceGate is true only for accountability + commitment + should_send false", () => {
    expect(
      isDailySmsWithheldByFinalVoiceGate({
        v2Accountability: true,
        v2CommitmentId: "c1",
        v2AiPayload: {
          voice_send_decision: { should_send: false },
        },
      })
    ).toBe(true);

    expect(
      isDailySmsWithheldByFinalVoiceGate({
        v2Accountability: false,
        v2CommitmentId: "c1",
        v2AiPayload: { voice_send_decision: { should_send: false } },
      })
    ).toBe(false);

    expect(
      isDailySmsWithheldByFinalVoiceGate({
        v2Accountability: true,
        v2CommitmentId: undefined,
        v2AiPayload: { voice_send_decision: { should_send: false } },
      })
    ).toBe(false);

    expect(
      isDailySmsWithheldByFinalVoiceGate({
        v2Accountability: true,
        v2CommitmentId: "c1",
        v2AiPayload: { voice_send_decision: { should_send: true } },
      })
    ).toBe(false);
  });

  it("dailySmsVoiceSkipEventPatch records inspectable skip metadata without Twilio SID", () => {
    const patch = dailySmsVoiceSkipEventPatch({
      existingMeta: { note: "reserved_by_cron", retry_count: 1 },
      northStarGate: { body_after_north_star: "unsafe candidate" },
      finalVoiceGate: { should_send: false, skip_reason: "no_safe_v3_voice" },
      channel: "daily_outbound",
      timezone: "America/Los_Angeles",
      localTimeIso: "2026-05-12T12:00:00.000Z",
      blockedReasons: ["malformed_did_raw_phrase_happen_today"],
      northStarVisibleBody: "Did Bad thing happen today?",
    });

    expect(patch.status).toBe("skipped_no_safe_v3_voice");
    expect(patch.sms_body).toBe("");
    expect(patch.metadata).toMatchObject({
      voice_decision: "skipped_no_safe_v3_voice",
      cron_route: "/api/cron/daily-sms",
      sms_purpose: "v2_daily_accountability_coaching",
      voice_channel: "daily_outbound",
      twilio_send_attempted: false,
      blocked_reasons: ["malformed_did_raw_phrase_happen_today"],
      north_star_visible_body: "Did Bad thing happen today?",
    });
    expect(patch.metadata).not.toHaveProperty("message_sid");
    expect(patch.metadata.final_voice_gate).toEqual({ should_send: false, skip_reason: "no_safe_v3_voice" });
  });
});
