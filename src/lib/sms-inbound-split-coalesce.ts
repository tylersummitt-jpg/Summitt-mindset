import { supabaseServer } from "@/lib/supabase-server";
import { mergeSplitInboundRawBodies } from "@/lib/sms-inbound-split-body";

/** Rapid multi-segment user SMS: merge older pending coach jobs into the newest claimed job. */
const SPLIT_COALESCE_WINDOW_MS = 120_000;

export { mergeSplitInboundRawBodies } from "@/lib/sms-inbound-split-body";

/**
 * For the job currently in `processing`, find older `pending` jobs from the same user in a short
 * time window, merge their `raw_body` into this job (chronological order), and cancel the elders.
 */
export async function coalesceOlderPendingSplitJobsForClaimedJob(job: {
  message_sid: string;
  clerk_user_id: string;
  created_at: string;
  raw_body: string;
}): Promise<{ mergedRawBody: string; cancelledMessageSids: string[] }> {
  const createdMs = new Date(job.created_at).getTime();
  if (!Number.isFinite(createdMs)) {
    return { mergedRawBody: (job.raw_body || "").trim(), cancelledMessageSids: [] };
  }
  const windowStartIso = new Date(createdMs - SPLIT_COALESCE_WINDOW_MS).toISOString();

  const { data: elders, error } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select("message_sid, raw_body, created_at")
    .eq("clerk_user_id", job.clerk_user_id)
    .eq("status", "pending")
    .lt("created_at", job.created_at)
    .gte("created_at", windowStartIso)
    .order("created_at", { ascending: true });

  if (error || !elders?.length) {
    return { mergedRawBody: (job.raw_body || "").trim(), cancelledMessageSids: [] };
  }

  const cancelledMessageSids: string[] = [];
  for (const row of elders) {
    const sid = typeof row.message_sid === "string" ? row.message_sid : "";
    if (!sid || sid === job.message_sid) continue;
    const { error: upErr } = await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
        last_error: "split_inbound_coalesced_into_newer_job",
        next_retry_at: new Date(Date.now() + 86400 * 365 * 10 * 1000).toISOString(),
      })
      .eq("message_sid", sid)
      .eq("status", "pending");
    if (!upErr) cancelledMessageSids.push(sid);
  }

  const elderBodies = elders
    .map((e) => (typeof e.raw_body === "string" ? e.raw_body : ""))
    .filter((s) => s.trim().length > 0);
  const mergedRawBody = mergeSplitInboundRawBodies([...elderBodies, job.raw_body || ""]);

  if (mergedRawBody !== (job.raw_body || "").trim() && cancelledMessageSids.length > 0) {
    await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        raw_body: mergedRawBody,
        updated_at: new Date().toISOString(),
      })
      .eq("message_sid", job.message_sid)
      .eq("status", "processing");
  }

  return { mergedRawBody, cancelledMessageSids };
}
