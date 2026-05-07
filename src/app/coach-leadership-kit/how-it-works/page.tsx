import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { CoachLeadershipKitTrackedLink } from "@/app/coach-leadership-kit/coach-leadership-kit-tracked-link";
import { supabaseServer } from "@/lib/supabase-server";

const COACH_HOW_PATH = "/coach-leadership-kit/how-it-works";

export const metadata: Metadata = {
  title: "How It Works — Coach Leadership Kit",
  description:
    "A short walkthrough for coaches: Summitt Mindset membership, daily accountability, and the Pat Summitt Leadership Kit.",
  alternates: {
    canonical: `https://summittmindset.com${COACH_HOW_PATH}`,
  },
};

const ctaPrimaryClass =
  "inline-flex items-center justify-center w-full sm:w-auto rounded-xl px-8 py-4 text-base font-semibold text-white bg-[var(--brand)] hover:opacity-95 shadow-md shadow-orange-500/20 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]";

const COACH_SUBSCRIBE_PATH = "/subscribe?src=coach";
const COACH_SIGN_IN_HREF = `/sign-in?redirect_url=${encodeURIComponent(COACH_SUBSCRIBE_PATH)}`;

type CoachExplainerRow = {
  id: string;
  title: string;
  speaker: string | null;
  vimeo_video_id: string | null;
};

export default async function CoachHowItWorksPage() {
  const user = await currentUser();
  const leadershipKitHref = user ? COACH_SUBSCRIBE_PATH : COACH_SIGN_IN_HREF;

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
  const vimeoId =
    video?.vimeo_video_id && String(video.vimeo_video_id).trim() !== ""
      ? String(video.vimeo_video_id).trim()
      : null;

  const iframeTitle =
    video?.title && video.title.trim() !== ""
      ? `${video.title} — Summitt Mindset coach walkthrough`
      : "How It Works — Summitt Mindset coach walkthrough";

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 md:py-16 space-y-10">
        <header className="space-y-4">
          <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] tracking-tight leading-tight">
            See how Summitt Mindset fits a coach&apos;s day.
          </h1>
          <p className="text-lg text-[var(--muted)] leading-relaxed">
            A clear walkthrough of the membership—daily accountability,
            Summitt Mindset coaching, and the complimentary Pat Summitt
            Leadership Kit.
          </p>
          <CoachLeadershipKitTrackedLink
            href={leadershipKitHref}
            className={ctaPrimaryClass}
            cta="video_page_top"
          >
            Get the Leadership Kit
          </CoachLeadershipKitTrackedLink>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-[var(--text)]">
            Watch the quick walkthrough
          </h2>
          {video && vimeoId ? (
            <div className="rounded-xl overflow-hidden border border-[var(--border)] bg-white shadow-sm">
              <div className="relative w-full aspect-video">
                <iframe
                  title={iframeTitle}
                  src={`https://player.vimeo.com/video/${vimeoId}`}
                  className="absolute inset-0 w-full h-full"
                  allow="fullscreen; picture-in-picture"
                  allowFullScreen
                />
              </div>
              {video.speaker ? (
                <p className="text-sm text-[var(--muted)] px-4 py-3 border-t border-[var(--border)]">
                  {video.speaker}
                </p>
              ) : null}
            </div>
          ) : (
            <div
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center"
              role="status"
            >
              <p className="text-[var(--muted)] leading-relaxed">
                The walkthrough video will be available here shortly. You can
                still start below—the offer and checkout are unchanged.
              </p>
            </div>
          )}
        </section>

        <section className="space-y-6">
          <h2 className="text-xl font-semibold text-[var(--text)]">
            What happens after you join
          </h2>
          <ul className="space-y-4 text-[var(--text)] leading-relaxed">
            <li className="flex gap-3">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]"
                aria-hidden
              />
              <span>Start with a 7-day trial.</span>
            </li>
            <li className="flex gap-3">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]"
                aria-hidden
              />
              <span>
                Get short daily SMS coaching built around accountability,
                standards, and follow-through.
              </span>
            </li>
            <li className="flex gap-3">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]"
                aria-hidden
              />
              <span>
                Use the Leadership Kit as a tangible tool for team culture and
                expectations.
              </span>
            </li>
            <li className="flex gap-3">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]"
                aria-hidden
              />
              <span>
                Cancel anytime through secure Stripe checkout.
              </span>
            </li>
          </ul>
        </section>

        <p className="text-sm text-[var(--muted)] leading-relaxed border-l-2 border-[var(--brand)] pl-4">
          Built for coaches who want steadier leadership, clearer standards, and
          daily accountability.
        </p>

        <div className="flex flex-col sm:flex-row sm:items-center gap-6 pt-2">
          <CoachLeadershipKitTrackedLink
            href={leadershipKitHref}
            className={ctaPrimaryClass}
            cta="video_page_bottom"
          >
            Get the Leadership Kit
          </CoachLeadershipKitTrackedLink>
          <Link
            href="/coach-leadership-kit"
            className="text-sm font-medium text-[var(--muted)] hover:text-[var(--text)] underline underline-offset-2"
          >
            Back to Coach Leadership Kit overview
          </Link>
        </div>
      </div>
    </div>
  );
}
