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
