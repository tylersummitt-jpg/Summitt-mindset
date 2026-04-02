// src/lib/training-camp-tone.ts

import type { StalenessLevel } from "@/lib/get-user-staleness";

/**
 * Deterministic, calm tone adjustments for Training Camp when a user is idle.
 * No guilt, no streak talk, no "you missed X days."
 */
export function getTrainingCampToneLine({
  stalenessLevel,
  dayNumber,
  isNeverStartedUser,
}: {
  stalenessLevel: StalenessLevel;
  dayNumber: number;
  isNeverStartedUser: boolean;
}): string | null {
  if (isNeverStartedUser) return null;

  // Never apply staleness tone on Day 1
  if (dayNumber === 1) return null;

  // Keep "fresh" exactly as current behavior (so we don't change baseline tone).
  if (stalenessLevel === "fresh") return null;

  // Days 1–14: slightly stronger re-entry support (still calm).
  if (dayNumber <= 14 && stalenessLevel === "long_idle") {
    return "Starting again is strength. One small step.";
  }

  if (stalenessLevel === "short_idle") {
    return "You don’t need to catch up. Just take this one small.";
  }

  if (stalenessLevel === "medium_idle") {
    return "You’re still here. That matters. Let’s keep it simple today.";
  }

  // long_idle
  return "No pressure. No rush. Just one small step forward.";
}

export function getTrainingCampReflectionAddOn({
  stalenessLevel,
  isNeverStartedUser,
}: {
  stalenessLevel: StalenessLevel;
  isNeverStartedUser: boolean;
}): string | null {
  if (isNeverStartedUser) return null;

  // Preserve current add-on for fresh so behavior remains consistent for active users.
  if (stalenessLevel === "fresh") {
    return "What is one small way you can approach this differently today?";
  }

  if (stalenessLevel === "short_idle") {
    return "What made this harder to start?";
  }

  if (stalenessLevel === "medium_idle") {
    return "What would make this feel lighter today?";
  }

  // long_idle
  return "If this were easy, what would you do?";
}