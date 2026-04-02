/**
 * Clerk publicMetadata guardrails for completion state.
 * Does not compute staleness; only detects "no successful completeDay yet."
 */

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function hasValidLastCompletedAt(lastCompletedAt: unknown): boolean {
  if (typeof lastCompletedAt !== "string" || !lastCompletedAt.trim()) return false;
  return !Number.isNaN(new Date(lastCompletedAt).getTime());
}

export function isNeverStarted(metadata: {
  totalDaysCompleted?: unknown;
  lastCompletedAt?: unknown;
}): boolean {
  return (
    numberOrZero(metadata.totalDaysCompleted) === 0 &&
    !hasValidLastCompletedAt(metadata.lastCompletedAt)
  );
}
