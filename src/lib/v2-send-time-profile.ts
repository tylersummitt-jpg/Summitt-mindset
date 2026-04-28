/**
 * V2 learned send-time profile: user-scoped, rule-derived.
 * Windows are local wall-clock in the user's IANA timezone.
 *
 * Window definitions (inclusive local hour on the hour hand from getLocalHourInTimezone):
 * - morning:    6–10
 * - midday:     11–14
 * - afternoon:  15–18
 * - evening:    19–23  (19–22 would miss late-night replies; 23 keeps one broad “PM” bucket)
 *
 * Hours 0–5: outside buckets — inbound signals in those hours do not increment counts.
 *
 * Confidence (deterministic):
 * - Let total = sum of reply counts, max = largest bucket count.
 * - If total < MIN_TOTAL_REPLIES_FOR_CONFIDENCE OR max < MIN_LEADING_BUCKET_REPLIES → confidence = 0.
 * - Else confidence = max / total (real in (0, 1]).
 *
 * preferred_window is always the argmax bucket; ties break in order morning < midday < afternoon < evening.
 *
 * daily-sms uses learned gating only when confidence >= LEARNED_CONFIDENCE_GATE_THRESHOLD (see shouldUseLearnedSendTimeGate).
 *
 * Weak no-reply (V2 accountability only, elsewhere):
 * - Per-window counters `weak_no_reply_*` are small non-negative integers (capped in app).
 * - Recompute applies a slow damp: effective_reply[w] = max(0, reply[w] - floor(weak[w] * WEAK_NO_REPLY_FRACTION)).
 *   At WEAK_NO_REPLY_FRACTION = 0.22, ~5 capped weak steps remove ~1 reply equivalent from that bucket before
 *   argmax/total (positives stay primary; preferred_window does not flip from one weak alone).
 */

import { supabaseServer } from "@/lib/supabase-server";
import { resolveUserTimezone } from "@/lib/timezone";

export type V2SendTimeWindow = "morning" | "midday" | "afternoon" | "evening";

export const LEARNED_CONFIDENCE_GATE_THRESHOLD = 0.55;

/** Need enough total replies before trusting the ratio. */
export const MIN_TOTAL_REPLIES_FOR_CONFIDENCE = 5;

/** Leading bucket must have enough mass vs noise. */
export const MIN_LEADING_BUCKET_REPLIES = 3;

/** Weak negatives map to reply equivalents slowly (~5 weak steps ≈ 1 reply removed at cap). */
export const WEAK_NO_REPLY_FRACTION = 0.22;

/** Do not accumulate weak negatives beyond this per window (stability). */
export const WEAK_NO_REPLY_CAP_PER_WINDOW = 12;

const WINDOW_ORDER: readonly V2SendTimeWindow[] = [
  "morning",
  "midday",
  "afternoon",
  "evening",
] as const;

export type V2UserSendTimeProfileRow = {
  clerk_user_id: string;
  preferred_window: V2SendTimeWindow;
  confidence: number;
  reply_count_morning: number;
  reply_count_midday: number;
  reply_count_afternoon: number;
  reply_count_evening: number;
  weak_no_reply_morning: number;
  weak_no_reply_midday: number;
  weak_no_reply_afternoon: number;
  weak_no_reply_evening: number;
  updated_at: string;
};

/** Local hour (0–23) in `timeZone` for instant `at`. */
export function getLocalHourInTimezone(at: Date, timeZone: string): number {
  const tz = resolveUserTimezone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  }).formatToParts(at);
  const hourPart = parts.find((p) => p.type === "hour");
  const h = hourPart ? parseInt(hourPart.value, 10) : NaN;
  return Number.isFinite(h) ? h : 0;
}

/**
 * Map local hour to send window; null if outside learnable buckets (0–5).
 */
export function localHourToSendWindow(hour: number): V2SendTimeWindow | null {
  if (hour >= 6 && hour <= 10) return "morning";
  if (hour >= 11 && hour <= 14) return "midday";
  if (hour >= 15 && hour <= 18) return "afternoon";
  if (hour >= 19 && hour <= 23) return "evening";
  return null;
}

