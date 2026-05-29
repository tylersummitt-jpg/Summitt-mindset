import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

vi.mock("@/lib/v3-sms-voice-ownership", () => ({
  applyFinalVoiceOwnershipGate: vi.fn(),
}));

import {
  applyFinalVoiceOwnershipGate,
  type VoiceOwnershipResult,
} from "@/lib/v3-sms-voice-ownership";
import { buildV2ContractOverlayYesAckSms } from "@/lib/v2-sms-accountability";
import {
  buildContractConsentAckIntent,
  finalizeContractConsentAckWithHumanVoice,
  validateContractConsentAckForbiddenLanguage,
  validateContractConsentAckHumanBody,
  validateContractConsentAckRequiredMeaning,
} from "@/lib/v2-contract-consent-ack-send";

const applyFvgMock = vi.mocked(applyFinalVoiceOwnershipGate);

function baseIntent(overrides: Partial<ReturnType<typeof buildContractConsentAckIntent>> = {}) {
  return buildContractConsentAckIntent({
    consentParse: "user_yes",
    messageSid: "SM_intent_001",
    proposalText: "This is the standard for the next 7 days: workout daily.",
    contractKind: "recommit_same",
    behaviorStatement: "Workout daily",
    effectiveAsk: "Workout daily",
    contractConsentFacts: {
      overlay_action: "activated",
      rpc_result: "applied",
      proposal_text_digest: "This is the standard...",
      required_meaning_summary: "Acknowledge acceptance for the next 7 days.",
    },
    ...overrides,
  });
}

describe("buildContractConsentAckIntent", () => {
  it("stores legacy template as meaning anchor only, not as send target", () => {
    const intent = baseIntent();
    expect(intent.legacy_meaning_anchor_preview).toBeTruthy();
    expect(intent.legacy_meaning_anchor_preview).toContain("week");
  });
});

describe("validateContractConsentAckHumanBody", () => {
  it("rejects verbatim legacy template paste as final body", () => {
    const intent = baseIntent();
    const r = validateContractConsentAckHumanBody({
      body: intent.legacy_meaning_anchor_preview!,
      intent,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("verbatim_legacy_template_paste");
  });

  it("rejects menu/robot forbidden language", () => {
    const intent = baseIntent();
    const r = validateContractConsentAckForbiddenLanguage("Reply YES to confirm your overlay.");
    expect(r.ok).toBe(false);
    void intent;
  });

  it("accepts human generated yes ack with week/acceptance meaning", () => {
    const intent = baseIntent();
    const r = validateContractConsentAckHumanBody({
      body: "Good — we'll hold that standard for the next week. Show me the rep.",
      intent,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects yes ack missing acceptance/week meaning", () => {
    const intent = baseIntent();
    const r = validateContractConsentAckRequiredMeaning({
      body: "Thanks for texting.",
      intent,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("yes_ack_missing_week_or_acceptance");
  });
});

describe("finalizeContractConsentAckWithHumanVoice", () => {
  beforeEach(() => {
    applyFvgMock.mockReset();
  });

  it("uses OpenAI-generated body, not hard-coded template, as final ack", async () => {
    const intent = baseIntent();
    const templateBody = buildV2ContractOverlayYesAckSms({
      messageSid: "SM_intent_001",
      adoptedAskText: "This is the standard for the next 7 days: workout daily.",
      contractKind: "recommit_same",
    }).body;

    const generatedHuman =
      "Good — we'll hold that as the standard for the next week. I'm with you on the rep.";

    const acceptedVoice: VoiceOwnershipResult = {
      shouldSend: true,
      body: generatedHuman,
      voiceOwner: "v3_machine_refine",
      source: "test",
      v3Owned: true,
      repaired: false,
      emergencyFallbackUsed: false,
      blockedReasons: [],
      metadata: { voice_decision: "accepted" },
    };
    applyFvgMock.mockResolvedValue(acceptedVoice);

    const r = await finalizeContractConsentAckWithHumanVoice({
      intent,
      generateBody: async () => generatedHuman,
      voiceArgs: {
        commitmentId: "c1",
        effectiveAsk: "Workout daily",
        behaviorStatement: "Workout daily",
        latestInboundRaw: "Yes",
        latestOutboundBody: null,
        latestOpenQuestion: null,
        contextPacket: null,
        todayCompleted: false,
        finalEventType: "user_yes",
      },
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body).toBe(generatedHuman);
      expect(r.body).not.toBe(templateBody);
      expect(applyFvgMock).toHaveBeenCalledTimes(1);
    }
  });

  it("fails closed when OpenAI returns empty — no template fallback body", async () => {
    const intent = baseIntent();
    const r = await finalizeContractConsentAckWithHumanVoice({
      intent,
      generateBody: async () => null,
      voiceArgs: {
        commitmentId: "c1",
        effectiveAsk: "Workout daily",
        behaviorStatement: "Workout daily",
        latestInboundRaw: "Yes",
        latestOutboundBody: null,
        latestOpenQuestion: null,
        contextPacket: null,
        todayCompleted: false,
        finalEventType: "user_yes",
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("openai_unavailable_or_empty");
  });

  it("fails closed when FVG suppresses generated ack", async () => {
    const intent = baseIntent();
    const suppressedVoice: VoiceOwnershipResult = {
      shouldSend: false,
      body: "",
      skipReason: "final_voice_blocked",
      voiceOwner: "v3_machine_refine",
      source: "test",
      v3Owned: true,
      repaired: false,
      emergencyFallbackUsed: false,
      blockedReasons: ["forbidden_substring"],
      metadata: {},
    };
    applyFvgMock.mockResolvedValue(suppressedVoice);

    const r = await finalizeContractConsentAckWithHumanVoice({
      intent,
      generateBody: async () =>
        "Good — we'll hold that standard for the next week. Show me the rep.",
      voiceArgs: {
        commitmentId: "c1",
        effectiveAsk: "Workout daily",
        behaviorStatement: "Workout daily",
        latestInboundRaw: "Yes",
        latestOutboundBody: null,
        latestOpenQuestion: null,
        contextPacket: null,
        todayCompleted: false,
        finalEventType: "user_yes",
      },
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("final_voice_gate_no_send");
  });
});
