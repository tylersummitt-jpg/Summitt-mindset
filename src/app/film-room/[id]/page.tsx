import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { supabaseServer } from "@/lib/supabase-server";

export default async function FilmRoomVideoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/sign-in");
  }

  const subscribed = user.publicMetadata?.summittSubscribed === true;
  if (!subscribed) redirect("/subscribe");

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
    <main className="max-w-4xl mx-auto py-12 px-6">
      <Link href="/film-room" className="text-sm text-gray-500 underline">
        ← Back to Film Room
      </Link>

      <h1 className="mt-4 mb-6 text-3xl font-semibold">
        {data.title}
      </h1>

      <div className="rounded-xl overflow-hidden border bg-white mb-10">
        <div style={{ paddingTop: "56.25%", position: "relative" }}>
          <iframe
            src={`https://player.vimeo.com/video/${data.vimeo_video_id}`}
            style={{ position: "absolute", inset: 0 }}
            allowFullScreen
          />
        </div>
      </div>
    </main>
  );
}
