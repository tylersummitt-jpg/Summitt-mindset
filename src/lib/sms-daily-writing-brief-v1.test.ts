import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import type { StrategyCardV1 } from "@/lib/coaching-strategy-card-v1";
import { buildSuggestedMoveFromDailyC1Card } from "@/lib/coaching-strategy-card-v1";
import { deriveDailyProofCalibration } from "@/lib/sms-daily-proof-calibration";
import { deriveFreshnessAvoidPhrasesForBrief } from "@/lib/sms-daily-fresh-move";
import type { RecentExactThread72hMessage } from "@/lib/sms-recent-exact-thread-72h";
import {
  applyCoachingSituationConflicts,
  buildCoachingSituationForBrief,
  buildDailySmsWritingBriefV1,
  buildDailySmsWriterMessagesFromBrief,
  buildCompactTimingCopyGuidanceForBrief,
  buildDailySmsBriefSystemPrompt,
  buildDurableRelationshipMemoryForBrief,
  buildFreshnessAvoidPhrasesPreview,
  buildRelationshipAnchorsForBrief,
  dailyWritingBriefExtendedTelemetry,
  dailyWritingBriefTelemetry,
  deriveDailyWritingBriefFallbackTelemetry,
  deriveLocalDaypartForBrief,
  detectFitOrCorrectionConflictFromAssembledSemantics,
  EVENING_SLOT_WRITER_LINE,
  FIRST_TEXT_STYLE_MICROGUIDE_V1,
  MORNING_SLOT_WRITER_LINE,
  neutralizeBriefSuggestedMoveReasonForWriter,
  resolveWriterFacingDaypartForBrief,
  useDailySmsWritingBriefV1,
} from "@/lib/sms-daily-writing-brief-v1";
import {
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";
import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";
import { deriveTimingAnchorMemory } from "@/lib/timing-anchor-memory";

function baseFacts(overrides?: Partial<DailyV3RelationshipFacts>): DailyV3RelationshipFacts {
  return {
    route_kind: "main_active_accountability",
    accountability_day_key: "2026-06-20",
    user: {
      clerk_user_id: "user_test",
      preferred_name: "Tyler",
      timezone: "America/Chicago",
      local_time_iso: "2026-06-20T14:00:00.000Z",
      relationship_profile_summary: null,
    },
    commitment: {
      id: "cmt_1",
      title: "Distribution",
      behavior_statement: "One hour of distribution",
      effective_ask: "One hour of distribution",
      accountability_phase: "active_accountability",
      identity_anchor_allowed: true,
      identity_anchor_short: "I protect focused distribution time.",
    },
    thread_memory: {
      latest_outbound_sms: null,
      latest_inbound_sms: null,
      recent_transcript_or_context_block: null,
      latest_open_question: null,
      do_not_repeat_hints: [],
      coaching_memory_snippet: "User has shown commitment recently.",
      recent_pattern_hints: null,
      recent_coach_body_do_not_repeat: [
        {
          body: "Aim for one hour of distribution today.",
          body_preview: "Aim for one hour of distribution today.",
          sent_at: "2026-06-17T13:00:00.000Z",
          at_local: "Thu Jun 17 8:00 AM",
          source_table: "sms_send_events",
          role: "coach",
        },
      ],
      relationship_memory_7d: {
        window_days: 7,
        built_at: "2026-06-20T12:00:00.000Z",
        outcome_counts: { yes: 2, no: 1, partial: 0, blockers: 0, checks_sent: 3 },
        wins: [],
        misses: [],
        partials: [],
        comebacks: [],
        blockers: [],
        proof_moments: [],
        open_loops: [],
        direct_answer_history: [],
        context_flags: { days_since_last_user_outcome: 3 },
        meta: { item_count: 0, sources_used: ["test"] },
      } as never,
    },
    accountability: {
      daily_purpose: "standard_accountability_check",
      server_strategy: "standard_check",
      next_move_type: "hold_standard",
      prior_outcome: "user_yes",
      yes_streak_14d: 0,
      no_count_14d: 1,
      partial_count_14d: 0,
      blocker_preview: null,
      proof_or_milestone_signal: null,
      silence_tier: "none",
      unanswered_checks: 0,
      days_since_last_user_outcome: 3,
      reentry_active: false,
      overlay_active: false,
      evolution_pattern_hint: null,
      contract_proposal_mode: false,
    },
    suggested_coaching_move: "hold_standard",
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

function minimalCard(): StrategyCardV1 {
  return {
    version: "1.0",
    generated_at: "2026-06-20T12:00:00.000Z",
    surface: "daily",
    route_kind: "main_active_accountability",
    turn_kind: "daily_outbound",
    server_truth_summary: {
      outcome: "none",
      explicit_user_truth: false,
      active_pending_kinds: [],
      satisfied_ask_fingerprints: [],
      is_new_accountability_day: true,
    },
    move: {
      type: "hold_standard",
      priority: "normal",
      confidence: "medium",
      reason: "Weak stale proof — one honest rep today.",
    },
    must_do: [],
    must_not_do: ["Do not repeat prior CTA verbatim"],
    allowed_claims: {
      completion: false,
      miss: true,
      partial: true,
      proof: true,
      victory_room: false,
      state_changed: false,
      proposal_active: false,
    },
    writer_constraints: {
      max_questions: 1,
      avoid_repeating: [],
      tone_posture: "direct_accountability",
    },
    meta: { generation_source: "server_strategy_card_v1" },
  } as StrategyCardV1;
}

describe("useDailySmsWritingBriefV1", () => {
  it("true for main_active_accountability", () => {
    expect(useDailySmsWritingBriefV1(baseFacts())).toBe(true);
  });

  it("true for low_pressure_reactivation", () => {
    expect(useDailySmsWritingBriefV1(baseFacts({ route_kind: "low_pressure_reactivation" }))).toBe(
      true
    );
  });

  it("false for contract_prompt", () => {
    expect(
      useDailySmsWritingBriefV1(
        baseFacts({
          route_kind: "contract_prompt",
          contract_proposal: {
            contract_kind: "shrink_ask",
            required_reply_semantics: "yes_no_binding_only",
            semantic_daily_contract_v1: true,
            daily_contract_semantic_facts: {
              proposed_bar_text: "Walk 10 min",
              proposal_kind: "shrink_ask",
              consent_required: true,
            },
          },
          accountability: { ...baseFacts().accountability, contract_proposal_mode: true },
        })
      )
    ).toBe(false);
  });

  it("false for pending_resolution", () => {
    expect(
      useDailySmsWritingBriefV1(
        baseFacts({
          route_kind: "pending_resolution",
          pending_resolution: {
            resolution_kind: "goal_change",
            expires_at: null,
            payload_source: "test",
            sms_state: "pending",
            detected_intent: "goal_change",
            candidate_behavior_snippet: "30 min distribution",
            awaiting_user_confirmation: true,
          },
        })
      )
    ).toBe(false);
  });

  it("false for refresh_identity", () => {
    expect(
      useDailySmsWritingBriefV1(
        baseFacts({
          route_kind: "refresh_identity",
          refresh: { refresh_step: "identity_first", identity_anchor_text: "I am focused" },
        })
      )
    ).toBe(false);
  });

  it("false when required_verbatim_substrings exist", () => {
    expect(
      useDailySmsWritingBriefV1(
        baseFacts({
          constraints: {
            ...baseFacts().constraints,
            required_verbatim_substrings: ["NEEDLE"],
          },
        })
      )
    ).toBe(false);
  });
});

describe("buildDailySmsWritingBriefV1", () => {
  it("includes compact silence_cadence without silence_note", () => {
    const facts = baseFacts({
      silence_cadence: {
        route: "soft_reentry_day3",
        silence_day: 3,
        send_today: true,
        no_send_reason: null,
      },
    });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: deriveDailyProofCalibration({ facts }),
      strategy_card: minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages: [],
        message_count: 0,
        char_count: 0,
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases: [],
    });

    expect(brief.silence_cadence).toEqual({
      route: "soft_reentry_day3",
      silence_day: 3,
      send_today: true,
    });
    expect((brief.authoritative_truth as Record<string, unknown>).silence_note).toBeUndefined();

    const writer = buildDailySmsWriterMessagesFromBrief(brief);
    expect(writer.system).toMatch(/When silence_cadence route card is present/i);
    expect(writer.system).toContain("soft_reentry_day3");
    expect(writer.user).toContain('"silence_cadence"');
    expect(writer.user).not.toContain("silence_note");
  });

  it("folds weak proof into authoritative_truth and writer prompt shape", () => {
    const facts = baseFacts();
    const cal = deriveDailyProofCalibration({ facts });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages: [
          {
            at_local: "Thu Jun 17 8:02 AM",
            role: "coach",
            body: "Aim for one hour of distribution today.",
          },
        ],
        message_count: 1,
        char_count: 40,
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases: deriveFreshnessAvoidPhrasesForBrief(
        facts.thread_memory.recent_coach_body_do_not_repeat
      ),
    });

    expect(cal.praise_allowed_level).toBe("capability_only");
    expect(brief.authoritative_truth.proof.strong_commitment_claim_allowed).toBe(false);
    expect(brief.freshness.avoid_phrases.length).toBeLessThanOrEqual(3);
    expect(
      brief.freshness.avoid_phrases.some((p) => /one hour of distribution/i.test(p.phrase))
    ).toBe(true);

    const writer = buildDailySmsWriterMessagesFromBrief(brief);
    expect(writer.user).toContain("DAILY_SMS_WRITING_BRIEF_V1");
    expect(writer.user).not.toContain("RELATIONSHIP_PACKET_V1");
    expect(writer.user).not.toContain("RELATIONSHIP_SNAPSHOT_V2");
    expect(writer.user).not.toContain("STRATEGY_CARD_V1");
    expect(writer.system).not.toContain("RELATIONSHIP_PACKET_AUTHORITY");
    expect(writer.system).not.toContain("DAILY PROOF CALIBRATION");
    expect(brief.suggested_move.subordinate_to).toEqual([
      "authoritative_truth",
      "recent_exact_thread",
    ]);
    expect(brief.suggested_move.must_not_do.length).toBeLessThanOrEqual(3);
  });

  it("freshness catches timer or gentle sound", () => {
    const phrases = deriveFreshnessAvoidPhrasesForBrief([
      {
        body: "Try using a timer or gentle sound when you start.",
        body_preview: "Try using a timer or gentle sound when you start.",
        sent_at: "2026-06-19T12:00:00.000Z",
        at_local: "Fri Jun 19 7:30 AM",
        source_table: "sms_send_events",
        role: "coach",
      },
    ]);
    expect(phrases.some((p) => /timer|gentle sound/i.test(p.phrase))).toBe(true);
    expect(phrases.length).toBeLessThanOrEqual(3);
  });

  it("preserves important people in durable memory when anchors are empty", () => {
    const facts = baseFacts({
      relationship_anchor_sources: {
        important_people: [
          {
            display_name: "Callie",
            relationship_type: "spouse",
            source: "onboarding",
          },
        ],
        people_summary: null,
      },
    });
    const cal = deriveDailyProofCalibration({ facts });
    const durable = buildDurableRelationshipMemoryForBrief({ facts, calibration: cal });
    expect(durable.items.some((i) => /Callie/i.test(i.text))).toBe(true);
    expect(durable.authority).toBe("background_only");
  });

  it("omits durable person items when relationship_anchors carries people", () => {
    const facts = baseFacts({
      relationship_anchor_sources: {
        important_people: [
          {
            display_name: "Callie",
            relationship_type: "spouse",
            source: "onboarding",
          },
        ],
        people_summary: null,
      },
    });
    const cal = deriveDailyProofCalibration({ facts });
    const durable = buildDurableRelationshipMemoryForBrief({
      facts,
      calibration: cal,
      suppressPersonItems: true,
    });
    expect(durable.items.some((i) => i.kind === "person")).toBe(false);
    expect(durable.items.some((i) => /Callie/i.test(i.text))).toBe(false);
  });

  it("excludes shown commitment coaching snippet from durable memory", () => {
    const facts = baseFacts({
      thread_memory: {
        ...baseFacts().thread_memory,
        coaching_memory_snippet: "User has shown great commitment recently.",
      },
    });
    const cal = deriveDailyProofCalibration({ facts });
    const durable = buildDurableRelationshipMemoryForBrief({ facts, calibration: cal });
    expect(JSON.stringify(durable)).not.toMatch(/shown commitment/i);
  });
});

