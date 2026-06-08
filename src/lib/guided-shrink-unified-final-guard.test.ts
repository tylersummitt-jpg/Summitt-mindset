import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GUIDED_SHRINK_CONTRACT_ROUTE_PURPOSE,
  buildGuidedShrinkOutboundDailyGuardArgs,
} from "@/lib/guided-outbound-contract-proposal-evidence";
import { OUTBOUND_DAILY_UNSUPPORTED_PROOF_NO_SEND } from "@/lib/daily-outbound-final-guard-evidence";
import {
  OUTBOUND_DAILY_C2_CHECKS_SKIPPED,
  UNIFIED_FINAL_BODY_AUTHORITY,
  applyUnifiedSmsFinalProductLawGuard,
} from "@/lib/sms-final-product-law-guard";
import {
  DAILY_CONTRACT_PROPOSAL_FALSE_STATE_CLAIM_NO_SEND,
  DAILY_CONTRACT_PROPOSAL_SEMANTIC_MISSING_NO_SEND,
} from "@/lib/daily-outbound-contract-proposal-truth";
import { isOutboundDailyC2RoutePurpose } from "@/lib/daily-outbound-final-guard-evidence";
import { RAPID_NEAR_DUPLICATE_REPLY_NO_SEND } from "@/lib/inbound-near-duplicate-reply-policy";
import {
  UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
} from "@/lib/inbound-final-body-truth-guard";

vi.mock("@/lib/inbound-final-body-truth-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inbound-final-body-truth-guard")>();
  return {
    ...actual,
    applyInboundFinalBodyTruthGuard: vi.fn(),
  };
});

vi.mock("@/lib/inbound-near-duplicate-reply-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inbound-near-duplicate-reply-policy")>();
  return {
    ...actual,
    applyRapidNearDuplicateCoachReplyGuard: vi.fn(),
  };
});

vi.mock("@/lib/sms-relationship-memory-packet", () => ({
  buildSmsRelationshipMemoryPacket: vi.fn(async () => ({
    last_outbound_full_body: null,
    recent_exact_thread_72h: {},
  })),
}));

import { applyInboundFinalBodyTruthGuard } from "@/lib/inbound-final-body-truth-guard";
import { applyRapidNearDuplicateCoachReplyGuard } from "@/lib/inbound-near-duplicate-reply-policy";

const nearDupMock = vi.mocked(applyRapidNearDuplicateCoachReplyGuard);
const truthGuardMock = vi.mocked(applyInboundFinalBodyTruthGuard);

const GUIDED_LIB = path.join(process.cwd(), "src/lib/v2-adaptive-contract.ts");
const DAILY_ROUTE = path.join(process.cwd(), "src/app/api/cron/daily-sms/route.ts");
const WEEKLY_ROUTE = path.join(process.cwd(), "src/app/api/cron/weekly-sms/route.ts");
const INBOUND_ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");
const TWILIO_LIB = path.join(process.cwd(), "src/lib/twilio.ts");

const SHRINK_ASK = "Walk ten minutes daily";
const BASE_BEHAVIOR = "Two hours of deep work each morning";

const PASS_NEAR_DUP = {
  body: "",
  shouldSend: true,
  noSendReason: null,
  detection: {
    is_near_duplicate: false,
    reason: "not_duplicate" as const,
    within_recency_window: false,
    short_ack_inbound: false,
  },
  metadata: { rapid_near_duplicate_guard_ran: true },
};

const PASS_TRUTH = {
  body: "",
  shouldSend: true,
  noSendReason: null,
  metadata: { unsupported_accountability_claim_guard_ran: true },
};

async function guidedGuardArgs(body: string) {
  const outboundDaily = await buildGuidedShrinkOutboundDailyGuardArgs({
    body,
    clerkUserId: "user_guided_1",
    commitmentId: "cmt_guided_1",
    proposalBindingText: SHRINK_ASK,
    originalBehaviorStatement: BASE_BEHAVIOR,
    priorCoachBody: `Would ${SHRINK_ASK} work for you this week?`,
  });
  return {
    mode: "outbound_daily" as const,
    surface: "daily" as const,
    routePurpose: GUIDED_SHRINK_CONTRACT_ROUTE_PURPOSE,
    branchName: GUIDED_SHRINK_CONTRACT_ROUTE_PURPOSE,
    preGuardBodyPreview: body,
    outboundDaily,
  };
}

function validGuidedBody() {
  return `Let’s simplify for a bit: ${SHRINK_ASK} Want me to hold you to that? A clear yes or no is enough.`;
}

