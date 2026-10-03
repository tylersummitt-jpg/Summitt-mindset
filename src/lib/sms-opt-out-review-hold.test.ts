import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildInboundSolBriefExactContractPromptAppendix } from "@/lib/inbound-sol-brief-json-schema";
import { parseInboundSolBriefExtras } from "@/lib/inbound-sol-coaching-brief";
import { INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT } from "@/lib/inbound-sol-brief-interpreter";
import { INBOUND_SOL_WRITER_SYSTEM_PROMPT } from "@/lib/inbound-sol-writer";
import {
  detectSmsRelationshipExitIntent,
  goalChangeCommitsBeforeInboundSolBrief,
  isRelationshipExitLaneActive,
} from "@/lib/sms-relationship-exit-intent";
import { SMS_OPT_OUT_REVIEW_ACK_BODY } from "@/lib/sms-opt-out-review-hold";

const REPO = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

function extras(overrides: Record<string, unknown> = {}) {
  return {
    answer_priority: "normal",
    coaching_after_answer: "no",
    user_is_correcting_coach: false,
    accountability_interpretation: {
      relevance: "unrelated",
      outcome: "not_applicable",
      confidence: "high",
      evidence: "hello",
    },
    meaningful_win: null,
    ...overrides,
  };
}

const YES_EXAMPLES = [
  "I need to stop getting these messages.",
  "Please stop texting me.",
  "I don't want these messages anymore.",
  "Don't send me these coaching texts anymore.",
];

const NO_EXAMPLES = [
  "Stop asking me about workouts.",
  "Pause texts until Monday.",
  "These texts are too much.",
  "Leave me alone.",
  "I need to stop eating junk food.",
  "Don't stop encouraging me.",
];

describe("likely_all_proactive_sms_stop contract", () => {
  const appendix = buildInboundSolBriefExactContractPromptAppendix();

  it("asks Sol the narrow question and lists the yes and no examples", () => {
    expect(appendix).toContain("likely_all_proactive_sms_stop: yes | no");
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain("likely_all_proactive_sms_stop");
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain("When unsure, no");
    for (const sentence of YES_EXAMPLES) {
      expect(appendix).toContain(sentence);
    }
    for (const sentence of NO_EXAMPLES) {
      expect(appendix).toContain(sentence);
    }
  });

  it("parser accepts only exact yes; missing and anything else are no", () => {
    expect(parseInboundSolBriefExtras(extras({ likely_all_proactive_sms_stop: "yes" }))
      ?.likely_all_proactive_sms_stop).toBe("yes");
    expect(parseInboundSolBriefExtras(extras({ likely_all_proactive_sms_stop: "no" }))
      ?.likely_all_proactive_sms_stop).toBe("no");
    expect(parseInboundSolBriefExtras(extras())?.likely_all_proactive_sms_stop).toBe("no");
    expect(parseInboundSolBriefExtras(extras({ likely_all_proactive_sms_stop: "unclear" }))
      ?.likely_all_proactive_sms_stop).toBe("no");
  });

  it("writer must not claim texts were stopped", () => {
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain("Never say the texts are off");
    expect(SMS_OPT_OUT_REVIEW_ACK_BODY).toBe(
      "I hear you. I’m making sure this gets handled."
    );
    expect(SMS_OPT_OUT_REVIEW_ACK_BODY.toLowerCase()).not.toContain("unsubscribed");
    expect(SMS_OPT_OUT_REVIEW_ACK_BODY.toLowerCase()).not.toContain("texts are off");
  });

  it("texting phrases stay a relationship lane and still reach Sol for the hold", () => {
    const det = detectSmsRelationshipExitIntent("Please stop texting me.");
    expect(det.category).toBe("texting_soft_opt_out");
    expect(
      isRelationshipExitLaneActive({ detection: det, deferToGoalHandoff: false })
    ).toBe(true);
    expect(
      goalChangeCommitsBeforeInboundSolBrief({
        relationshipExitLaneActive: true,
        identityEditLaneActive: false,
      })
    ).toBe(false);
    const leave = detectSmsRelationshipExitIntent("Leave me alone.");
    expect(leave.category).toBe("texting_soft_opt_out");
    expect(
      isRelationshipExitLaneActive({ detection: leave, deferToGoalHandoff: false })
    ).toBe(true);
    const workouts = detectSmsRelationshipExitIntent("Stop asking me about workouts.");
    expect(workouts.category).not.toBe("texting_soft_opt_out");
    expect(
      goalChangeCommitsBeforeInboundSolBrief({
        relationshipExitLaneActive: false,
        identityEditLaneActive: false,
      })
    ).toBe(true);
    const route = read("src/app/api/cron/sms-inbound-coach/route.ts");
    expect(route).toContain("textingSoftOptOutHoldJudgment");
    expect(route).toContain("relationshipBoundaryTurn: textingSoftOptOutHoldJudgment");
    expect(route).not.toContain("deferred_until_after_opt_out_judgment");
    expect(route).not.toContain("openGoalChangeAfterOptOutCheck");
    expect(route).not.toContain("sendFollowupSmsOptOutReviewAcknowledgment");
  });
});

