import { describe, expect, it } from "vitest";

import {
  buildAccountabilityWinIdempotencyKey,
  buildStructuralAccountabilityWinPresentation,
  mergeInboundWinsForPersistence,
} from "@/lib/v2-win-accountability-merge";
import {
  fallbackEquivalenceForRelationship,
  fallbackEquivalenceJudgmentsForCandidates,
} from "@/lib/openai-win-candidate-equivalence-v1";
import {
  WIN_RECOGNITION_VERSION,
  type WinCandidateV1,
  type WinRecognitionResultV1,
} from "@/lib/openai-win-recognition-v1";
import fs from "node:fs";
import path from "node:path";

function candidate(overrides: Partial<WinCandidateV1> = {}): WinCandidateV1 {
  return {
    ordinal: 0,
    grounded_action: "Lifted for 30 minutes",
    why_meaningful: "Protected the bar",
    suggested_title: "Lifted today",
    suggested_body: "You got the full thirty minutes in.",
    evidence_quote: "got my workout done",
    relationship_type: "goal",
    recognition_mode: "coach_recognized",
    user_expressed_pride: false,
    identity_related: false,
    sensitivity_caution: false,
    celebration_appropriate: true,
    model_confidence: 0.9,
    ...overrides,
  };
}

function recognition(wins: WinCandidateV1[]): WinRecognitionResultV1 {
  return {
    version: WIN_RECOGNITION_VERSION,
    has_win: wins.length > 0,
    wins,
  };
}