describe("buildSuggestedMoveFromDailyC1Card", () => {
  it("adds calibration must_not_do for weak proof", () => {
    const facts = baseFacts();
    const cal = deriveDailyProofCalibration({ facts });
    const move = buildSuggestedMoveFromDailyC1Card(minimalCard(), cal);
    expect(move.must_not_do.some((l) => /great commitment/i.test(l))).toBe(true);
    expect(move.subordinate_to).toContain("authoritative_truth");
  });
});

describe("compact timing guidance for brief", () => {
  it("morning brief includes outcome-too-early guidance", () => {
    const facts = baseFacts({
      user: {
        ...baseFacts().user,
        timezone: "America/Chicago",
        local_time_iso: "2026-06-20T13:00:00.000Z",
      },
    });
    const cal = deriveDailyProofCalibration({ facts });
    expect(deriveLocalDaypartForBrief({
      timezone: facts.user.timezone,
      localTimeIso: facts.user.local_time_iso,
    })).toBe("morning");
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages: [],
        message_count: 0,
        char_count: 0,
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases: [],
    });
    expect(brief.authoritative_truth.local.local_daypart).toBe("morning");
    expect(brief.authoritative_truth.local.timing_copy_guidance?.some((g) =>
      /Morning send/i.test(g)
    )).toBe(true);
    const writer = buildDailySmsWriterMessagesFromBrief(brief);
    expect(writer.system).not.toContain("TIMING ANCHOR CONFIDENCE");
  });

  it("evening brief includes stale plan-today guidance", () => {
    const facts = baseFacts({
      user: {
        ...baseFacts().user,
        timezone: "America/Chicago",
        local_time_iso: "2026-06-20T01:00:00.000Z",
      },
    });
    const cal = deriveDailyProofCalibration({ facts });
    const guidance = buildCompactTimingCopyGuidanceForBrief({ facts, proofCalibration: cal });
    expect(deriveLocalDaypartForBrief({
      timezone: facts.user.timezone,
      localTimeIso: facts.user.local_time_iso,
    })).toBe("evening");
    expect(guidance.some((g) => /Evening send/i.test(g))).toBe(true);
    expect(guidance.length).toBeLessThanOrEqual(2);
  });

  it("weak stale proof adds recently-completed forbid guidance", () => {
    const facts = baseFacts();
    const cal = deriveDailyProofCalibration({ facts });
    const guidance = buildCompactTimingCopyGuidanceForBrief({ facts, proofCalibration: cal });
    expect(cal.praise_allowed_level).toBe("capability_only");
    expect(guidance.some((g) => /recently completed|Last proof was/i.test(g))).toBe(true);
  });

  it("mentioned_once timing anchor is compact in open_loops and guidance", () => {
    const pending = {
      active: true as const,
      plan_summary_hint: "distribution after workout",
      anchor_phrase_hint: "after Brooke's workout",
      anchor_key: "brooke|workout",
      plan_for_day_key: "2026-06-17",
      source_answer_preview: "I'll do it after Brooke gets back from her workout.",
      recurrence_confidence: "unknown" as const,
      outcome_known: false as const,
    };
    const timing = deriveTimingAnchorMemory({
      latestAnswerAfterOpenQuestion: pending.source_answer_preview,
      pendingPlanProof: pending,
    });
    const facts = baseFacts({
      user: {
        ...baseFacts().user,
        timezone: "America/Chicago",
        local_time_iso: "2026-06-20T19:00:00.000Z",
      },
      thread_memory: {
        ...baseFacts().thread_memory,
        relationship_memory_7d: {
          window_days: 7,
          built_at: "2026-06-20T12:00:00.000Z",
          outcome_counts: { yes: 0, no: 0, partial: 0, blockers: 0, checks_sent: 0 },
          wins: [],
          misses: [],
          partials: [],
          comebacks: [],
          blockers: [],
          proof_moments: [],
          open_loops: [],
          direct_answer_history: [],
          context_flags: { days_since_last_user_outcome: 0 },
          meta: { item_count: 0, sources_used: ["test"] },
        } as never,
      },
      accountability: {
        ...baseFacts().accountability,
        pending_plan_proof: pending,
        timing_anchor_memory: timing,
        prior_outcome: null,
        days_since_last_user_outcome: 0,
      },
    });
    const cal = deriveDailyProofCalibration({ facts });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages: [],
        message_count: 0,
        char_count: 0,
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases: [],
    });
    expect(brief.open_loops.timing_anchor?.confidence_level).toBe("mentioned_once");
    expect(
      brief.authoritative_truth.local.timing_copy_guidance?.some((g) =>
        /mentioned once|tentative wording/i.test(g)
      ) ??
        brief.open_loops.timing_anchor?.anchor_phrase_hint?.includes("Brooke")
    ).toBe(true);
  });

  it("observability: build status used and suggested_move summary capped", () => {
    const facts = baseFacts();
    const cal = deriveDailyProofCalibration({ facts });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages: [
          { role: "coach", body: "Prior coach line.", at_local: "Jun 17 8:00 AM" },
        ],
        message_count: 1,
        char_count: 20,
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases: deriveFreshnessAvoidPhrasesForBrief(
        facts.thread_memory.recent_coach_body_do_not_repeat
      ),
    });
    const threadWindow = {
      daily_brief_thread_floor_message_count: 1,
      daily_brief_thread_extension_message_count: 0,
      daily_brief_thread_oldest_at_local: "Jun 17 8:00 AM",
      daily_brief_thread_newest_at_local: "Jun 17 8:00 AM",
    };
    const telemetry = dailyWritingBriefTelemetry({
      brief,
      writer_system_chars: 900,
      writer_payload_chars: 5000,
      writer_total_chars: 5900,
      threadWindow,
    });
    expect(telemetry.daily_writing_brief_build_status).toBe("used");
    expect(typeof telemetry.daily_suggested_move).toBe("string");
    expect(typeof telemetry.daily_suggested_posture).toBe("string");
    expect(telemetry.daily_suggested_max_questions).toBeDefined();
    expect(JSON.stringify(telemetry)).not.toMatch(/must_not_do":\s*\[/);
  });

  it("observability: legacy fallback includes skip_reason for required_verbatim", () => {
    const facts = baseFacts({
      constraints: { required_verbatim_substrings: ["binding anchor text"] },
    });
    const fallback = deriveDailyWritingBriefFallbackTelemetry({
      facts,
      validatedDailyC1Card: null,
      briefThread: null,
      hasProofCalibration: false,
    });
    expect(fallback.daily_writing_brief_build_status).toBe("skipped_required_verbatim");
    expect(fallback.daily_writing_brief_skip_reason).toBe("skipped_required_verbatim");
  });

  it("observability: freshness preview is pipe-separated and excludes user inbound", () => {
    const coachOnly = deriveFreshnessAvoidPhrasesForBrief([
      {
        body: "Aim for one hour of distribution today.",
        body_preview: "Aim for one hour of distribution today.",
        sent_at: "2026-06-17T13:00:00.000Z",
        at_local: "Thu Jun 17 8:00 AM",
        source_table: "sms_send_events",
        role: "coach",
      },
    ]);
    const preview = buildFreshnessAvoidPhrasesPreview(coachOnly);
    expect(preview).toContain("distribution");
    expect(preview).not.toMatch(/user secret inbound/i);
    const fromUserBodies = deriveFreshnessAvoidPhrasesForBrief([
      {
        body: "user secret inbound reply text",
        body_preview: "user secret inbound reply text",
        sent_at: "2026-06-18T13:00:00.000Z",
        at_local: "Fri Jun 18 8:00 AM",
        source_table: "sms_inbound_messages",
        role: "user",
      },
    ]);
    expect(fromUserBodies).toHaveLength(0);
  });

  it("observability: thread window gauges exported via telemetry", () => {
    const facts = baseFacts();
    const cal = deriveDailyProofCalibration({ facts });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages: [
          { role: "coach", body: "Recent floor coach line.", at_local: "Jun 19 9:00 AM" },
        ],
        message_count: 2,
        char_count: 120,
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases: [],
    });
    const telemetry = dailyWritingBriefTelemetry({
      brief,
      writer_system_chars: 900,
      writer_payload_chars: 5000,
      writer_total_chars: 5900,
      threadWindow: {
        daily_brief_thread_floor_message_count: 1,
        daily_brief_thread_extension_message_count: 1,
        daily_brief_thread_oldest_at_local: "Jun 10 9:00 AM",
        daily_brief_thread_newest_at_local: "Jun 19 9:00 AM",
      },
    });
    expect(telemetry.daily_brief_thread_floor_message_count).toBe(1);
    expect(telemetry.daily_brief_thread_extension_message_count).toBe(1);
    expect(telemetry.daily_brief_thread_oldest_at_local).toBe("Jun 10 9:00 AM");
    expect(telemetry.daily_brief_thread_newest_at_local).toBe("Jun 19 9:00 AM");
  });

  it("observability: thread build counts exported without raw bodies", () => {
    const facts = baseFacts();
    const cal = deriveDailyProofCalibration({ facts });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages: [{ role: "coach", body: "Recent coach.", at_local: "Jun 19 9:00 AM" }],
        message_count: 1,
        char_count: 13,
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
        build_telemetry: {
          daily_brief_thread_source_candidate_count: 3,
          daily_brief_thread_visible_send_candidate_count: 2,
          daily_brief_thread_user_inbound_candidate_count: 1,
          daily_brief_thread_weekly_candidate_count: 0,
          daily_brief_thread_filtered_out_count: 1,
          daily_brief_thread_filtered_out_reason_top: "timestamp_outside_window",
          daily_brief_thread_effective_timestamp_rescue_count: 1,
          daily_brief_thread_source_tables_present: "sms_inbound_messages|sms_send_events",
        },
      },
      freshness_phrases: [],
    });
    const telemetryWithBuild = dailyWritingBriefTelemetry({
      brief,
      writer_system_chars: 900,
      writer_payload_chars: 5000,
      writer_total_chars: 5900,
      threadBuild: {
        daily_brief_thread_source_candidate_count: 3,
        daily_brief_thread_visible_send_candidate_count: 2,
        daily_brief_thread_user_inbound_candidate_count: 1,
        daily_brief_thread_weekly_candidate_count: 0,
        daily_brief_thread_filtered_out_count: 1,
        daily_brief_thread_filtered_out_reason_top: "timestamp_outside_window",
        daily_brief_thread_effective_timestamp_rescue_count: 1,
        daily_brief_thread_source_tables_present: "sms_inbound_messages|sms_send_events",
      },
    });
    expect(telemetryWithBuild.daily_brief_thread_source_candidate_count).toBe(3);
    expect(telemetryWithBuild.daily_brief_thread_effective_timestamp_rescue_count).toBe(1);
    expect(JSON.stringify(telemetryWithBuild)).not.toMatch(/Recent coach/i);
  });

  it("observability: open-loop flags exported without raw text", () => {
    const facts = baseFacts({
      thread_memory: {
        ...baseFacts().thread_memory,
        latest_open_question: "Did you protect focus today?",
      },
    });
    const cal = deriveDailyProofCalibration({ facts });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages: [],
        message_count: 0,
        char_count: 0,
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases: [],
    });
    const ext = dailyWritingBriefExtendedTelemetry({
      brief,
      threadWindow: {
        daily_brief_thread_floor_message_count: 0,
        daily_brief_thread_extension_message_count: 0,
        daily_brief_thread_oldest_at_local: null,
        daily_brief_thread_newest_at_local: null,
      },
    });
    expect(typeof ext.daily_open_loop_pending_active).toBe("boolean");
    expect(typeof ext.daily_open_question_pending).toBe("boolean");
    expect(JSON.stringify(ext)).not.toMatch(/Did you protect focus today/i);
    expect(JSON.stringify(ext)).not.toMatch(/open_loops":\s*\{/);
  });

  it("observability: timing telemetry includes daypart and guidance present", () => {
    const facts = baseFacts({
      user: {
        ...baseFacts().user,
        timezone: "America/Chicago",
        local_time_iso: "2026-06-20T14:00:00.000Z",
      },
    });
    const cal = deriveDailyProofCalibration({ facts });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages: [],
        message_count: 0,
        char_count: 0,
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases: [],
    });
    const telemetry = dailyWritingBriefTelemetry({
      brief,
      writer_system_chars: 900,
      writer_payload_chars: 5000,
      writer_total_chars: 5900,
    });
    expect(telemetry.daily_local_daypart).toBe("morning");
    expect(telemetry.daily_timing_guidance_present).toBe(true);
    expect(telemetry.daily_timing_copy_guidance_count).toBeGreaterThan(0);
    expect(JSON.stringify(telemetry)).not.toMatch(/Morning send:/);
  });

  it("observability: morning timing guidance produces count > 0", () => {
    const facts = baseFacts({
      user: {
        ...baseFacts().user,
        timezone: "America/Chicago",
        local_time_iso: "2026-06-20T14:00:00.000Z",
      },
    });
    const cal = deriveDailyProofCalibration({ facts });
    const guidance = buildCompactTimingCopyGuidanceForBrief({ facts, proofCalibration: cal });
    expect(guidance.length).toBeGreaterThan(0);
    expect(guidance.some((g) => /Morning send/i.test(g))).toBe(true);
  });

  it("observability: evening timing guidance produces count > 0", () => {
    const facts = baseFacts({
      user: {
        ...baseFacts().user,
        timezone: "America/Chicago",
        local_time_iso: "2026-06-20T01:00:00.000Z",
      },
    });
    const cal = deriveDailyProofCalibration({ facts });
    const guidance = buildCompactTimingCopyGuidanceForBrief({ facts, proofCalibration: cal });
    expect(guidance.length).toBeGreaterThan(0);
    expect(guidance.some((g) => /Evening send/i.test(g))).toBe(true);
  });

  it("observability: durable memory counts without exporting names", () => {
    const facts = baseFacts({
      relationship_anchor_sources: {
        important_people: [
          {
            display_name: "Secret Spouse Name",
            relationship_type: "spouse",
            source: "onboarding",
          },
        ],
        people_summary: "Family-first accountability context",
      },
    });
    const cal = deriveDailyProofCalibration({ facts });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages: [],
        message_count: 0,
        char_count: 0,
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases: [],
    });
    expect(brief.relationship_anchors.people).toHaveLength(1);
    expect(brief.durable_relationship_memory.items.some((i) => i.kind === "person")).toBe(false);
    const telemetry = dailyWritingBriefTelemetry({
      brief,
      writer_system_chars: 900,
      writer_payload_chars: 5000,
      writer_total_chars: 5900,
    });
    expect(telemetry.daily_durable_memory_item_count).toBeGreaterThan(0);
    expect(telemetry.daily_durable_people_count).toBeGreaterThan(0);
    expect(telemetry.daily_durable_memory_background_only).toBe(true);
    const obsJson = JSON.stringify(telemetry);
    expect(obsJson).not.toMatch(/Secret Spouse Name/i);
    expect(obsJson).not.toMatch(/durable_relationship_memory/);
    expect(obsJson).not.toMatch(/"items":\s*\[/);
  });
});

