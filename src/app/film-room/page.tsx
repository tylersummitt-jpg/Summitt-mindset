import Link from "next/link";
import { redirect } from "next/navigation";
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

type Video = {
  id: string;
  title: string;
  program: string;
  principle: string;
  principle_order: number;
  speaker: string | null;
  order_index: number;
  thumbnail_url: string | null;
  is_featured: boolean;
};

const PROGRAM_ORDER = [
  "Definite Dozen",
  "Power of Team - Leader Version",
  "Women's Leadership",
  "Power of Team - Team Version",
];

export default async function FilmRoomPage() {
  // ✅ SERVER-SIDE MEMBERSHIP CHECK
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  if (!isSubscribedFromMetadata(md)) {
    redirect("/subscribe");
  }

  // ✅ Load videos
  const { data, error } = await supabaseServer
    .from("film_videos")
    .select(
      `
        id,
        title,
        program,
        principle,
        principle_order,
        speaker,
        order_index,
        thumbnail_url,
        is_featured
      `
    )
    .order("principle_order", { ascending: true })
    .order("order_index", { ascending: true });

  if (error || !data) {
    return (
      <main className="max-w-6xl mx-auto py-12 px-6">
        <h1 className="text-3xl font-semibold">Film Room</h1>
        <p className="text-red-500 mt-4">Error loading videos.</p>
      </main>
    );
  }

  const allVideos: Video[] = data as Video[];

  const featuredVideos = allVideos
    .filter((v) => v.is_featured)
    .slice(0, 6);

  const gridVideos = allVideos.filter(
    (v) =>
      v.program !== "Summitt Mindset" &&
      v.principle !== "daily_system"
  );

  const grouped = PROGRAM_ORDER.map((program) => {
    const programVideos = gridVideos.filter((v) => v.program === program);

    const principles = Array.from(
      new Map(
        programVideos.map((v) => [
          v.principle,
          {
            principle: v.principle,
            principle_order: v.principle_order,
            videos: [] as Video[],
          },
        ])
      ).values()
    )
      .sort((a, b) => a.principle_order - b.principle_order)
      .map((group) => ({
        ...group,
        videos: programVideos
          .filter((v) => v.principle === group.principle)
          .sort((a, b) => a.order_index - b.order_index),
      }));

    return {
      program,
      principles,
    };
  }).filter((p) => p.principles.length > 0);

  return (
    <main className="max-w-6xl mx-auto py-12 px-6">
      <header className="mb-12">
        <h1 className="text-3xl font-semibold">
          Film Room
        </h1>
        <p className="mt-2 text-gray-600 max-w-2xl">
          Optional film study. Never required.
        </p>
      </header>

      {featuredVideos.length > 0 && (
        <section className="mb-20">
          <h2 className="text-2xl font-semibold mb-6">
            Spotlight
          </h2>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featuredVideos.map((v) => (
              <Link
                key={v.id}
                href={`/film-room/${v.id}`}
                className="rounded-xl border bg-white overflow-hidden hover:shadow-md transition"
              >
                {v.thumbnail_url && (
                  <img
                    src={v.thumbnail_url}
                    alt={v.title}
                    className="aspect-video w-full object-cover"
                  />
                )}

                <div className="p-5">
                  <h3 className="font-semibold mb-1">
                    {v.title}
                  </h3>

                  <div className="mt-4 text-sm font-semibold">
                    Watch →
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="space-y-20">
        {grouped.map((program) => (
          <section key={program.program}>
            <h2 className="text-2xl font-semibold mb-8">
              {program.program}
            </h2>

            <div className="space-y-12">
              {program.principles.map((principle) => (
                <div key={principle.principle}>
                  <h3 className="text-lg font-medium mb-4">
                    {principle.principle}
                  </h3>

                  <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {principle.videos.map((v) => (
                      <Link
                        key={v.id}
                        href={`/film-room/${v.id}`}
                        className="rounded-xl border bg-white overflow-hidden hover:shadow-md transition"
                      >
                        {v.thumbnail_url && (
                          <img
                            src={v.thumbnail_url}
                            alt={v.title}
                            className="aspect-video w-full object-cover"
                          />
                        )}

                        <div className="p-5">
                          <h4 className="font-semibold mb-1">
                            {v.title}
                          </h4>

                          <div className="mt-4 text-sm font-semibold">
                            Watch →
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
