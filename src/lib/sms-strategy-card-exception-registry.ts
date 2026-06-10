/**
 * Signed registry of intentional non–Strategy Card SMS surfaces (Phase 4.9a).
 * Documentation-oriented — not imported by production routing.
 */

import type { StrategyCardRouteKind } from "@/lib/coaching-strategy-card-v1";

export type StrategyCardExceptionClassification =
  | "hard_route_deterministic"
  | "state_machine_transactional"
  | "deferred_env_gated"
  | "app_driven_constrained"
  | "deprecated_no_visible_sms";

export type StrategyCardExceptionDisposition =
  | "never_strategy_card"
  | "document_and_monitor"
  | "monitor_production_volume"
  | "defer_strategy_card"
  | "keep_no_send_retire_when_safe";

export type StrategyCardExceptionEntry = {
  id: string;
  surface_label: string;
  route_identifiers: string[];
  classification: StrategyCardExceptionClassification;
  owner: "sms-platform";
  disposition: StrategyCardExceptionDisposition;
  reason: string;
  action: string;
};

/** Live Strategy Card route kinds — must not appear in {@link SMS_STRATEGY_CARD_EXCEPTIONS}. */
export const ACTIVE_STRATEGY_CARD_ROUTE_KINDS = [
  "normal_inbound_reply",
  "open_question_answer",
  "arc_clarify_ambiguous_short",
  "central_brain_pivot",
  "main_active_accountability",
  "low_pressure_reactivation",
  "contract_prompt",
  "pending_resolution",
  "refresh_identity",
  "refresh_commitment",
  "weekly_proof_v2",
] as const satisfies readonly StrategyCardRouteKind[];

