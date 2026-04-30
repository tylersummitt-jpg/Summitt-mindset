/**
 * Wave 4: SMS-native commitment change / tighten / replace — first pass.
 * Conservative on DB mutation; uses pending_resolution_* when safe.
 */

import { isRefreshSessionActive } from "@/lib/v2-refresh-session";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { getActiveCommitment } from "@/lib/v2-commitment";
import type { V2InboundShadowInterpretationResult } from "@/lib/v2-ai-inbound";
import {
  clearPendingResolutionIfExpired,
  getPendingResolutionOrNull,
  setPendingResolution,
  type V2PendingResolutionKind,
  type V2SmsPendingResolutionPayload,
} from "@/lib/v2-guided-resolution";

/** Server-owned SMS commitment-change intent (prompt/logging only; not shown to user). */
export type V2SmsCommitmentServerIntent =
  | "sms_tighten_request"
  | "sms_replace_request"
  | "sms_change_unspecified"
  | "sms_soft_quit_or_frustration";

export type V2SmsCommitmentIntentPack = {
  intent: V2SmsCommitmentServerIntent;
  candidateTightenedBar: string | null;
  candidateNewBar: string | null;
  aiConfidence: number | null;
};

const DURATION_BAR_RE = /\b(\d{1,3})\s*(minutes?|mins?|hours?|hrs?|seconds?|secs?)\b/i;

export type V2DurationAnchorExtraction =
  | { phrase: string; mode: "bare" | "widened" }
  | { phrase: null; mode: "none" | "deferred" };

function pickDurationPhraseStart(full: string, durIndex: number): number {
  const before = full.slice(0, durIndex).trimEnd();
  if (!before) return durIndex;
  if (
    /^(walk|read|run|write|pray|call|go|do|lift|study|meditat|stretch|journal)\b/i.test(full.trim())
  ) {
    return 0;
  }
  if (
    /\b(let'?s|let\s+us|make\s+it|change\s+it(\s+to)?|switch\s+to|want\s+(it\s*)?to|need\s+to|try|gonna)\b/i.test(
      before
    )
  ) {
    return 0;
  }
  if (/\b(read|study|pray)\s+my\s+/i.test(before)) return 0;
  if (/\b(my|the|our|a)\s+\w+\s+for\s*$/i.test(before)) return 0;
  if (before.length > 40) return durIndex;
  return durIndex;
}

