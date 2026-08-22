/**
 * Executable SMS surface authority registry (Phase 4.9b).
 * Test/documentation/observability only — not imported by production routing.
 */

import type { StrategyCardRouteKind } from "@/lib/coaching-strategy-card-v1";
import type { InboundV3RoutePurpose } from "@/lib/v3-inbound-relationship-lane";

export type SmsSurfaceAuthorityClassification =
  | "active_strategy_card_surface"
  | "state_machine_transactional_exception"
  | "hard_route_deterministic_exception"
  | "app_driven_constrained_exception"
  | "deferred_env_gated_exception"
  | "deprecated_no_visible_sms"
  | "suppressed_no_visible_sms";

export type SmsSurfaceFinalGuardMode =
  | "normal_coaching_full"
  | "transactional_coaching_limited"
  | "outbound_daily"
  | "outbound_weekly"
  | "hard_route_none"
  | "not_visible";

export type SmsSurfaceAuthorityOwner =
  | "strategy_card"
  | "state_machine"
  | "hard_route"
  | "app_flow"
  | "deprecated";

export type SmsSurfaceAuthorityDisposition =
  | "active"
  | "intentional_exception"
  | "deferred_monitor"
  | "deprecated"
  | "never_card";

export type SmsSurfaceAuthorityEntry = {
  id: string;
  surface_label: string;
  route_identifiers: string[];
  classification: SmsSurfaceAuthorityClassification;
  strategy_card_route_kind?: StrategyCardRouteKind | null;
  final_guard_mode?: SmsSurfaceFinalGuardMode;
  visible_sms: boolean;
  writer_path?: string | null;
  owner: SmsSurfaceAuthorityOwner;
  disposition: SmsSurfaceAuthorityDisposition;
  reason: string;
  action: string;
  /** Same route id on inbound txn vs outbound daily card — documented overlap. */
  dual_purpose_lane?: boolean;
  /** Production send caller files that may emit this surface (doc/test only). */
  send_caller_files?: readonly string[];
};

/** Live Strategy Card route kinds — must classify as active_strategy_card_surface. */
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

const CARD_ACTION = "maintain Strategy Card + final guard; monitor telemetry";

