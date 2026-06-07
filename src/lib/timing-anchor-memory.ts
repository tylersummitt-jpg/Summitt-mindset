/**
 * Runtime-derived timing anchor confidence (facts only — no DB migration).
 * Separate from pending_plan_proof (outcome truth vs anchor recurrence confidence).
 */

import type { V2EventRowForAi } from "@/lib/v2-commitment";
import { getDateKeyInTimezone } from "@/lib/timezone";
import {
  extractAnchorPhraseHint,
  hasFuturePlanIntentLanguage,
  looksLikeReportedCompletion,
  type PendingPlanProofFact,
} from "@/lib/pending-plan-proof";

export type TimingAnchorConfidenceLevel =
  | "mentioned_once"
  | "repeated"
  | "user_confirmed"
  | "worked_before";

export type TimingAnchorRecurrenceConfidence = "unknown" | "low" | "medium";

export type TimingAnchorMemorySource =
  | "recent_user_plan"
  | "repeated_mentions"
  | "explicit_confirmation"
  | "prior_success_pattern";

export type TimingAnchorMemory = {
  active: boolean;
  anchor_phrase_hint: string | null;
  anchor_key: string | null;
  recurrence_confidence: TimingAnchorRecurrenceConfidence;
  confidence_level: TimingAnchorConfidenceLevel | null;
  mention_count_45d: number;
  user_confirmed: boolean;
  outcome_success_after_mention_count: number;
  first_seen_day_key: string | null;
  last_seen_day_key: string | null;
  source: TimingAnchorMemorySource | null;
  safe_usage_allowed: string[];
  safe_usage_forbidden: string[];
};

const OUTCOME_EVENT_TYPES = new Set(["user_yes", "user_no", "user_partial"]);

const ANCHOR_STOPWORDS = new Set([
  "after",
  "when",
  "once",
  "from",
  "gets",
  "get",
  "back",
  "her",
  "his",
  "their",
  "the",
  "my",
  "your",
  "our",
  "a",
  "an",
  "for",
  "to",
  "of",
  "that",
  "this",
  "will",
  "do",
  "it",
  "i",
  "ill",
  "going",
  "gonna",
  "today",
  "tomorrow",
  "yesterday",
  "last",
  "night",
  "morning",
]);

const VAGUE_ANCHOR_KEYS = new Set(["that", "this", "there", "then", "later", "soon"]);

const CONFIRMATION_LANGUAGE_RE =
  /\b(usually|normally|most mornings|every day|every weekday|each morning)\b/i;
const BEST_WINDOW_RE = /\b(that'?s|that is)\s+(my|the)\s+best\s+window\b/i;
const WORKS_FOR_ME_RE = /\b(that works|works for me)\b/i;
const WHEN_I_USUALLY_RE = /\b(that'?s when|when)\s+i\s+usually\b/i;

export function inactiveTimingAnchorMemory(): TimingAnchorMemory {
  return {
    active: false,
    anchor_phrase_hint: null,
    anchor_key: null,
    recurrence_confidence: "unknown",
    confidence_level: null,
    mention_count_45d: 0,
    user_confirmed: false,
    outcome_success_after_mention_count: 0,
    first_seen_day_key: null,
    last_seen_day_key: null,
    source: null,
    safe_usage_allowed: [],
    safe_usage_forbidden: [],
  };
}

/** Stable token key for anchor matching (not a person/schedule graph). */
export function normalizeAnchorKey(anchorPhrase: string): string | null {
  let s = anchorPhrase
    .trim()
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^\w\s]/g, " ");
  s = s.replace(/^(after|when|once)\s+/i, "").trim();
  if (!s) return null;

  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const raw of s.split(/\s+/)) {
    let w = raw.trim();
    if (w.endsWith("s") && w.length > 4 && !w.endsWith("ss")) {
      w = w.slice(0, -1);
    }
    if (w.length < 2 || ANCHOR_STOPWORDS.has(w) || VAGUE_ANCHOR_KEYS.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    tokens.push(w);
  }

  if (tokens.length < 2) return null;
  if (tokens.every((t) => VAGUE_ANCHOR_KEYS.has(t))) return null;

  return tokens.slice(0, 6).join("|");
}

