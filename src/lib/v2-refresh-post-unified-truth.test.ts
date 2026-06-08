import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { evaluatePostUnifiedGuardRefreshTruthRecheck } from "@/lib/v2-refresh-post-unified-truth";

const BASE = {
  refreshIntent: "identity_still_commitment_prompt" as const,
  refreshFamily: "identity" as const,
  mutationFlags: {
    identityStill: true,
    sessionAdvanced: true,
  },
};

describe("evaluatePostUnifiedGuardRefreshTruthRecheck", () => {
  it("11: identity still body claims identity changed → blocked", () => {
    const r = evaluatePostUnifiedGuardRefreshTruthRecheck({
      ...BASE,
      body: "Got it — your identity has been updated. Back to normal checks.",
    });
    expect(r.blocked).toBe(true);
    expect(r.refreshTruthViolations).toContain("refresh_still_but_body_claims_identity_changed");
  });

  it("12: identity still body claims refresh fully complete when commitment step remains → blocked", () => {
    const r = evaluatePostUnifiedGuardRefreshTruthRecheck({
      ...BASE,
      body: "All set — refresh is complete. Back to normal checks.",
    });
    expect(r.blocked).toBe(true);
    expect(r.refreshTruthViolations).toContain("refresh_still_but_body_claims_refresh_fully_complete");
  });

  it("13: identity still body transitions to commitment check → allowed", () => {
    const r = evaluatePostUnifiedGuardRefreshTruthRecheck({
      ...BASE,
      body: "Good — that identity line still fits. Does today's bar still work for you?",
    });
    expect(r.blocked).toBe(false);
  });

  it("14: identity change body claims identity already updated → blocked", () => {
    const r = evaluatePostUnifiedGuardRefreshTruthRecheck({
      refreshIntent: "identity_change_handoff",
      refreshFamily: "identity",
      mutationFlags: { identityChangedHandoff: true, pendingCreated: true },
      body: "Your identity line has been updated in the system.",
    });
    expect(r.blocked).toBe(true);
    expect(r.refreshTruthViolations).toContain(
      "refresh_handoff_but_body_claims_identity_already_changed"
    );
  });

  it("15: identity change body says app update/handoff needed → allowed", () => {
    const r = evaluatePostUnifiedGuardRefreshTruthRecheck({
      refreshIntent: "identity_change_handoff",
      refreshFamily: "identity",
      mutationFlags: { identityChangedHandoff: true, pendingCreated: true },
      body: "Got it — update your identity line in the app when you can. I'll keep holding you to today's bar until you do.",
    });
    expect(r.blocked).toBe(false);
  });

  it("16: identity clarify body claims identity confirmed → blocked", () => {
    const r = evaluatePostUnifiedGuardRefreshTruthRecheck({
      refreshIntent: "identity_clarify_prompt",
      refreshFamily: "identity",
      mutationFlags: { identityClarify: true },
      body: "Your identity still fits — locked in.",
    });
    expect(r.blocked).toBe(true);
    expect(r.refreshTruthViolations).toContain("refresh_clarify_but_body_claims_identity_confirmed");
  });

  it("17: identity clarify body asks for clarification → allowed", () => {
    const r = evaluatePostUnifiedGuardRefreshTruthRecheck({
      refreshIntent: "identity_clarify_prompt",
      refreshFamily: "identity",
      mutationFlags: { identityClarify: true },
      body: "I may be reading that wrong — does that identity line still fit, or do you want to change it in the app?",
    });
    expect(r.blocked).toBe(false);
  });

  it("18: identity aborted body claims identity changed → blocked", () => {
    const r = evaluatePostUnifiedGuardRefreshTruthRecheck({
      refreshIntent: "identity_aborted_unclear",
      refreshFamily: "identity",
      mutationFlags: { identityAborted: true, refreshCleared: true },
      body: "Your identity has been changed.",
    });
    expect(r.blocked).toBe(true);
    expect(r.refreshTruthViolations).toContain("refresh_aborted_but_body_claims_identity_changed");
  });

  it("19: already_applied body claims fresh mutation → blocked", () => {
    const r = evaluatePostUnifiedGuardRefreshTruthRecheck({
      refreshIntent: "identity_already_applied",
      refreshFamily: "identity",
      mutationFlags: { alreadyApplied: true },
      body: "Just recorded your update from this reply.",
    });
    expect(r.blocked).toBe(true);
    expect(r.refreshTruthViolations).toContain(
      "refresh_already_applied_but_body_claims_fresh_mutation"
    );
  });

  it("20: fake proof / Victory / completed claim blocked", () => {
    const r = evaluatePostUnifiedGuardRefreshTruthRecheck({
      ...BASE,
      body: "Great job completing your goal today — saved to Victory Room.",
    });
    expect(r.blocked).toBe(true);
    expect(r.fakeProofFailed).toBe(true);
  });

  it("21: internal jargon blocked", () => {
    const r = evaluatePostUnifiedGuardRefreshTruthRecheck({
      ...BASE,
      body: "route_purpose says refresh_facts are active.",
    });
    expect(r.blocked).toBe(true);
    expect(r.forbiddenPhraseFailed).toBe(true);
  });
});
