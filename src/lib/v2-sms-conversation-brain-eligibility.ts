/**
 * Pure eligibility helpers for SMS Conversation Brain control routing (unit-testable).
 */

import type { V2EventRowForAi } from "@/lib/v2-commitment";

export type ConversationBrainNormalInboundGate = {
  controlEnabled: boolean;
  allowlisted: boolean;
  pendingResolutionActive: boolean;
  contractOverlayActive: boolean;
  optOutOrComplianceTurn: boolean;
  /** Deterministic: obvious commitment replace/tighten/switch language — skip brain; use legacy Wave 4 / gated path. */
  commitmentChangeIntentLikely: boolean;
};

export function shouldUseSmsConversationBrainControl(args: ConversationBrainNormalInboundGate): boolean {
  if (!args.controlEnabled) return false;
  if (!args.allowlisted) return false;
  if (args.pendingResolutionActive) return false;
  if (args.contractOverlayActive) return false;
  if (args.optOutOrComplianceTurn) return false;
  if (args.commitmentChangeIntentLikely) return false;
  return true;
}

/**
 * Brain gate only: exact carrier-style tokens plus obvious opt-out / SMS-help phrases.
 * Does not affect Twilio webhook STOP/HELP handling.
 */
export function isLikelySmsComplianceOrOptOutTurn(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;

  if (/^(STOP|UNSUBSCRIBE|CANCEL|QUIT|END|START|HELP|INFO)$/i.test(t)) return true;

  const lower = t.toLowerCase();

  if (/\b(stop|please stop)\s+texting(\s+me)?\b/i.test(t)) return true;
  if (/\bdon'?t\s+text\s+me\b/i.test(t)) return true;
  if (/\b(text|texts)\s+me\s+(any\s+)?more\b/i.test(t)) return true;
  if (/\bno\s+more\s+texts?\b/i.test(t)) return true;
  if (/\bunsubscribe(\s+me)?\b/i.test(t)) return true;
  if (/\bremove\s+me\b/i.test(t)) return true;
  if (/\bcancel\s+texts?\b/i.test(t)) return true;
  if (/\bhow\s+(do|can)\s+i\s+stop\s+(these\s+)?texts?\b/i.test(t)) return true;
  if (/\bhelp\s+with\s+sms\b/i.test(t)) return true;
  if (/\bi\s+need\s+help\s+with\s+sms\b/i.test(t)) return true;

  return false;
}

/**
 * Conservative: obvious requests to change/replace/tighten/switch/rethink the commitment or goal.
 * Normal miss/partial/hard-day venting should stay false.
 */
export function isLikelyCommitmentChangeIntentTurn(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;

  if (
    /\b(i\s+)?(want|need)\s+to\s+change\s+(my\s+)?(the\s+)?(commitment|goal)\b/i.test(t) ||
    /\bchange\s+(my\s+)?(the\s+)?(commitment|goal)\b/i.test(t)
  ) {
    return true;
  }

  if (/\b(i\s+)?need\s+(to\s+)?change\s+(my\s+)?goal\b/i.test(t)) return true;
  if (/\bcan\s+we\s+switch\s+(my\s+)?(the\s+)?(commitment|from)\b/i.test(t)) return true;
  if (/\bswitch\s+from\b/i.test(t)) return true;
  if (/\b(replace|tighten)\s+(this\s+)?(commitment|goal)\b/i.test(t)) return true;
  if (/\bcan\s+we\s+(replace|tighten)\s+this\s+commitment\b/i.test(t)) return true;

  if (/\b(commitment|goal)\s+isn'?t\s+(right|working)\s*(anymore)?\b/i.test(t)) return true;
  if (/\bthis\s+commitment\s+isn'?t\s+right\b/i.test(t)) return true;

  if (/\b(i\s+)?(want|need|get)\s+a\s+new\s+(goal|commitment)\b/i.test(t)) return true;

  if (/\b(i\s+)?m\s+done\s+with\s+(this\s+)?(goal|commitment)\b/i.test(t)) return true;
  if (/\bdone\s+with\s+this\s+(goal|commitment)\b/i.test(t)) return true;

  if (/\b(wrong|picked\s+the\s+wrong)\s+(commitment|goal)\b/i.test(t)) return true;

  if (/\b(i\s+)?need\s+to\s+make\s+(this\s+)?(easier|smaller)\b/i.test(t)) return true;
  if (/\bmake\s+(this\s+)?(easier|smaller)\b/i.test(t)) return true;

  if (/\b(this\s+)?bar\s+is\s+too\s+much\b/i.test(t)) return true;
  if (/\badjust\s+(the\s+)?bar\b/i.test(t)) return true;

  if (/\brethink(ing)?\s+(my\s+)?(commitment|goal)\b/i.test(t)) return true;
  if (/\b(end|ending)\s+(this\s+)?(commitment|goal)\b/i.test(t)) return true;

  return false;
}

export function countRecentClarifyStyleHeuristic(eventsNewestFirst: V2EventRowForAi[]): number {
  let n = 0;
  for (const e of eventsNewestFirst.slice(0, 20)) {
    const p = e.payload_json;
    if (!p || typeof p !== "object") continue;
    const rr = (p as Record<string, unknown>).reply_resolution as Record<string, unknown> | undefined;
    const gm = typeof rr?.gated_mode === "string" ? rr.gated_mode : null;
    const ai = (p as Record<string, unknown>).ai as Record<string, unknown> | undefined;
    const aiGm = ai && typeof ai.gated_mode === "string" ? ai.gated_mode : null;
    if (gm === "clarify" || aiGm === "clarify") n += 1;
  }
  return n;
}
