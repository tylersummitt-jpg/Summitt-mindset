/**
 * ======================================================
 * Prompt ID Helpers (CANONICAL)
 * ======================================================
 *
 * Centralizes ID generation so it can’t drift across files.
 */

export function trainingCampPromptId(day: number): string {
  return `tc-day-${day}`;
}
