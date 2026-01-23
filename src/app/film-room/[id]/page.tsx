import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import { SubscriptionGate } from "@/components/SubscriptionGate";

export default async function FilmRoomVideoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data, error } = await supabaseServer
    .from("film_videos")
    .select(
      "id, title, vimeo_video_id, program, principle, speaker, reflection_prompt, action_item"
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) notFound();

  return (
    <SubscriptionGate>
      <main className="max-w-4xl mx-auto py-12 px-6">
        <Link href="/film-room" className="text-sm text-neutral-500 hover:underline">
          ← Back to Film Room
        </Link>

        <h1 className="mt-4 mb-6 text-3xl font-semibold text-neutral-900 dark:text-neutral-100">
          {data.title}
        </h1>

        {/* Video */}
        <div className="rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-white/90 dark:bg-neutral-900 mb-10">
          <div style={{ paddingTop: "56.25%", position: "relative" }}>
            <iframe
              src={`https://player.vimeo.com/video/${data.vimeo_video_id}`}
              style={{ position: "absolute", inset: 0 }}
              allowFullScreen
            />
          </div>
        </div>

        {/* Reflection */}
        {(data.action_item || data.reflection_prompt) && (
          <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white/90 dark:bg-neutral-900 p-6">
            <p className="text-xs uppercase tracking-wide text-neutral-500 mb-4">
              Optional Reflection
            </p>

            {data.action_item && (
              <div className="mb-4">
                <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                  A simple action to consider
                </p>
                <p className="text-neutral-700 dark:text-neutral-300">
                  {data.action_item}
                </p>
              </div>
            )}

            {data.reflection_prompt && (
              <div>
                <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                  A question to sit with
                </p>
                <p className="text-neutral-700 dark:text-neutral-300">
                  {data.reflection_prompt}
                </p>
              </div>
            )}
          </section>
        )}
      </main>
    </SubscriptionGate>
  );
}
