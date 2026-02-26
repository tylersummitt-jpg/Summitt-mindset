// src/lib/resolve-daily-practice.ts

import { type TrainingCampTrack } from "@/lib/training-camp-resolver";
import { inSeasonPromptId } from "@/lib/in-season-selector";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import { trainingCampPromptId } from "@/lib/prompt-ids";
import { getOrCreateDailyPracticeVersion } from "@/lib/get-or-create-daily-practice-version";

export type DailyPhase = "Training Camp" | "In-Season";

export type DailyPracticeResolved = {
  userId: string;
  currentDay: number;
  phase: DailyPhase;

  promptId: string;
  actionItem: string;
  reflectionPrompt: string;

  video?: {
    id: string;
    vimeo_id?: string | null;
    title?: string | null;
  };

  trainingCampTrack?: TrainingCampTrack;
};

function phaseFromDay(day: number): DailyPhase {
  return day <= 30 ? "Training Camp" : "In-Season";
}

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

async function loadDailyPromptFromDB({
  userId,
  dayNumber,
}: {
  userId: string;
  dayNumber: number;
}) {
  const { data, error } = await supabaseServer
    .from("daily_prompts")
    .select("action_item, reflection_prompt, source")
    .eq("clerk_user_id", userId)
    .eq("day_number", dayNumber)
    .maybeSingle();

  if (error) {
    throw new Error(
      `ResolveDailyPractice: failed to load daily_prompts day ${dayNumber}: ${error.message}`
    );
  }

  if (!data?.action_item || !data?.reflection_prompt) return null;

  return {
    actionItem: normalizeText(data.action_item),
    reflectionPrompt: normalizeText(data.reflection_prompt),
    source: data.source ?? null,
  };
}

/**
 * ======================================================
 * resolveDailyPracticeForUser (CANONICAL)
 * ======================================================
 *
 * Non-negotiables:
 * - Never regenerate content for a past day
 * - Past day must load from daily_prompts
 * - Today rotates daily if user is stuck (daily_prompt_versions)
 */
export async function resolveDailyPracticeForUser(
  userId: string,
  requestedDay?: number
): Promise<DailyPracticeResolved> {
  const metadata = await getClerkPublicMetadata(userId);

  const metadataCurrentDay =
    typeof metadata.currentDay === "number" && metadata.currentDay > 0
      ? metadata.currentDay
      : null;

  if (!metadataCurrentDay) {
    throw new Error("ResolveDailyPractice: user has no valid currentDay.");
  }

  const dayToRender =
    typeof requestedDay === "number" && Number.isFinite(requestedDay)
      ? Math.floor(requestedDay)
      : metadataCurrentDay;

  if (dayToRender < 1) {
    throw new Error("ResolveDailyPractice: invalid requestedDay.");
  }

  // 🔒 Never allow rendering ahead of currentDay
  if (dayToRender > metadataCurrentDay) {
    throw new Error(
      `ResolveDailyPractice: requestedDay ${dayToRender} is ahead of currentDay ${metadataCurrentDay}.`
    );
  }

  const phase = phaseFromDay(dayToRender);

  const trainingCampTrack: TrainingCampTrack =
    metadata.trainingCampTrack === "women" ? "women" : "standard";

  const isPastDay = dayToRender < metadataCurrentDay;

  // ======================================================
  // PAST DAY MODE (Immutable)
  // ======================================================
  if (isPastDay) {
    const stored = await loadDailyPromptFromDB({
      userId,
      dayNumber: dayToRender,
    });

    if (!stored) {
      throw new Error(
        `ResolveDailyPractice: missing stored daily_prompts for past day ${dayToRender}.`
      );
    }

    return {
      userId,
      currentDay: dayToRender,
      phase,
      promptId:
        phase === "Training Camp"
          ? trainingCampPromptId(dayToRender)
          : inSeasonPromptId(dayToRender),
      actionItem: stored.actionItem,
      reflectionPrompt: stored.reflectionPrompt,
      trainingCampTrack,
    };
  }

  // ======================================================
  // TODAY MODE (Rotating Version)
  // ======================================================

  const version = await getOrCreateDailyPracticeVersion({
    userId,
    dayNumber: dayToRender,
  });

  const promptId =
    phase === "Training Camp"
      ? trainingCampPromptId(dayToRender)
      : inSeasonPromptId(dayToRender);

  return {
    userId,
    currentDay: dayToRender,
    phase,
    promptId,
    actionItem: normalizeText(version.actionItem),
    reflectionPrompt: normalizeText(version.reflectionPrompt),
    video: version.video,
    trainingCampTrack,
  };
}