function extendDurationPhraseEnd(full: string, durEnd: number): number {
  const after = full.slice(durEnd);
  if (!after.trim()) return durEnd;
  const punct = after.search(/[.;!?](?=\s|$)/);
  const window = punct === -1 ? after : after.slice(0, punct);
  const words = window.match(/^\s*((?:[\w']+\s+){0,14}[\w']+)/);
  if (!words?.[1]) return durEnd;
  return durEnd + words[0].length;
}

/**
 * Wave 15.1 — duration-based bar candidate: keep action/context (e.g. "1 hour per day on distribution",
 * "walk 20 minutes after lunch") instead of bare "1 hour" / "20 minutes" when more text follows.
 * Returns deferred when bare duration would drop meaningful trailing context (caller may use AI).
 */
export function extractDurationAnchoredBarPhrase(raw: string, maxLen: number): V2DurationAnchorExtraction {
  const full = raw.trim().replace(/\s+/g, " ");
  if (!full) return { phrase: null, mode: "none" };

  const m = DURATION_BAR_RE.exec(full);
  if (!m) return { phrase: null, mode: "none" };

  const durStart = m.index;
  const durEnd = m.index + m[0].length;
  const durText = m[0].trim();

  const start = pickDurationPhraseStart(full, durStart);
  const end = extendDurationPhraseEnd(full, durEnd);

  let phrase = full.slice(start, end).trim().replace(/\s+/g, " ");
  if (phrase.length > maxLen) phrase = phrase.slice(0, maxLen).trim();

  const trimmedAfter = full.slice(durEnd).trim();
  const hadTrailing = trimmedAfter.length > 0;
  const trailingLooksMeaningful =
    hadTrailing &&
    trimmedAfter.length >= 3 &&
    /\b(per|day|daily|each|every|on|for|after|before|during|with|until|distribution|lunch|morning|evening|night|today|tomorrow|minute|minutes|hour|hours)\b/i.test(
      trimmedAfter
    );

  if (phrase === durText && trailingLooksMeaningful) {
    return { phrase: null, mode: "deferred" };
  }

  const mode: "bare" | "widened" = phrase !== durText ? "widened" : "bare";
  return { phrase, mode };
}

/** Pull coarse candidate phrases from natural language (no mutation). */
export function extractCandidateBarsFromSms(raw: string): {
  candidateTightenedBar: string | null;
  candidateNewBar: string | null;
} {
  const t = raw.trim();
  if (!t) return { candidateTightenedBar: null, candidateNewBar: null };

  const myNew = t.match(
    /\b(?:my\s+)?new\s+(?:goal|commitment|bar)\s+is\s+(.{3,180}?)(?:\.|$)/i
  );
  if (myNew?.[1]?.trim()) {
    return {
      candidateTightenedBar: null,
      candidateNewBar: myNew[1]!.trim().replace(/\s+/g, " ").slice(0, 200),
    };
  }

  const goalIs = t.match(/\bgoal\s+is\s+to\s+(.{3,180}?)(?:\.|$)/i);
  if (goalIs?.[1]?.trim()) {
    return {
      candidateTightenedBar: null,
      candidateNewBar: goalIs[1]!.trim().replace(/\s+/g, " ").slice(0, 200),
    };
  }

  const durEx = extractDurationAnchoredBarPhrase(t, 200);
  if (durEx.phrase) {
    const phrase = durEx.phrase.trim().replace(/\s+/g, " ");
    return { candidateTightenedBar: phrase, candidateNewBar: phrase };
  }

  return { candidateTightenedBar: null, candidateNewBar: null };
}

/**
 * Map AI shadow interpretation + heuristics to a server intent for SMS handling.
 */
export function deriveSmsCommitmentChangeIntent(args: {
  rawBody: string;
  interpretation: V2InboundShadowInterpretationResult | null;
}): V2SmsCommitmentIntentPack {
  const raw = args.rawBody.trim();
  const lower = raw.toLowerCase();
  const ai = args.interpretation?.ok === true ? args.interpretation.data : null;
  const conf = typeof ai?.confidence === "number" ? ai.confidence : null;
  const candidates = extractCandidateBarsFromSms(raw);

  const quitLike =
    /\b(i\s+quit|i\s+can't\s+do\s+this|i\s+cannot\s+do\s+this|i'?m\s+done|im\s+done|this\s+is\s+pointless|i\s+give\s+up)\b/i.test(
      raw
    ) ||
    (ai?.discouraged_or_frustrated === true &&
      /\b(quit|done|pointless|can'?t|cannot|give\s+up)\b/i.test(lower));

  if (quitLike) {
    return {
      intent: "sms_soft_quit_or_frustration",
      candidateTightenedBar: null,
      candidateNewBar: null,
      aiConfidence: conf,
    };
  }

  const replaceLike =
    /\b(new\s+goal|replace|different\s+goal|doesn'?t\s+fit|does\s+not\s+fit|change\s+(the\s+)?goal|switch\s+to|not\s+the\s+right\s+goal)\b/i.test(
      lower
    ) || ai?.intent === "commitment_change_request";

  const tightenLike =
    /\b(smaller|too\s+much|lower\s+(the\s+)?bar|tighten|scale\s+it\s+down|make\s+it\s+easier|less\s+time|overwhelming)\b/i.test(
      lower
    );

  if (replaceLike && !tightenLike) {
    return {
      intent: "sms_replace_request",
      candidateTightenedBar: null,
      candidateNewBar: candidates.candidateNewBar,
      aiConfidence: conf,
    };
  }

  if (tightenLike && !replaceLike) {
    return {
      intent: "sms_tighten_request",
      candidateTightenedBar: candidates.candidateTightenedBar,
      candidateNewBar: null,
      aiConfidence: conf,
    };
  }

  if (tightenLike && replaceLike) {
    if (candidates.candidateTightenedBar && !candidates.candidateNewBar) {
      return {
        intent: "sms_tighten_request",
        candidateTightenedBar: candidates.candidateTightenedBar,
        candidateNewBar: null,
        aiConfidence: conf,
      };
    }
    return {
      intent: "sms_replace_request",
      candidateTightenedBar: null,
      candidateNewBar: candidates.candidateNewBar,
      aiConfidence: conf,
    };
  }

  return {
    intent: "sms_change_unspecified",
    candidateTightenedBar: candidates.candidateTightenedBar,
    candidateNewBar: candidates.candidateNewBar,
    aiConfidence: conf,
  };
}

export function buildSmsCommitmentChangeCoachReply(pack: V2SmsCommitmentIntentPack): string {
  switch (pack.intent) {
    case "sms_soft_quit_or_frustration":
      return "I hear you. That may mean the bar is wrong, not that you're done. Want to make it smaller, change the goal, or tell me what's honest right now?";
    case "sms_tighten_request":
      if (pack.candidateTightenedBar?.trim()) {
        const bar = pack.candidateTightenedBar.trim();
        return `Good — I won't rewrite the full commitment from here, but I'll hold you to this honest smaller version: ${bar}. Same fight, clearer bar.`;
      }
      return "What smaller version would still be honest tomorrow?";
    case "sms_replace_request":
      if (pack.candidateNewBar?.trim()) {
        const nb = pack.candidateNewBar.trim();
        return `Got it. I'm holding this as your candidate new bar: ${nb}. When you're ready to lock it in, say it again as one clear daily-action sentence.`;
      }
      return "What should the new daily bar be?";
    case "sms_change_unspecified":
    default:
      return "Something needs to change — I get it. Is it the size of the bar, or the goal itself? Tell me what feels honest.";
  }
}

const SMS_MAX_WAVE4 = 300;

export function appendWhenExistingPendingResolution(base: string): string {
  const tail =
    " You already have a commitment update in progress—reply here to finish it before starting another.";
  const merged = base.trimEnd() + tail;
  return merged.length <= SMS_MAX_WAVE4 ? merged : base;
}

export type Wave4PendingSkipReason =
  | "soft_quit"
  | "paused_reactivation"
  | "refresh_session_active"
  | "existing_pending";

/**
 * Optionally sets pending_resolution_* from SMS (no commitment mutation).
 * Skips when paused, refresh session active, existing pending, or soft-quit-only.
 */
export async function applyWave4SmsCommitmentPendingResolution(args: {
  commitmentId: string;
  clerkUserId: string;
  commitment: ActiveV2CommitmentRow;
  messageSid: string;
  rawBody: string;
  intentPack: V2SmsCommitmentIntentPack;
}): Promise<{
  pendingApplied: boolean;
  pendingKind: V2PendingResolutionKind | null;
  skipReason: Wave4PendingSkipReason | null;
}> {
  const { intentPack } = args;
  if (intentPack.intent === "sms_soft_quit_or_frustration") {
    return { pendingApplied: false, pendingKind: null, skipReason: "soft_quit" };
  }

  if (args.commitment.accountability_phase === "low_pressure_reactivation") {
    return { pendingApplied: false, pendingKind: null, skipReason: "paused_reactivation" };
  }

  if (isRefreshSessionActive(args.commitment)) {
    return { pendingApplied: false, pendingKind: null, skipReason: "refresh_session_active" };
  }

  await clearPendingResolutionIfExpired(args.commitmentId, args.commitment);
  const row = (await getActiveCommitment(args.clerkUserId)) ?? args.commitment;
  if (getPendingResolutionOrNull(row)) {
    return { pendingApplied: false, pendingKind: null, skipReason: "existing_pending" };
  }

  const kind: V2PendingResolutionKind =
    intentPack.intent === "sms_tighten_request" ? "commitment_tighten" : "commitment_replace";

  const payload: V2SmsPendingResolutionPayload = {
    source: "sms_inbound",
    sms_state: "awaiting_candidate",
    detected_intent: intentPack.intent,
    raw_user_text: args.rawBody,
    inbound_message_sid: args.messageSid,
    ai_confidence: intentPack.aiConfidence,
    candidate_tightened_bar: intentPack.candidateTightenedBar,
    candidate_new_bar: intentPack.candidateNewBar,
  };

  await setPendingResolution({
    commitmentId: args.commitmentId,
    kind,
    payload,
    expectedUpdatedAt: row.updated_at,
  });

  return { pendingApplied: true, pendingKind: kind, skipReason: null };
}
