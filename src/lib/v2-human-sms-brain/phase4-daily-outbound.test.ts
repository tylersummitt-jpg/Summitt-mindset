import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
    })),
  },
}));

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  buildCheckSentAiPayload,
  resolveV2DailyOutboundSmsBody,
  type V2AiOutboundContext,
} from "@/lib/v2-ai-outbound";
import { getShortCommitmentPhraseForSms } from "@/lib/v2-sms-accountability";
import { dailyOutboundCuratedFallback } from "@/lib/v2-human-sms-brain/finalize-daily-outbound-human-sms";
import { validateHumanVisibleSms } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";

const rewriteMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/v2-human-sms-brain/human-sms-brain", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/v2-human-sms-brain/human-sms-brain")>();
  return {
    ...actual,
    rewriteMachineDraftToHumanSms: rewriteMock,
  };
});

function minimalCommitment(): ActiveV2CommitmentRow {
  return {
    id: "c_test",
    clerk_user_id: "user_test",
    status: "active",
    behavior_statement: "Write for 30 minutes each morning",
    title: "Morning writing",
    success_criteria: null,
    blocker_capture_expires_at: null,
    blocker_capture_after_event: null,
    adaptive_ask_text: null,
    adaptive_ask_active_from: null,
    adaptive_ask_expires_at: null,
    adaptive_proposal_text: null,
    adaptive_proposal_created_at: null,
    adaptive_proposal_expires_at: null,
    accountability_phase: "active_accountability",
    reactivation_entered_at: null,
    reactivation_last_sent_at: null,
    reactivation_entry_reason_code: null,
    refresh_session: null,
    commitment_refresh_last_prompted_at: null,
    pending_resolution_kind: null,
    pending_resolution_created_at: null,
    pending_resolution_expires_at: null,
    pending_resolution_payload: null,
    updated_at: null,
    started_at: "2026-01-01T12:00:00.000Z",
  };
}

function minimalCtx(overrides?: Partial<V2AiOutboundContext>): V2AiOutboundContext {
  const commitment = minimalCommitment();
  return {
    commitment,
    eventsNewestFirst: [],
    blockerPreview: null,
    serverState: "stable",
    serverStrategy: "standard_check",
    templateFamily: "standard",
    silence: { tier: "none", unanswered_checks: 0, days_since_last_user_outcome: 0 },
    reentry: { active: false },
    nextMove: { type: "hold_standard", reason_code: "hold_default", version: 1 },
    cadence: { level: "daily", reason_code: "test", version: 1 },
    effectiveCoachingAsk: commitment.behavior_statement,
    coachingMemory: null,
    preferredName: null,
    lifeDesires: null,
    identityReferenceAllowed: false,
    dailyMessagePurpose: "standard_accountability_check",
    recentSmsContextBlock: null,
    ...overrides,
  };
}

