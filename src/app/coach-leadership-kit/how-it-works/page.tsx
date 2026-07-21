import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { CoachLeadershipKitTrackedLink } from "@/app/coach-leadership-kit/coach-leadership-kit-tracked-link";
import { supabaseServer } from "@/lib/supabase-server";
import {
  COACH_SIGN_UP_HREF,
  COACH_SUBSCRIBE_PATH,
} from "@/lib/coach-funnel-links";
import { buildVimeoPlayerEmbedUrl } from "@/lib/vimeo-player-embed";

const COACH_HOW_PATH = "/coach-leadership-kit/how-it-works";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "A short walkthrough for coaches: Summitt Mindset membership, daily accountability, and the Pat Summitt Leadership Kit.",
  alternates: {
    canonical: `https://summittmindset.com${COACH_HOW_PATH}`,
  },
};

const ctaPrimaryClass =
  "inline-flex items-center justify-center w-full sm:w-auto rounded-xl px-8 py-4 text-base font-semibold text-white bg-[var(--brand)] hover:opacity-95 shadow-md shadow-orange-500/20 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white";

const ctaSecondaryClass =
  "inline-flex items-center justify-center w-full sm:w-auto rounded-xl px-8 py-4 text-base font-semibold border-2 border-[var(--border)] text-[var(--text)] bg-[var(--surface)] hover:bg-[var(--brand-soft)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white";

type CoachExplainerRow = {
  id: string;
  title: string;
  speaker: string | null;
  vimeo_video_id: string | null;
};

export default async function CoachHowItWorksPage() {
  const user = await currentUser();
  const leadershipKitHref = user ? COACH_SUBSCRIBE_PATH : COACH_SIGN_UP_HREF;

  const { data, error } = await supabaseServer
    .from("film_videos")
    .select("id, title, speaker, vimeo_video_id")
    .eq("program", "Coach Guide")
    .eq("theme_slug", "coach-leadership-kit-how-it-works")
    .eq("video_type", "intro")
    .eq("order_index", 1)
    .maybeSingle();

  if (error) {
    console.error("[coach-how-it-works] film_videos query failed:", error);
  }

  const video = (data ?? null) as CoachExplainerRow | null;
  const playerSrc = buildVimeoPlayerEmbedUrl(video?.vimeo_video_id);

  const iframeTitle =
    video?.title && video.title.trim() !== ""
      ? `${video.title} — Summitt Mindset coach walkthrough`
      : "How It Works — Summitt Mindset coach walkthrough";

  return (
    <div className="relative isolate min-h-screen overflow-x-hidden bg-neutral-950">
      <div className="absolute inset-0 md:hidden" aria-hidden>
        <Image
          src="/brand/coach-setup-mobile.png"
          alt=""
          fill
          sizes="100vw"
          priority
          className="object-cover object-center grayscale"
        />
      </div>
      <div className="absolute inset-0 hidden md:block" aria-hidden>
        <Image
          src="/brand/coach-setup-desktop.jpeg"
          alt=""
          fill
          sizes="100vw"
          priority
          className="object-cover object-[center_28%] grayscale lg:object-[center_30%]"
        />
      </div>

      <div
        className="pointer-events-none absolute inset-0 z-[1] bg-black/50 md:bg-black/45"
        aria-hidden
      />

      <div className="relative z-10 mx-auto flex w-full flex-col items-center justify-center px-4 py-10 sm:py-12 md:min-h-[80vh] md:py-16">
        <div className="flex w-full max-w-3xl flex-col items-center gap-10 rounded-2xl border border-[var(--border)] bg-white/95 px-4 py-8 text-center shadow-xl sm:px-6 sm:py-10">
          <header className="space-y-4">
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] tracking-tight">
              How It Works
            </h1>
            <p className="text-sm text-[var(--muted)] leading-relaxed max-w-xl mx-auto">
              You&apos;re joining Summitt Mindset for daily accountability texts,
              Ask Pat, and Film Room. The Leadership Kit is a coach bonus after
              membership + onboarding. Shipping is covered, and a member of our
              team will reach out after you complete the required steps.
            </p>
          </header>

          <div className="w-full space-y-6">
            {video && playerSrc ? (
              <div className="w-full overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-sm">
                <div className="relative w-full aspect-video">
                  <iframe
                    title={iframeTitle}
                    src={playerSrc}
                    className="absolute inset-0 w-full h-full"
                    allow="fullscreen; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </div>
            ) : (
              <div
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-6 py-10"
                role="status"
              >
                <p className="text-[var(--muted)] leading-relaxed text-center">
                  The walkthrough video will be available here shortly. You can
                  still start below—the offer and checkout are unchanged.
                </p>
              </div>
            )}

            <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
              <CoachLeadershipKitTrackedLink
                href={leadershipKitHref}
                className={ctaPrimaryClass}
                cta="video_page_bottom"
              >
                Start Membership + Unlock Kit
              </CoachLeadershipKitTrackedLink>
              <Link
                href="/coach-leadership-kit"
                className={ctaSecondaryClass}
              >
                Back to Coach Leadership Kit overview
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
