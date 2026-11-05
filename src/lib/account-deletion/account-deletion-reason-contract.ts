/**
 * Browser-safe deletion-reason contract.
 * The delete request stays `{ confirmation: "DELETE" }`.
 * This body is a separate best-effort request and never includes the written answer.
 */

import {
  EXIT_SURVEY_REASONS,
  isExitSurveyReasonCode,
  type ExitSurveyReasonCode,
} from "@/lib/exit-survey";

export const ACCOUNT_DELETION_REASON_POST_PATH = "/api/account/delete-reason" as const;

export const ACCOUNT_DELETION_REASON_DISCLOSURE =
  "Both questions are optional. The reason you select may be included in an anonymous count after your account deletion is complete. Skipping does not affect deleting your account. If the reason does not get recorded, deletion still continues." as const;

/** Objects the website expects. They are not created by the application. */
export const ACCOUNT_DELETION_REASON_SQL_CONTRACT = "2026-11-05-deletion-reason-v1" as const;

export const RECORD_ACCOUNT_DELETION_REASON_RPC = "record_account_deletion_reason" as const;

export const SETTLE_ACCOUNT_DELETION_REASONS_RPC = "settle_account_deletion_reasons" as const;

export const ACCOUNT_DELETION_REASON_REPORT_VIEW = "account_deletion_reason_report" as const;

export const ACCOUNT_DELETION_REASON_SETTLE_LIMIT = 25 as const;

export const DELETION_REASON_CODES = [
  ...EXIT_SURVEY_REASONS.map((reason) => reason.code),
  "skipped",
] as const;

export type DeletionReasonCode = (typeof DELETION_REASON_CODES)[number];

const CODES = new Set<string>(DELETION_REASON_CODES);

export function isDeletionReasonCode(value: unknown): value is DeletionReasonCode {
  return typeof value === "string" && CODES.has(value);
}

export function deletionReasonCodeFromSelection(
  reason: ExitSurveyReasonCode | null
): DeletionReasonCode {
  return reason ?? "skipped";
}

export function buildAccountDeletionReasonRequestBody(reasonCode: DeletionReasonCode): {
  reasonCode: DeletionReasonCode;
} {
  return { reasonCode };
}

/** Exactly `{ reasonCode }`. Extra keys, including a written answer or request id, are rejected. */
export function validateAccountDeletionReasonBody(
  body: unknown
): { ok: true; reasonCode: DeletionReasonCode } | { ok: false } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false };
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "reasonCode") {
    return { ok: false };
  }
  if (!isDeletionReasonCode(record.reasonCode)) {
    return { ok: false };
  }
  if (isExitSurveyReasonCode(record.reasonCode) || record.reasonCode === "skipped") {
    return { ok: true, reasonCode: record.reasonCode };
  }
  return { ok: false };
}

/** Start the reason request and do not wait for it. Failures are ignored. */
export function sendAccountDeletionReason(reason: ExitSurveyReasonCode | null): void {
  const reasonCode = deletionReasonCodeFromSelection(reason);
  try {
    void fetch(ACCOUNT_DELETION_REASON_POST_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify(buildAccountDeletionReasonRequestBody(reasonCode)),
    }).catch(() => undefined);
  } catch {
    // A closed page or a missing fetch must not surface as a deletion error.
  }
}
