/**
 * Unified read-only active_pending_state for Relationship Snapshot v2.
 * Does not route, mutate, or clear pending state — Writer context only.
 */

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";
import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";
import type { WeeklyV3OutboundFacts } from "@/lib/v3-weekly-outbound-relationship-lane";

export const ACTIVE_PENDING_STATE_AUTHORITY = "server_state_authoritative" as const;

export type ActivePendingStateItemKind =
  | "blocker_capture"
  | "memory_confirmation"
  | "pending_resolution"
  | "contract_proposal"
  | "adaptive_proposal"
  | "refresh_session"
  | "handoff"
  | "goal_adjustment"
  | "open_question"
  | "pending_plan_proof";

export type ActivePendingStateItem = {
  kind: ActivePendingStateItemKind;
  active: boolean;
  summary: string;
  evidence_preview?: string;
  expires_at?: string | null;
  created_at?: string | null;
  must_not_claim_resolved: boolean;
  allowed_writer_reference?: string;
  forbidden_writer_claims?: string[];
};

export type ActivePendingState = {
  authority: typeof ACTIVE_PENDING_STATE_AUTHORITY;
  items: ActivePendingStateItem[];
};

export type ActivePendingStateSource = "commitment_row" | "facts_fallback" | "mixed";

export type ActivePendingKindTrack = {
  rowKinds: ActivePendingStateItemKind[];
  factsKinds: ActivePendingStateItemKind[];
};

export type ActivePendingStateBuildMeta = {
  active_pending_state_source: ActivePendingStateSource;
  active_pending_state_has_commitment_row: boolean;
  row_authoritative_pending_kinds: ActivePendingStateItemKind[];
  facts_fallback_pending_kinds: ActivePendingStateItemKind[];
};

export type ActivePendingStateBuildResult = {
  state: ActivePendingState;
  meta: ActivePendingStateBuildMeta;
};

export type BuildActivePendingStateExtras = {
  nowMs?: number;
  openQuestionPending?: boolean | null;
  latestOpenQuestion?: string | null;
  pendingPlanProofActive?: boolean;
  handoffPending?: boolean;
  memoryConfirmationPending?: boolean;
  contractProposalPending?: boolean;
  goalAdjustmentPending?: boolean;
  blockerSummary?: string | null;
  memoryConfirmationSummary?: string | null;
  pendingResolutionSummary?: string | null;
  handoffSummary?: string | null;
};

function pushItem(items: ActivePendingStateItem[], item: ActivePendingStateItem | null): void {
  if (item) items.push(item);
}

export function emptyActivePendingKindTrack(): ActivePendingKindTrack {
  return { rowKinds: [], factsKinds: [] };
}

function dedupeKinds(kinds: ActivePendingStateItemKind[]): ActivePendingStateItemKind[] {
  return [...new Set(kinds)];
}

export function finalizeActivePendingStateBuildMeta(
  hasCommitmentRow: boolean,
  track: ActivePendingKindTrack
): ActivePendingStateBuildMeta {
  const rowKinds = dedupeKinds(track.rowKinds);
  const factsKinds = dedupeKinds(track.factsKinds);
  let source: ActivePendingStateSource;
  if (hasCommitmentRow && rowKinds.length > 0 && factsKinds.length > 0) {
    source = "mixed";
  } else if (hasCommitmentRow && rowKinds.length > 0) {
    source = "commitment_row";
  } else {
    source = "facts_fallback";
  }
  return {
    active_pending_state_source: source,
    active_pending_state_has_commitment_row: hasCommitmentRow,
    row_authoritative_pending_kinds: rowKinds,
    facts_fallback_pending_kinds: factsKinds,
  };
}

function pushTrackedItem(
  items: ActivePendingStateItem[],
  track: ActivePendingKindTrack | undefined,
  source: "row" | "facts",
  item: ActivePendingStateItem | null
): void {
  if (!item) return;
  items.push(item);
  if (track) {
    if (source === "row") track.rowKinds.push(item.kind);
    else track.factsKinds.push(item.kind);
  }
}

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function isBlockerCapturePendingActive(row: ActiveV2CommitmentRow, nowMs: number): boolean {
  const exp = parseMs(row.blocker_capture_expires_at);
  return exp != null && nowMs < exp;
}

function isV2AdaptiveOverlayActive(row: ActiveV2CommitmentRow, nowMs: number): boolean {
  const text = row.adaptive_ask_text?.trim();
  const from = parseMs(row.adaptive_ask_active_from);
  const exp = parseMs(row.adaptive_ask_expires_at);
  if (!text || from == null || exp == null) return false;
  return nowMs >= from && nowMs < exp;
}

