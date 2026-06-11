import { describe, expect, it } from "vitest";

import {
  buildActivePendingStateFromCommitmentRow,
  buildActivePendingStateFromDailyFacts,
} from "@/lib/sms-active-pending-state";
import {
  MAX_DO_NOT_REPEAT_ASKS,
  MAX_OPEN_LOOPS,
  MAX_SATISFIED_ASKS,
  buildOpenLoopsAndDoNotRepeat,
  buildOpenLoopsAndDoNotRepeatPromptGuidance,
  isDeliveredCoachQuestionMessage,
} from "@/lib/sms-open-loops-and-do-not-repeat";
import {
  GENERIC_FUTURE_RECOMMITMENT_DNR_ASK,
  isGenericFutureRecommitmentQuestionFamily,
} from "@/lib/sms-generic-future-recommitment-question-family";
import type { RelationshipMemory7dData } from "@/lib/sms-relationship-memory-7d";
import type { RelationshipPacketStructuredRecentTruth } from "@/lib/sms-relationship-packet-v1";
import type { RecentExactThread72hMessage } from "@/lib/sms-recent-exact-thread-72h";

const CALENDAR_ASK = "Did you put the family connection on the calendar for tomorrow?";
const STALE_MEMORY_Q = "What story will you dictate today?";

function makeMessage(
  partial: Partial<RecentExactThread72hMessage> & Pick<RecentExactThread72hMessage, "role" | "body">
): RecentExactThread72hMessage {
  return {
    at: "2026-05-18T11:00:00.000Z",
    at_local: "May 18, 6:00 AM",
    at_local_timezone: "America/Chicago",
    local_day_key: "2026-05-18",
    message_kind: null,
    source_table: "sms_inbound_messages",
    message_sid: null,
    delivery_status: "sent",
    is_exact_body: true,
    ...partial,
  };
}

function baseTruth(
  overrides?: Partial<RelationshipPacketStructuredRecentTruth>
): RelationshipPacketStructuredRecentTruth {
  return {
    latest_open_question: null,
    latest_answer_after_open_question: null,
    open_question_pending: false,
    last_5_coach_questions: [],
    do_not_repeat_phrases: [],
    ...overrides,
  };
}

function emptyMemory7d(): RelationshipMemory7dData {
  return {
    window_days: 7,
    built_at: "2026-05-18T12:00:00.000Z",
    outcome_counts: { yes: 0, no: 0, partial: 0, blockers: 0, checks_sent: 0 },
    wins: [],
    misses: [],
    partials: [],
    comebacks: [],
    blockers: [],
    proof_moments: [],
    open_loops: [],
    direct_answer_history: [],
    context_flags: {},
  };
}

