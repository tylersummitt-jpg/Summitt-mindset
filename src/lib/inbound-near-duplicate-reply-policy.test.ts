import { describe, expect, it, vi } from "vitest";

import {
  applyRapidNearDuplicateCoachReplyGuard,
  detectRapidNearDuplicateCoachReply,
  isBriefLoopClosingCoachReply,
  isInboundShortAckOrPlanConfirmation,
  RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
  RAPID_NEAR_DUPLICATE_WINDOW_MS,
  resolvePriorCoachContextFromMemoryPacket,
} from "@/lib/inbound-near-duplicate-reply-policy";

vi.mock("@/lib/v3-sms-voice-ownership", () => ({
  repairV3RelationshipLaneBodyWithOpenAI: vi.fn(),
}));

import { repairV3RelationshipLaneBodyWithOpenAI } from "@/lib/v3-sms-voice-ownership";

const repairMock = vi.mocked(repairV3RelationshipLaneBodyWithOpenAI);
const NOW = Date.parse("2026-06-07T12:00:00.000Z");
const RECENT = new Date(NOW - 2 * 60 * 1000).toISOString();
const STALE = new Date(NOW - 2 * RAPID_NEAR_DUPLICATE_WINDOW_MS).toISOString();

const PRIOR_PROPOSAL =
  "How does committing to one hour of distribution per day sound?";

describe("detectRapidNearDuplicateCoachReply", () => {
  it("A: short ack + near-duplicate proposal → short_ack_repeated_proposal", () => {
    const r = detectRapidNearDuplicateCoachReply({
      candidateBody: "How do you feel about committing to one hour of distribution per day?",
      priorCoachBody: PRIOR_PROPOSAL,
      priorCoachSentAt: RECENT,
      inboundRaw: "Good",
      nowMs: NOW,
    });
    expect(r.is_near_duplicate).toBe(true);
    expect(r.reason).toBe("short_ack_repeated_proposal");
    expect(r.short_ack_inbound).toBe(true);
  });

  it("B: short ack + loop-close reply → allowed", () => {
    const body = "Good — we'll keep that plan in place.";
    expect(isBriefLoopClosingCoachReply(body)).toBe(true);
    const r = detectRapidNearDuplicateCoachReply({
      candidateBody: body,
      priorCoachBody: PRIOR_PROPOSAL,
      priorCoachSentAt: RECENT,
      inboundRaw: "Good",
      nowMs: NOW,
    });
    expect(r.is_near_duplicate).toBe(false);
  });

  it("C: real blocker inbound + follow-up → allowed", () => {
    const r = detectRapidNearDuplicateCoachReply({
      candidateBody: "Time is the blocker. What part of the day is most at risk?",
      priorCoachBody: PRIOR_PROPOSAL,
      priorCoachSentAt: RECENT,
      inboundRaw: "time got away from me",
      nowMs: NOW,
    });
    expect(r.is_near_duplicate).toBe(false);
  });

  it("D: short ack + repeated outcome-close question → rapid_same_question", () => {
    const prior = "Did the call with Bond happen, or did something get in the way?";
    const r = detectRapidNearDuplicateCoachReply({
      candidateBody: "Did the call with Bond happen, or did something get in the way today?",
      priorCoachBody: prior,
      priorCoachSentAt: RECENT,
      inboundRaw: "Will do",
      nowMs: NOW,
    });
    expect(r.is_near_duplicate).toBe(true);
    expect(r.reason).toBe("rapid_same_question");
  });

  it("E: short ack + barrier paraphrase after barrier ask → rapid_same_question", () => {
    const r = detectRapidNearDuplicateCoachReply({
      candidateBody: "What blocked you?",
      priorCoachBody: "What got in the way?",
      priorCoachSentAt: RECENT,
      inboundRaw: "Good",
      nowMs: NOW,
    });
    expect(r.is_near_duplicate).toBe(true);
    expect(r.reason).toBe("rapid_same_question");
  });

  it("F: substantive yes + what came out → allowed", () => {
    const r = detectRapidNearDuplicateCoachReply({
      candidateBody: "What came out of that conversation?",
      priorCoachBody: "Did the call with Bond happen?",
      priorCoachSentAt: RECENT,
      inboundRaw: "Yes, we talked.",
      nowMs: NOW,
    });
    expect(r.is_near_duplicate).toBe(false);
  });

  it("G: exact duplicate → exact_duplicate", () => {
    const r = detectRapidNearDuplicateCoachReply({
      candidateBody: PRIOR_PROPOSAL,
      priorCoachBody: PRIOR_PROPOSAL,
      priorCoachSentAt: RECENT,
      inboundRaw: "Good",
      nowMs: NOW,
    });
    expect(r.is_near_duplicate).toBe(true);
    expect(r.reason).toBe("exact_duplicate");
  });

  it("H: same goal words, different move → allowed", () => {
    const r = detectRapidNearDuplicateCoachReply({
      candidateBody: "What got in the way with distribution yesterday?",
      priorCoachBody: "Did you do your distribution hour?",
      priorCoachSentAt: RECENT,
      inboundRaw: "No",
      nowMs: NOW,
    });
    expect(r.is_near_duplicate).toBe(false);
  });

  it("outside recency window skips strict short-ack duplicate", () => {
    const r = detectRapidNearDuplicateCoachReply({
      candidateBody: "How do you feel about committing to one hour of distribution per day?",
      priorCoachBody: PRIOR_PROPOSAL,
      priorCoachSentAt: STALE,
      inboundRaw: "Good",
      nowMs: NOW,
    });
    expect(r.is_near_duplicate).toBe(false);
    expect(r.reason).toBe("inactive_outside_window");
  });

  it("isInboundShortAckOrPlanConfirmation detects common acks", () => {
    expect(isInboundShortAckOrPlanConfirmation("Good")).toBe(true);
    expect(isInboundShortAckOrPlanConfirmation("time got away from me")).toBe(false);
  });
});