export function detectAnchorConfirmationLanguage(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (CONFIRMATION_LANGUAGE_RE.test(t)) return true;
  if (BEST_WINDOW_RE.test(t)) return true;
  if (WORKS_FOR_ME_RE.test(t)) return true;
  if (WHEN_I_USUALLY_RE.test(t)) return true;
  return false;
}

export function anchorKeysMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const ta = a.split("|").filter(Boolean);
  const tb = b.split("|").filter(Boolean);
  if (!ta.length || !tb.length) return false;
  const overlap = ta.filter((t) => tb.includes(t)).length;
  const minRequired = Math.min(2, Math.min(ta.length, tb.length));
  return overlap >= minRequired;
}

function extractWhenOnceAnchorPhrase(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(
    /\b(when|once)\s+[^,.!?]{4,60}\b(gets back|returns|workout|appointment|meeting|call|shift)\b[^,.!?]{0,24}/i
  );
  if (!m?.[0]) return null;
  return m[0].trim().slice(0, 80);
}

export function extractTimingAnchorPhrase(text: string): string | null {
  return extractAnchorPhraseHint(text) ?? extractWhenOnceAnchorPhrase(text);
}

type AnchorMention = {
  text: string;
  phrase: string;
  key: string;
  day_key: string | null;
};

function findAnsweredAtForText(
  rows: Array<{ text: string; answered_at?: string | null }> | undefined,
  text: string
): number {
  const norm = text.trim().toLowerCase();
  if (!norm) return 0;
  for (const row of rows ?? []) {
    if ((row.text?.trim() ?? "").toLowerCase() === norm) {
      return parseIsoMs(row.answered_at ?? null);
    }
  }
  return 0;
}

function parseIsoMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function extractUserLinesFromThread(threadText: string): string[] {
  const out: string[] = [];
  for (const line of threadText.split(/\r?\n/)) {
    const m = /^\s*User:\s*(.+)$/i.exec(line);
    if (m?.[1]?.trim()) out.push(m[1].trim());
  }
  return out;
}

function collectAnchorMentions(args: {
  latestAnswerAfterOpenQuestion?: string | null;
  recentExactThreadText?: string | null;
  userAnswersNewestFirst?: Array<{ text: string; answered_at?: string | null }>;
  timezone?: string;
}): AnchorMention[] {
  const mentions: AnchorMention[] = [];
  const timezone = args.timezone?.trim() || "UTC";

  const addFromText = (text: string, answeredAt?: string | null) => {
    const phrase = extractTimingAnchorPhrase(text);
    if (!phrase) return;
    const key = normalizeAnchorKey(phrase);
    if (!key) return;
    const atMs = parseIsoMs(answeredAt ?? null);
    const day_key =
      atMs > 0 ? getDateKeyInTimezone(new Date(atMs), timezone) : null;
    mentions.push({ text, phrase, key, day_key });
  };

  const latest = args.latestAnswerAfterOpenQuestion?.trim();
  if (latest) {
    const latestAt =
      args.userAnswersNewestFirst?.find((r) => r.text?.trim() === latest)?.answered_at ?? null;
    addFromText(latest, latestAt);
  }

  for (const row of args.userAnswersNewestFirst ?? []) {
    const text = row.text?.trim() ?? "";
    if (!text) continue;
    addFromText(text, row.answered_at ?? null);
  }

  for (const line of extractUserLinesFromThread(args.recentExactThreadText ?? "")) {
    addFromText(line);
  }

  return mentions;
}

