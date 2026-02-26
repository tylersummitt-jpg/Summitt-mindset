import { supabaseServer } from "@/lib/supabase-server";

export type TrainingCampTrack = "standard" | "women";

export type TrainingCampPractice = {
  title: string;
  action_item: string;
  reflection_prompt: string;
  video?: {
    id: string;
    vimeo_id?: string | null;
    title?: string | null;
  };
};

function trackVariants(track: TrainingCampTrack) {
  return track === "women" ? ["women", "Women"] : ["standard", "Standard"];
}

export async function resolveTrainingCampDay({
  dayNumber,
  trainingCampTrack,
}: {
  dayNumber: number;
  trainingCampTrack: TrainingCampTrack;
}): Promise<TrainingCampPractice> {
  const variants = trackVariants(trainingCampTrack);

  // 1️⃣ Track-specific video
  const trackVideo = await supabaseServer
    .from("film_videos")
    .select("id, vimeo_video_id, title, action_item, reflection_prompt")
    .eq("training_camp_day", dayNumber)
    .in("training_camp_track", variants)
    .maybeSingle();

  if (trackVideo.error) throw trackVideo.error;

  if (trackVideo.data) {
    const v = trackVideo.data;
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

  // 2️⃣ Shared video
  const sharedVideo = await supabaseServer
    .from("film_videos")
    .select("id, vimeo_video_id, title, action_item, reflection_prompt")
    .eq("training_camp_day", dayNumber)
    .is("training_camp_track", null)
    .maybeSingle();

  if (sharedVideo.error) throw sharedVideo.error;

  if (sharedVideo.data) {
    const v = sharedVideo.data;
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

  // 3️⃣ Track-specific non-video
  const trackNonVideo = await supabaseServer
    .from("training_camp_non_video_days")
    .select("action_item, reflection_prompt")
    .eq("training_camp_day", dayNumber)
    .in("training_camp_track", variants)
    .maybeSingle();

  if (trackNonVideo.error) throw trackNonVideo.error;

  if (trackNonVideo.data) {
    return {
      title: "Daily Practice",
      action_item: trackNonVideo.data.action_item,
      reflection_prompt: trackNonVideo.data.reflection_prompt,
    };
  }

  // 4️⃣ Shared non-video
  const sharedNonVideo = await supabaseServer
    .from("training_camp_non_video_days")
    .select("action_item, reflection_prompt")
    .eq("training_camp_day", dayNumber)
    .is("training_camp_track", null)
    .maybeSingle();

  if (sharedNonVideo.error) throw sharedNonVideo.error;

  if (sharedNonVideo.data) {
    return {
      title: "Daily Practice",
      action_item: sharedNonVideo.data.action_item,
      reflection_prompt: sharedNonVideo.data.reflection_prompt,
    };
  }

  throw new Error(
    `TrainingCampResolver: No content found for day ${dayNumber}.`
  );
}