describe("buildOpenLoopsAndDoNotRepeat", () => {
  it("1: active_pending_state items become open_loops", () => {
    const state = buildActivePendingStateFromCommitmentRow(null, {
      openQuestionPending: true,
      latestOpenQuestion: "When will you block focus?",
    });
    const { section } = buildOpenLoopsAndDoNotRepeat({
      structuredRecentTruth: baseTruth(),
      activePendingState: state,
    });
    expect(section.data.open_loops.some((l) => l.source === "active_pending_state")).toBe(true);
    expect(section.data.open_loops.some((l) => l.kind === "open_question")).toBe(true);
  });

  it("2: open_question active item becomes open_loop", () => {
    const state = buildActivePendingStateFromCommitmentRow(null, {
      openQuestionPending: true,
      latestOpenQuestion: "How did the workout go?",
    });
    const item = state.items.find((i) => i.kind === "open_question");
    const { section } = buildOpenLoopsAndDoNotRepeat({
      structuredRecentTruth: baseTruth(),
      activePendingState: state,
    });
    const loop = section.data.open_loops.find((l) => l.kind === "open_question");
    expect(loop?.active).toBe(true);
    expect(loop?.evidence_preview).toContain("workout");
    expect(item?.must_not_claim_resolved).toBe(true);
  });

  it("3: pending_plan_proof active becomes open_loop and pending_plan_proof section", () => {
    const dailyFacts = {
      user: { clerk_user_id: "u", preferred_name: null, timezone: "America/Chicago", local_time_iso: null, relationship_profile_summary: null },
      commitment: { id: "c", title: "T", behavior_statement: "B", effective_ask: "B", accountability_phase: "active_accountability" },
      thread_memory: { open_question_pending: false, latest_open_question: null },
      accountability: { pending_plan_proof: { active: true }, goal_adjustment_mention_allowed: false, overlay_active: false },
      contract_proposal: null,
      pending_resolution: null,
      refresh: null,
    } as never;
    const { state } = buildActivePendingStateFromDailyFacts(dailyFacts);
    const { section } = buildOpenLoopsAndDoNotRepeat({
      structuredRecentTruth: baseTruth(),
      activePendingState: state,
    });
    expect(section.data.open_loops.some((l) => l.kind === "pending_plan_proof")).toBe(true);
    expect(section.data.pending_plan_proof?.active).toBe(true);
  });

  it("4: turn_understanding satisfied ask becomes satisfied_asks + do_not_repeat_asks", () => {
    const { section } = buildOpenLoopsAndDoNotRepeat({
      structuredRecentTruth: baseTruth({
        turn_understanding: {
          authority: "authoritative_current",
          relationship_meaning: "plan_detail_given",
          response_intent: "ack_plan",
          last_ask_satisfied: "yes",
          satisfaction_kind: "plan_detail",
          do_not_repeat_asks: [CALENDAR_ASK],
          stale_ask_risk: false,
          evidence_quotes: ["Tuesday at 7pm"],
          confidence: 0.9,
          persistence_note: "test",
        },
      }),
      activePendingState: buildActivePendingStateFromCommitmentRow(null),
    });
    expect(section.data.satisfied_asks.some((s) => s.source === "turn_understanding")).toBe(true);
    expect(section.data.do_not_repeat_asks.some((a) => /family connection/i.test(a))).toBe(true);
  });

  it("5: daily_satisfied_ask_context do_not_repeat_asks included", () => {
    const { section } = buildOpenLoopsAndDoNotRepeat({
      structuredRecentTruth: baseTruth({
        daily_satisfied_ask_context: {
          has_satisfied_recent_ask: true,
          satisfied_ask_type: "plan_detail",
          do_not_repeat_asks: [CALENDAR_ASK],
          evidence_preview: "Tuesday 7pm",
          source: "inbound_turn_telemetry",
          occurred_at: "2026-05-18T10:00:00.000Z",
          persistence_note: "test",
        },
      }),
      activePendingState: buildActivePendingStateFromCommitmentRow(null),
    });
    expect(section.data.do_not_repeat_asks.some((a) => /family connection/i.test(a))).toBe(true);
    expect(section.data.satisfied_asks.some((s) => s.source === "daily_satisfied_ask_context")).toBe(true);
  });

  it("6: relationship_memory_7d direct_answer_history becomes satisfied_asks", () => {
    const memory = emptyMemory7d();
    memory.direct_answer_history = [
      {
        coach_question: STALE_MEMORY_Q,
        user_answer: "The leadership story about delegation.",
        answer_type: "direct_answer",
        at: "2026-05-17T10:00:00.000Z",
        source: "v2_commitment_sms_thread_memory",
        message_sid: null,
      },
    ];
    const { section } = buildOpenLoopsAndDoNotRepeat({
      structuredRecentTruth: baseTruth(),
      activePendingState: buildActivePendingStateFromCommitmentRow(null),
      relationshipMemory7d: memory,
    });
    expect(section.data.satisfied_asks.some((s) => s.source === "relationship_memory_7d")).toBe(true);
    expect(section.data.satisfied_asks[0]?.ask_text).toMatch(/dictate today/i);
  });

  it("7: recent exact answered question prevents unanswered duplicate", () => {
    const { section } = buildOpenLoopsAndDoNotRepeat({
      structuredRecentTruth: baseTruth({
        latest_open_question: STALE_MEMORY_Q,
        latest_answer_after_open_question: "The leadership delegation story.",
        open_question_pending: false,
        last_5_coach_questions: [STALE_MEMORY_Q],
      }),
      activePendingState: buildActivePendingStateFromCommitmentRow(null),
      recentExactThread72h: {
        messages: [
          makeMessage({ role: "coach", body: STALE_MEMORY_Q }),
          makeMessage({ role: "user", body: "The leadership delegation story." }),
        ],
      },
    });
    expect(section.data.recent_unanswered_coach_questions.some((q) => /dictate today/i.test(q))).toBe(
      false
    );
    expect(section.data.do_not_repeat_asks.some((a) => /dictate today/i.test(a))).toBe(true);
  });

  it("8: no-send/system markers do not become coach questions", () => {
    const { section } = buildOpenLoopsAndDoNotRepeat({
      structuredRecentTruth: baseTruth(),
      activePendingState: buildActivePendingStateFromCommitmentRow(null),
      recentExactThread72h: {
        messages: [
          makeMessage({
            role: "system_no_send",
            body: "[no_send: stale_ask_blocked]",
            delivery_status: "unknown",
          }),
          makeMessage({ role: "coach", body: "When will you start?", delivery_status: "preview" }),
        ],
      },
    });
    expect(section.data.recent_unanswered_coach_questions.some((q) => /no_send/i.test(q))).toBe(false);
    expect(section.data.recent_unanswered_coach_questions.some((q) => /When will you start/i.test(q))).toBe(
      false
    );
  });

  it("9: unsent drafts do not become open loops", () => {
    const { section } = buildOpenLoopsAndDoNotRepeat({
      structuredRecentTruth: baseTruth({
        open_question_pending: false,
        last_5_coach_questions: ["Draft-only question?"],
      }),
      activePendingState: buildActivePendingStateFromCommitmentRow(null),
      recentExactThread72h: {
        messages: [
          makeMessage({
            role: "coach",
            body: "Draft-only question?",
            delivery_status: "preview",
          }),
        ],
      },
    });
    expect(section.data.open_loops.some((l) => /Draft-only/i.test(l.evidence_preview ?? ""))).toBe(
      false
    );
    expect(section.data.recent_unanswered_coach_questions.some((q) => /Draft-only/i.test(q))).toBe(
      false
    );
  });

  it("10: dedupes near-identical asks", () => {
    const nearDup = "Did you put family connection on the calendar for tomorrow";
    const { section } = buildOpenLoopsAndDoNotRepeat({
      structuredRecentTruth: baseTruth({
        turn_understanding: {
          authority: "authoritative_current",
          relationship_meaning: "plan",
          response_intent: "ack",
          last_ask_satisfied: "yes",
          satisfaction_kind: "plan_detail",
          do_not_repeat_asks: [CALENDAR_ASK],
          stale_ask_risk: false,
          evidence_quotes: [],
          confidence: 0.9,
          persistence_note: "test",
        },
        daily_satisfied_ask_context: {
          has_satisfied_recent_ask: true,
          satisfied_ask_type: "plan_detail",
          do_not_repeat_asks: [nearDup],
          evidence_preview: null,
          source: "inbound_turn_telemetry",
          occurred_at: null,
          persistence_note: "test",
        },
      }),
      activePendingState: buildActivePendingStateFromCommitmentRow(null),
    });
    expect(section.data.do_not_repeat_asks.length).toBe(1);
    expect(section.data.satisfied_asks.length).toBe(1);
  });

  it("11: recent exact thread / TU beat relationship_memory_7d stale open loop", () => {
    const memory = emptyMemory7d();
    memory.open_loops = [
      {
        question_or_plan: STALE_MEMORY_Q,
        evidence: STALE_MEMORY_Q,
        last_seen_at: "2026-05-10T10:00:00.000Z",
        source: "v2_commitment_sms_thread_memory",
        message_sid: null,
      },
    ];
    const { section } = buildOpenLoopsAndDoNotRepeat({
      structuredRecentTruth: baseTruth({
        latest_open_question: STALE_MEMORY_Q,
        latest_answer_after_open_question: "The delegation story.",
        open_question_pending: false,
        turn_understanding: {
          authority: "authoritative_current",
          relationship_meaning: "answered",
          response_intent: "ack",
          last_ask_satisfied: "yes",
          satisfaction_kind: "direct_answer",
          do_not_repeat_asks: [STALE_MEMORY_Q],
          stale_ask_risk: false,
          evidence_quotes: ["The delegation story."],
          confidence: 0.9,
          persistence_note: "test",
        },
      }),
      activePendingState: buildActivePendingStateFromCommitmentRow(null),
      relationshipMemory7d: memory,
      recentExactThread72h: {
        messages: [
          makeMessage({ role: "coach", body: STALE_MEMORY_Q }),
          makeMessage({ role: "user", body: "The delegation story." }),
        ],
      },
    });
    expect(section.data.open_loops.some((l) => l.source === "relationship_memory_7d")).toBe(false);
    expect(section.data.satisfied_asks.some((s) => /dictate today/i.test(s.ask_text))).toBe(true);
  });

  it("12: active pending state items are not dropped by trim", () => {
    const memory = emptyMemory7d();
    memory.open_loops = Array.from({ length: 20 }, (_, i) => ({
      question_or_plan: `Unique weekly topic ${i}: what is your plan for area ${i}?`,
      evidence: `evidence ${i}`,
      last_seen_at: "2026-05-10T10:00:00.000Z",
      source: "v2_commitment_sms_thread_memory",
      message_sid: null,
    }));
    const state = buildActivePendingStateFromCommitmentRow(null, {
      openQuestionPending: true,
      latestOpenQuestion: "Protected pending question?",
      pendingPlanProofActive: true,
    });
    const { section, meta } = buildOpenLoopsAndDoNotRepeat({
      structuredRecentTruth: baseTruth(),
      activePendingState: state,
      relationshipMemory7d: memory,
    });
    expect(section.data.open_loops.some((l) => l.source === "active_pending_state")).toBe(true);
    expect(section.data.open_loops.some((l) => l.kind === "pending_plan_proof")).toBe(true);
    expect(meta.open_loops_truncated).toBe(true);
  });

  it("13: max counts enforced", () => {
    const memory = emptyMemory7d();
    memory.open_loops = Array.from({ length: 15 }, (_, i) => ({
      question_or_plan: `Low priority memory loop ${i}?`,
      evidence: `ev ${i}`,
      last_seen_at: "2026-05-10T10:00:00.000Z",
      source: "mem",
      message_sid: null,
    }));
    memory.direct_answer_history = Array.from({ length: 12 }, (_, i) => ({
      coach_question: `Satisfied question ${i}?`,
      user_answer: `answer ${i}`,
      answer_type: null,
      at: "2026-05-17T10:00:00.000Z",
      source: "mem",
      message_sid: null,
    }));
    const tuDnr = Array.from({ length: 12 }, (_, i) => `Turn understanding do not repeat ask ${i}?`);
    const { section } = buildOpenLoopsAndDoNotRepeat({
      structuredRecentTruth: baseTruth({
        turn_understanding: {
          authority: "authoritative_current",
          relationship_meaning: "x",
          response_intent: "x",
          last_ask_satisfied: "yes",
          satisfaction_kind: "unknown",
          do_not_repeat_asks: tuDnr,
          stale_ask_risk: false,
          evidence_quotes: [],
          confidence: 0.5,
          persistence_note: "test",
        },
      }),
      activePendingState: buildActivePendingStateFromCommitmentRow(null),
      relationshipMemory7d: memory,
    });
    expect(section.data.open_loops.length).toBeLessThanOrEqual(MAX_OPEN_LOOPS);
    expect(section.data.satisfied_asks.length).toBeLessThanOrEqual(MAX_SATISFIED_ASKS);
    expect(section.data.do_not_repeat_asks.length).toBeLessThanOrEqual(MAX_DO_NOT_REPEAT_ASKS);
    expect(section.data.do_not_repeat_asks.some((a) => /Turn understanding do not repeat ask 0/i.test(a))).toBe(
      true
    );
  });

  it("15: telemetry counts/sources correct", () => {
    const state = buildActivePendingStateFromCommitmentRow(null, {
      openQuestionPending: true,
      latestOpenQuestion: "Still waiting?",
    });
    const { meta } = buildOpenLoopsAndDoNotRepeat({
      structuredRecentTruth: baseTruth({
        turn_understanding: {
          authority: "authoritative_current",
          relationship_meaning: "x",
          response_intent: "x",
          last_ask_satisfied: "yes",
          satisfaction_kind: "unknown",
          do_not_repeat_asks: [CALENDAR_ASK],
          stale_ask_risk: false,
          evidence_quotes: [],
          confidence: 0.5,
          persistence_note: "test",
        },
      }),
      activePendingState: state,
    });
    expect(meta.open_loop_count).toBeGreaterThan(0);
    expect(meta.satisfied_ask_count).toBeGreaterThan(0);
    expect(meta.do_not_repeat_ask_count).toBeGreaterThan(0);
    expect(meta.open_loops_sources).toContain("active_pending_state");
  });
});

