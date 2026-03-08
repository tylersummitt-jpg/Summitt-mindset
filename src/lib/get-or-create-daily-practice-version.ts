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

/**
 * INTERNAL NOTE TO FUTURE CHATGPT
 *
 * This file must remain **idempotent** and **race-safe**.
 *
 * Rule:
 * Only ONE row may exist per (clerk_user_id, day_key).
 *
 * We use:
 *   upsert({ ... }, { onConflict: "clerk_user_id,day_key" })
 *
 * Never return maybeSingle() because duplicates can crash the system.
 * Always fetch with .limit(1).
 */

function normalize(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

export type DailyPracticeVersion = {
  dayKey: string;
  dayNumber: number;
  actionItem: string;
  reflectionPrompt: string;
  source: string;

  video?: {
    id: string;
    vimeo_id?: string | null;
    title?: string | null;
  };
};

export async function getOrCreateDailyPracticeVersion({
  userId,
  dayNumber,
  stalenessLevel,
}: {
  userId: string;
  dayNumber: number;
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

  /**
   * --------------------------------------------------
   * 1️⃣ Check existing version for this day
   * --------------------------------------------------
   */

  const { data: existingRows, error: existingError } = await supabaseServer
    .from("daily_prompt_versions")
    .select("day_key, day_number, action_item, reflection_prompt, source")
    .eq("clerk_user_id", userId)
    .eq("day_key", dayKey)
    .limit(1);

  if (existingError) {
    throw new Error(
      `DailyPracticeVersion: failed to load existing version: ${existingError.message}`
    );
  }

  const existing = existingRows?.[0];

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

  /**
   * --------------------------------------------------
   * 2️⃣ Generate NEW rotating version
   * --------------------------------------------------
   */

  let actionItem = "";
  let reflectionPrompt = "";
  let source = "";
  let video: TrainingCampPractice["video"] | undefined = undefined;

  if (dayNumber <= 30) {
    const practice = await resolveTrainingCampDay({
      dayNumber,
      trainingCampTrack,
    });

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
    const action = selectInSeasonActionForDay(userId, dayNumber);

    const generatedReflection = await generateInSeasonReflectionPrompt({
      userId,
      dayNumber,
      actionText: action.text,
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

  /**
   * --------------------------------------------------
   * 3️⃣ UPSERT version (race-safe)
   * --------------------------------------------------
   */

  const { data: savedRows, error: upsertError } = await supabaseServer
    .from("daily_prompt_versions")
    .upsert(
      {
        clerk_user_id: userId,
        day_number: dayNumber,
        day_key: dayKey,
        action_item: actionItem,
        reflection_prompt: reflectionPrompt,
        source,
      },
      { onConflict: "clerk_user_id,day_key" }
    )
    .select()
    .limit(1);

  if (upsertError) {
    throw new Error(
      `DailyPracticeVersion: failed to upsert version: ${upsertError.message}`
    );
  }

  const saved = savedRows?.[0];

  return {
    dayKey: saved?.day_key ?? dayKey,
    dayNumber:
      typeof saved?.day_number === "number" ? saved.day_number : dayNumber,
    actionItem: normalize(saved?.action_item ?? actionItem),
    reflectionPrompt: normalize(saved?.reflection_prompt ?? reflectionPrompt),
    source: saved?.source ?? source,
    video,
  };
}