const GENERIC_COPY_MODEL_PHRASE_RE =
  /\bone honest (rep|step|win)\b|fresh opportunity|stay committed|make today count|different honest next step|first honest (rep|step)/i;

function briefTruthTimingFreshnessStrings(brief: ReturnType<typeof buildDailySmsWritingBriefV1>): string {
  const parts = [
    brief.authoritative_truth.proof.summary_line,
    ...(brief.authoritative_truth.local.timing_copy_guidance ?? []),
    brief.freshness.note,
  ];
  return parts.join("\n");
}

function cleanStartFacts(overrides?: Partial<DailyV3RelationshipFacts>): DailyV3RelationshipFacts {
  return baseFacts({
    accountability: {
      ...baseFacts().accountability,
      prior_outcome: "none",
      yes_streak_14d: 0,
      no_count_14d: 0,
      partial_count_14d: 0,
      days_since_last_user_outcome: null,
    },
    thread_memory: {
      ...baseFacts().thread_memory,
      relationship_memory_7d: {
        ...baseFacts().thread_memory.relationship_memory_7d,
        outcome_counts: { yes: 0, no: 0, partial: 0, blockers: 0, checks_sent: 0 },
        wins: [],
        misses: [],
        partials: [],
        context_flags: { days_since_last_user_outcome: null },
      },
    },
    ...overrides,
  });
}

