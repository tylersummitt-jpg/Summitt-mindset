/**
 * Client-safe Weekly editable-body max.
 * Draft body excludes the compliance footer. Send appends separator + footer elsewhere.
 */

import { TWILIO_SMS_BODY_MAX_CHARS } from "@/lib/sms-transport-max";

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

export function weeklyEditableBodyExceedsMax(body: string): boolean {
  return body.length > MAX_WEEKLY_EDITABLE_BODY;
}