describe("buildOpenLoopsAndDoNotRepeatPromptGuidance", () => {
  it("includes satisfied asks and do-not-repeat guidance", () => {
    const guidance = buildOpenLoopsAndDoNotRepeatPromptGuidance();
    expect(guidance).toMatch(/satisfied_asks must not be re-asked/i);
    expect(guidance).toMatch(/do_not_repeat_asks are guidance only/i);
    expect(guidance).toMatch(/relationship_memory_7d open loops are lower authority/i);
  });
});

describe("isDeliveredCoachQuestionMessage", () => {
  it("allows sent coach messages with exact body", () => {
    expect(
      isDeliveredCoachQuestionMessage(
        makeMessage({ role: "coach", body: "Did you protect focus?", delivery_status: "sent" })
      )
    ).toBe(true);
  });

  it("rejects non-sent delivery statuses", () => {
    for (const status of ["skipped", "cancelled", "preview", "unknown"] as const) {
      expect(
        isDeliveredCoachQuestionMessage(
          makeMessage({ role: "coach", body: "Did you start?", delivery_status: status })
        )
      ).toBe(false);
    }
  });

  it("rejects system_no_send and non-coach roles", () => {
    expect(
      isDeliveredCoachQuestionMessage(
        makeMessage({
          role: "system_no_send",
          body: "[no_send: stale_ask_blocked]",
          delivery_status: "unknown",
        })
      )
    ).toBe(false);
    expect(
      isDeliveredCoachQuestionMessage(makeMessage({ role: "user", body: "yes", delivery_status: "sent" }))
    ).toBe(false);
  });

  it("rejects non-exact coach bodies", () => {
    expect(
      isDeliveredCoachQuestionMessage(
        makeMessage({
          role: "coach",
          body: "Truncated?",
          delivery_status: "sent",
          is_exact_body: false,
        })
      )
    ).toBe(false);
  });
});