function johnFixtureFacts(): DailyV3RelationshipFacts {
  return baseFacts({
    user: {
      ...baseFacts().user,
      preferred_name: "John",
      timezone: "America/Chicago",
      local_time_iso: "2026-06-20T13:00:00.000Z",
    },
    commitment: {
      ...baseFacts().commitment,
      title: "10,000 steps",
      behavior_statement: "Walk 10,000 steps",
      effective_ask: "Walk 10,000 steps",
      identity_anchor_allowed: true,
      identity_anchor_short: "I move my body every day.",
    },
    relationship_anchor_sources: {
      important_people: [
        { display_name: "Brooke", relationship_type: "spouse", source: "onboarding" },
        { display_name: "Breck", relationship_type: "child", source: "onboarding" },
        { display_name: "Rocky", relationship_type: "child", source: "onboarding" },
        { display_name: "Lakelyn", relationship_type: "child", source: "onboarding" },
      ],
      people_summary: null,
    },
  });
}

function distributionFixtureFacts(): DailyV3RelationshipFacts {
  return baseFacts({
    user: {
      ...baseFacts().user,
      preferred_name: "Maya",
    },
    commitment: {
      ...baseFacts().commitment,
      title: "Client outreach",
      behavior_statement: "Send five thoughtful client follow-ups",
      effective_ask: "Send five thoughtful client follow-ups",
      identity_anchor_short: "I show up for my clients consistently.",
    },
    relationship_anchor_sources: {
      important_people: [{ display_name: "Elena", relationship_type: "mentor", source: "onboarding" }],
      people_summary: null,
    },
  });
}

