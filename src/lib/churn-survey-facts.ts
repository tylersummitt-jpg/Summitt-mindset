/**
 * Aggregate cancellation feedback into counts.
 * Callers must not pass comment text into this function.
 */

import {
  EXIT_SURVEY_REASONS,
  LEGACY_CANCEL_REASON_LABELS,
  type ExitSurveyReasonCode,
  isExitSurveyReasonCode,
} from "@/lib/exit-survey";

export type CancellationFeedbackFact = {
  moment: string | null;
  reasonCode: string | null;
  messagePresent: boolean;
  surveyVersion: number | null;
  skippedReason: boolean;
  skippedComment: boolean;
  confirmedStripeCancel: boolean;
  source: string | null;
  createdAt: string | null;
};

export type ChurnReasonRow = {
  code: string;
  label: string;
  count: number;
  share: string;
};

export type ChurnSurveyFacts = {
  readable: boolean;
  note: string;
  earliest: string | null;
  latest: string | null;
  legacyRows: number | null;
  version2Rows: number | null;
  legacy: ChurnReasonRow[];
  version2: ChurnReasonRow[];
  legacyWritten: number | null;
  version2Written: number | null;
  version2SkippedReason: number | null;
  version2SkippedComment: number | null;
  version2PreferNotToSay: number | null;
  pauseRows: number | null;
  confirmedStripeCancels: number | null;
  attemptRowsNotProven: number | null;
  sources: string[];
  appleRenewalOffStillActive: number | null;
  appleExpiredStatus: number | null;
  appleExpiredNotifications: number | null;
  completedDeletions: number | null;
  openDeletionRequests: number | null;
};

export function churnSurveyNotCalculated(note: string): ChurnSurveyFacts {
  return {
    readable: false,
    note,
    earliest: null,
    latest: null,
    legacyRows: null,
    version2Rows: null,
    legacy: [],
    version2: [],
    legacyWritten: null,
    version2Written: null,
    version2SkippedReason: null,
    version2SkippedComment: null,
    version2PreferNotToSay: null,
    pauseRows: null,
    confirmedStripeCancels: null,
    attemptRowsNotProven: null,
    sources: [],
    appleRenewalOffStillActive: null,
    appleExpiredStatus: null,
    appleExpiredNotifications: null,
    completedDeletions: null,
    openDeletionRequests: null,
  };
}

