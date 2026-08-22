/**
 * MMS pipeline kick (B1 download + B2 normalize + C1 correlate + C2 attach + D2a).
 * Concurrency 1. Safe to call from after().
 *
 * One invocation:
 * - at most one B1 job
 * - at most one B2 normalization
 * - at most one lightweight C1 correlation (reads/state only)
 * - at most one C2 canonical attach (Storage + v2_win_media)
 * - at most one D2a photo-only semantic evaluation (last; never starves transport)
 *
 * Fairness: oldest actionable B2 work wins the one normalize slot
 * (leased B2-ready / due B2 failed+temp outrank a just-completed B1 job).
 * A just-completed B1 job is a candidate only when no older listed B2 exists.
 *
 * C1 attach_eligible arms next_retry_at +60, so a newly armed job is not
 * C2-due in the same kick. Recovery cron provides the next opportunity.
 */

import "server-only";

import {
  listInboundMediaJobsForB2,
  listInboundMediaJobsForDownloadClaim,
} from "@/lib/victory-media/claim-inbound-media-job";
import {
  INBOUND_MEDIA_PIPELINE_C1_LIMIT,
  listInboundMediaJobsForC1,
  tryCorrelateInboundMmsC1Job,
} from "@/lib/victory-media/correlate-inbound-mms-c1";
import {
  INBOUND_MEDIA_PIPELINE_C2_LIMIT,
  listInboundMediaJobsForC2,
  tryAttachInboundMmsC2Job,
} from "@/lib/victory-media/attach-inbound-mms-c2";
import {
  INBOUND_MEDIA_PIPELINE_D2A_LIMIT,
  listInboundMediaJobsForD2a,
  processInboundMmsD2aJob,
} from "@/lib/victory-media/inbound-mms-d2a";
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
  c1Attempted: number;
  c2Attempted: number;
  c2Succeeded: number;
  attached: number;
  d2aAttempted: number;
  d2aClaimed: number;
};

export type InboundMediaPipelineB2Target = {
  jobId: string;
  /** True only for the exact job this invocation just finished B1 for. */
  afterSuccessfulB1: boolean;
};

export type KickInboundMediaPipelineDeps = {
  listB1?: (limit: number) => Promise<string[]>;
  listB2?: (limit: number) => Promise<string[]>;
  listC1?: (limit: number) => Promise<string[]>;
  listC2?: (limit: number) => Promise<string[]>;
  processB1?: typeof processInboundMediaJobB1;
  processB2?: typeof processInboundMediaJobB2;
  processB2AfterSuccessfulB1?: typeof processInboundMediaJobB2AfterSuccessfulB1;
  correlateC1?: (jobId: string) => Promise<unknown>;
  attachC2?: (jobId: string) => Promise<unknown>;
  listD2a?: (limit: number) => Promise<string[]>;
  processD2a?: (jobId: string) => Promise<unknown>;
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
    c1Attempted: 0,
    c2Attempted: 0,
    c2Succeeded: 0,
    attached: 0,
    d2aAttempted: 0,
    d2aClaimed: 0,
  };

  const listB1 = deps.listB1 ?? ((n: number) => listInboundMediaJobsForDownloadClaim(n));
  const listB2 = deps.listB2 ?? ((n: number) => listInboundMediaJobsForB2(n));
  const listC1 = deps.listC1 ?? ((n: number) => listInboundMediaJobsForC1(n));
  const listC2 = deps.listC2 ?? ((n: number) => listInboundMediaJobsForC2(n));
  const processB1 = deps.processB1 ?? processInboundMediaJobB1;
  const processB2 = deps.processB2 ?? processInboundMediaJobB2;
  const processB2AfterSuccessfulB1 =
    deps.processB2AfterSuccessfulB1 ?? processInboundMediaJobB2AfterSuccessfulB1;
  const correlateC1 = deps.correlateC1 ?? tryCorrelateInboundMmsC1Job;
  const attachC2 = deps.attachC2 ?? tryAttachInboundMmsC2Job;
  const listD2a = deps.listD2a ?? ((n: number) => listInboundMediaJobsForD2a(n));
  const processD2a = deps.processD2a ?? processInboundMmsD2aJob;

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
    if (target) {
      result.b2Attempted = 1;
      const r = target.afterSuccessfulB1
        ? await processB2AfterSuccessfulB1(target.jobId)
        : await processB2(target.jobId);
      if (r.ok) {
        result.b2Succeeded = 1;
        result.normalized = 1;
      }
    }
  } catch (e) {
    console.error("[victory-media/mms-pipeline] b2_threw", {
      message: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    const c1Ids = await listC1(INBOUND_MEDIA_PIPELINE_C1_LIMIT);
    const c1Id = c1Ids[0];
    if (c1Id) {
      result.c1Attempted = 1;
      await correlateC1(c1Id);
    }
  } catch (e) {
    console.error("[victory-media/mms-pipeline] c1_threw", {
      message: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    const c2Ids = await listC2(INBOUND_MEDIA_PIPELINE_C2_LIMIT);
    const c2Id = c2Ids[0];
    if (c2Id) {
      result.c2Attempted = 1;
      const r = await attachC2(c2Id);
      if (r && typeof r === "object" && "ok" in r && r.ok === true) {
        result.c2Succeeded = 1;
        result.attached = 1;
      }
    }
  } catch (e) {
    console.error("[victory-media/mms-pipeline] c2_threw", {
      message: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    const d2aIds = await listD2a(INBOUND_MEDIA_PIPELINE_D2A_LIMIT);
    const d2aId = d2aIds[0];
    if (d2aId) {
      result.d2aAttempted = 1;
      const r = await processD2a(d2aId);
      if (
        r &&
        typeof r === "object" &&
        "ok" in r &&
        r.ok === true &&
        "action" in r &&
        r.action === "claimed"
      ) {
        result.d2aClaimed = 1;
      }
    }
  } catch (e) {
    console.error("[victory-media/mms-pipeline] d2a_threw", {
      message: e instanceof Error ? e.message : String(e),
    });
  }

  return result;
}
