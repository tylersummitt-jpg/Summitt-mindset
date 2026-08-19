/**
 * Authoritative Weekly TTO footer-aware length law.
 * Draft body B excludes the compliance footer; send appends separator + footer.
 * No truncation. No clipping. No rewrite.
 */

import { TWILIO_SMS_BODY_MAX_CHARS } from "@/lib/sms-transport-max";
import { appendPreservedSmsSuffix } from "@/lib/v3-sms-voice-ownership";

/** Exact existing Weekly STOP/HELP footer. */
export const WEEKLY_TTO_COMPLIANCE_FOOTER =
  "Reply STOP to opt out. Reply HELP for help.";

export const WEEKLY_TTO_FOOTER_SEPARATOR = "\n\n";

/** Footer 43 + separator 2. Shared Twilio max 1600. */
export const WEEKLY_TTO_FOOTER_OVERHEAD_CHARS =
  WEEKLY_TTO_FOOTER_SEPARATOR.length + WEEKLY_TTO_COMPLIANCE_FOOTER.length;

export const MAX_WEEKLY_EDITABLE_BODY =
  TWILIO_SMS_BODY_MAX_CHARS - WEEKLY_TTO_FOOTER_OVERHEAD_CHARS;

export const WEEKLY_TTO_DRAFT_BODY_EXCEEDS_EDITABLE_MAX =
  `Weekly draft body exceeds footer-aware max (${MAX_WEEKLY_EDITABLE_BODY} characters)`;

export const WEEKLY_TTO_FINAL_BODY_EXCEEDS_TWILIO_MAX =
  `Weekly final SMS exceeds Twilio transport max (${TWILIO_SMS_BODY_MAX_CHARS} characters)`;

export function weeklyEditableBodyExceedsMax(body: string): boolean {
  return body.length > MAX_WEEKLY_EDITABLE_BODY;
}

export function buildWeeklyTtoFinalBodyWithFooter(bodyWithoutFooter: string): string {
  return appendPreservedSmsSuffix(bodyWithoutFooter.trim(), WEEKLY_TTO_COMPLIANCE_FOOTER);
}

export function weeklyFinalBodyExceedsTwilioMax(finalBody: string): boolean {
  return finalBody.length > TWILIO_SMS_BODY_MAX_CHARS;
}