function dedupeMentionsByKey(mentions: AnchorMention[]): Map<string, AnchorMention[]> {
  const byKey = new Map<string, AnchorMention[]>();
  for (const m of mentions) {
    let bucket: string | null = null;
    for (const existing of byKey.keys()) {
      if (anchorKeysMatch(existing, m.key)) {
        bucket = existing;
        break;
      }
    }
    const k = bucket ?? m.key;
    const list = byKey.get(k) ?? [];
    const dup = list.some(
      (x) => x.text === m.text && x.phrase === m.phrase && x.day_key === m.day_key
    );
    if (!dup) list.push(m);
    byKey.set(k, list);
  }
  return byKey;
}

function pickPrimaryAnchorKey(
  byKey: Map<string, AnchorMention[]>,
  pendingPlanProof?: PendingPlanProofFact | null
): { key: string; mentions: AnchorMention[] } | null {
  if (pendingPlanProof?.anchor_key) {
    for (const [key, mentions] of byKey.entries()) {
      if (anchorKeysMatch(key, pendingPlanProof.anchor_key)) {
        return { key: pendingPlanProof.anchor_key, mentions };
      }
    }
    if (pendingPlanProof.anchor_phrase_hint) {
      const phrase = pendingPlanProof.anchor_phrase_hint;
      return {
        key: pendingPlanProof.anchor_key,
        mentions: [
          {
            text: pendingPlanProof.source_answer_preview,
            phrase,
            key: pendingPlanProof.anchor_key,
            day_key: pendingPlanProof.plan_for_day_key,
          },
        ],
      };
    }
  }

  let best: { key: string; mentions: AnchorMention[] } | null = null;
  for (const [key, mentions] of byKey.entries()) {
    if (!best || mentions.length > best.mentions.length) {
      best = { key, mentions };
    }
  }
  return best;
}

function hasOutcomeEventAfter(events: V2EventRowForAi[] | undefined, afterMs: number): boolean {
  if (!events?.length || afterMs <= 0) return false;
  for (const e of events) {
    const t = parseIsoMs(e.occurred_at);
    if (t <= afterMs) continue;
    if (OUTCOME_EVENT_TYPES.has(e.event_type)) return true;
  }
  return false;
}

function hasLaterCompletionAfterPlan(args: {
  planAnswer: string;
  planAnswerAtMs: number;
  userAnswersNewestFirst?: Array<{ text: string; answered_at?: string | null }>;
}): boolean {
  const planNorm = args.planAnswer.trim().toLowerCase();
  for (const row of args.userAnswersNewestFirst ?? []) {
    const text = row.text?.trim() ?? "";
    if (!text || text.toLowerCase() === planNorm) continue;
    const at = parseIsoMs(row.answered_at ?? null);
    if (args.planAnswerAtMs > 0 && at > 0 && at <= args.planAnswerAtMs) continue;
    if (looksLikeReportedCompletion(text)) return true;
  }
  return false;
}

function buildSafeUsageForLevel(level: TimingAnchorConfidenceLevel): {
  allowed: string[];
  forbidden: string[];
} {
  const forbidden = [
    "assume_daily_schedule",
    "call_it_usual",
    "claim_it_worked_without_proof",
  ];
  switch (level) {
    case "mentioned_once":
      return {
        allowed: [
          "reference_as_dated_window",
          "ask_if_window_available_again",
          "close_loop_before_advice",
        ],
        forbidden,
      };
    case "repeated":
      return {
        allowed: [
          "reference_as_dated_window",
          "ask_if_window_available_again",
          "close_loop_before_advice",
          "suggest_as_possible_pattern_with_confirm",
        ],
        forbidden,
      };
    case "user_confirmed":
      return {
        allowed: [
          "reference_as_dated_window",
          "ask_if_window_available_again",
          "close_loop_before_advice",
          "habit_stack_candidate_with_confirm",
          "ask_if_still_best_window",
        ],
        forbidden: ["assume_daily_schedule", "claim_it_worked_without_proof"],
      };
    case "worked_before":
      return {
        allowed: [
          "reference_as_dated_window",
          "ask_if_window_available_again",
          "close_loop_before_advice",
          "note_may_have_helped_once",
          "habit_stack_candidate_with_confirm",
        ],
        forbidden: ["assume_daily_schedule", "call_it_usual"],
      };
    default:
      return { allowed: [], forbidden };
  }
}

