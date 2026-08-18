/**
 * Block-only validators for inbound Sol body A.
 * If blocked: no-send. No rewrite. No fallback SMS.
 */

import { userVisibleInternalLabelBlockedReasons } from "@/lib/user-visible-internal-label-guard";
import { isRoboticAccountabilityMenuLanguage } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function claimsVictorySavedOrLogged(body: string): boolean {
  const t = body.toLowerCase();
  return /\bvictory\s*room\b/.test(t) && /\b(saved|logged)\b/.test(t);
}

export type InboundSolBlockOnlyResult =
  | { ok: true }
  | { ok: false; reason: string };

export function evaluateInboundSolBlockOnlyReply(args: {
  body: string;
  persistedUserYes: boolean;
}): InboundSolBlockOnlyResult {
  const body = args.body.trim();
  if (!body) {
    return { ok: false, reason: "empty_body" };
  }

  const labels = userVisibleInternalLabelBlockedReasons(body);
  if (labels.length > 0) {
    return { ok: false, reason: labels[0] ?? "internal_label" };
  }

  if (UUID_RE.test(body)) {
    return { ok: false, reason: "internal_uuid" };
  }

  if (isRoboticAccountabilityMenuLanguage(body)) {
    return { ok: false, reason: "robotic_accountability_menu" };
  }

  if (!args.persistedUserYes && claimsVictorySavedOrLogged(body)) {
    return { ok: false, reason: "victory_saved_logged_without_persist" };
  }

  return { ok: true };
}
