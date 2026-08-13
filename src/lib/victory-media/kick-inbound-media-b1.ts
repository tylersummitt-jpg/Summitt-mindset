/**
 * Tiny batch kick for Slice B1 inbound media downloads.
 * Max 2 jobs, concurrency 1. Safe to call from after().
 *
 * Discovers pending_download + due failed + stale normalizing (null temp).
 * Quiet systems may leave due retries waiting until another MMS after() kick.
 */

import "server-only";

import { listInboundMediaJobsForDownloadClaim } from "@/lib/victory-media/claim-inbound-media-job";
import { processInboundMediaJobB1 } from "@/lib/victory-media/process-inbound-media-b1";

export const INBOUND_MEDIA_B1_BATCH_LIMIT = 2;

export type KickInboundMediaB1Result = {
  claimed: number;
  succeeded: number;
  failed: number;
};

/**
 * Process up to INBOUND_MEDIA_B1_BATCH_LIMIT actionable B1 jobs serially.
 * Never throws.
 */
export async function kickInboundMediaB1Downloads(): Promise<KickInboundMediaB1Result> {
  const result: KickInboundMediaB1Result = {
    claimed: 0,
    succeeded: 0,
    failed: 0,
  };

  try {
    const ids = await listInboundMediaJobsForDownloadClaim(INBOUND_MEDIA_B1_BATCH_LIMIT);
    for (const id of ids) {
      result.claimed += 1;
      try {
        const r = await processInboundMediaJobB1(id);
        if (r.ok) result.succeeded += 1;
        else result.failed += 1;
      } catch (e) {
        result.failed += 1;
        console.error("[victory-media/mms-b1] kick_job_threw", {
          job_id: id,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } catch (e) {
    console.error("[victory-media/mms-b1] kick_list_threw", {
      message: e instanceof Error ? e.message : String(e),
    });
  }

  return result;
}
