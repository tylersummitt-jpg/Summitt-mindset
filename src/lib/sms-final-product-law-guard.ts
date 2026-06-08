/**
 * Unified final product-law guard — PR 2.1a full inbound + PR 2.1b transactional blocker paths.
 */

import {
  applyInboundCoachFinalBodyGuards,
  applyInboundFinalBodyTruthGuard,
  type ApplyInboundFinalBodyTruthGuardArgs,
  type InboundCoachFinalBodyGuardsResult,
  type InboundFinalBodyTruthGuardResult,
  type OutcomeClaimEvidenceBundle,
  UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
} from "@/lib/inbound-final-body-truth-guard";
import {
  applyRapidNearDuplicateCoachReplyGuard,
  RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
  type RapidNearDuplicateCoachReplyGuardResult,
} from "@/lib/inbound-near-duplicate-reply-policy";
import type { InboundFinalBodyTurnUnderstandingGuardResult } from "@/lib/inbound-turn-understanding-context";
import type { InboundTurnUnderstandingContext } from "@/lib/inbound-turn-understanding-context";
import {
  detectDailyOutboundUnsupportedProofClaim,
  isOutboundDailyC1RoutePurpose,
  OUTBOUND_DAILY_INTERNAL_LABEL_NO_SEND,
  OUTBOUND_DAILY_UNSUPPORTED_PROOF_NO_SEND,
  type DailyOutboundUnifiedGuardCtx,
} from "@/lib/daily-outbound-final-guard-evidence";
import { userVisibleInternalLabelBlockedReasons } from "@/lib/user-visible-internal-label-guard";

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

export type TransactionalCoachingLimitedGuardArgs = {
  body: string;
  evidence: OutcomeClaimEvidenceBundle;
  priorCoachBody?: string | null;
  priorCoachSentAt?: string | null;
  inboundRaw?: string | null;
  routePurpose?: string | null;
  factsJson?: Record<string, unknown> | null;
  repairSnapshot?: ApplyInboundFinalBodyTruthGuardArgs["repairSnapshot"];
  nearDuplicateStage?: string;
  ocegStage?: string;
  nowMs?: number;
};

export type OutboundDailyGuardArgs = {
  body: string;
  evidence: OutcomeClaimEvidenceBundle;
  dailyGuardCtx: DailyOutboundUnifiedGuardCtx;
  priorCoachBody?: string | null;
  priorCoachSentAt?: string | null;
  routePurpose: string;
  factsJson?: Record<string, unknown> | null;
  nearDuplicateStage?: string;
  ocegStage?: string;
  nowMs?: number;
};

export type UnifiedFinalGuardArgs = {
  mode: SmsFinalGuardMode;
  surface: SmsFinalGuardSurface;
  normalCoachingFull?: NormalCoachingFullGuardArgs;
  transactionalCoachingLimited?: TransactionalCoachingLimitedGuardArgs;
  outboundDaily?: OutboundDailyGuardArgs;
  /** Body entering unified guard (for telemetry previews). */
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
    inbound_coach_final_body_guards: InboundCoachFinalBodyGuardsResult | null;
    transactional_coaching_limited: TransactionalCoachingLimitedGuardResult | null;
  };
  repair_attempts: number;
  repair_succeeded: boolean | null;
  metadata: Record<string, unknown>;
  /** Preserved sub-guard outputs for downstream telemetry (route parity). */
  tuGuard: InboundFinalBodyTurnUnderstandingGuardResult;
  prematureAdjustmentGuard: InboundCoachFinalBodyGuardsResult["prematureAdjustmentGuard"];
  truthGuard: InboundFinalBodyTruthGuardResult | null;
  nearDuplicateGuard: RapidNearDuplicateCoachReplyGuardResult | null;
};

export type TransactionalCoachingLimitedGuardResult = {
  near_duplicate_guard: RapidNearDuplicateCoachReplyGuardResult;
  near_duplicate_post_oceg_recheck: RapidNearDuplicateCoachReplyGuardResult | null;
  truth_guard: InboundFinalBodyTruthGuardResult;
};