describe("opt-out review hold wiring", () => {
  const route = read("src/app/api/cron/sms-inbound-coach/route.ts");
  const turn = read("src/lib/inbound-sol-relationship-turn.ts");
  const helper = read("src/lib/sms-opt-out-review-hold.ts");
  const daily = read("src/app/api/cron/daily-sms/route.ts");
  const evening = read("src/lib/tyler-text-overview-evening-send.ts");
  const weeklySend = read("src/lib/tyler-text-overview-weekly-send.ts");
  const weeklyCron = read("src/app/api/cron/weekly-sms/route.ts");
  const burst = read("src/lib/sms-inbound-burst-pace.ts");
  const twilioInbound = read("src/app/api/twilio/inbound/route.ts");

  it("yes returns before wins and the coaching writer, and the turn does not open Goal Change", () => {
    const yesIdx = turn.indexOf('likely_all_proactive_sms_stop === "yes"');
    expect(yesIdx).toBeGreaterThan(0);
    expect(turn).not.toContain("runSolGoalChangePendingOpenForInbound");
    expect(turn.indexOf("writeInboundSolBody", yesIdx)).toBeGreaterThan(yesIdx);
    expect(turn).toContain('noSend("sms_opt_out_review"');
    expect(turn).toContain('noSend("sms_opt_out_review_already_open"');
    expect(turn).toContain("relationshipBoundaryTurn");
    expect(turn).toContain("buildRelationshipExitLaneGuardrails");
  });

  it("acknowledgment does not use the reply status machine and keeps the hold", () => {
    const holdFn = helper.slice(
      helper.indexOf("export async function sendSmsOptOutReviewAcknowledgment"),
      helper.indexOf("async function noteAckFailure")
    );
    expect(holdFn).not.toContain("commitAndSendInboundCoachReply");
    expect(holdFn).not.toContain('status: "sent"');
    expect(holdFn).not.toContain('status: "failed"');
    expect(helper).not.toContain("commitAndSendInboundCoachReply");
    expect(helper).not.toContain('status: "failed"');
    expect(helper).toContain('status: AWAITING_SMS_OPT_OUT_REVIEW_STATUS');
    expect(helper).toContain("deliveryPatch.outbound_message_sid = outboundSid");
    expect(helper).toContain("sent_at: sentAt");
    const delivery = helper.indexOf("deliveryPatch.outbound_message_sid = outboundSid");
    const sentAt = helper.indexOf("sent_at: sentAt");
    expect(Math.abs(delivery - sentAt)).toBeLessThan(400);
  });

  it("repair will not rewrite a review row that has an outbound id", () => {
    const repair = route.indexOf("async function repairOutboundSidWithoutSentAt");
    const block = route.slice(repair, repair + 700);
    expect(block).toContain('.neq("status", AWAITING_SMS_OPT_OUT_REVIEW_STATUS)');
  });

  it("review status is not claimable and not in-flight", () => {
    expect(route).toContain('.in("status", ["pending", "failed", "reply_ready"])');
    expect(burst).not.toContain("awaiting_sms_opt_out_review");
    const claim = route.indexOf('.in("status", ["pending", "failed", "reply_ready"])');
    expect(route.slice(claim, claim + 80)).not.toContain("awaiting_sms_opt_out_review");
    expect(route).toContain("if (job.status === AWAITING_SMS_OPT_OUT_REVIEW_STATUS)");
  });

  it("an open review does not cancel the next inbound reply", () => {
    const gate = route.indexOf("inbound_sol_awaiting_manual_pat_answer_blocks_followup");
    const block = route.slice(gate - 500, gate);
    expect(block).toContain("hasAwaitingManualPatAnswer");
    expect(block).not.toContain("hasAwaitingSmsOptOutReview");
    expect(block).not.toContain("awaiting_sms_opt_out_review");
  });

  it("first hold ack returns before commitAndSend; a second yes does not park another row", () => {
    const reason = route.indexOf('solTurn.noSendReason === "sms_opt_out_review"');
    const block = route.slice(reason, reason + 2800);
    const ackOk = block.indexOf("if (ack.ok)");
    const already = block.indexOf('ack.outcome === "already_open_other"');
    expect(ackOk).toBeGreaterThan(0);
    expect(already).toBeGreaterThan(ackOk);
    expect(block).toContain('status: "cancelled"');
    expect(block).toContain("inbound_sol_sms_opt_out_review_already_open");
    expect(block).not.toContain("sendFollowupSmsOptOutReviewAcknowledgment");
    expect(block).not.toContain("commitAndSendInboundCoachReply");
  });

  it("Morning main and retry skip a held member before Twilio", () => {
    const retry = daily.indexOf('path: "retry",\n                skip_reason: AWAITING_SMS_OPT_OUT_REVIEW_SKIP_REASON');
    const main = daily.indexOf('path: "main",\n          skip_reason: AWAITING_SMS_OPT_OUT_REVIEW_SKIP_REASON');
    expect(retry).toBeGreaterThan(0);
    expect(main).toBeGreaterThan(retry);
    expect(daily.indexOf("shouldSkipDailyForAwaitingSmsOptOutReview")).toBeLessThan(
      daily.indexOf("await sendSMS({")
    );
  });

  it("Evening, Weekly send, and Weekly cron skip before Twilio, including manual Weekly", () => {
    expect(evening.indexOf("hasAwaitingSmsOptOutReview")).toBeLessThan(
      evening.indexOf("await sendSMS(")
    );
    const sendFn = weeklySend.indexOf("async function sendWeeklyTtoDraftAuthoritative");
    const manual = weeklySend.indexOf("export async function sendWeeklyTtoDraftManually");
    expect(weeklySend.indexOf("hasAwaitingSmsOptOutReview", sendFn)).toBeLessThan(
      weeklySend.indexOf("await sendSMS(", sendFn)
    );
    expect(weeklySend.indexOf("sendWeeklyTtoDraftAuthoritative", manual)).toBeGreaterThan(manual);
    const early = weeklyCron.indexOf("await hasAwaitingSmsOptOutReview");
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(weeklyCron.indexOf("await sendWeeklyTtoDraftAuthoritative"));
  });

  it("exact STOP and START copy stay the same, and review cleanup is a separate write", () => {
    expect(twilioInbound).toContain("async function runStopFlow");
    expect(twilioInbound).toContain("async function runStartFlow");
    expect(twilioInbound).toContain("HELP_TWIML_BODY");
    expect(twilioInbound).toContain(
      'return twiml("You have been unsubscribed. Reply START to rejoin.")'
    );
    expect(twilioInbound).toContain("return twiml(START_TWIML_BODY)");
    const stopFn = twilioInbound.slice(
      twilioInbound.indexOf("async function runStopFlow"),
      twilioInbound.indexOf("async function runStartFlow")
    );
    const startFn = twilioInbound.slice(
      twilioInbound.indexOf("async function runStartFlow"),
      twilioInbound.indexOf("export async function POST")
    );
    expect(stopFn).not.toContain("closeOpenSmsOptOutReviewsAfterMemberStop");
    expect(startFn).not.toContain("closeOpenSmsOptOutReviewsAfterMemberStart");
    expect(twilioInbound).toContain("await closeOpenSmsOptOutReviewsAfterMemberStop(userId)");
    expect(twilioInbound).toContain("await closeOpenSmsOptOutReviewsAfterMemberStart(userId)");
  });
});

