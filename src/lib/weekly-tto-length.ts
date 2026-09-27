/**
 * Authoritative Weekly TTO footer-aware length law.
 * Draft body B excludes the compliance footer; send appends separator + footer.
 * No truncation. No clipping. No rewrite.
 */

import { TWILIO_SMS_BODY_MAX_CHARS } from "@/lib/sms-transport-max";
import { appendPreservedSmsSuffix } from "@/lib/v3-sms-voice-ownership";
import {
  MAX_WEEKLY_EDITABLE_BODY,
  WEEKLY_TTO_COMPLIANCE_FOOTER,
  WEEKLY_TTO_DRAFT_BODY_EXCEEDS_EDITABLE_MAX,
  WEEKLY_TTO_FOOTER_OVERHEAD_CHARS,
  WEEKLY_TTO_FOOTER_SEPARATOR,
  weeklyEditableBodyExceedsMax,
} from "@/lib/weekly-tto-editable-max";

export {
  MAX_WEEKLY_EDITABLE_BODY,
  WEEKLY_TTO_COMPLIANCE_FOOTER,
  WEEKLY_TTO_DRAFT_BODY_EXCEEDS_EDITABLE_MAX,
  WEEKLY_TTO_FOOTER_OVERHEAD_CHARS,
  WEEKLY_TTO_FOOTER_SEPARATOR,
  weeklyEditableBodyExceedsMax,
};

export const WEEKLY_TTO_FINAL_BODY_EXCEEDS_TWILIO_MAX =
  `Weekly final SMS exceeds Twilio transport max (${TWILIO_SMS_BODY_MAX_CHARS} characters)`;

export function buildWeeklyTtoFinalBodyWithFooter(bodyWithoutFooter: string): string {
  return appendPreservedSmsSuffix(bodyWithoutFooter.trim(), WEEKLY_TTO_COMPLIANCE_FOOTER);
}

export function weeklyFinalBodyExceedsTwilioMax(finalBody: string): boolean {
  return finalBody.length > TWILIO_SMS_BODY_MAX_CHARS;
}