describe("FirstTextStyleMicroguideV1 and relationship_anchors", () => {
  it("system prompt contains FirstTextStyleMicroguideV1 and paraphrase-only rules", () => {
    const system = buildDailySmsBriefSystemPrompt({ maxChars: 300 });
    expect(system).toContain("FIRST-TEXT STYLE");
    expect(system).toContain(FIRST_TEXT_STYLE_MICROGUIDE_V1);
    expect(system).toMatch(/subordinate to authoritative_truth and current_standard/i);
    expect(system).not.toMatch(/Prefer relationship_read\.today_best_move/i);
    expect(system).not.toMatch(/primary human-continuity guide/i);
    expect(system).toMatch(/Paraphrase all hints/i);
    expect(system).toMatch(/Do not paste notebook phrases/i);
    expect(system).toMatch(
      /recent_exact_thread is the literal SMS thread — its message bodies and timestamps beat summaries or interpretations/
    );
    expect(system).not.toMatch(/actual_sent_thread|delivered_thread|verified_thread/);
    expect(system).toMatch(/No app, website, Victory Room/i);
    expect(system).toMatch(/No fake Pat quotes/i);
    expect(system).toMatch(/No fake proof/i);
    expect(system).toMatch(/should_send \(boolean\)/);
    expect(system).toMatch(/safety_notes \(string\[\]\)/);
  });

  it("microguide is not duplicated in JSON brief payload", () => {
    const facts = johnFixtureFacts();
    const cal = deriveDailyProofCalibration({ facts });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages: [],
        message_count: 0,
        char_count: 0,
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases: [],
    });
    const writer = buildDailySmsWriterMessagesFromBrief(brief);
    expect(writer.user).not.toContain("FIRST-TEXT STYLE");
    expect(writer.user).not.toContain(FIRST_TEXT_STYLE_MICROGUIDE_V1);
  });

  it("relationship_anchors includes max 4 people with style_hint_only authority", () => {
    const sources = {
      important_people: [
        { display_name: "Brooke", relationship_type: "spouse", source: "onboarding" as const },
        { display_name: "Breck", relationship_type: "child", source: "onboarding" as const },
        { display_name: "Rocky", relationship_type: "child", source: "onboarding" as const },
        { display_name: "Lakelyn", relationship_type: "child", source: "onboarding" as const },
        { display_name: "Extra", relationship_type: "friend", source: "onboarding" as const },
      ],
      people_summary: null,
    };
    const anchors = buildRelationshipAnchorsForBrief(sources);
    expect(anchors.people).toHaveLength(4);
    expect(anchors.people.map((p) => p.name)).toEqual(["Brooke", "Breck", "Rocky", "Lakelyn"]);
    expect(anchors.authority).toBe("style_hint_only");
    expect(anchors.usage).toBe("sparingly_when_it_deepens_meaning_never_guilt");
    expect(JSON.stringify(anchors)).not.toMatch(/background_only|proof_moment|blocker/i);
  });

  it("relationship_anchors empty when no important people", () => {
    const anchors = buildRelationshipAnchorsForBrief({ important_people: [], people_summary: null });
    expect(anchors.people).toEqual([]);
    expect(anchors.authority).toBe("style_hint_only");
  });

  it("clean-start brief truth/timing/freshness strings avoid generic copy-model phrases", () => {
    const facts = cleanStartFacts({
      user: {
        ...baseFacts().user,
        timezone: "America/Chicago",
        local_time_iso: "2026-06-20T13:00:00.000Z",
      },
    });
    const cal = deriveDailyProofCalibration({ facts });
    expect(cal.praise_allowed_level).toBe("none");
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages: [],
        message_count: 0,
        char_count: 0,
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases: [],
    });
    const blob = briefTruthTimingFreshnessStrings(brief);
    expect(blob).not.toMatch(GENERIC_COPY_MODEL_PHRASE_RE);
    expect(cal.truth_summary_for_writer).toMatch(/one honest rep/i);
    expect(brief.authoritative_truth.proof.summary_line).not.toMatch(/one honest rep/i);
    expect(brief.authoritative_truth.proof.praise_allowed_level).toBe(cal.praise_allowed_level);
    expect(brief.authoritative_truth.proof.wins_7d).toBe(cal.wins_7d);
  });

  it("John fixture: name, steps goal, and family in relationship_anchors with writer permission", () => {
    const facts = johnFixtureFacts();
    const cal = deriveDailyProofCalibration({ facts });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages: [],
        message_count: 0,
        char_count: 0,
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases: [],
    });
    expect(brief.identity.preferred_name).toBe("John");
    expect(brief.current_standard.effective_ask).toMatch(/10,000 steps/i);
    expect(brief.relationship_anchors.people.map((p) => p.name)).toEqual([
      "Brooke",
      "Breck",
      "Rocky",
      "Lakelyn",
    ]);
    expect(brief.durable_relationship_memory.items.some((i) => i.kind === "person")).toBe(false);
    expect(
      brief.durable_relationship_memory.items.some((i) =>
        /Brooke|Breck|Rocky|Lakelyn/i.test(i.text)
      )
    ).toBe(false);
    expect(brief.relationship_anchors.authority).toBe("style_hint_only");
    expect(brief.relationship_anchors.usage).toBe(
      "sparingly_when_it_deepens_meaning_never_guilt"
    );
    const writer = buildDailySmsWriterMessagesFromBrief(brief);
    expect(writer.system).toMatch(/No Reply YES\/NO|No robot menu/i);
    expect(writer.system).toMatch(/no fake Pat quotes|No fake Pat quotes/i);
    expect(writer.system).toMatch(/no third-person Pat/i);
    expect(writer.user).toContain('"relationship_anchors"');
    expect(writer.user).toContain("style_hint_only");
    expect(writer.user).toContain("Brooke");
  });

  it("non-steps fixture: relationship_anchors without overfitting to steps", () => {
    const facts = distributionFixtureFacts();
    const cal = deriveDailyProofCalibration({ facts });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages: [],
        message_count: 0,
        char_count: 0,
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases: [],
    });
    expect(brief.identity.preferred_name).toBe("Maya");
    expect(brief.current_standard.effective_ask).toMatch(/client follow-ups/i);
    expect(brief.relationship_anchors.people).toEqual([{ name: "Elena", role: "mentor" }]);
  });

  it("prompt size stays within budget after microguide", () => {
    const facts = johnFixtureFacts();
    const cal = deriveDailyProofCalibration({ facts });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages: [],
        message_count: 0,
        char_count: 0,
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases: [],
    });
    const writer = buildDailySmsWriterMessagesFromBrief(brief);
    expect(writer.system.length).toBeLessThan(3800);
    expect(writer.system.length + writer.user.length).toBeLessThan(8900);
  });

  it("neutralizes generic suggested_move.reason in brief payload", () => {
    const facts = baseFacts();
    const cal = deriveDailyProofCalibration({ facts });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages: [],
        message_count: 0,
        char_count: 0,
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases: [],
    });
    expect(minimalCard().move.reason).toMatch(/one honest rep/i);
    expect(brief.suggested_move.reason).not.toMatch(/one honest rep/i);
    expect(brief.suggested_move.reason).toMatch(/weak or stale proof/i);
    expect(cal.praise_allowed_level).toBe("capability_only");
    expect(brief.authoritative_truth.proof.praise_allowed_level).toBe(cal.praise_allowed_level);
  });

  it("preserves specific non-generic suggested_move.reason", () => {
    const facts = baseFacts();
    const cal = deriveDailyProofCalibration({ facts });
    const card = {
      ...minimalCard(),
      move: {
        ...minimalCard().move,
        reason: "Close pending plan loop after Brooke workout window.",
      },
    };
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: card,
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages: [],
        message_count: 0,
        char_count: 0,
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases: [],
    });
    expect(brief.suggested_move.reason).toBe(
      "Close pending plan loop after Brooke workout window."
    );
  });

  it("brief JSON payload avoids generic honest-rep/step/win copy models", () => {
    const facts = johnFixtureFacts();
    const cal = deriveDailyProofCalibration({ facts });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages: [],
        message_count: 0,
        char_count: 0,
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases: [],
    });
    const writer = buildDailySmsWriterMessagesFromBrief(brief);
    expect(writer.user).not.toMatch(/\bone honest (rep|step|win)\b/i);
    expect(writer.system).toMatch(/one honest step/);
  });

  it("neutralizeBriefSuggestedMoveReasonForWriter maps known generic patterns", () => {
    expect(neutralizeBriefSuggestedMoveReasonForWriter("Weak stale proof — one honest rep today.")).toBe(
      "Weak or stale proof; hold the current standard without praise."
    );
    expect(neutralizeBriefSuggestedMoveReasonForWriter("Fresh opportunity to reset.")).toBe(
      "Use a fresh angle without overstating proof."
    );
    expect(
      neutralizeBriefSuggestedMoveReasonForWriter("Close loop after school pickup.")
    ).toBe("Close loop after school pickup.");
  });
});