export function countsFromRow(row: {
  reply_count_morning: number;
  reply_count_midday: number;
  reply_count_afternoon: number;
  reply_count_evening: number;
}): Record<V2SendTimeWindow, number> {
  return {
    morning: row.reply_count_morning,
    midday: row.reply_count_midday,
    afternoon: row.reply_count_afternoon,
    evening: row.reply_count_evening,
  };
}

function recomputePreferredWindowAndConfidenceFromEffectiveCounts(counts: Record<V2SendTimeWindow, number>): {
  preferred_window: V2SendTimeWindow;
  confidence: number;
} {
  let best: V2SendTimeWindow = "morning";
  let max = -1;
  for (const w of WINDOW_ORDER) {
    const c = counts[w];
    if (c > max) {
      max = c;
      best = w;
    } else if (c === max) {
      const prevIdx = WINDOW_ORDER.indexOf(best);
      const curIdx = WINDOW_ORDER.indexOf(w);
      if (curIdx < prevIdx) best = w;
    }
  }
  const total = WINDOW_ORDER.reduce((s, w) => s + counts[w], 0);
  if (total === 0) {
    return { preferred_window: "morning", confidence: 0 };
  }
  if (total < MIN_TOTAL_REPLIES_FOR_CONFIDENCE || max < MIN_LEADING_BUCKET_REPLIES) {
    return { preferred_window: best, confidence: 0 };
  }
  return { preferred_window: best, confidence: max / total };
}

/** Reply-only baseline (no weak damp). */
export function recomputePreferredWindowAndConfidence(row: {
  reply_count_morning: number;
  reply_count_midday: number;
  reply_count_afternoon: number;
  reply_count_evening: number;
}): { preferred_window: V2SendTimeWindow; confidence: number } {
  return recomputePreferredWindowAndConfidenceFromEffectiveCounts(countsFromRow(row));
}

/**
 * Full learner: same thresholds as positive-only path, but each bucket uses
 * effective_reply = max(0, raw_reply - floor(weak * WEAK_NO_REPLY_FRACTION)).
 */
export function recomputePreferredWindowAndConfidenceWithWeakNoReply(row: {
  reply_count_morning: number;
  reply_count_midday: number;
  reply_count_afternoon: number;
  reply_count_evening: number;
  weak_no_reply_morning: number;
  weak_no_reply_midday: number;
  weak_no_reply_afternoon: number;
  weak_no_reply_evening: number;
}): { preferred_window: V2SendTimeWindow; confidence: number } {
  const replies: Record<V2SendTimeWindow, number> = {
    morning: toInt(row.reply_count_morning),
    midday: toInt(row.reply_count_midday),
    afternoon: toInt(row.reply_count_afternoon),
    evening: toInt(row.reply_count_evening),
  };
  const weaks: Record<V2SendTimeWindow, number> = {
    morning: toInt(row.weak_no_reply_morning),
    midday: toInt(row.weak_no_reply_midday),
    afternoon: toInt(row.weak_no_reply_afternoon),
    evening: toInt(row.weak_no_reply_evening),
  };
  const effective: Record<V2SendTimeWindow, number> = {
    morning: 0,
    midday: 0,
    afternoon: 0,
    evening: 0,
  };
  for (const w of WINDOW_ORDER) {
    const r = replies[w];
    const n = Math.min(WEAK_NO_REPLY_CAP_PER_WINDOW, weaks[w]);
    const penalty = Math.floor(n * WEAK_NO_REPLY_FRACTION);
    effective[w] = Math.max(0, r - penalty);
  }
  return recomputePreferredWindowAndConfidenceFromEffectiveCounts(effective);
}

export function shouldUseLearnedSendTimeGate(profile: V2UserSendTimeProfileRow): boolean {
  return profile.confidence >= LEARNED_CONFIDENCE_GATE_THRESHOLD;
}

/** True if local wall-clock (same basis as getLocalHourInTimezone) lies inside the preferred window span. */
export function isLocalTimeInPreferredWindow(
  localNow: Date,
  preferredWindow: V2SendTimeWindow
): boolean {
  const h = localNow.getHours();
  const w = localHourToSendWindow(h);
  return w === preferredWindow;
}

