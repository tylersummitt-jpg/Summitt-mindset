import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

vi.mock("@/lib/victory-media/correlate-inbound-mms-c1", () => ({
  scheduleC1IfWinsDurable: vi.fn(),
}));

import { mergeInboundWinsForPersistence } from "@/lib/v2-win-accountability-merge";
import { buildSolInboundWinPlanInput } from "@/lib/inbound-sol-wins";
import type { InboundSolBriefExtras } from "@/lib/inbound-sol-coaching-brief";

const completed: InboundSolBriefExtras = {
  answer_priority: "normal",
  coaching_after_answer: "no",
  user_is_correcting_coach: false,
  accountability_interpretation: {
    relevance: "central",
    outcome: "completed",
    confidence: "high",
    evidence: "I completed my lift.",
  },
  meaningful_win: null,
};

describe("Sol inbound Win / Victory Room mapping", () => {
  it("simple goal completion: accountability win only, no ordinal 1", () => {
    const input = buildSolInboundWinPlanInput({
      inbound: completed,
      inboundText: "I completed my lift.",
    });
    expect(input.recognition?.has_win).toBe(false);
    const plan = mergeInboundWinsForPersistence({
      userYesConfirmed: true,
      recognition: input.recognition,
      effectiveAsk: "Lift 30 minutes",
      behaviorStatement: "Lift 30 minutes",
      equivalenceByOrdinal: input.equivalenceByOrdinal,
    });
    expect(plan.accountability).not.toBeNull();
    expect(plan.independent).toBeNull();
  });

  it("mixed meaningful_win is same as accountability — no ordinal 1", () => {
    const input = buildSolInboundWinPlanInput({
      inbound: {
        ...completed,
        meaningful_win: {
          present: true,
          grounded_action: "Completed the lift",
          relationship: "mixed",
        },
      },
      inboundText: "I completed my lift.",
    });
    const plan = mergeInboundWinsForPersistence({
      userYesConfirmed: true,
      recognition: input.recognition,
      effectiveAsk: "Lift 30 minutes",
      equivalenceByOrdinal: input.equivalenceByOrdinal,
    });
    expect(plan.independent).toBeNull();
  });

  it("unclear meaningful_win: no ordinal 1", () => {
    const input = buildSolInboundWinPlanInput({
      inbound: {
        ...completed,
        meaningful_win: {
          present: true,
          grounded_action: "something",
          relationship: "unclear",
        },
      },
      inboundText: "I completed my lift.",
    });
    const plan = mergeInboundWinsForPersistence({
      userYesConfirmed: true,
      recognition: input.recognition,
      effectiveAsk: "Lift 30 minutes",
      equivalenceByOrdinal: input.equivalenceByOrdinal,
    });
    expect(plan.independent).toBeNull();
  });

  it("goal completion + distinct life win → ordinal 1 whole_life", () => {
    const input = buildSolInboundWinPlanInput({
      inbound: {
        ...completed,
        meaningful_win: {
          present: true,
          grounded_action: "Helped my brother through a hard situation",
          relationship: "life",
        },
      },
      inboundText:
        "I completed my lift and helped my brother through a hard situation.",
    });
    expect(input.recognition?.has_win).toBe(true);
    expect(input.equivalenceByOrdinal?.[0]).toBe("distinct");
    const plan = mergeInboundWinsForPersistence({
      userYesConfirmed: true,
      recognition: input.recognition,
      effectiveAsk: "Lift 30 minutes",
      equivalenceByOrdinal: input.equivalenceByOrdinal,
    });
    expect(plan.accountability).not.toBeNull();
    expect(plan.independent).not.toBeNull();
    expect(plan.independent?.ordinal).toBe(1);
    expect(plan.independent?.relationship_type).toBe("whole_life");
  });
});

describe("persistSolInboundWins routing", () => {
  it("yes+life uses accountability merge only (no separate persistRecognizedWins in plan helper)", () => {
    const input = buildSolInboundWinPlanInput({
      inbound: {
        ...completed,
        meaningful_win: {
          present: true,
          grounded_action: "Helped my brother",
          relationship: "life",
        },
      },
      inboundText: "I completed my lift and helped my brother.",
    });
    expect(input.recognition?.has_win).toBe(true);
    expect(input.equivalenceByOrdinal?.[0]).toBe("distinct");
  });

  it("goal/mixed/unclear/null: no extra life Win plan", () => {
    for (const relationship of ["goal", "mixed", "unclear", null] as const) {
      const input = buildSolInboundWinPlanInput({
        inbound: {
          ...completed,
          meaningful_win: relationship
            ? { present: true, grounded_action: "x", relationship }
            : null,
        },
        inboundText: "I completed my lift.",
      });
      expect(input.recognition?.has_win).toBe(false);
    }
  });
});
