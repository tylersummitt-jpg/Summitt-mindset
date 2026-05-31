import { describe, expect, it } from "vitest";
import {
  buildRepairRelationshipSnapshotV1,
  buildRepairSnapshotPromptGuidance,
  DEFAULT_REPAIR_SNAPSHOT_MAX_CHARS,
  REPAIR_RECENT_THREAD_WINDOW_HOURS,
  serializeRepairSnapshotForOpenAI,
  trimRepairSnapshotToBudget,
} from "@/lib/sms-relationship-repair-snapshot-v1";
import type { ThreadFreshnessFacts } from "@/lib/sms-thread-freshness";
import { deriveRecentThreadFreshnessFacts } from "@/lib/sms-thread-freshness";

const lunchFreshness = deriveRecentThreadFreshnessFacts({
  recentExactThreadText: [
    "Coach: How do you feel about prioritizing your five minutes of stretching at lunch?",
    "User: Good suggestion so did that at lunch.",
  ].join("\n"),
  latestUserInbound: "Good suggestion so did that at lunch.",
});

const thread72h = {
  window_hours: REPAIR_RECENT_THREAD_WINDOW_HOURS,
  message_count: 2,
  had_preview_messages: false,
  had_system_no_send: false,
  messages: [
    {
      at: "2026-05-18T10:00:00.000Z",
      at_local: "2026-05-18T06:00:00",
      at_local_timezone: "America/New_York",
      role: "coach",
      body: "How do you feel about prioritizing your five minutes of stretching at lunch?",
      message_kind: "question",
      source_table: "sms_send_events",
      message_sid: "SM1",
      delivery_status: "sent",
      is_exact_body: true,
    },
    {
      at: "2026-05-18T10:05:00.000Z",
      at_local: "2026-05-18T06:05:00",
      at_local_timezone: "America/New_York",
      role: "user",
      body: "Good suggestion so did that at lunch.",
      message_kind: "inbound",
      source_table: "sms_inbound_events",
      message_sid: "SM2",
      delivery_status: "sent",
      is_exact_body: true,
    },
  ],
};

function minimalInboundFacts(extra: Record<string, unknown> = {}) {
  return {
    route_purpose: "v2_accountability",
    thread_freshness: lunchFreshness,
    user: { local_time_iso: "2026-05-18T12:00:00.000Z" },
    commitment: {
      id: "cmt_1",
      behavior_statement: "Stretch at lunch",
      effective_ask: "Five minutes at lunch",
      accountability_phase: "active_accountability",
    },
    thread: {
      coalesced_inbound_text: "Good suggestion so did that at lunch.",
      latest_inbound_raw: "Good suggestion so did that at lunch.",
      memory_packet: {
        recent_exact_thread_72h: thread72h,
        relationship_memory_7d: { window_days: 7, recurring_blockers: [] },
        relationship_memory_30d: { window_days: 30, coaching_summary: "should not appear" },
      },
      memory_authority: { projection_used: true },
    },
    constraints: { max_chars: 320, forbidden_substrings: [] },
    v2_accountability: { proof_callout_hint: { eligible: false } },
    ...extra,
  };
}

