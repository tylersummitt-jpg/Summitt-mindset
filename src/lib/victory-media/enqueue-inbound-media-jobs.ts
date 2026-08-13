/**
 * Durable MMS media job enqueue (Slice A2).
 * Inserts pending_download rows only — no download, normalize, attach, or MediaUrl storage.
 */

import { randomUUID } from "crypto";
import { supabaseServer } from "@/lib/supabase-server";
import { isVictoryMediaMmsIngestEnabled } from "@/lib/victory-media/mms-ingest-flags";
import {
  collectInboundMmsEnqueueCandidates,
  type InboundMmsEnqueueCandidate,
} from "@/lib/victory-media/parse-inbound-mms-media";

export type EnqueueInboundMediaJobInput = {
  clerkUserId: string;
  messageSid: string;
  media: Array<{
    ordinal: number;
    declaredContentType: string;
    twilioMediaSid: string | null;
  }>;
};

export type EnqueueInboundMediaJobsResult = {
  attempted: number;
  inserted: number;
  alreadyExisted: number;
  failed: number;
};

function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

/**
 * Insert pending_download jobs. Unique (message_sid, media_ordinal) → leave row untouched.
 * Does not accept Storage paths, bytes, Win ids, or MediaUrl.
 */
export async function enqueueInboundMediaJobs(
  input: EnqueueInboundMediaJobInput
): Promise<EnqueueInboundMediaJobsResult> {
  const clerkUserId = input.clerkUserId.trim();
  const messageSid = input.messageSid.trim();
  const result: EnqueueInboundMediaJobsResult = {
    attempted: 0,
    inserted: 0,
    alreadyExisted: 0,
    failed: 0,
  };

  if (!clerkUserId || !messageSid || !Array.isArray(input.media) || input.media.length === 0) {
    return result;
  }

  for (const item of input.media) {
    if (!Number.isInteger(item.ordinal) || item.ordinal < 0) continue;
    const declared = item.declaredContentType.trim().toLowerCase();
    if (!declared) continue;

    result.attempted += 1;
    const row = {
      id: randomUUID(),
      message_sid: messageSid,
      media_ordinal: item.ordinal,
      clerk_user_id: clerkUserId,
      twilio_media_sid: item.twilioMediaSid?.trim() || null,
      declared_content_type: declared,
      status: "pending_download",
      attempt_count: 0,
      // TTL not product-locked for A2 — leave null
      expires_at: null,
      next_retry_at: null,
      last_error_code: null,
      temp_storage_path: null,
      normalized_storage_path: null,
      attached_win_id: null,
      resolution: null,
      classifier_target: null,
      followup_idempotency_key: null,
      tombstoned_at: null,
    };

    const { error } = await supabaseServer.from("v2_inbound_media_job").insert(row);

    if (!error) {
      result.inserted += 1;
      console.info("[victory-media/mms-enqueue] inserted", {
        message_sid: messageSid,
        media_ordinal: item.ordinal,
        job_id: row.id,
      });
      continue;
    }

    if (isUniqueViolation(error)) {
      result.alreadyExisted += 1;
      console.info("[victory-media/mms-enqueue] already_exists", {
        message_sid: messageSid,
        media_ordinal: item.ordinal,
      });
      continue;
    }

    result.failed += 1;
    console.error("[victory-media/mms-enqueue] insert_failed", {
      message_sid: messageSid,
      media_ordinal: item.ordinal,
      code: (error as { code?: string }).code ?? null,
      message: error.message,
    });
  }

  return result;
}

/**
 * Best-effort: parse Twilio params → enqueue supported media when ingest flag is on.
 * Never throws; never logs MediaUrl.
 */
export async function maybeEnqueueInboundMediaJobsFromTwilioParams(args: {
  clerkUserId: string;
  messageSid: string;
  params: URLSearchParams;
  numMedia: number;
}): Promise<EnqueueInboundMediaJobsResult | null> {
  if (!isVictoryMediaMmsIngestEnabled()) return null;
  if (args.numMedia <= 0) return null;

  let candidates: InboundMmsEnqueueCandidate[] = [];
  try {
    candidates = collectInboundMmsEnqueueCandidates({
      params: args.params,
      messageSid: args.messageSid,
      numMedia: args.numMedia,
      twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? null,
    });
  } catch (e) {
    console.error("[victory-media/mms-enqueue] parse_failed", {
      message_sid: args.messageSid,
      message: e instanceof Error ? e.message : String(e),
    });
    return {
      attempted: 0,
      inserted: 0,
      alreadyExisted: 0,
      failed: 0,
    };
  }

  if (candidates.length === 0) {
    return {
      attempted: 0,
      inserted: 0,
      alreadyExisted: 0,
      failed: 0,
    };
  }

  try {
    return await enqueueInboundMediaJobs({
      clerkUserId: args.clerkUserId,
      messageSid: args.messageSid,
      media: candidates,
    });
  } catch (e) {
    console.error("[victory-media/mms-enqueue] enqueue_threw", {
      message_sid: args.messageSid,
      message: e instanceof Error ? e.message : String(e),
    });
    return {
      attempted: candidates.length,
      inserted: 0,
      alreadyExisted: 0,
      failed: candidates.length,
    };
  }
}
