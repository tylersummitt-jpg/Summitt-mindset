import Link from "next/link";
import { supabaseServer } from "@/lib/supabase-server";
import { SubscriptionGate } from "@/components/SubscriptionGate";

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
  "Women’s Leadership",
  "Power of Team - Team Version",
];

export default async function FilmRoomPage() {
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
      <SubscriptionGate>
        <main className="max-w-6xl mx-auto py-12 px-6">
          <h1 className="text-3xl font-semibold">Film Room</h1>
          <p className="text-red-500 mt-4">Error loading videos.</p>
        </main>
      </SubscriptionGate>
    );
  }

  const allVideos: Video[] = data as Video[];

  // 🔹 Featured Spotlight (can override exclusions)
  const featuredVideos = allVideos
    .filter((v) => v.is_featured)
    .sort(
      (a, b) =>
        a.principle_order - b.principle_order ||
        a.order_index - b.order_index
    )
    .slice(0, 6);

  // 🔹 Main Film Room grid (strictly excludes Daily OS content)
  const gridVideos = allVideos.filter(
    (v) =>
      v.program !== "Summitt Mindset" &&
      v.principle !== "daily_system"
  );

  // Group by program → principle (grid only)
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
    <SubscriptionGate>
      <main className="max-w-6xl mx-auto py-12 px-6">
        {/* Header */}
        <header className="mb-12">
          <h1 className="text-3xl font-semibold text-neutral-900 dark:text-neutral-100">
            Film Room
          </h1>
          <p className="mt-2 text-neutral-600 dark:text-neutral-400 max-w-2xl">
            Optional film study. Never required. Use it when you want clarity,
            perspective, or reinforcement.
          </p>
        </header>

        {/* Featured Spotlight */}
        {featuredVideos.length > 0 && (
          <section className="mb-20">
            <h2 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-6">
              Film Room Spotlight
            </h2>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {featuredVideos.map((v) => (
                <Link
                  key={v.id}
                  href={`/film-room/${v.id}`}
                  className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white/90 dark:bg-neutral-900 overflow-hidden transition hover:shadow-md"
                >
                  {v.thumbnail_url && (
                    <img
                      src={v.thumbnail_url}
                      alt={v.title}
                      className="aspect-video w-full object-cover"
                      loading="lazy"
                    />
                  )}

                  <div className="p-5">
                    <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                      {v.title}
                    </h3>

                    {v.speaker && (
                      <p className="text-sm text-neutral-500 dark:text-neutral-400">
                        {v.speaker}
                      </p>
                    )}

                    <div className="mt-4 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      Watch →
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Programs */}
        <div className="space-y-20">
          {grouped.map((program) => (
            <section key={program.program}>
              <h2 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-8">
                {program.program}
              </h2>

              <div className="space-y-12">
                {program.principles.map((principle) => (
                  <div key={principle.principle}>
                    <h3 className="text-lg font-medium text-neutral-700 dark:text-neutral-300 mb-4">
                      {principle.principle}
                    </h3>

                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                      {principle.videos.map((v) => (
                        <Link
                          key={v.id}
                          href={`/film-room/${v.id}`}
                          className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white/90 dark:bg-neutral-900 overflow-hidden transition hover:shadow-md"
                        >
                          {v.thumbnail_url && (
                            <img
                              src={v.thumbnail_url}
                              alt={v.title}
                              className="aspect-video w-full object-cover"
                              loading="lazy"
                            />
                          )}

                          <div className="p-5">
                            <h4 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                              {v.title}
                            </h4>

                            {v.speaker && (
                              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                                {v.speaker}
                              </p>
                            )}

                            <div className="mt-4 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
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
    </SubscriptionGate>
  );
}
