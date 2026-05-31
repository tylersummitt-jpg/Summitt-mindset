import { describe, expect, it } from "vitest";

import {
  buildRelationshipMemory7d,
  RELATIONSHIP_MEMORY_7D_WINDOW_DAYS,
  trimRelationshipMemory7dData,
} from "@/lib/sms-relationship-memory-7d";
import type { V2EventRowForAi } from "@/lib/v2-commitment";
import type { V2CommitmentSmsThreadMemory } from "@/lib/v2-commitment-sms-thread-memory";

const NOW = new Date("2026-05-18T12:00:00.000Z");

function event(
  event_type: string,
  occurred_at: string,
  payload_json: Record<string, unknown> = {}
): V2EventRowForAi {
  return { event_type, occurred_at, payload_json };
}

describe("buildRelationshipMemory7d", () => {
  it("extracts user_yes, user_no, user_partial, blocker_captured inside 7 days", () => {
    const result = buildRelationshipMemory7d({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
      now: NOW,
      preloadedEvents: [
        event("user_yes", "2026-05-18T10:00:00.000Z", { message: "Done all two hours" }),
        event("user_no", "2026-05-17T10:00:00.000Z", { message: "Missed today" }),
        event("user_partial", "2026-05-16T10:00:00.000Z", { message: "Only one hour" }),
        event("blocker_captured", "2026-05-15T10:00:00.000Z", { message: "Meetings all day" }),
      ],
    });

    expect(result.window_days).toBe(RELATIONSHIP_MEMORY_7D_WINDOW_DAYS);
    expect(result.outcome_counts.yes).toBe(1);
    expect(result.outcome_counts.no).toBe(1);
    expect(result.outcome_counts.partial).toBe(1);
    expect(result.outcome_counts.blockers).toBe(1);
    expect(result.wins[0]?.evidence).toContain("Done all two hours");
    expect(result.misses[0]?.source).toBe("v2_commitment_event:user_no");
    expect(result.partials[0]?.summary).toBe("user_partial");
    expect(result.blockers[0]?.is_exact_body).toBe(true);
  });

  it("excludes events older than 7 days", () => {
    const result = buildRelationshipMemory7d({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
      now: NOW,
      preloadedEvents: [
        event("user_yes", "2026-05-01T10:00:00.000Z"),
        event("user_yes", "2026-05-17T10:00:00.000Z"),
      ],
    });

    expect(result.outcome_counts.yes).toBe(1);
    expect(result.wins).toHaveLength(1);
  });

  it("includes proof_moments only when payload.proof_moment === true", () => {
    const withProof = buildRelationshipMemory7d({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
      now: NOW,
      preloadedEvents: [
        event("user_yes", "2026-05-18T10:00:00.000Z", {
          proof_moment: true,
          proof_moment_type: "first_completion",
        }),
        event("user_no", "2026-05-17T10:00:00.000Z", { proof_moment: false }),
      ],
    });

    expect(withProof.proof_moments).toHaveLength(1);
    expect(withProof.proof_moments[0]?.proof_type).toBe("first_completion");
    expect(withProof.proof_moments[0]?.is_exact_body).toBe(false);
  });

  it("detects comeback when miss/partial is followed by later yes", () => {
    const result = buildRelationshipMemory7d({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
      now: NOW,
      preloadedEvents: [
        event("user_no", "2026-05-17T09:00:00.000Z"),
        event("user_yes", "2026-05-18T10:00:00.000Z"),
      ],
    });

    expect(result.comebacks).toHaveLength(1);
    expect(result.comebacks[0]?.summary).toBe("comeback_after_miss_or_partial");
    expect(result.comebacks[0]?.evidence).toContain("user_no");
  });

  it("builds Q/A pairs from projection with message_sid and source", () => {
    const projection: V2CommitmentSmsThreadMemory = {
      commitment_id: "cmt_1",
      clerk_user_id: "user_1",
      projection_version: 1,
      last_outbound_full_body: null,
      last_outbound_sent_at: null,
      last_outbound_source: null,
      last_outbound_message_sid: null,
      last_inbound_full_body: null,
      last_inbound_at: null,
      last_inbound_message_sid: null,
      last_5_coach_questions: [
        {
          text: "Did you stretch at lunch?",
          asked_at: "2026-05-18T11:00:00.000Z",
          source: "inbound_coach_reply",
          message_sid: "SM_Q1",
        },
      ],
      last_5_user_answers: [
        {
          text: "Yes, five minutes at lunch",
          answered_at: "2026-05-18T11:05:00.000Z",
          source: "sms_inbound_coach_jobs",
          message_sid: "SM_A1",
        },
      ],
      open_question_text: null,
      open_question_asked_at: null,
      open_question_expected_answer_type: "coach_yes_no",
      open_question_source_message_sid: null,
      open_question_answer_text: null,
      open_question_answered_at: null,
      open_question_pending: false,
      do_not_repeat_phrases: [],
      recent_frustration_corrections: [],
      current_live_thread_summary: null,
      last_recomputed_from_spine_at: null,
      created_at: "2026-05-18T10:00:00.000Z",
      updated_at: "2026-05-18T11:05:00.000Z",
    };

    const result = buildRelationshipMemory7d({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
      now: NOW,
      preloadedEvents: [],
      preloadedProjection: projection,
    });

    expect(result.direct_answer_history).toHaveLength(1);
    expect(result.direct_answer_history[0]?.source).toBe("v2_commitment_sms_thread_memory");
    expect(result.direct_answer_history[0]?.message_sid).toBe("SM_A1");
    expect(result.direct_answer_history[0]?.user_answer).toContain("lunch");
  });

  it("requires evidence, source, and timestamp on every item", () => {
    const result = buildRelationshipMemory7d({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
      now: NOW,
      preloadedEvents: [
        event("user_yes", "2026-05-18T10:00:00.000Z", { message: "Yes" }),
        event("blocker_captured", "2026-05-17T10:00:00.000Z", { message: "Too busy" }),
        event("user_yes", "2026-05-16T10:00:00.000Z", {
          proof_moment: true,
          proof_moment_type: "streak_continued",
        }),
      ],
    });

    const allItems = [
      ...result.wins,
      ...result.misses,
      ...result.partials,
      ...result.comebacks,
      ...result.blockers,
    ];
    for (const item of allItems) {
      expect(item.evidence).toBeTruthy();
      expect(item.source).toBeTruthy();
      expect(item.at).toBeTruthy();
    }
    for (const p of result.proof_moments) {
      expect(p.evidence).toBeTruthy();
      expect(p.source).toBeTruthy();
      expect(p.at).toBeTruthy();
    }
  });

  it("does not include coaching_summary prose", () => {
    const result = buildRelationshipMemory7d({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
      now: NOW,
      preloadedEvents: [event("user_yes", "2026-05-18T10:00:00.000Z")],
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain("coaching_summary");
    expect(json).not.toContain("NON-AUTHORITATIVE prose");
  });

  it("merges dailyContextFlags into context_flags", () => {
    const result = buildRelationshipMemory7d({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
      now: NOW,
      preloadedEvents: [],
      dailyContextFlags: {
        reentry_active: true,
        silence_tier: "quiet",
        unanswered_checks: 2,
      },
    });

    expect(result.context_flags.reentry_active).toBe(true);
    expect(result.context_flags.silence_tier).toBe("quiet");
    expect(result.context_flags.unanswered_checks).toBe(2);
  });
});

describe("trimRelationshipMemory7dData", () => {
  it("preserves outcome_counts while trimming categories", () => {
    const base = buildRelationshipMemory7d({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
      now: NOW,
      preloadedEvents: Array.from({ length: 6 }, (_, i) =>
        event("user_yes", new Date(NOW.getTime() - i * 60_000).toISOString(), {
          message: `Win number ${i} with extra padding ${"x".repeat(80)}`,
        })
      ),
    });

    const { data, truncated } = trimRelationshipMemory7dData(base, 200);
    expect(truncated).toBe(true);
    expect(data.outcome_counts.yes).toBe(base.outcome_counts.yes);
    expect(data.wins.length).toBeLessThan(base.wins.length);
  });
});
