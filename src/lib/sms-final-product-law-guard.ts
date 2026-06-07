/**
 * PR 2.1a — unified final product-law guard entry point.
 * Delegates to existing inbound guard stack for normal_coaching_full (behavior-preserving).
 */

import {
  applyInboundCoachFinalBodyGuards,
  type ApplyInboundFinalBodyTruthGuardArgs,
  type InboundCoachFinalBodyGuardsResult,
  type OutcomeClaimEvidenceBundle,
} from "@/lib/inbound-final-body-truth-guard";
import type { InboundTurnUnderstandingContext } from "@/lib/inbound-turn-understanding-context";

export const SMS_FINAL_PRODUCT_LAW_GUARD_VERSION = "sms_final_product_law_v1" as const;

export const UNIFIED_FINAL_BODY_AUTHORITY = "unified_final_product_law_guard" as const;

export type SmsFinalGuardSurface = "inbound" | "daily" | "weekly";

export type SmsFinalGuardMode =
  | "normal_coaching_full"
  | "transactional_coaching_limited"
  | "outbound_daily"
  | "outbound_weekly"
  | "hard_route_bypass";

export type NormalCoachingFullGuardArgs = {
  body: string;
  turnUnderstandingContext: InboundTurnUnderstandingContext | null | undefined;
  latestOpenQuestion?: string | null;
  lastCoachOutbound?: string | null;
  evidence: OutcomeClaimEvidenceBundle;
  factsJson?: Record<string, unknown> | null;
  repairSnapshot?: ApplyInboundFinalBodyTruthGuardArgs["repairSnapshot"];
  stage?: string;
  routePurpose?: string;
  nowMs?: number;
};

export type UnifiedFinalGuardArgs = {
  mode: SmsFinalGuardMode;
  surface: SmsFinalGuardSurface;
  normalCoachingFull?: NormalCoachingFullGuardArgs;
  /** Body entering unified guard (for telemetry previews). Defaults to normalCoachingFull.body. */
  preGuardBodyPreview?: string | null;
  routePurpose?: string | null;
  branchName?: string | null;
  /** hard_route_bypass only — pass-through candidate */
  candidateBody?: string;
};

export type UnifiedFinalGuardSkippedCheck = {
  check: string;
  reason: string;
};

export type UnifiedFinalGuardResult = {
  should_send: boolean;
  /** Route parity alias — same value as should_send */
  shouldSend: boolean;
  body: string;
  no_send_reason: string | null;
  /** Route parity alias — same value as no_send_reason */
  noSendReason: string | null;
  final_body_authority: typeof UNIFIED_FINAL_BODY_AUTHORITY;
  guard_version: typeof SMS_FINAL_PRODUCT_LAW_GUARD_VERSION;
  guard_mode: SmsFinalGuardMode;
  checks_run: string[];
  checks_skipped: UnifiedFinalGuardSkippedCheck[];
  guard_results: {
    inbound_coach_final_body_guards: InboundCoachFinalBodyGuardsResult;
  };
  repair_attempts: number;
  repair_succeeded: boolean | null;
  metadata: Record<string, unknown>;
  /** Preserved sub-guard outputs for downstream telemetry (route parity). */
  tuGuard: InboundCoachFinalBodyGuardsResult["tuGuard"];
  prematureAdjustmentGuard: InboundCoachFinalBodyGuardsResult["prematureAdjustmentGuard"];
  truthGuard: InboundCoachFinalBodyGuardsResult["truthGuard"];
  nearDuplicateGuard: InboundCoachFinalBodyGuardsResult["nearDuplicateGuard"];
};

const NORMAL_COACHING_FULL_CHECKS = [
  "turn_understanding_stale_ask",
  "premature_adjustment",
  "unsupported_claim_oceg",
  "near_duplicate",
] as const;

function deriveChecksRun(inbound: InboundCoachFinalBodyGuardsResult): string[] {
  const checks: string[] = ["turn_understanding_stale_ask"];
  if (inbound.prematureAdjustmentGuard !== null) {
    checks.push("premature_adjustment");
  }
  if (inbound.truthGuard !== null) {
    checks.push("unsupported_claim_oceg");
  }
  if (inbound.nearDuplicateGuard !== null) {
    checks.push("near_duplicate");
  }
  return checks;
}

function repairAttemptedInMeta(meta: Record<string, unknown> | undefined): boolean {
  if (!meta) return false;
  return Object.entries(meta).some(
    ([key, value]) => key.endsWith("_repair_attempted") && value === true
  );
}

function countRepairAttempts(inbound: InboundCoachFinalBodyGuardsResult): number {
  let count = 0;
  if (repairAttemptedInMeta(inbound.tuGuard.metadata)) count += 1;
  if (repairAttemptedInMeta(inbound.prematureAdjustmentGuard?.metadata)) count += 1;
  if (repairAttemptedInMeta(inbound.truthGuard?.metadata)) count += 1;
  if (repairAttemptedInMeta(inbound.nearDuplicateGuard?.metadata)) count += 1;
  return count;
}

function anyRepairSucceeded(inbound: InboundCoachFinalBodyGuardsResult): boolean | null {
  const metas = [
    inbound.tuGuard.metadata,
    inbound.prematureAdjustmentGuard?.metadata,
    inbound.truthGuard?.metadata,
    inbound.nearDuplicateGuard?.metadata,
  ];
  const outcomes: boolean[] = [];
  for (const meta of metas) {
    if (!meta) continue;
    for (const [key, value] of Object.entries(meta)) {
      if (!key.endsWith("_repair_attempted") || value !== true) continue;
      const successKey = key.replace(/_attempted$/, "_succeeded");
      outcomes.push(meta[successKey] === true);
    }
  }
  if (outcomes.length === 0) return null;
  return outcomes.some(Boolean);
}

