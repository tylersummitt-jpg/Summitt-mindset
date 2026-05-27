import { describe, expect, it } from "vitest";

import {
  buildDailyOpenQuestionAnswerPriorityGuidance,
  buildPendingPlanProofLaneGuardrails,
  type PendingPlanProofFact,
} from "@/lib/pending-plan-proof";
import { MEMORY_PRIORITY_RULES } from "@/lib/sms-relationship-memory-packet";
import {
  buildTimingAnchorMemoryLaneGuardrails,
  deriveTimingAnchorMemory,
  inactiveTimingAnchorMemory,
} from "@/lib/timing-anchor-memory";

const BROOKE_PENDING: PendingPlanProofFact = {
  active: true,
  plan_summary_hint: "two hours after Brooke's workout",
  anchor_phrase_hint: "after Brooke's workout",
  anchor_key: "brooke|workout",
  plan_for_day_key: "2026-05-11",
  source_answer_preview:
    "I'll do it after Brooke gets back from her workout.",
  recurrence_confidence: "unknown",
  outcome_known: false,
};

describe("MEMORY_PRIORITY_RULES", () => {
  it("does not blindly say answered open question means move forward", () => {
    const rule = MEMORY_PRIORITY_RULES.find((r) => r.includes("open_question_pending"));
    expect(rule).toBeDefined();
    expect(rule).toMatch(/pending plan proof|plan-only|close the prior plan/i);
    expect(rule).not.toMatch(/^If projection open_question_pending is false and open_question_answer_text exists, move forward from that answer\.$/);
  });
});

describe("buildDailyOpenQuestionAnswerPriorityGuidance", () => {
  it("prioritizes closing pending plan loop over moving forward from answer", () => {
    const g = buildDailyOpenQuestionAnswerPriorityGuidance();
    expect(g).toMatch(/pending_plan_proof\.active is true/i);
    expect(g).toMatch(/plan\/intention, not proof/i);
    expect(g).toMatch(/close that loop/i);
    expect(g).not.toMatch(
      /If thread_memory\.open_question_pending is false and latest_answer_after_open_question is set, move forward from that answer — do not ask that open question again\./
    );
    expect(g).toMatch(/Stated plan is not completion/i);
  });
});

describe("Brooke-style pending plan + mentioned_once anchor", () => {
  const timing = deriveTimingAnchorMemory({
    latestAnswerAfterOpenQuestion:
      "I'll do it after Brooke gets back from her workout.",
    pendingPlanProof: BROOKE_PENDING,
  });

  it("timing anchor is mentioned_once", () => {
    expect(timing.confidence_level).toBe("mentioned_once");
  });

  it("prompt guidance closes loop and forbids recurring schedule assumptions", () => {
    const guidance = [
      buildDailyOpenQuestionAnswerPriorityGuidance(),
      buildPendingPlanProofLaneGuardrails(BROOKE_PENDING),
      buildTimingAnchorMemoryLaneGuardrails(timing),
    ].join("\n");

    expect(guidance).toMatch(/close (the|that) loop/i);
    expect(guidance).toMatch(/dated or tentative window/i);
    expect(guidance).toMatch(/mentioned_once/i);
    expect(guidance).toMatch(/Do NOT imply recurrence/i);
    expect(guidance).toMatch(/usual window/i);
    expect(guidance).not.toMatch(/move forward from that answer — do not ask that open question again/);
    expect(guidance).toMatch(/Do NOT praise focus/i);
  });
});

describe("user_confirmed anchor without pending plan", () => {
  const timing = deriveTimingAnchorMemory({
    latestAnswerAfterOpenQuestion:
      "Usually after Brooke's workout is my best window.",
    pendingPlanProof: null,
  });

  it("prompt guidance allows confirmed candidate with today confirm", () => {
    const g = buildTimingAnchorMemoryLaneGuardrails(timing);
    expect(timing.confidence_level).toBe("user_confirmed");
    expect(g).toMatch(/user_confirmed/i);
    expect(g).toMatch(/still confirm today/i);
    expect(g).toMatch(/do not assume the schedule forever/i);
    expect(buildPendingPlanProofLaneGuardrails(null)).toBe("");
  });
});

describe("buildTimingAnchorMemoryLaneGuardrails", () => {
  it("returns empty when timing anchor inactive", () => {
    expect(buildTimingAnchorMemoryLaneGuardrails(inactiveTimingAnchorMemory())).toBe("");
  });

  it("includes repeated and worked_before distinctions", () => {
    const repeated = deriveTimingAnchorMemory({
      recentExactThreadText: [
        "User: I'll do it after Brooke gets back from her workout.",
        "User: Same plan — after Brooke's workout.",
      ].join("\n"),
    });
    expect(repeated.confidence_level).toBe("repeated");
    const gRepeated = buildTimingAnchorMemoryLaneGuardrails(repeated);
    expect(gRepeated).toMatch(/come up more than once/i);

    const worked = deriveTimingAnchorMemory({
      latestAnswerAfterOpenQuestion:
        "I will do it today after Brooke gets back from her workout",
      pendingPlanProof: null,
      openQuestionAnsweredAt: "2026-05-11T20:30:00.000Z",
      userAnswersNewestFirst: [
        {
          text: "I will do it today after Brooke gets back from her workout",
          answered_at: "2026-05-11T20:30:00.000Z",
        },
        { text: "Yes, done.", answered_at: "2026-05-11T22:00:00.000Z" },
      ],
      recentEvents: [
        {
          event_type: "user_yes",
          occurred_at: "2026-05-11T22:00:00.000Z",
          payload_json: {},
        },
      ],
    });
    expect(worked.confidence_level).toBe("worked_before");
    const gWorked = buildTimingAnchorMemoryLaneGuardrails(worked);
    expect(gWorked).toMatch(/may have helped once/i);
    expect(gWorked).toMatch(/Do NOT say it always works/i);
  });
});
