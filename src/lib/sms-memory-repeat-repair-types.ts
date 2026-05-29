/**
 * Shared types for memory repeat repair (avoids circular imports between guard and voice ownership).
 */

export const SMS_MEMORY_REPEAT_REPAIR_STRATEGIES = [
  "outcome_check",
  "binary_truth_check",
  "reset_question",
  "barrier_check",
  "next_first_step",
  "proof_check",
  "identity_tie_back",
] as const;

export type SmsMemoryRepeatRepairStrategy = (typeof SMS_MEMORY_REPEAT_REPAIR_STRATEGIES)[number];

export type MemoryRepeatRepairContext = {
  prior_outbound_full_body: string | null;
  blocked_candidate_body: string;
  repeated_question: string | null;
  repeated_phrases: string[];
  latest_user_answer: string | null;
  accountability_purpose: string | null;
  suggested_coaching_move: string | null;
  repeat_violation_reason: string | null;
  recommended_repair_strategy: SmsMemoryRepeatRepairStrategy;
  forbidden_coaching_frames: string[];
  strategy_examples: string[];
};

export function isSmsMemoryRepeatRepairStrategy(value: string): value is SmsMemoryRepeatRepairStrategy {
  return (SMS_MEMORY_REPEAT_REPAIR_STRATEGIES as readonly string[]).includes(value);
}
