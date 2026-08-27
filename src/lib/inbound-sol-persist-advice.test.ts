import { describe, expect, it } from "vitest";
import { MORNING_COACHING_BRIEF_VERSION } from "@/lib/morning-tto-coaching-brief-v1";
import {
  parseInboundCoachingBriefV1,
  type InboundSolBriefExtras,
} from "@/lib/inbound-sol-coaching-brief";
import { shouldPersistSolInboundAccountabilityOutcome } from "@/lib/inbound-sol-persist-advice";
import { recentEventsIncludeUserYesOnLocalDay } from "@/lib/north-star-sms-context-packet";
import type { V2EventRowForAi } from "@/lib/v2-commitment";

function extras(overrides: Partial<InboundSolBriefExtras> = {}): InboundSolBriefExtras {
  const { accountability_interpretation, ...rest } = overrides;
  return {
    answer_priority: "normal",
    coaching_after_answer: "yes",
    user_is_correcting_coach: false,
    accountability_interpretation: {
      relevance: "central",
      outcome: "completed",
      confidence: "high",
      evidence: "Got the whole thing finished before lunch.",
      ...accountability_interpretation,
    },
    meaningful_win: null,
    pending_photo_relation: { relation: "none", target_win_id: null },
    durable_user_evidence: null,
    ...rest,
  };
}

function advice(
  inbound: InboundSolBriefExtras,
  more: Partial<Parameters<typeof shouldPersistSolInboundAccountabilityOutcome>[0]> = {}
) {
  return shouldPersistSolInboundAccountabilityOutcome({
    inbound,
    messageSid: "SMnew",
    commitmentId: "c1",
    hasActiveCommitment: true,
    exclusiveLaneOwnsTurn: false,
    pendingConfirmationConflict: false,
    timezone: "America/Chicago",
    localDayKey: "2026-08-18",
    classifierEventType: "user_no",
    ...more,
  });
}

describe("shouldPersistSolInboundAccountabilityOutcome", () => {
  it("persists user_yes for completed+central+high even if classifier would disagree", () => {
    const r = advice(extras(), { classifierEventType: "user_no" });
    expect(r.persist).toBe(true);
    if (r.persist) expect(r.resolvedEventType).toBe("user_yes");
  });

  it("does not let classifier user_yes create proof when Sol says plan", () => {
    const r = advice(
      extras({
        accountability_interpretation: {
          relevance: "central",
          outcome: "plan",
          confidence: "high",
          evidence: "I'm going to do it tomorrow.",
        },
      }),
      { classifierEventType: "user_yes" }
    );
    expect(r.persist).toBe(false);
    if (!r.persist) expect(r.skipReason).toBe("sol_plan");
  });

  it("does not let classifier partial suppress Sol completed+central+high user_yes", () => {
    const r = advice(extras(), { classifierEventType: "user_partial" });
    expect(r.persist).toBe(true);
    if (r.persist) expect(r.resolvedEventType).toBe("user_yes");
  });

  it("maps missed+related+high to user_no", () => {
    const r = advice(
      extras({
        accountability_interpretation: {
          relevance: "related",
          outcome: "missed",
          confidence: "high",
          evidence: "I blew it today.",
        },
      })
    );
    expect(r.persist).toBe(true);
    if (r.persist) expect(r.resolvedEventType).toBe("user_no");
  });

  it("maps partial+central+medium to user_partial", () => {
    const r = advice(
      extras({
        accountability_interpretation: {
          relevance: "central",
          outcome: "partial",
          confidence: "medium",
          evidence: "Did part of the lift.",
        },
      })
    );
    expect(r.persist).toBe(true);
    if (r.persist) expect(r.resolvedEventType).toBe("user_partial");
  });

  it("does not persist plan", () => {
    const r = advice(
      extras({
        accountability_interpretation: {
          relevance: "central",
          outcome: "plan",
          confidence: "high",
          evidence: "I'm going to do it tomorrow.",
        },
      })
    );
    expect(r.persist).toBe(false);
    if (!r.persist) expect(r.skipReason).toBe("sol_plan");
  });

  it("does not treat attempt as partial", () => {
    const r = advice(
      extras({
        accountability_interpretation: {
          relevance: "central",
          outcome: "attempt",
          confidence: "high",
          evidence: "I started but didn't finish.",
        },
      })
    );
    expect(r.persist).toBe(false);
    if (!r.persist) expect(r.skipReason).toBe("sol_attempt");
  });

  it("does not persist not_applicable (holds me accountable / product talk)", () => {
    const r = advice(
      extras({
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "high",
          evidence: "It holds me accountable.",
        },
      })
    );
    expect(r.persist).toBe(false);
  });

  it("does not persist unrelated even if outcome is completed", () => {
    const r = advice(
      extras({
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "completed",
          confidence: "high",
          evidence: "Church",
        },
      })
    );
    expect(r.persist).toBe(false);
    if (!r.persist) expect(r.skipReason).toBe("sol_unrelated");
  });

  it("does not persist low confidence", () => {
    const r = advice(
      extras({
        accountability_interpretation: {
          relevance: "central",
          outcome: "completed",
          confidence: "low",
          evidence: "maybe?",
        },
      })
    );
    expect(r.persist).toBe(false);
    if (!r.persist) expect(r.skipReason).toBe("sol_low_confidence");
  });

  it("same-day user_yes law: first persists, second SID skips, user_no still allowed", () => {
    const priorYes: V2EventRowForAi[] = [
      {
        event_type: "user_yes",
        occurred_at: "2026-08-18T12:00:00.000Z",
        payload_json: {},
      } as V2EventRowForAi,
    ];
    expect(
      recentEventsIncludeUserYesOnLocalDay(priorYes, "America/Chicago", "2026-08-18")
    ).toBe(true);

    const first = advice(extras(), { recentEventsNewestFirst: [] });
    expect(first.persist).toBe(true);

    const second = advice(extras(), {
      messageSid: "SMsecond",
      recentEventsNewestFirst: priorYes,
    });
    expect(second.persist).toBe(false);
    if (!second.persist) expect(second.skipReason).toBe("same_day_user_yes_already_recorded");

    const missAfterYes = advice(
      extras({
        accountability_interpretation: {
          relevance: "central",
          outcome: "missed",
          confidence: "high",
          evidence: "I blew it today.",
        },
      }),
      { messageSid: "SMno", recentEventsNewestFirst: priorYes }
    );
    expect(missAfterYes.persist).toBe(true);
    if (missAfterYes.persist) expect(missAfterYes.resolvedEventType).toBe("user_no");
  });

  it("same-day user_yes gate uses receive-day localDayKey, not a later process day", () => {
    const priorYes: V2EventRowForAi[] = [
      {
        event_type: "user_yes",
        occurred_at: "2026-08-19T04:59:00.000Z",
        payload_json: {},
      } as V2EventRowForAi,
    ];
    expect(recentEventsIncludeUserYesOnLocalDay(priorYes, "America/Chicago", "2026-08-18")).toBe(
      true
    );
    expect(recentEventsIncludeUserYesOnLocalDay(priorYes, "America/Chicago", "2026-08-19")).toBe(
      false
    );

    const receiveDay = advice(extras(), {
      localDayKey: "2026-08-18",
      recentEventsNewestFirst: priorYes,
    });
    expect(receiveDay.persist).toBe(false);
    if (!receiveDay.persist) expect(receiveDay.skipReason).toBe("same_day_user_yes_already_recorded");

    const processNextDay = advice(extras(), {
      localDayKey: "2026-08-19",
      recentEventsNewestFirst: priorYes,
    });
    expect(processNextDay.persist).toBe(true);
  });

  it("same-day law does not block a different commitment (empty events for that commitment)", () => {
    const r = advice(extras(), {
      commitmentId: "c-other",
      recentEventsNewestFirst: [],
    });
    expect(r.persist).toBe(true);
  });

  it("empty recent events does not skip user_yes", () => {
    const r = advice(extras(), { recentEventsNewestFirst: [] });
    expect(r.persist).toBe(true);
  });
});

