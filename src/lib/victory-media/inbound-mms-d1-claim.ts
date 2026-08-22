/**
 * Slice D1 — schedule D0 semantic-target claim after Sol Win persist.
 * Does not send SMS, create Wins, download media, or run C2.
 */

import "server-only";

import { after } from "next/server";
import type { PersistRecognizedWinsResult } from "@/lib/v2-win-persist";
import type { InboundSolPendingPhotoRelation } from "@/lib/inbound-sol-coaching-brief";
import { claimInboundMediaJobSemanticTarget } from "@/lib/victory-media/claim-inbound-mms-semantic-target";
import {
  listInboundMmsD1EligiblePendingJobs,
  type InboundMmsD1JobLite,
  type InboundMmsD1PendingContext,
} from "@/lib/victory-media/inbound-mms-d1-pending-context";

export type { InboundSolPendingPhotoRelation };

export type InboundMmsD1ClaimTarget = {
  jobId: string;
  targetWinId: string;
};

function sameId(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Durable Win ids from THIS turn's persist result only.
 * Inserted or existing/idempotent with a non-null id. Never "latest Win".
 */
export function collectDurableWinIdsFromPersistResult(
  result: PersistRecognizedWinsResult | null
): string[] {
  if (!result) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of result.wins) {
    if (row.status !== "inserted" && row.status !== "existing") continue;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(id);
  }
  return ids;
}

export function resolveInboundMmsD1ClaimTarget(args: {
  context: InboundMmsD1PendingContext;
  relation: InboundSolPendingPhotoRelation;
  winResult: PersistRecognizedWinsResult | null;
}): InboundMmsD1ClaimTarget | null {
  if (args.context.candidate_count !== 1 || !args.context.candidate) return null;
  const jobId = args.context.candidate.job_id.trim();
  if (!jobId) return null;

  if (args.relation.relation === "none" || args.relation.relation === "uncertain") {
    return null;
  }

  if (args.relation.relation === "current_turn_win") {
    if (args.relation.target_win_id != null) return null;
    const ids = collectDurableWinIdsFromPersistResult(args.winResult);
    if (ids.length !== 1) return null;
    return { jobId, targetWinId: ids[0]! };
  }

  if (args.relation.relation === "existing_win") {
    const target = args.relation.target_win_id?.trim() ?? "";
    if (!target) return null;
    const allowed = args.context.recent_wins.some((w) => sameId(w.id, target));
    if (!allowed) return null;
    return { jobId, targetWinId: target };
  }

  return null;
}

export type InboundMmsD1ClaimTimeOriginalJobDecision =
  | "allow"
  | "block"
  | "lookup_failed";

/**
 * Claim-time original-job law: exactly one current eligible job, and it is
 * the same job the interpreter saw. Never substitute a later photo.
 */
export function inboundMmsD1OriginalJobStillSoleEligible(
  eligible: InboundMmsD1JobLite[] | "error",
  originalJobId: string
): InboundMmsD1ClaimTimeOriginalJobDecision {
  if (eligible === "error") return "lookup_failed";
  const original = originalJobId.trim();
  if (!original) return "block";
  if (eligible.length !== 1) return "block";
  if (!sameId(eligible[0]!.id, original)) return "block";
  return "allow";
}

export type ScheduleInboundMmsD1SemanticClaimDeps = {
  afterFn?: (fn: () => void | Promise<void>) => void;
  claim?: typeof claimInboundMediaJobSemanticTarget;
  listEligiblePending?: (args: {
    clerkUserId: string;
    currentMessageSid: string;
    now?: Date;
  }) => Promise<InboundMmsD1JobLite[] | "error">;
};

/**
 * Fire-and-forget D0 claim. Must not delay Coach reply.
 * Missed after() leaves the photo pending_semantics (D2 recovery).
 * Revalidates current eligible cardinality immediately before D0.
 */
export function scheduleInboundMmsD1SemanticClaim(
  args: {
    clerkUserId: string;
    currentMessageSid: string;
    context: InboundMmsD1PendingContext;
    relation: InboundSolPendingPhotoRelation;
    winResult: PersistRecognizedWinsResult | null;
  },
  deps: ScheduleInboundMmsD1SemanticClaimDeps = {}
): InboundMmsD1ClaimTarget | null {
  const target = resolveInboundMmsD1ClaimTarget({
    context: args.context,
    relation: args.relation,
    winResult: args.winResult,
  });
  if (!target) return null;

  const clerkUserId = args.clerkUserId.trim();
  const currentMessageSid = args.currentMessageSid.trim();
  if (!clerkUserId || !currentMessageSid) return null;

  const afterFn = deps.afterFn ?? after;
  const claim = deps.claim ?? claimInboundMediaJobSemanticTarget;
  const listEligiblePending =
    deps.listEligiblePending ?? listInboundMmsD1EligiblePendingJobs;

  try {
    afterFn(async () => {
      try {
        let eligible: InboundMmsD1JobLite[] | "error";
        try {
          eligible = await listEligiblePending({
            clerkUserId,
            currentMessageSid,
            now: new Date(),
          });
        } catch (e) {
          console.warn("[victory-media/mms-d1] claim_revalidate_failed", {
            message: e instanceof Error ? e.message.slice(0, 120) : "unknown",
          });
          return;
        }

        const decision = inboundMmsD1OriginalJobStillSoleEligible(
          eligible,
          target.jobId
        );
        if (decision === "lookup_failed") {
          console.warn("[victory-media/mms-d1] claim_revalidate_failed", {
            reason: "lookup_failed",
          });
          return;
        }
        if (decision !== "allow") {
          console.warn("[victory-media/mms-d1] claim_revalidate_blocked", {
            reason: "cardinality_or_job_mismatch",
          });
          return;
        }

        const result = await claim({
          jobId: target.jobId,
          clerkUserId,
          targetWinId: target.targetWinId,
        });
        if (!result.ok) {
          console.warn("[victory-media/mms-d1] claim_failed", {
            reason: result.reason,
          });
        }
      } catch (e) {
        console.warn("[victory-media/mms-d1] claim_failed", {
          message: e instanceof Error ? e.message.slice(0, 120) : "unknown",
        });
      }
    });
  } catch (e) {
    console.warn("[victory-media/mms-d1] after_unavailable", {
      message: e instanceof Error ? e.message.slice(0, 120) : "unknown",
    });
  }

  return target;
}
