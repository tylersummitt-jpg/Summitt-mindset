// src/lib/get-or-create-daily-coach-pat-note.ts

import { supabaseServer } from "@/lib/supabase-server";
import { generateCoachPatNote } from "@/lib/coach-pat-generator";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { getOrCreateDailyPracticeVersion } from "@/lib/get-or-create-daily-practice-version";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

export async function getOrCreateDailyCoachPatNote({
  userId,
  dayNumber,
}: {
  userId: string;
  dayNumber: number;
}) {
  const md = await getClerkPublicMetadata(userId);
  const timezone = resolveUserTimezone(md?.timezone);

  const now = new Date();
  const dayKey = getDateKeyInTimezone(now, timezone);

  // Use TODAY's rotating practice version as the input signal for the coach note.
  // This keeps Coach Pat aligned with what the user actually sees today.
  const version = await getOrCreateDailyPracticeVersion({
    userId,
    dayNumber,
  });

  const generated = await generateCoachPatNote({
    userId,
    dayNumber,
    actionItem: version.actionItem,
  });

  const safeNote = normalizeText(generated.text);

  const { error: insertError } = await supabaseServer
    .from("coach_pat_daily_notes")
    .insert({
      clerk_user_id: userId,
      day_number: dayNumber,
      day_key: dayKey,
      note_text: safeNote,
      staleness_mode: generated.stalenessMode,
      simplicity_passed: generated.simplicityPassed,
      generation_attempts: generated.attempts,
      model: generated.model,
    });

  // If a race occurs (two requests in the same moment), unique constraint may fire.
  // In that case, just load and return the existing one.
  if (insertError) {
    const code = (insertError as any)?.code;
    if (code === "23505") {
      const { data: raced, error: racedError } = await supabaseServer
        .from("coach_pat_daily_notes")
        .select("*")
        .eq("clerk_user_id", userId)
        .eq("day_key", dayKey)
        .maybeSingle();

      if (racedError) {
        throw new Error(
          `CoachPatDailyNote: failed to load raced note: ${racedError.message}`
        );
      }

      // Always return a valid note: use existing row or calm fallback if data missing.
      return {
        noteText: raced?.note_text
          ? normalizeText(raced.note_text)
          : "Keep it simple today. Show up. Hold the standard in small moments.",
        dayKey,
        dayNumber: raced?.day_number ?? dayNumber,
      };
    }

    throw new Error(
      `CoachPatDailyNote: failed to insert note: ${insertError.message}`
    );
  }

  return { noteText: safeNote, dayKey, dayNumber };
}