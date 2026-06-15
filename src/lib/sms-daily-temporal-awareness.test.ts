import { describe, expect, it } from "vitest";

import {
  buildRecentThreadTimelineSummary72h,
  deriveDailyTemporalAwarenessSummary,
  deriveLocalDayRelation,
} from "@/lib/sms-daily-temporal-awareness";
import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";
import type { RecentExactThread72hMessage } from "@/lib/sms-recent-exact-thread-72h";

function minimalDailyFacts(
  overrides?: Partial<DailyV3RelationshipFacts>
): DailyV3RelationshipFacts {
  return {
    route_kind: "main_active_accountability",
    accountability_day_key: "2026-06-15",
    user: {
      clerk_user_id: "u1",
      preferred_name: "Alex",
      timezone: "America/New_York",
      local_time_iso: "2026-06-15T06:01:00-04:00",
      relationship_profile_summary: null,
    },
    commitment: {
      id: "c1",
      title: "Stay active",
      behavior_statement: "Stay active daily",
      effective_ask: "Stay active daily",
      accountability_phase: "active_accountability",
      identity_anchor_allowed: false,
      identity_anchor_short: null,
    },
    thread_memory: {
      latest_outbound_sms: null,
      latest_inbound_sms: null,
      recent_transcript_or_context_block: null,
      latest_open_question: null,
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
      days_since_last_user_outcome: 0,
      reentry_active: false,
      overlay_active: false,
      evolution_pattern_hint: null,
      contract_proposal_mode: false,
    },
    suggested_coaching_move: "recover_today",
    constraints: {
      max_chars: 300,
      one_sms: true,
      no_raw_title_or_behavior_paste: true,
      no_generic_motivation: true,
      if_unsafe_return_no_send: true,
    },
    ...overrides,
  };
}

function threadMessage(
  overrides: Partial<RecentExactThread72hMessage> & Pick<RecentExactThread72hMessage, "role" | "body">
): RecentExactThread72hMessage {
  return {
    at: "2026-06-14T09:00:00.000Z",
    at_local: "2026-06-14 09:00 America/New_York",
    at_local_timezone: "America/New_York",
    local_day_key: "2026-06-14",
    message_kind: "coach",
    source_table: "sms_send_events",
    message_sid: "SM1",
    delivery_status: "sent",
    is_exact_body: true,
    ...overrides,
  };
}

describe("deriveLocalDayRelation", () => {
  it("maps day keys relative to accountability day", () => {
    expect(deriveLocalDayRelation("2026-06-15", "2026-06-15")).toBe("today");
    expect(deriveLocalDayRelation("2026-06-14", "2026-06-15")).toBe("yesterday");
    expect(deriveLocalDayRelation("2026-06-13", "2026-06-15")).toBe("2_days_ago");
  });
});

describe("deriveDailyTemporalAwarenessSummary", () => {
  it("marks no current-day outcome when yesterday miss only", () => {
    const summary = deriveDailyTemporalAwarenessSummary({
      facts: minimalDailyFacts({
        accountability: {
          ...minimalDailyFacts().accountability,
          prior_outcome: "user_no",
          days_since_last_user_outcome: 1,
        },
        thread_memory: {
          ...minimalDailyFacts().thread_memory,
          relationship_memory_7d: {
            window_days: 7,
            wins: [],
            misses: [
              {
                summary: "miss",
                evidence: "no",
                at: "2026-06-14T20:00:00.000Z",
                local_day_key: "2026-06-14",
                source: "user_no",
                message_sid: null,
                is_exact_body: true,
              },
            ],
            partials: [],
            blockers: [],
            proof_moments: [],
            open_loops: [],
            qa_pairs: [],
            outcome_counts: { yes: 0, no: 1, partial: 0 },
            context_flags: {},
          },
        },
      }),
    });
    expect(summary.current_day_outcome_status).toBe("none_recorded");
    expect(summary.can_imply_today_missed).toBe(false);
    expect(summary.last_outcome_type).toBe("user_no");
    expect(summary.last_outcome_day_relation).toBe("yesterday");
  });

  it("marks current-day miss when memory7d miss day matches accountability day", () => {
    const summary = deriveDailyTemporalAwarenessSummary({
      facts: minimalDailyFacts({
        accountability: {
          ...minimalDailyFacts().accountability,
          prior_outcome: "user_no",
          days_since_last_user_outcome: 0,
        },
        thread_memory: {
          ...minimalDailyFacts().thread_memory,
          relationship_memory_7d: {
            window_days: 7,
            wins: [],
            misses: [
              {
                summary: "miss",
                evidence: "no",
                at: "2026-06-15T20:00:00.000Z",
                local_day_key: "2026-06-15",
                source: "user_no",
                message_sid: null,
                is_exact_body: true,
              },
            ],
            partials: [],
            blockers: [],
            proof_moments: [],
            open_loops: [],
            qa_pairs: [],
            outcome_counts: { yes: 0, no: 1, partial: 0 },
            context_flags: {},
          },
        },
      }),
    });
    expect(summary.current_day_outcome_status).toBe("missed");
    expect(summary.can_imply_today_missed).toBe(true);
  });
});

describe("buildRecentThreadTimelineSummary72h", () => {
  it("returns chronological coach/user previews with local day relation", () => {
    const timeline = buildRecentThreadTimelineSummary72h({
      accountabilityDayKey: "2026-06-15",
      messages: [
        threadMessage({
          role: "coach",
          body: "How did yesterday go?",
          at: "2026-06-14T13:00:00.000Z",
          local_day_key: "2026-06-14",
          at_local: "2026-06-14 09:00 America/New_York",
        }),
        threadMessage({
          role: "user",
          body: "Meetings ran long.",
          at: "2026-06-14T14:00:00.000Z",
          local_day_key: "2026-06-14",
          at_local: "2026-06-14 10:00 America/New_York",
        }),
      ],
    });
    expect(timeline).toHaveLength(2);
    expect(timeline[0]!.role).toBe("coach");
    expect(timeline[0]!.local_day_relation).toBe("yesterday");
    expect(timeline[1]!.role).toBe("user");
    expect(timeline[1]!.local_time).toBe("10:00");
  });
});
