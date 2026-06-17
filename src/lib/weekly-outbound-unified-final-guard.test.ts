import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  OUTBOUND_WEEKLY_CHECKS_SKIPPED,
  SMS_FINAL_PRODUCT_LAW_GUARD_VERSION,
  UNIFIED_FINAL_BODY_AUTHORITY,
  applyUnifiedSmsFinalProductLawGuard,
} from "@/lib/sms-final-product-law-guard";
import {
  OUTBOUND_WEEKLY_INTERNAL_LABEL_NO_SEND,
  OUTBOUND_WEEKLY_UNSUPPORTED_PROOF_NO_SEND,
  buildWeeklyOutboundOcegEvidence,
  buildWeeklyOutboundUnifiedGuardCtx,
  detectWeeklyOutboundUnsupportedProofClaim,
  isOutboundWeeklyWiredRoutePurpose,
} from "@/lib/weekly-outbound-final-guard-evidence";
import {
  WEEKLY_FALSE_STREAK_OR_PROGRESS_NO_SEND,
  WEEKLY_UNSUPPORTED_PROOF_OR_VICTORY_NO_SEND,
} from "@/lib/weekly-outbound-proof-truth";
import {
  UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
  detectUnsupportedAccountabilityClaimInOutbound,
} from "@/lib/inbound-final-body-truth-guard";
import { RAPID_NEAR_DUPLICATE_REPLY_NO_SEND } from "@/lib/inbound-near-duplicate-reply-policy";
import type { V2WeeklyProofPack } from "@/lib/v2-weekly-proof-sms";
import { alignWeeklyProofPackMissTelemetry } from "@/lib/weekly-outbound-final-guard-evidence";

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

import { applyInboundFinalBodyTruthGuard } from "@/lib/inbound-final-body-truth-guard";
import { applyRapidNearDuplicateCoachReplyGuard } from "@/lib/inbound-near-duplicate-reply-policy";

const nearDupMock = vi.mocked(applyRapidNearDuplicateCoachReplyGuard);
const truthGuardMock = vi.mocked(applyInboundFinalBodyTruthGuard);

const DAILY_ROUTE = path.join(process.cwd(), "src/app/api/cron/daily-sms/route.ts");
const INBOUND_ROUTE = path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts");
const WEEKLY_ROUTE = path.join(process.cwd(), "src/app/api/cron/weekly-sms/route.ts");
const TWILIO_SEND = path.join(process.cwd(), "src/lib/twilio.ts");

const PASS_NEAR_DUP = {
  body: "Weekly reflection body.",
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
  body: "Weekly reflection body.",
  shouldSend: true,
  noSendReason: null,
  metadata: { unsupported_accountability_claim_guard_ran: true },
};

function packBase(overrides?: Partial<V2WeeklyProofPack>): V2WeeklyProofPack {
  return alignWeeklyProofPackMissTelemetry({
    week_start: "2026-05-04",
    week_end: "2026-05-10",
    yes_count: 4,
    no_count: 1,
    partial_count: 0,
    check_sent_count: 5,
    blocker_count: 0,
    response_count: 5,
    silent_week: false,
    comeback_after_miss: false,
    blocker_preview_short: null,
    effective_ask_preview: "Morning hour",
    coaching_summary_short: null,
    preferred_name: "Alex",
    identity_anchor_short: null,
    weekly_evolution_coaching_line: null,
    proof_moment_hints: ["Logged early Tuesday"],
    pattern_events_newest_first: [],
    ...overrides,
  });
}

function weeklyGuardArgs(
  body = "A few clean wins this week on your morning bar — want to keep the same line?",
  packOverrides?: Partial<V2WeeklyProofPack>
) {
  const pack = packBase(packOverrides);
  const ctx = buildWeeklyOutboundUnifiedGuardCtx({
    routeKind: "weekly_proof_v2",
    clerkUserId: "user_1",
    commitmentId: "commit_1",
    pack,
    priorCoachBody: "Did you get your workout in yesterday?",
    priorCoachSentAt: null,
    effectiveAsk: "Morning hour",
    identityAnchor: null,
  });
  return {
    mode: "outbound_weekly" as const,
    surface: "weekly" as const,
    routePurpose: "weekly_proof_v2",
    branchName: "weekly_proof_v2",
    preGuardBodyPreview: body,
    outboundWeekly: {
      body,
      evidence: buildWeeklyOutboundOcegEvidence(ctx),
      weeklyGuardCtx: ctx,
      priorCoachBody: ctx.priorCoachBody,
      priorCoachSentAt: null,
      routePurpose: "weekly_proof_v2",
    },
  };
}