describe("parseInboundCoachingBriefV1 inbound extras", () => {
  it("requires inbound extras on top of six Morning sections", () => {
    const raw = {
      version: MORNING_COACHING_BRIEF_VERSION,
      confidence: "high",
      human_situation: {
        most_alive: "Church with kids",
        direct_question_or_need: null,
        relevant_life_event: "kids love church",
        context_use: "relevant",
        identity_use: "background",
        person_use: "relevant",
        selected_person: null,
        selected_person_reason: null,
      },
      truth_and_evidence: {
        latest_user_truth: "The kids love church",
        outcome: "no_recent_evidence",
        evidence_note: "Life update, not a lift report",
        evidence_strength: "none",
        consistency_supported: false,
        proof_claims_allowed: {
          completion: false,
          miss: false,
          partial: false,
          proof: false,
        },
      },
      conversation_continuity: {
        already_acknowledged: "unknown",
        answered_question: null,
        open_loop: null,
        stale_or_exhausted_topics: [],
        do_not_repeat: [],
      },
      goal_role_today: {
        canonical_goal: "Lift 30 minutes",
        pending_goal: null,
        goal_alignment: "aligned",
        role: "do_not_mention",
        note: "Family/faith is most alive",
      },
      coaching_direction: {
        primary_move: "acknowledge_truth",
        question_policy: "none",
        action_guidance: "none",
        pressure: "low",
        proactive_decision: "send",
      },
      boundaries: {
        claims_to_avoid: ["Do not invent proof"],
        topics_not_to_force: ["Do not force lifting"],
        unsupported_capabilities: ["No app menus"],
        goal_authority_boundaries: [],
        identity_people_boundaries: [],
        coach_history_is_not_style: "Prior coach messages are history, not style.",
      },
      inbound: extras({
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "high",
          evidence: "Awesome. The kids love church!",
        },
      }),
    };
    const parsed = parseInboundCoachingBriefV1(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.inbound.accountability_interpretation.outcome).toBe("not_applicable");
    expect(parsed?.goal_role_today.role).toBe("do_not_mention");
  });
});
