import { describe, expect, it } from "vitest";

import type { PendingPlanProofFact } from "@/lib/pending-plan-proof";
import {
  buildTimingAnchorVoiceRepairInstruction,
  detectTimingAnchorVoiceViolations,
  inactiveTimingAnchorMemory,
  type TimingAnchorMemory,
} from "@/lib/timing-anchor-memory";

function brookeMentionedOnce(): TimingAnchorMemory {
  return {
    ...inactiveTimingAnchorMemory(),
    active: true,
    anchor_phrase_hint: "after Brooke's workout",
    anchor_key: "brooke|workout",
    confidence_level: "mentioned_once",
    recurrence_confidence: "unknown",
    mention_count_45d: 1,
    source: "recent_user_plan",
    safe_usage_allowed: ["reference_as_dated_window"],
    safe_usage_forbidden: ["assume_daily_schedule"],
  };
}

function dentistMentionedOnce(): TimingAnchorMemory {
  return {
    ...inactiveTimingAnchorMemory(),
    active: true,
    anchor_phrase_hint: "after my dentist appointment",
    anchor_key: "dentist|appointment",
    confidence_level: "mentioned_once",
    recurrence_confidence: "unknown",
    mention_count_45d: 1,
    source: "recent_user_plan",
    safe_usage_allowed: ["reference_as_dated_window"],
    safe_usage_forbidden: ["assume_daily_schedule"],
  };
}

function brookeUserConfirmed(): TimingAnchorMemory {
  return {
    ...brookeMentionedOnce(),
    confidence_level: "user_confirmed",
    recurrence_confidence: "medium",
    user_confirmed: true,
    source: "explicit_confirmation",
  };
}

const BROOKE_PENDING: PendingPlanProofFact = {
  active: true,
  plan_summary_hint: "distribution after workout",
  anchor_phrase_hint: "after Brooke's workout",
  anchor_key: "brooke|workout",
  plan_for_day_key: "2026-05-11",
  source_answer_preview: "I'll do it after Brooke gets back from her workout.",
  recurrence_confidence: "unknown",
  outcome_known: false,
};

describe("detectTimingAnchorVoiceViolations", () => {
  it("Test 1 — blocks overconfident Brooke mentioned_once", () => {
    const hits = detectTimingAnchorVoiceViolations({
      body: "After Brooke's workout, dive into those two hours.",
      timingAnchorMemory: brookeMentionedOnce(),
    });
    expect(hits).toContain("presumed_recurring_anchor_schedule");
  });

  it("Test 2 — allows Brooke close-loop", () => {
    const hits = detectTimingAnchorVoiceViolations({
      body: "Yesterday you named the Brooke workout window. Did the two hours happen — done, partial, or missed?",
      timingAnchorMemory: brookeMentionedOnce(),
    });
    expect(hits).not.toContain("presumed_recurring_anchor_schedule");
    expect(hits).not.toContain("assume_usual_window");
  });

  it("Test 3 — blocks dentist today assumption", () => {
    const hits = detectTimingAnchorVoiceViolations({
      body: "After your dentist appointment today, get back to the plan.",
      timingAnchorMemory: dentistMentionedOnce(),
    });
    expect(
      hits.some((h) => h === "anchor_today_without_confirm" || h === "presumed_recurring_anchor_schedule")
    ).toBe(true);
  });

  it("Test 4 — allows dentist dated close-loop", () => {
    const hits = detectTimingAnchorVoiceViolations({
      body: "You mentioned the dentist appointment yesterday; did the plan happen after that?",
      timingAnchorMemory: dentistMentionedOnce(),
    });
    expect(hits).not.toContain("anchor_today_without_confirm");
    expect(hits).not.toContain("presumed_recurring_anchor_schedule");
  });

  it("Test 5 — blocks usual window without confirmation", () => {
    const hits = detectTimingAnchorVoiceViolations({
      body: "Use your usual Brooke workout window today.",
      timingAnchorMemory: brookeMentionedOnce(),
    });
    expect(hits).toContain("assume_usual_window");
  });

  it("Test 6 — allows user_confirmed usual language carefully", () => {
    const hits = detectTimingAnchorVoiceViolations({
      body: "You've said that Brooke's workout is usually your best window — is that still true today?",
      timingAnchorMemory: brookeUserConfirmed(),
      hasProofOrKnownOutcome: true,
    });
    expect(hits).not.toContain("assume_usual_window");
    expect(hits).not.toContain("presumed_recurring_anchor_schedule");
  });

  it("Test 7 — blocks forever/always even if user_confirmed", () => {
    const hits = detectTimingAnchorVoiceViolations({
      body: "That Brooke workout window always works, so use it every day.",
      timingAnchorMemory: brookeUserConfirmed(),
      hasProofOrKnownOutcome: true,
    });
    expect(hits).toContain("timing_anchor_forever_schedule_claim");
  });

  it("Test 8 — blocks unearned praise when pending_plan_proof.active", () => {
    const hits = detectTimingAnchorVoiceViolations({
      body: "Great to see you focused and back on track after Brooke's workout.",
      timingAnchorMemory: brookeMentionedOnce(),
      pendingPlanProof: BROOKE_PENDING,
      hasProofOrKnownOutcome: false,
    });
    expect(hits).toContain("unearned_completion_or_focus_praise");
  });

  it("Test 9 — allows accountability truth ask when pending_plan_proof.active", () => {
    const hits = detectTimingAnchorVoiceViolations({
      body: "Tell me the truth: did yesterday's block happen — done, partial, or missed?",
      timingAnchorMemory: brookeMentionedOnce(),
      pendingPlanProof: BROOKE_PENDING,
      hasProofOrKnownOutcome: false,
    });
    expect(hits).not.toContain("unearned_completion_or_focus_praise");
  });

  it("buildTimingAnchorVoiceRepairInstruction is principle-based", () => {
    const instruction = buildTimingAnchorVoiceRepairInstruction(
      ["presumed_recurring_anchor_schedule", "unearned_completion_or_focus_praise"],
      brookeMentionedOnce(),
      BROOKE_PENDING
    );
    expect(instruction).toMatch(/one-time timing anchor/i);
    expect(instruction).toMatch(/close the prior plan loop/i);
    expect(instruction).not.toMatch(/After Brooke's workout, dive into/i);
  });
});
