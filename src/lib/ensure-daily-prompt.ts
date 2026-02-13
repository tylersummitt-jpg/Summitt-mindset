import { supabaseServer } from "@/lib/supabase-server";
import { resolveTrainingCampDay } from "@/lib/training-camp-resolver";
import { selectInSeasonActionForDay, inSeasonPromptId } from "@/lib/in-season-selector";
import { generateInSeasonReflectionPrompt } from "@/lib/in-season-reflection-generator";
import { trainingCampPromptId } from "@/lib/prompt-ids";

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

/**
 * Ensures daily_prompts has the canonical prompt for the given day.
 * App + SMS share this.
 */
export async function ensureDailyPrompt({
  userId,
  dayNumber,
  trainingCampTrack,
  primaryGoal,
}: {
  userId: string;
  dayNumber: number;
  trainingCampTrack: "standard" | "women";
  primaryGoal?: string;
}) {
  // --------------------------------------------------
  // TRAINING CAMP (1–30)
  // --------------------------------------------------
  if (dayNumber <= 30) {
    const practice = await resolveTrainingCampDay({
      dayNumber,
      trainingCampTrack,
    });

    const actionItem = normalizeText(practice.action_item);
    const reflectionPrompt = normalizeText(practice.reflection_prompt);

    const promptId = trainingCampPromptId(dayNumber);

    const { error } = await supabaseServer
      .from("daily_prompts")
      .upsert(
        {
          clerk_user_id: userId,
          day_number: dayNumber,
          action_item: actionItem,
          reflection_prompt: reflectionPrompt,
          source: "training_camp",
        },
        { onConflict: "clerk_user_id,day_number" }
      );

    if (error) throw new Error("Failed to ensure daily prompt (training camp)");

    return { promptId, actionItem, reflectionPrompt };
  }

  // --------------------------------------------------
  // IN-SEASON (31+)
  // --------------------------------------------------
  // If it already exists, use it (immutability).
  const existing = await supabaseServer
    .from("daily_prompts")
    .select("action_item, reflection_prompt, source")
    .eq("clerk_user_id", userId)
    .eq("day_number", dayNumber)
    .maybeSingle();

  if (existing.data?.action_item && existing.data?.reflection_prompt) {
    return {
      promptId: inSeasonPromptId(dayNumber),
      actionItem: normalizeText(existing.data.action_item),
      reflectionPrompt: normalizeText(existing.data.reflection_prompt),
    };
  }

  const action = selectInSeasonActionForDay(userId, dayNumber);

  const reflectionPrompt = await generateInSeasonReflectionPrompt({
    userId,
    dayNumber,
    actionText: action.text,
    primaryGoal,
  });

  const promptId = inSeasonPromptId(dayNumber);

  const { error } = await supabaseServer
    .from("daily_prompts")
    .upsert(
      {
        clerk_user_id: userId,
        day_number: dayNumber,
        action_item: normalizeText(action.text),
        reflection_prompt: normalizeText(reflectionPrompt),
        source: "generated",
      },
      { onConflict: "clerk_user_id,day_number" }
    );

  if (error) throw new Error("Failed to ensure daily prompt (in-season)");

  return {
    promptId,
    actionItem: normalizeText(action.text),
    reflectionPrompt: normalizeText(reflectionPrompt),
  };
}
