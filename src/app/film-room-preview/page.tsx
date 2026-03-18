import Link from "next/link";
import { supabaseServer } from "@/lib/supabase-server";
import { PageHero } from "@/components/PageHero";
import { getPageImage } from "@/data/page-images";

type FilmVideoPreview = {
  id: string;
  title: string;
  speaker: string | null;
  thumbnail_url: string | null;
  program: string | null;
  is_featured: boolean;
};

export default async function FilmRoomPreviewPage() {
  const cardBase =
    "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm";

  const [{ count: videoCount }, { data: videos }] = await Promise.all([
    supabaseServer
      .from("film_videos")
      .select("*", { count: "exact", head: true }),
    supabaseServer
      .from("film_videos")
      .select("id, title, speaker, thumbnail_url, program, is_featured")
      .order("is_featured", { ascending: false })
      .limit(12),
  ]);

  const totalVideos = videoCount ?? 0;
  const videoList: FilmVideoPreview[] = (videos ?? []) as FilmVideoPreview[];
  const image = getPageImage("/film-room-preview");

  return (
    <main className="min-h-screen bg-[var(--bg)]">
      <PageHero
        title="Film Room"
        subtitle="Learn leadership principles from some of the most respected voices in sports, media, and business. Film study inside Summitt Mindset is optional. But many members find it powerful."
        imageSrc={image?.src ?? "/brand/pat-hero.jpeg"}
        imageAlt={image?.alt ?? "Coach Pat Summitt"}
      >
        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/subscribe"
            className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-90"
          >
            Start 7-Day Free Trial
          </Link>
          <Link
            href="/daily-practice"
            className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-semibold border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--ink)]"
          >
            See Daily Practice
          </Link>
        </div>
      </PageHero>

      {/* --------------------------------------------------
          FILM ROOM LIBRARY (scale / social proof)
          -------------------------------------------------- */}
      <section className="max-w-6xl mx-auto px-4 py-12">
        <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)] text-center mb-2">
          Film Room Library
        </h2>
        <p className="text-lg text-[var(--muted)] text-center mb-6">
          {totalVideos > 0 ? `${totalVideos}+ Leadership Videos` : "Leadership Videos"}
        </p>
        <p className="text-sm text-[var(--muted)] text-center">
          Featuring insights from:
        </p>
        <p className="text-[var(--text)] text-center mt-1">
          Pat Summitt · Peyton Manning · Robin Roberts · Phillip Fulmer · Morgan Vance · and more.
        </p>
      </section>

      {/* --------------------------------------------------
          VIDEO PREVIEW GRID (locked — links to /subscribe)
          -------------------------------------------------- */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)] text-center mb-12">
          Featured in the Film Room
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {videoList.length === 0 ? (
            <p className="text-[var(--muted)] text-center col-span-full py-8">
              Film Room content is available to members.
            </p>
          ) : (
            videoList.map((video) => (
              <Link
                key={video.id}
                href="/subscribe"
                className="group rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden shadow-sm block"
              >
                <div className="relative aspect-video bg-[var(--ink)]">
                  {video.thumbnail_url ? (
                    <img
                      src={video.thumbnail_url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center p-4">
                      <span className="text-[var(--muted)] text-sm">Video</span>
                    </div>
                  )}
                  <div
                    className="absolute inset-0 flex items-center justify-center bg-black/60"
                    aria-hidden
                  >
                    <span className="text-white font-semibold text-sm sm:text-base">
                      🔒 Members Only
                    </span>
                  </div>
                </div>
                <div className="p-4">
                  <p className="font-bold text-[var(--text)] group-hover:text-[var(--brand)] transition-colors line-clamp-2">
                    {video.title}
                  </p>
                  {video.speaker && (
                    <p className="text-sm text-[var(--muted)] mt-1">
                      {video.speaker}
                    </p>
                  )}
                </div>
              </Link>
            ))
          )}
        </div>
      </section>

      {/* --------------------------------------------------
          INSIDE THE FILM ROOM (conversion)
          -------------------------------------------------- */}
      <section className="max-w-6xl mx-auto px-4 py-12">
        <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)] text-center mb-6">
          Inside the Film Room
        </h2>
        <p className="text-[var(--muted)] text-center mb-6">
          Members unlock:
        </p>
        <ul className="max-w-xl mx-auto space-y-2 text-[var(--text)] text-center list-none">
          <li>• 140+ leadership film sessions</li>
          <li>• Lessons from elite leaders and championship coaches</li>
          <li>• Real-world leadership principles you can apply immediately</li>
        </ul>
      </section>

      {/* --------------------------------------------------
          HOW FILM ROOM WORKS
          -------------------------------------------------- */}
      <section className="bg-[var(--ink)] py-16">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)] text-center mb-12">
            How the Film Room Works
          </h2>
          <div className="grid sm:grid-cols-3 gap-6">
            <div className={cardBase}>
              <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
                Watch When You Want
              </h3>
              <p className="text-[var(--muted)] text-sm leading-relaxed">
                Film study is optional. Many members watch a short video after
                completing their daily practice.
              </p>
            </div>
            <div className={cardBase}>
              <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
                Learn from Experience
              </h3>
              <p className="text-[var(--muted)] text-sm leading-relaxed">
                Speakers share real lessons about leadership, discipline,
                teamwork, and standards.
              </p>
            </div>
            <div className={cardBase}>
              <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
                Apply the Principle
              </h3>
              <p className="text-[var(--muted)] text-sm leading-relaxed">
                The goal is not just watching. It is taking one idea and applying
                it in your life.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------
          FINAL CTA
          -------------------------------------------------- */}
      <section className="max-w-2xl mx-auto px-4 py-20 text-center">
        <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)] mb-4">
          Great leadership leaves clues.
        </h2>
        <p className="text-[var(--muted)] mb-8 leading-relaxed">
          Explore the Film Room inside Summitt Mindset.
        </p>
        <Link
          href="/subscribe"
          className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-90"
        >
          Start 7-Day Free Trial
        </Link>
      </section>
    </main>
  );
}