describe("v2-win-accountability-merge", () => {
  it("builds dedicated acc_yes idempotency key", () => {
    expect(buildAccountabilityWinIdempotencyKey("SMabc")).toBe("win_v1:acc_yes:SMabc");
  });

  it("CASE1 yes + duplicate completion → 1 Win (same goal)", () => {
    const plan = mergeInboundWinsForPersistence({
      userYesConfirmed: true,
      recognition: recognition([candidate()]),
      effectiveAsk: "Lift weights for 30 minutes",
      equivalenceByOrdinal: { 0: "same" },
    });
    expect(plan.accountability).not.toBeNull();
    expect(plan.accountability!.presentation_source).toBe("recognized_goal_candidate");
    expect(plan.accountability!.display_title).toBe("Lifted today");
    expect(plan.independent).toBeNull();
    expect(plan.suppressed_same_candidate_count).toBe(1);
  });

  it("user_yes without recognition → structural fallback from effective ask", () => {
    const plan = mergeInboundWinsForPersistence({
      userYesConfirmed: true,
      recognition: null,
      effectiveAsk: "Lift weights for 30 minutes a day",
    });
    expect(plan.accountability!.presentation_source).toBe("structural_fallback");
    expect(plan.accountability!.action_fact).toContain("Lift weights");
    expect(plan.independent).toBeNull();
  });

  it("CASE2 yes + promotion → accountability + whole_life ordinal 1", () => {
    const plan = mergeInboundWinsForPersistence({
      userYesConfirmed: true,
      recognition: recognition([
        candidate({ ordinal: 0, relationship_type: "goal" }),
        candidate({
          ordinal: 1,
          relationship_type: "whole_life",
          grounded_action: "Got promoted",
          suggested_title: "Promotion",
          suggested_body: "You earned the promotion.",
          evidence_quote: "got promoted",
          model_confidence: 0.95,
        }),
      ]),
      effectiveAsk: "Lift weights for 30 minutes a day",
      equivalenceByOrdinal: { 0: "same", 1: "distinct" },
    });
    expect(plan.accountability).not.toBeNull();
    expect(plan.suppressed_same_candidate_count).toBe(1);
    expect(plan.independent).not.toBeNull();
    expect(plan.independent!.ordinal).toBe(1);
    expect(plan.independent!.relationship_type).toBe("whole_life");
    expect(plan.independent!.suggested_title).toBe("Promotion");
  });

  it("CASE3 yes + first 300lb deadlift → 2 (acc + distinct goal)", () => {
    const plan = mergeInboundWinsForPersistence({
      userYesConfirmed: true,
      recognition: recognition([
        candidate({
          ordinal: 0,
          relationship_type: "goal",
          suggested_title: "Workout done",
          grounded_action: "Completed the workout",
        }),
        candidate({
          ordinal: 1,
          relationship_type: "goal",
          grounded_action: "Deadlifted 300 pounds for the first time",
          suggested_title: "First 300 deadlift",
          suggested_body: "You hit a first-time 300-pound deadlift.",
          evidence_quote: "deadlifted 300",
          model_confidence: 0.97,
        }),
      ]),
      effectiveAsk: "Lift weights for 30 minutes",
      equivalenceByOrdinal: { 0: "same", 1: "distinct" },
    });
    expect(plan.accountability!.display_title).toBe("Workout done");
    expect(plan.independent).not.toBeNull();
    expect(plan.independent!.ordinal).toBe(1);
    expect(plan.independent!.relationship_type).toBe("goal");
    expect(plan.independent!.suggested_title).toBe("First 300 deadlift");
    expect(plan.distinct_candidates_considered).toBe(1);
    expect(plan.suppressed_same_candidate_count).toBe(1);
  });

  it("CASE4 yes + two rephrased same goal candidates → 1 Win", () => {
    const plan = mergeInboundWinsForPersistence({
      userYesConfirmed: true,
      recognition: recognition([
        candidate({ ordinal: 0, model_confidence: 0.4, suggested_title: "Weak" }),
        candidate({ ordinal: 1, model_confidence: 0.95, suggested_title: "Strong lift" }),
      ]),
      effectiveAsk: "Lift weights for 30 minutes a day",
      equivalenceByOrdinal: { 0: "same", 1: "same" },
    });
    expect(plan.accountability!.display_title).toBe("Strong lift");
    expect(plan.suppressed_same_candidate_count).toBe(2);
    expect(plan.independent).toBeNull();
  });

  it("yes + distinct mixed candidate → 2", () => {
    const plan = mergeInboundWinsForPersistence({
      userYesConfirmed: true,
      recognition: recognition([
        candidate({ ordinal: 0, relationship_type: "goal", suggested_title: "Workout" }),
        candidate({
          ordinal: 1,
          relationship_type: "mixed",
          grounded_action: "Led the team through a hard set",
          suggested_title: "Led the room",
          suggested_body: "You led and lifted.",
          model_confidence: 0.9,
        }),
      ]),
      effectiveAsk: "Lift weights for 30 minutes",
      equivalenceByOrdinal: { 0: "same", 1: "distinct" },
    });
    expect(plan.independent!.relationship_type).toBe("mixed");
    expect(plan.independent!.ordinal).toBe(1);
  });

  it("yes + two distinct → keeps strongest one only (max 2 total)", () => {
    const plan = mergeInboundWinsForPersistence({
      userYesConfirmed: true,
      recognition: recognition([
        candidate({
          ordinal: 0,
          relationship_type: "identity",
          suggested_title: "Identity moment",
          model_confidence: 0.4,
        }),
        candidate({
          ordinal: 1,
          relationship_type: "whole_life",
          suggested_title: "Promotion",
          model_confidence: 0.9,
        }),
      ]),
      effectiveAsk: "Lift weights for 30 minutes a day",
      equivalenceByOrdinal: { 0: "distinct", 1: "distinct" },
    });
    expect(plan.accountability!.presentation_source).toBe("structural_fallback");
    expect(plan.independent!.suggested_title).toBe("Promotion");
    expect(plan.independent!.ordinal).toBe(1);
    expect(plan.distinct_candidates_considered).toBe(2);
  });

  it("equivalence failure fallback: goal→same, whole_life→distinct", () => {
    expect(fallbackEquivalenceForRelationship("goal")).toBe("same");
    expect(fallbackEquivalenceForRelationship("mixed")).toBe("same");
    expect(fallbackEquivalenceForRelationship("whole_life")).toBe("distinct");
    expect(fallbackEquivalenceForRelationship("identity")).toBe("distinct");

    const judgments = fallbackEquivalenceJudgmentsForCandidates([
      candidate({ ordinal: 0, relationship_type: "goal" }),
      candidate({ ordinal: 1, relationship_type: "whole_life" }),
    ]);
    expect(judgments.map((j) => j.equivalence)).toEqual(["same", "distinct"]);

    // Missing map uses the same fallback rules.
    const plan = mergeInboundWinsForPersistence({
      userYesConfirmed: true,
      recognition: recognition([
        candidate({ ordinal: 0, relationship_type: "goal", suggested_title: "Workout" }),
        candidate({
          ordinal: 1,
          relationship_type: "whole_life",
          suggested_title: "Promotion",
        }),
      ]),
      effectiveAsk: "Lift weights for 30 minutes",
    });
    expect(plan.accountability!.display_title).toBe("Workout");
    expect(plan.independent!.suggested_title).toBe("Promotion");
  });

  it("without user_yes → no accountability merge plan (recognition-only path)", () => {
    const plan = mergeInboundWinsForPersistence({
      userYesConfirmed: false,
      recognition: recognition([candidate()]),
    });
    expect(plan.accountability).toBeNull();
    expect(plan.independent).toBeNull();
  });

  it("structural fallback avoids canned Win-detected hype", () => {
    const p = buildStructuralAccountabilityWinPresentation({
      effectiveAsk: "Walk 10,000 steps",
    });
    expect(p.display_title).not.toMatch(/win detected|logged|victory recorded|goal completed!/i);
    expect(p.display_body).not.toMatch(/win detected|logged|victory recorded/i);
  });

  it("long Current Goal display_title cuts on a complete word; action_fact stays full", () => {
    const goal =
      "Swam with the children and shared in their excitement during the family experience";
    const p = buildStructuralAccountabilityWinPresentation({
      effectiveAsk: goal,
      behaviorStatement: goal,
    });
    expect(p.action_fact).toBe(goal);
    expect(p.display_body).toBe(goal);
    expect(p.supporting_quote).toBeNull();
    expect(p.display_title.length).toBeLessThanOrEqual(80);
    expect(p.display_title).toBe(
      "Swam with the children and shared in their excitement during the family"
    );
    expect(p.display_title).not.toContain("experien");
  });

  it("unbroken >80 Current Goal title uses stock fallback; action_fact still mid-caps at 240", () => {
    const goal = `x`.repeat(90);
    const p = buildStructuralAccountabilityWinPresentation({ effectiveAsk: goal });
    expect(p.action_fact).toBe(goal);
    expect(p.action_fact.length).toBeLessThanOrEqual(240);
    expect(p.display_title).toBe("Today's follow-through");
    expect(p.display_title).not.toBe(goal.slice(0, 80));
  });

  it("no regex/string-similarity semantic shortcut in merge or equivalence modules", () => {
    const mergeSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-win-accountability-merge.ts"),
      "utf8"
    );
    const eqSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/openai-win-candidate-equivalence-v1.ts"),
      "utf8"
    );
    expect(mergeSrc).not.toMatch(/token overlap|jaccard|levenshtein|string.?similarity/i);
    expect(eqSrc).not.toMatch(/token overlap|jaccard|levenshtein|string.?similarity/i);
    expect(mergeSrc).not.toMatch(/\/\\b(deadlift|promoted|workout)\\b\//);
  });
});