export function surveyVersionFromMetadata(metadata: unknown): number | null {
  if (metadata == null || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const version = (metadata as Record<string, unknown>).survey_version;
  return version === 2 ? 2 : null;
}

export function metadataFlag(metadata: unknown, key: string): boolean {
  if (metadata == null || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return (metadata as Record<string, unknown>)[key] === true;
}

function shareText(count: number, denominator: number): string {
  if (denominator <= 0) return "Not available";
  return `${Math.round((100 * count) / denominator)}% (${count} of ${denominator})`;
}

function dayKey(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function pushCount(
  map: Map<string, { label: string; count: number }>,
  code: string,
  label: string
) {
  const current = map.get(code);
  if (current) current.count += 1;
  else map.set(code, { label, count: 1 });
}

function rowsFromMap(
  map: Map<string, { label: string; count: number }>,
  denominator: number
): ChurnReasonRow[] {
  return [...map.entries()]
    .map(([code, row]) => ({
      code,
      label: row.label,
      count: row.count,
      share: shareText(row.count, denominator),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function buildChurnSurveyFacts(args: {
  feedbackReadable: boolean;
  feedbackNote: string | null;
  rows: CancellationFeedbackFact[];
  appleRenewalOffStillActive: number | null;
  appleExpiredStatus: number | null;
  appleExpiredNotifications: number | null;
  completedDeletions: number | null;
  openDeletionRequests: number | null;
}): ChurnSurveyFacts {
  const base = churnSurveyNotCalculated(
    args.feedbackNote ??
      "Cancellation survey counts could not be read. That is not zero."
  );
  base.appleRenewalOffStillActive = args.appleRenewalOffStillActive;
  base.appleExpiredStatus = args.appleExpiredStatus;
  base.appleExpiredNotifications = args.appleExpiredNotifications;
  base.completedDeletions = args.completedDeletions;
  base.openDeletionRequests = args.openDeletionRequests;
  if (!args.feedbackReadable) return base;

  const legacy = new Map<string, { label: string; count: number }>();
  const version2 = new Map<string, { label: string; count: number }>();
  const sources = new Set<string>();
  let legacyRows = 0;
  let version2Rows = 0;
  let legacyWritten = 0;
  let version2Written = 0;
  let version2SkippedReason = 0;
  let version2SkippedComment = 0;
  let version2PreferNotToSay = 0;
  let pauseRows = 0;
  let confirmedStripeCancels = 0;
  let attemptRowsNotProven = 0;
  let earliest: string | null = null;
  let latest: string | null = null;

  for (const row of args.rows) {
    const day = dayKey(row.createdAt);
    if (day && (!earliest || day < earliest)) earliest = day;
    if (day && (!latest || day > latest)) latest = day;
    if (row.source) sources.add(row.source);

    if (row.moment === "pause_offer_accepted") {
      pauseRows += 1;
      continue;
    }
    if (row.moment !== "cancel_attempt") continue;

    if (row.surveyVersion === 2 && row.confirmedStripeCancel) {
      version2Rows += 1;
      confirmedStripeCancels += 1;
      if (row.messagePresent) version2Written += 1;
      if (row.skippedReason) version2SkippedReason += 1;
      if (row.skippedComment) version2SkippedComment += 1;
      if (row.reasonCode === "prefer_not_to_say") version2PreferNotToSay += 1;
      const code = isExitSurveyReasonCode(row.reasonCode) ? row.reasonCode : "skipped";
      const label =
        code === "skipped"
          ? "Skipped the reason question"
          : EXIT_SURVEY_REASONS.find((reason) => reason.code === code)?.label ??
            "Skipped the reason question";
      pushCount(version2, code, label);
      continue;
    }

    legacyRows += 1;
    attemptRowsNotProven += 1;
    if (row.messagePresent) legacyWritten += 1;
    const code = row.reasonCode ?? "unknown";
    const label =
      code === "unknown"
        ? "No reason stored"
        : LEGACY_CANCEL_REASON_LABELS[code] ?? `Unrecognized older code (${code})`;
    pushCount(legacy, code, label);
  }

  return {
    readable: true,
    note: "Version 2 rows are written only after Stripe accepts the cancellation. Older cancel_attempt rows were written before Stripe was called, so they are attempts, not proof the subscription ended. Pause rows are not cancellations. Apple renewal-off is not expiration. Opening Apple's subscription page is not counted here. These counts are not split into monthly and annual.",
    earliest,
    latest,
    legacyRows,
    version2Rows,
    legacy: rowsFromMap(legacy, legacyRows),
    version2: rowsFromMap(version2, version2Rows),
    legacyWritten,
    version2Written,
    version2SkippedReason,
    version2SkippedComment,
    version2PreferNotToSay,
    pauseRows,
    confirmedStripeCancels,
    attemptRowsNotProven,
    sources: [...sources].sort(),
    appleRenewalOffStillActive: args.appleRenewalOffStillActive,
    appleExpiredStatus: args.appleExpiredStatus,
    appleExpiredNotifications: args.appleExpiredNotifications,
    completedDeletions: args.completedDeletions,
    openDeletionRequests: args.openDeletionRequests,
  };
}

export function splitWrittenFeedbackCounts(
  totalWithMessage: number | null,
  version2WithMessage: number | null
): { legacyWritten: number | null; version2Written: number | null } {
  if (
    totalWithMessage == null ||
    version2WithMessage == null ||
    totalWithMessage < 0 ||
    version2WithMessage < 0
  ) {
    return { legacyWritten: null, version2Written: null };
  }
  return {
    version2Written: version2WithMessage,
    legacyWritten: Math.max(0, totalWithMessage - version2WithMessage),
  };
}

export function countText(value: number | null): string {
  return value == null ? "Not available" : String(value);
}

export function formatChurnSurveyLines(facts: ChurnSurveyFacts | null | undefined): string[] {
  if (!facts) {
    return [
      "CHURN INTELLIGENCE",
      "Cancellation survey counts are not in this saved report. They are not shown as zero.",
    ];
  }
  const lines = ["CHURN INTELLIGENCE", facts.note];
  if (!facts.readable) {
    lines.push(
      `Apple renewal still active with auto-renew off: ${countText(facts.appleRenewalOffStillActive)}. Apple rows with expired status: ${countText(facts.appleExpiredStatus)}. Apple EXPIRED notifications stored: ${countText(facts.appleExpiredNotifications)}. These are not survey answers.`
    );
    lines.push(
      `Completed account deletions: ${countText(facts.completedDeletions)}. Deletion requests that are not completed: ${countText(facts.openDeletionRequests)}. Anonymous deletion-reason counts are in the deletion-reason section when that read succeeds. Written deletion notes are not in this report.`
    );
    return lines;
  }
  const range =
    facts.earliest && facts.latest
      ? `Dates of these feedback rows, UTC: ${facts.earliest} through ${facts.latest}.`
      : "No dated cancellation or pause feedback rows were in this read.";
  lines.push(range);
  lines.push(
    `Sources in this read: ${facts.sources.length > 0 ? facts.sources.join(", ") : "None"}.`
  );
  lines.push(
    `Older cancellation attempts: ${countText(facts.legacyRows)}. Written comments present: ${countText(facts.legacyWritten)}. These attempts are not proven Stripe cancellations.`
  );
  if (facts.legacy.length === 0) lines.push("No older cancellation reasons in this read.");
  for (const row of facts.legacy) {
    lines.push(`Older reason — ${row.label}: ${row.share}.`);
  }
  lines.push(
    `Version 2 confirmed Stripe cancellations: ${countText(facts.version2Rows)}. Written comments present: ${countText(facts.version2Written)}. Reason skipped: ${countText(facts.version2SkippedReason)}. Comment skipped or left blank: ${countText(facts.version2SkippedComment)}. Prefer not to say: ${countText(facts.version2PreferNotToSay)}.`
  );
  if (facts.version2.length === 0) lines.push("No version 2 cancellation reasons in this read.");
  for (const row of facts.version2) {
    lines.push(`Version 2 reason — ${row.label}: ${row.share}.`);
  }
  lines.push(
    `Pause selections: ${countText(facts.pauseRows)}. A pause is not a cancellation.`
  );
  lines.push(
    `Stripe cancellations confirmed by this app before the feedback row was written: ${countText(facts.confirmedStripeCancels)}. Older attempts not proven by that marker: ${countText(facts.attemptRowsNotProven)}.`
  );
  lines.push(
    `Apple memberships still in their paid period with auto-renew off: ${countText(facts.appleRenewalOffStillActive)}. Apple rows stored as expired: ${countText(facts.appleExpiredStatus)}. Apple EXPIRED notifications stored: ${countText(facts.appleExpiredNotifications)}. No survey reason is attached to these. They are not added to the reason counts above.`
  );
  lines.push(
    `Completed account deletions: ${countText(facts.completedDeletions)}. Deletion requests that are not completed: ${countText(facts.openDeletionRequests)}. Anonymous deletion-reason counts are in the deletion-reason section when that read succeeds. Written deletion notes are not in this report. People who opened deletion and stopped are not counted as completed deletions.`
  );
  lines.push(
    "Members who canceled outside this website are not marked as having skipped the survey. Payment failures stay in the Stripe ending-reason line above and are not repeated as survey answers. Engagement before cancellation is not matched to these reasons because a feedback row has no subscription id."
  );
  return lines;
}

export type Version2Reason = ExitSurveyReasonCode;