describe("Phase 2.4a guided shrink unified final guard", () => {
  beforeEach(() => {
    nearDupMock.mockReset();
    truthGuardMock.mockReset();
    nearDupMock.mockImplementation(async (args) => ({
      ...PASS_NEAR_DUP,
      body: args.body,
    }));
    truthGuardMock.mockImplementation(async (args) => ({
      ...PASS_TRUTH,
      body: args.body,
    }));
  });

  it("1: guided_shrink_contract_prompt is C2 outbound_daily route purpose", () => {
    expect(isOutboundDailyC2RoutePurpose(GUIDED_SHRINK_CONTRACT_ROUTE_PURPOSE)).toBe(true);
  });

  it("2: valid guided shrink proposal passes unified guard", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(await guidedGuardArgs(validGuidedBody()));
    expect(r.should_send).toBe(true);
    expect(r.guard_mode).toBe("outbound_daily");
    expect(r.checks_run).toContain("contract_proposal_truth_recheck");
    expect(r.checks_skipped).toEqual(OUTBOUND_DAILY_C2_CHECKS_SKIPPED);
    expect(r.final_body_authority).toBe(UNIFIED_FINAL_BODY_AUTHORITY);
  });

  it("3: fake completion blocked", async () => {
    truthGuardMock.mockResolvedValueOnce({
      body: "",
      shouldSend: false,
      noSendReason: UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
      metadata: {},
    });
    const r = await applyUnifiedSmsFinalProductLawGuard(
      await guidedGuardArgs("Great — you completed your workout today!")
    );
    expect(r.should_send).toBe(false);
  });

  it("4: fake Victory / proof blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      await guidedGuardArgs(`That's proof for your Victory Room streak with ${SHRINK_ASK}.`)
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(OUTBOUND_DAILY_UNSUPPORTED_PROOF_NO_SEND);
  });

  it("5: false goal already changed blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      await guidedGuardArgs(`Your goal already changed to ${SHRINK_ASK}. Sound good?`)
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(DAILY_CONTRACT_PROPOSAL_FALSE_STATE_CLAIM_NO_SEND);
  });

  it("6: false proposal active / accepted blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      await guidedGuardArgs(
        `Would ${SHRINK_ASK} work for you this week? You already accepted it and the proposal is active.`
      )
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(DAILY_CONTRACT_PROPOSAL_FALSE_STATE_CLAIM_NO_SEND);
  });

  it("7: missing proposed smaller bar blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      await guidedGuardArgs("Want to adjust something this week?")
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(DAILY_CONTRACT_PROPOSAL_SEMANTIC_MISSING_NO_SEND);
  });

  it("8: robotic Reply YES blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      await guidedGuardArgs(`${SHRINK_ASK}. Reply YES to confirm or NO to discard.`)
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(DAILY_CONTRACT_PROPOSAL_SEMANTIC_MISSING_NO_SEND);
  });

  it("9: near-duplicate blocked", async () => {
    nearDupMock.mockResolvedValueOnce({
      ...PASS_NEAR_DUP,
      shouldSend: false,
      noSendReason: RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
      body: validGuidedBody(),
    });
    const r = await applyUnifiedSmsFinalProductLawGuard(await guidedGuardArgs(validGuidedBody()));
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(RAPID_NEAR_DUPLICATE_REPLY_NO_SEND);
  });

  it("10: OCEG repair that removes proposal meaning blocked", async () => {
    truthGuardMock.mockResolvedValueOnce({
      ...PASS_TRUTH,
      body: "Want to adjust something this week?",
    });
    const r = await applyUnifiedSmsFinalProductLawGuard(await guidedGuardArgs(validGuidedBody()));
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(DAILY_CONTRACT_PROPOSAL_SEMANTIC_MISSING_NO_SEND);
  });
});

describe("Phase 2.4a guided shrink wiring (source)", () => {
  const guidedSrc = fs.readFileSync(GUIDED_LIB, "utf8");

  it("11: proposeShrinkAsk calls unified guard after FVG", () => {
    const fvgIdx = guidedSrc.indexOf("applyFinalVoiceOwnershipGate");
    const guardIdx = guidedSrc.indexOf("applyUnifiedSmsFinalProductLawGuard");
    const bindingIdx = guidedSrc.indexOf("latestOutboundBodyContainsAdaptiveProposalBindingNeedle(finalGuidedBody");
    const sendIdx = guidedSrc.indexOf("await sendSMS({");
    expect(fvgIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(fvgIdx);
    expect(bindingIdx).toBeGreaterThan(guardIdx);
    expect(sendIdx).toBeGreaterThan(bindingIdx);
  });

  it("12: uses outbound_daily + guided_shrink_contract_prompt", () => {
    expect(guidedSrc).toContain('mode: "outbound_daily"');
    expect(guidedSrc).toContain('routePurpose: GUIDED_SHRINK_CONTRACT_ROUTE_PURPOSE');
    expect(guidedSrc).toContain("buildGuidedShrinkOutboundDailyGuardArgs");
  });

  it("13: unified guard no-send returns unified_final_guard_no_send", () => {
    expect(guidedSrc).toContain('error: "unified_final_guard_no_send"');
    expect(guidedSrc).toContain("rollbackGuidedContractProposalReservation");
    expect(guidedSrc).toContain('skip_source: "unified_final_guard_no_send"');
  });

  it("14: binding needle stage post_unified_guard on success metadata", () => {
    expect(guidedSrc).toContain('bindingNeedleStage: bindingNeedleVerified && !dryRun ? "post_unified_guard"');
    expect(guidedSrc).toContain("final_body_authority");
  });

  it("26: daily route untouched by guided wiring", () => {
    const daily = fs.readFileSync(DAILY_ROUTE, "utf8");
    expect(daily).not.toContain("guided_shrink_contract_prompt");
    expect(daily).not.toContain("buildGuidedShrinkOutboundDailyGuardArgs");
  });

  it("27: weekly untouched", () => {
    const weekly = fs.readFileSync(WEEKLY_ROUTE, "utf8");
    expect(weekly).not.toContain("guided_shrink_contract_prompt");
  });

  it("28: inbound untouched", () => {
    const inbound = fs.readFileSync(INBOUND_ROUTE, "utf8");
    expect(inbound).not.toContain("guided_shrink_contract_prompt");
  });

  it("29: no Twilio/send internals changed", () => {
    const twilio = fs.readFileSync(TWILIO_LIB, "utf8");
    expect(twilio).not.toContain("guided_shrink");
    expect(guidedSrc).toContain("await sendSMS({");
  });

  it("31: no hard-coded SMS in guided wiring", () => {
    const block = guidedSrc.slice(
      guidedSrc.indexOf("proposeShrinkAskFromGuidedResolution"),
      guidedSrc.indexOf("return { ok: true; messageSid }")
    );
    expect(block).not.toContain('body: "');
    expect(block).not.toMatch(/smsBody\s*=\s*"/);
  });
});
