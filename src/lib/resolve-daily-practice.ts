import { clerkClient } from "@clerk/nextjs/server";
import {
  resolveTrainingCampDay,
  type TrainingCampTrack,
  type TrainingCampPractice,
} from "@/lib/training-camp-resolver";
import { ensureDailyPrompt } from "@/lib/ensure-daily-prompt";
import { inSeasonPromptId } from "@/lib/in-season-selector";

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

function trainingCampPromptId(day: number): string {
  return `tc-day-${day}`;
}

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

export async function resolveDailyPracticeForUser(
  userId: string
): Promise<DailyPracticeResolved> {
  const client = await clerkClient();
  const user = await client.users.getUser(userId);

  const metadata = user.publicMetadata || {};

  const currentDay =
    typeof metadata.currentDay === "number" && metadata.currentDay > 0
      ? metadata.currentDay
      : null;

  if (!currentDay) {
    throw new Error("ResolveDailyPractice: user has no valid currentDay.");
  }

  const phase = phaseFromDay(currentDay);

  // ============================
  // TRAINING CAMP (Days 1–30)
  // ============================
  if (phase === "Training Camp") {
    const trainingCampTrack: TrainingCampTrack =
      metadata.trainingCampTrack === "women" ? "women" : "standard";

    const practice: TrainingCampPractice = await resolveTrainingCampDay({
      dayNumber: currentDay,
      trainingCampTrack,
    });

    const actionItem = normalizeText(practice.action_item);
    const reflectionPrompt = normalizeText(practice.reflection_prompt);

    if (!actionItem || !reflectionPrompt) {
      throw new Error(
        `ResolveDailyPractice: Training Camp day ${currentDay} missing content.`
      );
    }

    return {
      userId,
      currentDay,
      phase,
      promptId: trainingCampPromptId(currentDay),
      actionItem,
      reflectionPrompt,
      video: practice.video,
      trainingCampTrack,
    };
  }

  // ============================
  // IN-SEASON (Day 31+)
  // ============================
  const trainingCampTrack: TrainingCampTrack =
    metadata.trainingCampTrack === "women" ? "women" : "standard";

  const primaryGoal =
    typeof metadata.summittGoal === "string" ? metadata.summittGoal : undefined;

  const ensured = await ensureDailyPrompt({
    userId,
    dayNumber: currentDay,
    trainingCampTrack,
    primaryGoal,
  });

  return {
    userId,
    currentDay,
    phase,
    promptId: inSeasonPromptId(currentDay),
    actionItem: normalizeText(ensured.actionItem),
    reflectionPrompt: normalizeText(ensured.reflectionPrompt),
  };
}
