import { describe, expect, it } from "vitest";

import {
  ACTIVE_PENDING_STATE_AUTHORITY,
  buildActivePendingStateFromCommitmentRow,
  buildActivePendingStateFromDailyFacts,
  buildActivePendingStateFromInboundFacts,
  buildActivePendingStateFromWeeklyFacts,
  finalizeActivePendingStateBuildMeta,
} from "@/lib/sms-active-pending-state";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";
import type { InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";
import type { WeeklyV3OutboundFacts } from "@/lib/v3-weekly-outbound-relationship-lane";

function baseCommitment(overrides?: Partial<ActiveV2CommitmentRow>): ActiveV2CommitmentRow {
  const future = new Date(Date.now() + 60 * 60_000).toISOString();
  return {
    id: "cmt_1",
    clerk_user_id: "user_1",
    status: "active",
    behavior_statement: "Two hours deep work",
    title: "Focus",
    success_criteria: null,
    blocker_capture_expires_at: null,
    blocker_capture_after_event: null,
    adaptive_ask_text: null,
    adaptive_ask_active_from: null,
    adaptive_ask_expires_at: null,
    adaptive_proposal_text: null,
    adaptive_proposal_created_at: null,
    adaptive_proposal_expires_at: null,
    accountability_phase: "active_accountability",
    reactivation_entered_at: null,
    reactivation_last_sent_at: null,
    reactivation_entry_reason_code: null,
    refresh_session: null,
    commitment_refresh_last_prompted_at: null,
    pending_resolution_kind: null,
    pending_resolution_created_at: null,
    pending_resolution_expires_at: null,
    pending_resolution_payload: null,
    updated_at: null,
    started_at: null,
    ...overrides,
  };
}

describe("buildActivePendingStateFromCommitmentRow", () => {
  it("includes blocker capture pending item", () => {
    const state = buildActivePendingStateFromCommitmentRow(
      baseCommitment({
        blocker_capture_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        blocker_capture_after_event: "user_no",
      })
    );
    const item = state.items.find((i) => i.kind === "blocker_capture");
    expect(item?.active).toBe(true);
    expect(item?.must_not_claim_resolved).toBe(true);
    expect(state.authority).toBe(ACTIVE_PENDING_STATE_AUTHORITY);
  });

  it("includes adaptive proposal pending item", () => {
    const state = buildActivePendingStateFromCommitmentRow(
      baseCommitment({
        adaptive_proposal_text: "Walk ten minutes daily",
        adaptive_proposal_created_at: new Date().toISOString(),
        adaptive_proposal_expires_at: new Date(Date.now() + 48 * 60 * 60_000).toISOString(),
      })
    );
    const item = state.items.find((i) => i.kind === "adaptive_proposal");
    expect(item?.active).toBe(true);
    expect(item?.must_not_claim_resolved).toBe(true);
    expect(item?.forbidden_writer_claims).toContain("goal_already_updated");
  });

  it("includes refresh session item when active", () => {
    const state = buildActivePendingStateFromCommitmentRow(
      baseCommitment({ refresh_session: { step: "identity_first" } })
    );
    const item = state.items.find((i) => i.kind === "refresh_session");
    expect(item?.active).toBe(true);
    expect(item?.must_not_claim_resolved).toBe(true);
  });

  it("includes pending resolution item", () => {
    const state = buildActivePendingStateFromCommitmentRow(
      baseCommitment({
        pending_resolution_kind: "commitment_change",
        pending_resolution_created_at: new Date().toISOString(),
        pending_resolution_expires_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      })
    );
    const item = state.items.find((i) => i.kind === "pending_resolution");
    expect(item?.active).toBe(true);
    expect(item?.summary).toMatch(/commitment_change/);
  });

  it("includes open question and handoff from extras", () => {
    const state = buildActivePendingStateFromCommitmentRow(null, {
      openQuestionPending: true,
      latestOpenQuestion: "What time tomorrow?",
      handoffPending: true,
      handoffSummary: "User asked to change commitment",
      pendingPlanProofActive: true,
      memoryConfirmationPending: true,
      memoryConfirmationSummary: "timing_anchor: confirm",
    });
    expect(state.items.find((i) => i.kind === "open_question")?.active).toBe(true);
    expect(state.items.find((i) => i.kind === "handoff")?.active).toBe(true);
    expect(state.items.find((i) => i.kind === "pending_plan_proof")?.active).toBe(true);
    expect(state.items.find((i) => i.kind === "memory_confirmation")?.active).toBe(true);
    for (const item of state.items) {
      expect(item.kind).toBeTruthy();
      expect(typeof item.summary).toBe("string");
      expect(item.must_not_claim_resolved).toBe(true);
    }
  });
});

describe("buildActivePendingStateFromInboundFacts", () => {
  it("includes blocker and pending resolution from inbound facts", () => {
    const facts = {
      route_purpose: "pending_resolution_inbound",
      user: { clerk_user_id: "user_1" },
      thread: { memory_packet: { open_question_pending: false } },
      blocker_facts: {
        blocker_text: "Meetings stacked",
        blocker_pending_age_minutes_remaining: 45,
        following_event_type: "user_no",
      },
      pending_resolution_facts: {
        resolution_type: "commitment_change",
        state_transition_summary: "pending SMS update started",
      },
    } as unknown as InboundV3RelationshipFacts;

    const built = buildActivePendingStateFromInboundFacts(facts);
    expect(built.state.items.some((i) => i.kind === "blocker_capture")).toBe(true);
    expect(built.state.items.some((i) => i.kind === "pending_resolution")).toBe(true);
    expect(built.meta.active_pending_state_source).toBe("facts_fallback");
    expect(built.meta.active_pending_state_has_commitment_row).toBe(false);
  });

  it("row beats facts fallback when both present", () => {
    const row = baseCommitment({
      blocker_capture_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      refresh_session: { step: "identity_first" },
    });
    const facts = {
      route_purpose: "normal_inbound_reply",
      user: { clerk_user_id: "user_1" },
      thread: { memory_packet: { open_question_pending: false } },
      blocker_facts: {
        blocker_text: "Meetings stacked",
        blocker_pending_age_minutes_remaining: 45,
        following_event_type: "user_no",
      },
      refresh_facts: { refresh_step: "commitment" },
    } as unknown as InboundV3RelationshipFacts;

    const built = buildActivePendingStateFromInboundFacts(facts, row);
    expect(built.state.items.some((i) => i.kind === "blocker_capture")).toBe(true);
    expect(built.state.items.some((i) => i.kind === "refresh_session")).toBe(true);
    expect(built.meta.active_pending_state_has_commitment_row).toBe(true);
    expect(built.meta.row_authoritative_pending_kinds).toContain("blocker_capture");
    expect(built.meta.row_authoritative_pending_kinds).toContain("refresh_session");
    expect(built.meta.facts_fallback_pending_kinds).not.toContain("blocker_capture");
    expect(built.meta.facts_fallback_pending_kinds).not.toContain("refresh_session");
  });

  it("falls back to facts without row and does not throw", () => {
    const facts = {
      route_purpose: "normal_inbound_reply",
      user: { clerk_user_id: "user_1" },
      thread: { memory_packet: { open_question_pending: true, latest_open_question: "When?" } },
      refresh_facts: { refresh_step: "identity_first" },
    } as unknown as InboundV3RelationshipFacts;

    const built = buildActivePendingStateFromInboundFacts(facts, null);
    expect(built.state.items.some((i) => i.kind === "refresh_session")).toBe(true);
    expect(built.meta.active_pending_state_source).toBe("facts_fallback");
  });
});

describe("buildActivePendingStateFromDailyFacts", () => {
  it("includes contract proposal and pending plan proof from daily facts", () => {
    const facts = {
      user: { clerk_user_id: "user_1" },
      commitment: {
        id: "cmt_1",
        title: "Focus",
        behavior_statement: "Deep work",
        effective_ask: "Deep work",
        accountability_phase: "active_accountability",
      },
      thread_memory: {
        open_question_pending: true,
        latest_open_question: "Did it happen?",
      },
      accountability: {
        overlay_active: false,
        pending_plan_proof: { active: true },
        goal_adjustment_mention_allowed: false,
      },
      contract_proposal: { contract_kind: "shrink_ask", required_reply_semantics: "yes_no_binding_only" },
      pending_resolution: null,
      refresh: null,
    } as unknown as DailyV3RelationshipFacts;

    const built = buildActivePendingStateFromDailyFacts(facts);
    expect(built.state.items.some((i) => i.kind === "contract_proposal")).toBe(true);
    expect(built.state.items.some((i) => i.kind === "pending_plan_proof")).toBe(true);
    expect(built.state.items.some((i) => i.kind === "open_question")).toBe(true);
    expect(built.meta.active_pending_state_source).toBe("facts_fallback");
    expect(built.meta.active_pending_state_has_commitment_row).toBe(false);
  });

  it("uses real commitment row when provided", () => {
    const facts = {
      user: { clerk_user_id: "user_1" },
      commitment: {
        id: "cmt_1",
        title: "Focus",
        behavior_statement: "Deep work",
        effective_ask: "Deep work",
        accountability_phase: "active_accountability",
      },
      thread_memory: { open_question_pending: false },
      accountability: { overlay_active: false, goal_adjustment_mention_allowed: false },
      contract_proposal: null,
      pending_resolution: null,
      refresh: null,
    } as unknown as DailyV3RelationshipFacts;

    const row = baseCommitment({
      refresh_session: { step: "commitment" },
      pending_resolution_kind: "commitment_change",
      pending_resolution_created_at: new Date().toISOString(),
      pending_resolution_expires_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    });

    const built = buildActivePendingStateFromDailyFacts(facts, row);
    expect(built.state.items.some((i) => i.kind === "refresh_session")).toBe(true);
    expect(built.state.items.some((i) => i.kind === "pending_resolution")).toBe(true);
    expect(built.meta.active_pending_state_has_commitment_row).toBe(true);
    expect(built.meta.row_authoritative_pending_kinds).toContain("refresh_session");
    expect(built.meta.row_authoritative_pending_kinds).toContain("pending_resolution");
  });
});

describe("buildActivePendingStateFromWeeklyFacts", () => {
  it("uses commitment row when provided", () => {
    const facts = {
      thread: {
        open_question_pending: false,
        latest_open_question: null,
      },
    } as unknown as WeeklyV3OutboundFacts;
    const row = baseCommitment({
      adaptive_proposal_text: "Walk daily",
      adaptive_proposal_created_at: new Date().toISOString(),
      adaptive_proposal_expires_at: new Date(Date.now() + 48 * 60 * 60_000).toISOString(),
    });

    const built = buildActivePendingStateFromWeeklyFacts(facts, row);
    expect(built.state.items.some((i) => i.kind === "adaptive_proposal")).toBe(true);
    expect(built.meta.active_pending_state_has_commitment_row).toBe(true);
    expect(built.meta.row_authoritative_pending_kinds).toContain("adaptive_proposal");
  });
});

describe("finalizeActivePendingStateBuildMeta", () => {
  it("marks mixed when row and facts both contribute", () => {
    const meta = finalizeActivePendingStateBuildMeta(true, {
      rowKinds: ["refresh_session"],
      factsKinds: ["open_question"],
    });
    expect(meta.active_pending_state_source).toBe("mixed");
    expect(meta.active_pending_state_has_commitment_row).toBe(true);
  });

  it("keeps must_not_claim_resolved on all active items", () => {
    const state = buildActivePendingStateFromCommitmentRow(
      baseCommitment({ refresh_session: { step: "identity_first" } }),
      { openQuestionPending: true, latestOpenQuestion: "What time?" }
    );
    for (const item of state.items) {
      if (item.kind === "contract_proposal") continue;
      expect(item.must_not_claim_resolved).toBe(true);
    }
  });
});