describe("relationship_read in DAILY_SMS_WRITING_BRIEF_V1", () => {
  function briefWithThread(
    messages: Array<{ at_local: string; role: "coach" | "user"; body: string }>,
    factsOverrides?: Partial<DailyV3RelationshipFacts>,
    freshness_phrases: ReturnType<typeof deriveFreshnessAvoidPhrasesForBrief> = []
  ) {
    const facts = baseFacts(factsOverrides);
    return buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: deriveDailyProofCalibration({ facts }),
      strategy_card: minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages,
        message_count: messages.length,
        char_count: messages.reduce((s, m) => s + m.body.length, 0),
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases,
    });
  }

  it("relationship_read exists and appears immediately after identity in JSON", () => {
    const brief = briefWithThread([
      { at_local: "Thu 8:05 AM", role: "user", body: "Done for today." },
    ]);
    expect(brief.relationship_read.authority).toBe("paraphrase_only_not_copy");
    const keys = Object.keys(brief);
    expect(keys.indexOf("identity")).toBeLessThan(keys.indexOf("relationship_read"));
    expect(keys.indexOf("relationship_read")).toBeLessThan(keys.indexOf("current_standard"));
    expect(keys.indexOf("relationship_read")).toBeLessThan(keys.indexOf("authoritative_truth"));

    const writer = buildDailySmsWriterMessagesFromBrief(brief);
    const jsonStart = writer.user.indexOf("{");
    const parsed = JSON.parse(writer.user.slice(jsonStart, writer.user.indexOf("\n\nWrite JSON")));
    const parsedKeys = Object.keys(parsed);
    expect(parsedKeys[parsedKeys.indexOf("identity") + 1]).toBe("relationship_read");
  });

  it("latest_user_signal from user thread; today_best_move not raw token", () => {
    const brief = briefWithThread([
      { at_local: "Thu 8:00 AM", role: "coach", body: "Focus hour today?" },
      {
        at_local: "Thu 8:05 AM",
        role: "user",
        body: "Not yet — wrapping up to eat lunch.",
      },
    ]);
    expect(brief.relationship_read.latest_user_signal).toMatch(/lunch/i);
    expect(brief.relationship_read.today_best_move).not.toBe(brief.suggested_move.move);
    expect(brief.relationship_read.callback_worth_using).toMatch(/lunch/i);
  });

  it("family correction conflict and bad coach warning with freshness", () => {
    const brief = briefWithThread(
      [
        {
          at_local: "Wed 6:00 PM",
          role: "user",
          body: "No more family connections — we finished that.",
        },
      ],
      {
        commitment: {
          ...baseFacts().commitment,
          effective_ask: "Daily family connection",
          behavior_statement: "Connect with family",
        },
      },
      deriveFreshnessAvoidPhrasesForBrief(baseFacts().thread_memory.recent_coach_body_do_not_repeat)
    );
    expect(brief.relationship_read.possible_current_standard_conflict).toMatch(/family/i);
    expect(
      brief.relationship_read.avoid_because_user_corrected_us.some((a) =>
        /correction:do_not_repeat/i.test(a)
      )
    ).toBe(true);
    expect(brief.relationship_read.bad_old_coach_copy_warning).toMatch(/stale wording/i);
  });

  it("silence cadence populates silence_route_human_read", () => {
    const brief = briefWithThread([], {
      silence_cadence: {
        route: "cant_coach_silence_day5",
        silence_day: 5,
        send_today: true,
        no_send_reason: null,
      },
    });
    expect(brief.relationship_read.silence_route_human_read).toBe("confirm_still_in");
  });

  it("demotes open_loops latest_answer when latest_user_signal present", () => {
    const brief = briefWithThread([
      { at_local: "Thu 8:05 AM", role: "user", body: "Yes, got my hour in." },
    ], {
      thread_memory: {
        ...baseFacts().thread_memory,
        latest_answer_after_open_question: "Yes, got my hour in.",
      },
    });
    expect(brief.relationship_read.latest_user_signal).toBeTruthy();
    expect(brief.open_loops.latest_answer).toBeUndefined();
  });

  it("payload growth stays reasonable vs baseline empty thread", () => {
    const empty = buildDailySmsWriterMessagesFromBrief(
      briefWithThread([])
    );
    const withSignal = buildDailySmsWriterMessagesFromBrief(
      briefWithThread([
        {
          at_local: "Thu 8:05 AM",
          role: "user",
          body: "Not yet — lunch first, then I'll get the hour in.",
        },
      ])
    );
    const delta = withSignal.writer_payload_chars - empty.writer_payload_chars;
    expect(delta).toBeLessThan(1200);
    expect(JSON.stringify(briefWithThread([])).length).toBeLessThan(
      JSON.stringify({
        ...briefWithThread([]),
        style_guardrails: {
          one_sms: true,
          no_robot_menu: true,
          no_fake_pat_quotes: true,
          no_generic_motivation: true,
          summaries_background_only: true,
        },
      }).length + 900
    );
  });

  it("does not include style_guardrails in brief JSON", () => {
    const brief = briefWithThread([]);
    expect("style_guardrails" in brief).toBe(false);
  });
});

describe("slot_coaching_context in DAILY_SMS_WRITING_BRIEF_V1", () => {
  function briefWithThread(
    messages: Array<{ at_local: string; role: "coach" | "user"; body: string }>
  ) {
    const facts = baseFacts();
    return buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: deriveDailyProofCalibration({ facts }),
      strategy_card: minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages,
        message_count: messages.length,
        char_count: messages.reduce((s, m) => s + m.body.length, 0),
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases: [],
    });
  }

  it("includes current_send_slot morning and slot_coaching_context", () => {
    const brief = briefWithThread([]);
    expect(brief.current_send_slot).toBe("morning");
    expect(brief.slot_coaching_context.version).toBe("1");
    expect(brief.slot_coaching_context.authority).toBe("paraphrase_only_not_copy");
    expect(brief.slot_coaching_context.current_slot).toBe("morning");
  });

  it("slot_coaching_context appears after relationship_read in JSON", () => {
    const brief = briefWithThread([
      {
        at_local: "Mon 7:00 AM",
        role: "coach",
        body: "Today's rep: give one real compliment to each kid before bedtime.",
      },
    ]);
    const keys = Object.keys(brief);
    expect(keys.indexOf("relationship_read")).toBeLessThan(keys.indexOf("slot_coaching_context"));
    expect(keys.indexOf("slot_coaching_context")).toBeLessThan(keys.indexOf("current_standard"));

    const writer = buildDailySmsWriterMessagesFromBrief(brief);
    expect(writer.system).toMatch(/Paraphrase all hints/i);
    expect(writer.system).not.toMatch(/Prefer relationship_read\.today_best_move/i);
    expect(writer.system).not.toMatch(/OUTPUT:.*intended_rep/s);
  });

  it("relationship_read is unchanged alongside slot_coaching_context", () => {
    const brief = briefWithThread([
      { at_local: "Thu 8:05 AM", role: "user", body: "Done for today." },
    ]);
    expect(brief.relationship_read.authority).toBe("paraphrase_only_not_copy");
    expect(brief.slot_coaching_context.slot_role_recommendation).toBeTruthy();
  });
});

