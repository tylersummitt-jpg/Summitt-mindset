import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import {
  utBody,
  utBodyMuted,
  utCardDivider,
  utCtaOnDark,
  utFilmCardLink,
  utPageCanvas,
  utPageInnerFilm,
  utPreviewCard,
  utPreviewHeroHeading,
  utSectionTitle,
} from "@/components/utility-page-visual";
import { supabaseServer } from "@/lib/supabase-server";
import { isNativeSummittMindsetAppRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import {
  marketingAcquisitionHref,
  marketingTrialCtaLabel,
} from "@/lib/native-app/native-safe-marketing-cta";

type FilmVideoPreview = {
  id: string;
  title: string;
  speaker: string | null;
  thumbnail_url: string | null;
  program: string | null;
  is_featured: boolean;
};

export default async function FilmRoomPreviewPage() {
  const user = await currentUser();
  const isNativeApp = await isNativeSummittMindsetAppRequest();
  const trialHref = marketingAcquisitionHref({
    isNativeApp,
    isSignedIn: Boolean(user),
  });
  const trialLabel = marketingTrialCtaLabel(isNativeApp);

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

  return (
    <main className={utPageCanvas}>
      <div className={utPageInnerFilm}>
        <section className="pb-12 pt-8 sm:pt-12">
          <h2 className={`${utPreviewHeroHeading} mb-2`}>Film Room Library</h2>
          <p className={`${utBody} text-center text-lg`}>Included In Subscription</p>
          <p className={`${utBodyMuted} text-center text-sm mb-6 mt-2`}>
            The Film Room is included as a bonus for Founding Members.
          </p>
          <p className={`${utBodyMuted} text-center text-sm`}>Featuring insights from:</p>
          <p className="mt-1 text-center text-stone-200">
            Pat Summitt · Peyton Manning · Robin Roberts · Phillip Fulmer · Morgan Vance · and
            more.
          </p>
        </section>

        <section className="py-16">
          <h2 className={`${utPreviewHeroHeading} mb-12`}>Featured in the Film Room</h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {videoList.length === 0 ? (
              <p className={`${utBodyMuted} col-span-full py-8 text-center`}>
                Film Room content is available to members.
              </p>
            ) : (
              videoList.map((video) => (
                <Link key={video.id} href={trialHref} className={`group ${utFilmCardLink}`}>
                  <div className="relative aspect-[4/3] bg-[#0f172a] sm:aspect-video">
                    {video.thumbnail_url ? (
                      <img
                        src={video.thumbnail_url}
                        alt=""
                        className="h-full w-full object-cover object-top"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center p-4">
                        <span className={`${utBodyMuted} text-sm`}>Video</span>
                      </div>
                    )}
                    <div
                      className="absolute inset-0 flex items-center justify-center bg-black/60"
                      aria-hidden
                    >
                      <span className="text-sm font-semibold text-white sm:text-base">
                        🔒 Members Only
                      </span>
                    </div>
                  </div>
                  <div className="p-4">
                    <p className="line-clamp-2 font-bold text-stone-50 transition-colors group-hover:text-[var(--brand)]">
                      {video.title}
                    </p>
                    {video.speaker ? (
                      <p className={`${utBodyMuted} mt-1 text-sm`}>{video.speaker}</p>
                    ) : null}
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        <section className="py-12">
          <h2 className={`${utPreviewHeroHeading} mb-6`}>Inside the Film Room</h2>
          <p className={`${utBodyMuted} mb-6 text-center`}>Members unlock:</p>
          <ul className="mx-auto max-w-xl list-none space-y-2 text-center text-stone-300">
            <li>• 140+ leadership film sessions</li>
            <li>• Lessons from elite leaders and championship coaches</li>
            <li>• Real-world leadership principles you can apply immediately</li>
          </ul>
        </section>

        <section className={`${utCardDivider} py-16`}>
          <h2 className={`${utPreviewHeroHeading} mb-12`}>How the Film Room Works</h2>
          <div className="grid gap-6 sm:grid-cols-3">
            <div className={utPreviewCard}>
              <h3 className={`${utSectionTitle} mb-3`}>Watch When You Want</h3>
              <p className={`${utBodyMuted} text-sm`}>
                Film study is optional. Many members watch a short video after
                completing their daily practice.
              </p>
            </div>
            <div className={utPreviewCard}>
              <h3 className={`${utSectionTitle} mb-3`}>Learn from Experience</h3>
              <p className={`${utBodyMuted} text-sm`}>
                Speakers share real lessons about leadership, discipline, teamwork, and
                standards.
              </p>
            </div>
            <div className={utPreviewCard}>
              <h3 className={`${utSectionTitle} mb-3`}>Apply the Principle</h3>
              <p className={`${utBodyMuted} text-sm`}>
                The goal is not just watching. It is taking one idea and applying it in your
                life.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-2xl px-4 py-12 text-center sm:py-16 md:py-20">
          <h2 className="mb-4 text-2xl font-bold text-stone-50 sm:text-3xl">
            Great leadership leaves clues.
          </h2>
          <p className={`${utBodyMuted} mb-8`}>Explore the Film Room inside Summitt Mindset.</p>
          <Link href={trialHref} className={utCtaOnDark}>
            {trialLabel}
          </Link>
        </section>
      </div>
    </main>
  );
}
