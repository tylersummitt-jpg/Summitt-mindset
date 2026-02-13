import {
  resolveTrainingCampDay,
  type TrainingCampTrack,
  type TrainingCampPractice,
} from "@/lib/training-camp-resolver";

import { ensureDailyPrompt } from "@/lib/ensure-daily-prompt";
import { inSeasonPromptId } from "@/lib/in-season-selector";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import { trainingCampPromptId } from "@/lib/prompt-ids";

export type DailyPhase = "Training Camp" | "In-Season";

export type DailyPracticeResolved = {
  userId: string;

  currentDay: number; // the day we are rendering
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
}): Promise<{
  actionItem: string;
  reflectionPrompt: string;
  source?: string | null;
} | null> {
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
 * Supports:
 * - Today (requestedDay omitted)
 * - Past days (requestedDay < metadata.currentDay)
 *
 * Non-negotiables:
 * - Never regenerate content for a past day
 * - Past day must load from daily_prompts
 * - Today can resolve from training camp resolver or ensureDailyPrompt
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

  // 🔒 Safety: do not allow rendering ahead of metadata.currentDay
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
  // TODAY MODE (Canonical)
  // ======================================================

  // ----------------------------
  // TRAINING CAMP (Days 1–30)
  // ----------------------------
  if (phase === "Training Camp") {
    const practice: TrainingCampPractice = await resolveTrainingCampDay({
      dayNumber: dayToRender,
      trainingCampTrack,
    });

    const actionItem = normalizeText(practice.action_item);
    const reflectionPrompt = normalizeText(practice.reflection_prompt);

    if (!actionItem || !reflectionPrompt) {
      throw new Error(
        `ResolveDailyPractice: Training Camp day ${dayToRender} missing content.`
      );
    }

    return {
      userId,
      currentDay: dayToRender,
      phase,
      promptId: trainingCampPromptId(dayToRender),
      actionItem,
      reflectionPrompt,
      video: practice.video,
      trainingCampTrack,
    };
  }

  // ----------------------------
  // IN-SEASON (Day 31+)
  // ----------------------------
  const primaryGoal =
    typeof metadata.summittGoal === "string" ? metadata.summittGoal : undefined;

  const ensured = await ensureDailyPrompt({
    userId,
    dayNumber: dayToRender,
    trainingCampTrack,
    primaryGoal,
  });

  return {
    userId,
    currentDay: dayToRender,
    phase,
    promptId: inSeasonPromptId(dayToRender),
    actionItem: normalizeText(ensured.actionItem),
    reflectionPrompt: normalizeText(ensured.reflectionPrompt),
    trainingCampTrack,
  };
}