const NORMAL_COACHING_FULL_CHECKS = [
  "turn_understanding_stale_ask",
  "premature_adjustment",
  "unsupported_claim_oceg",
  "near_duplicate",
] as const;

export const TRANSACTIONAL_COACHING_LIMITED_CHECKS_SKIPPED: UnifiedFinalGuardSkippedCheck[] = [
  { check: "turn_understanding_stale_ask", reason: "no_turn_understanding_context" },
  { check: "premature_adjustment", reason: "no_miss_adjustment_policy" },
  { check: "internal_label", reason: "final_voice_gate_already_ran" },
  { check: "contract_legal", reason: "not_contract_path" },
];

export const OUTBOUND_DAILY_C1_CHECKS_SKIPPED: UnifiedFinalGuardSkippedCheck[] = [
  { check: "turn_understanding_stale_ask", reason: "inbound_only" },
  { check: "premature_adjustment", reason: "daily_server_strategy" },
  { check: "daily_stale_ask", reason: "pre_unified_daily_stale_guards" },
  { check: "contract_truth_recheck", reason: "c2_deferred" },
  { check: "refresh_pending_truth_recheck", reason: "c3_deferred" },
];

function deriveChecksRunFromInbound(inbound: InboundCoachFinalBodyGuardsResult): string[] {
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

function countRepairAttemptsFromMetas(
  metas: Array<Record<string, unknown> | undefined | null>
): number {
  let count = 0;
  for (const meta of metas) {
    if (repairAttemptedInMeta(meta ?? undefined)) count += 1;
  }
  return count;
}

function anyRepairSucceededFromMetas(
  metas: Array<Record<string, unknown> | undefined | null>
): boolean | null {
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
  unifiedArgs: UnifiedFinalGuardArgs;
  preBody: string;
  postBody: string;
  checksRun: string[];
  delegatedTo: string;
  shouldSend: boolean;
}): Record<string, unknown> {
  return {
    unified_final_guard_version: SMS_FINAL_PRODUCT_LAW_GUARD_VERSION,
    unified_final_guard_mode: args.unifiedArgs.mode,
    final_body_authority: UNIFIED_FINAL_BODY_AUTHORITY,
    pre_unified_guard_body_preview: args.preBody.slice(0, 120),
    post_unified_guard_body_preview: args.postBody.slice(0, 120),
    sent_body_equals_guard_body: args.shouldSend && args.postBody.trim().length > 0 ? true : null,
    unified_final_guard_route_purpose:
      args.unifiedArgs.routePurpose ??
      args.unifiedArgs.normalCoachingFull?.routePurpose ??
      args.unifiedArgs.transactionalCoachingLimited?.routePurpose ??
      null,
    unified_final_guard_branch_name: args.unifiedArgs.branchName ?? null,
    unified_final_guard_surface: args.unifiedArgs.surface,
    unified_final_guard_checks_run: args.checksRun,
    unified_final_guard_delegated_to: args.delegatedTo,
  };
}

function passThroughTuGuard(body: string): InboundFinalBodyTurnUnderstandingGuardResult {
  return {
    body,
    shouldSend: true,
    noSendReason: null,
    metadata: {
      transactional_coaching_limited_tu_stale_skipped: true,
      skip_reason: "no_turn_understanding_context",
    },
  };
}