describe("coaching_situation in DAILY_SMS_WRITING_BRIEF_V1", () => {
  function meetingAskCommitment() {
    return {
      ...baseFacts().commitment,
      effective_ask: "I will start one meeting on time with a clear agenda",
      behavior_statement: "Start one meeting on time with a clear agenda",
      title: "Meeting kickoff",
    };
  }

  function briefFor(args: {
    messages: Array<{ at_local: string; role: "coach" | "user"; body: string }>;
    factsOverrides?: Partial<DailyV3RelationshipFacts>;
    freshness_phrases?: ReturnType<typeof deriveFreshnessAvoidPhrasesForBrief>;
    strategy_card?: StrategyCardV1;
    writing_brief_overrides?: Parameters<typeof buildDailySmsWritingBriefV1>[0]["writing_brief_overrides"];
  }) {
    const facts = baseFacts(args.factsOverrides);
    return buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: deriveDailyProofCalibration({ facts }),
      strategy_card: args.strategy_card ?? minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages: args.messages,
        message_count: args.messages.length,
        char_count: args.messages.reduce((s, m) => s + m.body.length, 0),
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases: args.freshness_phrases ?? [],
      writing_brief_overrides: args.writing_brief_overrides,
    });
  }

  it("Mayes-style correction + stale copy → fit repair, demote set_today_rep, allow one question", () => {
    const ask = "I will start one meeting on time with a clear agenda";
    const brief = briefFor({
      messages: [
        {
          at_local: "Thu 7:00 AM",
          role: "coach",
          body: "Mayes, kick off that meeting with a clear agenda today.",
        },
        {
          at_local: "Thu 7:10 AM",
          role: "user",
          body: "These messages are not relevant",
        },
      ],
      factsOverrides: { commitment: meetingAskCommitment() },
      freshness_phrases: [
        {
          phrase: "kick off that meeting with a clear agenda",
          source_body_preview: "Mayes, kick off that meeting with a clear agenda today.",
          at_local: "Thu 7:00 AM",
        },
      ],
      strategy_card: {
        ...minimalCard(),
        move: {
          type: "close_loop",
          priority: "normal",
          confidence: "high",
          reason: "Prior ask was answered — close the loop without re-asking.",
        },
        writer_constraints: {
          max_questions: 0,
          avoid_repeating: [],
          tone_posture: "warm_direct",
        },
      },
      writing_brief_overrides: {
        previousOutbound: {
          body: "Mayes, kick off that meeting with a clear agenda today.",
          inferred_slot: "morning",
        },
      },
    });

    expect(brief.relationship_read.what_would_make_user_feel_known).toBe("honor_correction");
    expect(
      brief.relationship_read.avoid_because_user_corrected_us.some((a) =>
        /correction:/i.test(a)
      )
    ).toBe(true);
    expect(brief.relationship_read.bad_old_coach_copy_warning).toMatch(/stale wording/i);

    expect(["fit_in_question", "repair_recent_correction"]).toContain(
      brief.coaching_situation.kind
    );
    expect(brief.coaching_situation.current_standard_status).toBe(
      "stored_but_fit_in_question"
    );
    expect(brief.coaching_situation.writer_posture).toBe(
      "repair_fit_before_accountability"
    );
    expect(brief.coaching_situation.authority).toBe("semantic_context_not_copy");
    expect(brief.coaching_situation.basis.length).toBeLessThanOrEqual(5);
    expect(brief.coaching_situation.semantic_notes.length).toBeLessThanOrEqual(5);

    expect(brief.current_standard.effective_ask).toBe(ask);
    expect(brief.slot_coaching_context.slot_role_recommendation).not.toBe("set_today_rep");
    expect(brief.slot_coaching_context.checkin_focus).not.toBe(ask);
    if (brief.slot_coaching_context.checkin_focus) {
      expect(brief.slot_coaching_context.checkin_focus.toLowerCase()).not.toContain(
        "meeting on time"
      );
    }
    expect(brief.suggested_move.max_questions).toBe(1);
    expect(
      brief.suggested_move.must_not_do.some((m) =>
        /until fit\/relevance is repaired/i.test(m)
      )
    ).toBe(true);
    expect(brief.authoritative_truth.claims.can_claim_proof).toBe(true);
    expect(JSON.stringify(brief)).not.toMatch(/Change Goal|Update Goal|open the app/i);
  });

  it("normal accountability regression keeps active posture and allows set_today_rep", () => {
    const brief = briefFor({
      messages: [],
      writing_brief_overrides: {
        previousOutbound: null,
      },
    });
    expect(brief.coaching_situation.kind).toBe("normal_accountability");
    expect(brief.coaching_situation.current_standard_status).toBe("active");
    expect(brief.coaching_situation.writer_posture).toBe("run_accountability");
    expect(brief.slot_coaching_context.slot_role_recommendation).toBe("set_today_rep");
  });

  it("DNR close-loop without fit conflict keeps max_questions 0 and no repair posture", () => {
    const brief = briefFor({
      messages: [
        { at_local: "Thu 8:00 AM", role: "coach", body: "What time will you protect the hour?" },
        { at_local: "Thu 8:05 AM", role: "user", body: "After lunch at 1pm." },
      ],
      factsOverrides: {
        daily_satisfied_ask_context: {
          has_satisfied_recent_ask: true,
          satisfied_ask_type: "plan_detail",
          do_not_repeat_asks: ["What time will you protect the hour?"],
          evidence_preview: "After lunch at 1pm.",
          source: "inbound_turn_telemetry",
          occurred_at: "2026-06-20T13:00:00.000Z",
          last_ask_satisfied: "yes",
          stale_ask_risk: true,
          relationship_meaning: "plan_made",
          response_intent: "acknowledge_prior_ask_satisfied",
          prior_question_type: "plan_confirmation",
          outcome_proof_eligible: false,
          persistence_note: "Satisfied-ask context only.",
        },
        thread_memory: {
          ...baseFacts().thread_memory,
          latest_open_question: "What time will you protect the hour?",
          latest_answer_after_open_question: "After lunch at 1pm.",
          open_question_pending: false,
          do_not_repeat_hints: ["What time will you protect the hour?"],
        },
      },
      strategy_card: {
        ...minimalCard(),
        move: {
          type: "close_loop",
          priority: "normal",
          confidence: "high",
          reason: "Prior ask was answered — close the loop without re-asking.",
        },
        writer_constraints: {
          max_questions: 0,
          avoid_repeating: [],
          tone_posture: "warm_direct",
        },
      },
    });

    expect(brief.coaching_situation.writer_posture).not.toBe(
      "repair_fit_before_accountability"
    );
    expect(brief.coaching_situation.current_standard_status).toBe("active");
    expect(brief.suggested_move.max_questions).toBe(0);
    expect(brief.recent_turn_semantics?.relationship_meaning).toBe("plan_made");
    expect(brief.recent_turn_semantics?.authority).toBe("semantic_context_not_copy");
  });

  it("Brooke-style steps goal does not hard-code walking-only or cleaning→steps", () => {
    const stepsAsk = "Hit 10,000 steps today";
    const brief = briefFor({
      messages: [
        {
          at_local: "Thu 8:00 AM",
          role: "coach",
          body: "Brooke, how's the step goal going this morning?",
        },
        {
          at_local: "Thu 8:05 AM",
          role: "user",
          body: "I actually didn't walk- I cleaned the house! Haha",
        },
      ],
      factsOverrides: {
        commitment: {
          ...baseFacts().commitment,
          effective_ask: stepsAsk,
          behavior_statement: "10,000 steps",
          title: "Steps",
        },
        daily_satisfied_ask_context: {
          has_satisfied_recent_ask: true,
          satisfied_ask_type: "direct_answer",
          do_not_repeat_asks: ["how's the step goal going this morning?"],
          evidence_preview: "I actually didn't walk- I cleaned the house! Haha",
          source: "inbound_turn_telemetry",
          occurred_at: "2026-06-20T13:00:00.000Z",
          last_ask_satisfied: "yes",
          stale_ask_risk: true,
          relationship_meaning: "direct_answer",
          response_intent: "acknowledge_prior_ask_satisfied",
          prior_question_type: null,
          outcome_proof_eligible: false,
          persistence_note: "Satisfied-ask context only.",
        },
      },
    });

    expect(brief.current_standard.effective_ask).toBe(stepsAsk);
    const blob = JSON.stringify(brief.coaching_situation);
    expect(blob).not.toMatch(/instead of walking/i);
    expect(blob).not.toMatch(/cleaning counts as steps/i);
    expect(brief.authoritative_truth.claims.can_claim_completion).toBe(false);
    expect(brief.coaching_situation.writer_posture).not.toBe(
      "repair_fit_before_accountability"
    );
  });

  it("prompt treats coaching_situation as semantic context with fit-repair and method-open guidance", () => {
    const brief = briefFor({
      messages: [
        {
          at_local: "Thu 7:10 AM",
          role: "user",
          body: "These messages are not relevant",
        },
      ],
      factsOverrides: { commitment: meetingAskCommitment() },
      freshness_phrases: [
        {
          phrase: "meeting with a clear agenda",
          source_body_preview: "Start the meeting with a clear agenda.",
          at_local: "Wed 7:00 AM",
        },
      ],
      strategy_card: {
        ...minimalCard(),
        writer_constraints: {
          max_questions: 0,
          avoid_repeating: [],
          tone_posture: "warm_direct",
        },
      },
    });

    const writer = buildDailySmsWriterMessagesFromBrief(brief);
    expect(writer.system).toMatch(/coaching_situation is semantic context/i);
    expect(writer.system).toMatch(/stored_but_fit_in_question|repair_fit_before_accountability/i);
    expect(writer.system).toMatch(/do not assume one method is the only way/i);
    expect(writer.system).toMatch(/No app, website, Victory Room/i);
    expect(writer.system).toMatch(/Do not repeat stale or satisfied asks/i);
    expect(writer.system).toMatch(/No fake proof/i);
    expect(writer.system).toMatch(
      /OUTPUT: strict JSON only with keys:\nshould_send \(boolean\), body \(string/
    );

    const helpersSrc = [
      applyCoachingSituationConflicts.toString(),
      buildCoachingSituationForBrief.toString(),
      detectFitOrCorrectionConflictFromAssembledSemantics.toString(),
    ].join("\n");
    expect(helpersSrc).not.toMatch(/not relevant|not my goal|stop asking/i);
  });
});

