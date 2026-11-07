import { mobileFactsNotInReport } from "@/lib/mobile-measurement";
import { achievementNotInReport } from "@/lib/retention-behavior-retention";
import { churnSurveyNotCalculated } from "@/lib/churn-survey-facts";
import { deletionReasonsNotInReport } from "@/lib/account-deletion/deletion-reason-facts";
import { youreInVideoNotInReport } from "@/lib/youre-in-video";
import {
  RETENTION_NOT_LOADED,
  unreadableRetentionIntelligence,
  type RetentionIntelligence,
} from "@/lib/retention-intelligence";

export const RETENTION_REPORT_SCHEMA_VERSION = 1;
/** A running claim older than this can be taken by the next click. */
export const RETENTION_REPORT_CLAIM_STALE_MS = 360_000;
/** Stop unread work before the 300 second function limit. */
export const RETENTION_REPORT_TIME_BUDGET_MS = 240_000;

/** PostgREST `or()` values with `:` or `.` must be double-quoted. */
function quotePostgrestFilterValue(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/** The conditional claim predicate. One update, owned by this exact filter. */
export function retentionReportClaimOrFilter(nowMs: number): string {
  const cutoff = new Date(nowMs - RETENTION_REPORT_CLAIM_STALE_MS)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  return `state.neq.running,started_at.is.null,started_at.lt.${quotePostgrestFilterValue(cutoff)}`;
}

const PRIVATE_KEYS = new Set([
  "raw_body",
  "answer_text",
  "question",
  "reflection",
  "message",
  "comment",
  "request_id",
]);

export function claimIsStale(startedAtIso: string | null, nowMs: number): boolean {
  if (!startedAtIso) return true;
  const started = Date.parse(startedAtIso);
  if (!Number.isFinite(started)) return true;
  return nowMs - started >= RETENTION_REPORT_CLAIM_STALE_MS;
}

export function claimIsAvailable(
  row: { state: string | null; started_at: string | null },
  nowMs: number
): boolean {
  if (row.state !== "running") return true;
  return claimIsStale(row.started_at, nowMs);
}

export function publishOwnsRun(
  row: { state: string | null; run_token: string | null },
  token: string
): boolean {
  return row.state === "running" && row.run_token === token;
}

export function canPublishRetentionReport(intel: RetentionIntelligence): boolean {
  return intel.status === "ready" && intel.withheld == null;
}

export function retentionReportHasPrivateContent(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => retentionReportHasPrivateContent(item));
  return Object.entries(value).some(
    ([key, child]) => PRIVATE_KEYS.has(key) || retentionReportHasPrivateContent(child)
  );
}

export function retentionReportError(message: string): string {
  const trimmed = message.replace(/\s+/g, " ").trim();
  return trimmed.slice(0, 240);
}

export function formatRetentionCohortTime(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ms));
}

export type RetentionReportRow = {
  report: unknown;
  calculated_at: string | null;
  schema_version: number | null;
  state: string | null;
  started_at: string | null;
  error: string | null;
};

export function interpretRetentionReportRead(args: {
  error: { code?: string; message?: string } | null;
  row: RetentionReportRow | null;
  nowMs: number;
}): {
  intelligence: RetentionIntelligence;
  cohortCalculatedAt: string | null;
  generationNote: string | null;
} {
  if (args.error) {
    return {
      intelligence: unreadableRetentionIntelligence(
        "The saved retention report could not be read. Do not treat that as zero."
      ),
      cohortCalculatedAt: null,
      generationNote: null,
    };
  }
  if (!args.row) {
    return {
      intelligence: RETENTION_NOT_LOADED,
      cohortCalculatedAt: null,
      generationNote: null,
    };
  }

  const note = generationNote(args.row, args.nowMs);
  if (args.row.schema_version !== RETENTION_REPORT_SCHEMA_VERSION) {
    return {
      intelligence: unreadableRetentionIntelligence(
        "This deployment cannot read the saved retention report. Do not treat that as zero."
      ),
      cohortCalculatedAt: null,
      generationNote: note,
    };
  }

  const stored = isStoredReport(args.row.report) ? args.row.report : null;
  if (args.row.report != null && !stored) {
    return {
      intelligence: unreadableRetentionIntelligence(
        "This deployment cannot read the saved retention report. Do not treat that as zero."
      ),
      cohortCalculatedAt: null,
      generationNote: note,
    };
  }

  return {
    intelligence: stored ? withStoredSections(stored) : RETENTION_NOT_LOADED,
    cohortCalculatedAt: stored ? formatRetentionCohortTime(args.row.calculated_at) : null,
    generationNote: note,
  };
}

function withStoredSections(intel: RetentionIntelligence): RetentionIntelligence {
  const monthlyAchievement = intel.monthlyAchievement ?? achievementNotInReport("Monthly");
  const annualAchievement = intel.annualAchievement ?? achievementNotInReport("Annual");
  const monthlyMobile = intel.monthlyMobile ?? mobileFactsNotInReport("Monthly");
  const annualMobile = intel.annualMobile ?? mobileFactsNotInReport("Annual");
  const churnSurvey =
    intel.churnSurvey ??
    churnSurveyNotCalculated(
      "Cancellation survey counts are not in this saved report. They are not shown as zero."
    );
  const deletionReasons = intel.deletionReasons ?? deletionReasonsNotInReport();
  const youreInVideo = intel.youreInVideo ?? youreInVideoNotInReport();
  if (
    monthlyAchievement === intel.monthlyAchievement &&
    annualAchievement === intel.annualAchievement &&
    monthlyMobile === intel.monthlyMobile &&
    annualMobile === intel.annualMobile &&
    intel.churnSurvey &&
    intel.deletionReasons &&
    intel.youreInVideo
  ) {
    return intel;
  }
  return {
    ...intel,
    monthlyAchievement,
    annualAchievement,
    monthlyMobile,
    annualMobile,
    churnSurvey,
    deletionReasons,
    youreInVideo,
  };
}

function generationNote(row: RetentionReportRow, nowMs: number): string | null {
  const hasReport =
    row.schema_version === RETENTION_REPORT_SCHEMA_VERSION && isStoredReport(row.report);
  if (row.state === "running" && !claimIsStale(row.started_at, nowMs)) {
    return hasReport
      ? "Generation is in progress. The report below is the last one saved."
      : "Generation is in progress. No retention report has been saved yet.";
  }
  if (row.state === "running") {
    return "The last generation did not finish. The saved report was not replaced.";
  }
  if (row.state === "failed") {
    const detail = row.error?.trim();
    return detail
      ? `The last generation failed and did not replace this report. ${detail}`
      : "The last generation failed and did not replace this report.";
  }
  return null;
}

function isStoredReport(value: unknown): value is RetentionIntelligence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as { status?: unknown; withheld?: unknown; milestones?: unknown; annual?: unknown };
  if (row.status !== "ready" && row.status !== "unreadable" && row.status !== "not_loaded") return false;
  if (row.status === "ready" && (row.withheld == null || row.withheld === "")) {
    return Array.isArray(row.milestones) && !!row.annual && typeof row.annual === "object";
  }
  return true;
}
