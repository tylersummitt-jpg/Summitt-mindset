import { describe, expect, it } from "vitest";

import {
  MAX_DELIVERY_TRUTH_QUESTIONS,
  MAX_QUESTION_FINGERPRINT_CHARS,
  buildNoSendAndSilenceHistoryV2,
  buildNoSendAndSilenceHistoryV2PromptGuidance,
} from "@/lib/sms-no-send-and-silence-history-v2";
import type { OpenLoopsAndDoNotRepeatData } from "@/lib/sms-open-loops-and-do-not-repeat";
import type { RelationshipMemory7dData } from "@/lib/sms-relationship-memory-7d";
import type { RelationshipPacketStructuredRecentTruth } from "@/lib/sms-relationship-packet-v1";
import type { RecentExactThread72hMessage } from "@/lib/sms-recent-exact-thread-72h";
import {
  buildRelationshipSnapshotV2,
  buildRelationshipSnapshotV2PromptGuidance,
} from "@/lib/sms-relationship-snapshot-v2";
import { buildActivePendingStateFromCommitmentRow } from "@/lib/sms-active-pending-state";

const FORBIDDEN_WRITER_FACING_TERMS = [
  "Twilio",
  "final_guard",
  "final guard",
  "skipped_no_safe_v3_voice",
  "skip_source",
  "skip source",
  "no_send_reason",
  "unified_final_guard",
  "sms_send_events",
  "sms_weekly_send_events",
  "do_not_mention_twilio_or_final_guard",
  "do_not_explain_internal_no_send",
] as const;

const NOW_MS = Date.parse("2026-06-08T12:00:00.000Z");
const CALENDAR_ASK = "Did you put the family connection on the calendar for tomorrow?";
const UNDELIVERED_ASK = "What story will you dictate today?";