export const SMS_STRATEGY_CARD_EXCEPTIONS: readonly StrategyCardExceptionEntry[] = [
  {
    id: "hard_stop",
    surface_label: "SMS STOP / opt-out",
    route_identifiers: ["stop", "sms_stop", "opt_out"],
    classification: "hard_route_deterministic",
    owner: "sms-platform",
    disposition: "never_strategy_card",
    reason: "Legal/compliance opt-out; deterministic handler, not coaching.",
    action: "never Strategy Card",
  },
  {
    id: "hard_help",
    surface_label: "SMS HELP",
    route_identifiers: ["help", "sms_help"],
    classification: "hard_route_deterministic",
    owner: "sms-platform",
    disposition: "never_strategy_card",
    reason: "Compliance help response; not relationship coaching.",
    action: "never Strategy Card",
  },
  {
    id: "hard_start",
    surface_label: "SMS START / re-subscribe",
    route_identifiers: ["start", "sms_start"],
    classification: "hard_route_deterministic",
    owner: "sms-platform",
    disposition: "never_strategy_card",
    reason: "Compliance re-subscribe; not coaching move.",
    action: "never Strategy Card",
  },
  {
    id: "hard_crisis_safety",
    surface_label: "Crisis / safety inbound",
    route_identifiers: ["crisis", "safety", "sms_inbound_safety"],
    classification: "hard_route_deterministic",
    owner: "sms-platform",
    disposition: "never_strategy_card",
    reason: "Safety gate owns visible SMS or no-send; not coaching strategy.",
    action: "never Strategy Card",
  },
  {
    id: "hard_onboarding_consent",
    surface_label: "Onboarding / consent templates",
    route_identifiers: ["onboarding_consent", "onboarding_sms"],
    classification: "hard_route_deterministic",
    owner: "sms-platform",
    disposition: "never_strategy_card",
    reason: "Transactional consent copy; not relationship coaching lane.",
    action: "never Strategy Card",
  },
  {
    id: "hard_tapback_suppressed",
    surface_label: "Tapbacks / suppressed inbound",
    route_identifiers: ["suppressed_no_send", "tapback", "suppressed_message"],
    classification: "hard_route_deterministic",
    owner: "sms-platform",
    disposition: "never_strategy_card",
    reason: "No visible coaching SMS or coalesced into parent turn.",
    action: "never Strategy Card",
  },
  {
    id: "hard_compliance_templates",
    surface_label: "Compliance footer / template SMS",
    route_identifiers: ["compliance_footer", "weekly_sms_compliance_footer"],
    classification: "hard_route_deterministic",
    owner: "sms-platform",
    disposition: "never_strategy_card",
    reason: "Post-guard compliance suffix; not writer coaching body.",
    action: "never Strategy Card",
  },
  {
    id: "txn_blocker_ack",
    surface_label: "Blocker capture ack",
    route_identifiers: ["blocker_capture_ack"],
    classification: "state_machine_transactional",
    owner: "sms-platform",
    disposition: "document_and_monitor",
    reason: "Server owns blocker state; ack is a transactional step.",
    action: "document and monitor; optional thin card only if telemetry shows confusion",
  },
  {
    id: "txn_central_brain_blocker_pivot",
    surface_label: "Central brain blocker pivot",
    route_identifiers: ["central_brain_blocker_pivot"],
    classification: "state_machine_transactional",
    owner: "sms-platform",
    disposition: "document_and_monitor",
    reason: "Pivot lane with ROUTE aux; no Strategy Card wired (unlike central_brain_pivot).",
    action: "document and monitor; optional thin card follow-up",
  },
  {
    id: "txn_memory_confirmation",
    surface_label: "Memory confirmation / decline / clarification",
    route_identifiers: ["memory_confirmation", "memory_decline", "memory_clarification"],
    classification: "state_machine_transactional",
    owner: "sms-platform",
    disposition: "document_and_monitor",
    reason: "Server applies memory flags before SMS; verbatim/meaning constraints dominate.",
    action: "leave state-machine-owned",
  },
  {
    id: "txn_pending_resolution_inbound",
    surface_label: "Pending resolution inbound",
    route_identifiers: ["pending_resolution"],
    classification: "state_machine_transactional",
    owner: "sms-platform",
    disposition: "document_and_monitor",
    reason: "Inbound guided-resolution step; outbound daily pending_resolution has Strategy Card.",
    action: "leave state-machine-owned on inbound",
  },
  {
    id: "txn_contract_consent",
    surface_label: "Adaptive contract consent accept/decline/noop",
    route_identifiers: [
      "adaptive_proposal_consent_accept",
      "adaptive_proposal_consent_decline",
      "adaptive_proposal_consent_noop_ack",
    ],
    classification: "state_machine_transactional",
    owner: "sms-platform",
    disposition: "document_and_monitor",
    reason: "RPC/overlay action already decided; binding verbatim dominates.",
    action: "leave state-machine-owned",
  },
  {
    id: "txn_adaptive_clarify",
    surface_label: "Adaptive proposal consent clarification",
    route_identifiers: ["adaptive_proposal_consent_clarification"],
    classification: "state_machine_transactional",
    owner: "sms-platform",
    disposition: "document_and_monitor",
    reason: "Explicit YES/NO clarify while proposal remains pending.",
    action: "leave state-machine-owned",
  },
  {
    id: "txn_commitment_handoff",
    surface_label: "Commitment change handoff",
    route_identifiers: ["commitment_change_handoff"],
    classification: "state_machine_transactional",
    owner: "sms-platform",
    disposition: "document_and_monitor",
    reason: "Pending-resolution handoff; server owns whether pending was created.",
    action: "leave state-machine-owned",
  },
  {
    id: "txn_refresh_inbound",
    surface_label: "Refresh identity / commitment inbound",
    route_identifiers: ["refresh", "refresh_identity", "refresh_commitment", "refresh_confirmation", "refresh_clarification"],
    classification: "state_machine_transactional",
    owner: "sms-platform",
    disposition: "document_and_monitor",
    reason: "Inbound refresh session with server-applied transitions; outbound refresh has Strategy Card.",
    action: "leave state-machine-owned on inbound",
  },
  {
    id: "txn_identity_edit",
    surface_label: "Identity edit integrity",
    route_identifiers: ["identity_edit_integrity"],
    classification: "state_machine_transactional",
    owner: "sms-platform",
    disposition: "document_and_monitor",
    reason: "No identity mutation from prose; integrity lane.",
    action: "leave state-machine-owned",
  },
  {
    id: "txn_relationship_exit",
    surface_label: "Relationship exit integrity",
    route_identifiers: ["relationship_exit_integrity"],
    classification: "state_machine_transactional",
    owner: "sms-platform",
    disposition: "document_and_monitor",
    reason: "Exit/billing soft opt-out; no outcome scoring.",
    action: "leave state-machine-owned",
  },
  {
    id: "txn_commitment_change_context",
    surface_label: "Commitment change context (no handoff)",
    route_identifiers: ["commitment_change_context"],
    classification: "state_machine_transactional",
    owner: "sms-platform",
    disposition: "document_and_monitor",
    reason: "Heuristic change phrasing without Wave4 pending start.",
    action: "leave state-machine-owned",
  },
  {
    id: "deferred_legacy_fallback",
    surface_label: "Conversation brain unavailable / legacy fallback",
    route_identifiers: ["conversation_brain_unavailable", "conversation_brain_legacy_disabled_lane"],
    classification: "deferred_env_gated",
    owner: "sms-platform",
    disposition: "monitor_production_volume",
    reason: "Degraded-mode writer; likely dormant under default env; Review Place covered.",
    action: "monitor volume; card-wire or retire only if volume justifies",
  },
  {
    id: "guided_shrink_contract",
    surface_label: "Guided shrink contract proposal SMS",
    route_identifiers: ["guided_shrink_contract_prompt", "guided_contract_proposal"],
    classification: "app_driven_constrained",
    owner: "sms-platform",
    disposition: "defer_strategy_card",
    reason: "App-driven C2-like proposal with unified guard + binding needle.",
    action: "defer Strategy Card; document authority model",
  },
  {
    id: "weekly_legacy_deprecated",
    surface_label: "Weekly legacy reflection / fallback summary",
    route_identifiers: ["weekly_legacy_reflection", "weekly_legacy_fallback_summary"],
    classification: "deprecated_no_visible_sms",
    owner: "sms-platform",
    disposition: "keep_no_send_retire_when_safe",
    reason: "Deprecated branch; no Twilio visible send.",
    action: "keep no-send; retire when safe",
  },
] as const;

export function allStrategyCardExceptionRouteIdentifiers(): string[] {
  return SMS_STRATEGY_CARD_EXCEPTIONS.flatMap((e) => e.route_identifiers);
}

export function isActiveStrategyCardRouteKind(routeKind: string): boolean {
  return (ACTIVE_STRATEGY_CARD_ROUTE_KINDS as readonly string[]).includes(routeKind);
}

export function findStrategyCardExceptionByRouteIdentifier(
  routeId: string
): StrategyCardExceptionEntry | undefined {
  const norm = routeId.trim();
  return SMS_STRATEGY_CARD_EXCEPTIONS.find((e) =>
    e.route_identifiers.some((id) => id === norm)
  );
}
