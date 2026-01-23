import { IN_SEASON_ACTIONS } from "@/lib/in-season-actions";

/**
 * Deterministic per-user ordering:
 * - No repeats for 120 completed days
 * - Same user always gets the same “season order”
 */
function stableHash(input: string): number {
  // Simple, fast, stable hash (djb2)
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return Math.abs(hash);
}

export function selectInSeasonActionForDay(userId: string, dayNumber: number) {
  if (dayNumber < 31) {
    throw new Error("selectInSeasonActionForDay called for Training Camp day.");
  }

  const offset = stableHash(userId) % IN_SEASON_ACTIONS.length;
  const idx = (offset + (dayNumber - 31)) % IN_SEASON_ACTIONS.length;

  return IN_SEASON_ACTIONS[idx];
}

/**
 * Deterministic promptId for In-Season days.
 * Stable, DB-independent.
 */
export function inSeasonPromptId(dayNumber: number): string {
  return `is-day-${dayNumber}`;
}
