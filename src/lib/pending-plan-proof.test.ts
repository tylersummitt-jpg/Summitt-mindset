import { describe, expect, it } from "vitest";

import {
  buildPendingPlanProofLaneGuardrails,
  derivePendingPlanProof,
  detectPendingPlanProofVoiceViolations,
  enrichDailyFactsCoreWithPendingPlanProof,
  extractAnchorPhraseHint,
  hasFuturePlanIntentLanguage,
  looksLikeReportedCompletion,
} from "@/lib/pending-plan-proof";
import {
  detectTimingAnchorVoiceViolations,
  inactiveTimingAnchorMemory,
} from "@/lib/timing-anchor-memory";
import type { DailyFactsCoreForPendingPlanEnrich } from "@/lib/pending-plan-proof";

const BROOKE_ANSWER =
  "I planned to make it happen last night, so I will make it happen today after Brooke gets back from her workout";
const DIST_Q =
  "What actions will you take to ensure you spend those two hours on distribution?";

function baseFactsForMove(overrides?: Partial<DailyFactsCoreForPendingPlanEnrich>): DailyFactsCoreForPendingPlanEnrich {
  return {
    route_kind: "main_active_accountability",
    accountability_day_key: "2026-05-12",
    user: {
      clerk_user_id: "user_1",
      preferred_name: "Tyler",
      timezone: "America/Chicago",
      local_time_iso: "2026-05-12T14:00:00.000Z",
      relationship_profile_summary: null,
    },
    commitment: {
      id: "cmt_1",
      title: "Distribution",
      behavior_statement: "Two hours of distribution work",
      effective_ask: "Two hours of distribution work",
      accountability_phase: "active_accountability",
      identity_anchor_allowed: false,
      identity_anchor_short: null,
    },
    thread_memory: {
      latest_outbound_sms: null,
      latest_inbound_sms: null,
      recent_transcript_or_context_block: null,
      latest_open_question: DIST_Q,
      latest_answer_after_open_question: BROOKE_ANSWER,
      open_question_answered_at: "2026-05-11T20:30:00.000Z",
      open_question_pending: false,
      do_not_repeat_hints: [],
      coaching_memory_snippet: "",
      recent_pattern_hints: null,
    },
    accountability: {
      daily_purpose: "standard_accountability_check",
      server_strategy: "standard_check",
      next_move_type: "hold_standard",
      prior_outcome: null,
      yes_streak_14d: 0,
      no_count_14d: 0,
      partial_count_14d: 0,
      blocker_preview: null,
      proof_or_milestone_signal: null,
      silence_tier: "none",
      unanswered_checks: 0,
      days_since_last_user_outcome: 2,
      reentry_active: false,
      overlay_active: false,
      evolution_pattern_hint: null,
      contract_proposal_mode: false,
    },
    ...overrides,
  };
}

describe("derivePendingPlanProof", () => {
  it("activates for Brooke one-time timing anchor on prior day", () => {
    const pending = derivePendingPlanProof({
      accountabilityDayKey: "2026-05-12",
      timezone: "America/Chicago",
      latestOpenQuestion: DIST_Q,
      latestAnswerAfterOpenQuestion: BROOKE_ANSWER,
      openQuestionAnsweredAt: "2026-05-11T20:30:00.000Z",
      openQuestionPending: false,
      effectiveAsk: "Two hours of distribution work",
      behaviorStatement: "Two hours of distribution work",
      eventsNewestFirst: [],
    });
    expect(pending?.active).toBe(true);
    expect(pending?.plan_for_day_key).toBe("2026-05-11");
    expect(pending?.recurrence_confidence).toBe("unknown");
    expect(pending?.outcome_known).toBe(false);
    expect(pending?.anchor_phrase_hint).toMatch(/after Brooke/i);
    expect(pending?.anchor_key).toBe("brooke|workout");
  });

  it("is inactive when user later reports yes/outcome on spine", () => {
    const pending = derivePendingPlanProof({
      accountabilityDayKey: "2026-05-12",
      timezone: "America/Chicago",
      latestOpenQuestion: DIST_Q,
      latestAnswerAfterOpenQuestion: BROOKE_ANSWER,
      openQuestionAnsweredAt: "2026-05-11T20:30:00.000Z",
      openQuestionPending: false,
      effectiveAsk: "Two hours of distribution work",
      behaviorStatement: "Two hours of distribution work",
      eventsNewestFirst: [
        {
          event_type: "user_yes",
          occurred_at: "2026-05-11T22:00:00.000Z",
          payload_json: {},
        },
      ],
    });
    expect(pending).toBeNull();
  });

  it("is inactive when latest answer is completion not plan", () => {
    const pending = derivePendingPlanProof({
      accountabilityDayKey: "2026-05-12",
      timezone: "America/Chicago",
      latestOpenQuestion: DIST_Q,
      latestAnswerAfterOpenQuestion: "Yes — got the two hours done after she got back.",
      openQuestionAnsweredAt: "2026-05-11T22:00:00.000Z",
      openQuestionPending: false,
      effectiveAsk: "Two hours of distribution work",
      behaviorStatement: "Two hours of distribution work",
      eventsNewestFirst: [],
    });
    expect(pending).toBeNull();
  });

  it("is inactive when plan day is still today", () => {
    const pending = derivePendingPlanProof({
      accountabilityDayKey: "2026-05-12",
      timezone: "America/Chicago",
      latestOpenQuestion: DIST_Q,
      latestAnswerAfterOpenQuestion: "I will do it today after Brooke gets back from her workout",
      openQuestionAnsweredAt: "2026-05-12T08:00:00.000Z",
      openQuestionPending: false,
      effectiveAsk: "Two hours of distribution work",
      behaviorStatement: "Two hours of distribution work",
      eventsNewestFirst: [],
    });
    expect(pending).toBeNull();
  });
});

