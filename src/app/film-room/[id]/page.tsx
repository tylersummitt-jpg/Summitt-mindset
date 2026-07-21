import { notFound, redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import {
  utCard,
  utPageCanvas,
  utPageInnerFilm,
  utPageTitle,
} from "@/components/utility-page-visual";
import { supabaseServer } from "@/lib/supabase-server";
import { isNativeSummittMindsetIosRequest } from "@/lib/native-app/is-native-summitt-mindset-ios-request";
import {
  inactiveMembershipRedirectPath,
  signInPathForClient,
} from "@/lib/native-app/membership-paths";

function isSubscribedFromMetadata(md: Record<string, unknown>) {
  return (
    md?.summittSubscribed === true ||
    md?.summittSubscribed === "true" ||
    md?.summittPlan === "monthly" ||
    md?.summittPlan === "annual"
  );
}

export default async function FilmRoomVideoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  const isNativeIos = await isNativeSummittMindsetIosRequest();
  if (!user) {
    redirect(signInPathForClient(isNativeIos));
  }

  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  if (!isSubscribedFromMetadata(md)) {
    redirect(inactiveMembershipRedirectPath(isNativeIos));
  }

  const { id } = await params;

  const { data, error } = await supabaseServer
    .from("film_videos")
    .select(
      "id, title, vimeo_video_id, reflection_prompt, action_item"
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) notFound();

  return (
    <main className={utPageCanvas}>
      <div className={utPageInnerFilm}>
        <h1 className={`mt-4 mb-6 ${utPageTitle}`}>{data.title}</h1>

        <div className={`${utCard} mb-10 overflow-hidden`}>
          <div className="relative aspect-video w-full">
            <iframe
              src={`https://player.vimeo.com/video/${data.vimeo_video_id}`}
              className="absolute inset-0 h-full w-full"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      </div>
    </main>
  );
}
