// src/lib/get-or-create-daily-coach-pat-note.ts

import { supabaseServer } from "@/lib/supabase-server";
import { generateCoachPatNote } from "@/lib/coach-pat-generator";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";

type Params = {
  userId: string;
  dayNumber: number;
};

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

/**
 * ======================================================
 * Daily Coach Pat Note Store (CANONICAL)
 * ======================================================
 *
 * Goal:
 * - App + SMS MUST get the exact same note for the same day.
 * - A refresh must never regenerate a new note.
 *
 * Key:
 * - day_key is computed in the USER'S timezone (not UTC).
 */
export async function getOrCreateDailyCoachPatNote({
  userId,
  dayNumber,
}: Params): Promise<{ noteText: string; dayKey: string; dayNumber: number }> {
  // --------------------------------------------------
  // 1) Determine user's local day_key
  // --------------------------------------------------
  const md = await getClerkPublicMetadata(userId);
  const timezone = resolveUserTimezone(md?.timezone);

  const now = new Date();
  const dayKey = getDateKeyInTimezone(now, timezone);

  // --------------------------------------------------
  // 2) Check if note already exists for this day_key
  // --------------------------------------------------
  const { data: existing } = await supabaseServer
    .from("coach_pat_daily_notes")
    .select("note_text, day_number")
    .eq("clerk_user_id", userId)
    .eq("day_key", dayKey)
    .maybeSingle();

  if (existing?.note_text) {
    return {
      noteText: normalizeText(existing.note_text),
      dayKey,
      dayNumber:
        typeof existing.day_number === "number" ? existing.day_number : dayNumber,
    };
  }

  // --------------------------------------------------
  // 3) Generate new note
  // --------------------------------------------------
  const note = await generateCoachPatNote({
    userId,
    dayNumber,
    actionItem: "", // generator resolves internally
  });

  const safeNote = normalizeText(note);

  // --------------------------------------------------
  // 4) Persist (idempotent)
  // --------------------------------------------------
  const { error: insertError } = await supabaseServer
    .from("coach_pat_daily_notes")
    .insert({
      clerk_user_id: userId,
      day_number: dayNumber,
      day_key: dayKey,
      note_text: safeNote,
      model: "gpt-4.1-mini",
    });

  // If insert failed (race, constraint), fetch again and return canonical
  if (insertError) {
    const { data: afterInsert } = await supabaseServer
      .from("coach_pat_daily_notes")
      .select("note_text, day_number")
      .eq("clerk_user_id", userId)
      .eq("day_key", dayKey)
      .maybeSingle();

    if (afterInsert?.note_text) {
      return {
        noteText: normalizeText(afterInsert.note_text),
        dayKey,
        dayNumber:
          typeof afterInsert.day_number === "number"
            ? afterInsert.day_number
            : dayNumber,
      };
    }

    // Fallback: return generated note anyway
    console.error("COACH PAT NOTE INSERT ERROR:", insertError);
  }

  return { noteText: safeNote, dayKey, dayNumber };
}
