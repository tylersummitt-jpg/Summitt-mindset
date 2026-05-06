export const HUMAN_SMS_BRAIN_PROMPT_VERSION = "v1_phase1";

export const PHASE2_NORMAL_INBOUND_BRAIN_PROMPT_VERSION = "v1_phase2";

export const PHASE3_ADAPTIVE_PROPOSAL_BRAIN_PROMPT_VERSION = "v1_phase3a";

export const PHASE4_DAILY_OUTBOUND_BRAIN_PROMPT_VERSION = "v1_phase4a";

export const PHASE5A_HUMAN_SMS_BRAIN_PROMPT_VERSION = "v1_phase5a";

/** Human SMS Brain cases (Phase 1 pending/consent + Phase 2 normal inbound). */
export type HumanSmsBrainCase =
  | "pending_resolution_confirmation_prompt"
  | "pending_resolution_replace_applied"
  | "pending_resolution_tighten_applied"
  | "pending_resolution_clarify_candidate"
  | "pending_resolution_ambiguous_confirm"
  | "pending_resolution_no_problem_reenter"
  | "pending_resolution_lost_candidate"
  | "pending_resolution_rpc_error_hold"
  | "pending_resolution_vague_need_detail"
  | "contract_consent_overlay_yes_ack"
  | "contract_consent_overlay_no_ack"
  | "normal_inbound_outcome_yes"
  | "normal_inbound_outcome_no"
  | "normal_inbound_outcome_partial"
  | "normal_inbound_non_outcome_clarify"
  | "normal_inbound_non_outcome_repair_only"
  | "normal_inbound_non_outcome_commitment_change"
  | "normal_inbound_non_outcome_soft_opt"
  | "normal_inbound_repair_coach"
  | "adaptive_proposal_shrink"
  | "adaptive_proposal_recommit_same"
  | "daily_outbound_accountability"
  | "daily_outbound_standard_check"
  | "daily_outbound_recovery_check"
  | "daily_outbound_reentry_check"
  | "daily_outbound_blocker_followup"
  | "daily_outbound_reactivation_nudge"
  | "inbound_central_tether_pivot"
  | "inbound_active_reply_context_clarify"
  | "normal_inbound_stitched_final";

/** Phase 5A — read-only context for umbrella polish (server owns all decisions). */
export type Phase5aBrainContext = {
  slice:
    | "reactivation_outbound"
    | "central_tether"
    | "arc_clarify"
    | "stitched_final";
  tetherRoute?: "normal_accountability" | "blocker_capture";
  centralTurnPurpose?: string;
  /** Server-approved substrings that stitched-final polish must keep (verbatim, case-insensitive match). */
  preservationSnippets?: string[];
  appendSegments?: {
    wave11: boolean;
    victory: boolean;
    commitment_note: boolean;
  };
  effectiveAskPreview?: string;
  behaviorPreview?: string;
  dailyReplySourcePre?: string;
  dailyPurpose?: string;
};

/** Bounded read-only context for Phase 2 normal inbound (server owns outcome). */
export type NormalInboundBrainContext = {
  /** User asked about victory log / proof / whether something counts — allows Victory Room phrasing in polish. */
  userAskedVictoryProof?: boolean;
  userReplyPreview?: string | null;
  effectiveAskPreview?: string | null;
  behaviorStatementPreview?: string | null;
  finalEventType?: string | null;
  serverStrategy?: string | null;
  gatedMode?: string | null;
  replySource?: string | null;
  replyMode?: string | null;
  latestBlockerPreview?: string | null;
  recentSmsContextPreview?: string | null;
  coachingMemoryPreview?: string | null;
  identityAnchorPreview?: string | null;
};

/** Read-only context for Phase 3A adaptive proposal SMS (binding stored separately). */
export type AdaptiveProposalBrainContext = {
  proposalKind: "shrink" | "recommit_same";
  bindingPreview: string;
  behaviorPreview: string;
  templateId?: number | null;
};

/** Read-only context for Phase 4A standard daily outbound polish. */
export type DailyOutboundBrainContext = {
  dailyPurpose: string;
  serverStrategy: string;
  effectiveAskPreview: string;
  behaviorPreview: string;
  dailyReplySourcePre: string;
  identityAnchorPreview?: string | null;
  coachingMemoryPreview?: string | null;
  recentSmsContextPreview?: string | null;
};

export type HumanSmsBrainInput = {
  brainCase: HumanSmsBrainCase;
  machineDraft: string;
  promptVersion: string;
  /** Phase 5A: slightly higher creativity while staying bounded (temperature only). */
  phase5aCreativeTone?: boolean;
  /** Optional human context for rewriting (no mutation authority). */
  context?: {
    currentBarSummary?: string | null;
    preferredName?: string | null;
    proposalSummary?: string | null;
    contractKindHint?: "shrink_ask" | "recommit_same" | null;
    normalInbound?: NormalInboundBrainContext | null;
    adaptiveProposal?: AdaptiveProposalBrainContext | null;
    dailyOutbound?: DailyOutboundBrainContext | null;
    phase5a?: Phase5aBrainContext | null;
  };
};

export type HumanSmsBrainResult =
  | { ok: true; message: string; confidence: number | null }
  | { ok: false; reason: string };
