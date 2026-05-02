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

import { COMMITMENT_APPEND_FOR_SCORED } from "@/lib/v2-ai-inbound";
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

import {
  finalizePhase5aArcClarifyHumanSms,
  finalizePhase5aCentralTetherHumanSms,
  finalizePhase5aInboundStitchedFinalHumanSms,
  finalizePhase5aReactivationOutboundHumanSms,
  reactivationOutboundCuratedFallback,
} from "@/lib/v2-human-sms-brain/finalize-phase5a-human-sms";

describe("finalizePhase5A — gating and legacy paths", () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...env };
    delete process.env.V2_HUMAN_SMS_BRAIN_ENABLED;
    delete process.env.V2_HUMAN_SMS_PHASE5A_ENABLED;
    delete process.env.V2_HUMAN_SMS_PHASE5A_REACTIVATION_OUTBOUND;
    delete process.env.V2_HUMAN_SMS_PHASE5A_CENTRAL_TETHER;
    delete process.env.V2_HUMAN_SMS_PHASE5A_ARC_CLARIFY;
    delete process.env.V2_HUMAN_SMS_PHASE5A_INBOUND_STITCHED_FINAL;
    delete process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE;
    delete process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_SHADOW;
    rewriteMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("reactivation: all Phase5A flags off → machine draft unchanged, no Brain", async () => {
    const draft = "Reactivation machine draft about morning writing check-in.";
    const r = await finalizePhase5aReactivationOutboundHumanSms({
      machineDraft: draft,
      dailyPurpose: "low_pressure_reactivation",
      dailyReplySourcePre: "deterministic_human",
      effectiveAskPreview: "write",
      behaviorStatementPreview: "write daily",
      effectiveAskForFallback: "write daily",
      behaviorStatementForFallback: "write daily",
      maxChars: 320,
    });
    expect(rewriteMock).not.toHaveBeenCalled();
    expect(r.message).toBe(draft);
  });

  it("reactivation: master + slice + brain required for Brain; brain master alone does not run", async () => {
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    process.env.V2_HUMAN_SMS_PHASE5A_REACTIVATION_OUTBOUND = "true";
    const draft = "Reactivation still here.";
    const r = await finalizePhase5aReactivationOutboundHumanSms({
      machineDraft: draft,
      dailyPurpose: "low_pressure_reactivation",
      dailyReplySourcePre: "deterministic_human",
      effectiveAskPreview: "a",
      behaviorStatementPreview: "b",
      effectiveAskForFallback: "ask",
      behaviorStatementForFallback: "beh",
      maxChars: 320,
    });
    expect(rewriteMock).not.toHaveBeenCalled();
    expect(r.message).toBe(draft);

    process.env.V2_HUMAN_SMS_PHASE5A_ENABLED = "true";
    rewriteMock.mockResolvedValue({
      ok: true,
      message: "I'm still with you on your morning block—one honest step you could take today?",
      confidence: 0.9,
    });
    const r2 = await finalizePhase5aReactivationOutboundHumanSms({
      machineDraft: draft,
      dailyPurpose: "low_pressure_reactivation",
      dailyReplySourcePre: "deterministic_human",
      effectiveAskPreview: "a",
      behaviorStatementPreview: "b",
      effectiveAskForFallback: "ask",
      behaviorStatementForFallback: "beh",
    });
    expect(rewriteMock).toHaveBeenCalled();
    expect(r2.message).toBe(
      "I'm still with you on your morning block—one honest step you could take today?"
    );
  });

  it("central tether + ARC: Brain only rewrites (same brainCase surface), with slice flags on", async () => {
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    process.env.V2_HUMAN_SMS_PHASE5A_ENABLED = "true";
    process.env.V2_HUMAN_SMS_PHASE5A_CENTRAL_TETHER = "true";
    process.env.V2_HUMAN_SMS_PHASE5A_ARC_CLARIFY = "true";
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "false";
    rewriteMock
      .mockResolvedValueOnce({
        ok: true,
        message: "Pivoted tether copy—what happened on your bar today?",
        confidence: 0.85,
      })
      .mockResolvedValueOnce({
        ok: true,
        message: "Clarify copy—which thread are you answering, today’s check-in or something else?",
        confidence: 0.8,
      });

    const t = await finalizePhase5aCentralTetherHumanSms({
      machineDraft: "Pivoted tether draft.",
      tetherRoute: "normal_accountability",
      centralTurnPurpose: "accountability_tether",
    });
    const a = await finalizePhase5aArcClarifyHumanSms({
      machineDraft: "Clarify draft line.",
      tentativeOutcomeLabel: "outcome_tentative",
    });

    expect(rewriteMock.mock.calls[0]?.[0].brainCase).toBe("inbound_central_tether_pivot");
    expect(rewriteMock.mock.calls[1]?.[0].brainCase).toBe("inbound_active_reply_context_clarify");
    expect(t.message).toBe("Pivoted tether copy—what happened on your bar today?");
    expect(a.message).toBe("Clarify copy—which thread are you answering, today’s check-in or something else?");
  });
});

