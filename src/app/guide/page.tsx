import Link from "next/link";
import { supabaseServer } from "@/lib/supabase-server";

type FilmVideo = {
  id: string;
  title: string;
  principle: string;
  principle_order: number;
  order_index: number;
  thumbnail_url: string | null;
};

type PrincipleGroup = {
  principle: string;
  principle_order: number;
  videos: FilmVideo[];
};

function VideoCard({ video }: { video: FilmVideo }) {
  return (
    <Link
      href={`/film-room/${video.id}`}
      className="rounded-xl border bg-white overflow-hidden hover:shadow-md transition block"
    >
      {video.thumbnail_url ? (
        <img
          src={video.thumbnail_url}
          alt=""
          className="aspect-video w-full object-cover"
        />
      ) : null}
      <div className="p-5">
        <h4 className="font-semibold mb-1">{video.title}</h4>
        <div className="mt-4 text-sm font-semibold">Watch →</div>
      </div>
    </Link>
  );
}

export default async function GuidePage() {
  const [{ data, error }, topVideosResult] = await Promise.all([
    supabaseServer
      .from("film_videos")
      .select(
        "id, title, principle, principle_order, order_index, thumbnail_url"
      )
      .eq("program", "Definite Dozen")
      .eq("video_type", "core")
      .order("principle_order", { ascending: true })
      .order("order_index", { ascending: true }),
    supabaseServer
      .from("film_videos")
      .select(
        "id, title, principle, principle_order, order_index, thumbnail_url"
      )
      .eq("program", "Coach Guide")
      .eq("theme_slug", "guide-top-videos")
      .eq("video_type", "intro")
      .order("order_index", { ascending: true })
      .limit(2),
  ]);

  let topGuideVideos: FilmVideo[] = [];
  if (topVideosResult.error) {
    console.error("[guide] top videos query failed:", topVideosResult.error);
  } else {
    topGuideVideos = (topVideosResult.data ?? []) as FilmVideo[];
  }

  if (error) {
    return (
      <main className="max-w-6xl mx-auto py-12 px-6">
        <h1 className="text-3xl font-semibold">
          Pat Summitt Definite Dozen Coach&apos;s Guide
        </h1>
        <p className="text-red-500 mt-4">Could not load guide content.</p>
      </main>
    );
  }

  const rows = (data ?? []) as FilmVideo[];
  const moduleVideos = rows.filter((v) => v.order_index === 4);

  if (moduleVideos.length === 0) {
    return (
      <main className="max-w-6xl mx-auto py-12 px-6">
        <h1 className="text-3xl font-semibold">
          Pat Summitt Definite Dozen Coach&apos;s Guide
        </h1>
        <p className="mt-4 text-gray-600">No guide content available.</p>
      </main>
    );
  }

  const map = new Map<
    string,
    { principle_order: number; videos: FilmVideo[] }
  >();

  for (const v of moduleVideos) {
    const key = v.principle;
    const existing = map.get(key);
    if (existing) {
      existing.videos.push(v);
      existing.principle_order = Math.min(
        existing.principle_order,
        v.principle_order
      );
    } else {
      map.set(key, { principle_order: v.principle_order, videos: [v] });
    }
  }

  const groups: PrincipleGroup[] = Array.from(map.entries())
    .map(([principle, { principle_order, videos }]) => ({
      principle,
      principle_order,
      videos: [...videos].sort((a, b) => {
        if (a.principle_order !== b.principle_order) {
          return a.principle_order - b.principle_order;
        }
        return a.order_index - b.order_index;
      }),
    }))
    .sort((a, b) => a.principle_order - b.principle_order);

  return (
    <main className="max-w-6xl mx-auto py-12 px-6">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold">
          Pat Summitt Definite Dozen Coach&apos;s Guide
        </h1>
      </header>

      {topGuideVideos.length > 0 ? (
        <section className="mb-16">
          <h2 className="text-2xl font-semibold mb-2">Watch These First</h2>
          <p className="text-gray-600 mb-6 max-w-2xl">
            Start here before moving through the Coach&apos;s Guide.
          </p>
          <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
            {topGuideVideos.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="space-y-16">
        {groups.map((g) => (
          <section key={g.principle}>
            <h2 className="text-2xl font-semibold mb-8">{g.principle}</h2>

            <div className="mb-10">
              <h3 className="text-lg font-medium mb-4">
                View From The Summitt Module Video
              </h3>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {g.videos.map((v) => (
                  <VideoCard key={v.id} video={v} />
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