describe("recent_unanswered_coach_questions delivered filtering", () => {
  function unansweredFromThread(messages: RecentExactThread72hMessage[]) {
    return buildOpenLoopsAndDoNotRepeat({
      structuredRecentTruth: baseTruth(),
      activePendingState: buildActivePendingStateFromCommitmentRow(null),
      recentExactThread72h: { messages },
    }).section.data.recent_unanswered_coach_questions;
  }

  it("H1: sent coach question can become recent_unanswered_coach_question", () => {
    const unanswered = unansweredFromThread([
      makeMessage({ role: "coach", body: "When will you block focus?", delivery_status: "sent" }),
    ]);
    expect(unanswered.some((q) => /block focus/i.test(q))).toBe(true);
  });

  it("H2: skipped coach row does NOT become recent_unanswered_coach_question", () => {
    const unanswered = unansweredFromThread([
      makeMessage({ role: "coach", body: "Skipped question?", delivery_status: "skipped" }),
    ]);
    expect(unanswered.some((q) => /Skipped question/i.test(q))).toBe(false);
  });

  it("H3: cancelled coach row does NOT become recent_unanswered_coach_question", () => {
    const unanswered = unansweredFromThread([
      makeMessage({ role: "coach", body: "Cancelled question?", delivery_status: "cancelled" }),
    ]);
    expect(unanswered.some((q) => /Cancelled question/i.test(q))).toBe(false);
  });

  it("H4: system_no_send does NOT become recent_unanswered_coach_question", () => {
    const unanswered = unansweredFromThread([
      makeMessage({
        role: "system_no_send",
        body: "[no_send: stale_ask_blocked]",
        delivery_status: "unknown",
      }),
    ]);
    expect(unanswered.some((q) => /no_send/i.test(q))).toBe(false);
  });

  it("H5: preview coach message does NOT become recent_unanswered_coach_question", () => {
    const unanswered = unansweredFromThread([
      makeMessage({ role: "coach", body: "Preview only?", delivery_status: "preview" }),
    ]);
    expect(unanswered.some((q) => /Preview only/i.test(q))).toBe(false);
  });

  it("H6: unsent draft (preview) does NOT become recent_unanswered even via last_5", () => {
    const { section } = buildOpenLoopsAndDoNotRepeat({
      structuredRecentTruth: baseTruth({
        last_5_coach_questions: ["Draft-only question?"],
      }),
      activePendingState: buildActivePendingStateFromCommitmentRow(null),
      recentExactThread72h: {
        messages: [
          makeMessage({ role: "coach", body: "Draft-only question?", delivery_status: "preview" }),
        ],
      },
    });
    expect(section.data.recent_unanswered_coach_questions.some((q) => /Draft-only/i.test(q))).toBe(false);
  });

  it("H7: no thread proof does NOT allow legacy last_5_coach_questions", () => {
    const { section } = buildOpenLoopsAndDoNotRepeat({
      structuredRecentTruth: baseTruth({
        last_5_coach_questions: ["Legacy projection question?"],
        open_question_pending: true,
        latest_open_question: "Legacy projection question?",
      }),
      activePendingState: buildActivePendingStateFromCommitmentRow(null),
    });
    expect(section.data.recent_unanswered_coach_questions.some((q) => /Legacy projection/i.test(q))).toBe(
      false
    );
  });

  it("H8: answered delivered coach question is excluded", () => {
    const unanswered = unansweredFromThread([
      makeMessage({ role: "coach", body: STALE_MEMORY_Q, delivery_status: "sent" }),
      makeMessage({ role: "user", body: "The leadership delegation story." }),
    ]);
    expect(unanswered.some((q) => /dictate today/i.test(q))).toBe(false);
  });
});