function mapInboundToUnified(
  args: UnifiedFinalGuardArgs,
  inbound: InboundCoachFinalBodyGuardsResult,
  preBody: string
): UnifiedFinalGuardResult {
  const checksRun = deriveChecksRunFromInbound(inbound);
  const repairAttempts = countRepairAttemptsFromMetas([
    inbound.tuGuard.metadata,
    inbound.prematureAdjustmentGuard?.metadata,
    inbound.truthGuard?.metadata,
    inbound.nearDuplicateGuard?.metadata,
  ]);
  const metadata = buildWrapperMetadata({
    unifiedArgs: args,
    preBody,
    postBody: inbound.body,
    checksRun,
    delegatedTo: "applyInboundCoachFinalBodyGuards",
    shouldSend: inbound.shouldSend,
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
    checks_run: checksRun,
    checks_skipped: NORMAL_COACHING_FULL_CHECKS.filter((c) => !checksRun.includes(c)).map(
      (check) => ({
        check,
        reason: "not_reached_due_to_earlier_no_send_or_short_circuit",
      })
    ),
    guard_results: {
      inbound_coach_final_body_guards: inbound,
      transactional_coaching_limited: null,
    },
    repair_attempts: repairAttempts,
    repair_succeeded: anyRepairSucceededFromMetas([
      inbound.tuGuard.metadata,
      inbound.prematureAdjustmentGuard?.metadata,
      inbound.truthGuard?.metadata,
      inbound.nearDuplicateGuard?.metadata,
    ]),
    metadata,
    tuGuard: inbound.tuGuard,
    prematureAdjustmentGuard: inbound.prematureAdjustmentGuard,
    truthGuard: inbound.truthGuard,
    nearDuplicateGuard: inbound.nearDuplicateGuard,
  };
}

function mapTransactionalToUnified(args: {
  unifiedArgs: UnifiedFinalGuardArgs;
  preBody: string;
  body: string;
  shouldSend: boolean;
  noSendReason: string | null;
  checksRun: string[];
  transactional: TransactionalCoachingLimitedGuardResult;
}): UnifiedFinalGuardResult {
  const repairAttempts = countRepairAttemptsFromMetas([
    args.transactional.near_duplicate_guard.metadata,
    args.transactional.truth_guard.metadata,
    args.transactional.near_duplicate_post_oceg_recheck?.metadata,
  ]);
  const metadata = buildWrapperMetadata({
    unifiedArgs: args.unifiedArgs,
    preBody: args.preBody,
    postBody: args.body,
    checksRun: args.checksRun,
    delegatedTo: "transactional_coaching_limited",
    shouldSend: args.shouldSend,
  });

  return {
    should_send: args.shouldSend,
    shouldSend: args.shouldSend,
    body: args.body,
    no_send_reason: args.noSendReason,
    noSendReason: args.noSendReason,
    final_body_authority: UNIFIED_FINAL_BODY_AUTHORITY,
    guard_version: SMS_FINAL_PRODUCT_LAW_GUARD_VERSION,
    guard_mode: "transactional_coaching_limited",
    checks_run: args.checksRun,
    checks_skipped: TRANSACTIONAL_COACHING_LIMITED_CHECKS_SKIPPED,
    guard_results: {
      inbound_coach_final_body_guards: null,
      transactional_coaching_limited: args.transactional,
    },
    repair_attempts: repairAttempts,
    repair_succeeded: anyRepairSucceededFromMetas([
      args.transactional.near_duplicate_guard.metadata,
      args.transactional.truth_guard.metadata,
      args.transactional.near_duplicate_post_oceg_recheck?.metadata,
    ]),
    metadata: {
      ...metadata,
      unified_final_guard_checks_skipped: TRANSACTIONAL_COACHING_LIMITED_CHECKS_SKIPPED,
    },
    tuGuard: passThroughTuGuard(args.body),
    prematureAdjustmentGuard: null,
    truthGuard: args.transactional.truth_guard,
    nearDuplicateGuard:
      args.transactional.near_duplicate_post_oceg_recheck ??
      args.transactional.near_duplicate_guard,
  };
}

async function applyTransactionalCoachingLimitedGuard(
  args: TransactionalCoachingLimitedGuardArgs
): Promise<UnifiedFinalGuardResult> {
  const checksRun: string[] = [];
  const preBody = args.body.trim();

  const nearDuplicateGuard = await applyRapidNearDuplicateCoachReplyGuard({
    body: preBody,
    priorCoachBody: args.priorCoachBody,
    priorCoachSentAt: args.priorCoachSentAt,
    inboundRaw: args.inboundRaw,
    routePurpose: args.routePurpose ?? "transactional_coaching_limited",
    factsJson: args.factsJson ?? null,
    repairSnapshot: args.repairSnapshot ?? null,
    stage: args.nearDuplicateStage ?? "transactional_near_duplicate",
    nowMs: args.nowMs,
  });
  checksRun.push("near_duplicate");

  if (!nearDuplicateGuard.shouldSend) {
    return mapTransactionalToUnified({
      unifiedArgs: {
        mode: "transactional_coaching_limited",
        surface: "inbound",
        routePurpose: args.routePurpose,
      },
      preBody,
      body: nearDuplicateGuard.body,
      shouldSend: false,
      noSendReason: nearDuplicateGuard.noSendReason ?? RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
      checksRun,
      transactional: {
        near_duplicate_guard: nearDuplicateGuard,
        near_duplicate_post_oceg_recheck: null,
        truth_guard: {
          body: "",
          shouldSend: false,
          noSendReason: null,
          metadata: { unsupported_accountability_claim_guard_skipped: true },
        },
      },
    });
  }

  let body = nearDuplicateGuard.body;
  const bodyBeforeOceg = body;

  const truthGuard = await applyInboundFinalBodyTruthGuard({
    body,
    evidence: args.evidence,
    stage: args.ocegStage ?? "transactional_coaching_limited_oceg",
    routePurpose: args.routePurpose ?? "transactional_coaching_limited",
    factsJson: args.factsJson ?? null,
    repairSnapshot: args.repairSnapshot ?? null,
  });
  checksRun.push("unsupported_claim_oceg");

  if (!truthGuard.shouldSend) {
    return mapTransactionalToUnified({
      unifiedArgs: {
        mode: "transactional_coaching_limited",
        surface: "inbound",
        routePurpose: args.routePurpose,
      },
      preBody,
      body: truthGuard.body,
      shouldSend: false,
      noSendReason: truthGuard.noSendReason ?? UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
      checksRun,
      transactional: {
        near_duplicate_guard: nearDuplicateGuard,
        near_duplicate_post_oceg_recheck: null,
        truth_guard: truthGuard,
      },
    });
  }

  body = truthGuard.body;

  let nearDuplicatePostOcegRecheck: RapidNearDuplicateCoachReplyGuardResult | null = null;
  if (body.trim() !== bodyBeforeOceg.trim()) {
    nearDuplicatePostOcegRecheck = await applyRapidNearDuplicateCoachReplyGuard({
      body,
      priorCoachBody: args.priorCoachBody,
      priorCoachSentAt: args.priorCoachSentAt,
      inboundRaw: args.inboundRaw,
      routePurpose: args.routePurpose ?? "transactional_coaching_limited",
      factsJson: args.factsJson ?? null,
      repairSnapshot: args.repairSnapshot ?? null,
      stage: "transactional_near_duplicate_post_oceg_recheck",
      nowMs: args.nowMs,
    });
    checksRun.push("near_duplicate_post_oceg_recheck");

    if (!nearDuplicatePostOcegRecheck.shouldSend) {
      return mapTransactionalToUnified({
        unifiedArgs: {
          mode: "transactional_coaching_limited",
          surface: "inbound",
          routePurpose: args.routePurpose,
        },
        preBody,
        body: nearDuplicatePostOcegRecheck.body,
        shouldSend: false,
        noSendReason:
          nearDuplicatePostOcegRecheck.noSendReason ?? RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
        checksRun,
        transactional: {
          near_duplicate_guard: nearDuplicateGuard,
          near_duplicate_post_oceg_recheck: nearDuplicatePostOcegRecheck,
          truth_guard: truthGuard,
        },
      });
    }
    body = nearDuplicatePostOcegRecheck.body;
  }

  return mapTransactionalToUnified({
    unifiedArgs: {
      mode: "transactional_coaching_limited",
      surface: "inbound",
      routePurpose: args.routePurpose,
    },
    preBody,
    body,
    shouldSend: true,
    noSendReason: null,
    checksRun,
    transactional: {
      near_duplicate_guard: nearDuplicateGuard,
      near_duplicate_post_oceg_recheck: nearDuplicatePostOcegRecheck,
      truth_guard: truthGuard,
    },
  });
}

function mapOutboundDailyToUnified(args: {
  unifiedArgs: UnifiedFinalGuardArgs;
  preBody: string;
  body: string;
  shouldSend: boolean;
  noSendReason: string | null;
  checksRun: string[];
  truthGuard: InboundFinalBodyTruthGuardResult | null;
  nearDuplicateGuard: RapidNearDuplicateCoachReplyGuardResult | null;
  nearDuplicatePostOcegRecheck: RapidNearDuplicateCoachReplyGuardResult | null;
  productLawFailures?: string[] | null;
}): UnifiedFinalGuardResult {
  const repairAttempts = countRepairAttemptsFromMetas([
    args.nearDuplicateGuard?.metadata,
    args.truthGuard?.metadata,
    args.nearDuplicatePostOcegRecheck?.metadata,
  ]);
  const metadata = buildWrapperMetadata({
    unifiedArgs: args.unifiedArgs,
    preBody: args.preBody,
    postBody: args.body,
    checksRun: args.checksRun,
    delegatedTo: "outbound_daily_c1",
    shouldSend: args.shouldSend,
  });

  return {
    should_send: args.shouldSend,
    shouldSend: args.shouldSend,
    body: args.body,
    no_send_reason: args.noSendReason,
    noSendReason: args.noSendReason,
    final_body_authority: UNIFIED_FINAL_BODY_AUTHORITY,
    guard_version: SMS_FINAL_PRODUCT_LAW_GUARD_VERSION,
    guard_mode: "outbound_daily",
    checks_run: args.checksRun,
    checks_skipped: OUTBOUND_DAILY_C1_CHECKS_SKIPPED,
    guard_results: {
      inbound_coach_final_body_guards: null,
      transactional_coaching_limited: null,
    },
    repair_attempts: repairAttempts,
    repair_succeeded: anyRepairSucceededFromMetas([
      args.nearDuplicateGuard?.metadata,
      args.truthGuard?.metadata,
      args.nearDuplicatePostOcegRecheck?.metadata,
    ]),
    metadata: {
      ...metadata,
      unified_final_guard_checks_skipped: OUTBOUND_DAILY_C1_CHECKS_SKIPPED,
      ...(args.productLawFailures?.length ? { product_law_failures: args.productLawFailures } : {}),
      visible_sent: args.shouldSend ? true : false,
    },
    tuGuard: passThroughTuGuard(args.body),
    prematureAdjustmentGuard: null,
    truthGuard: args.truthGuard,
    nearDuplicateGuard: args.nearDuplicatePostOcegRecheck ?? args.nearDuplicateGuard,
  };
}

async function applyOutboundDailyC1Guard(
  args: OutboundDailyGuardArgs
): Promise<UnifiedFinalGuardResult> {
  const checksRun: string[] = [];
  const preBody = args.body.trim();
  const routePurpose = args.routePurpose;

  const nearDuplicateGuard = await applyRapidNearDuplicateCoachReplyGuard({
    body: preBody,
    priorCoachBody: args.priorCoachBody,
    priorCoachSentAt: args.priorCoachSentAt,
    inboundRaw: null,
    routePurpose,
    factsJson: args.factsJson ?? null,
    repairSnapshot: null,
    stage: args.nearDuplicateStage ?? "outbound_daily_near_duplicate",
    nowMs: args.nowMs,
  });
  checksRun.push("near_duplicate");

  if (!nearDuplicateGuard.shouldSend) {
    return mapOutboundDailyToUnified({
      unifiedArgs: {
        mode: "outbound_daily",
        surface: "daily",
        routePurpose,
      },
      preBody,
      body: nearDuplicateGuard.body,
      shouldSend: false,
      noSendReason: nearDuplicateGuard.noSendReason ?? RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
      checksRun,
      truthGuard: null,
      nearDuplicateGuard,
      nearDuplicatePostOcegRecheck: null,
      productLawFailures: [nearDuplicateGuard.noSendReason ?? RAPID_NEAR_DUPLICATE_REPLY_NO_SEND],
    });
  }

  let body = nearDuplicateGuard.body;
  const bodyBeforeOceg = body;

  const truthGuard = await applyInboundFinalBodyTruthGuard({
    body,
    evidence: args.evidence,
    stage: args.ocegStage ?? "outbound_daily_oceg",
    routePurpose,
    factsJson: args.factsJson ?? null,
    repairSnapshot: null,
  });
  checksRun.push("unsupported_claim_oceg");

  if (!truthGuard.shouldSend) {
    return mapOutboundDailyToUnified({
      unifiedArgs: {
        mode: "outbound_daily",
        surface: "daily",
        routePurpose,
      },
      preBody,
      body: truthGuard.body,
      shouldSend: false,
      noSendReason: truthGuard.noSendReason ?? UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND,
      checksRun,
      truthGuard,
      nearDuplicateGuard,
      nearDuplicatePostOcegRecheck: null,
      productLawFailures: [truthGuard.noSendReason ?? UNSUPPORTED_ACCOUNTABILITY_CLAIM_NO_SEND],
    });
  }

  body = truthGuard.body;

  let nearDuplicatePostOcegRecheck: RapidNearDuplicateCoachReplyGuardResult | null = null;
  if (body.trim() !== bodyBeforeOceg.trim()) {
    nearDuplicatePostOcegRecheck = await applyRapidNearDuplicateCoachReplyGuard({
      body,
      priorCoachBody: args.priorCoachBody,
      priorCoachSentAt: args.priorCoachSentAt,
      inboundRaw: null,
      routePurpose,
      factsJson: args.factsJson ?? null,
      repairSnapshot: null,
      stage: "outbound_daily_near_duplicate_post_oceg_recheck",
      nowMs: args.nowMs,
    });
    checksRun.push("near_duplicate_post_oceg_recheck");

    if (!nearDuplicatePostOcegRecheck.shouldSend) {
      return mapOutboundDailyToUnified({
        unifiedArgs: {
          mode: "outbound_daily",
          surface: "daily",
          routePurpose,
        },
        preBody,
        body: nearDuplicatePostOcegRecheck.body,
        shouldSend: false,
        noSendReason:
          nearDuplicatePostOcegRecheck.noSendReason ?? RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
        checksRun,
        truthGuard,
        nearDuplicateGuard,
        nearDuplicatePostOcegRecheck,
        productLawFailures: [
          nearDuplicatePostOcegRecheck.noSendReason ?? RAPID_NEAR_DUPLICATE_REPLY_NO_SEND,
        ],
      });
    }
    body = nearDuplicatePostOcegRecheck.body;
  }

  const proofViolation = detectDailyOutboundUnsupportedProofClaim(body, args.dailyGuardCtx);
  checksRun.push("unsupported_proof_victory");
  if (proofViolation) {
    return mapOutboundDailyToUnified({
      unifiedArgs: {
        mode: "outbound_daily",
        surface: "daily",
        routePurpose,
      },
      preBody,
      body: "",
      shouldSend: false,
      noSendReason: OUTBOUND_DAILY_UNSUPPORTED_PROOF_NO_SEND,
      checksRun,
      truthGuard,
      nearDuplicateGuard,
      nearDuplicatePostOcegRecheck,
      productLawFailures: [proofViolation.violation],
    });
  }

  const internalLabels = userVisibleInternalLabelBlockedReasons(body);
  checksRun.push("internal_label_detect");
  if (internalLabels.length > 0) {
    return mapOutboundDailyToUnified({
      unifiedArgs: {
        mode: "outbound_daily",
        surface: "daily",
        routePurpose,
      },
      preBody,
      body: "",
      shouldSend: false,
      noSendReason: OUTBOUND_DAILY_INTERNAL_LABEL_NO_SEND,
      checksRun,
      truthGuard,
      nearDuplicateGuard,
      nearDuplicatePostOcegRecheck,
      productLawFailures: internalLabels,
    });
  }

  return mapOutboundDailyToUnified({
    unifiedArgs: {
      mode: "outbound_daily",
      surface: "daily",
      routePurpose,
    },
    preBody,
    body,
    shouldSend: true,
    noSendReason: null,
    checksRun,
    truthGuard,
    nearDuplicateGuard,
    nearDuplicatePostOcegRecheck,
  });
}

export function compactUnifiedFinalGuardForTelemetry(
  result: UnifiedFinalGuardResult
): Record<string, unknown> {
  return {
    ...result.metadata,
    unified_final_guard_no_send_reason: result.no_send_reason,
    unified_final_guard_repair_attempts: result.repair_attempts,
    unified_final_guard_repair_succeeded: result.repair_succeeded,
    unified_final_guard_checks_skipped: result.checks_skipped,
  };
}

export async function applyUnifiedSmsFinalProductLawGuard(
  args: UnifiedFinalGuardArgs
): Promise<UnifiedFinalGuardResult> {
  if (args.mode === "hard_route_bypass") {
    const body = (args.candidateBody ?? args.normalCoachingFull?.body ?? "").trim();
    const tuGuard = passThroughTuGuard(body);
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
      guard_results: {
        inbound_coach_final_body_guards: null,
        transactional_coaching_limited: null,
      },
      repair_attempts: 0,
      repair_succeeded: null,
      metadata: {
        unified_final_guard_version: SMS_FINAL_PRODUCT_LAW_GUARD_VERSION,
        unified_final_guard_mode: args.mode,
        final_body_authority: UNIFIED_FINAL_BODY_AUTHORITY,
        hard_route_bypass: true,
      },
      tuGuard,
      prematureAdjustmentGuard: null,
      truthGuard: null,
      nearDuplicateGuard: null,
    };
  }

  if (args.mode === "transactional_coaching_limited") {
    if (!args.transactionalCoachingLimited) {
      throw new Error(
        "sms_final_product_law_guard: transactionalCoachingLimited args required for transactional_coaching_limited mode"
      );
    }
    const preBody = (args.preGuardBodyPreview ?? args.transactionalCoachingLimited.body).trim();
    const result = await applyTransactionalCoachingLimitedGuard({
      ...args.transactionalCoachingLimited,
      body: args.transactionalCoachingLimited.body.trim(),
    });
    return {
      ...result,
      metadata: {
        ...result.metadata,
        pre_unified_guard_body_preview: preBody.slice(0, 120),
        unified_final_guard_branch_name: args.branchName ?? null,
        unified_final_guard_route_purpose: args.routePurpose ?? args.transactionalCoachingLimited.routePurpose ?? null,
      },
    };
  }

  if (args.mode === "outbound_weekly") {
    throw new Error(
      `sms_final_product_law_guard: mode "${args.mode}" is not activated in PR 2.1b`
    );
  }

  if (args.mode === "outbound_daily") {
    if (!args.outboundDaily) {
      throw new Error(
        "sms_final_product_law_guard: outboundDaily args required for outbound_daily mode"
      );
    }
    const routePurpose = args.routePurpose ?? args.outboundDaily.routePurpose;
    if (!isOutboundDailyC1RoutePurpose(routePurpose)) {
      throw new Error(
        `sms_final_product_law_guard: outbound_daily not activated for route "${routePurpose ?? "unknown"}"`
      );
    }
    const preBody = (args.preGuardBodyPreview ?? args.outboundDaily.body).trim();
    const result = await applyOutboundDailyC1Guard({
      ...args.outboundDaily,
      body: args.outboundDaily.body.trim(),
      routePurpose,
    });
    return {
      ...result,
      metadata: {
        ...result.metadata,
        pre_unified_guard_body_preview: preBody.slice(0, 120),
        post_unified_guard_body_preview: result.body.slice(0, 120),
        unified_final_guard_branch_name: args.branchName ?? routePurpose,
        unified_final_guard_route_purpose: routePurpose,
        sent_body_equals_guard_body: result.shouldSend && result.body.trim().length > 0,
      },
    };
  }

  if (args.mode !== "normal_coaching_full") {
    throw new Error(`sms_final_product_law_guard: unsupported mode "${args.mode}"`);
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