function isV2PendingProposalValid(row: ActiveV2CommitmentRow, nowMs: number): boolean {
  const text = row.adaptive_proposal_text?.trim();
  const exp = parseMs(row.adaptive_proposal_expires_at);
  if (!text || exp == null) return false;
  return nowMs < exp;
}

function isRefreshSessionActive(row: ActiveV2CommitmentRow): boolean {
  return row.refresh_session != null && typeof row.refresh_session === "object";
}

function getPendingResolutionOrNull(row: ActiveV2CommitmentRow): {
  kind: string;
  createdAt: string;
  expiresAt: string;
} | null {
  const kind = row.pending_resolution_kind?.trim();
  const created = row.pending_resolution_created_at?.trim() ?? "";
  const expires = row.pending_resolution_expires_at?.trim() ?? "";
  if (!kind || !created || !expires) return null;
  return { kind, createdAt: created, expiresAt: expires };
}

function isPendingResolutionExpired(row: ActiveV2CommitmentRow, nowMs: number): boolean {
  const exp = parseMs(row.pending_resolution_expires_at);
  return exp == null || nowMs >= exp;
}

export function buildActivePendingStateFromCommitmentRow(
  row: ActiveV2CommitmentRow | null | undefined,
  extras?: BuildActivePendingStateExtras,
  track?: ActivePendingKindTrack
): ActivePendingState {
  const nowMs = extras?.nowMs ?? Date.now();
  const items: ActivePendingStateItem[] = [];

  if (row) {
    if (isBlockerCapturePendingActive(row, nowMs)) {
      pushTrackedItem(items, track, "row", {
        kind: "blocker_capture",
        active: true,
        summary: "Blocker capture window is open — user may still send blocker detail.",
        evidence_preview: extras?.blockerSummary?.trim() || row.blocker_capture_after_event || undefined,
        expires_at: row.blocker_capture_expires_at,
        created_at: null,
        must_not_claim_resolved: true,
        allowed_writer_reference: "acknowledge_blocker_capture_window",
        forbidden_writer_claims: ["blocker_already_resolved", "blocker_capture_closed"],
      });
    }

    const pending = getPendingResolutionOrNull(row);
    if (pending && !isPendingResolutionExpired(row, nowMs)) {
      pushTrackedItem(items, track, "row", {
        kind: "pending_resolution",
        active: true,
        summary: `Pending resolution (${pending.kind}) awaiting user confirmation.`,
        evidence_preview: extras?.pendingResolutionSummary?.trim() || pending.kind,
        expires_at: pending.expiresAt,
        created_at: pending.createdAt,
        must_not_claim_resolved: true,
        allowed_writer_reference: "reference_pending_resolution_kind_only",
        forbidden_writer_claims: ["commitment_already_changed", "pending_resolution_cleared"],
      });
    }

    if (isRefreshSessionActive(row)) {
      pushTrackedItem(items, track, "row", {
        kind: "refresh_session",
        active: true,
        summary: "Refresh session is active on commitment row.",
        expires_at: null,
        created_at: row.commitment_refresh_last_prompted_at,
        must_not_claim_resolved: true,
        allowed_writer_reference: "refresh_session_step_context",
        forbidden_writer_claims: ["refresh_already_completed"],
      });
    }

    if (isV2PendingProposalValid(row, nowMs)) {
      pushTrackedItem(items, track, "row", {
        kind: "adaptive_proposal",
        active: true,
        summary: "Adaptive contract proposal pending user yes/no.",
        evidence_preview: row.adaptive_proposal_text?.trim().slice(0, 120) || undefined,
        expires_at: row.adaptive_proposal_expires_at,
        created_at: row.adaptive_proposal_created_at,
        must_not_claim_resolved: true,
        allowed_writer_reference: "reference_proposal_pending_not_active",
        forbidden_writer_claims: ["goal_already_updated", "overlay_already_active", "proposal_already_accepted"],
      });
    }

    if (isV2AdaptiveOverlayActive(row, nowMs)) {
      pushTrackedItem(items, track, "row", {
        kind: "contract_proposal",
        active: true,
        summary: "Adaptive overlay ask is active (temporary coaching bar).",
        evidence_preview: row.adaptive_ask_text?.trim().slice(0, 120) || undefined,
        expires_at: row.adaptive_ask_expires_at,
        created_at: row.adaptive_ask_active_from,
        must_not_claim_resolved: false,
        allowed_writer_reference: "effective_ask_overlay_active",
        forbidden_writer_claims: ["base_commitment_is_current_ask"],
      });
    }
  }

  if (extras?.memoryConfirmationPending) {
    pushTrackedItem(items, track, "facts", {
      kind: "memory_confirmation",
      active: true,
      summary: "Memory confirmation pending user reply.",
      evidence_preview: extras.memoryConfirmationSummary?.trim() || undefined,
      must_not_claim_resolved: true,
      allowed_writer_reference: "memory_confirmation_pending_flags",
      forbidden_writer_claims: ["memory_already_applied", "memory_already_declined"],
    });
  }

  if (extras?.handoffPending) {
    pushTrackedItem(items, track, "facts", {
      kind: "handoff",
      active: true,
      summary: "Commitment change handoff pending resolution.",
      evidence_preview: extras.handoffSummary?.trim() || undefined,
      must_not_claim_resolved: true,
      allowed_writer_reference: "handoff_server_owned_next_steps",
      forbidden_writer_claims: ["commitment_row_already_changed"],
    });
  }

  if (extras?.openQuestionPending && extras.latestOpenQuestion?.trim()) {
    pushTrackedItem(items, track, "facts", {
      kind: "open_question",
      active: true,
      summary: "Open coach question awaiting user answer.",
      evidence_preview: extras.latestOpenQuestion.trim().slice(0, 160),
      must_not_claim_resolved: true,
      allowed_writer_reference: "latest_open_question",
      forbidden_writer_claims: ["open_question_already_answered"],
    });
  }

  if (extras?.pendingPlanProofActive) {
    pushTrackedItem(items, track, "facts", {
      kind: "pending_plan_proof",
      active: true,
      summary: "User gave a forward plan — proof of execution still pending.",
      must_not_claim_resolved: true,
      allowed_writer_reference: "pending_plan_proof_context",
      forbidden_writer_claims: ["plan_already_proven", "outcome_already_confirmed"],
    });
  }

  if (extras?.contractProposalPending) {
    pushTrackedItem(items, track, "facts", {
      kind: "contract_proposal",
      active: true,
      summary: "Contract overlay proposal pending user confirmation.",
      must_not_claim_resolved: true,
      allowed_writer_reference: "contract_proposal_pending",
      forbidden_writer_claims: ["goal_already_updated"],
    });
  }

  if (extras?.goalAdjustmentPending) {
    pushTrackedItem(items, track, "facts", {
      kind: "goal_adjustment",
      active: true,
      summary: "Goal adjustment evidence present — mention only when server allows.",
      must_not_claim_resolved: true,
      allowed_writer_reference: "goal_adjustment_when_allowed",
      forbidden_writer_claims: ["goal_already_adjusted_without_evidence"],
    });
  }

  return { authority: ACTIVE_PENDING_STATE_AUTHORITY, items };
}