/**
 * For daily-sms: `localNow` is built via toLocaleString+Date in user TZ; its getHours() must match
 * getLocalHourInTimezone for consistency — callers should pass the same `localNow` used for legacy hour gate.
 */
export function isV2LearnedSendWindowAllowed(
  localNow: Date,
  preferredWindow: V2SendTimeWindow
): boolean {
  return isLocalTimeInPreferredWindow(localNow, preferredWindow);
}

export async function fetchV2UserSendTimeProfile(
  clerkUserId: string
): Promise<V2UserSendTimeProfileRow | null> {
  const { data, error } = await supabaseServer
    .from("v2_user_send_time_profile")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) {
    console.error("[v2-send-time-profile] fetch failed", { clerk_user_id: clerkUserId, message: error.message });
    return null;
  }
  if (!data) return null;
  return mapRow(data as Record<string, unknown>);
}

function mapRow(data: Record<string, unknown>): V2UserSendTimeProfileRow {
  const pw = data.preferred_window;
  const window: V2SendTimeWindow =
    pw === "midday" || pw === "afternoon" || pw === "evening" || pw === "morning" ? pw : "morning";

  return {
    clerk_user_id: String(data.clerk_user_id),
    preferred_window: window,
    confidence: typeof data.confidence === "number" && Number.isFinite(data.confidence) ? data.confidence : 0,
    reply_count_morning: toInt(data.reply_count_morning),
    reply_count_midday: toInt(data.reply_count_midday),
    reply_count_afternoon: toInt(data.reply_count_afternoon),
    reply_count_evening: toInt(data.reply_count_evening),
    weak_no_reply_morning: toInt(data.weak_no_reply_morning),
    weak_no_reply_midday: toInt(data.weak_no_reply_midday),
    weak_no_reply_afternoon: toInt(data.weak_no_reply_afternoon),
    weak_no_reply_evening: toInt(data.weak_no_reply_evening),
    updated_at: typeof data.updated_at === "string" ? data.updated_at : new Date().toISOString(),
  };
}

function toInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  return 0;
}

/**
 * Record one inbound engagement sample (V2 paths only). Safe to fire-and-forget; logs errors.
 */
export async function recordV2SendTimeProfileInboundEngagement(
  clerkUserId: string,
  timezone: string,
  at: Date = new Date()
): Promise<void> {
  try {
    const tz = resolveUserTimezone(timezone);
    const hour = getLocalHourInTimezone(at, tz);
    const bucket = localHourToSendWindow(hour);
    if (!bucket) return;

    const existing = await fetchV2UserSendTimeProfile(clerkUserId);
    const base = existing ?? {
      clerk_user_id: clerkUserId,
      preferred_window: "morning" as const,
      confidence: 0,
      reply_count_morning: 0,
      reply_count_midday: 0,
      reply_count_afternoon: 0,
      reply_count_evening: 0,
      weak_no_reply_morning: 0,
      weak_no_reply_midday: 0,
      weak_no_reply_afternoon: 0,
      weak_no_reply_evening: 0,
      updated_at: new Date().toISOString(),
    };

    const nextCounts = { ...countsFromRow(base) };
    nextCounts[bucket] += 1;

    const merged = {
      reply_count_morning: nextCounts.morning,
      reply_count_midday: nextCounts.midday,
      reply_count_afternoon: nextCounts.afternoon,
      reply_count_evening: nextCounts.evening,
      weak_no_reply_morning: base.weak_no_reply_morning,
      weak_no_reply_midday: base.weak_no_reply_midday,
      weak_no_reply_afternoon: base.weak_no_reply_afternoon,
      weak_no_reply_evening: base.weak_no_reply_evening,
    };
    const { preferred_window, confidence } = recomputePreferredWindowAndConfidenceWithWeakNoReply(merged);
    const nowIso = new Date().toISOString();

    const { error } = await supabaseServer.from("v2_user_send_time_profile").upsert(
      {
        clerk_user_id: clerkUserId,
        preferred_window,
        confidence,
        reply_count_morning: merged.reply_count_morning,
        reply_count_midday: merged.reply_count_midday,
        reply_count_afternoon: merged.reply_count_afternoon,
        reply_count_evening: merged.reply_count_evening,
        weak_no_reply_morning: merged.weak_no_reply_morning,
        weak_no_reply_midday: merged.weak_no_reply_midday,
        weak_no_reply_afternoon: merged.weak_no_reply_afternoon,
        weak_no_reply_evening: merged.weak_no_reply_evening,
        updated_at: nowIso,
      },
      { onConflict: "clerk_user_id" }
    );

    if (error) {
      console.error("[v2-send-time-profile] upsert failed", { clerk_user_id: clerkUserId, message: error.message });
    }
  } catch (e) {
    console.error("[v2-send-time-profile] recordV2SendTimeProfileInboundEngagement threw", {
      clerk_user_id: clerkUserId,
      e,
    });
  }
}