const db = vi.hoisted(() => ({
  jobs: [] as Array<{ message_sid: string; clerk_user_id: string; status: string }>,
  lookupError: null as { message: string } | null,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/twilio", () => ({
  isTwilioReady: () => true,
  sendSMSChunked: vi.fn(async () => ({
    chunkCount: 1,
    chunkLengths: [42],
    messageSids: ["SMout1"],
    firstStatus: "queued",
    firstSid: "SMout1",
  })),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => {
      const state: {
        op: "select" | "update";
        patch: Record<string, unknown> | null;
        filters: Record<string, unknown>;
      } = { op: "select", patch: null, filters: {} };
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (patch: Record<string, unknown>) => {
          state.op = "update";
          state.patch = patch;
          db.updates.push(patch);
          return builder;
        },
        eq: (k: string, v: unknown) => {
          state.filters[k] = v;
          return builder;
        },
        limit: () => builder,
        maybeSingle: async () => {
          if (db.lookupError && state.op === "select") {
            return { data: null, error: db.lookupError };
          }
          if (state.op === "update") {
            return { data: { message_sid: "SM1" }, error: null };
          }
          const rows = db.jobs.filter((j) => {
            if (
              typeof state.filters.clerk_user_id === "string" &&
              j.clerk_user_id !== state.filters.clerk_user_id
            ) {
              return false;
            }
            if (typeof state.filters.status === "string" && j.status !== state.filters.status) {
              return false;
            }
            return true;
          });
          return { data: rows[0] ?? null, error: null };
        },
        then: (
          resolve: (value: { data: null; error: null }) => void,
          _reject?: (reason: unknown) => void
        ) => resolve({ data: null, error: null }),
      };
      return builder;
    },
  },
}));