describe("morning slot truth (current_send_slot controls daypart)", () => {
  function emptyThread() {
    return {
      window: {
        floor_hours: 72 as const,
        extension_days: 7 as const,
        mode: "72h_floor_7d_extension_capped" as const,
      },
      messages: [] as Array<{
        at_local: string;
        role: "coach" | "user";
        body: string;
        source_table: string;
        delivery_evidence:
          | "message_sid_present"
          | "outbound_message_sid_present"
          | "status_sent_with_timestamp"
          | "inbound_received"
          | "fallback_last_outbound";
      }>,
      message_count: 0,
      char_count: 0,
      timeline_7d: { messages: [], window_hours: 168 as const, message_count: 0 },
    };
  }

  it("A: morning brief includes start-of-day guidance and morningSlotLine", () => {
    const facts = baseFacts({
      user: {
        ...baseFacts().user,
        timezone: "America/New_York",
        local_time_iso: "2026-07-12T12:00:00.000Z",
      },
      accountability_day_key: "2026-07-12",
    });
    const cal = deriveDailyProofCalibration({ facts });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: emptyThread(),
      freshness_phrases: [],
    });
    expect(brief.current_send_slot).toBe(SMS_DAILY_PRODUCTION_SEND_SLOT);
    expect(brief.authoritative_truth.local.local_daypart).toBe("morning");
    expect(
      brief.authoritative_truth.local.timing_copy_guidance?.some((g) => /Morning send/i.test(g))
    ).toBe(true);
    const writer = buildDailySmsWriterMessagesFromBrief(brief);
    expect(writer.system).toContain(MORNING_SLOT_WRITER_LINE.trim());
    expect(writer.system).toMatch(/start-of-day accountability/i);
  });

  it("B: morning generated at night still uses morning guidance, not evening/tomorrow framing", () => {
    const facts = baseFacts({
      user: {
        ...baseFacts().user,
        timezone: "America/New_York",
        // July 11 late evening ET — wall-clock evening/late_night
        local_time_iso: "2026-07-12T03:30:00.000Z",
      },
      accountability_day_key: "2026-07-12",
    });
    expect(
      deriveLocalDaypartForBrief({
        timezone: facts.user.timezone,
        localTimeIso: facts.user.local_time_iso,
      })
    ).toMatch(/evening|late_night/);
    expect(
      resolveWriterFacingDaypartForBrief({
        currentSendSlot: "morning",
        timezone: facts.user.timezone,
        localTimeIso: facts.user.local_time_iso,
      })
    ).toBe("morning");

    const cal = deriveDailyProofCalibration({ facts });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: emptyThread(),
      freshness_phrases: [],
      writing_brief_overrides: { currentSendSlot: "morning" },
    });

    expect(brief.authoritative_truth.local.local_daypart).toBe("morning");
    expect(brief.authoritative_truth.local.local_time_iso).toBe(facts.user.local_time_iso);
    expect(
      brief.authoritative_truth.local.timing_copy_guidance?.some((g) => /Morning send/i.test(g))
    ).toBe(true);
    expect(
      brief.authoritative_truth.local.timing_copy_guidance?.some((g) => /Evening send/i.test(g))
    ).toBe(false);
    expect(brief.relationship_read.send_target_day_context).toMatch(/Morning\//i);
    expect(brief.relationship_read.send_target_day_context).toMatch(
      /do not imply today's outcome already happened|Morning\/prospec/i
    );
    expect(brief.relationship_read.send_target_day_context).not.toMatch(/prefer tomorrow/i);

    const guidance = buildCompactTimingCopyGuidanceForBrief({
      facts,
      proofCalibration: cal,
      daypart: "morning",
    });
    expect(guidance.some((g) => /Morning send/i.test(g))).toBe(true);
    expect(guidance.some((g) => /Evening send|tomorrow's move/i.test(g))).toBe(false);
  });

  it("C/D/E: morning system line forbids completed-day reflection, tomorrow drift, and past-method-as-plan", () => {
    const system = buildDailySmsBriefSystemPrompt({
      maxChars: 300,
      zeroQuestionMode: false,
      pendingPlanActive: false,
      goalEvolutionInvite: false,
      currentSendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
    });
    expect(system).toContain(MORNING_SLOT_WRITER_LINE.trim());
    expect(system).toMatch(/do not ask the user to reflect on a completed day/i);
    expect(system).toMatch(/whether today's action already happened/i);
    expect(system).toMatch(
      /Do not say "tomorrow" unless the notebook explicitly says the relevant event is tomorrow/i
    );
    expect(system).toMatch(
      /past methods in the thread as past context, not today's plan, unless the user restated them/i
    );
    expect(system).not.toContain(EVENING_SLOT_WRITER_LINE.trim());
  });

  it("F: evening_checkin keeps evening guidance and is not flattened to morning", () => {
    const facts = baseFacts({
      user: {
        ...baseFacts().user,
        timezone: "America/New_York",
        local_time_iso: "2026-07-12T12:00:00.000Z", // wall-clock morning
      },
      accountability_day_key: "2026-07-12",
    });
    const cal = deriveDailyProofCalibration({ facts });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: emptyThread(),
      freshness_phrases: [],
      writing_brief_overrides: {
        currentSendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
        slotDaypartOverride: "evening",
      },
    });

    expect(brief.current_send_slot).toBe(SMS_DAILY_EVENING_PREVIEW_SEND_SLOT);
    expect(brief.authoritative_truth.local.local_daypart).toBe("evening");
    expect(
      brief.authoritative_truth.local.timing_copy_guidance?.some((g) => /Evening send/i.test(g))
    ).toBe(true);
    expect(
      brief.authoritative_truth.local.timing_copy_guidance?.some((g) => /Morning send/i.test(g))
    ).toBe(false);

    const writer = buildDailySmsWriterMessagesFromBrief(brief);
    expect(writer.system).toContain(EVENING_SLOT_WRITER_LINE.trim());
    expect(writer.system).not.toContain(MORNING_SLOT_WRITER_LINE.trim());
  });

  it("G: actual morning wall-clock + morning slot still yields morning guidance", () => {
    const facts = baseFacts({
      user: {
        ...baseFacts().user,
        timezone: "America/Chicago",
        local_time_iso: "2026-06-20T13:00:00.000Z",
      },
    });
    expect(
      deriveLocalDaypartForBrief({
        timezone: facts.user.timezone,
        localTimeIso: facts.user.local_time_iso,
      })
    ).toBe("morning");
    const cal = deriveDailyProofCalibration({ facts });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: emptyThread(),
      freshness_phrases: [],
    });
    expect(brief.authoritative_truth.local.local_daypart).toBe("morning");
    expect(
      brief.authoritative_truth.local.timing_copy_guidance?.some((g) => /Morning send/i.test(g))
    ).toBe(true);
  });

  it("H: no second thread block or bulky timing section keys", () => {
    const facts = baseFacts();
    const cal = deriveDailyProofCalibration({ facts });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: emptyThread(),
      freshness_phrases: [],
    });
    const keys = Object.keys(brief);
    expect(keys).toContain("recent_exact_thread");
    expect(keys).toContain("current_send_slot");
    expect(keys).not.toContain("actual_sent_thread");
    expect(keys).not.toContain("delivered_thread");
    expect(keys).not.toContain("verified_thread");
    expect(keys).not.toContain("morning_slot_policy");
    expect(keys).not.toContain("slot_truth_block");
  });
});

describe("recent_exact_thread is the only actual SMS thread block", () => {
  it("F: brief has recent_exact_thread only — no second thread list keys", () => {
    const facts = baseFacts();
    const cal = deriveDailyProofCalibration({ facts });
    const brief = buildDailySmsWritingBriefV1({
      facts,
      proof_calibration: cal,
      strategy_card: minimalCard(),
      thread: {
        window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" },
        messages: [
          {
            at_local: "Thu Jun 17 8:00 AM",
            role: "coach",
            body: "Did you protect the hour?",
            source_table: "sms_send_events",
            delivery_evidence: "message_sid_present",
            message_sid: "SM_ONLY",
          },
          {
            at_local: "Thu Jun 17 8:05 AM",
            role: "user",
            body: "Yes.",
            source_table: "sms_inbound_messages",
            delivery_evidence: "inbound_received",
            message_sid: "SM_USER_ONLY",
          },
        ],
        message_count: 2,
        char_count: 40,
        timeline_7d: { messages: [], window_hours: 168, message_count: 0 },
      },
      freshness_phrases: [],
    });

    const keys = Object.keys(brief);
    expect(keys).toContain("recent_exact_thread");
    expect(keys).not.toContain("actual_sent_thread");
    expect(keys).not.toContain("delivered_thread");
    expect(keys).not.toContain("verified_thread");

    const writer = buildDailySmsWriterMessagesFromBrief(brief);
    expect(writer.user).toContain("recent_exact_thread");
    expect(writer.user).not.toMatch(/"actual_sent_thread"|"delivered_thread"|"verified_thread"/);
    expect(writer.system).toMatch(
      /recent_exact_thread is the literal SMS thread — its message bodies and timestamps beat summaries or interpretations/
    );

    for (const m of brief.recent_exact_thread.messages) {
      expect(m.source_table).toBeTruthy();
      expect(m.delivery_evidence).toBeTruthy();
      expect(m.at_local).toBeTruthy();
      expect(m.role).toMatch(/^(coach|user)$/);
      expect(m.body).toBeTruthy();
    }
  });
});
