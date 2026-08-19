/**
 * Deterministic week key (YYYY-WW) — must stay aligned with weekly SMS dedupe.
 */
export function getWeekKey(local: Date) {
  const year = local.getFullYear();
  const firstJan = new Date(year, 0, 1);
  const pastDays = Math.floor(
    (local.getTime() - firstJan.getTime()) / 86400000
  );
  const weekNumber = Math.ceil((pastDays + firstJan.getDay() + 1) / 7);
  return `${year}-W${weekNumber}`;
}

/**
 * Same numbering as getWeekKey, applied to a civil YYYY-MM-DD (target Sunday).
 * Does not invent a second week system.
 */
export function getWeekKeyForLocalDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    throw new Error(`invalid_date_key:${dateKey}`);
  }
  return getWeekKey(new Date(y, m - 1, d, 12, 0, 0));
}