const ACTIVE_STRATEGY_CARD_SURFACES: readonly SmsSurfaceAuthorityEntry[] = [
  {
    id: "card_inbound_normal",
    surface_label: "Inbound normal reply",
    route_identifiers: ["normal_inbound_reply"],
    classification: "active_strategy_card_surface",
    strategy_card_route_kind: "normal_inbound_reply",
    final_guard_mode: "normal_coaching_full",
    visible_sms: true,
    writer_path: "src/lib/v3-inbound-relationship-lane.ts",
    owner: "strategy_card",
    disposition: "active",
    reason: "Primary inbound coaching lane with Strategy Card + unified final guard.",
    action: CARD_ACTION,
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "card_inbound_open_question",
    surface_label: "Inbound open question answer",
    route_identifiers: ["open_question_answer"],
    classification: "active_strategy_card_surface",
    strategy_card_route_kind: "open_question_answer",
    final_guard_mode: "normal_coaching_full",
    visible_sms: true,
    writer_path: "src/lib/v3-inbound-relationship-lane.ts",
    owner: "strategy_card",
    disposition: "active",
    reason: "Dedicated open-question lane with Strategy Card authority.",
    action: CARD_ACTION,
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "card_inbound_arc_clarify",
    surface_label: "Inbound arc clarify ambiguous short",
    route_identifiers: ["arc_clarify_ambiguous_short"],
    classification: "active_strategy_card_surface",
    strategy_card_route_kind: "arc_clarify_ambiguous_short",
    final_guard_mode: "normal_coaching_full",
    visible_sms: true,
    writer_path: "src/lib/v3-inbound-relationship-lane.ts",
    owner: "strategy_card",
    disposition: "active",
    reason: "Arc clarification lane with Strategy Card authority.",
    action: CARD_ACTION,
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "card_inbound_central_pivot",
    surface_label: "Inbound central brain pivot",
    route_identifiers: ["central_brain_pivot"],
    classification: "active_strategy_card_surface",
    strategy_card_route_kind: "central_brain_pivot",
    final_guard_mode: "normal_coaching_full",
    visible_sms: true,
    writer_path: "src/lib/v3-inbound-relationship-lane.ts",
    owner: "strategy_card",
    disposition: "active",
    reason: "Central pivot coaching lane with Strategy Card authority.",
    action: CARD_ACTION,
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "card_daily_main_accountability",
    surface_label: "Daily main active accountability",
    route_identifiers: ["main_active_accountability"],
    classification: "active_strategy_card_surface",
    strategy_card_route_kind: "main_active_accountability",
    final_guard_mode: "outbound_daily",
    visible_sms: true,
    writer_path: "src/lib/v3-daily-relationship-lane.ts",
    owner: "strategy_card",
    disposition: "active",
    reason: "Daily C1 accountability with Daily Strategy Card.",
    action: CARD_ACTION,
    send_caller_files: ["src/app/api/cron/daily-sms/route.ts"],
  },
  {
    id: "card_daily_low_pressure",
    surface_label: "Daily low pressure reactivation",
    route_identifiers: ["low_pressure_reactivation"],
    classification: "active_strategy_card_surface",
    strategy_card_route_kind: "low_pressure_reactivation",
    final_guard_mode: "outbound_daily",
    visible_sms: true,
    writer_path: "src/lib/v3-daily-relationship-lane.ts",
    owner: "strategy_card",
    disposition: "active",
    reason: "Daily C1 reactivation with Daily Strategy Card.",
    action: CARD_ACTION,
    send_caller_files: ["src/app/api/cron/daily-sms/route.ts"],
  },
  {
    id: "card_daily_contract_prompt",
    surface_label: "Daily contract prompt",
    route_identifiers: ["contract_prompt"],
    classification: "active_strategy_card_surface",
    strategy_card_route_kind: "contract_prompt",
    final_guard_mode: "outbound_daily",
    visible_sms: true,
    writer_path: "src/lib/v3-daily-relationship-lane.ts",
    owner: "strategy_card",
    disposition: "active",
    reason: "Daily C2 semantic contract with Daily Strategy Card.",
    action: CARD_ACTION,
    send_caller_files: ["src/app/api/cron/daily-sms/route.ts"],
  },
  {
    id: "card_daily_pending_resolution",
    surface_label: "Daily pending resolution (outbound)",
    route_identifiers: ["pending_resolution"],
    classification: "active_strategy_card_surface",
    strategy_card_route_kind: "pending_resolution",
    final_guard_mode: "outbound_daily",
    visible_sms: true,
    writer_path: "src/lib/v3-daily-relationship-lane.ts",
    owner: "strategy_card",
    disposition: "active",
    reason: "Outbound daily pending resolution with Daily C3 Strategy Card.",
    action: CARD_ACTION,
    send_caller_files: ["src/app/api/cron/daily-sms/route.ts"],
  },
  {
    id: "card_daily_refresh_identity",
    surface_label: "Daily refresh identity (outbound)",
    route_identifiers: ["refresh_identity"],
    classification: "active_strategy_card_surface",
    strategy_card_route_kind: "refresh_identity",
    final_guard_mode: "outbound_daily",
    visible_sms: true,
    writer_path: "src/lib/v3-daily-relationship-lane.ts",
    owner: "strategy_card",
    disposition: "active",
    reason: "Outbound daily identity refresh with Daily C3 Strategy Card.",
    action: CARD_ACTION,
    send_caller_files: ["src/app/api/cron/daily-sms/route.ts"],
  },
  {
    id: "card_daily_refresh_commitment",
    surface_label: "Daily refresh commitment (outbound)",
    route_identifiers: ["refresh_commitment"],
    classification: "active_strategy_card_surface",
    strategy_card_route_kind: "refresh_commitment",
    final_guard_mode: "outbound_daily",
    visible_sms: true,
    writer_path: "src/lib/v3-daily-relationship-lane.ts",
    owner: "strategy_card",
    disposition: "active",
    reason: "Outbound daily commitment refresh with Daily C3 Strategy Card.",
    action: CARD_ACTION,
    send_caller_files: ["src/app/api/cron/daily-sms/route.ts"],
  },
  {
    id: "card_weekly_proof_v2",
    surface_label: "Weekly proof v2",
    route_identifiers: ["weekly_proof_v2"],
    classification: "active_strategy_card_surface",
    strategy_card_route_kind: "weekly_proof_v2",
    final_guard_mode: "outbound_weekly",
    visible_sms: true,
    writer_path: "src/lib/v3-weekly-outbound-relationship-lane.ts",
    owner: "strategy_card",
    disposition: "active",
    reason: "Weekly proof lane with Weekly Strategy Card.",
    action: CARD_ACTION,
    send_caller_files: [
      "src/app/api/cron/weekly-sms/route.ts",
      "src/lib/tyler-text-overview-weekly-send.ts",
    ],
  },
];