export function buildActivePendingStateFromInboundFacts(
  f: InboundV3RelationshipFacts,
  commitmentRow?: ActiveV2CommitmentRow | null,
  nowMs: number = Date.now()
): ActivePendingStateBuildResult {
  const track = emptyActivePendingKindTrack();
  const hasCommitmentRow = Boolean(commitmentRow);
  const mp = f.thread.memory_packet;
  const state = buildActivePendingStateFromCommitmentRow(commitmentRow, {
    nowMs,
    openQuestionPending: mp?.open_question_pending ?? f.thread.latest_open_question != null,
    latestOpenQuestion: f.thread.latest_open_question ?? mp?.latest_open_question ?? null,
    memoryConfirmationPending: Boolean(f.memory_confirmation_facts),
    memoryConfirmationSummary: f.memory_confirmation_facts
      ? `${f.memory_confirmation_facts.pending_memory_kind}: ${f.memory_confirmation_facts.user_confirmation_parse}`
      : null,
    handoffPending: f.route_purpose === "commitment_change_handoff",
    handoffSummary: f.commitment_change_facts?.server_state_transition_summary ?? null,
    pendingResolutionSummary: f.pending_resolution_facts?.state_transition_summary ?? null,
    goalAdjustmentPending:
      f.v2_accountability?.goal_adjustment_mention_allowed === true ||
      f.miss_adjustment_policy?.adjustment_proposal_allowed_by_evidence === true,
    blockerSummary: f.blocker_facts?.blocker_text ?? null,
    contractProposalPending: Boolean(f.contract_consent_facts),
  }, track);

  const remaining =
    f.blocker_facts?.blocker_pending_age_minutes_remaining != null &&
    f.blocker_facts.blocker_pending_age_minutes_remaining > 0;
  if (remaining && !state.items.some((i) => i.kind === "blocker_capture")) {
    pushTrackedItem(state.items, track, "facts", {
      kind: "blocker_capture",
      active: true,
      summary: "Blocker capture window is open — user may still send blocker detail.",
      evidence_preview: f.blocker_facts?.blocker_text?.trim() || undefined,
      expires_at: new Date(
        nowMs + (f.blocker_facts?.blocker_pending_age_minutes_remaining ?? 0) * 60_000
      ).toISOString(),
      must_not_claim_resolved: true,
      allowed_writer_reference: "acknowledge_blocker_capture_window",
      forbidden_writer_claims: ["blocker_already_resolved", "blocker_capture_closed"],
    });
  }

  if (f.pending_resolution_facts && !state.items.some((i) => i.kind === "pending_resolution")) {
    pushTrackedItem(state.items, track, "facts", {
      kind: "pending_resolution",
      active: true,
      summary: `Pending resolution (${f.pending_resolution_facts.resolution_type}) awaiting user confirmation.`,
      evidence_preview: f.pending_resolution_facts.state_transition_summary,
      must_not_claim_resolved: true,
      allowed_writer_reference: "reference_pending_resolution_kind_only",
      forbidden_writer_claims: ["commitment_already_changed", "pending_resolution_cleared"],
    });
  }

  if (f.refresh_facts && !state.items.some((i) => i.kind === "refresh_session")) {
    pushTrackedItem(state.items, track, "facts", {
      kind: "refresh_session",
      active: true,
      summary: `Refresh session step: ${f.refresh_facts.refresh_step}.`,
      must_not_claim_resolved: true,
      allowed_writer_reference: "refresh_session_step_context",
      forbidden_writer_claims: ["refresh_already_completed"],
    });
  }

  return { state, meta: finalizeActivePendingStateBuildMeta(hasCommitmentRow, track) };
}

