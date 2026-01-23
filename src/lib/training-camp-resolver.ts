import { supabaseServer } from "@/lib/supabase-server";

export type TrainingCampTrack = "standard" | "women";

export type TrainingCampPractice = {
  title: string;
  description?: string;
  action_item: string;
  reflection_prompt: string;
  video?: {
    id: string;
    vimeo_id?: string | null;
    title?: string | null;
  };
};

function trackVariants(track: TrainingCampTrack) {
  // Support current DB casing safely
  return track === "women" ? ["women", "Women"] : ["standard", "Standard"];
}

/**
 * Deterministic Training Camp Resolver (Days 1–30)
 *
 * Resolution order:
 * 1) Track-specific video
 * 2) Shared video (track IS NULL)
 * 3) Non-video day (track IS NULL)
 *
 * NO authored fallbacks.
 * If content is missing, this FAILS LOUDLY.
 */
export async function resolveTrainingCampDay({
  dayNumber,
  trainingCampTrack,
}: {
  dayNumber: number;
  trainingCampTrack: TrainingCampTrack;
}): Promise<TrainingCampPractice> {
  const variants = trackVariants(trainingCampTrack);

  // ----------------------------
  // 1) TRACK-SPECIFIC VIDEO
  // ----------------------------
  const trackVideoQuery = await supabaseServer
    .from("film_videos")
    .select("id, vimeo_video_id, title, action_item, reflection_prompt")
    .eq("training_camp_day", dayNumber)
    .in("training_camp_track", variants)
    .maybeSingle();

  if (trackVideoQuery.error) {
    throw new Error(
      `TrainingCampResolver error (track video) day ${dayNumber}: ${trackVideoQuery.error.message}`
    );
  }

  if (trackVideoQuery.data) {
    const v = trackVideoQuery.data;
    return {
      title: "Daily Practice",
      action_item: v.action_item,
      reflection_prompt: v.reflection_prompt,
      video: {
        id: v.id,
        vimeo_id: v.vimeo_video_id,
        title: v.title,
      },
    };
  }

  // ----------------------------
  // 2) SHARED VIDEO (track IS NULL)
  // ----------------------------
  const sharedVideoQuery = await supabaseServer
    .from("film_videos")
    .select("id, vimeo_video_id, title, action_item, reflection_prompt")
    .eq("training_camp_day", dayNumber)
    .is("training_camp_track", null)
    .maybeSingle();

  if (sharedVideoQuery.error) {
    throw new Error(
      `TrainingCampResolver error (shared video) day ${dayNumber}: ${sharedVideoQuery.error.message}`
    );
  }

  if (sharedVideoQuery.data) {
    const v = sharedVideoQuery.data;
    return {
      title: "Daily Practice",
      action_item: v.action_item,
      reflection_prompt: v.reflection_prompt,
      video: {
        id: v.id,
        vimeo_id: v.vimeo_video_id,
        title: v.title,
      },
    };
  }

  // ----------------------------
  // 3) NON-VIDEO DAY (track IS NULL)
  // ----------------------------
  const nonVideoQuery = await supabaseServer
    .from("training_camp_non_video_days")
    .select("action_item, reflection_prompt")
    .eq("training_camp_day", dayNumber)
    .is("training_camp_track", null)
    .maybeSingle();

  if (nonVideoQuery.error) {
    throw new Error(
      `TrainingCampResolver error (non-video day) day ${dayNumber}: ${nonVideoQuery.error.message}`
    );
  }

  if (nonVideoQuery.data) {
    return {
      title: "Daily Practice",
      action_item: nonVideoQuery.data.action_item,
      reflection_prompt: nonVideoQuery.data.reflection_prompt,
    };
  }

  // ----------------------------
  // ❌ NOTHING FOUND — HARD FAIL
  // ----------------------------
  throw new Error(
    `TrainingCampResolver: No content found for day ${dayNumber}. Check Supabase data integrity.`
  );
}