describe("hasAwaitingSmsOptOutReview", () => {
  beforeEach(() => {
    db.jobs = [];
    db.lookupError = null;
    db.updates = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fails closed when the lookup errors", async () => {
    const { hasAwaitingSmsOptOutReview } = await import("@/lib/sms-opt-out-review-hold");
    db.lookupError = { message: "db down" };
    expect(await hasAwaitingSmsOptOutReview("user_1")).toBe(true);
  });

  it("is true only for an open review row", async () => {
    const { hasAwaitingSmsOptOutReview } = await import("@/lib/sms-opt-out-review-hold");
    expect(await hasAwaitingSmsOptOutReview("user_1")).toBe(false);
    db.jobs.push({
      message_sid: "SMhold",
      clerk_user_id: "user_1",
      status: "awaiting_sms_opt_out_review",
    });
    expect(await hasAwaitingSmsOptOutReview("user_1")).toBe(true);
    expect(await hasAwaitingSmsOptOutReview("user_2")).toBe(false);
  });

  it("writes outbound sid and sent_at while status stays the review hold", async () => {
    const { sendSmsOptOutReviewAcknowledgment, AWAITING_SMS_OPT_OUT_REVIEW_STATUS } =
      await import("@/lib/sms-opt-out-review-hold");
    const result = await sendSmsOptOutReviewAcknowledgment({
      messageSid: "SM1",
      clerkUserId: "user_1",
      toPhone: "+15555550100",
    });
    expect(result).toEqual({ ok: true, outcome: "acknowledged" });
    const parked = db.updates.find((u) => u.status === AWAITING_SMS_OPT_OUT_REVIEW_STATUS && !u.sent_at);
    const delivered = db.updates.find((u) => u.sent_at && u.outbound_message_sid);
    expect(parked?.status).toBe(AWAITING_SMS_OPT_OUT_REVIEW_STATUS);
    expect(delivered).toMatchObject({
      status: AWAITING_SMS_OPT_OUT_REVIEW_STATUS,
      outbound_message_sid: "SMout1",
      reply_body: "I hear you. I’m making sure this gets handled.",
    });
    expect(typeof delivered?.sent_at).toBe("string");
    expect(db.updates.some((u) => u.status === "sent" || u.status === "failed")).toBe(false);
  });

  it("a second open review does not park this job", async () => {
    const { sendSmsOptOutReviewAcknowledgment } = await import("@/lib/sms-opt-out-review-hold");
    db.jobs.push({
      message_sid: "SMfirst",
      clerk_user_id: "user_1",
      status: "awaiting_sms_opt_out_review",
    });
    const result = await sendSmsOptOutReviewAcknowledgment({
      messageSid: "SM2",
      clerkUserId: "user_1",
      toPhone: "+15555550100",
    });
    expect(result).toEqual({
      ok: false,
      outcome: "already_open_other",
      error: "sms_opt_out_review_already_open",
    });
    expect(db.updates).toHaveLength(0);
    const { sendSMSChunked } = await import("@/lib/twilio");
    expect(sendSMSChunked).not.toHaveBeenCalled();
  });

  it("a failed Twilio send leaves the review parked", async () => {
    const { sendSmsOptOutReviewAcknowledgment, AWAITING_SMS_OPT_OUT_REVIEW_STATUS } =
      await import("@/lib/sms-opt-out-review-hold");
    const { sendSMSChunked } = await import("@/lib/twilio");
    vi.mocked(sendSMSChunked).mockRejectedValueOnce(new Error("twilio down"));
    const result = await sendSmsOptOutReviewAcknowledgment({
      messageSid: "SM1",
      clerkUserId: "user_1",
      toPhone: "+15555550100",
    });
    expect(result).toEqual({ ok: false, outcome: "ack_failed", error: "twilio down" });
    expect(
      db.updates.some((u) => u.status === AWAITING_SMS_OPT_OUT_REVIEW_STATUS)
    ).toBe(true);
    expect(db.updates.some((u) => u.status === "sent" || u.status === "failed")).toBe(false);
    expect(db.updates.some((u) => u.sent_at)).toBe(false);
  });
});