describe("enrichDailyFactsCoreWithPendingPlanProof", () => {
  it("attaches pending_plan_proof on facts for main accountability", () => {
    const enriched = enrichDailyFactsCoreWithPendingPlanProof(baseFactsForMove(), {
      eventsNewestFirst: [],
      openQuestionAnsweredAt: "2026-05-11T20:30:00.000Z",
    });
    expect(enriched.accountability.pending_plan_proof?.active).toBe(true);
    expect(enriched.accountability.pending_plan_proof?.recurrence_confidence).toBe("unknown");
    expect(enriched.accountability.pending_plan_proof?.anchor_key).toBe("brooke|workout");
    expect(enriched.accountability.timing_anchor_memory?.active).toBe(true);
    expect(enriched.accountability.timing_anchor_memory?.anchor_key).toBe("brooke|workout");
    expect(enriched.accountability.timing_anchor_memory?.confidence_level).toBe("mentioned_once");
  });

  it("attaches inactive timing_anchor_memory when no anchor on eligible route", () => {
    const enriched = enrichDailyFactsCoreWithPendingPlanProof(
      baseFactsForMove({
        thread_memory: {
          ...baseFactsForMove().thread_memory,
          latest_answer_after_open_question: "Not today.",
        },
      }),
      { eventsNewestFirst: [] }
    );
    expect(enriched.accountability.pending_plan_proof).toBeUndefined();
    expect(enriched.accountability.timing_anchor_memory?.active).toBe(false);
  });
});

describe("buildPendingPlanProofLaneGuardrails", () => {
  it("instructs not to assume recurring anchor", () => {
    const pending = derivePendingPlanProof({
      accountabilityDayKey: "2026-05-12",
      timezone: "America/Chicago",
      latestOpenQuestion: DIST_Q,
      latestAnswerAfterOpenQuestion: BROOKE_ANSWER,
      openQuestionAnsweredAt: "2026-05-11T20:30:00.000Z",
      openQuestionPending: false,
      effectiveAsk: "Two hours of distribution",
      behaviorStatement: "Two hours of distribution",
    });
    const g = buildPendingPlanProofLaneGuardrails(pending);
    expect(g).toMatch(/do not assume/i);
    expect(g).toMatch(/recurring/i);
    expect(g).toMatch(/close the loop/i);
  });
});

describe("detectPendingPlanProofVoiceViolations", () => {
  const pending = derivePendingPlanProof({
    accountabilityDayKey: "2026-05-12",
    timezone: "America/Chicago",
    latestOpenQuestion: DIST_Q,
    latestAnswerAfterOpenQuestion: BROOKE_ANSWER,
    openQuestionAnsweredAt: "2026-05-11T20:30:00.000Z",
    openQuestionPending: false,
    effectiveAsk: "Two hours of distribution",
    behaviorStatement: "Two hours of distribution",
  })!;

  it("rejects unearned focus praise", () => {
    const hits = detectPendingPlanProofVoiceViolations(
      "Tyler, it's great to see you focused on your distribution time today.",
      pending
    );
    expect(hits).toContain("unearned_focus_praise");
  });

  it("rejects presumed recurring anchor schedule without closing loop", () => {
    const timing = {
      ...inactiveTimingAnchorMemory(),
      active: true,
      anchor_phrase_hint: pending.anchor_phrase_hint,
      anchor_key: pending.anchor_key,
      confidence_level: "mentioned_once" as const,
      recurrence_confidence: "unknown" as const,
      mention_count_45d: 1,
      source: "recent_user_plan" as const,
      safe_usage_allowed: [],
      safe_usage_forbidden: [],
    };
    const hits = detectTimingAnchorVoiceViolations({
      body: "After Brooke's workout, dive into those two hours and make the most of that time.",
      timingAnchorMemory: timing,
      pendingPlanProof: pending,
      hasProofOrKnownOutcome: false,
    });
    expect(hits).toContain("presumed_recurring_anchor_schedule");
  });

  it("allows natural warmth without claiming proof", () => {
    const hits = detectPendingPlanProofVoiceViolations("Good to see you back — quick check-in.", pending);
    expect(hits).not.toContain("unearned_focus_praise");
  });

  it("allows anchor reference when closing the loop", () => {
    const timing = {
      ...inactiveTimingAnchorMemory(),
      active: true,
      anchor_phrase_hint: pending.anchor_phrase_hint,
      anchor_key: pending.anchor_key,
      confidence_level: "mentioned_once" as const,
      recurrence_confidence: "unknown" as const,
      mention_count_45d: 1,
      source: "recent_user_plan" as const,
      safe_usage_allowed: [],
      safe_usage_forbidden: [],
    };
    const hits = detectTimingAnchorVoiceViolations({
      body: "Yesterday you named a window after Brooke's workout — did the two hours happen: done, partial, or missed?",
      timingAnchorMemory: timing,
      pendingPlanProof: pending,
      hasProofOrKnownOutcome: false,
    });
    expect(hits).not.toContain("presumed_recurring_anchor_schedule");
  });
});

describe("helpers", () => {
  it("detects future plan language", () => {
    expect(hasFuturePlanIntentLanguage(BROOKE_ANSWER)).toBe(true);
    expect(looksLikeReportedCompletion("Yes, done.")).toBe(true);
    expect(extractAnchorPhraseHint(BROOKE_ANSWER)).toMatch(/Brooke/i);
  });
});
