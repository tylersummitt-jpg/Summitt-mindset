/**
 * D2b ownership codes, idempotency, body validation, send retry.
 * semantic_grace is armed by D2a; D2b owns the due wake.
 */

import { INBOUND_MEDIA_D2A_SEMANTIC_GRACE } from "@/lib/victory-media/inbound-mms-d2a-codes";

export const INBOUND_MEDIA_D2B_CLARIFICATION_DUE = "clarification_due" as const;
export const INBOUND_MEDIA_D2B_CLARIFICATION_SEND_FAILED =
  "clarification_send_failed" as const;
export const INBOUND_MEDIA_D2B_CLARIFICATION_MODEL_FAILED =
  "clarification_model_failed" as const;

export const INBOUND_MEDIA_D2B_OWNED_LAST_ERROR_CODES = [
  INBOUND_MEDIA_D2A_SEMANTIC_GRACE,
  INBOUND_MEDIA_D2B_CLARIFICATION_DUE,
  INBOUND_MEDIA_D2B_CLARIFICATION_SEND_FAILED,
  INBOUND_MEDIA_D2B_CLARIFICATION_MODEL_FAILED,
] as const;

export type InboundMediaD2bLastErrorCode =
  (typeof INBOUND_MEDIA_D2B_OWNED_LAST_ERROR_CODES)[number];

export function isInboundMediaD2bOwnedLastErrorCode(
  value: string | null | undefined
): value is InboundMediaD2bLastErrorCode {
  return (
    typeof value === "string" &&
    (INBOUND_MEDIA_D2B_OWNED_LAST_ERROR_CODES as readonly string[]).includes(
      value
    )
  );
}

/** Due D2b wake: post-grace reeval or reserved/retry send. */
export function isInboundMediaD2bWakeLastErrorCode(
  value: string | null | undefined
): boolean {
  return isInboundMediaD2bOwnedLastErrorCode(value);
}

export function inboundMmsD2bClarificationIdempotencyKey(jobId: string): string {
  return `mms-d2-clarify:${jobId.trim()}`;
}

/** One bounded send retry after clarification_send_failed. */
export const INBOUND_MEDIA_D2B_SEND_RETRY_MS = 60 * 1000;
/** One bounded D2b model retry after clarification_model_failed. */
export const INBOUND_MEDIA_D2B_MODEL_RETRY_MS = 60 * 1000;
/** Wait (not expire) when another photo already holds the user's one question. */
export const INBOUND_MEDIA_D2B_ACTIVE_CLARIFICATION_WAIT_MS = 5 * 60 * 1000;

/** Match SMS_CHUNK_MAX_LENGTH without importing the Twilio send module. */
export const INBOUND_MEDIA_D2B_CLARIFICATION_MAX_LENGTH = 280;

const SAVED_CLAIM =
  /\b(i saved|i added|victory room|photo attached|picture attached|already saved|already added)\b/i;
const MENU_OR_TYPE =
  /\b(overall win|current goal|select a category|what type of win|reply with\s*[a-d])\b/i;
const OPTION_LINE = /^[a-d][).:]/im;

export function isValidInboundMmsD2bClarificationBody(
  value: string | null | undefined
): value is string {
  if (typeof value !== "string") return false;
  const t = value.trim();
  if (t.length < 12 || t.length > INBOUND_MEDIA_D2B_CLARIFICATION_MAX_LENGTH) return false;
  if ((t.match(/\?/g) ?? []).length !== 1) return false;
  if (t.includes("\n\n")) return false;
  if (SAVED_CLAIM.test(t)) return false;
  if (MENU_OR_TYPE.test(t)) return false;
  if (OPTION_LINE.test(t)) return false;
  return true;
}