export type DeriveTimingAnchorMemoryArgs = {
  latestAnswerAfterOpenQuestion?: string | null;
  recentExactThreadText?: string | null;
  userAnswersNewestFirst?: Array<{ text: string; answered_at?: string | null }>;
  pendingPlanProof?: PendingPlanProofFact | null;
  recentEvents?: V2EventRowForAi[];
  timezone?: string;
  openQuestionAnsweredAt?: string | null;
};

export function deriveTimingAnchorMemory(args: DeriveTimingAnchorMemoryArgs): TimingAnchorMemory {
  const inactive = inactiveTimingAnchorMemory();
  const allMentions = collectAnchorMentions({
    latestAnswerAfterOpenQuestion: args.latestAnswerAfterOpenQuestion,
    recentExactThreadText: args.recentExactThreadText,
    userAnswersNewestFirst: args.userAnswersNewestFirst,
    timezone: args.timezone,
  });
  const byKey = dedupeMentionsByKey(allMentions);
  const primary = pickPrimaryAnchorKey(byKey, args.pendingPlanProof);
  if (!primary) return inactive;

  const { key, mentions } = primary;
  const mention_count_45d = mentions.length;
  const bestPhrase =
    pendingPhraseHint(args.pendingPlanProof, key) ??
    mentions[mentions.length - 1]?.phrase ??
    null;

  const dayKeys = mentions
    .map((m) => m.day_key)
    .filter((d): d is string => Boolean(d));
  const distinctDays = new Set(dayKeys);

  const userConfirmed = mentions.some(
    (m) => detectAnchorConfirmationLanguage(m.text) && anchorKeysMatch(m.key, key)
  );

  let confidence_level: TimingAnchorConfidenceLevel = "mentioned_once";
  let recurrence_confidence: TimingAnchorRecurrenceConfidence = "unknown";
  let source: TimingAnchorMemorySource = "recent_user_plan";
  let outcome_success_after_mention_count = 0;

  if (userConfirmed) {
    confidence_level = "user_confirmed";
    recurrence_confidence = "medium";
    source = "explicit_confirmation";
  } else if (mention_count_45d >= 2 || distinctDays.size >= 2) {
    confidence_level = "repeated";
    recurrence_confidence = mention_count_45d >= 3 ? "medium" : "low";
    source = "repeated_mentions";
  }

  const planFromPending = args.pendingPlanProof?.source_answer_preview?.trim() ?? "";
  const planFromMentions = mentions
    .filter((m) => anchorKeysMatch(m.key, key) && hasFuturePlanIntentLanguage(m.text))
    .map((m) => m.text)
    .find(Boolean);
  const planAnswer = planFromPending || planFromMentions?.trim() || "";
  const planAnswerAtMs =
    planFromPending.length > 0
      ? parseIsoMs(args.openQuestionAnsweredAt ?? null)
      : findAnsweredAtForText(args.userAnswersNewestFirst, planAnswer);
  const pendingActiveForSameAnchor =
    args.pendingPlanProof?.active === true &&
    args.pendingPlanProof.anchor_key != null &&
    anchorKeysMatch(args.pendingPlanProof.anchor_key, key);

  const proofAfterPlan =
    !pendingActiveForSameAnchor &&
    planAnswer.length > 0 &&
    (hasOutcomeEventAfter(args.recentEvents, planAnswerAtMs) ||
      hasLaterCompletionAfterPlan({
        planAnswer,
        planAnswerAtMs,
        userAnswersNewestFirst: args.userAnswersNewestFirst,
      }));

  if (proofAfterPlan && !userConfirmed) {
    confidence_level = "worked_before";
    outcome_success_after_mention_count = 1;
    source = "prior_success_pattern";
    recurrence_confidence =
      recurrence_confidence === "unknown" ? "low" : recurrence_confidence;
  }

  const { allowed, forbidden } = buildSafeUsageForLevel(confidence_level);

  return {
    active: true,
    anchor_phrase_hint: bestPhrase,
    anchor_key: key,
    recurrence_confidence,
    confidence_level,
    mention_count_45d,
    user_confirmed: userConfirmed,
    outcome_success_after_mention_count,
    first_seen_day_key: dayKeys.length ? dayKeys.sort()[0]! : null,
    last_seen_day_key: dayKeys.length ? dayKeys.sort().at(-1)! : null,
    source,
    safe_usage_allowed: allowed,
    safe_usage_forbidden: forbidden,
  };
}