/**
 * Increment weak-no-reply counter for one send window (capped) and persist full profile row.
 * Used only after eligibility checks (V2 accountability day with no same-day outcome).
 */
export async function recordV2WeakNoReplyForSendWindow(
  clerkUserId: string,
  window: V2SendTimeWindow
): Promise<boolean> {
  try {
    const existing = await fetchV2UserSendTimeProfile(clerkUserId);
    const weak: Record<V2SendTimeWindow, number> = {
      morning: existing?.weak_no_reply_morning ?? 0,
      midday: existing?.weak_no_reply_midday ?? 0,
      afternoon: existing?.weak_no_reply_afternoon ?? 0,
      evening: existing?.weak_no_reply_evening ?? 0,
    };
    weak[window] = Math.min(WEAK_NO_REPLY_CAP_PER_WINDOW, weak[window] + 1);

    const merged = {
      reply_count_morning: existing?.reply_count_morning ?? 0,
      reply_count_midday: existing?.reply_count_midday ?? 0,
      reply_count_afternoon: existing?.reply_count_afternoon ?? 0,
      reply_count_evening: existing?.reply_count_evening ?? 0,
      weak_no_reply_morning: weak.morning,
      weak_no_reply_midday: weak.midday,
      weak_no_reply_afternoon: weak.afternoon,
      weak_no_reply_evening: weak.evening,
    };
    const { preferred_window, confidence } = recomputePreferredWindowAndConfidenceWithWeakNoReply(merged);
    const nowIso = new Date().toISOString();

    const { error } = await supabaseServer.from("v2_user_send_time_profile").upsert(
      {
        clerk_user_id: clerkUserId,
        preferred_window,
        confidence,
        reply_count_morning: merged.reply_count_morning,
        reply_count_midday: merged.reply_count_midday,
        reply_count_afternoon: merged.reply_count_afternoon,
        reply_count_evening: merged.reply_count_evening,
        weak_no_reply_morning: merged.weak_no_reply_morning,
        weak_no_reply_midday: merged.weak_no_reply_midday,
        weak_no_reply_afternoon: merged.weak_no_reply_afternoon,
        weak_no_reply_evening: merged.weak_no_reply_evening,
        updated_at: nowIso,
      },
      { onConflict: "clerk_user_id" }
    );

    if (error) {
      console.error("[v2-send-time-profile] weak no-reply upsert failed", {
        clerk_user_id: clerkUserId,
        message: error.message,
      });
      return false;
    }
    return true;
  } catch (e) {
    console.error("[v2-send-time-profile] recordV2WeakNoReplyForSendWindow threw", { clerk_user_id: clerkUserId, e });
    return false;
  }
}

/** One-line for AI context only (does not affect scheduling). */
export function formatReachabilityContextLine(profile: V2UserSendTimeProfileRow | null): string | null {
  if (!profile || !shouldUseLearnedSendTimeGate(profile)) return null;
  const c = Math.round(profile.confidence * 100) / 100;
  return `REACHABILITY: preferred_window=${profile.preferred_window} confidence=${c}`;
}
