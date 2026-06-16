/**
 * Wave 14.3a — Active Reply Context authorization (deterministic).
 * Bare ambiguous inbound cannot attach to accountability unless unanswered check_sent is fresh OR message is self-contained.
 */

import { isSubstantiveSelfReportedCompletionForProof } from "@/lib/inbound-self-reported-completion";
import type { V2EventRowForAi } from "@/lib/v2-commitment";
import { messageHasKeywordPartialLanguage } from "@/lib/v2-sms-accountability";

const ACCOUNTABILITY_PROMPT_FRESH_MS = 36 * 60 * 60 * 1000;

/** Explicit true/false/unset=OFF for production rollout. */
export function isV2ActiveReplyContextEnabled(): boolean {
  const v = process.env.V2_ACTIVE_REPLY_CONTEXT_ENABLED?.trim().toLowerCase();
  return v === "true" || v === "1";
}

function parseEventMs(iso: string): number {
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

function normalizeInbound(t: string): string {
  return t.trim().replace(/\s+/g, " ");
}

/**
 * Conservative: dominant short confirmations / deferrals without enough substance for spine attach.
 */
export function isAmbiguousShortReplyNeedingContext(text: string): boolean {
  const raw = normalizeInbound(text);
  if (!raw) return false;

  const lower = raw.toLowerCase();

  /** Long explanatory lines are not ambiguous-for-context. */
  if (raw.length > 72) return false;
  const words = raw.split(" ").filter(Boolean);
  if (words.length > 10) return false;

  /** Phrases that imply real substance (still short) — exclude. */
  if (
    /\b(yesterday|because|blocked|kids|meetings|travel|issue|busy|hours?|minutes?|commitment)\b/i.test(
      raw
    ) ||
    /\b(?:as|same)\s+issue\b/i.test(lower) ||
    /:/.test(raw)
  ) {
    return false;
  }

  if (/\b(kinda|kind of|sort of|somewhat|partially|not really)\b/i.test(lower) && raw.length <= 52) return true;

  /** Strong yes-ish (bounded length). */
  if (/^(yes|y|yeah|yep|yup)([!.,\s]|$)/i.test(raw) || /^(sure|absolutely|certainly|definitely)([!.,\s]|$)/i.test(raw)) {
    return raw.length <= 28;
  }

  /** Strong no-ish */
  if (/^(no|n|nope|nah)([!.,\s]|$)/i.test(raw)) return raw.length <= 24;

  /** Neutral / stall */
  if (/^(ok|okay|kk?)([!.,\s]|$)/i.test(raw)) return raw.length <= 14;
  if (/^maybe\b/i.test(lower)) return raw.length <= 20;
  if (/^(later|not yet)\b/i.test(lower)) return raw.length <= 18;
  if (/^tomorrow\b/i.test(lower) && raw.length <= 28) return true;

  /** Completion phrases */
  if (/^done\b/i.test(lower) || /^got it\b/i.test(lower)) return raw.length <= 18;
  if (/^(did it|i did)\b/i.test(lower)) return raw.length <= 18;

  /** Confirmation-flavored fragments */
  if (/\bsounds\s+good\b/i.test(lower) && raw.length <= 28) return true;
  if (/\bcorrect\b/i.test(lower) || /\bthat's right\b/i.test(lower) || /\bthats right\b/i.test(lower)) {
    return raw.length <= 32;
  }
  if (/^change it\b|^make it that\b|^not that\b/i.test(lower)) return raw.length <= 28;

  /** Stability tokens */
  if (/^(same|still)(\s|$|,|\.|!|\?)/i.test(raw) || /^keep\b/i.test(lower)) return raw.length <= 18;

  if (/^half\b/i.test(lower) && raw.length <= 12) return true;

  /** Single ambiguous words */
  if (/^(half|perhaps|somewhat|partially)$/i.test(raw)) return true;

  return false;
}

export type IsSelfContainedAccountabilityAnswerArgs = {
  text: string;
  commitmentTitle?: string | null;
  behaviorStatement?: string | null;
  effectiveAsk?: string | null;
};

/** Conservative first pass: substantive outcome language + grounding, not naked tokens. */
export function isSelfContainedAccountabilityAnswer(args: IsSelfContainedAccountabilityAnswerArgs): boolean {
  const raw = normalizeInbound(args.text);
  if (!raw) return false;
  if (isSubstantiveSelfReportedCompletionForProof(raw)) return true;
  if (raw.length < 22) return false;
  const words = raw.split(" ").filter(Boolean);
  if (words.length < 4) return false;

  /** Reject if still ambiguous-dominant (double-check). */
  if (/^(yes|no|done|half|maybe|sure|same|still|later|tomorrow)(\s|,|\.|!|\?|$)/i.test(raw) && raw.length < 36) {
    return false;
  }

  const lower = raw.toLowerCase();

  const barHints = [
    args.effectiveAsk?.trim().slice(0, 72),
    args.behaviorStatement?.trim().slice(0, 72),
    args.commitmentTitle?.trim().slice(0, 48),
  ].filter((x): x is string => Boolean(x?.length));

  const mentionsBarSlice = barHints.some((h) => {
    const hLower = h.toLowerCase().replace(/\s+/g, " ");
    if (hLower.length < 6) return false;
    /** Require a substantive chunk of phrase to avoid brittle token matches. */
    const chunk = hLower.slice(0, Math.min(32, hLower.length));
    return chunk.length >= 6 && lower.includes(chunk);
  });

  /** Clear outcome predicates + grounding. */
  const hasConcreteOutcomePhrase =
    /\b(i\s+did\b|i\s+didn't|i\s+did\s+not|didn't\b|haven't\b|haven't\s+had|spent\s+\d+)/i.test(raw) ||
    /\b(?:yes|no),/i.test(raw) ||
    (/\bfull\s+(hour|bar|standard)\b/i.test(lower) || /\bnot\s+the\s+full\b/i.test(lower));

  const hasPartialSentence =
    messageHasKeywordPartialLanguage(raw) &&
    (/\bdid\b/i.test(lower) || /\bgot\b/i.test(lower) || /\bkitchen\b|\bminutes\b|\bhours\b|\bworkout\b/i.test(lower));

  const hasTodayAnchor = /\b(today|this morning|this evening)\b/i.test(lower);

  if (hasConcreteOutcomePhrase && (mentionsBarSlice || hasTodayAnchor || hasPartialSentence || raw.length >= 36))
    return true;

  if (hasPartialSentence && (mentionsBarSlice || raw.length >= 40)) return true;

  return false;
}

export type BuildV2ActiveReplyContextArgs = {
  inboundText: string;
  eventsNewestFirst: V2EventRowForAi[];
  commitmentTitle: string | null;
  behaviorStatement: string;
  effectiveAsk: string;
  nowMs?: number;
};

export type V2ActiveReplyContext = {
  ambiguous_short_reply: boolean;
  self_contained_accountability_answer: boolean;
  has_live_accountability_prompt: boolean;
  live_accountability_prompt_reason: string | null;
  accountability_prompt_sent_at: string | null;
  accountability_prompt_age_minutes: number | null;
  latest_outcome_at: string | null;
  should_allow_bare_accountability_score: boolean;
  should_force_clarification_for_ambiguous_short_reply: boolean;
  clarification_reason: string | null;
};

export function buildV2ActiveReplyContext(args: BuildV2ActiveReplyContextArgs): V2ActiveReplyContext {
  const nowMs = args.nowMs ?? Date.now();

  let latestCheckAt: string | null = null;
  let latestCheckMs = 0;
  let latestOutcomeAt: string | null = null;
  let latestOutcomeMs = 0;

  for (const e of args.eventsNewestFirst) {
    if (e.event_type === "check_sent" && !latestCheckAt) {
      latestCheckAt = e.occurred_at;
      latestCheckMs = parseEventMs(e.occurred_at);
      continue;
    }
    if (
      (e.event_type === "user_yes" || e.event_type === "user_no" || e.event_type === "user_partial") &&
      !latestOutcomeAt
    ) {
      latestOutcomeAt = e.occurred_at;
      latestOutcomeMs = parseEventMs(e.occurred_at);
    }
    if (latestCheckAt && latestOutcomeAt) break;
  }

  const has_live_accountability_prompt =
    Boolean(latestCheckAt && latestCheckMs > 0) &&
    (!latestOutcomeAt || latestOutcomeMs <= 0 || latestCheckMs > latestOutcomeMs);

  let live_accountability_prompt_reason: string | null = null;
  if (has_live_accountability_prompt && latestCheckAt) {
    live_accountability_prompt_reason = !latestOutcomeAt
      ? "check_sent_without_prior_outcome"
      : "check_sent_after_latest_user_outcome";
  }

  let accountability_prompt_age_minutes: number | null = null;
  if (latestCheckAt && latestCheckMs > 0) {
    accountability_prompt_age_minutes = Math.max(0, Math.floor((nowMs - latestCheckMs) / 60000));
  }

  const ambiguous_short_reply = isAmbiguousShortReplyNeedingContext(args.inboundText);
  const self_contained_accountability_answer = isSelfContainedAccountabilityAnswer({
    text: args.inboundText,
    commitmentTitle: args.commitmentTitle,
    behaviorStatement: args.behaviorStatement,
    effectiveAsk: args.effectiveAsk,
  });

  const promptFreshEnough =
    has_live_accountability_prompt &&
    latestCheckMs > 0 &&
    nowMs - latestCheckMs <= ACCOUNTABILITY_PROMPT_FRESH_MS;

  const hasFreshLivePrompt =
    has_live_accountability_prompt && promptFreshEnough && latestCheckMs > 0;

  const should_allow_bare_accountability_score =
    !ambiguous_short_reply || Boolean(hasFreshLivePrompt) || self_contained_accountability_answer;

  const should_force_clarification_for_ambiguous_short_reply =
    ambiguous_short_reply && !hasFreshLivePrompt && !self_contained_accountability_answer;

  let clarification_reason: string | null = null;
  if (should_force_clarification_for_ambiguous_short_reply) {
    if (!latestCheckAt) clarification_reason = "ambiguous_short_no_check_sent_recent";
    else if (!has_live_accountability_prompt) clarification_reason = "ambiguous_short_latest_check_already_answered";
    else if (!promptFreshEnough) clarification_reason = "ambiguous_short_stale_prompt";
    else clarification_reason = "ambiguous_short_no_authorization";
  }

  return {
    ambiguous_short_reply,
    self_contained_accountability_answer,
    has_live_accountability_prompt,
    live_accountability_prompt_reason,
    accountability_prompt_sent_at: latestCheckAt,
    accountability_prompt_age_minutes,
    latest_outcome_at: latestOutcomeAt,
    should_allow_bare_accountability_score,
    should_force_clarification_for_ambiguous_short_reply,
    clarification_reason,
  };
}

export type ActiveReplyContextClarificationSmsArgs = {
  inboundText: string;
  tentativeOutcomeType: "user_yes" | "user_no" | "user_partial";
};

/** Deterministic clarifications — no salutation duplication, compliance-safe. */
export function buildActiveReplyContextClarificationSms(args: ActiveReplyContextClarificationSmsArgs): string {
  const t = normalizeInbound(args.inboundText).toLowerCase();

  const sameIsh = /\b(same|still)\b|^keep\b/i.test(t);
  const doneIsh = /\bdone\b|^got it\b|^did it\b|^i did\b/i.test(t);
  const tentative = args.tentativeOutcomeType;

  if (sameIsh) {
    return "Quick check — same in what sense: the bar still fits, or the same blocker showed up?";
  }
  if (doneIsh) {
    return "Good — just so I count it right, are you saying today's commitment is done?";
  }
  if (tentative === "user_no") {
    return "Quick check — are you saying no: today's commitment didn't happen?";
  }
  if (tentative === "user_partial") {
    return "Quick check — are you saying today was partial on the commitment, not fully done or fully missed?";
  }
  if (tentative === "user_yes" || /\b(yes|yep|yeah|yup|sure)\b/i.test(t)) {
    return "Quick check — are you saying yes: you did today's commitment?";
  }

  return "I may be missing the context. Are you answering today's commitment check-in?";
}