describe("generic future recommitment do-not-repeat family", () => {
  const GENERIC_ASK =
    "Are you ready to stay committed to your goal for the next week?";
  const PARAPHRASE_ASK =
    "Do you want to recommit to this for the next 7 days?";

  it("recent visible coach generic recommit question creates do-not-repeat family", () => {
    const { section, meta } = buildOpenLoopsAndDoNotRepeat({
      structuredRecentTruth: baseTruth(),
      activePendingState: buildActivePendingStateFromCommitmentRow(null),
      recentExactThread72h: {
        messages: [
          makeMessage({ role: "coach", body: GENERIC_ASK, delivery_status: "sent" }),
        ],
      },
    });
    expect(section.data.do_not_repeat_asks).toContain(GENERIC_FUTURE_RECOMMITMENT_DNR_ASK);
    expect(meta.generic_future_recommitment_dnr_active).toBe(true);
    expect(isGenericFutureRecommitmentQuestionFamily(PARAPHRASE_ASK)).toBe(true);
  });

  it("no-send/system generic question does not create visible do-not-repeat", () => {
    const { section, meta } = buildOpenLoopsAndDoNotRepeat({
      structuredRecentTruth: baseTruth(),
      activePendingState: buildActivePendingStateFromCommitmentRow(null),
      recentExactThread72h: {
        messages: [
          makeMessage({
            role: "system_no_send",
            body: GENERIC_ASK,
            delivery_status: "unknown",
          }),
        ],
      },
    });
    expect(section.data.do_not_repeat_asks).not.toContain(GENERIC_FUTURE_RECOMMITMENT_DNR_ASK);
    expect(meta.generic_future_recommitment_dnr_active).toBeUndefined();
  });

  it("paraphrased same question is treated as same family by detector", () => {
    expect(isGenericFutureRecommitmentQuestionFamily(GENERIC_ASK)).toBe(true);
    expect(isGenericFutureRecommitmentQuestionFamily(PARAPHRASE_ASK)).toBe(true);
  });
});