function makeMessage(
  partial: Partial<RecentExactThread72hMessage> & Pick<RecentExactThread72hMessage, "role" | "body">
): RecentExactThread72hMessage {
  return {
    at: "2026-06-07T12:00:00.000Z",
    at_local: "Jun 7, 7:00 AM",
    at_local_timezone: "America/Chicago",
    local_day_key: "2026-06-07",
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

function baseMemory7d(overrides?: Partial<RelationshipMemory7dData>): RelationshipMemory7dData {
  return {
    window_days: 7,
    built_at: "2026-06-08T12:00:00.000Z",
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
    ...overrides,
  };
}

function emptyOpenLoops(): OpenLoopsAndDoNotRepeatData {
  return {
    open_loops: [],
    satisfied_asks: [],
    do_not_repeat_asks: [],
    do_not_repeat_phrases: [],
    recent_unanswered_coach_questions: [],
  };
}

function build(args: Parameters<typeof buildNoSendAndSilenceHistoryV2>[0]) {
  return buildNoSendAndSilenceHistoryV2({ nowMs: NOW_MS, ...args });
}

describe("buildNoSendAndSilenceHistoryV2", () => {
  it("always emits no_send_and_silence_history", () => {
    const { section, meta } = build({
      surface: "inbound",
      messages: [],
      structuredRecentTruth: baseTruth(),
    });
    expect(section.authority).toBe("structured_recent_truth");
    expect(section.data.writer_guidance.do_not_explain_internal_message_failure).toBe(true);
    expect(meta.no_send_silence_history_emitted).toBe(true);
  });

  it("visible sent coach SMS sets last_visible_coach_sms_at", () => {
    const at = "2026-06-06T10:00:00.000Z";
    const { section } = build({
      surface: "inbound",
      messages: [makeMessage({ role: "coach", body: "How did it go?", at })],
      structuredRecentTruth: baseTruth(),
    });
    expect(section.data.last_visible_coach_sms_at).toBe(at);
  });

  it("no-send / system marker does NOT set last_visible_coach_sms_at", () => {
    const { section } = build({
      surface: "inbound",
      messages: [
        makeMessage({
          role: "system_no_send",
          body: "skipped_no_safe_v3_voice: unsafe",
          delivery_status: "skipped",
          at: "2026-06-07T10:00:00.000Z",
        }),
      ],
      structuredRecentTruth: baseTruth(),
    });
    expect(section.data.last_visible_coach_sms_at).toBeNull();
  });

  it("preview coach message does NOT set last_visible_coach_sms_at", () => {
    const { section } = build({
      surface: "inbound",
      messages: [
        makeMessage({
          role: "coach",
          body: CALENDAR_ASK,
          delivery_status: "preview",
          at: "2026-06-07T10:00:00.000Z",
        }),
      ],
      structuredRecentTruth: baseTruth(),
    });
    expect(section.data.last_visible_coach_sms_at).toBeNull();
  });

  it("user thread message sets last_user_reply_at", () => {
    const at = "2026-06-07T11:00:00.000Z";
    const { section } = build({
      surface: "inbound",
      messages: [makeMessage({ role: "user", body: "Yes I did it today", at })],
      structuredRecentTruth: baseTruth(),
    });
    expect(section.data.last_user_reply_at).toBe(at);
  });

  it("system_no_send does NOT set user reply", () => {
    const { section } = build({
      surface: "inbound",
      messages: [
        makeMessage({
          role: "system_no_send",
          body: "no_send_reason: final_guard",
          delivery_status: "cancelled",
        }),
      ],
      structuredRecentTruth: baseTruth(),
    });
    expect(section.data.last_user_reply_at).toBeNull();
  });

  it("memory 7d win/miss/partial sets last_user_outcome_at", () => {
    const winAt = "2026-06-05T08:00:00.000Z";
    const missAt = "2026-06-04T08:00:00.000Z";
    const { section } = build({
      surface: "daily",
      messages: [],
      structuredRecentTruth: baseTruth(),
      relationshipMemory7d: baseMemory7d({
        wins: [
          {
            summary: "yes",
            evidence: "yes",
            at: winAt,
            source: "event",
            message_sid: null,
            is_exact_body: true,
          },
        ],
        misses: [
          {
            summary: "no",
            evidence: "no",
            at: missAt,
            source: "event",
            message_sid: null,
            is_exact_body: true,
          },
        ],
      }),
    });
    expect(section.data.last_user_outcome_at).toBe(winAt);
  });

  it("silence_tier uses none/quiet/nudge", () => {
    const none = build({
      surface: "daily",
      messages: [],
      structuredRecentTruth: baseTruth(),
      relationshipMemory7d: baseMemory7d({ context_flags: { silence_tier: "none" } }),
    });
    expect(none.section.data.silence_context.silence_tier).toBe("none");

    const quiet = build({
      surface: "daily",
      messages: [],
      structuredRecentTruth: baseTruth(),
      relationshipMemory7d: baseMemory7d({ context_flags: { silence_tier: "quiet" } }),
    });
    expect(quiet.section.data.silence_context.silence_tier).toBe("quiet");

    const nudge = build({
      surface: "daily",
      messages: [],
      structuredRecentTruth: baseTruth(),
      relationshipMemory7d: baseMemory7d({ context_flags: { silence_tier: "nudge" } }),
    });
    expect(nudge.section.data.silence_context.silence_tier).toBe("nudge");
  });

  it("daily silence context maps when available", () => {
    const { section } = build({
      surface: "daily",
      messages: [],
      structuredRecentTruth: baseTruth(),
      relationshipMemory7d: baseMemory7d({
        context_flags: {
          silence_tier: "quiet",
          reentry_active: true,
          days_since_last_user_outcome: 5,
          unanswered_checks: 1,
        },
      }),
    });
    expect(section.data.silence_context.silence_tier).toBe("quiet");
    expect(section.data.silence_context.reentry_context).toBe(true);
    expect(section.data.silence_context.days_since_last_outcome).toBe(5);
  });

  it("weekly silent_week produces conservative tone hint", () => {
    const { section } = build({
      surface: "weekly",
      messages: [],
      structuredRecentTruth: baseTruth(),
      currentTurn: { silent_week: true },
    });
    expect(section.data.silence_context.weekly_silent_week).toBe(true);
    expect(section.data.silence_context.writer_tone_hint).toContain("low-pressure");
  });

  it("delivered unanswered question appears in delivery_truth.recent_questions_delivered_but_unanswered", () => {
    const { section } = build({
      surface: "inbound",
      messages: [
        makeMessage({ role: "coach", body: CALENDAR_ASK, at: "2026-06-07T09:00:00.000Z" }),
      ],
      structuredRecentTruth: baseTruth(),
    });
    expect(section.data.delivery_truth.recent_questions_delivered_but_unanswered).toContain(
      CALENDAR_ASK
    );
  });

  it("not-delivered question appears in delivery_truth.recent_questions_not_delivered", () => {
    const { section } = build({
      surface: "inbound",
      messages: [
        makeMessage({
          role: "coach",
          body: UNDELIVERED_ASK,
          delivery_status: "preview",
          at: "2026-06-07T09:00:00.000Z",
        }),
      ],
      structuredRecentTruth: baseTruth({
        open_question_pending: true,
        latest_open_question: UNDELIVERED_ASK,
      }),
    });
    expect(section.data.delivery_truth.recent_questions_not_delivered.length).toBeGreaterThan(0);
    expect(section.data.delivery_truth.recent_questions_not_delivered[0]).toContain("dictate");
  });

  it("not-delivered question does NOT appear in delivered_but_unanswered", () => {
    const { section } = build({
      surface: "inbound",
      messages: [
        makeMessage({
          role: "coach",
          body: UNDELIVERED_ASK,
          delivery_status: "preview",
        }),
      ],
      structuredRecentTruth: baseTruth({
        open_question_pending: true,
        latest_open_question: UNDELIVERED_ASK,
      }),
    });
    const unanswered = section.data.delivery_truth.recent_questions_delivered_but_unanswered;
    expect(unanswered.some((q) => q.includes("dictate"))).toBe(false);
  });

  it("satisfied ask is excluded from delivered_but_unanswered", () => {
    const { section } = build({
      surface: "inbound",
      messages: [
        makeMessage({ role: "coach", body: CALENDAR_ASK, at: "2026-06-07T09:00:00.000Z" }),
      ],
      structuredRecentTruth: baseTruth(),
      openLoopsAndDoNotRepeat: {
        ...emptyOpenLoops(),
        satisfied_asks: [
          {
            ask_text: CALENDAR_ASK,
            do_not_repeat: true,
            source: "turn_understanding",
          },
        ],
      },
    });
    expect(section.data.delivery_truth.recent_questions_delivered_but_unanswered).not.toContain(
      CALENDAR_ASK
    );
  });

  it("no-send/system markers do not become coach questions", () => {
    const { section } = build({
      surface: "inbound",
      messages: [
        makeMessage({
          role: "system_no_send",
          body: "Did you finish? [skipped]",
          delivery_status: "skipped",
        }),
      ],
      structuredRecentTruth: baseTruth({
        last_5_coach_questions: ["Did you finish?"],
        open_question_pending: true,
        latest_open_question: "Did you finish?",
      }),
    });
    const all = [
      ...section.data.delivery_truth.recent_questions_not_delivered,
      ...section.data.delivery_truth.recent_questions_delivered_but_unanswered,
    ];
    expect(all.some((q) => /finish/i.test(q))).toBe(true);
    expect(all.some((q) => /skipped/i.test(q))).toBe(false);
  });

  it("unsent drafts do not become delivered coach questions", () => {
    const { section } = build({
      surface: "inbound",
      messages: [
        makeMessage({
          role: "coach",
          body: CALENDAR_ASK,
          delivery_status: "preview",
        }),
      ],
      structuredRecentTruth: baseTruth(),
    });
    expect(section.data.delivery_truth.recent_questions_delivered_but_unanswered).toHaveLength(0);
  });

  it("writer_guidance uses product-safe keys and forbids internal explanation", () => {
    const { section } = build({
      surface: "inbound",
      messages: [],
      structuredRecentTruth: baseTruth(),
    });
    expect(section.data.writer_guidance.do_not_explain_internal_message_failure).toBe(true);
    expect(section.data.writer_guidance.do_not_discuss_internal_send_pipeline).toBe(true);
    expect(section.data.writer_guidance.use_only_for_tone_and_continuity).toBe(true);
    expect(section.data.writer_guidance).not.toHaveProperty("do_not_mention_twilio_or_final_guard");
    expect(section.data.writer_guidance).not.toHaveProperty("do_not_explain_internal_no_send");

    const guidanceJson = JSON.stringify(section.data.writer_guidance);
    for (const term of FORBIDDEN_WRITER_FACING_TERMS) {
      expect(guidanceJson).not.toContain(term);
    }
  });

  it("prompt guidance avoids internal operational vocabulary", () => {
    const guidance = buildNoSendAndSilenceHistoryV2PromptGuidance();
    for (const term of FORBIDDEN_WRITER_FACING_TERMS) {
      expect(guidance).not.toContain(term);
    }
    expect(guidance).toMatch(/tone and continuity/i);
    expect(guidance).toMatch(/internal delivery systems|message-generation failures/i);
    expect(guidance).toMatch(/do NOT imply the user ignored/i);
    expect(guidance).toMatch(/send safety separately/i);

    const snapshotGuidance = buildRelationshipSnapshotV2PromptGuidance();
    expect(snapshotGuidance).toContain("no_send_and_silence_history");
    const noSendBlock = guidance;
    for (const term of FORBIDDEN_WRITER_FACING_TERMS) {
      expect(noSendBlock).not.toContain(term);
    }
  });

  it("all surfaces include section via snapshot builder", () => {
    for (const surface of ["inbound", "daily", "weekly", "guided_contract"] as const) {
      const { snapshot } = buildRelationshipSnapshotV2({
        surface,
        activePendingState: buildActivePendingStateFromCommitmentRow(null),
        packet: {
          relationship_packet_version: "1.8",
          current_turn: { authority: "authoritative_current", data: { timezone: "America/Chicago" } },
          canonical_state: { authority: "server_state_authoritative", data: {} },
          structured_recent_truth: { authority: "structured_recent_truth", data: baseTruth() },
          recent_exact_thread_72h: {
            authority: "authoritative_recent_thread",
            data: {
              window_hours: 72,
              messages: [],
              message_count: 0,
              had_preview_messages: false,
              had_system_no_send: false,
            },
          },
          proof_victory_permission: {
            authority: "server_state_authoritative",
            data: {
              can_claim_proof: false,
              can_reference_victory_room: false,
              proof_moment_hints: [],
            },
          },
        } as never,
      });
      expect(snapshot.no_send_and_silence_history.authority).toBe("structured_recent_truth");
      expect(snapshot.no_send_and_silence_history.data.writer_guidance).toBeDefined();
    }
  });

  it("telemetry counts/tier exist", () => {
    const { meta } = build({
      surface: "daily",
      messages: [makeMessage({ role: "coach", body: CALENDAR_ASK })],
      structuredRecentTruth: baseTruth(),
      relationshipMemory7d: baseMemory7d({ context_flags: { silence_tier: "quiet" } }),
    });
    expect(meta.no_send_silence_history_emitted).toBe(true);
    expect(meta.silence_tier).toBe("quiet");
    expect(typeof meta.recent_questions_delivered_unanswered_count).toBe("number");
    expect(typeof meta.recent_questions_not_delivered_count).toBe("number");
  });

  it("telemetry does not include question bodies or internal reasons", () => {
    const { meta } = build({
      surface: "inbound",
      messages: [
        makeMessage({ role: "coach", body: CALENDAR_ASK }),
        makeMessage({
          role: "system_no_send",
          body: "skipped_no_safe_v3_voice",
          delivery_status: "skipped",
        }),
      ],
      structuredRecentTruth: baseTruth(),
    });
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain(CALENDAR_ASK);
    expect(serialized).not.toContain("skipped_no_safe_v3_voice");
    expect(serialized).not.toContain("final_guard");
  });

  it("budget caps delivery_truth arrays", () => {
    const questions = Array.from({ length: 6 }, (_, i) => `Did you complete task number ${i + 1}?`);
    const messages = questions.map((q, i) =>
      makeMessage({
        role: "coach",
        body: q,
        at: `2026-06-0${i + 1}T09:00:00.000Z`,
      })
    );
    const { section } = build({
      surface: "inbound",
      messages,
      structuredRecentTruth: baseTruth(),
    });
    expect(section.data.delivery_truth.recent_questions_delivered_but_unanswered.length).toBeLessThanOrEqual(
      MAX_DELIVERY_TRUTH_QUESTIONS
    );
    for (const q of section.data.delivery_truth.recent_questions_delivered_but_unanswered) {
      expect(q.length).toBeLessThanOrEqual(MAX_QUESTION_FINGERPRINT_CHARS);
    }
  });

  it("does not hard-code SMS copy in projector output", () => {
    const { section } = build({
      surface: "inbound",
      messages: [],
      structuredRecentTruth: baseTruth(),
    });
    const json = JSON.stringify(section);
    expect(json).not.toMatch(/Welcome back/i);
    expect(json).not.toMatch(/You're doing great/i);
  });

  it("does not expose internal status strings in section JSON", () => {
    const { section } = build({
      surface: "inbound",
      messages: [
        makeMessage({
          role: "system_no_send",
          body: "no_send_reason: final_guard blocked",
          delivery_status: "skipped",
        }),
      ],
      structuredRecentTruth: baseTruth(),
    });
    const json = JSON.stringify(section);
    expect(json).not.toContain("no_send_reason");
    expect(json).not.toContain("skipped_no_safe_v3_voice");
    expect(json).not.toMatch(/no_send_reason:\s*final_guard/i);
    for (const term of FORBIDDEN_WRITER_FACING_TERMS) {
      expect(json).not.toContain(term);
    }
  });
});
