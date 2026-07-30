import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import {
  utBody,
  utBodyMuted,
  utFilmCardLink,
  utPageCanvas,
  utPageInnerFilm,
  utPageTitle,
  utSectionHeading,
  utSubheading,
  utWatchLink,
} from "@/components/utility-page-visual";
import { supabaseServer } from "@/lib/supabase-server";
import { isNativeSummittMindsetAppRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
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
  const isNativeApp = await isNativeSummittMindsetAppRequest();
  if (!user) redirect(signInPathForClient(isNativeApp));

  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  if (!isSubscribedFromMetadata(md)) {
    redirect(inactiveMembershipRedirectPath(isNativeApp));
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
      <main className={utPageCanvas}>
        <div className={utPageInnerFilm}>
          <h1 className={utPageTitle}>Film Room</h1>
          <p className="mt-4 text-sm text-red-300">Error loading videos.</p>
        </div>
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
    <main className={utPageCanvas}>
      <div className={utPageInnerFilm}>
      <header className="mb-12">
        <h1 className={utPageTitle}>Film Room</h1>
        <p className={`mt-2 max-w-2xl ${utBody}`}>Optional film study. Never required.</p>
        <p className={`mt-2 max-w-2xl ${utBodyMuted}`}>
          The Film Room is included as a bonus for Founding Members.
        </p>
      </header>

      {featuredVideos.length > 0 && (
        <section className="mb-20">
          <h2 className={`${utSectionHeading} mb-6`}>Spotlight</h2>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featuredVideos.map((v) => (
              <Link key={v.id} href={`/film-room/${v.id}`} className={utFilmCardLink}>
                {v.thumbnail_url && (
                  <img
                    src={v.thumbnail_url}
                    alt={v.title}
                    className="aspect-video w-full object-cover"
                  />
                )}

                <div className="p-5">
                  <h3 className="mb-1 font-semibold text-stone-50">{v.title}</h3>

                  <div className={`mt-4 ${utWatchLink}`}>Watch →</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="space-y-20">
        {grouped.map((program) => (
          <section key={program.program}>
            <h2 className={`${utSectionHeading} mb-8`}>{program.program}</h2>

            <div className="space-y-12">
              {program.principles.map((principle) => (
                <div key={principle.principle}>
                  <h3 className={`${utSubheading} mb-4`}>{principle.principle}</h3>

                  <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {principle.videos.map((v) => (
                      <Link key={v.id} href={`/film-room/${v.id}`} className={utFilmCardLink}>
                        {v.thumbnail_url && (
                          <img
                            src={v.thumbnail_url}
                            alt={v.title}
                            className="aspect-video w-full object-cover"
                          />
                        )}

                        <div className="p-5">
                          <h4 className="mb-1 font-semibold text-stone-50">{v.title}</h4>

                          <div className={`mt-4 ${utWatchLink}`}>Watch →</div>
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
      </div>
    </main>
  );
}
