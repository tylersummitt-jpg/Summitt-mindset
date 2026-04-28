/**
 * V2 earned cadence: rule-derived outbound spacing for daily-sms (V2 path only).
 *
 * Conflict rule (explicit): high-attention situations win over relaxed cadence —
 * silence nudge, high-attention next_move on latest check_sent, miss streaks,
 * re-entry, blocker/recovery strategies, and non–yes-led stability all force daily
 * before earned relax (every_other_day / every_3_days) can apply.
 */

import type { V2EventRowForAi } from "@/lib/v2-commitment";
import {
  deriveV2CoachingState,
  deriveV2ReentryContext,
  deriveV2SilenceContext,
  parseLatestCheckSentNextMoveType,
  pickV2OutboundStrategy,
} from "@/lib/v2-ai-outbound";

const USER_OUTCOMES = new Set(["user_yes", "user_no", "user_partial"]);
const MS_DAY = 86400000;

export type V2CadenceLevel = "daily" | "every_other_day" | "every_3_days";

export type V2CadencePayload = {
  level: V2CadenceLevel;
  reason_code: string;
  version: 1;
};

function eventTimeMs(iso: string): number {
  const n = new Date(iso).getTime();
  return Number.isFinite(n) ? n : 0;
}

function sortedEventsAsc(eventsNewestFirst: V2EventRowForAi[]): V2EventRowForAi[] {
  return [...eventsNewestFirst].sort(
    (a, b) => eventTimeMs(a.occurred_at) - eventTimeMs(b.occurred_at)
  );
}

function countOutcomeTypeSinceDays(
  asc: V2EventRowForAi[],
  nowMs: number,
  days: number,
  eventType: string
): number {
  const cutoff = nowMs - days * MS_DAY;
  let n = 0;
  for (const e of asc) {
    if (e.event_type !== eventType) continue;
    const te = eventTimeMs(e.occurred_at);
    if (te >= cutoff && te <= nowMs) n += 1;
  }
  return n;
}

function latestUserOutcomeType(eventsNewestFirst: V2EventRowForAi[]): string | null {
  const e = eventsNewestFirst.find((x) => USER_OUTCOMES.has(x.event_type));
  return e ? e.event_type : null;
}

/**
 * Whole calendar days from `fromDayKey` to `toDayKey` (local day_key strings YYYY-MM-DD).
 * UTC noon anchoring for deterministic day arithmetic (not clock-time jitter).
 */
export function wholeCalendarDaysBetweenDayKeys(fromDayKey: string, toDayKey: string): number {
  const a = new Date(`${fromDayKey}T12:00:00.000Z`).getTime();
  const b = new Date(`${toDayKey}T12:00:00.000Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  if (b < a) return 0;
  return Math.round((b - a) / MS_DAY);
}

/**
 * Derives additive check_sent.payload_json.cadence (level + reason_code + version).
 *
 * Force daily (checked in order; first match wins for reason_code):
 * - daily_force_silence_nudge — silence tier is nudge
 * - daily_force_high_attention_next_move — latest successful check_sent next_move is reset_day | shrink_ask
 * - daily_force_miss_pattern_14d — ≥2 user_no or ≥3 user_partial in rolling 14d
 * - daily_force_reentry_pressure — re-entry window active (daily pressure)
 * - daily_force_blocker_recovery_strategies — base outbound strategy is blocker_followup | recovery_check
 *
 * Relax (all required): latest accountability signal is yes-led (newest user_* is user_yes);
 * silence tier is not nudge; no high-attention next_move on latest check_sent; miss pattern below
 * threshold; not in re-entry pressure window; not blocker/recovery base strategy.
 * Then: relax_every_3_days_yes_clean_streak_14d if zero no/partial in 14d and ≥3 yes in 14d;
 * else relax_every_other_day_earned.
 *
 * Otherwise: daily_not_relaxed_yes_led_or_stability (daily, not yet earned lighter rhythm).
 */
export function deriveV2CadencePayload(args: {
  eventsNewestFirst: V2EventRowForAi[];
  now: Date;
  hasBlockerPreview: boolean;
}): V2CadencePayload {
  const { eventsNewestFirst, now, hasBlockerPreview } = args;
  const asc = sortedEventsAsc(eventsNewestFirst);
  const nowMs = now.getTime();

  const silence = deriveV2SilenceContext(eventsNewestFirst, now);
  const reentry = deriveV2ReentryContext(eventsNewestFirst, now);
  const serverState = deriveV2CoachingState(eventsNewestFirst);
  const baseStrategy = pickV2OutboundStrategy(serverState, hasBlockerPreview);
  const forceBlockerRecovery =
    baseStrategy === "blocker_followup" || baseStrategy === "recovery_check";

  const prevNext = parseLatestCheckSentNextMoveType(eventsNewestFirst);

  const no14 = countOutcomeTypeSinceDays(asc, nowMs, 14, "user_no");
  const partial14 = countOutcomeTypeSinceDays(asc, nowMs, 14, "user_partial");
  const yes14 = countOutcomeTypeSinceDays(asc, nowMs, 14, "user_yes");

  if (silence.tier === "nudge") {
    return { level: "daily", reason_code: "daily_force_silence_nudge", version: 1 };
  }
  if (prevNext === "reset_day" || prevNext === "shrink_ask") {
    return {
      level: "daily",
      reason_code: "daily_force_high_attention_next_move",
      version: 1,
    };
  }
  if (no14 >= 2 || partial14 >= 3) {
    return { level: "daily", reason_code: "daily_force_miss_pattern_14d", version: 1 };
  }
  if (reentry.active) {
    return { level: "daily", reason_code: "daily_force_reentry_pressure", version: 1 };
  }
  if (forceBlockerRecovery) {
    return {
      level: "daily",
      reason_code: "daily_force_blocker_recovery_strategies",
      version: 1,
    };
  }

  const latestUser = latestUserOutcomeType(eventsNewestFirst);
  const relaxYesLed = latestUser === "user_yes";
  const relaxMiss = no14 < 2 && partial14 < 3;
  // latest check_sent high-attention next_move already returned daily above
  const allRelax =
    relaxYesLed && relaxMiss && !reentry.active && !forceBlockerRecovery;

  if (!allRelax) {
    return {
      level: "daily",
      reason_code: "daily_not_relaxed_yes_led_or_stability",
      version: 1,
    };
  }

  const yesCleanStreak = no14 === 0 && partial14 === 0 && yes14 >= 3;
  if (yesCleanStreak) {
    return {
      level: "every_3_days",
      reason_code: "relax_every_3_days_yes_clean_streak_14d",
      version: 1,
    };
  }
  return {
    level: "every_other_day",
    reason_code: "relax_every_other_day_earned",
    version: 1,
  };
}

const MIN_DAYS: Record<V2CadenceLevel, number> = {
  daily: 1,
  every_other_day: 2,
  every_3_days: 3,
};

/**
 * Interval gating on local calendar day_key only (deterministic).
 * No prior successful V2 check_sent → send. Same day as last (delta 0) → do not send.
 */
export function shouldSendV2CadenceToday(args: {
  lastSuccessfulCheckSentDayKey: string | null;
  todayLocalDayKey: string;
  cadenceLevel: V2CadenceLevel;
}): boolean {
  const last = args.lastSuccessfulCheckSentDayKey;
  if (last == null || last.length === 0) return true;
  const delta = wholeCalendarDaysBetweenDayKeys(last, args.todayLocalDayKey);
  if (delta <= 0) return false;
  return delta >= MIN_DAYS[args.cadenceLevel];
}
