/**
 * Block-only validators for Weekly Sol writer body A.
 * If blocked: no-send. No rewrite. No clip. No fallback SMS.
 */

import { userVisibleInternalLabelBlockedReasons } from "@/lib/user-visible-internal-label-guard";
import { isRoboticAccountabilityMenuLanguage } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";
import { weeklyEditableBodyExceedsMax } from "@/lib/weekly-tto-length";

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

export type WeeklySolBlockOnlyResult =
  | { ok: true }
  | { ok: false; reason: string };

export function evaluateWeeklySolBlockOnlyBody(body: string): WeeklySolBlockOnlyResult {
  const t = body.trim();
  if (!t) {
    return { ok: false, reason: "empty_body" };
  }

  if (weeklyEditableBodyExceedsMax(t)) {
    return { ok: false, reason: "editable_body_too_long" };
  }

  const labels = userVisibleInternalLabelBlockedReasons(t).filter(
    (reason) => reason !== "internal_label_partial_word"
  );
  if (labels.length > 0) {
    return { ok: false, reason: labels[0] ?? "internal_label" };
  }

  if (UUID_RE.test(t)) {
    return { ok: false, reason: "internal_uuid" };
  }

  if (isRoboticAccountabilityMenuLanguage(t)) {
    return { ok: false, reason: "robotic_accountability_menu" };
  }

  const lower = t.toLowerCase();
  if (/reply\s+stop\s+to\s+opt\s+out/i.test(lower)) {
    return { ok: false, reason: "compliance_footer_in_body" };
  }
  if (/reply\s+help\s+for\s+help/i.test(lower)) {
    return { ok: false, reason: "compliance_footer_in_body" };
  }

  if (/\bevent_type\b/i.test(t) || /\bblocker_captured\b/i.test(t) || /\buser_partial\b/i.test(t)) {
    return { ok: false, reason: "internal_event_token" };
  }

  return { ok: true };
}