function buildSyntheticDailyCommitmentRow(f: DailyV3RelationshipFacts): ActiveV2CommitmentRow {
  return {
    id: f.commitment.id,
    clerk_user_id: f.user.clerk_user_id,
    status: "active",
    behavior_statement: f.commitment.behavior_statement,
    title: f.commitment.title ?? "",
    success_criteria: null,
    blocker_capture_expires_at: null,
    blocker_capture_after_event: null,
    adaptive_ask_text: f.accountability.overlay_active ? f.commitment.effective_ask : null,
    adaptive_ask_active_from: null,
    adaptive_ask_expires_at: null,
    adaptive_proposal_text: f.contract_proposal?.binding_text_verbatim ?? null,
    adaptive_proposal_created_at: null,
    adaptive_proposal_expires_at: null,
    accountability_phase: f.commitment.accountability_phase,
    reactivation_entered_at: null,
    reactivation_last_sent_at: null,
    reactivation_entry_reason_code: null,
    refresh_session: f.refresh ? { step: f.refresh.refresh_step } : null,
    commitment_refresh_last_prompted_at: null,
    pending_resolution_kind: f.pending_resolution?.resolution_kind,
    pending_resolution_created_at: null,
    pending_resolution_expires_at: f.pending_resolution?.expires_at ?? null,
    pending_resolution_payload: null,
    updated_at: null,
    started_at: null,
  } as ActiveV2CommitmentRow;
}

export function buildActivePendingStateFromDailyFacts(
  f: DailyV3RelationshipFacts,
  commitmentRow?: ActiveV2CommitmentRow | null,
  nowMs: number = Date.now()
): ActivePendingStateBuildResult {
  const track = emptyActivePendingKindTrack();
  const tm = f.thread_memory;
  const hasCommitmentRow = Boolean(commitmentRow);
  const row = commitmentRow ?? buildSyntheticDailyCommitmentRow(f);
  const state = buildActivePendingStateFromCommitmentRow(
    row,
    {
      nowMs,
      openQuestionPending: tm.open_question_pending ?? false,
      latestOpenQuestion: tm.latest_open_question,
      pendingPlanProofActive: f.accountability.pending_plan_proof?.active === true,
      contractProposalPending: Boolean(f.contract_proposal),
      pendingResolutionSummary: f.pending_resolution?.candidate_behavior_snippet ?? null,
      goalAdjustmentPending: f.accountability.goal_adjustment_mention_allowed === true,
    },
    track
  );

  if (!hasCommitmentRow) {
    track.factsKinds.push(...track.rowKinds);
    track.rowKinds = [];
  }

  return { state, meta: finalizeActivePendingStateBuildMeta(hasCommitmentRow, track) };
}

export function buildActivePendingStateFromWeeklyFacts(
  f: WeeklyV3OutboundFacts,
  commitmentRow?: ActiveV2CommitmentRow | null,
  nowMs: number = Date.now()
): ActivePendingStateBuildResult {
  const track = emptyActivePendingKindTrack();
  const t = f.thread;
  const hasCommitmentRow = Boolean(commitmentRow);
  const state = buildActivePendingStateFromCommitmentRow(
    commitmentRow ?? null,
    {
      nowMs,
      openQuestionPending: t.open_question_pending ?? false,
      latestOpenQuestion: t.latest_open_question,
      pendingPlanProofActive: false,
    },
    track
  );

  return { state, meta: finalizeActivePendingStateBuildMeta(hasCommitmentRow, track) };
}