const INTENTIONAL_EXCEPTION_SURFACES: readonly SmsSurfaceAuthorityEntry[] = [
  {
    id: "hard_stop",
    surface_label: "SMS STOP / opt-out",
    route_identifiers: ["stop", "sms_stop", "opt_out"],
    classification: "hard_route_deterministic_exception",
    final_guard_mode: "hard_route_none",
    visible_sms: true,
    writer_path: "src/app/api/cron/sms-inbound-coach/route.ts",
    owner: "hard_route",
    disposition: "never_card",
    reason: "Legal/compliance opt-out; deterministic TwiML handler, not coaching.",
    action: "never Strategy Card",
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "hard_help",
    surface_label: "SMS HELP",
    route_identifiers: ["help", "sms_help"],
    classification: "hard_route_deterministic_exception",
    final_guard_mode: "hard_route_none",
    visible_sms: true,
    writer_path: "src/app/api/cron/sms-inbound-coach/route.ts",
    owner: "hard_route",
    disposition: "never_card",
    reason: "Compliance help response; not relationship coaching.",
    action: "never Strategy Card",
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "hard_start",
    surface_label: "SMS START / re-subscribe",
    route_identifiers: ["start", "sms_start"],
    classification: "hard_route_deterministic_exception",
    final_guard_mode: "hard_route_none",
    visible_sms: true,
    writer_path: "src/app/api/cron/sms-inbound-coach/route.ts",
    owner: "hard_route",
    disposition: "never_card",
    reason: "Compliance re-subscribe; not coaching move.",
    action: "never Strategy Card",
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "hard_crisis_safety",
    surface_label: "Crisis / safety inbound",
    route_identifiers: ["crisis", "safety", "sms_inbound_safety"],
    classification: "hard_route_deterministic_exception",
    final_guard_mode: "hard_route_none",
    visible_sms: true,
    writer_path: "src/app/api/cron/sms-inbound-coach/route.ts",
    owner: "hard_route",
    disposition: "never_card",
    reason: "Safety gate owns visible SMS or no-send; may use sendSMSChunked async path.",
    action: "never Strategy Card",
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "hard_onboarding_consent",
    surface_label: "Onboarding / consent templates",
    route_identifiers: ["onboarding_consent", "onboarding_sms"],
    classification: "hard_route_deterministic_exception",
    final_guard_mode: "not_visible",
    visible_sms: true,
    writer_path: "src/app/api/onboarding/sms/route.ts",
    owner: "hard_route",
    disposition: "never_card",
    reason: "Transactional consent copy; not relationship coaching lane.",
    action: "never Strategy Card",
    send_caller_files: ["src/app/api/onboarding/sms/route.ts"],
  },
  {
    id: "hard_tapback_suppressed",
    surface_label: "Tapbacks / suppressed inbound",
    route_identifiers: ["suppressed_no_send", "tapback", "suppressed_message"],
    classification: "suppressed_no_visible_sms",
    final_guard_mode: "not_visible",
    visible_sms: false,
    writer_path: "src/app/api/cron/sms-inbound-coach/route.ts",
    owner: "hard_route",
    disposition: "never_card",
    reason: "No visible coaching SMS or coalesced into parent turn.",
    action: "never Strategy Card",
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "hard_soft_opt_out",
    surface_label: "Soft opt-out reply",
    route_identifiers: ["soft_opt_out_reply"],
    classification: "hard_route_deterministic_exception",
    final_guard_mode: "hard_route_none",
    visible_sms: true,
    writer_path: "src/lib/v2-ai-inbound.ts",
    owner: "hard_route",
    disposition: "never_card",
    reason: "Billing/comms soft opt-out integrity; not coaching strategy.",
    action: "never Strategy Card",
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "hard_compliance_templates",
    surface_label: "Compliance footer / template SMS",
    route_identifiers: ["compliance_footer", "weekly_sms_compliance_footer"],
    classification: "hard_route_deterministic_exception",
    final_guard_mode: "not_visible",
    visible_sms: false,
    writer_path: null,
    owner: "hard_route",
    disposition: "never_card",
    reason: "Post-guard compliance suffix; not writer coaching body.",
    action: "never Strategy Card",
  },
  {
    id: "txn_blocker_ack",
    surface_label: "Blocker capture ack",
    route_identifiers: ["blocker_capture_ack"],
    classification: "state_machine_transactional_exception",
    final_guard_mode: "transactional_coaching_limited",
    visible_sms: true,
    writer_path: "src/lib/v2-ai-blocker-ack.ts",
    owner: "state_machine",
    disposition: "intentional_exception",
    reason: "Server owns blocker state; ack is a transactional step.",
    action: "document and monitor; optional thin card only if telemetry shows confusion",
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "txn_central_brain_blocker_pivot",
    surface_label: "Central brain blocker pivot",
    route_identifiers: ["central_brain_blocker_pivot"],
    classification: "state_machine_transactional_exception",
    final_guard_mode: "transactional_coaching_limited",
    visible_sms: true,
    writer_path: "src/lib/v3-inbound-relationship-lane.ts",
    owner: "state_machine",
    disposition: "intentional_exception",
    reason: "Pivot lane with ROUTE aux; no Strategy Card wired (unlike central_brain_pivot).",
    action: "document and monitor; optional thin card follow-up",
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "txn_memory_confirmation",
    surface_label: "Memory confirmation / decline / clarification",
    route_identifiers: ["memory_confirmation", "memory_decline", "memory_clarification"],
    classification: "state_machine_transactional_exception",
    final_guard_mode: "transactional_coaching_limited",
    visible_sms: true,
    writer_path: "src/lib/v3-inbound-relationship-lane.ts",
    owner: "state_machine",
    disposition: "intentional_exception",
    reason: "Server applies memory flags before SMS; verbatim/meaning constraints dominate.",
    action: "leave state-machine-owned",
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "txn_pending_resolution_inbound",
    surface_label: "Pending resolution inbound",
    route_identifiers: ["pending_resolution"],
    classification: "state_machine_transactional_exception",
    final_guard_mode: "transactional_coaching_limited",
    visible_sms: true,
    writer_path: "src/lib/v3-inbound-relationship-lane.ts",
    owner: "state_machine",
    disposition: "intentional_exception",
    dual_purpose_lane: true,
    reason: "Inbound guided-resolution step; outbound daily pending_resolution has Strategy Card.",
    action: "leave state-machine-owned on inbound",
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "txn_contract_consent",
    surface_label: "Adaptive contract consent accept/decline/noop",
    route_identifiers: [
      "adaptive_proposal_consent_accept",
      "adaptive_proposal_consent_decline",
      "adaptive_proposal_consent_noop_ack",
    ],
    classification: "state_machine_transactional_exception",
    final_guard_mode: "transactional_coaching_limited",
    visible_sms: true,
    writer_path: "src/lib/v3-inbound-relationship-lane.ts",
    owner: "state_machine",
    disposition: "intentional_exception",
    reason: "RPC/overlay action already decided; binding verbatim dominates.",
    action: "leave state-machine-owned",
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "txn_adaptive_clarify",
    surface_label: "Adaptive proposal consent clarification",
    route_identifiers: ["adaptive_proposal_consent_clarification"],
    classification: "state_machine_transactional_exception",
    final_guard_mode: "transactional_coaching_limited",
    visible_sms: true,
    writer_path: "src/lib/v3-inbound-relationship-lane.ts",
    owner: "state_machine",
    disposition: "intentional_exception",
    reason: "Explicit YES/NO clarify while proposal remains pending.",
    action: "leave state-machine-owned",
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "txn_commitment_handoff",
    surface_label: "Commitment change handoff",
    route_identifiers: ["commitment_change_handoff"],
    classification: "state_machine_transactional_exception",
    final_guard_mode: "transactional_coaching_limited",
    visible_sms: true,
    writer_path: "src/lib/v3-inbound-relationship-lane.ts",
    owner: "state_machine",
    disposition: "intentional_exception",
    reason: "Pending-resolution handoff; server owns whether pending was created.",
    action: "leave state-machine-owned",
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "txn_refresh_inbound",
    surface_label: "Refresh identity / commitment inbound",
    route_identifiers: [
      "refresh",
      "refresh_identity",
      "refresh_commitment",
      "refresh_confirmation",
      "refresh_clarification",
    ],
    classification: "state_machine_transactional_exception",
    final_guard_mode: "transactional_coaching_limited",
    visible_sms: true,
    writer_path: "src/lib/v3-inbound-relationship-lane.ts",
    owner: "state_machine",
    disposition: "intentional_exception",
    dual_purpose_lane: true,
    reason: "Inbound refresh session with server-applied transitions; outbound refresh has Strategy Card.",
    action: "leave state-machine-owned on inbound",
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "txn_identity_edit",
    surface_label: "Identity edit integrity",
    route_identifiers: ["identity_edit_integrity"],
    classification: "state_machine_transactional_exception",
    final_guard_mode: "transactional_coaching_limited",
    visible_sms: true,
    writer_path: "src/lib/v3-inbound-relationship-lane.ts",
    owner: "state_machine",
    disposition: "intentional_exception",
    reason: "No identity mutation from prose; integrity lane.",
    action: "leave state-machine-owned",
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "txn_relationship_exit",
    surface_label: "Relationship exit integrity",
    route_identifiers: ["relationship_exit_integrity"],
    classification: "state_machine_transactional_exception",
    final_guard_mode: "transactional_coaching_limited",
    visible_sms: true,
    writer_path: "src/lib/v3-inbound-relationship-lane.ts",
    owner: "state_machine",
    disposition: "intentional_exception",
    reason: "Exit/billing soft opt-out; no outcome scoring.",
    action: "leave state-machine-owned",
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "txn_commitment_change_context",
    surface_label: "Commitment change context (no handoff)",
    route_identifiers: ["commitment_change_context"],
    classification: "state_machine_transactional_exception",
    final_guard_mode: "transactional_coaching_limited",
    visible_sms: true,
    writer_path: "src/lib/v3-inbound-relationship-lane.ts",
    owner: "state_machine",
    disposition: "intentional_exception",
    reason: "Heuristic change phrasing without Wave4 pending start.",
    action: "leave state-machine-owned",
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "deferred_legacy_fallback",
    surface_label: "Conversation brain unavailable / legacy fallback",
    route_identifiers: [
      "conversation_brain_unavailable",
      "conversation_brain_legacy_disabled_lane",
    ],
    classification: "deferred_env_gated_exception",
    final_guard_mode: "normal_coaching_full",
    visible_sms: true,
    writer_path: "src/lib/v3-inbound-relationship-lane.ts",
    owner: "state_machine",
    disposition: "deferred_monitor",
    reason: "Degraded-mode writer; likely dormant under default env; Review Place covered.",
    action: "monitor volume; card-wire or retire only if volume justifies",
    send_caller_files: ["src/app/api/cron/sms-inbound-coach/route.ts"],
  },
  {
    id: "guided_shrink_contract",
    surface_label: "Guided shrink contract proposal SMS",
    route_identifiers: ["guided_shrink_contract_prompt", "guided_contract_proposal"],
    classification: "app_driven_constrained_exception",
    final_guard_mode: "outbound_daily",
    visible_sms: true,
    writer_path: "src/lib/v2-adaptive-contract.ts",
    owner: "app_flow",
    disposition: "intentional_exception",
    reason: "App-driven C2-like proposal with unified guard + binding needle.",
    action: "defer Strategy Card; document authority model",
    send_caller_files: ["src/lib/v2-adaptive-contract.ts"],
  },
  {
    id: "mms_d2b_photo_clarification",
    surface_label: "Inbound MMS D2b photo-only clarification",
    route_identifiers: ["mms_d2b_photo_clarification"],
    classification: "app_driven_constrained_exception",
    final_guard_mode: "not_visible",
    visible_sms: true,
    writer_path: "src/lib/victory-media/inbound-mms-d2b.ts",
    owner: "app_flow",
    disposition: "intentional_exception",
    reason:
      "Exactly one post-grace photo clarification via sendSMSChunked; not a Strategy Card surface.",
    action: "keep D2b bounded; do not card-wire",
    send_caller_files: ["src/lib/victory-media/inbound-mms-d2b.ts"],
  },
  {
    id: "weekly_legacy_deprecated",
    surface_label: "Weekly legacy reflection / fallback summary",
    route_identifiers: ["weekly_legacy_reflection", "weekly_legacy_fallback_summary"],
    classification: "deprecated_no_visible_sms",
    final_guard_mode: "not_visible",
    visible_sms: false,
    writer_path: "src/lib/v3-weekly-outbound-relationship-lane.ts",
    owner: "deprecated",
    disposition: "deprecated",
    reason: "Deprecated branch; no Twilio visible send.",
    action: "keep no-send; retire when safe",
    send_caller_files: ["src/app/api/cron/weekly-sms/route.ts"],
  },
  {
    id: "deprecated_followup_sms",
    surface_label: "Legacy followup SMS cron",
    route_identifiers: ["legacy_followup_sms", "skipped_legacy_followup_deprecated"],
    classification: "deprecated_no_visible_sms",
    final_guard_mode: "not_visible",
    visible_sms: false,
    writer_path: "src/app/api/cron/followup-sms/route.ts",
    owner: "deprecated",
    disposition: "deprecated",
    reason: "Phase 4.3 deprecated; metadata-only update, no sendSMS.",
    action: "keep no-send; retire when safe",
    send_caller_files: ["src/app/api/cron/followup-sms/route.ts"],
  },
  {
    id: "deprecated_missed_yesterday_sms",
    surface_label: "Legacy missed-yesterday SMS cron",
    route_identifiers: [
      "legacy_missed_yesterday_sms",
      "skipped_legacy_missed_yesterday_deprecated",
    ],
    classification: "deprecated_no_visible_sms",
    final_guard_mode: "not_visible",
    visible_sms: false,
    writer_path: "src/app/api/cron/missed-yesterday-sms/route.ts",
    owner: "deprecated",
    disposition: "deprecated",
    reason: "Phase 4.3 deprecated; metadata-only update, no sendSMS.",
    action: "keep no-send; retire when safe",
    send_caller_files: ["src/app/api/cron/missed-yesterday-sms/route.ts"],
  },
  {
    id: "deprecated_inactivity_rescue",
    surface_label: "Inactivity rescue SMS cron",
    route_identifiers: ["inactivity_rescue_deprecated"],
    classification: "deprecated_no_visible_sms",
    final_guard_mode: "not_visible",
    visible_sms: false,
    writer_path: "src/app/api/cron/inactivity-rescue/route.ts",
    owner: "deprecated",
    disposition: "deprecated",
    reason: "Phase 4.4 deprecated; feedback_events only; canonical reactivation is daily V3.",
    action: "keep no-send; retire when safe",
    send_caller_files: ["src/app/api/cron/inactivity-rescue/route.ts"],
  },
  {
    id: "deprecated_post_churn_winback",
    surface_label: "Post-churn winback SMS cron",
    route_identifiers: ["post_churn_winback_deprecated"],
    classification: "deprecated_no_visible_sms",
    final_guard_mode: "not_visible",
    visible_sms: false,
    writer_path: "src/app/api/cron/post-churn-winback/route.ts",
    owner: "deprecated",
    disposition: "deprecated",
    reason: "Phase 4.5 deprecated; no Twilio visible send.",
    action: "keep no-send; retire when safe",
    send_caller_files: ["src/app/api/cron/post-churn-winback/route.ts"],
  },
];

