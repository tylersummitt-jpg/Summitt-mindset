/**
 * User-facing Current Goal / season goal labels.
 * Law: behavior_statement only — never fall back to legacy commitment title.
 */

export const USER_FACING_GOAL_UNAVAILABLE = "Goal unavailable";

export function formatUserFacingGoal(args: {
  behaviorStatement?: string | null;
}): string {
  const behavior =
    typeof args.behaviorStatement === "string" ? args.behaviorStatement.trim() : "";
  if (behavior) return behavior;
  return USER_FACING_GOAL_UNAVAILABLE;
}
