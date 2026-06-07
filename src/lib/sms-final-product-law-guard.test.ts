import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SMS_FINAL_PRODUCT_LAW_GUARD_VERSION,
  UNIFIED_FINAL_BODY_AUTHORITY,
  applyUnifiedSmsFinalProductLawGuard,
  compactUnifiedFinalGuardForTelemetry,
} from "@/lib/sms-final-product-law-guard";
import { RAPID_NEAR_DUPLICATE_REPLY_NO_SEND } from "@/lib/inbound-near-duplicate-reply-policy";
import { emptyInboundTurnUnderstandingContext } from "@/lib/inbound-turn-understanding-context";

vi.mock("@/lib/inbound-final-body-truth-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inbound-final-body-truth-guard")>();
  return {
    ...actual,
    applyInboundCoachFinalBodyGuards: vi.fn(),
  };
});

import { applyInboundCoachFinalBodyGuards } from "@/lib/inbound-final-body-truth-guard";

const delegateMock = vi.mocked(applyInboundCoachFinalBodyGuards);

const BASE_DELEGATE_RESULT = {
  body: "Clean follow-up body.",
  shouldSend: true,
  noSendReason: null,
  tuGuard: {
    body: "Clean follow-up body.",
    shouldSend: true,
    noSendReason: null,
    metadata: { turn_understanding_final_body_guard_ran: true },
  },
  prematureAdjustmentGuard: {
    body: "Clean follow-up body.",
    shouldSend: true,
    noSendReason: null,
    metadata: { premature_adjustment_guard_ran: true },
  },
  truthGuard: {
    body: "Clean follow-up body.",
    shouldSend: true,
    noSendReason: null,
    metadata: { unsupported_accountability_claim_guard_ran: true },
  },
  nearDuplicateGuard: {
    body: "Clean follow-up body.",
    shouldSend: true,
    noSendReason: null,
    detection: {
      is_near_duplicate: false,
      reason: "not_duplicate" as const,
      within_recency_window: false,
      short_ack_inbound: false,
    },
    metadata: { rapid_near_duplicate_guard_ran: true },
  },
};

function normalCoachingArgs(body = "Candidate body.") {
  return {
    body,
    turnUnderstandingContext: emptyInboundTurnUnderstandingContext(),
    evidence: { rawInbound: "Good" },
    stage: "post_final_voice_gate",
  };
}

describe("applyUnifiedSmsFinalProductLawGuard", () => {
  beforeEach(() => {
    delegateMock.mockReset();
    delegateMock.mockResolvedValue(BASE_DELEGATE_RESULT);
  });

  it("A: normal_coaching_full delegates to applyInboundCoachFinalBodyGuards", async () => {
    const normalCoachingFull = normalCoachingArgs();
    await applyUnifiedSmsFinalProductLawGuard({
      mode: "normal_coaching_full",
      surface: "inbound",
      normalCoachingFull,
    });

    expect(delegateMock).toHaveBeenCalledTimes(1);
    expect(delegateMock).toHaveBeenCalledWith(normalCoachingFull);
  });

  it("B: passing body remains same when delegate reports no violations", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "normal_coaching_full",
      surface: "inbound",
      normalCoachingFull: normalCoachingArgs("Clean follow-up body."),
    });

    expect(r.should_send).toBe(true);
    expect(r.shouldSend).toBe(true);
    expect(r.body).toBe("Clean follow-up body.");
  });

  it("C: no-send result preserves no_send_reason from delegate", async () => {
    delegateMock.mockResolvedValueOnce({
      ...BASE_DELEGATE_RESULT,
      body: "",
      shouldSend: false,
      noSendReason: RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
      nearDuplicateGuard: {
        ...BASE_DELEGATE_RESULT.nearDuplicateGuard!,
        body: "",
        shouldSend: false,
        noSendReason: RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
        metadata: {
          rapid_near_duplicate_repair_attempted: true,
          rapid_near_duplicate_repair_succeeded: false,
        },
      },
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "normal_coaching_full",
      surface: "inbound",
      normalCoachingFull: normalCoachingArgs("Duplicate proposal?"),
    });

    expect(r.should_send).toBe(false);
    expect(r.no_send_reason).toBe(RAPID_NEAR_DUPLICATE_REPLY_NO_SEND);
    expect(r.noSendReason).toBe(RAPID_NEAR_DUPLICATE_REPLY_NO_SEND);
  });

  it("D: metadata contains guard_version / guard_mode / final_body_authority", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "normal_coaching_full",
      surface: "inbound",
      preGuardBodyPreview: "Before guard",
      normalCoachingFull: normalCoachingArgs("After guard"),
    });

    expect(r.guard_version).toBe(SMS_FINAL_PRODUCT_LAW_GUARD_VERSION);
    expect(r.guard_mode).toBe("normal_coaching_full");
    expect(r.final_body_authority).toBe(UNIFIED_FINAL_BODY_AUTHORITY);
    expect(r.metadata.unified_final_guard_version).toBe(SMS_FINAL_PRODUCT_LAW_GUARD_VERSION);
    expect(r.metadata.final_body_authority).toBe(UNIFIED_FINAL_BODY_AUTHORITY);
    expect(r.metadata.pre_unified_guard_body_preview).toBe("Before guard");
    expect(compactUnifiedFinalGuardForTelemetry(r).unified_final_guard_mode).toBe(
      "normal_coaching_full"
    );
  });

  it("E: does not bypass delegate — repair/no-send ordering owned by delegate", async () => {
    delegateMock.mockResolvedValueOnce({
      ...BASE_DELEGATE_RESULT,
      tuGuard: {
        ...BASE_DELEGATE_RESULT.tuGuard,
        metadata: {
          turn_understanding_stale_ask_repair_attempted: true,
          turn_understanding_stale_ask_repair_succeeded: true,
        },
      },
    });

    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "normal_coaching_full",
      surface: "inbound",
      normalCoachingFull: normalCoachingArgs(),
    });

    expect(delegateMock).toHaveBeenCalledTimes(1);
    expect(r.repair_attempts).toBe(1);
    expect(r.checks_run).toContain("turn_understanding_stale_ask");
    expect(r.guard_results.inbound_coach_final_body_guards).toBeDefined();
  });

  it("F: hard_route_bypass pass-through only and does not call delegate", async () => {
    const r = await applyUnifiedSmsFinalProductLawGuard({
      mode: "hard_route_bypass",
      surface: "inbound",
      candidateBody: "STOP acknowledged.",
    });

    expect(delegateMock).not.toHaveBeenCalled();
    expect(r.should_send).toBe(true);
    expect(r.body).toBe("STOP acknowledged.");
    expect(r.checks_run).toEqual([]);
    expect(r.checks_skipped.every((s) => s.reason === "hard_route_bypass")).toBe(true);
  });

  it("throws for modes not activated in PR 2.1a", async () => {
    await expect(
      applyUnifiedSmsFinalProductLawGuard({
        mode: "transactional_coaching_limited",
        surface: "inbound",
        candidateBody: "test",
      })
    ).rejects.toThrow(/not activated in PR 2.1a/);
  });
});
