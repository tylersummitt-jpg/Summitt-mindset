import { notFound, redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { supabaseServer } from "@/lib/supabase-server";

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
  if (!user) {
    redirect("/sign-in");
  }

  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  if (!isSubscribedFromMetadata(md)) {
    redirect("/subscribe");
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
    <main className="max-w-6xl mx-auto py-12 px-6">
      <h1 className="mt-4 mb-6 text-3xl font-semibold">
        {data.title}
      </h1>

      <div className="rounded-xl overflow-hidden border bg-white mb-10">
        <div className="relative w-full aspect-video">
          <iframe
            src={`https://player.vimeo.com/video/${data.vimeo_video_id}`}
            className="absolute inset-0 w-full h-full"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
          />
        </div>
      </div>
    </main>
  );
}
