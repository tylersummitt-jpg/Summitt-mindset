import { describe, expect, it } from "vitest";

import {
  buildWeeklyOutboundProofGuardFactsFromPack,
  inferHasProofOrKnownOutcomeForWeekly,
} from "@/lib/weekly-outbound-final-guard-evidence";
import {
  evaluatePostUnifiedGuardWeeklyProofTruthRecheck,
  WEEKLY_FALSE_STREAK_OR_PROGRESS_NO_SEND,
  WEEKLY_INTERNAL_LABEL_NO_SEND,
  WEEKLY_PROOF_TRUTH_VIOLATION_NO_SEND,
  WEEKLY_UNSUPPORTED_PROOF_OR_VICTORY_NO_SEND,
} from "@/lib/weekly-outbound-proof-truth";
import type { V2WeeklyProofPack } from "@/lib/v2-weekly-proof-sms";

function packBase(overrides?: Partial<V2WeeklyProofPack>): V2WeeklyProofPack {
  return {
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
  };
}

describe("evaluatePostUnifiedGuardWeeklyProofTruthRecheck", () => {
  it("allows honest weekly recap when counts support framing", () => {
    const wp = buildWeeklyOutboundProofGuardFactsFromPack(packBase());
    const r = evaluatePostUnifiedGuardWeeklyProofTruthRecheck({
      body: "You logged a few solid wins this week — want to keep the same bar?",
      weeklyProof: wp,
      hasProofOrKnownOutcome: inferHasProofOrKnownOutcomeForWeekly({
        proofMomentHints: wp.proofMomentHints,
        strongWeek: wp.strongWeek,
        completedCount: wp.completedCount,
      }),
    });
    expect(r.blocked).toBe(false);
  });

  it("blocks false every-day claim without counts", () => {
    const wp = buildWeeklyOutboundProofGuardFactsFromPack(
      packBase({ yes_count: 2, no_count: 2, check_sent_count: 5 })
    );
    const r = evaluatePostUnifiedGuardWeeklyProofTruthRecheck({
      body: "You completed every day this week — strong work.",
      weeklyProof: wp,
      hasProofOrKnownOutcome: false,
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe(WEEKLY_FALSE_STREAK_OR_PROGRESS_NO_SEND);
  });

  it("blocks unsupported proof/Victory claims", () => {
    const wp = buildWeeklyOutboundProofGuardFactsFromPack(
      packBase({ proof_moment_hints: [], yes_count: 0, response_count: 0, silent_week: true })
    );
    const r = evaluatePostUnifiedGuardWeeklyProofTruthRecheck({
      body: "That counts as proof for your Victory Room.",
      weeklyProof: wp,
      hasProofOrKnownOutcome: false,
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe(WEEKLY_UNSUPPORTED_PROOF_OR_VICTORY_NO_SEND);
  });

  it("blocks invented progress on silent/no-data week", () => {
    const wp = buildWeeklyOutboundProofGuardFactsFromPack(
      packBase({ silent_week: true, response_count: 0, yes_count: 0 })
    );
    const r = evaluatePostUnifiedGuardWeeklyProofTruthRecheck({
      body: "Great week — you showed up with real momentum.",
      weeklyProof: wp,
      hasProofOrKnownOutcome: false,
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe(WEEKLY_FALSE_STREAK_OR_PROGRESS_NO_SEND);
  });

  it("blocks rough week overpraised as perfect/strong", () => {
    const wp = buildWeeklyOutboundProofGuardFactsFromPack(
      packBase({ yes_count: 1, no_count: 4, partial_count: 1, response_count: 6 })
    );
    expect(wp.roughWeek).toBe(true);
    const r = evaluatePostUnifiedGuardWeeklyProofTruthRecheck({
      body: "Amazing week — you were crushing it.",
      weeklyProof: wp,
      hasProofOrKnownOutcome: false,
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe(WEEKLY_FALSE_STREAK_OR_PROGRESS_NO_SEND);
  });

  it("allows strong week praise when counts support it", () => {
    const wp = buildWeeklyOutboundProofGuardFactsFromPack(
      packBase({ yes_count: 4, no_count: 1, partial_count: 0 })
    );
    expect(wp.strongWeek).toBe(true);
    const r = evaluatePostUnifiedGuardWeeklyProofTruthRecheck({
      body: "Solid momentum this week — a few clean wins on the bar.",
      weeklyProof: wp,
      hasProofOrKnownOutcome: true,
    });
    expect(r.blocked).toBe(false);
  });

  it("blocks false goal/commitment changed claim", () => {
    const wp = buildWeeklyOutboundProofGuardFactsFromPack(packBase());
    const r = evaluatePostUnifiedGuardWeeklyProofTruthRecheck({
      body: "Your commitment has been updated to the new bar.",
      weeklyProof: wp,
      hasProofOrKnownOutcome: true,
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe(WEEKLY_PROOF_TRUTH_VIOLATION_NO_SEND);
  });

  it("blocks internal labels and weekly jargon", () => {
    const wp = buildWeeklyOutboundProofGuardFactsFromPack(packBase());
    const label = evaluatePostUnifiedGuardWeeklyProofTruthRecheck({
      body: "Reply user_yes when ready.",
      weeklyProof: wp,
      hasProofOrKnownOutcome: true,
    });
    expect(label.blocked).toBe(true);
    expect(label.noSendReason).toBe(WEEKLY_INTERNAL_LABEL_NO_SEND);

    const jargon = evaluatePostUnifiedGuardWeeklyProofTruthRecheck({
      body: "weekly_proof_v2 recap from proof_pack.",
      weeklyProof: wp,
      hasProofOrKnownOutcome: true,
    });
    expect(jargon.blocked).toBe(true);
    expect(jargon.noSendReason).toBe(WEEKLY_INTERNAL_LABEL_NO_SEND);
  });
});
