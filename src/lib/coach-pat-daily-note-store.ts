// src/lib/coach-pat-daily-note-store.ts

import { supabaseServer } from "@/lib/supabase-server";

export type CoachPatDailyNoteRow = {
  clerk_user_id: string;
  day_number: number;
  note_text: string;
  created_at?: string;
  updated_at?: string;
};

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

export async function getCachedCoachPatDailyNote({
  userId,
  dayNumber,
}: {
  userId: string;
  dayNumber: number;
}): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("coach_pat_daily_notes")
    .select("note_text")
    .eq("clerk_user_id", userId)
    .eq("day_number", dayNumber)
    .maybeSingle();

  if (error) {
    console.error("CoachPatDailyNote get cache error:", error);
    return null;
  }

  const txt = normalizeText(data?.note_text ?? "");
  return txt || null;
}

export async function saveCoachPatDailyNote({
  userId,
  dayNumber,
  noteText,
}: {
  userId: string;
  dayNumber: number;
  noteText: string;
}): Promise<boolean> {
  const cleaned = normalizeText(noteText);
  if (!cleaned) return false;

  const { error } = await supabaseServer.from("coach_pat_daily_notes").upsert(
    {
      clerk_user_id: userId,
      day_number: dayNumber,
      note_text: cleaned,
    },
    { onConflict: "clerk_user_id,day_number" }
  );

  if (error) {
    console.error("CoachPatDailyNote save error:", error);
    return false;
  }

  return true;
}