describe("finalizePhase5A — stitched final preservation + enforce", () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...env };
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    process.env.V2_HUMAN_SMS_PHASE5A_ENABLED = "true";
    process.env.V2_HUMAN_SMS_PHASE5A_INBOUND_STITCHED_FINAL = "true";
    process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE = "true";
    delete process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_SHADOW;
    rewriteMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("stitched final: drops preservation substrings → reverts to machine draft", async () => {
    const waveQ =
      "Quick confirm: should I save that you want to be seen as a calm leader with your team?";
    const draft = `Line one about today. ${waveQ}`;
    rewriteMock.mockResolvedValue({
      ok: true,
      message: "I heard you—sounds like you are aiming for a calmer presence.",
      confidence: 0.7,
    });

    const r = await finalizePhase5aInboundStitchedFinalHumanSms({
      machineDraft: draft,
      preservationSnippets: [waveQ],
      appendSegments: { wave11: true, victory: false, commitment_note: false },
      allowVictoryRoomPhrase: false,
    });

    expect(r.message).toBe(draft);
    expect(r.fallbackUsed).toBe("preservation_revert_to_machine_draft");
  });

  it("stitched final: invalid Brain (banned jargon) with enforce → FIX preserves meaning and validates", async () => {
    const mem = "Did you do the work? " + COMMITMENT_APPEND_FOR_SCORED;
    rewriteMock
      .mockResolvedValueOnce({
        ok: true,
        message: `${mem.trim()} Also: pending resolution contract proposal jargon.`,
        confidence: 0.5,
      })
      .mockResolvedValueOnce({
        ok: true,
        message: mem.trim(),
        confidence: 0.9,
      });
    const r = await finalizePhase5aInboundStitchedFinalHumanSms({
      machineDraft: mem,
      preservationSnippets: [COMMITMENT_APPEND_FOR_SCORED],
      appendSegments: { wave11: false, victory: false, commitment_note: true },
      allowVictoryRoomPhrase: false,
    });

    const v = validateHumanVisibleSms(r.message, {
      channel: "normal_inbound_stitched_final",
      maxChars: 320,
    });
    expect(rewriteMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(v.ok).toBe(true);
    expect(r.message.toLowerCase()).toContain("honest");
    expect(r.fallbackUsed).toBeNull();
  });
});

describe("Phase5A — curated fallbacks and hygiene", () => {
  it("reactivationOutboundCuratedFallback passes validate (reactivation_outbound)", () => {
    const fb = reactivationOutboundCuratedFallback("read for 20 minutes", "");
    const r = validateHumanVisibleSms(fb, { channel: "reactivation_outbound", maxChars: 320 });
    expect(r.ok).toBe(true);
  });

  it("reactivationOutboundCuratedFallback empty ask still passes validator", () => {
    const fb = reactivationOutboundCuratedFallback("", "");
    expect(validateHumanVisibleSms(fb, { channel: "reactivation_outbound", maxChars: 320 }).ok).toBe(
      true
    );
  });
});

describe("Phase5A — production validator warning", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  it("warns when Brain + Phase5A + slice and enforce is off", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env = { ...env };
    process.env.V2_HUMAN_SMS_BRAIN_ENABLED = "true";
    process.env.V2_HUMAN_SMS_PHASE5A_ENABLED = "true";
    process.env.V2_HUMAN_SMS_PHASE5A_REACTIVATION_OUTBOUND = "true";
    delete process.env.V2_HUMAN_VISIBLE_SMS_VALIDATOR_ENFORCE;

    rewriteMock.mockResolvedValue({ ok: true, message: "ok line about writing daily.", confidence: 0.8 });

    await finalizePhase5aReactivationOutboundHumanSms({
      machineDraft: "draft",
      dailyPurpose: "low_pressure_reactivation",
      dailyReplySourcePre: "d",
      effectiveAskPreview: "a",
      behaviorStatementPreview: "b",
      effectiveAskForFallback: "write",
      behaviorStatementForFallback: "write",
    });

    expect(warn).toHaveBeenCalled();
  });
});
