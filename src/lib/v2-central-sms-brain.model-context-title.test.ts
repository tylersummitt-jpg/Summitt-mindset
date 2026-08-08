import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import { buildCentralBrainUserPrompt } from "@/lib/v2-central-sms-brain";

describe("central SMS brain model-context title hygiene", () => {
  it("includes behavior and effective ask, never COMMITMENT_TITLE", () => {
    const prompt = buildCentralBrainUserPrompt({
      clerkUserId: "u1",
      commitmentId: "c1",
      commitment: {
        id: "c1",
        clerk_user_id: "u1",
        status: "active",
        title: "SaaS App",
        behavior_statement: "Lift weights for 30 minutes a day",
        success_criteria: null,
        accountability_phase: "active_accountability",
      } as never,
      effectiveAsk: "Lift weights for 30 minutes a day",
      inboundText: "done",
      routeContext: "normal",
      activeCommitmentPresent: true,
      blockerCapturePending: false,
      refreshSessionActive: false,
      smsPendingResolutionActive: false,
      contractOverlayProposalActive: false,
      memoryConfirmationPending: false,
      deterministicClassifierEventType: "user_yes",
      deterministicNormalizedHint: null,
      lastOutboundPromptPreview: null,
      recentSmsContextBlock: null,
      gatedSummary: null,
      shadowInterpretationRaw: null,
    });
    expect(prompt).toContain("BEHAVIOR_STATEMENT:");
    expect(prompt).toContain("EFFECTIVE_COACHING_ASK:");
    expect(prompt).toContain("Lift weights for 30 minutes a day");
    expect(prompt).not.toContain("COMMITMENT_TITLE");
    expect(prompt).not.toContain("SaaS App");
  });
});
