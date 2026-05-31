import Link from "next/link";
import Image from "next/image";
import { currentUser } from "@clerk/nextjs/server";
import {
  utBody,
  utBodyMuted,
  utCardDivider,
  utCtaOnDark,
  utPageCanvas,
  utPreviewCard,
  utPreviewCardLg,
  utPreviewSectionHeading,
  utSectionTitle,
} from "@/components/utility-page-visual";

const SIGN_IN_WITH_SUBSCRIBE_REDIRECT = `/sign-in?redirect_url=${encodeURIComponent("/subscribe")}`;

/** Primary CTA — hero only (ring offset for neutral-950 hero). */
const ctaHeroPrimaryClass =
  "inline-flex items-center justify-center w-full sm:w-auto rounded-xl px-6 py-3 text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-95 shadow-md shadow-orange-500/20 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 md:px-8 md:py-4 md:text-base";

const HERO_IMAGE_ALT =
  "Coach Pat Summitt coaching with focus and intensity on the court";

export default async function AskPatPreviewPage() {
  const user = await currentUser();
  const trialHref = user ? "/subscribe" : SIGN_IN_WITH_SUBSCRIBE_REDIRECT;

  return (
    <div className="min-h-screen overflow-x-hidden">
      {/* Hero — homepage-style full-bleed */}
      <section className="relative w-full overflow-hidden border-b border-white/10 bg-neutral-950">
        <div className="relative isolate min-h-[72vh] md:min-h-[80vh] w-full min-w-0">
          <div className="absolute inset-0 md:hidden">
            <Image
              src="/brand/ask-pat-preview-mobile.jpeg"
              alt={HERO_IMAGE_ALT}
              fill
              sizes="100vw"
              priority
              className="object-cover object-center"
            />
          </div>
          <div className="absolute inset-0 hidden md:block">
            <Image
              src="/brand/ask-pat-preview-desktop.jpeg"
              alt={HERO_IMAGE_ALT}
              fill
              sizes="100vw"
              priority
              className="object-cover object-center md:object-[40%_center] lg:object-center"
            />
          </div>
          <div
            className="absolute inset-0 z-[1] pointer-events-none bg-[linear-gradient(to_top,rgba(0,0,0,0.88)_0%,rgba(0,0,0,0.38)_42%,rgba(0,0,0,0.12)_58%,transparent_78%)] md:bg-[linear-gradient(90deg,rgba(0,0,0,0.94)_0%,rgba(0,0,0,0.52)_14%,rgba(0,0,0,0.2)_26%,rgba(0,0,0,0.06)_36%,transparent_46%)]"
            aria-hidden
          />
          <div className="relative z-10 flex min-h-[72vh] md:min-h-[80vh] w-full max-w-6xl mx-auto min-w-0 flex-col justify-end px-4 sm:px-6 py-10 pb-12 md:mx-0 md:ml-6 lg:ml-10 xl:ml-12 md:mr-auto md:py-20 md:pb-24 md:justify-end md:items-start">
            <div className="flex w-full max-w-2xl flex-col gap-5 md:gap-8 min-w-0">
              <div className="space-y-3 md:space-y-5">
                <h1 className="text-2xl font-bold leading-snug tracking-tight text-white drop-shadow-sm sm:text-3xl md:text-5xl md:leading-tight lg:text-6xl">
                  Ask Pat when you need the truth.
                </h1>
                <p className="text-base leading-snug text-white/90 drop-shadow-sm sm:text-lg sm:leading-relaxed md:text-xl md:leading-relaxed">
                  Leadership guidance shaped by Coach Summitt&apos;s standards —
                  for discipline, pressure, consistency, and the situations that
                  actually show up in your life.
                </p>
              </div>

              <div className="w-full max-w-md">
                <Link href={trialHref} className={ctaHeroPrimaryClass}>
                  Start 7-Day Free Trial
                </Link>
              </div>

              <p className="text-sm text-white/80 drop-shadow-sm">
                7-day free trial • Cancel anytime
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className={utPageCanvas}>
        <section>
          <div className="mx-auto max-w-3xl px-4 py-10 text-center sm:py-12">
            <p className={`${utBody} text-base font-medium sm:text-lg`}>
              Included with the same membership as your daily text accountability —
              optional depth when you need to think deeper.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-2xl px-4 py-12 sm:py-14">
          <h2 className={`${utPreviewSectionHeading} mb-4`}>Example question</h2>
          <div className={utPreviewCard}>
            <p className="text-lg italic leading-relaxed text-stone-200">
              &ldquo;How do I stay disciplined when I don&apos;t feel
              motivated?&rdquo;
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-2xl px-4 pb-12 sm:pb-16">
          <h2 className={`${utPreviewSectionHeading} mb-6`}>Pat&apos;s Perspective</h2>
          <div className={`${utPreviewCardLg} space-y-4`}>
            <blockquote className="border-l-4 border-[var(--brand)] pl-5 leading-relaxed text-stone-200">
              <p className="mb-4">
                Back in my playing days, motivation vanished—injury, doubt, and
                voices saying I wouldn&apos;t make the Olympic team.
              </p>
              <p className="mb-4">
                It would have been easy to quit. I didn&apos;t. Discipline carried
                me when motivation didn&apos;t—hours in the gym, standards I
                refused to lower.
              </p>
              <p className="font-medium text-stone-100">
                Start smaller than you think you should. Finish one thing today you
                said you&apos;d do—clean, no excuses. That&apos;s how standards
                are built.
              </p>
            </blockquote>
          </div>
        </section>

        <section className={`${utCardDivider} py-12 sm:py-16`}>
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="mb-10 text-center text-2xl font-bold text-stone-50 sm:text-3xl">
              How Ask Pat Works
            </h2>
            <div className="grid gap-6 md:grid-cols-3">
              <div className={utPreviewCard}>
                <h3 className={`${utSectionTitle} mb-3`}>Bring a real situation</h3>
                <p className={`${utBodyMuted} text-sm`}>
                  Name the pressure, the people, or the pattern—what you&apos;re
                  actually facing.
                </p>
              </div>
              <div className={utPreviewCard}>
                <h3 className={`${utSectionTitle} mb-3`}>Get standards-based guidance</h3>
                <p className={`${utBodyMuted} text-sm`}>
                  Responses draw from Pat Summitt&apos;s leadership philosophy—firm,
                  honest, and grounded in the standards she lived.
                </p>
              </div>
              <div className={utPreviewCard}>
                <h3 className={`${utSectionTitle} mb-3`}>Carry it back into your day</h3>
                <p className={`${utBodyMuted} text-sm`}>
                  Turn clarity into one next step—alongside your daily texts
                  accountability on the commitment that matters most.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-2xl px-4 py-12 text-center sm:py-16 md:py-20">
          <h2 className="mb-4 text-2xl font-bold text-stone-50 sm:text-3xl">
            Serious guidance. Same membership.
          </h2>
          <p className={`${utBodyMuted} mb-8`}>
            Ask Pat when you need direction—your daily text cadence stays the spine
            of your accountability.
          </p>
          <Link href={trialHref} className={utCtaOnDark}>
            Start 7-Day Free Trial
          </Link>
        </section>
      </div>
    </div>
  );
}
