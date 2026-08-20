/**
 * MMS pipeline kick (B1 download + B2 normalize).
 * Concurrency 1. Safe to call from after().
 *
 * One invocation:
 * - at most one B1 job
 * - at most one B2 normalization
 *
 * Fairness: oldest actionable B2 work wins the one normalize slot
 * (leased B2-ready / due B2 failed+temp outrank a just-completed B1 job).
 * A just-completed B1 job is a candidate only when no older listed B2 exists.
 *
 * Quiet systems may leave work waiting until another MMS after() kick.
 */

import "server-only";

import {
  listInboundMediaJobsForB2,
  listInboundMediaJobsForDownloadClaim,
} from "@/lib/victory-media/claim-inbound-media-job";
import { processInboundMediaJobB1 } from "@/lib/victory-media/process-inbound-media-b1";
import {
  processInboundMediaJobB2,
  processInboundMediaJobB2AfterSuccessfulB1,
} from "@/lib/victory-media/process-inbound-media-b2";

export const INBOUND_MEDIA_PIPELINE_B1_LIMIT = 1;
export const INBOUND_MEDIA_PIPELINE_B2_LIMIT = 1;

export type KickInboundMediaPipelineResult = {
  b1Attempted: number;
  b1Succeeded: number;
  b2Attempted: number;
  b2Succeeded: number;
  normalized: number;
};

export type InboundMediaPipelineB2Target = {
  jobId: string;
  /** True only for the exact job this invocation just finished B1 for. */
  afterSuccessfulB1: boolean;
};

export type KickInboundMediaPipelineDeps = {
  listB1?: (limit: number) => Promise<string[]>;
  listB2?: (limit: number) => Promise<string[]>;
  processB1?: typeof processInboundMediaJobB1;
  processB2?: typeof processInboundMediaJobB2;
  processB2AfterSuccessfulB1?: typeof processInboundMediaJobB2AfterSuccessfulB1;
};

/**
 * Oldest listed B2 (leased ready or due retry) outranks a just-completed B1 job.
 * Lease bypass is used only when the fresh B1 job is the sole candidate.
 */
export function selectInboundMediaPipelineB2Target(args: {
  oldestListedB2Id: string | null;
  freshlyCompletedB1JobId: string | null;
}): InboundMediaPipelineB2Target | null {
  const listed = args.oldestListedB2Id?.trim() || null;
  const fresh = args.freshlyCompletedB1JobId?.trim() || null;
  if (listed) {
    return { jobId: listed, afterSuccessfulB1: false };
  }
  if (fresh) {
    return { jobId: fresh, afterSuccessfulB1: true };
  }
  return null;
}

/**
 * Process at most one B1 then at most one B2. Never throws.
 */
export async function kickInboundMediaPipeline(
  deps: KickInboundMediaPipelineDeps = {}
): Promise<KickInboundMediaPipelineResult> {
  const result: KickInboundMediaPipelineResult = {
    b1Attempted: 0,
    b1Succeeded: 0,
    b2Attempted: 0,
    b2Succeeded: 0,
    normalized: 0,
  };

  const listB1 = deps.listB1 ?? ((n: number) => listInboundMediaJobsForDownloadClaim(n));
  const listB2 = deps.listB2 ?? ((n: number) => listInboundMediaJobsForB2(n));
  const processB1 = deps.processB1 ?? processInboundMediaJobB1;
  const processB2 = deps.processB2 ?? processInboundMediaJobB2;
  const processB2AfterSuccessfulB1 =
    deps.processB2AfterSuccessfulB1 ?? processInboundMediaJobB2AfterSuccessfulB1;

  let freshlyCompletedB1JobId: string | null = null;

  try {
    const b1Ids = await listB1(INBOUND_MEDIA_PIPELINE_B1_LIMIT);
    const b1Id = b1Ids[0];
    if (b1Id) {
      result.b1Attempted = 1;
      try {
        const r = await processB1(b1Id);
        if (r.ok) {
          result.b1Succeeded = 1;
          freshlyCompletedB1JobId = r.jobId;
        }
      } catch (e) {
        console.error("[victory-media/mms-pipeline] b1_threw", {
          job_id: b1Id,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } catch (e) {
    console.error("[victory-media/mms-pipeline] b1_list_threw", {
      message: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    const b2Ids = await listB2(INBOUND_MEDIA_PIPELINE_B2_LIMIT);
    const target = selectInboundMediaPipelineB2Target({
      oldestListedB2Id: b2Ids[0] ?? null,
      freshlyCompletedB1JobId,
    });
    if (!target) return result;

    result.b2Attempted = 1;
    const r = target.afterSuccessfulB1
      ? await processB2AfterSuccessfulB1(target.jobId)
      : await processB2(target.jobId);
    if (r.ok) {
      result.b2Succeeded = 1;
      result.normalized = 1;
    }
  } catch (e) {
    console.error("[victory-media/mms-pipeline] b2_threw", {
      message: e instanceof Error ? e.message : String(e),
    });
  }

  return result;
}