export const SMS_SURFACE_AUTHORITY_REGISTRY: readonly SmsSurfaceAuthorityEntry[] = [
  ...ACTIVE_STRATEGY_CARD_SURFACES,
  ...INTENTIONAL_EXCEPTION_SURFACES,
] as const;

/** Every {@link InboundV3RoutePurpose} must appear in the registry. */
export const INBOUND_V3_ROUTE_PURPOSES = [
  "normal_inbound_reply",
  "central_brain_pivot",
  "arc_clarify_ambiguous_short",
  "central_brain_blocker_pivot",
  "blocker_capture_ack",
  "open_question_answer",
  "refresh",
  "refresh_identity",
  "refresh_commitment",
  "refresh_confirmation",
  "refresh_clarification",
  "pending_resolution",
  "memory_confirmation",
  "memory_decline",
  "memory_clarification",
  "adaptive_proposal_consent_accept",
  "adaptive_proposal_consent_decline",
  "adaptive_proposal_consent_noop_ack",
  "adaptive_proposal_consent_clarification",
  "commitment_change_handoff",
  "commitment_change_context",
  "relationship_exit_integrity",
  "identity_edit_integrity",
  "conversation_brain_unavailable",
] as const satisfies readonly InboundV3RoutePurpose[];

/** Production source files scanned for route literals (static gate). */
export const SMS_SURFACE_AUTHORITY_SOURCE_FILES = [
  "src/lib/coaching-strategy-card-v1.ts",
  "src/lib/v3-inbound-relationship-lane.ts",
  "src/lib/v3-daily-relationship-lane.ts",
  "src/lib/v3-weekly-outbound-relationship-lane.ts",
  "src/app/api/cron/sms-inbound-coach/route.ts",
  "src/app/api/cron/daily-sms/route.ts",
  "src/app/api/cron/weekly-sms/route.ts",
  "src/lib/v2-adaptive-contract.ts",
  "src/app/api/v2/guided-resolution/tighten/route.ts",
] as const;

