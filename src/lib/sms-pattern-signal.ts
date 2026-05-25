/**
 * Bounded SMS pattern signal — deterministic recurrence hints (not diagnosis).
 * Slice 1: one helper for daily / weekly / inbound facts; no schema migration.
 */

import type { V2EventRowForAi } from "@/lib/v2-commitment";

export type SmsPatternCanonical =
  | "late_bedtime_upstream"
  | "avoidance_getting_started"
  | "travel_disruption"
  | "snooze_alarm"
  | "phone_pull"
  | "family_load"
  | "work_pressure"
  | "time_pressure"
  | "health_disruption"
  | "other";

export type SmsPatternConfidence = "low" | "medium" | "high";

export type SmsPatternSignalSource = "none" | "events" | "explicit_user_phrase" | "pat_read";

export type SmsPatternSignalResult = {
  canonical: SmsPatternCanonical | null;
  count14d: number;
  count21d: number;
  confidence: SmsPatternConfidence;
  mentionAllowed: boolean;
  internalHint: string | null;
  gentleUserLine: string | null;
  doNotRepeatKey: string | null;
  source: SmsPatternSignalSource;
};

const MS_DAY = 86400000;

const TRAVEL_RE = /\b(travel|trip|flight|airport|hotel|away|out of town)\b/i;
const SNOOZE_RE = /\b(snooze|alarm|woke up late|slept in|overslept)\b/i;
const BEDTIME_RE = /\b(bedtime|late night|couldn'?t sleep|up late|tired in the morning)\b/i;
const PHONE_RE = /\b(phone|scroll|distraction|tiktok|social)\b/i;
const AVOID_RE = /\b(avoid|avoidance|putting off|couldn'?t start|hard to start|zero\s+distribution|zero)\b/i;
const FAMILY_RE = /\b(family|kids|child|children|spouse|partner|caregiving|parenting)\b/i;
const WORK_RE = /\b(work|meetings?|deadline|boss|office|client|colleague)\b/i;
const TIME_RE = /\b(no time|rushed|schedule|calendar|back to back|time pressure|ran out of time)\b/i;
const HEALTH_RE = /\b(sick|illness|migraine|doctor|hospital|injury|pain|health|flu|fever)\b/i;

const EXPLICIT_RECURRENCE_RE =
  /\b(this keeps happening|same thing again|again and again|every time|keeps happening)\b/i;

const USER_CORRECTION_RE =
  /\b(that'?s not it|that is not it|wrong pattern|not the pattern|not why)\b/i;

const GENTLE_LINES: Record<SmsPatternCanonical, string> = {
  late_bedtime_upstream: "Late nights have shown up more than once. Let's plan around that.",
  avoidance_getting_started:
    "Getting started has shown up more than once. Make the first step smaller.",
  travel_disruption: "Travel has knocked this off track more than once. Use a smaller travel version.",
  snooze_alarm: "The alarm or morning start has slipped more than once. Set up the night before.",
  phone_pull: "The phone has pulled you off track more than once. Put distance between you and it.",
  family_load: "Family load has been in the way more than once. Keep today's step realistic.",
  work_pressure:
    "Work pressure has knocked this off track more than once. Plan the next move before the day owns you.",
  time_pressure: "Time pressure has shown up more than once. Shrink the first move.",
  health_disruption: "Health has been in the way more than once. Keep today's step realistic.",
  other: "The same friction has shown up more than once. Make the next step smaller.",
};

function parseEventMs(occurredAt?: string | null, createdAt?: string | null): number {
  const raw = (occurredAt ?? createdAt ?? "").trim();
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function payloadMessage(payload: Record<string, unknown> | null | undefined): string {
  const p = payload ?? {};
  const msg = typeof p.message === "string" ? p.message : "";
  const preview = typeof p.message_preview === "string" ? p.message_preview : "";
  return `${msg} ${preview}`.trim();
}

/** Map free text / tags to a canonical pattern id (no raw quote in output). */
export function normalizeSmsPatternSignalText(text: string | null | undefined): SmsPatternCanonical | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const lower = t.toLowerCase();

  if (BEDTIME_RE.test(t) || /\blate_bedtime|sleep_timing|bedtime\b/i.test(lower)) {
    return "late_bedtime_upstream";
  }
  if (AVOID_RE.test(t) || /\bavoidance|getting_started\b/i.test(lower)) return "avoidance_getting_started";
  if (TRAVEL_RE.test(t) || /\btravel_disruption\b/i.test(lower)) return "travel_disruption";
  if (SNOOZE_RE.test(t) || /\bsnooze_alarm\b/i.test(lower)) return "snooze_alarm";
  if (PHONE_RE.test(t) || /\bphone_pull\b/i.test(lower)) return "phone_pull";
  if (FAMILY_RE.test(t) || /\bfamily_load\b/i.test(lower)) return "family_load";
  if (WORK_RE.test(t) || /\bwork_pressure\b/i.test(lower)) return "work_pressure";
  if (TIME_RE.test(t) || /\btime_pressure\b/i.test(lower)) return "time_pressure";
  if (HEALTH_RE.test(t) || /\bhealth_disruption\b/i.test(lower)) return "health_disruption";

  return "other";
}

function normalizePatConfidence(raw: string | null | undefined): SmsPatternConfidence | null {
  const c = (raw ?? "").trim().toLowerCase();
  if (c === "high") return "high";
  if (c === "medium") return "medium";
  if (c === "low") return "low";
  return null;
}

function canonicalFromTags(tags: string[] | null | undefined): SmsPatternCanonical | null {
  if (!tags?.length) return null;
  for (const tag of tags) {
    const c = normalizeSmsPatternSignalText(String(tag));
    if (c && c !== "other") return c;
  }
  return null;
}

type BlockerHit = { canonical: SmsPatternCanonical; atMs: number };

function collectBlockerHits(eventsNewestFirst: V2EventRowForAi[]): BlockerHit[] {
  const hits: BlockerHit[] = [];
  for (const e of eventsNewestFirst) {
    if (e.event_type !== "blocker_captured") continue;
    const p = (e.payload_json ?? null) as Record<string, unknown> | null;
    const text = payloadMessage(p);
    const canonical = normalizeSmsPatternSignalText(text);
    if (!canonical) continue;
    const atMs = parseEventMs(
      e.occurred_at,
      "created_at" in e ? (e as { created_at?: string }).created_at : null
    );
    if (atMs <= 0) continue;
    hits.push({ canonical, atMs });
  }
  return hits;
}

function countCanonicalInWindow(
  hits: BlockerHit[],
  canonical: SmsPatternCanonical,
  windowDays: number,
  nowMs: number
): number {
  const cutoff = nowMs - windowDays * MS_DAY;
  let n = 0;
  for (const h of hits) {
    if (h.canonical !== canonical) continue;
    if (h.atMs >= cutoff && h.atMs <= nowMs) n += 1;
  }
  return n;
}

function countOutcomesAfterFirstBlocker(
  eventsNewestFirst: V2EventRowForAi[],
  canonical: SmsPatternCanonical,
  hits: BlockerHit[],
  nowMs: number
): number {
  const cutoff14 = nowMs - 14 * MS_DAY;
  const blockersAsc = hits
    .filter((h) => h.canonical === canonical && h.atMs >= cutoff14 && h.atMs <= nowMs)
    .sort((a, b) => a.atMs - b.atMs);
  if (blockersAsc.length === 0) return 0;
  const firstAt = blockersAsc[0]!.atMs;
  let n = 0;
  for (const e of eventsNewestFirst) {
    if (e.event_type !== "user_no" && e.event_type !== "user_partial") continue;
    const t = parseEventMs(
      e.occurred_at,
      "created_at" in e ? (e as { created_at?: string }).created_at : null
    );
    if (t > firstAt && t >= cutoff14 && t <= nowMs) n += 1;
  }
  return n;
}

function dominantCanonical(hits: BlockerHit[], nowMs: number): SmsPatternCanonical | null {
  const counts = new Map<SmsPatternCanonical, number>();
  const cutoff21 = nowMs - 21 * MS_DAY;
  for (const h of hits) {
    if (h.atMs < cutoff21 || h.atMs > nowMs) continue;
    counts.set(h.canonical, (counts.get(h.canonical) ?? 0) + 1);
  }
  let best: SmsPatternCanonical | null = null;
  let bestN = 0;
  for (const [c, n] of counts) {
    if (c === "other") continue;
    if (n > bestN) {
      best = c;
      bestN = n;
    }
  }
  if (best) return best;
  for (const [c, n] of counts) {
    if (n > bestN) {
      best = c;
      bestN = n;
    }
  }
  return best;
}

function collectDoNotRepeatStrings(args: {
  coachingMemory?: DeriveSmsPatternSignalArgs["coachingMemory"];
}): string[] {
  const out: string[] = [];
  const raw = args.coachingMemory?.do_not_repeat_phrases;
  if (Array.isArray(raw)) {
    for (const p of raw) {
      if (typeof p === "string" && p.trim()) out.push(p.trim());
      else if (p && typeof p === "object" && "phrase" in p) {
        const phrase = (p as { phrase?: unknown }).phrase;
        if (typeof phrase === "string" && phrase.trim()) out.push(phrase.trim());
      }
    }
  }
  const summary = (args.coachingMemory?.coaching_summary ?? "").trim();
  if (summary) out.push(summary);
  return out;
}

function isMentionSuppressedByDoNotRepeat(args: {
  doNotRepeatKey: string | null;
  doNotRepeatStrings: string[];
  nowMs: number;
}): boolean {
  const { doNotRepeatKey, doNotRepeatStrings } = args;
  const combined = doNotRepeatStrings.join(" ").toLowerCase();
  if (doNotRepeatKey && combined.includes(doNotRepeatKey.toLowerCase())) return true;
  if (doNotRepeatKey && combined.includes(`repeated_${doNotRepeatKey.replace(/^repeated_/, "")}`)) {
    return true;
  }
  if (/repeated_[a-z_]+_prompt/.test(combined)) {
    if (doNotRepeatKey && combined.includes(doNotRepeatKey)) return true;
  }
  const mentionAt = combined.match(/pattern_mention_at=(\d{4}-\d{2}-\d{2})/i);
  if (mentionAt) {
    const t = new Date(mentionAt[1]!).getTime();
    if (Number.isFinite(t) && args.nowMs - t < 5 * MS_DAY) return true;
  }
  return false;
}

export type DeriveSmsPatternSignalArgs = {
  eventsNewestFirst: V2EventRowForAi[];
  coachingMemory?: {
    latest_blocker_preview?: string | null;
    blocker_tags?: string[] | null;
    do_not_repeat_phrases?: Array<string | { phrase?: string }> | null;
    coaching_summary?: string | null;
  } | null;
  patRead?: {
    pattern_text?: string | null;
    pattern_confidence?: string | null;
  } | null;
  inboundRaw?: string | null;
  nowMs?: number;
};

export function deriveSmsPatternSignal(args: DeriveSmsPatternSignalArgs): SmsPatternSignalResult {
  const nowMs = args.nowMs ?? Date.now();
  const inbound = (args.inboundRaw ?? "").trim();
  const hits = collectBlockerHits(args.eventsNewestFirst);
  const explicitPhrase = EXPLICIT_RECURRENCE_RE.test(inbound);
  const userCorrection = USER_CORRECTION_RE.test(inbound);

  const patText = (args.patRead?.pattern_text ?? "").trim();
  const patConf = normalizePatConfidence(args.patRead?.pattern_confidence);
  const patAuthoritative = Boolean(patText && (patConf === "medium" || patConf === "high"));

  let canonical: SmsPatternCanonical | null = dominantCanonical(hits, nowMs);
  if (!canonical) {
    canonical =
      normalizeSmsPatternSignalText(args.coachingMemory?.latest_blocker_preview) ??
      canonicalFromTags(args.coachingMemory?.blocker_tags) ??
      (inbound ? normalizeSmsPatternSignalText(inbound) : null);
  }

  if (patAuthoritative) {
    canonical = normalizeSmsPatternSignalText(patText) ?? canonical ?? "other";
  }

  const count14d = canonical ? countCanonicalInWindow(hits, canonical, 14, nowMs) : 0;
  const count21d = canonical ? countCanonicalInWindow(hits, canonical, 21, nowMs) : 0;

  let confidence: SmsPatternConfidence = "low";
  let source: SmsPatternSignalSource = "none";

  const weakMemoryOnly =
    count14d === 0 &&
    count21d === 0 &&
    Boolean(args.coachingMemory?.latest_blocker_preview?.trim());
  const totalBlockerSignals = count21d > 0 ? count21d : weakMemoryOnly ? 1 : 0;

  if (patConf === "high") {
    confidence = "high";
    source = "pat_read";
  } else if (count21d >= 3) {
    confidence = "high";
    source = "events";
  } else if (
    canonical &&
    count14d >= 2 &&
    countOutcomesAfterFirstBlocker(args.eventsNewestFirst, canonical, hits, nowMs) >= 2
  ) {
    confidence = "high";
    source = "events";
  } else if (explicitPhrase && canonical) {
    confidence = "medium";
    source = "explicit_user_phrase";
  } else if (count14d >= 2) {
    confidence = "medium";
    source = "events";
  } else if (patConf === "medium") {
    confidence = "medium";
    source = "pat_read";
  } else if (totalBlockerSignals <= 1) {
    confidence = "low";
    source = totalBlockerSignals === 1 ? "events" : "none";
  }

  if (!canonical) {
    return {
      canonical: null,
      count14d: 0,
      count21d: 0,
      confidence: "low",
      mentionAllowed: false,
      internalHint: null,
      gentleUserLine: null,
      doNotRepeatKey: null,
      source: "none",
    };
  }

  const doNotRepeatKey = `repeated_${canonical}_prompt`;
  const doNotRepeatStrings = collectDoNotRepeatStrings(args);

  let mentionAllowed = confidence === "medium" || confidence === "high";
  if (userCorrection) mentionAllowed = false;
  if (canonical === "other" && !explicitPhrase) mentionAllowed = false;
  if (isMentionSuppressedByDoNotRepeat({ doNotRepeatKey, doNotRepeatStrings, nowMs })) {
    mentionAllowed = false;
  }

  let gentleUserLine: string | null = null;
  if (patAuthoritative) {
    gentleUserLine = null;
    if (patConf === "high" || patConf === "medium") {
      mentionAllowed = false;
    }
  } else if (mentionAllowed) {
    gentleUserLine = GENTLE_LINES[canonical];
  }

  let internalHint: string | null = null;
  if (confidence !== "low" || count14d > 0) {
    internalHint = `${confidence} pattern signal: ${canonical} appeared ${count14d} times in 14d`;
    if (patAuthoritative) internalHint += "; pat_read_authoritative";
  }

  if (patAuthoritative && source === "none") source = "pat_read";

  return {
    canonical,
    count14d,
    count21d,
    confidence,
    mentionAllowed,
    internalHint,
    gentleUserLine,
    doNotRepeatKey,
    source,
  };
}

/** True when canonical recurrence is strong enough for repeated_blocker_pattern purpose (not raw count alone). */
export function smsPatternRecurrenceEligibleForDailyPurpose(signal: SmsPatternSignalResult): boolean {
  if (!signal.canonical) return false;
  return (
    signal.confidence === "medium" ||
    signal.confidence === "high" ||
    signal.count14d >= 2 ||
    signal.source === "explicit_user_phrase"
  );
}

/** Minimal V3 lane guardrail for pattern_signal_* facts. */
export function buildSmsPatternSignalLaneGuardrails(): string {
  return `
PATTERN_SIGNAL (when present on v2_accountability): grounded background only — not a diagnosis.
- Mention a pattern only when pattern_mention_allowed is true.
- Do not quote raw blocker text; use pattern_internal_hint as machine context only.
- Do not repeat the same pattern every day; honor do-not-repeat keys in memory.
- If Coach Pat's Read already has a pattern in victory_background, do not contradict it.
- Current Goal / effective ask remains primary.`;
}
