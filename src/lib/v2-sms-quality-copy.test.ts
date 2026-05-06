import { describe, expect, it } from "vitest";

import { buildConversationBrainPrompt } from "@/lib/v2-sms-conversation-brain";

import {
  internalCoachJargonFailReason,
  overlayDeclinedAckFailsQualityScan,
  userInboundAsksVictoryRoomProofLog,
  weakGenericMotivationalPhraseFailReason,
} from "@/lib/v2-sms-quality-copy";

describe("overlayDeclinedAckFailsQualityScan", () => {
  it("flags Shelly-style moralizing decline copy", () => {
    expect(
      overlayDeclinedAckFailsQualityScan(
        "I see you've chosen not to hold the same standard this week."
      )
    ).toBe("overlay_decline_judgment_tone");
  });

  it("allows neutral decline acknowledgment patterns", () => {
    expect(
      overlayDeclinedAckFailsQualityScan(
        "Got it—we won't lock in the 7-day version. Your commitment stays the same. What's one concrete move today?"
      )
    ).toBe(null);
  });
});

describe("userInboundAsksVictoryRoomProofLog", () => {
  it("detects Brooke-style victory log question", () => {
    expect(userInboundAsksVictoryRoomProofLog("Are you gonna put that in my victory log")).toBe(
      true
    );
    expect(userInboundAsksVictoryRoomProofLog("Does that count?")).toBe(true);
    expect(userInboundAsksVictoryRoomProofLog("Will you log that for me?")).toBe(true);
  });
});

describe("weakGenericMotivationalPhraseFailReason", () => {
  it("flags tired cheerlead lines", () => {
    expect(weakGenericMotivationalPhraseFailReason("Great job — keep pushing forward.")).toBe(
      "weak_generic_motivation"
    );
    expect(weakGenericMotivationalPhraseFailReason("You've got this.")).toBe("weak_generic_motivation");
  });
});

describe("internalCoachJargonFailReason", () => {
  it("flags internal spine jargon", () => {
    expect(internalCoachJargonFailReason("Your event spine updated.")).toBe("internal_jargon");
    expect(internalCoachJargonFailReason("Plain coach line today.")).toBe(null);
  });
});

describe("conversation brain prompt — answer-first guidance", () => {
  it("includes ANSWER-FIRST instruction for human questions", () => {
    const p = buildConversationBrainPrompt({
      commitmentTitle: "Leadership",
      behaviorStatement: "Show up for my teams daily.",
      effectiveCoachingAsk: "Show up for my teams daily.",
      latestUserSms: "Can you give me examples?",
      lastCoachSmsExact: null,
      recentSmsTranscriptBlock: null,
      eventsNewestFirst: [],
      coachingMemory: null,
      identityAnchorPreview: null,
      liveAccountabilityPromptStatus: null,
      blockerPendingSummary: null,
      deterministicClassifierEventType: "user_partial",
      deterministicClassifierNormalizedHint: null,
    });
    expect(p).toContain("ANSWER-FIRST");
  });
});