describe("buildRepairRelationshipSnapshotV1", () => {
  it("freshness snapshot includes thread_freshness, violation, recent_exact_thread_excerpt, canonical state min", () => {
    const snapshot = buildRepairRelationshipSnapshotV1({
      repairKind: "thread_freshness",
      routeKind: "inbound",
      routePurpose: "v2_accountability",
      blockedBody: "Will you stretch at lunch today?",
      blockedReasons: ["thread_freshness_reasked_completed_action"],
      laneFacts: minimalInboundFacts(),
      freshness: lunchFreshness,
      freshnessViolation: { reason: "reasked_completed_action", detail: "re-asked lunch stretch" },
    });

    expect(snapshot.repair_kind).toBe("thread_freshness");
    expect(snapshot.structured_recent_truth.thread_freshness?.completed_actions.length).toBeGreaterThan(0);
    expect(snapshot.violation.stale_topic).toBeTruthy();
    expect(snapshot.recent_exact_thread_excerpt.messages).toHaveLength(2);
    expect(snapshot.canonical_state_min.effective_ask).toBe("Five minutes at lunch");
    expect(snapshot.proof_victory_permission?.can_reference_victory_room).toBe(false);
  });

  it("memory repeat snapshot includes forbidden_content_tokens, repeated_question, memory_repeat context", () => {
    const snapshot = buildRepairRelationshipSnapshotV1({
      repairKind: "memory_repeat",
      routeKind: "daily",
      routePurpose: "main_active_accountability",
      blockedBody: "What nurturing action can you take today?",
      blockedReasons: ["memory_repeat_question"],
      laneFacts: minimalInboundFacts(),
      memoryRepeatContext: {
        prior_outbound_full_body: "Prior coach SMS",
        blocked_candidate_body: "What nurturing action can you take today?",
        repeated_question: "What nurturing action can you take?",
        repeated_phrases: ["nurturing action"],
        latest_user_answer: null,
        accountability_purpose: "Self-care",
        suggested_coaching_move: null,
        repeat_violation_reason: "repeated_recent_question",
        recommended_repair_strategy: "binary_truth_check",
        forbidden_coaching_frames: ["What nurturing action can you take?"],
        forbidden_content_tokens: ["nurturing", "action"],
        strategy_examples: ["Protected, partial, or missed?"],
      },
      forcedRepairStrategy: "binary_truth_check",
      overlapTokens: ["nurturing"],
    });

    expect(snapshot.repair_kind).toBe("memory_repeat");
    expect(snapshot.violation.repeated_question).toContain("nurturing");
    expect(snapshot.memory_repeat?.forbidden_content_tokens).toEqual(["nurturing", "action"]);
    expect(snapshot.memory_repeat?.forced_repair_strategy).toBe("binary_truth_check");
  });

  it("serialized snapshot stays <= 3500 chars", () => {
    const hugeThread = {
      ...thread72h,
      message_count: 12,
      messages: Array.from({ length: 12 }, (_, i) => ({
        ...thread72h.messages[0]!,
        at: `2026-05-${10 + i}T10:00:00.000Z`,
        body: "x".repeat(400),
      })),
    };
    const snapshot = buildRepairRelationshipSnapshotV1({
      repairKind: "thread_freshness",
      routeKind: "inbound",
      routePurpose: "v2_accountability",
      blockedBody: "body",
      blockedReasons: ["thread_freshness_reasked_completed_action"],
      laneFacts: minimalInboundFacts({
        thread: {
          ...minimalInboundFacts().thread,
          memory_packet: { recent_exact_thread_72h: hugeThread },
        },
      }),
      freshness: lunchFreshness,
    });
    const { json, meta } = serializeRepairSnapshotForOpenAI(snapshot);
    expect(json.length).toBeLessThanOrEqual(DEFAULT_REPAIR_SNAPSHOT_MAX_CHARS);
    expect(meta.repair_snapshot_chars).toBeLessThanOrEqual(DEFAULT_REPAIR_SNAPSHOT_MAX_CHARS);
  });

  it("old thread messages trim before structured_recent_truth", () => {
    const hugeThread = {
      ...thread72h,
      message_count: 12,
      messages: Array.from({ length: 12 }, (_, i) => ({
        ...thread72h.messages[0]!,
        at: `2026-05-${10 + i}T10:00:00.000Z`,
        body: `message ${i}`,
      })),
    };
    const snapshot = buildRepairRelationshipSnapshotV1({
      repairKind: "thread_freshness",
      routeKind: "inbound",
      routePurpose: "v2_accountability",
      blockedBody: "body",
      blockedReasons: ["thread_freshness_reasked_completed_action"],
      laneFacts: minimalInboundFacts({
        thread: {
          ...minimalInboundFacts().thread,
          memory_packet: {
            recent_exact_thread_72h: hugeThread,
            last_5_coach_questions: ["q1", "q2", "q3"],
          },
        },
      }),
      freshness: lunchFreshness,
    });
    const beforeCoachCount = snapshot.structured_recent_truth.last_5_coach_questions?.length ?? 0;
    const { snapshot: trimmed } = trimRepairSnapshotToBudget(
      snapshot,
      JSON.stringify(snapshot).length - 50
    );
    expect(trimmed.recent_exact_thread_excerpt.messages.length).toBeLessThan(12);
    expect(trimmed.structured_recent_truth.last_5_coach_questions?.length ?? 0).toBe(
      beforeCoachCount
    );
  });

  it("no coaching_summary / 7d / 30d memory included", () => {
    const snapshot = buildRepairRelationshipSnapshotV1({
      repairKind: "thread_freshness",
      routeKind: "inbound",
      routePurpose: "v2_accountability",
      blockedBody: "stale",
      blockedReasons: ["thread_freshness_reasked_completed_action"],
      laneFacts: minimalInboundFacts(),
      freshness: lunchFreshness,
    });
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain("coaching_summary");
    expect(json).not.toContain("relationship_memory_7d");
    expect(json).not.toContain("relationship_memory_30d");
  });

  it("proof_victory_permission defaults safe when facts sparse", () => {
    const snapshot = buildRepairRelationshipSnapshotV1({
      repairKind: "thread_freshness",
      routeKind: "inbound",
      routePurpose: "v2_accountability",
      blockedBody: "stale",
      blockedReasons: ["thread_freshness_reasked_completed_action"],
      laneFacts: { thread_freshness: lunchFreshness as ThreadFreshnessFacts },
      freshness: lunchFreshness,
    });
    expect(snapshot.proof_victory_permission?.can_reference_victory_room).toBeNull();
    expect(snapshot.proof_victory_permission?.can_say_saved_as_proof).toBe(false);
  });

  it("lane_post_validate snapshot includes blocked reasons, thread excerpt, and constraints", () => {
    const snapshot = buildRepairRelationshipSnapshotV1({
      repairKind: "lane_post_validate",
      routeKind: "inbound",
      routePurpose: "v2_accountability",
      blockedBody: "Let me know how it went with your calls today!",
      blockedReasons: ["let_me_know_how_it_went", "too_many_sentences"],
      laneFacts: minimalInboundFacts({
        thread: {
          ...minimalInboundFacts().thread,
          rejected_time_candidates: ["2 PM", "tomorrow morning"],
        },
        constraints: {
          max_chars: 320,
          forbidden_substrings: ["great job"],
          required_verbatim_substrings: [],
        },
      }),
      laneBlockedReasons: ["let_me_know_how_it_went", "too_many_sentences", "great_job"],
    });

    expect(snapshot.repair_kind).toBe("lane_post_validate");
    expect(snapshot.violation.blocked_body).toContain("Let me know how it went");
    expect(snapshot.violation.lane_blocked_reasons).toContain("great_job");
    expect(snapshot.violation.rejected_time_candidates).toEqual(["2 PM", "tomorrow morning"]);
    expect(snapshot.recent_exact_thread_excerpt.messages.length).toBeGreaterThan(0);
    expect(snapshot.canonical_state_min.required_constraints?.forbidden_substrings).toContain(
      "great job"
    );
    expect(snapshot.canonical_state_min.required_constraints?.rejected_time_candidates).toEqual([
      "2 PM",
      "tomorrow morning",
    ]);
  });

  it("lane_post_validate snapshot stays under budget and excludes long memory blobs", () => {
    const snapshot = buildRepairRelationshipSnapshotV1({
      repairKind: "lane_post_validate",
      routeKind: "daily",
      routePurpose: "main_active_accountability",
      blockedBody: "Too long coaching copy with filler.",
      blockedReasons: ["too_long"],
      laneFacts: minimalInboundFacts(),
      laneBlockedReasons: ["too_long"],
    });
    const { json } = serializeRepairSnapshotForOpenAI(snapshot);
    expect(json.length).toBeLessThanOrEqual(DEFAULT_REPAIR_SNAPSHOT_MAX_CHARS);
    expect(json).not.toContain("coaching_summary");
    expect(json).not.toContain("relationship_memory_7d");
    expect(json).not.toContain("relationship_memory_30d");
  });

  it("robot_consent_menu snapshot includes robot_menu_blocked_reasons, blocked body, turn, thread excerpt, canonical state min", () => {
    const binding = "I will text or call each day.";
    const snapshot = buildRepairRelationshipSnapshotV1({
      repairKind: "robot_consent_menu",
      routeKind: "daily",
      routePurpose: "contract_prompt",
      blockedBody: `Welcome back! ${binding} Reply YES or NO.`,
      blockedReasons: ["robot_menu_reply_yes_no"],
      robotMenuBlockedReasons: ["robot_menu_reply_yes_no", "robot_menu_yes_to_confirm"],
      laneFacts: {
        route_kind: "contract_prompt",
        accountability_day_key: "2026-05-12",
        user: { local_time_iso: "2026-05-18T12:00:00.000Z", preferred_name: "Diane" },
        commitment: {
          id: "cmt_1",
          behavior_statement: "Text or call each day",
          effective_ask: "Text or call each day",
          accountability_phase: "active_accountability",
        },
        accountability: {
          daily_purpose: "contract_overlay_proposal",
          contract_proposal_mode: true,
        },
        thread_memory: {
          recent_exact_thread_72h: thread72h,
          relationship_memory_7d: { window_days: 7, recurring_blockers: [] },
          relationship_memory_30d: { window_days: 30, coaching_summary: "should not appear" },
        },
        constraints: {
          max_chars: 300,
          required_verbatim_substrings: [binding],
        },
      },
      bindingTextVerbatim: binding,
    });

    expect(snapshot.repair_kind).toBe("robot_consent_menu");
    expect(snapshot.violation.blocked_body).toContain("Reply YES or NO");
    expect(snapshot.violation.robot_menu_blocked_reasons).toEqual([
      "robot_menu_reply_yes_no",
      "robot_menu_yes_to_confirm",
    ]);
    expect(snapshot.current_turn.route_kind).toBe("contract_prompt");
    expect(snapshot.current_turn.daily_purpose).toBe("contract_overlay_proposal");
    expect(snapshot.recent_exact_thread_excerpt.messages.length).toBeGreaterThan(0);
    expect(snapshot.canonical_state_min.effective_ask).toBe("Text or call each day");
    expect(snapshot.canonical_state_min.required_constraints?.binding_text_verbatim).toBe(binding);
    expect(snapshot.canonical_state_min.required_constraints?.max_chars).toBe(300);
  });

  it("robot_consent_menu snapshot excludes coaching_summary / 7d / 30d memory", () => {
    const snapshot = buildRepairRelationshipSnapshotV1({
      repairKind: "robot_consent_menu",
      routeKind: "daily",
      routePurpose: "contract_prompt",
      blockedBody: "Reply YES to confirm.",
      blockedReasons: ["robot_menu_reply_yes_no"],
      laneFacts: {
        route_kind: "contract_prompt",
        accountability_day_key: "2026-05-12",
        user: { local_time_iso: "2026-05-18T12:00:00.000Z" },
        commitment: { effective_ask: "Daily check-in" },
        accountability: { daily_purpose: "contract_overlay_proposal" },
        thread_memory: {
          recent_exact_thread_72h: thread72h,
          relationship_memory_7d: { window_days: 7 },
          relationship_memory_30d: { window_days: 30, coaching_summary: "hidden prose" },
        },
        constraints: { max_chars: 300 },
      },
    });
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain("coaching_summary");
    expect(json).not.toContain("relationship_memory_7d");
    expect(json).not.toContain("relationship_memory_30d");
  });

  it("contract_wrapper snapshot includes wrapper_blocked_reasons, blocked body, turn, thread excerpt, canonical state min", () => {
    const binding = "I will text or call each day.";
    const wrapperForbidden = ["keep this line", "7 days", "same focus"];
    const snapshot = buildRepairRelationshipSnapshotV1({
      repairKind: "contract_wrapper",
      routeKind: "daily",
      routePurpose: "contract_prompt",
      blockedBody: `keep this line — ${binding} — we'll keep this line steady.`,
      blockedReasons: ["contract_wrapper_duplicate:keep this line"],
      wrapperBlockedReasons: ["contract_wrapper_duplicate:keep this line"],
      bindingTextVerbatim: binding,
      wrapperMustNotRepeatSubstrings: wrapperForbidden,
      laneFacts: {
        route_kind: "contract_prompt",
        accountability_day_key: "2026-05-12",
        user: { local_time_iso: "2026-05-18T12:00:00.000Z", preferred_name: "Diane" },
        commitment: {
          id: "cmt_1",
          behavior_statement: "Text or call each day",
          effective_ask: "Text or call each day",
          accountability_phase: "active_accountability",
        },
        accountability: {
          daily_purpose: "contract_overlay_proposal",
          contract_proposal_mode: true,
        },
        thread_memory: {
          recent_exact_thread_72h: thread72h,
          relationship_memory_7d: { window_days: 7, recurring_blockers: [] },
          relationship_memory_30d: { window_days: 30, coaching_summary: "should not appear" },
        },
        constraints: {
          max_chars: 300,
          required_verbatim_substrings: [binding],
          wrapper_must_not_repeat_substrings: wrapperForbidden,
          forbidden_substrings: ["great job"],
        },
      },
    });

    expect(snapshot.repair_kind).toBe("contract_wrapper");
    expect(snapshot.violation.blocked_body).toContain("keep this line");
    expect(snapshot.violation.wrapper_blocked_reasons).toEqual([
      "contract_wrapper_duplicate:keep this line",
    ]);
    expect(snapshot.current_turn.route_kind).toBe("contract_prompt");
    expect(snapshot.recent_exact_thread_excerpt.messages.length).toBeGreaterThan(0);
    expect(snapshot.canonical_state_min.required_constraints?.binding_text_verbatim).toBe(binding);
    expect(snapshot.canonical_state_min.required_constraints?.wrapper_must_not_repeat_substrings).toEqual(
      wrapperForbidden
    );
    expect(snapshot.canonical_state_min.required_constraints?.required_verbatim_substrings).toEqual([binding]);
    expect(snapshot.canonical_state_min.required_constraints?.forbidden_substrings).toEqual(["great job"]);
  });

  it("contract_wrapper snapshot excludes coaching_summary / 7d / 30d memory", () => {
    const binding = "Daily bar.";
    const snapshot = buildRepairRelationshipSnapshotV1({
      repairKind: "contract_wrapper",
      routeKind: "daily",
      routePurpose: "contract_prompt",
      blockedBody: `Wrapper dup ${binding}`,
      blockedReasons: ["contract_wrapper_duplicate:keep this line"],
      bindingTextVerbatim: binding,
      laneFacts: {
        route_kind: "contract_prompt",
        accountability_day_key: "2026-05-12",
        user: { local_time_iso: "2026-05-18T12:00:00.000Z" },
        commitment: { effective_ask: "Daily check-in" },
        accountability: { daily_purpose: "contract_overlay_proposal" },
        thread_memory: {
          recent_exact_thread_72h: thread72h,
          relationship_memory_7d: { window_days: 7 },
          relationship_memory_30d: { window_days: 30, coaching_summary: "hidden prose" },
        },
        constraints: { max_chars: 300, required_verbatim_substrings: [binding] },
      },
    });
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain("coaching_summary");
    expect(json).not.toContain("relationship_memory_7d");
    expect(json).not.toContain("relationship_memory_30d");
  });

  it("contract_wrapper binding_text_verbatim survives serialize even when snapshot exceeds budget", () => {
    const binding = "I will text or call each day — exact binding phrase.";
    const hugeThread = {
      ...thread72h,
      message_count: 12,
      messages: Array.from({ length: 12 }, (_, i) => ({
        ...thread72h.messages[0]!,
        at: `2026-05-${10 + i}T10:00:00.000Z`,
        body: "x".repeat(500),
      })),
    };
    const snapshot = buildRepairRelationshipSnapshotV1({
      repairKind: "contract_wrapper",
      routeKind: "daily",
      routePurpose: "contract_prompt",
      blockedBody: `keep this line — ${binding}`,
      blockedReasons: ["contract_wrapper_duplicate:keep this line"],
      bindingTextVerbatim: binding,
      wrapperMustNotRepeatSubstrings: ["keep this line"],
      laneFacts: {
        route_kind: "contract_prompt",
        accountability_day_key: "2026-05-12",
        user: { local_time_iso: "2026-05-18T12:00:00.000Z" },
        commitment: { effective_ask: "Daily check-in" },
        accountability: { daily_purpose: "contract_overlay_proposal" },
        thread_memory: { recent_exact_thread_72h: hugeThread },
        constraints: { max_chars: 300, required_verbatim_substrings: [binding] },
      },
    });
    const { json } = serializeRepairSnapshotForOpenAI(snapshot, 800);
    expect(json).toContain(binding);
    expect(JSON.parse(json).canonical_state_min.required_constraints.binding_text_verbatim).toBe(binding);
  });
});

describe("buildRepairSnapshotPromptGuidance", () => {
  it("includes authority rules", () => {
    const g = buildRepairSnapshotPromptGuidance();
    expect(g).toContain("REPAIR_SNAPSHOT_AUTHORITY");
    expect(g).toContain("structured_recent_truth");
    expect(g).toContain("fail closed");
  });
});
