// src/lib/get-user-staleness.ts

import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";

export type StalenessLevel =
  | "fresh"        // completed today or yesterday
  | "short_idle"   // 2–3 days
  | "medium_idle"  // 4–7 days
  | "long_idle";   // 8+ days (or unknown)

/**
 * Compute staleness based on lastCompletedAt (Clerk publicMetadata) and user's timezone.
 * This is intentionally deterministic and non-LLM.
 */
export function getUserStalenessLevel({
  timezoneFromMetadata,
  lastCompletedAt,
  now = new Date(),
}: {
  timezoneFromMetadata?: unknown;
  lastCompletedAt?: unknown;
  now?: Date;
}): { level: StalenessLevel; idleDays: number } {
  const timezone = resolveUserTimezone(
    typeof timezoneFromMetadata === "string" ? timezoneFromMetadata : undefined
  );

  const todayKey = getDateKeyInTimezone(now, timezone);

  // If we have no lastCompletedAt, treat as long idle.
  if (typeof lastCompletedAt !== "string" || !lastCompletedAt.trim()) {
    return { level: "long_idle", idleDays: 999 };
  }

  const last = new Date(lastCompletedAt);
  if (Number.isNaN(last.getTime())) {
    return { level: "long_idle", idleDays: 999 };
  }

  const lastKey = getDateKeyInTimezone(last, timezone);

  const idleDays = dateKeyDiffInDays(todayKey, lastKey);

  // Guard: if timestamps are weird (future), clamp to fresh.
  if (idleDays <= 1) return { level: "fresh", idleDays: Math.max(0, idleDays) };
  if (idleDays <= 3) return { level: "short_idle", idleDays };
  if (idleDays <= 7) return { level: "medium_idle", idleDays };
  return { level: "long_idle", idleDays };
}

/**
 * Returns (a - b) in whole days, where a and b are YYYY-MM-DD.
 * We convert to UTC-midnight dates to do stable integer math.
 */
function dateKeyDiffInDays(a: string, b: string): number {
  const aUTC = dateKeyToUtcMidnight(a);
  const bUTC = dateKeyToUtcMidnight(b);
  if (!aUTC || !bUTC) return 999;

  const diffMs = aUTC.getTime() - bUTC.getTime();
  return Math.floor(diffMs / 86_400_000);
}

function dateKeyToUtcMidnight(key: string): Date | null {
  // key expected "YYYY-MM-DD"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const d = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}