describe("resolvePriorCoachContextFromMemoryPacket", () => {
  it("prefers memory packet last_outbound and 72h coach timestamp", () => {
    const ctx = resolvePriorCoachContextFromMemoryPacket({
      memoryPacket: {
        last_outbound_full_body: PRIOR_PROPOSAL,
        recent_exact_thread_72h: {
          messages: [
            {
              role: "coach",
              body: PRIOR_PROPOSAL,
              at: RECENT,
              at_local: "",
              at_local_timezone: "America/Chicago",
              message_kind: "coach",
              source_table: "sms_inbound_coach_jobs",
              message_sid: null,
              delivery_status: "sent",
              is_exact_body: true,
            },
          ],
          window_hours: 72,
          message_count: 1,
          had_preview_messages: false,
          had_system_no_send: false,
        },
      },
    });
    expect(ctx.priorCoachBody).toBe(PRIOR_PROPOSAL);
    expect(ctx.priorCoachSentAt).toBe(RECENT);
  });
});

describe("applyRapidNearDuplicateCoachReplyGuard", () => {
  it("no-send when repair still duplicates", async () => {
    repairMock.mockResolvedValueOnce({
      body: "How do you feel about committing to one hour of distribution per day?",
      openAiOk: true,
      metadata: {},
    });
    const r = await applyRapidNearDuplicateCoachReplyGuard({
      body: "How do you feel about committing to one hour of distribution per day?",
      priorCoachBody: PRIOR_PROPOSAL,
      priorCoachSentAt: RECENT,
      inboundRaw: "Good",
      nowMs: NOW,
    });
    expect(r.shouldSend).toBe(false);
    expect(r.noSendReason).toBe(RAPID_NEAR_DUPLICATE_REPLY_NO_SEND);
  });

  it("allows repaired loop-close body", async () => {
    repairMock.mockResolvedValueOnce({
      body: "Good — we'll keep that plan in place.",
      openAiOk: true,
      metadata: {},
    });
    const r = await applyRapidNearDuplicateCoachReplyGuard({
      body: "How do you feel about committing to one hour of distribution per day?",
      priorCoachBody: PRIOR_PROPOSAL,
      priorCoachSentAt: RECENT,
      inboundRaw: "Good",
      nowMs: NOW,
    });
    expect(r.shouldSend).toBe(true);
    expect(r.body).toContain("keep that plan");
  });
});