describe("Phase 4A — resolveV2DailyOutboundSmsBody polish", () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...env };
    delete process.env.V2_AI_OUTBOUND_ENABLED;
    delete process.env.V2_HUMAN_SMS_PHASE4_DAILY_OUTBOUND;
    delete process.env.V2_HUMAN_SMS_BRAIN_ENABLED;
    delete process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE;
    delete process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_SHADOW;
    delete process.env.V2_HUMAN_SMS_PHASE5A_ENABLED;
    delete process.env.V2_HUMAN_SMS_PHASE5A_REACTIVATION_OUTBOUND;
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("flags off (phase4 unset): same smsBody as phase4 on without brain master", async () => {
    const ctx = minimalCtx();
    const args = {
      ctx,
      contractProposalMode: false,
      purpose: "standard_accountability_check" as const,
      templateBody: "tmpl",
      effectiveAsk: ctx.commitment.behavior_statement,
      behaviorStatement: ctx.commitment.behavior_statement,
      nextMoveType: "hold_standard" as const,
      shrunkAskText: null as string | null,
    };

    const legacy = await resolveV2DailyOutboundSmsBody(args);

    process.env.V2_HUMAN_SMS_PHASE4_DAILY_OUTBOUND = "true";
    const noBrainMaster = await resolveV2DailyOutboundSmsBody(args);

    expect(rewriteMock).not.toHaveBeenCalled();
    expect(noBrainMaster.smsBody).toBe(legacy.smsBody);
  });

  it("phase4 + brain on: invokes Brain rewrite for standard daily outbound", async () => {
    process.env.V2_HUMAN_SMS_PHASE4_DAILY_OUTBOUND = "true";
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "false";

    rewriteMock.mockResolvedValue({
      ok: true,
      message: "Quick pulse — did you get your 30 minutes of writing in today?",
      confidence: 0.88,
    });

    const ctx = minimalCtx();
    const r = await resolveV2DailyOutboundSmsBody({
      ctx,
      contractProposalMode: false,
      purpose: "standard_accountability_check",
      templateBody: "tmpl",
      effectiveAsk: ctx.commitment.behavior_statement,
      behaviorStatement: ctx.commitment.behavior_statement,
      nextMoveType: "hold_standard",
      shrunkAskText: null,
    });

    expect(rewriteMock).toHaveBeenCalled();
    expect(r.smsBody).toBe("Quick pulse — did you get your 30 minutes of writing in today?");
  });

  it("contract proposal mode: Phase 4 polish skipped (no Brain call)", async () => {
    process.env.V2_HUMAN_SMS_PHASE4_DAILY_OUTBOUND = "true";
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";

    const binding = "Proposal binding line for shrink — reply YES or NO.";
    const ctx = minimalCtx({
      contractProposalMode: true,
      contractProposalKind: "shrink_ask",
      contractProposalBindingText: binding,
      serverStrategy: "standard_check",
    });

    const r = await resolveV2DailyOutboundSmsBody({
      ctx,
      contractProposalMode: true,
      purpose: "contract_overlay_proposal",
      templateBody: binding,
      effectiveAsk: ctx.commitment.behavior_statement,
      behaviorStatement: ctx.commitment.behavior_statement,
      nextMoveType: "shrink_ask",
      shrunkAskText: "smaller step text",
    });

    expect(rewriteMock).not.toHaveBeenCalled();
    expect(r.smsBody).toBe(binding);
  });

  it("buildCheckSentAiPayload.message matches final polished smsBody", async () => {
    process.env.V2_HUMAN_SMS_PHASE4_DAILY_OUTBOUND = "true";
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "false";

    const polished = "Aligned copy — did you write today?";
    rewriteMock.mockResolvedValue({ ok: true, message: polished, confidence: 0.9 });

    const ctx = minimalCtx();
    const r = await resolveV2DailyOutboundSmsBody({
      ctx,
      contractProposalMode: false,
      purpose: "standard_accountability_check",
      templateBody: "tmpl",
      effectiveAsk: ctx.commitment.behavior_statement,
      behaviorStatement: ctx.commitment.behavior_statement,
      nextMoveType: "hold_standard",
      shrunkAskText: null,
    });

    const payload = buildCheckSentAiPayload({
      model: "gpt-4o-mini",
      promptVersion: "v_test",
      serverState: "stable",
      serverStrategy: "standard_check",
      message: r.smsBody,
      confidence: null,
      fallbackUsed: true,
      dailyResolution: r.resolution,
    });

    expect(payload.message).toBe(r.smsBody);
    expect(payload.message).toBe(polished);
  });

  it("Brain failure: keeps machine draft when it passes validator", async () => {
    process.env.V2_HUMAN_SMS_PHASE4_DAILY_OUTBOUND = "true";
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "true";

    rewriteMock.mockResolvedValue({ ok: false, reason: "no_openai_client" });

    const ctx = minimalCtx();
    const r = await resolveV2DailyOutboundSmsBody({
      ctx,
      contractProposalMode: false,
      purpose: "standard_accountability_check",
      templateBody: "tmpl",
      effectiveAsk: ctx.commitment.behavior_statement,
      behaviorStatement: ctx.commitment.behavior_statement,
      nextMoveType: "hold_standard",
      shrunkAskText: null,
    });

    expect(r.smsBody.length).toBeGreaterThan(0);
    const v = validateHumanVisibleSms(r.smsBody, { channel: "daily_outbound", maxChars: 300 });
    expect(v.ok).toBe(true);
  });

  it("enforce: banned Brain output then failed FIX → curated fallback passes validator and references ask", async () => {
    process.env.V2_HUMAN_SMS_PHASE4_DAILY_OUTBOUND = "true";
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "true";

    rewriteMock
      .mockResolvedValueOnce({
        ok: true,
        message: "We should discuss pending resolution next.",
        confidence: 0.5,
      })
      .mockResolvedValueOnce({
        ok: true,
        message: "Still blocked on pending resolution wording.",
        confidence: 0.5,
      });

    const ctx = minimalCtx();
    const ask = "Write for 30 minutes each morning";
    const r = await resolveV2DailyOutboundSmsBody({
      ctx,
      contractProposalMode: false,
      purpose: "standard_accountability_check",
      templateBody: "tmpl",
      effectiveAsk: ask,
      behaviorStatement: ctx.commitment.behavior_statement,
      nextMoveType: "hold_standard",
      shrunkAskText: null,
    });

    const v = validateHumanVisibleSms(r.smsBody, { channel: "daily_outbound", maxChars: 300 });
    expect(v.ok).toBe(true);
    expect(r.smsBody.toLowerCase()).toContain("write");
    expect(r.smsBody.toLowerCase()).not.toContain("pending resolution");
  });

  it("reactivation_nudge strategy skips Phase 4 polish", async () => {
    process.env.V2_HUMAN_SMS_PHASE4_DAILY_OUTBOUND = "true";
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";

    rewriteMock.mockResolvedValue({
      ok: true,
      message: "Should not apply",
      confidence: 0.9,
    });

    const ctx = minimalCtx({ serverStrategy: "reactivation_nudge", templateFamily: "reactivation" });
    const r = await resolveV2DailyOutboundSmsBody({
      ctx,
      contractProposalMode: false,
      purpose: "low_pressure_reactivation",
      templateBody: "tmpl",
      effectiveAsk: ctx.commitment.behavior_statement,
      behaviorStatement: ctx.commitment.behavior_statement,
      nextMoveType: "hold_standard",
      shrunkAskText: null,
    });

    expect(rewriteMock).not.toHaveBeenCalled();
    expect(r.smsBody).not.toBe("Should not apply");
  });
});

