// src/lib/daily-coach-pat-engine.ts

import { generateCoachPatNote } from "@/lib/coach-pat-generator";
import { resolveDailyPracticeForUser } from "@/lib/resolve-daily-practice";
import {
  getCachedCoachPatDailyNote,
  saveCoachPatDailyNote,
} from "@/lib/coach-pat-daily-note-store";

export type DailyCoachPatEngineResult =
  | { ok: true; note: string; dayNumber: number; cached: boolean }
  | { ok: false; reason: string };

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

/**
 * ======================================================
 * Mojibake Fix
 * ======================================================
 * Prevents: youâ€™re / itâ€™s / etc
 */
function fixMojibake(input: string): string {
  if (!input) return "";
  return input
    .replaceAll("â€™", "’")
    .replaceAll("â€˜", "‘")
    .replaceAll("â€œ", "“")
    .replaceAll("â€�", "”")
    .replaceAll("â€“", "–")
    .replaceAll("â€”", "—")
    .replaceAll("Â", "");
}

/**
 * ======================================================
 * Daily Coach Pat Engine (CANONICAL)
 * ======================================================
 *
 * - Resolves the canonical practice for a day
 * - Returns the SAME note every time for a given user + day
 * - Persists note to Supabase so refresh/SMS/API cannot diverge
 *
 * IMPORTANT:
 * This engine does NOT decide whether to send SMS.
 * It only produces the message (cached) for a day.
 */
export async function generateDailyCoachPatMessage({
  userId,
  dayNumber,
}: {
  userId: string;
  dayNumber?: number; // optional override
}): Promise<DailyCoachPatEngineResult> {
  let practice;

  // --------------------------------------------------
  // Resolve canonical practice (single source of truth)
  // --------------------------------------------------
  try {
    practice = await resolveDailyPracticeForUser(userId, dayNumber);
  } catch (err) {
    console.error("Daily coach engine resolver failed:", err);
    return { ok: false, reason: "resolver_failed" };
  }

  const canonicalDay = practice.currentDay;

  // --------------------------------------------------
  // 1) Cache read (return immediately if present)
  // --------------------------------------------------
  try {
    const cached = await getCachedCoachPatDailyNote({
      userId,
      dayNumber: canonicalDay,
    });

    if (cached) {
      return { ok: true, note: cached, dayNumber: canonicalDay, cached: true };
    }
  } catch (err) {
    // Fail open: if cache read fails, we can still generate.
    console.error("Daily coach engine cache read failed:", err);
  }

  // --------------------------------------------------
  // 2) Generate (once)
  // --------------------------------------------------
  try {
    const raw = await generateCoachPatNote({
      userId,
      dayNumber: canonicalDay,
      actionItem: practice.actionItem,
    });

    const note = normalizeText(fixMojibake(raw));

    if (!note) {
      return { ok: false, reason: "generation_failed" };
    }

    // --------------------------------------------------
    // 3) Persist (best-effort but strongly preferred)
    // --------------------------------------------------
    const saved = await saveCoachPatDailyNote({
      userId,
      dayNumber: canonicalDay,
      noteText: note,
    });

    // If save fails, we still return the note (don’t break UX),
    // but caching won’t work until DB is healthy.
    if (!saved) {
      console.error("Daily coach engine cache save failed");
    }

    return { ok: true, note, dayNumber: canonicalDay, cached: false };
  } catch (err) {
    console.error("Daily coach engine generation failed:", err);
    return { ok: false, reason: "generation_failed" };
  }
}
