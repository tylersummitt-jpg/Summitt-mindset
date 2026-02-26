import { supabaseServer } from "@/lib/supabase-server";
import { resolveTrainingCampDay } from "@/lib/training-camp-resolver";
import { selectInSeasonActionForDay, inSeasonPromptId } from "@/lib/in-season-selector";
import { generateInSeasonReflectionPrompt } from "@/lib/in-season-reflection-generator";
import { trainingCampPromptId } from "@/lib/prompt-ids";

function cleanText(input: string): string {
  return (input || "").trim();
}

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
  if (dayNumber <= 30) {
    const practice = await resolveTrainingCampDay({
      dayNumber,
      trainingCampTrack,
    });

    const actionItem = cleanText(practice.action_item);
    const reflectionPrompt = cleanText(practice.reflection_prompt);

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

  const existing = await supabaseServer
    .from("daily_prompts")
    .select("action_item, reflection_prompt, source")
    .eq("clerk_user_id", userId)
    .eq("day_number", dayNumber)
    .maybeSingle();

  if (existing.data?.action_item && existing.data?.reflection_prompt) {
    return {
      promptId: inSeasonPromptId(dayNumber),
      actionItem: cleanText(existing.data.action_item),
      reflectionPrompt: cleanText(existing.data.reflection_prompt),
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
        action_item: cleanText(action.text),
        reflection_prompt: cleanText(reflectionPrompt),
        source: "generated",
      },
      { onConflict: "clerk_user_id,day_number" }
    );

  if (error) throw new Error("Failed to ensure daily prompt (in-season)");

  return {
    promptId,
    actionItem: cleanText(action.text),
    reflectionPrompt: cleanText(reflectionPrompt),
  };
}