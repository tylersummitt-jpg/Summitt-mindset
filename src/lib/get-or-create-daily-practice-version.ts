// src/lib/get-or-create-daily-practice-version.ts

import { supabaseServer } from "@/lib/supabase-server";
import {
  resolveTrainingCampDay,
  type TrainingCampPractice,
  type TrainingCampTrack,
} from "@/lib/training-camp-resolver";
import { selectInSeasonActionForDay } from "@/lib/in-season-selector";
import { generateInSeasonReflectionPrompt } from "@/lib/in-season-reflection-generator";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";

import {
  getUserStalenessLevel,
  type StalenessLevel,
} from "@/lib/get-user-staleness";
import {
  getTrainingCampToneLine,
  getTrainingCampReflectionAddOn,
} from "@/lib/training-camp-tone";

function normalize(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

export type DailyPracticeVersion = {
  dayKey: string;
  dayNumber: number;
  actionItem: string;
  reflectionPrompt: string;
  source: string;

  // Optional (Training Camp video)
  video?: {
    id: string;
    vimeo_id?: string | null;
    title?: string | null;
  };
};

/**
 * ======================================================
 * getOrCreateDailyPracticeVersion (CANONICAL for TODAY)
 * ======================================================
 *
 * Rule:
 * - One "practice version" per user per local day_key
 * - Rotates daily if user is stuck on the same day_number
 * - Stored in daily_prompt_versions
 *
 * Important:
 * - Past days never use this.
 * - Completion will later freeze today's chosen version into daily_prompts.
 */
export async function getOrCreateDailyPracticeVersion({
  userId,
  dayNumber,
  stalenessLevel,
}: {
  userId: string;
  dayNumber: number;
  /**
   * Optional override (future-proof): callers may compute staleness once and pass it in.
   * If omitted, we compute staleness from Clerk metadata (lastCompletedAt + timezone).
   */
  stalenessLevel?: StalenessLevel;
}): Promise<DailyPracticeVersion> {
  const md = await getClerkPublicMetadata(userId);

  const timezone = resolveUserTimezone(md?.timezone);
  const now = new Date();
  const dayKey = getDateKeyInTimezone(now, timezone);

  const trainingCampTrack: TrainingCampTrack =
    md?.trainingCampTrack === "women" ? "women" : "standard";

  const computedStaleness =
    stalenessLevel ??
    getUserStalenessLevel({
      timezoneFromMetadata: md?.timezone,
      lastCompletedAt: md?.lastCompletedAt,
      now,
    }).level;

  // Helper: Training Camp video is deterministic by day + track, and NOT stored in versions table.
  async function resolveTrainingCampVideoForDay(): Promise<
    TrainingCampPractice["video"] | undefined
  > {
    if (dayNumber > 30) return undefined;
    const practice = await resolveTrainingCampDay({
      dayNumber,
      trainingCampTrack,
    });
    return practice.video;
  }

  // ---------------------------------------
  // 1) Return existing version for today_key
  // ---------------------------------------
  const { data: existing, error: existingError } = await supabaseServer
    .from("daily_prompt_versions")
    .select("day_key, day_number, action_item, reflection_prompt, source")
    .eq("clerk_user_id", userId)
    .eq("day_key", dayKey)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `DailyPracticeVersion: failed to load existing version: ${existingError.message}`
    );
  }

  if (existing?.action_item && existing?.reflection_prompt) {
    const video = await resolveTrainingCampVideoForDay();

    return {
      dayKey: existing.day_key ?? dayKey,
      dayNumber:
        typeof existing.day_number === "number" ? existing.day_number : dayNumber,
      actionItem: normalize(existing.action_item),
      reflectionPrompt: normalize(existing.reflection_prompt),
      source: existing.source || "unknown",
      video,
    };
  }

  // ---------------------------------------
  // 2) Generate NEW rotating version
  // ---------------------------------------

  let actionItem = "";
  let reflectionPrompt = "";
  let source = "";
  let video: TrainingCampPractice["video"] | undefined = undefined;

  if (dayNumber <= 30) {
    // Training Camp — rotate daily via day_key record.
    // Base practice remains deterministic from DB.
    const practice = await resolveTrainingCampDay({
      dayNumber,
      trainingCampTrack,
    });

    // Maintain current behavior for fresh users to avoid unintended baseline shifts.
    const toneLine =
      getTrainingCampToneLine({ stalenessLevel: computedStaleness, dayNumber }) ??
      "Fresh angle today: do it smaller, but do it clean.";

    const reflectionAddOn =
      getTrainingCampReflectionAddOn({ stalenessLevel: computedStaleness }) ??
      "What is one small way you can approach this differently today?";

    actionItem = normalize(`${practice.action_item}\n\n${toneLine}`);

    reflectionPrompt = normalize(`${practice.reflection_prompt}\n\n${reflectionAddOn}`);

    source = "training_camp";
    video = practice.video;
  } else {
    // In-Season — rotate reflection daily via new day_key record.
    const action = selectInSeasonActionForDay(userId, dayNumber);

    const generatedReflection = await generateInSeasonReflectionPrompt({
      userId,
      dayNumber,
      actionText: action.text,
      primaryGoal: typeof md?.summittGoal === "string" ? md.summittGoal : undefined,
      // NOTE: we will wire this staleness into the generator in a later step safely.
      // stalenessLevel: computedStaleness,
    } as any);

    actionItem = normalize(action.text);
    reflectionPrompt = normalize(generatedReflection);
    source = "generated";
  }

  if (!actionItem || !reflectionPrompt) {
    throw new Error(
      `DailyPracticeVersion: missing generated content for day ${dayNumber}.`
    );
  }

  // ---------------------------------------
  // 3) Store version (one per day_key)
  // ---------------------------------------
  const { error: insertError } = await supabaseServer
    .from("daily_prompt_versions")
    .insert({
      clerk_user_id: userId,
      day_number: dayNumber,
      day_key: dayKey,
      action_item: actionItem,
      reflection_prompt: reflectionPrompt,
      source,
    });

  // If a race occurs (two requests same moment), unique constraint may fire.
  // In that case, just load and return the existing one.
  if (insertError) {
    const code = (insertError as any)?.code;
    if (code === "23505") {
      const { data: raced, error: racedError } = await supabaseServer
        .from("daily_prompt_versions")
        .select("day_key, day_number, action_item, reflection_prompt, source")
        .eq("clerk_user_id", userId)
        .eq("day_key", dayKey)
        .maybeSingle();

      if (racedError) {
        throw new Error(
          `DailyPracticeVersion: race reload failed: ${racedError.message}`
        );
      }

      if (raced?.action_item && raced?.reflection_prompt) {
        // Video is deterministic; resolve it again to be safe.
        const racedVideo = await resolveTrainingCampVideoForDay();

        return {
          dayKey: raced.day_key ?? dayKey,
          dayNumber:
            typeof raced.day_number === "number" ? raced.day_number : dayNumber,
          actionItem: normalize(raced.action_item),
          reflectionPrompt: normalize(raced.reflection_prompt),
          source: raced.source || "unknown",
          video: racedVideo ?? video,
        };
      }
    }

    throw new Error(
      `DailyPracticeVersion: failed to insert version: ${(insertError as any)?.message ?? String(insertError)}`
    );
  }

  return {
    dayKey,
    dayNumber,
    actionItem,
    reflectionPrompt,
    source,
    video,
  };
}