/**
 * V3 learning signals — bounded pattern hints from server-backed events + memory (no new schema).
 */

import type { V2EventRowForAi } from "@/lib/v2-commitment";
import type { V2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory-prompt";

export type V3LearningSignals = {
  blockerPattern?: string | null;
  /** Approximate hits in recent payload scan + inbound (not a formal score). */
  blockerPatternCount?: number;
  workingCondition?: string | null;
  failedStrategy?: string | null;
  currentExperiment?: string | null;
  upstreamCause?: string | null;
  doNotRepeat?: string | null;
  /** Heuristic 0–1 style confidence that the pattern is real, not noise. */
  confidence?: number;
};

const TRAVEL_RE = /\b(travel|trip|flight|airport|hotel|away|out of town)\b/i;
const SNOOZE_RE = /\b(snooze|alarm|woke up late|slept in|overslept)\b/i;
const BEDTIME_RE = /\b(bedtime|late night|couldn'?t sleep|up late|tired in the morning)\b/i;
const PHONE_RE = /\b(phone|scroll|distraction|tiktok|social)\b/i;
const AVOID_RE = /\b(avoid|avoidance|putting off|couldn'?t start|hard to start|zero\s+distribution|zero)\b/i;
const FOCUS_WIN_RE = /\b(stayed\s+focused|focused|locked\s+in|protected\s+(my\s+)?attention)\b/i;
const NAP_RE = /\b(before nap|nap time|during nap)\b/i;
const DRAWER_RE = /\b(drawer|declutter|one drawer)\b/i;

const MS_DAY = 86400000;

function eventBlob(e: V2EventRowForAi): string {
  const p = e.payload_json as Record<string, unknown> | null | undefined;
  const msg = typeof p?.message === "string" ? p.message : "";
  const ai = p?.ai;
  const aiMsg =
    ai && typeof ai === "object" && !Array.isArray(ai)
      ? String((ai as Record<string, unknown>).message ?? "")
      : "";
  const v3 = p?.v3_brain;
  const v3s =
    v3 && typeof v3 === "object" && !Array.isArray(v3)
      ? JSON.stringify(v3).slice(0, 400)
      : "";
  return `${msg} ${aiMsg} ${v3s}`;
}

function countRecentMatches(
  events: V2EventRowForAi[],
  re: RegExp,
  maxScan = 30,
  maxAgeDays = 21
): number {
  const cutoff = Date.now() - maxAgeDays * MS_DAY;
  let n = 0;
  for (const e of events.slice(0, maxScan)) {
    const t = new Date(e.occurred_at).getTime();
    if (t < cutoff) continue;
    if (re.test(eventBlob(e))) n++;
  }
  return n;
}

function scanPayloadKeywords(events: V2EventRowForAi[], keywords: RegExp[], maxScan = 40): number {
  let n = 0;
  for (const e of events.slice(0, maxScan)) {
    const b = eventBlob(e).toLowerCase();
    if (keywords.some((k) => k.test(b))) n++;
  }
  return n;
}

/**
 * One-line digest for `recomputeV2CoachingMemory` `v3LearningNotebookAppend` (bounded).
 */
export function buildV3LearningNotebookLine(s: V3LearningSignals, inboundHint?: string | null): string {
  const parts: string[] = [];
  if (s.blockerPattern) parts.push(`pattern=${s.blockerPattern}${s.blockerPatternCount != null ? `×~${s.blockerPatternCount}` : ""}`);
  if (s.upstreamCause) parts.push(`upstream=${s.upstreamCause}`);
  if (s.workingCondition) parts.push(`works=${s.workingCondition}`);
  if (s.currentExperiment) parts.push(`exp=${s.currentExperiment}`);
  if (s.failedStrategy) parts.push(`failed=${s.failedStrategy}`);
  if (s.doNotRepeat) parts.push(`dnr=${s.doNotRepeat}`);
  if (typeof s.confidence === "number") parts.push(`conf≈${s.confidence.toFixed(2)}`);
  const inb = (inboundHint ?? "").trim().slice(0, 60);
  if (inb) parts.push(`in=${inb}`);
  return parts.join("; ").slice(0, 240);
}

/**
 * Derive compact learning hints for V3 prompts + optional event metadata (no DB columns).
 */
export function deriveV3LearningSignalsFromContext(args: {
  recentEventsNewestFirst: V2EventRowForAi[];
  coachingMemory: V2CoachingMemoryForPrompt | null;
  latestInbound?: string | null;
}): V3LearningSignals {
  const ev = args.recentEventsNewestFirst;
  const mem = args.coachingMemory;
  const blocker =
    typeof mem?.latest_blocker_preview === "string" && mem.latest_blocker_preview.trim()
      ? mem.latest_blocker_preview.trim().slice(0, 120)
      : null;
  const tags = mem?.blocker_tags ?? [];
  const inbound = (args.latestInbound ?? "").trim();

  const travelHits =
    countRecentMatches(ev, TRAVEL_RE) + scanPayloadKeywords(ev, [TRAVEL_RE]) * 0.5 + (TRAVEL_RE.test(inbound) ? 2 : 0);
  const snoozeHits =
    countRecentMatches(ev, SNOOZE_RE) + scanPayloadKeywords(ev, [SNOOZE_RE]) * 0.5 + (SNOOZE_RE.test(inbound) ? 2 : 0);
  const bedtimeHits =
    countRecentMatches(ev, BEDTIME_RE) + scanPayloadKeywords(ev, [BEDTIME_RE]) * 0.5 + (BEDTIME_RE.test(inbound) ? 2 : 0);
  const phoneHits =
    countRecentMatches(ev, PHONE_RE) + scanPayloadKeywords(ev, [PHONE_RE]) * 0.5 + (PHONE_RE.test(inbound) ? 1 : 0);
  const avoidHits =
    countRecentMatches(ev, AVOID_RE) + scanPayloadKeywords(ev, [AVOID_RE]) * 0.5 + (AVOID_RE.test(inbound) ? 1 : 0);
  const focusWins = countRecentMatches(ev, FOCUS_WIN_RE) + (FOCUS_WIN_RE.test(inbound) ? 1 : 0);

  let blockerPattern: string | null = null;
  let blockerPatternCount = Math.round(Math.max(travelHits, snoozeHits, bedtimeHits, avoidHits, phoneHits));

  if (travelHits >= 2) blockerPattern = "travel_disruption";
  else if (snoozeHits >= 2) blockerPattern = "snooze_alarm";
  else if (bedtimeHits >= 2) blockerPattern = "late_bedtime_upstream";
  else if (avoidHits >= 2) blockerPattern = "avoidance_getting_started";
  else if (phoneHits >= 2) blockerPattern = "phone_pull";

  let workingCondition: string | null = null;
  if (/\b(block|blocked|dnd|do not disturb|phone away|across the room)\b/i.test(inbound)) {
    workingCondition = "phone_blocked_or_protected";
  } else if (/\b(early|first thing|6\s*am|morning block)\b/i.test(inbound)) {
    workingCondition = "early_start";
  } else if (focusWins >= 2 || FOCUS_WIN_RE.test(inbound)) {
    workingCondition = "focus_protected_attention";
  } else if (NAP_RE.test(inbound) || tags.some((t) => /nap/i.test(String(t)))) {
    workingCondition = "before_nap_window";
  } else if (DRAWER_RE.test(inbound) || tags.some((t) => /drawer|declutter/i.test(String(t)))) {
    workingCondition = "one_drawer_micro_version";
  }

  let failedStrategy: string | null = null;
  if ((mem?.no_count_14d ?? 0) >= 4 && !workingCondition) {
    failedStrategy = "unprotected_time_or_vague_effort";
  }

  let currentExperiment: string | null = null;
  if (blockerPattern === "late_bedtime_upstream") currentExperiment = "shift_upstream_to_bedtime";
  else if (blockerPattern === "snooze_alarm") currentExperiment = "phone_across_room_alarm";
  else if (blockerPattern === "travel_disruption") currentExperiment = "travel_version_smaller_rep";
  else if (blockerPattern === "avoidance_getting_started") currentExperiment = "first_ten_minutes_only";

  if (!failedStrategy && blockerPattern && blockerPatternCount >= 4 && currentExperiment) {
    failedStrategy = `repeat_after_${currentExperiment}`;
  }

  const summaryLower = (mem?.coaching_summary ?? "").toLowerCase();
  let doNotRepeat: string | null = null;
  if (/same\s+generic|repeated\s+blocker\s+question/i.test(summaryLower)) {
    doNotRepeat = "generic_blocker_prompt";
  }
  const wgwInSummary = (mem?.coaching_summary ?? "").match(/what\s+got\s+in\s+the\s+way/gi);
  if (!doNotRepeat && wgwInSummary != null && wgwInSummary.length >= 2) {
    doNotRepeat = "repeat_what_got_in_the_way_question";
  }
  if (!doNotRepeat && /\bwhat\s+got\s+in\s+the\s+way\b/i.test(inbound) && wgwInSummary != null && wgwInSummary.length >= 1) {
    doNotRepeat = "narrow_blocker_not_generic_why";
  }

  let confidence = 0.35;
  if (blockerPattern && blockerPatternCount >= 5) confidence = 0.9;
  else if (blockerPattern && blockerPatternCount >= 3) confidence = 0.78;
  else if (blockerPattern && blockerPatternCount >= 2) confidence = 0.62;
  if (workingCondition) confidence = Math.min(0.95, confidence + 0.15);

  if (blockerPattern && blockerPatternCount >= 3 && !doNotRepeat) {
    doNotRepeat = `repeated_${blockerPattern}_prompt`;
  }

  return {
    blockerPattern: blockerPattern ?? (blocker ? "named_blocker_from_memory" : null),
    blockerPatternCount: blockerPattern ? Math.round(blockerPatternCount) : undefined,
    workingCondition,
    failedStrategy,
    currentExperiment,
    upstreamCause: bedtimeHits >= 2 ? "sleep_timing" : null,
    doNotRepeat,
    confidence,
  };
}

/** Extra notebook fragment for strongest V1 retention (existing coaching_summary append only). */
export function buildV1ExtraNotebookAppend(args: {
  learning: V3LearningSignals;
  outcomeHint?: "user_yes" | "user_no" | "user_partial" | null;
  inboundRaw?: string | null;
}): string | null {
  const s = args.learning;
  const parts: string[] = [];
  if ((s.blockerPatternCount ?? 0) >= 2 && s.blockerPattern) {
    parts.push(`repeat_signal=${s.blockerPattern}`);
  }
  if (args.outcomeHint === "user_yes" && s.workingCondition) {
    parts.push(`win_used_setup=${s.workingCondition}`);
  }
  if (s.currentExperiment) {
    parts.push(`intervention=${s.currentExperiment}`);
  }
  if (s.failedStrategy) {
    parts.push(`strategy_note=${s.failedStrategy}`);
  }
  const inb = (args.inboundRaw ?? "").trim().slice(0, 48);
  if (parts.length === 0 && inb) return null;
  if (parts.length === 0) return null;
  const base = parts.join("; ").slice(0, 200);
  return inb ? `${base}; in=${inb}` : base;
}
