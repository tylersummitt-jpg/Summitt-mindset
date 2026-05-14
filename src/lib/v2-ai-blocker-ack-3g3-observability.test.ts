import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildBlockerCapturedAckObservability } from "@/lib/v2-ai-blocker-ack";

const __dirname = dirname(fileURLToPath(import.meta.url));
const routePath = join(__dirname, "../app/api/cron/sms-inbound-coach/route.ts");
const route = readFileSync(routePath, "utf8");

describe("buildBlockerCapturedAckObservability (Phase 3G-3)", () => {
  const baseLane = { shouldSend: true, body: "Thanks for sharing.", noSendReason: null as string | null };

  it("lane no-send: sms_ack_sent false, inbound_v3_lane_no_send, lane reason", () => {
    const o = buildBlockerCapturedAckObservability({
      jobMessageSid: "SMlane1",
      ackLaneRes: { shouldSend: false, body: "", noSendReason: "model_no_send" },
      visibleSent: false,
      ackVoicePackForPayload: null,
      gatedAckBody: "",
    });
    expect(o.sms_ack_sent).toBe(false);
    expect(o.twilio_send_attempted).toBe(false);
    expect(o.inbound_v3_lane_used).toBe(true);
    expect(o.route_purpose).toBe("blocker_capture_ack");
    expect(o.job_message_sid).toBe("SMlane1");
    expect(o.no_send_tag).toBe("inbound_v3_lane_no_send");
    expect(o.lane_no_send_reason).toBe("model_no_send");
    expect(o.final_voice_gate_no_send).toBe(false);
    expect(o.final_voice_gate_no_send_reason).toBeNull();
    expect(o.visible_ack_body_preview).toBeNull();
    expect(o.state_first_sms_second_policy).toBe("blocker_captured_persists_even_if_ack_no_sends");
    expect(o.old_inbound_writer_used_as_voice).toBe(false);
  });

  it("FVG no-send: final_voice_gate_no_send true, reason from skipReason", () => {
    const o = buildBlockerCapturedAckObservability({
      jobMessageSid: "SMfvg1",
      ackLaneRes: baseLane,
      visibleSent: false,
      ackVoicePackForPayload: {
        voice: {
          shouldSend: false,
          skipReason: "no_safe_v3_voice",
          metadata: { k: "v" },
          blockedReasons: ["tone"],
        },
      },
      gatedAckBody: "",
    });
    expect(o.sms_ack_sent).toBe(false);
    expect(o.twilio_send_attempted).toBe(false);
    expect(o.no_send_tag).toBe("final_voice_gate_no_send");
    expect(o.final_voice_gate_no_send).toBe(true);
    expect(o.final_voice_gate_no_send_reason).toBe("no_safe_v3_voice");
    expect(o.lane_no_send_reason).toBeNull();
  });

  it("successful ACK: sms_ack_sent true, twilio_send_attempted true, preview set", () => {
    const body = "Got it — thanks for naming the friction.";
    const o = buildBlockerCapturedAckObservability({
      jobMessageSid: "SMok1",
      ackLaneRes: baseLane,
      visibleSent: true,
      ackVoicePackForPayload: {
        voice: {
          shouldSend: true,
          metadata: {},
          blockedReasons: [],
        },
      },
      gatedAckBody: body,
    });
    expect(o.sms_ack_sent).toBe(true);
    expect(o.twilio_send_attempted).toBe(true);
    expect(o.no_send_tag).toBeNull();
    expect(o.final_voice_gate_no_send).toBe(false);
    expect(o.final_voice_gate_no_send_reason).toBeNull();
    expect(o.visible_ack_body_preview).toBe(body);
    expect(o.lane_no_send_reason).toBeNull();
  });
});

describe("Phase 3G-3 — sms-inbound-coach blocker_captured payload wiring (static)", () => {
  it("merges buildBlockerCapturedAckObservability into blocker_captured payload_json before ai", () => {
    const idx = route.indexOf('event_type: "blocker_captured"');
    expect(idx).toBeGreaterThan(-1);
    const slice = route.slice(Math.max(0, idx - 3500), idx + 1200);
    expect(slice).toContain("buildBlockerCapturedAckObservability");
    expect(slice).toContain("...blockerAckObservability");
    expect(slice).toContain("ai: blockerAiPayload");
  });

  it("sets old_inbound_writer_used_as_voice on ai payload", () => {
    expect(route).toContain("old_inbound_writer_used_as_voice: false");
  });

  it("preserves blocker_captured idempotency key", () => {
    expect(route).toContain("v2_blocker_captured:${job.message_sid}");
  });
});
