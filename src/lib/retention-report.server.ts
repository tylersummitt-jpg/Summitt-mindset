import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import type { RetentionIntelligence } from "@/lib/retention-intelligence";
import {
  interpretRetentionReportRead,
  RETENTION_REPORT_SCHEMA_VERSION,
  retentionReportClaimOrFilter,
  retentionReportError,
  retentionReportHasPrivateContent,
} from "@/lib/retention-report";

export async function readSavedRetentionReport(nowMs = Date.now()) {
  const { data, error } = await supabaseServer
    .from("retention_report")
    .select("report, calculated_at, schema_version, state, started_at, error")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    console.warn("[retention-report] read failed", { code: error.code });
  }
  return interpretRetentionReportRead({
    error: error ? { code: error.code, message: error.message } : null,
    row: data,
    nowMs,
  });
}

export async function claimRetentionReport(token: string, nowMs = Date.now()): Promise<"claimed" | "busy" | "unavailable"> {
  const { data, error } = await supabaseServer
    .from("retention_report")
    .update({
      state: "running",
      run_token: token,
      started_at: new Date(nowMs).toISOString(),
      error: null,
    })
    .eq("id", 1)
    .or(retentionReportClaimOrFilter(nowMs))
    .select("id");
  if (error) {
    console.warn("[retention-report] claim failed", { code: error.code });
    return "unavailable";
  }
  return data && data.length > 0 ? "claimed" : "busy";
}

export async function publishRetentionReport(
  token: string,
  report: RetentionIntelligence,
  nowMs = Date.now()
): Promise<"published" | "lost" | "refused"> {
  if (retentionReportHasPrivateContent(report)) return "refused";
  const { data, error } = await supabaseServer
    .from("retention_report")
    .update({
      report,
      calculated_at: new Date(nowMs).toISOString(),
      schema_version: RETENTION_REPORT_SCHEMA_VERSION,
      state: "idle",
      run_token: null,
      error: null,
    })
    .eq("id", 1)
    .eq("state", "running")
    .eq("run_token", token)
    .select("id");
  if (error) {
    console.warn("[retention-report] publish failed", { code: error.code });
    return "lost";
  }
  return data && data.length > 0 ? "published" : "lost";
}

export async function failRetentionReport(token: string, message: string): Promise<void> {
  const { error } = await supabaseServer
    .from("retention_report")
    .update({
      state: "failed",
      error: retentionReportError(message),
    })
    .eq("id", 1)
    .eq("state", "running")
    .eq("run_token", token);
  if (error) {
    console.warn("[retention-report] fail status was not saved", { code: error.code });
  }
}