/** Route literals that may appear in source but are not SMS surface authorities. */
export const SMS_SURFACE_ROUTE_LITERAL_IGNORE = new Set<string>([
  "v2_accountability",
  "standard_check",
  "premature_adjustment_proposal_guard",
  "guided_contract",
  "pending_resolution_inbound",
  "refresh_session_inbound",
  "commitment_change_context_heuristic",
  /** Unified final guard lane tag — not an SMS route_purpose/kind. */
  "inbound",
  "daily",
  "weekly",
]);

/** Curated route literals that must be classified (grep + union coverage). */
export const SMS_SURFACE_REQUIRED_ROUTE_LITERALS = [
  ...INBOUND_V3_ROUTE_PURPOSES,
  ...ACTIVE_STRATEGY_CARD_ROUTE_KINDS,
  "central_brain_blocker_pivot",
  "blocker_capture_ack",
  "conversation_brain_unavailable",
  "conversation_brain_legacy_disabled_lane",
  "guided_shrink_contract_prompt",
  "guided_contract_proposal",
  "weekly_legacy_reflection",
  "weekly_legacy_fallback_summary",
  "soft_opt_out_reply",
  "suppressed_no_send",
  "stop",
  "help",
  "start",
  "onboarding_consent",
  "onboarding_sms",
] as const;