describe("Phase 5A — reactivation outbound polish", () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...env };
    delete process.env.V2_AI_OUTBOUND_ENABLED;
    delete process.env.V2_HUMAN_SMS_PHASE4_DAILY_OUTBOUND;
    delete process.env.V2_HUMAN_SMS_PHASE5A_ENABLED;
    delete process.env.V2_HUMAN_SMS_PHASE5A_REACTIVATION_OUTBOUND;
    delete process.env.V2_HUMAN_SMS_BRAIN_ENABLED;
    delete process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE;
    delete process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_SHADOW;
    rewriteMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("Phase5A flags off: byte-identical smsBody vs Phase5A master on without slice/brain", async () => {
    const ctx = minimalCtx({ serverStrategy: "reactivation_nudge", templateFamily: "reactivation" });
    const args = {
      ctx,
      contractProposalMode: false,
      purpose: "low_pressure_reactivation" as const,
      templateBody: "tmpl",
      effectiveAsk: ctx.commitment.behavior_statement,
      behaviorStatement: ctx.commitment.behavior_statement,
      nextMoveType: "hold_standard" as const,
      shrunkAskText: null as string | null,
    };

    const legacy = await resolveV2DailyOutboundSmsBody(args);

    process.env.V2_HUMAN_SMS_PHASE5A_ENABLED = "true";
    const partial = await resolveV2DailyOutboundSmsBody(args);

    expect(rewriteMock).not.toHaveBeenCalled();
    expect(partial.smsBody).toBe(legacy.smsBody);
    expect(partial.resolution).toEqual(legacy.resolution);
  });

  it("reactivation Brain runs only with brain master + Phase5A master + reactivation slice", async () => {
    const ctx = minimalCtx({ serverStrategy: "reactivation_nudge", templateFamily: "reactivation" });
    const args = {
      ctx,
      contractProposalMode: false,
      purpose: "low_pressure_reactivation" as const,
      templateBody: "tmpl",
      effectiveAsk: ctx.commitment.behavior_statement,
      behaviorStatement: ctx.commitment.behavior_statement,
      nextMoveType: "hold_standard" as const,
      shrunkAskText: null as string | null,
    };

    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    process.env.V2_HUMAN_SMS_PHASE5A_ENABLED = "true";
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "false";

    await resolveV2DailyOutboundSmsBody(args);
    expect(rewriteMock).not.toHaveBeenCalled();

    process.env.V2_HUMAN_SMS_PHASE5A_REACTIVATION_OUTBOUND = "true";
    rewriteMock.mockResolvedValue({
      ok: true,
      message:
        "Still tracking your morning writing bar—when you're ready, what's one small step you'll take today?",
      confidence: 0.88,
    });

    await resolveV2DailyOutboundSmsBody(args);
    expect(rewriteMock).toHaveBeenCalledTimes(1);
    expect(rewriteMock.mock.calls[0]?.[0].brainCase).toBe("daily_outbound_reactivation_nudge");
  });

  it("reactivation: short_commitment_phrase_used matches final smsBody (post polish)", async () => {
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    process.env.V2_HUMAN_SMS_PHASE5A_ENABLED = "true";
    process.env.V2_HUMAN_SMS_PHASE5A_REACTIVATION_OUTBOUND = "true";
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "false";

    const ctx = minimalCtx({ serverStrategy: "reactivation_nudge", templateFamily: "reactivation" });
    const polished =
      "Hey—still here on Write for 30 minutes each morning. One honest move you could make today?";
    rewriteMock.mockResolvedValue({ ok: true, message: polished, confidence: 0.9 });

    const r = await resolveV2DailyOutboundSmsBody({
      ctx,
      contractProposalMode: false,
      purpose: "low_pressure_reactivation",
      templateBody: "tmpl",
      effectiveAsk: ctx.commitment.behavior_statement,
      behaviorStatement: ctx.commitment.behavior_statement,
      nextMoveType: "hold_standard",
      shrunkAskText: null,
    });

    const shortPhrase = getShortCommitmentPhraseForSms({
      effectiveAsk: ctx.commitment.behavior_statement,
      behaviorStatement: ctx.commitment.behavior_statement,
    });
    const expected =
      shortPhrase !== "the bar" && r.smsBody.toLowerCase().includes(shortPhrase.toLowerCase());
    expect(r.smsBody).toBe(polished);
    expect(r.resolution.short_commitment_phrase_used).toBe(expected);
  });
});

describe("Phase 4A — curated fallback + daily_outbound validator", () => {
  it("dailyOutboundCuratedFallback passes validateHumanVisibleSms (daily_outbound)", () => {
    const fb = dailyOutboundCuratedFallback("go for a short walk", "");
    const r = validateHumanVisibleSms(fb, { channel: "daily_outbound", maxChars: 320 });
    expect(r.ok).toBe(true);
    expect(fb.toLowerCase()).toContain("walk");
  });

  it("dailyOutboundCuratedFallback without usable ask uses safe generic line", () => {
    const fb = dailyOutboundCuratedFallback("", "");
    expect(fb).toBe("Today's check-in: did you follow through?");
    expect(
      validateHumanVisibleSms(fb, { channel: "daily_outbound", maxChars: 320 }).ok
    ).toBe(true);
  });
});