function buildWrapperMetadata(args: {
  args: UnifiedFinalGuardArgs;
  preBody: string;
  postBody: string;
  inbound: InboundCoachFinalBodyGuardsResult;
}): Record<string, unknown> {
  const sentEqualsGuard =
    args.inbound.shouldSend && args.postBody.trim().length > 0
      ? args.postBody.trim() === args.postBody.trim()
      : null;

  return {
    unified_final_guard_version: SMS_FINAL_PRODUCT_LAW_GUARD_VERSION,
    unified_final_guard_mode: args.args.mode,
    final_body_authority: UNIFIED_FINAL_BODY_AUTHORITY,
    pre_unified_guard_body_preview: args.preBody.slice(0, 120),
    post_unified_guard_body_preview: args.postBody.slice(0, 120),
    sent_body_equals_guard_body: sentEqualsGuard,
    unified_final_guard_route_purpose: args.args.routePurpose ?? args.args.normalCoachingFull?.routePurpose ?? null,
    unified_final_guard_branch_name: args.args.branchName ?? null,
    unified_final_guard_surface: args.args.surface,
    unified_final_guard_checks_run: deriveChecksRun(args.inbound),
    unified_final_guard_delegated_to: "applyInboundCoachFinalBodyGuards",
  };
}

function mapInboundToUnified(
  args: UnifiedFinalGuardArgs,
  inbound: InboundCoachFinalBodyGuardsResult,
  preBody: string
): UnifiedFinalGuardResult {
  const repairAttempts = countRepairAttempts(inbound);
  const metadata = buildWrapperMetadata({
    args,
    preBody,
    postBody: inbound.body,
    inbound,
  });

  return {
    should_send: inbound.shouldSend,
    shouldSend: inbound.shouldSend,
    body: inbound.body,
    no_send_reason: inbound.noSendReason,
    noSendReason: inbound.noSendReason,
    final_body_authority: UNIFIED_FINAL_BODY_AUTHORITY,
    guard_version: SMS_FINAL_PRODUCT_LAW_GUARD_VERSION,
    guard_mode: args.mode,
    checks_run: deriveChecksRun(inbound),
    checks_skipped: NORMAL_COACHING_FULL_CHECKS.filter(
      (c) => !deriveChecksRun(inbound).includes(c)
    ).map((check) => ({
      check,
      reason: "not_reached_due_to_earlier_no_send_or_short_circuit",
    })),
    guard_results: {
      inbound_coach_final_body_guards: inbound,
    },
    repair_attempts: repairAttempts,
    repair_succeeded: anyRepairSucceeded(inbound),
    metadata,
    tuGuard: inbound.tuGuard,
    prematureAdjustmentGuard: inbound.prematureAdjustmentGuard,
    truthGuard: inbound.truthGuard,
    nearDuplicateGuard: inbound.nearDuplicateGuard,
  };
}

export function compactUnifiedFinalGuardForTelemetry(
  result: UnifiedFinalGuardResult
): Record<string, unknown> {
  return {
    ...result.metadata,
    unified_final_guard_no_send_reason: result.no_send_reason,
    unified_final_guard_repair_attempts: result.repair_attempts,
    unified_final_guard_repair_succeeded: result.repair_succeeded,
  };
}

export async function applyUnifiedSmsFinalProductLawGuard(
  args: UnifiedFinalGuardArgs
): Promise<UnifiedFinalGuardResult> {
  if (args.mode === "hard_route_bypass") {
    const body = (args.candidateBody ?? args.normalCoachingFull?.body ?? "").trim();
    const emptyInbound: InboundCoachFinalBodyGuardsResult = {
      body,
      shouldSend: true,
      noSendReason: null,
      tuGuard: {
        body,
        shouldSend: true,
        noSendReason: null,
        metadata: { hard_route_bypass: true },
      },
      prematureAdjustmentGuard: null,
      truthGuard: null,
      nearDuplicateGuard: null,
    };
    return {
      should_send: true,
      shouldSend: true,
      body,
      no_send_reason: null,
      noSendReason: null,
      final_body_authority: UNIFIED_FINAL_BODY_AUTHORITY,
      guard_version: SMS_FINAL_PRODUCT_LAW_GUARD_VERSION,
      guard_mode: args.mode,
      checks_run: [],
      checks_skipped: NORMAL_COACHING_FULL_CHECKS.map((check) => ({
        check,
        reason: "hard_route_bypass",
      })),
      guard_results: { inbound_coach_final_body_guards: emptyInbound },
      repair_attempts: 0,
      repair_succeeded: null,
      metadata: {
        unified_final_guard_version: SMS_FINAL_PRODUCT_LAW_GUARD_VERSION,
        unified_final_guard_mode: args.mode,
        final_body_authority: UNIFIED_FINAL_BODY_AUTHORITY,
        hard_route_bypass: true,
      },
      tuGuard: emptyInbound.tuGuard,
      prematureAdjustmentGuard: null,
      truthGuard: null,
      nearDuplicateGuard: null,
    };
  }

  if (args.mode !== "normal_coaching_full") {
    throw new Error(
      `sms_final_product_law_guard: mode "${args.mode}" is not activated in PR 2.1a`
    );
  }

  if (!args.normalCoachingFull) {
    throw new Error(
      "sms_final_product_law_guard: normalCoachingFull args required for normal_coaching_full mode"
    );
  }

  const preBody = (args.preGuardBodyPreview ?? args.normalCoachingFull.body).trim();
  const inbound = await applyInboundCoachFinalBodyGuards(args.normalCoachingFull);
  return mapInboundToUnified(args, inbound, preBody);
}
