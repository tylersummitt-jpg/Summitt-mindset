/**
 * Pure deletion-reason report parsing and wording.
 * Null means withheld or unavailable. Zero is only used when the safe breakdown says zero.
 */

import { exitSurveyReasonLabel } from "@/lib/exit-survey";
import { DELETION_REASON_CODES, type DeletionReasonCode } from "./account-deletion-reason-contract";

export type DeletionReasonCount = {
  code: DeletionReasonCode;
  label: string;
  count: number;
};

export type DeletionReasonReport = {
  readable: boolean;
  note: string;
  completed: number | null;
  recorded: number | null;
  missing: number | null;
  breakdownWithheld: boolean;
  reasons: DeletionReasonCount[];
};

const UNAVAILABLE_NOTE =
  "Deletion reason counts could not be read. They are not shown as zero. Account deletion is unchanged.";

const NOT_IN_REPORT_NOTE =
  "Deletion reason counts are not in this saved report. They are not shown as zero.";

const SNAPSHOT_LIMIT =
  "A later saved report can reveal a small count that an earlier report withheld. Written deletion notes are not in this report.";

export function deletionReasonsUnavailable(note = UNAVAILABLE_NOTE): DeletionReasonReport {
  return {
    readable: false,
    note,
    completed: null,
    recorded: null,
    missing: null,
    breakdownWithheld: false,
    reasons: [],
  };
}

export function deletionReasonsNotInReport(): DeletionReasonReport {
  return deletionReasonsUnavailable(NOT_IN_REPORT_NOTE);
}

function wholeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

function reasonLabel(code: DeletionReasonCode): string {
  if (code === "skipped") return "Skipped the reason question";
  return exitSurveyReasonLabel(code);
}

function withheldReport(completed: number): DeletionReasonReport {
  return {
    readable: true,
    note: "Completed account deletions are counted. The reason breakdown is withheld so a count below 5 cannot be calculated. Withheld is not zero.",
    completed,
    recorded: null,
    missing: null,
    breakdownWithheld: true,
    reasons: [],
  };
}

function smallCount(value: number): boolean {
  return value >= 1 && value <= 4;
}

/**
 * Read the privacy view. A count of 1–4 is dropped from the result, even if the view returns it.
 * An empty or partial read stays unavailable and is not turned into zeros.
 */
export function parseDeletionReasonReportRows(data: unknown): DeletionReasonReport {
  if (!Array.isArray(data) || data.length !== DELETION_REASON_CODES.length) {
    return deletionReasonsUnavailable();
  }

  const byCode = new Map<string, Record<string, unknown>>();
  for (const row of data) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return deletionReasonsUnavailable();
    const record = row as Record<string, unknown>;
    if (typeof record.reason_code !== "string") return deletionReasonsUnavailable();
    byCode.set(record.reason_code, record);
  }

  const completedValues: number[] = [];
  const withheldFlags: boolean[] = [];
  const counts: number[] = [];
  for (const code of DELETION_REASON_CODES) {
    const row = byCode.get(code);
    if (!row) return deletionReasonsUnavailable();
    const completed = wholeNumber(row.completed_total);
    if (completed == null || typeof row.breakdown_withheld !== "boolean") {
      return deletionReasonsUnavailable();
    }
    completedValues.push(completed);
    withheldFlags.push(row.breakdown_withheld);
    const count = wholeNumber(row.reason_count);
    counts.push(count ?? -1);
  }

  const completed = completedValues[0];
  if (completed == null || completedValues.some((value) => value !== completed)) {
    return deletionReasonsUnavailable();
  }
  if (withheldFlags.some((flag) => flag !== withheldFlags[0])) {
    return deletionReasonsUnavailable();
  }
  if (withheldFlags[0]) return withheldReport(completed);

  const first = byCode.get(DELETION_REASON_CODES[0]);
  const recorded = wholeNumber(first?.recorded_total);
  const missing = wholeNumber(first?.missing_total);
  if (recorded == null || missing == null) return withheldReport(completed);
  if (recorded + missing !== completed || recorded > completed) return withheldReport(completed);
  if (smallCount(recorded) || smallCount(missing)) return withheldReport(completed);
  if (counts.some((count) => count < 0 || smallCount(count))) return withheldReport(completed);
  if (counts.reduce((sum, count) => sum + count, 0) !== recorded) return withheldReport(completed);

  return {
    readable: true,
    note: "Completed account deletions, recorded reasons, and deletions with no recorded reason.",
    completed,
    recorded,
    missing,
    breakdownWithheld: false,
    reasons: DELETION_REASON_CODES.map((code, index) => ({
      code,
      label: reasonLabel(code),
      count: counts[index] ?? 0,
    })),
  };
}

export function formatDeletionReasonLines(
  report: DeletionReasonReport | null | undefined
): string[] {
  if (!report) {
    return ["DELETION REASONS", NOT_IN_REPORT_NOTE];
  }
  const lines = ["DELETION REASONS", report.note];
  if (!report.readable || report.completed == null) return lines;
  lines.push(`Completed account deletions: ${report.completed}.`);
  if (report.breakdownWithheld || report.recorded == null || report.missing == null) {
    lines.push(
      "The reason breakdown is withheld so a count below 5 cannot be calculated. Withheld is not zero."
    );
    lines.push(SNAPSHOT_LIMIT);
    return lines;
  }
  lines.push(`Recorded reason or skip: ${report.recorded}.`);
  lines.push(`No reason received: ${report.missing}.`);
  lines.push(
    "No reason received includes deletions completed before this count existed and submissions that never arrived. Skipped is a recorded answer. Zero means none."
  );
  for (const reason of report.reasons) {
    lines.push(`${reason.label}: ${reason.count}.`);
  }
  lines.push(SNAPSHOT_LIMIT);
  return lines;
}