export const SMS_SURFACE_AUTHORITY_DUAL_PURPOSE_ROUTE_IDS = new Set([
  "pending_resolution",
  "refresh_identity",
  "refresh_commitment",
  "refresh",
]);

export function allSurfaceAuthorityRouteIdentifiers(): string[] {
  return SMS_SURFACE_AUTHORITY_REGISTRY.flatMap((e) => e.route_identifiers);
}

export function findSurfaceAuthorityEntriesByRouteIdentifier(
  routeId: string
): SmsSurfaceAuthorityEntry[] {
  const norm = routeId.trim();
  return SMS_SURFACE_AUTHORITY_REGISTRY.filter((e) =>
    e.route_identifiers.some((id) => id === norm)
  );
}

export function findSurfaceAuthorityByRouteIdentifier(
  routeId: string
): SmsSurfaceAuthorityEntry | undefined {
  return findSurfaceAuthorityEntriesByRouteIdentifier(routeId)[0];
}

export function isActiveStrategyCardSurfaceRoute(routeKind: string): boolean {
  return (ACTIVE_STRATEGY_CARD_ROUTE_KINDS as readonly string[]).includes(routeKind);
}

export function activeStrategyCardAuthorityEntries(): readonly SmsSurfaceAuthorityEntry[] {
  return SMS_SURFACE_AUTHORITY_REGISTRY.filter(
    (e) => e.classification === "active_strategy_card_surface"
  );
}

export function nonActiveSurfaceAuthorityEntries(): readonly SmsSurfaceAuthorityEntry[] {
  return SMS_SURFACE_AUTHORITY_REGISTRY.filter(
    (e) => e.classification !== "active_strategy_card_surface"
  );
}

export function isRouteIdentifierClassified(routeId: string): boolean {
  return findSurfaceAuthorityEntriesByRouteIdentifier(routeId).length > 0;
}

/** Extract route_purpose / route_kind string literals from production source. */
export function extractSmsRouteLiteralsFromSource(source: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /route_purpose:\s*["']([a-z][a-z0-9_]*)["']/g,
    /routePurpose:\s*["']([a-z][a-z0-9_]*)["']/g,
    /route_kind:\s*["']([a-z][a-z0-9_]*)["']/g,
    /routeKind:\s*["']([a-z][a-z0-9_]*)["']/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      found.add(m[1]!);
    }
  }
  return [...found];
}