function pendingPhraseHint(
  pending: PendingPlanProofFact | null | undefined,
  key: string
): string | null {
  if (!pending?.anchor_phrase_hint || !pending.anchor_key) return null;
  if (!anchorKeysMatch(pending.anchor_key, key)) return null;
  return pending.anchor_phrase_hint;
}

export type DetectTimingAnchorVoiceViolationsArgs = {
  body: string;
  timingAnchorMemory?: TimingAnchorMemory | null;
  pendingPlanProof?: PendingPlanProofFact | null;
  hasProofOrKnownOutcome?: boolean;
};

const UNEARNED_OUTCOME_PRAISE_PATTERNS: Array<[string, RegExp]> = [
  ["unearned_completion_or_focus_praise", /\b(great|nice)\s+to\s+see\s+you\s+focused\b/i],
  ["unearned_completion_or_focus_praise", /\bit'?s\s+great\s+to\s+see\s+you\s+focused\b/i],
  ["unearned_completion_or_focus_praise", /\bback on track\b/i],
  ["unearned_completion_or_focus_praise", /\byou\s+followed\s+through\b/i],
  ["unearned_completion_or_focus_praise", /\byou\s+made\s+it\s+happen\b/i],
  ["unearned_completion_or_focus_praise", /\bproud of you\b/i],
  ["unearned_completion_or_focus_praise", /\byou\s+completed\b/i],
  ["unearned_completion_or_focus_praise", /\byou\s+stayed\s+consistent\b/i],
  ["unearned_completion_or_focus_praise", /\byou\s+showed\s+up\b/i],
  ["unearned_completion_or_focus_praise", /\bnice\s+work\s+getting\s+it\s+done\b/i],
  ["unearned_completion_or_focus_praise", /\bnice\s+work\b/i],
];

const ALLOWED_WARMTH_PATTERNS: RegExp[] = [
  /\bgood\s+to\s+see\s+you\s+back\b/i,
  /\bgood\s+to\s+hear\s+from\s+you\b/i,
  /\b(i'?m\s+)?glad\s+you\s+answered\b/i,
  /\bgood\s+to\s+see\s+you\b/i,
];

const FORWARD_ANCHOR_COACHING_RE =
  /\b(dive into|knock out|focus on those|make the most of|get to those|use that time|get back to the plan|start your block|protect those|make the most)\b/i;

const USUAL_WINDOW_RE =
  /\b(your|the)\s+usual\b|\bas usual\b|\blike every day\b|\bevery (day|morning|weekday)\b|\byour normal\b.*\bwindow\b|\bevery morning after\b/i;

const FOREVER_SCHEDULE_RE =
  /\balways works\b|\bevery day forever\b|\bpermanent schedule\b|\byou always do this\b|\bproves this is your daily habit\b|\bthat window always works\b|\balways\b.*\bevery day\b/i;

function pushViolation(hits: string[], id: string): void {
  if (!hits.includes(id)) hits.push(id);
}

function normalizeBodyForAnchorMatch(text: string): string {
  return text.toLowerCase().replace(/'/g, "");
}

function resolveAnchorTokens(
  timing?: TimingAnchorMemory | null,
  pending?: PendingPlanProofFact | null
): string[] {
  const key = timing?.anchor_key ?? pending?.anchor_key ?? null;
  if (key) {
    return key.split("|").filter((t) => t.length >= 2);
  }
  const phrase = timing?.anchor_phrase_hint ?? pending?.anchor_phrase_hint ?? "";
  const fromPhrase = phrase ? normalizeAnchorKey(phrase) : null;
  if (fromPhrase) return fromPhrase.split("|");
  return [];
}

function anchorReferencedInBody(bodyNorm: string, tokens: string[]): boolean {
  if (!tokens.length) return false;
  const matched = tokens.filter((t) => bodyNorm.includes(t));
  if (tokens.length >= 2) {
    return matched.length >= Math.min(2, tokens.length);
  }
  return matched.length >= 1;
}

export function isOutcomeCloseLoopQuestion(text: string): boolean {
  const t = text.trim();
  if (!t || !/\?/.test(t)) return false;
  return /\b(did|happen|happened|done|partial|missed|complete|completed)\b/i.test(t);
}

const NEW_PLAN_ASK_RE =
  /\b(what'?s your plan|what is your plan|what will you do|when will you|can you commit|how will you|what are you going to)\b/i;

/** Outcome truth ask for a prior plan — not a new planning question. */
export function isClosePriorPlanLoopOutcomeQuestion(text: string): boolean {
  const t = text.trim();
  if (!t || !/\?/.test(t)) return false;
  if (NEW_PLAN_ASK_RE.test(t)) return false;
  if (
    /\b(done,?\s*partial,?\s*or\s*missed|get it done,?\s*start it,?\s*or\s*did something get in the way|what happened with the plan|tell me the truth)\b/i.test(
      t
    )
  )
    return true;
  if (
    /\b(before we (make|set)|first[,]?\s+(did|tell))\b/i.test(t) &&
    /\b(happen|happened|did|done|partial|missed)\b/i.test(t)
  ) {
    return true;
  }
  return isOutcomeCloseLoopQuestion(t);
}

export function isConditionalAnchorAvailabilityQuestion(text: string): boolean {
  const t = text.trim();
  if (!/\bif\b/i.test(t)) return false;
  return /\b(window|available|still|today)\b/i.test(t);
}

export function isSafeDatedAnchorReference(text: string): boolean {
  return (
    /\byou (mentioned|named)\b/i.test(text) ||
    /\byesterday\b/i.test(text) ||
    isConditionalAnchorAvailabilityQuestion(text) ||
    isOutcomeCloseLoopQuestion(text)
  );
}

function isAccountabilityTruthAskWithoutPraise(text: string): boolean {
  if (/\b(great|proud|back on track|followed through|nice work|you completed|you showed up)\b/i.test(text)) {
    return false;
  }
  return /\b(tell me the truth|did it happen|what happened with the plan|get it done, start it, or did something get in the way|did yesterday)\b/i.test(
    text
  );
}

function isLowConfidenceAnchorLevel(
  level: TimingAnchorConfidenceLevel | null | undefined,
  userConfirmed: boolean
): boolean {
  if (!level || level === "mentioned_once") return true;
  if (level === "repeated" && !userConfirmed) return true;
  return false;
}

export function inferHasProofOrKnownOutcomeForDailyAccountability(accountability: {
  pending_plan_proof?: PendingPlanProofFact | null;
  prior_outcome?: string | null;
  proof_or_milestone_signal?: string | null;
}): boolean {
  if (accountability.pending_plan_proof?.active === true) return false;
  const prior = accountability.prior_outcome?.trim() ?? "";
  if (/^user_(yes|no|partial)$/i.test(prior)) return true;
  if (accountability.proof_or_milestone_signal?.trim()) return true;
  return false;
}

export function detectTimingAnchorVoiceViolations(
  args: DetectTimingAnchorVoiceViolationsArgs
): string[] {
  const t = args.body.trim();
  if (!t) return [];
  const hits: string[] = [];

  const timing = args.timingAnchorMemory;
  const pending = args.pendingPlanProof;
  const hasProof =
    args.hasProofOrKnownOutcome ?? inferHasProofOrKnownOutcomeForDailyAccountability({
      pending_plan_proof: pending,
    });

  const shouldBlockUnearnedPraise =
    pending?.active === true || args.hasProofOrKnownOutcome === false;

  if (shouldBlockUnearnedPraise && !isAccountabilityTruthAskWithoutPraise(t)) {
    for (const [id, re] of UNEARNED_OUTCOME_PRAISE_PATTERNS) {
      if (!re.test(t)) continue;
      if (ALLOWED_WARMTH_PATTERNS.some((allow) => allow.test(t) && id === "unearned_completion_or_focus_praise")) {
        continue;
      }
      pushViolation(hits, id);
    }
  }

  const timingActive = timing?.active === true && Boolean(timing.confidence_level);
  const anchorTokens = resolveAnchorTokens(timing, pending);
  const anchorContext = timingActive || anchorTokens.length > 0;
  if (!anchorContext || !anchorTokens.length) {
    return hits;
  }

  const bodyNorm = normalizeBodyForAnchorMatch(t);
  const anchorInBody = anchorReferencedInBody(bodyNorm, anchorTokens);
  if (!anchorInBody) {
    return hits;
  }

  if (isSafeDatedAnchorReference(t)) {
    const level = timing?.confidence_level ?? null;
    const userConfirmed = timing?.user_confirmed === true;
    if (FOREVER_SCHEDULE_RE.test(t) && (userConfirmed || level === "worked_before")) {
      pushViolation(hits, "timing_anchor_forever_schedule_claim");
    }
    return hits;
  }

  const level = timing?.confidence_level ?? "mentioned_once";
  const userConfirmed = timing?.user_confirmed === true;
  const lowConfidence = isLowConfidenceAnchorLevel(level, userConfirmed);

  if (FOREVER_SCHEDULE_RE.test(t)) {
    pushViolation(hits, "timing_anchor_forever_schedule_claim");
  }

  if (lowConfidence) {
    if (USUAL_WINDOW_RE.test(t)) {
      pushViolation(hits, "assume_usual_window");
    }

    const hasToday = /\btoday\b/i.test(t);
    if (
      hasToday &&
      !isConditionalAnchorAvailabilityQuestion(t) &&
      !isOutcomeCloseLoopQuestion(t)
    ) {
      pushViolation(hits, "anchor_today_without_confirm");
    }

    const forwardCoaching =
      FORWARD_ANCHOR_COACHING_RE.test(t) ||
      (/\bafter\b/i.test(t) && /\b(today|now)\b/i.test(t)) ||
      (/\bwhen\b/i.test(t) && hasToday) ||
      /\b(use your|your)\b[^.?!]{0,40}\bwindow\b/i.test(t);

    if (forwardCoaching) {
      pushViolation(hits, "presumed_recurring_anchor_schedule");
    }
  } else if (level === "worked_before") {
    if (/\balways works\b|\bdaily habit\b|\bproves this\b/i.test(t)) {
      pushViolation(hits, "timing_anchor_forever_schedule_claim");
    }
    if (USUAL_WINDOW_RE.test(t) && !userConfirmed) {
      pushViolation(hits, "assume_usual_window");
    }
  }

  return hits;
}

export function buildTimingAnchorVoiceRepairInstruction(
  violations: string[],
  timingAnchorMemory?: TimingAnchorMemory | null,
  pendingPlanProof?: PendingPlanProofFact | null
): string {
  if (!violations.length) return "";

  const lines = [
    "Rewrite the SMS to fix these voice violations (principles only — do not paste templates):",
  ];

  if (violations.some((v) => v.startsWith("unearned_"))) {
    lines.push(
      "- Do not praise completion, focus, consistency, follow-through, or being back on track unless proof exists in facts."
    );
  }

  if (pendingPlanProof?.active) {
    lines.push(
      "- accountability.pending_plan_proof is active: close the prior plan loop first — ask what happened with the plan (did they get it done, start it, or did something get in the way?) before new tactical advice."
    );
  }

  const level = timingAnchorMemory?.confidence_level ?? null;
  if (
    violations.some((v) =>
      ["presumed_recurring_anchor_schedule", "assume_usual_window", "anchor_today_without_confirm"].includes(v)
    )
  ) {
    lines.push(
      level === "mentioned_once"
        ? "- You used a one-time timing anchor as if it were recurring or scheduled for today. Rewrite to treat it as a dated/tentative window: say the user mentioned/named that window, or ask if it is available — do not assume it is today's schedule."
        : "- Do not assume the timing anchor repeats today or every day without confirming. Ask whether it is still the right window."
    );
  }

  if (violations.includes("timing_anchor_forever_schedule_claim")) {
    lines.push(
      "- Do not claim the timing anchor always works, is a permanent daily habit, or is proven forever — even if the user confirmed it as a usual window."
    );
  }

  if (timingAnchorMemory?.anchor_phrase_hint) {
    lines.push(
      `Timing detail (use confidence_level ${level ?? "unknown"}): ${JSON.stringify(timingAnchorMemory.anchor_phrase_hint)}.`
    );
  }

  return lines.join(" ");
}

/** Daily lane: how confidently a remembered timing detail may be used (not a schedule graph). */
export function buildTimingAnchorMemoryLaneGuardrails(
  memory: TimingAnchorMemory | null | undefined
): string {
  if (!memory?.active || !memory.confidence_level) return "";
  const level = memory.confidence_level;
  const forbiddenNote =
    memory.safe_usage_forbidden.length > 0
      ? ` Respect safe_usage_forbidden in facts: ${memory.safe_usage_forbidden.join(", ")}.`
      : "";
  const levelGuidance: Record<TimingAnchorConfidenceLevel, string> = {
    mentioned_once: `- confidence_level "mentioned_once": You may reference only as a dated or tentative window ("you mentioned…", "that window you named…", "if that window is available again…", "yesterday's window…"). Do NOT imply recurrence: no "your usual window", no "like every day", no "when [person] gets back today" unless confirming availability, no assuming the anchor is today's schedule.`,
    repeated: `- confidence_level "repeated": This has come up more than once — you may say it may be a useful window, but still ask/confirm rather than assume it will happen today or every day.`,
    user_confirmed: `- confidence_level "user_confirmed": The user has said this is usually their window — you may treat it as a reliable habit-stack candidate, but still confirm today ("is that still your best window?") and do not assume the schedule forever.`,
    worked_before: `- confidence_level "worked_before": You may say that window may have helped once or they followed through after naming it once — only if facts support outcome_success_after_mention_count. Do NOT say it always works, is their daily habit, or "use your usual window" unless user_confirmed or repeated also applies.`,
  };
  return `
TIMING ANCHOR CONFIDENCE (facts only — do not say these labels in SMS):
- accountability.timing_anchor_memory.active is true. A timing anchor is a remembered user detail, not automatically a schedule.
- Use confidence_level "${level}" when referencing ${memory.anchor_phrase_hint ? JSON.stringify(memory.anchor_phrase_hint) : "the timing detail"}.
${levelGuidance[level]}
- Never promote one mention into a recurring daily habit. One timing mention is not proof of recurrence.${forbiddenNote}`;
}

/** Compact fields for v3_brain / check_sent observability (no raw thread). */
export function buildTimingAnchorBrainMetadata(
  timing: TimingAnchorMemory | null | undefined,
  pending: PendingPlanProofFact | null | undefined
): Record<string, string | number | boolean | null> {
  return {
    timing_anchor_memory_active: timing?.active ?? false,
    timing_anchor_memory_anchor_key: timing?.anchor_key ?? null,
    timing_anchor_memory_confidence_level: timing?.confidence_level ?? null,
    timing_anchor_memory_mention_count_45d: timing?.mention_count_45d ?? 0,
    timing_anchor_memory_user_confirmed: timing?.user_confirmed ?? false,
    pending_plan_proof_active: pending?.active ?? false,
    pending_plan_proof_anchor_key: pending?.anchor_key ?? null,
  };
}