describe("Phase 2.3-B outbound_weekly unified guard", () => {
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

  it("1: outbound_weekly mode activates for weekly_proof_v2", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(weeklyGuardArgs());
    expect(r.should_send).toBe(true);
    expect(r.guard_mode).toBe("outbound_weekly");
    expect(r.final_body_authority).toBe(UNIFIED_FINAL_BODY_AUTHORITY);
    expect(r.guard_version).toBe(SMS_FINAL_PRODUCT_LAW_GUARD_VERSION);
    expect(r.checks_skipped).toEqual(OUTBOUND_WEEKLY_CHECKS_SKIPPED);
  });

  it("2: valid weekly recap sends", async () => {
    const body = "A few clean wins this week — want to keep the same bar?";
    const r = await applyUnifiedSmsFinalProductLawGuard(weeklyGuardArgs(body));
    expect(r.should_send).toBe(true);
    expect(r.body).toBe(body);
    expect(r.metadata.sent_body_equals_guard_body_pre_footer).toBe(true);
    expect(r.metadata.sent_body_equals_guard_body).toBeNull();
  });

  it("3: fake proof blocked via OCEG / proof detector", async () => {
    truthGuardMock.mockResolvedValueOnce({
      body: "",
      shouldSend: false,
      noSendReason: UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
      metadata: {},
    });
    const r = await applyUnifiedSmsFinalProductLawGuard(
      weeklyGuardArgs("Great to hear you completed your workout every single day.")
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND);
  });

  it("4: fake Victory blocked", async () => {
    const ctx = buildWeeklyOutboundUnifiedGuardCtx({
      routeKind: "weekly_proof_v2",
      clerkUserId: "u",
      commitmentId: "c",
      pack: packBase({ proof_moment_hints: [], yes_count: 0, silent_week: true, response_count: 0 }),
    });
    expect(
      detectWeeklyOutboundUnsupportedProofClaim("That's proof for your Victory Room.", ctx)?.violation
    ).toBeTruthy();
    const r = await applyUnifiedSmsFinalProductLawGuard(
      weeklyGuardArgs("That's proof for your Victory Room.")
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(OUTBOUND_WEEKLY_UNSUPPORTED_PROOF_NO_SEND);
  });

  it("5: false streak / every-day claim blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      weeklyGuardArgs("You completed every day this week — perfect week.", {
        yes_count: 2,
        no_count: 2,
        check_sent_count: 5,
      })
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(WEEKLY_FALSE_STREAK_OR_PROGRESS_NO_SEND);
  });

  it("6: silent/no-data week cannot invent progress", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      weeklyGuardArgs("Strong momentum this week — real progress on the bar.", {
        silent_week: true,
        response_count: 0,
        yes_count: 0,
        proof_moment_hints: [],
      })
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(WEEKLY_FALSE_STREAK_OR_PROGRESS_NO_SEND);
  });

  it("7: rough week cannot be called amazing/perfect", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      weeklyGuardArgs("Amazing week — you were crushing it.", {
        yes_count: 1,
        no_count: 4,
        partial_count: 1,
        response_count: 6,
      })
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(WEEKLY_FALSE_STREAK_OR_PROGRESS_NO_SEND);
  });

  it("8: strong week praise allowed when counts support it", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      weeklyGuardArgs("Solid momentum this week — a few clean wins on the bar.", {
        yes_count: 4,
        no_count: 1,
        partial_count: 0,
      })
    );
    expect(r.should_send).toBe(true);
  });

  it("9: near-duplicate blocked", async () => {
    nearDupMock.mockResolvedValueOnce({
      ...PASS_NEAR_DUP,
      shouldSend: false,
      noSendReason: RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
      body: "",
    });
    const r = await applyUnifiedSmsFinalProductLawGuard(weeklyGuardArgs("Same weekly recap."));
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(RAPID_NEAR_DUPLICATE_REPLY_NO_SEND);
    expect(truthGuardMock).not.toHaveBeenCalled();
  });

  it("10: internal labels blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      weeklyGuardArgs("Reply user_yes or user_no when ready.")
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(OUTBOUND_WEEKLY_INTERNAL_LABEL_NO_SEND);
  });

  it("11: false goal/commitment changed blocked", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      weeklyGuardArgs("Your commitment has been updated to the new bar.")
    );
    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBeTruthy();
  });

  it("12: no-send metadata includes visible_sent=false", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      weeklyGuardArgs("That's proof for your Victory Room.")
    );
    expect(r.should_send).toBe(false);
    expect(r.metadata.visible_sent).toBe(false);
  });

  it("13: weekly unsupported proof uses weekly-specific no_send_reason", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard(
      weeklyGuardArgs("You proved it this week.", { proof_moment_hints: [], yes_count: 0, silent_week: true, response_count: 0 })
    );
    expect(r.should_send).toBe(false);
    expect(
      [OUTBOUND_WEEKLY_UNSUPPORTED_PROOF_NO_SEND, WEEKLY_UNSUPPORTED_PROOF_OR_VICTORY_NO_SEND].includes(
        r.no_send_reason as string
      )
    ).toBe(true);
  });

  it("14: non-wired weekly route throws", async () => {
    await expect(
      applyUnifiedSmsFinalProductLawGuard({
        ...weeklyGuardArgs(),
        routePurpose: "weekly_legacy_reflection",
        outboundWeekly: {
          ...weeklyGuardArgs().outboundWeekly,
          routePurpose: "weekly_legacy_reflection",
        },
      })
    ).rejects.toThrow(/not activated/);
  });

  it("15: weekly route wires unified guard after FVG before compliance footer", () => {
    const src = fs.readFileSync(WEEKLY_ROUTE, "utf8");
    const v2Start = src.indexOf("if (v2Gate.fullyOnV2)");
    const legacyStart = src.indexOf("await generateWeeklySmsReflection");
    const v2 = src.slice(v2Start, legacyStart);
    const fvgIdx = v2.indexOf("applyFinalVoiceOwnershipGate");
    const guardIdx = v2.indexOf('mode: "outbound_weekly"');
    const footerIdx = v2.indexOf("appendPreservedSmsSuffix");
    const twilioIdx = v2.indexOf("await sendSMS(");
    expect(guardIdx).toBeGreaterThan(fvgIdx);
    expect(footerIdx).toBeGreaterThan(guardIdx);
    expect(twilioIdx).toBeGreaterThan(footerIdx);
    expect(v2).toContain("guardedWeeklyBody");
    expect(v2).toContain("skip_source: \"unified_final_guard_no_send\"");
    expect(v2).toContain("visible_sent: false");
    expect(v2).toContain("compliance_footer_appended_after_guard: true");
    expect(v2).not.toContain('mode: "outbound_daily"');
  });

  it("16: legacy weekly branches still skipped / not wired to unified guard", () => {
    const src = fs.readFileSync(WEEKLY_ROUTE, "utf8");
    const legacyStart = src.indexOf("await generateWeeklySmsReflection");
    const legacy = src.slice(legacyStart);
    expect(legacy).toContain("skipped_legacy_weekly_deprecated");
    expect(legacy).not.toContain("outbound_weekly");
    expect(isOutboundWeeklyWiredRoutePurpose("weekly_legacy_reflection")).toBe(false);
    expect(isOutboundWeeklyWiredRoutePurpose("weekly_proof_v2")).toBe(true);
  });

  it("17: daily route untouched by weekly wiring", () => {
    const daily = fs.readFileSync(DAILY_ROUTE, "utf8");
    expect(daily).toContain('mode: "outbound_daily"');
    expect(daily).not.toContain('mode: "outbound_weekly"');
  });

  it("18: inbound route untouched", () => {
    const inbound = fs.readFileSync(INBOUND_ROUTE, "utf8");
    expect(inbound).not.toContain("outbound_weekly");
    expect(inbound).not.toContain("weekly-outbound-final-guard-evidence");
  });

  it("19: no Twilio/send internals changed", () => {
    const twilio = fs.readFileSync(TWILIO_SEND, "utf8");
    expect(twilio).not.toContain("outbound_weekly");
    expect(twilio).not.toContain("weekly-outbound");
  });

  it("20: no hard-coded SMS in weekly guard modules", () => {
    const evidence = fs.readFileSync(
      path.join(process.cwd(), "src/lib/weekly-outbound-final-guard-evidence.ts"),
      "utf8"
    );
    const truth = fs.readFileSync(
      path.join(process.cwd(), "src/lib/weekly-outbound-proof-truth.ts"),
      "utf8"
    );
    expect(evidence).not.toMatch(/body:\s*"/);
    expect(truth).not.toMatch(/return\s*\{\s*body:/);
  });

  it("21: OCEG evidence allows completion only with yes_count >= 1", () => {
    const ctx = buildWeeklyOutboundUnifiedGuardCtx({
      routeKind: "weekly_proof_v2",
      clerkUserId: "u",
      commitmentId: "c",
      pack: packBase({ yes_count: 0, no_count: 0, partial_count: 0, response_count: 0, silent_week: true }),
    });
    const evidence = buildWeeklyOutboundOcegEvidence(ctx);
    const violation = detectUnsupportedAccountabilityClaimInOutbound(
      "Great to hear you completed your workout.",
      evidence
    );
    expect(violation?.kind).toBe("completion");
  });

  it("22: post-OCEG near-duplicate recheck runs when OCEG repairs body", async () => {
    nearDupMock
      .mockResolvedValueOnce({ ...PASS_NEAR_DUP, body: "Weekly recap." })
      .mockResolvedValueOnce({
        ...PASS_NEAR_DUP,
        shouldSend: false,
        noSendReason: RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
        body: "",
      });
    truthGuardMock.mockResolvedValueOnce({
      ...PASS_TRUTH,
      body: "You nailed it this week — great work getting it done.",
    });
    const r = await applyUnifiedSmsFinalProductLawGuard(
      weeklyGuardArgs("You nailed it this week — great work getting it done.")
    );
    expect(r.should_send).toBe(false);
    expect(r.checks_run).toContain("near_duplicate_post_oceg_recheck");
  });
});
