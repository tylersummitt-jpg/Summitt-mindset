/**
 * Phase 2.3-C2 — post-unified-guard daily contract/proposal truth recheck.
 */

import {
  validateSemanticDailyContractProposalSms,
  type DailySemanticContractProposalFactsPacket,
} from "@/lib/v3-daily-contract-proposal-semantic";
import { userVisibleInternalLabelBlockedReasons } from "@/lib/user-visible-internal-label-guard";

export const DAILY_CONTRACT_PROPOSAL_TRUTH_VIOLATION_NO_SEND =
  "daily_contract_proposal_truth_violation_after_unified_guard" as const;

export const DAILY_CONTRACT_PROPOSAL_SEMANTIC_MISSING_NO_SEND =
  "daily_contract_proposal_semantic_missing_after_unified_guard" as const;

export const DAILY_CONTRACT_PROPOSAL_FALSE_STATE_CLAIM_NO_SEND =
  "daily_contract_proposal_false_state_claim_after_unified_guard" as const;

const FALSE_PROPOSAL_STATE_PATTERNS: { violation: string; re: RegExp }[] = [
  { violation: "goal_already_updated", re: /\b(goal|commitment)\s+(already\s+)?(updated|changed)\b/i },
  { violation: "goal_already_changed", re: /\b(changed your goal|new goal is set|goal is now)\b/i },
  { violation: "proposal_already_accepted", re: /\b(already accepted|you accepted|accepted the proposal)\b/i },
  { violation: "proposal_active", re: /\b(proposal is active|plan is active|overlay is active)\b/i },
  { violation: "proposal_resolved", re: /\b(proposal resolved|already handled|already applied)\b/i },
  { violation: "bar_already_in_effect", re: /\b(new bar is (already )?in effect|ask is now in effect|already in effect)\b/i },
  { violation: "overlay_adopted", re: /\b(overlay (is )?adopted|tighter ask is now|now active)\b/i },
];

const ROBOTIC_INTERNAL_PATTERNS: { violation: string; re: RegExp }[] = [
  { violation: "internal_route_purpose", re: /\broute_purpose\b/i },
  { violation: "internal_event_type", re: /\bevent_type\b/i },
  { violation: "internal_classifier", re: /\bclassifier\b/i },
  { violation: "internal_overlay_token", re: /\boverlay\b/i },
  { violation: "internal_rpc", re: /\brpc\b/i },
  { violation: "internal_proposal_pending", re: /\bproposal_pending\b/i },
];

export function detectDailyOutboundFalseProposalStateClaims(body: string): string[] {
  const t = body.trim();
  if (!t) return ["empty_body"];
  const hits: string[] = [];
  for (const { violation, re } of FALSE_PROPOSAL_STATE_PATTERNS) {
    if (re.test(t)) hits.push(violation);
  }
  return hits;
}

export function detectDailyOutboundRoboticProposalLanguage(body: string): string[] {
  const hits = userVisibleInternalLabelBlockedReasons(body);
  const t = body.trim();
  for (const { violation, re } of ROBOTIC_INTERNAL_PATTERNS) {
    if (re.test(t) && !hits.includes(violation)) hits.push(violation);
  }
  return hits;
}

export type PostUnifiedDailyContractProposalTruthArgs = {
  body: string;
  proposalKind: "shrink_ask" | "recommit_same";
  dailyContractSemanticFacts: DailySemanticContractProposalFactsPacket;
  canonicalProposalAskTrim?: string | null;
  baseBehaviorStatement: string;
};

export function evaluatePostUnifiedGuardDailyContractProposalTruthRecheck(
  args: PostUnifiedDailyContractProposalTruthArgs
): {
  blocked: boolean;
  noSendReason: string | null;
  violations: string[];
  semanticReasonCode: string | null;
} {
  const body = args.body.trim();
  const violations: string[] = [];

  const sem = validateSemanticDailyContractProposalSms({
    smsBody: body,
    preview: args.dailyContractSemanticFacts.proposed_behavior_preview,
    canonicalOverlayAsk: args.dailyContractSemanticFacts.proposed_overlay_ask,
    baseBehaviorStatement: args.baseBehaviorStatement,
  });
  if (!sem.ok) {
    violations.push(`semantic:${sem.reason_code}`);
    return {
      blocked: true,
      noSendReason: DAILY_CONTRACT_PROPOSAL_SEMANTIC_MISSING_NO_SEND,
      violations,
      semanticReasonCode: sem.reason_code,
    };
  }

  const falseState = detectDailyOutboundFalseProposalStateClaims(body);
  if (falseState.length > 0) {
    violations.push(...falseState);
    return {
      blocked: true,
      noSendReason: DAILY_CONTRACT_PROPOSAL_FALSE_STATE_CLAIM_NO_SEND,
      violations,
      semanticReasonCode: null,
    };
  }

  if (args.dailyContractSemanticFacts.must_not_claim_goal_updated) {
    const goalUpdatedLex = /\b(goal updated|changed your goal|new goal is set)\b/i.test(body);
    if (goalUpdatedLex) {
      violations.push("must_not_claim_goal_updated");
      return {
        blocked: true,
        noSendReason: DAILY_CONTRACT_PROPOSAL_FALSE_STATE_CLAIM_NO_SEND,
        violations,
        semanticReasonCode: null,
      };
    }
  }

  const robotic = detectDailyOutboundRoboticProposalLanguage(body);
  if (robotic.length > 0) {
    violations.push(...robotic);
    return {
      blocked: true,
      noSendReason: DAILY_CONTRACT_PROPOSAL_TRUTH_VIOLATION_NO_SEND,
      violations,
      semanticReasonCode: null,
    };
  }

  return {
    blocked: false,
    noSendReason: null,
    violations: [],
    semanticReasonCode: null,
  };
}
