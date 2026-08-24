/**
 * Slice D2c — schedule D0 semantic-target claim after Sol Win persist
 * for a pending_user clarification photo.
 * Does not send SMS, create Wins, download media, or run C2.
 */

import "server-only";

import { after } from "next/server";
import type { PersistRecognizedWinsResult } from "@/lib/v2-win-persist";
import type { InboundSolPendingPhotoRelation } from "@/lib/inbound-sol-coaching-brief";
import { claimInboundMediaJobSemanticTarget } from "@/lib/victory-media/claim-inbound-mms-semantic-target";
import {
  inboundMmsD1OriginalJobStillSoleEligible,
  resolveInboundMmsD1ClaimTarget,
  type InboundMmsD1ClaimTarget,
} from "@/lib/victory-media/inbound-mms-d1-claim";
import type { InboundMmsD1PendingContext } from "@/lib/victory-media/inbound-mms-d1-pending-context";
import {
  isInboundMmsPendingClarificationContext,
  listInboundMmsD2cEligiblePendingJobs,
  type InboundMmsD2cJobLite,
} from "@/lib/victory-media/inbound-mms-d2c-pending-context";

export type { InboundMmsD1ClaimTarget };

export const INBOUND_MEDIA_D2C_EXPECTED_RESOLUTION = "pending_user" as const;

export type ScheduleInboundMmsD2cSemanticClaimDeps = {
  afterFn?: (fn: () => void | Promise<void>) => void;
  claim?: typeof claimInboundMediaJobSemanticTarget;
  listEligiblePending?: (args: {
    clerkUserId: string;
    currentMessageSid: string;
    now?: Date;
  }) => Promise<InboundMmsD2cJobLite[] | "error">;
};

/**
 * Fire-and-forget D0 claim with expectedResolution=pending_user.
 * Must not delay Coach reply. Missed after() leaves the photo pending_user.
 * Revalidates current eligible cardinality immediately before D0.
 */
export function scheduleInboundMmsD2cSemanticClaim(
  args: {
    clerkUserId: string;
    currentMessageSid: string;
    context: InboundMmsD1PendingContext;
    relation: InboundSolPendingPhotoRelation;
    winResult: PersistRecognizedWinsResult | null;
  },
  deps: ScheduleInboundMmsD2cSemanticClaimDeps = {}
): InboundMmsD1ClaimTarget | null {
  if (!isInboundMmsPendingClarificationContext(args.context)) return null;

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
    deps.listEligiblePending ?? listInboundMmsD2cEligiblePendingJobs;

  try {
    afterFn(async () => {
      try {
        let eligible: InboundMmsD2cJobLite[] | "error";
        try {
          eligible = await listEligiblePending({
            clerkUserId,
            currentMessageSid,
            now: new Date(),
          });
        } catch (e) {
          console.warn("[victory-media/mms-d2c] claim_revalidate_failed", {
            message: e instanceof Error ? e.message.slice(0, 120) : "unknown",
          });
          return;
        }

        const decision = inboundMmsD1OriginalJobStillSoleEligible(
          eligible,
          target.jobId
        );
        if (decision === "lookup_failed") {
          console.warn("[victory-media/mms-d2c] claim_revalidate_failed", {
            reason: "lookup_failed",
          });
          return;
        }
        if (decision !== "allow") {
          console.warn("[victory-media/mms-d2c] claim_revalidate_blocked", {
            reason: "cardinality_or_job_mismatch",
          });
          return;
        }

        const result = await claim({
          jobId: target.jobId,
          clerkUserId,
          targetWinId: target.targetWinId,
          expectedResolution: INBOUND_MEDIA_D2C_EXPECTED_RESOLUTION,
        });
        if (!result.ok) {
          console.warn("[victory-media/mms-d2c] claim_failed", {
            reason: result.reason,
          });
        }
      } catch (e) {
        console.warn("[victory-media/mms-d2c] claim_failed", {
          message: e instanceof Error ? e.message.slice(0, 120) : "unknown",
        });
      }
    });
  } catch (e) {
    console.warn("[victory-media/mms-d2c] after_unavailable", {
      message: e instanceof Error ? e.message.slice(0, 120) : "unknown",
    });
  }

  return target;
}
