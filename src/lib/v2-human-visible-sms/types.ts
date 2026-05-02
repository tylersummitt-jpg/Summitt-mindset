/** Umbrella Human SMS — Phase 1 human-visible validation types (no OpenAI). */

export type HumanVisibleSmsChannel =
  | "pending_resolution"
  | "contract_consent_ack"
  | "normal_inbound"
  | "adaptive_proposal_outbound"
  | "daily_outbound"
  | "reactivation_outbound"
  | "inbound_central_tether"
  | "inbound_arc_clarify"
  | "normal_inbound_stitched_final";

export type ValidateHumanVisibleSmsOptions = {
  channel: HumanVisibleSmsChannel;
  /** Total SMS length cap (implementation uses ~320 for inbound-style SMS). */
  maxChars: number;
  /** Allow "Victory Room" substring (default false). */
  allowVictoryRoomPhrase?: boolean;
};

export type HumanVisibleSmsValidationResult =
  | { ok: true }
  | { ok: false; reason: string; bannedTerm?: string };

export const HUMAN_VISIBLE_SMS_VALIDATOR_VERSION = "v2";
