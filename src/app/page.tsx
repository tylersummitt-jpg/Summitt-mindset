// src/app/page.tsx

import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { MEMBER_APP_HOME_PATH } from "@/lib/member-app-home-path";
import { isNativeSummittMindsetAppRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";
import { HomepageHowItWorksSteps } from "@/components/homepage-how-it-works-steps";
import { HomepageMemberTestimonials } from "@/components/homepage-member-testimonials";
import { HomepageSmsExample } from "@/components/homepage-sms-example";
import { HomepageVictoryRoom } from "@/components/homepage-victory-room";
import { MEMBERSHIP_PUBLIC_OFFER } from "@/lib/membership-public-offer";
import {
  marketingAcquisitionHref,
  marketingSubscribeCtaLabel,
  marketingTrialCtaLabel,
  shouldShowMarketingPricingCopy,
} from "@/lib/native-app/native-safe-marketing-cta";

export const metadata: Metadata = {
  title: {
    absolute: "Summitt Mindset | Daily Coaching Inspired by Pat Summitt",
  },
  description:
    "Created by Pat Summitt's family, Summitt Mindset offers personalized daily accountability by text. Start your 7-day free trial. Cancel anytime.",
  alternates: {
    canonical: "https://summittmindset.com/",
  },
  openGraph: {
    type: "website",
    url: "https://summittmindset.com/",
    siteName: "Summitt Mindset",
    title: "Summitt Mindset | Daily Coaching Inspired by Pat Summitt",
    description:
      "Created by Pat Summitt's family, Summitt Mindset offers personalized daily accountability by text. Start your 7-day free trial. Cancel anytime.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Summitt Mindset | Daily Coaching Inspired by Pat Summitt",
    description:
      "Created by Pat Summitt's family, Summitt Mindset offers personalized daily accountability by text. Start your 7-day free trial. Cancel anytime.",
  },
};

const brandSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://summittmindset.com/#organization",
      name: "Summitt Mindset",
      legalName: "Summitt Mindset LLC",
      url: "https://summittmindset.com/",
      description:
        "Created by Pat Summitt's family, Summitt Mindset provides personalized daily accountability rooted in her principles.",
    },
    {
      "@type": "WebSite",
      "@id": "https://summittmindset.com/#website",
      name: "Summitt Mindset",
      url: "https://summittmindset.com/",
      publisher: {
        "@id": "https://summittmindset.com/#organization",
      },
      inLanguage: "en-US",
    },
  ],
};

/** Hero primary CTA — matches coach kit ring offset on dark hero */
const ctaHeroPrimaryClass =
  "inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-[var(--brand)] px-6 py-3 text-base font-semibold !text-[#111827] shadow-md shadow-orange-500/20 transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 sm:w-auto md:px-8";

export default async function HomePage() {
  const user = await currentUser();

  if (user && isSubscribedFromPublicMetadata(user.publicMetadata)) {
    redirect("/post-sign-in");
  }

  const isNativeApp = await isNativeSummittMindsetAppRequest();
  const md = (user?.publicMetadata ?? {}) as Record<string, unknown>;

  const onboardingCompleted = md?.onboardingCompleted === true;
  const isSubscribed = isSubscribedFromPublicMetadata(md);

  const showContinue =
    !!user && onboardingCompleted === true && isSubscribed === true;

  const showResumeOnboarding =
    !!user && isSubscribed === true && onboardingCompleted !== true;

  const showSubscribe = !!user && isSubscribed !== true;

  const signInSubscribeHref = marketingAcquisitionHref({
    isNativeApp,
    isSignedIn: false,
  });
  const showPricingCopy = shouldShowMarketingPricingCopy(isNativeApp);
  const subscribeCtaHref = marketingAcquisitionHref({
    isNativeApp,
    isSignedIn: true,
  });
  const subscribeCtaLabel = marketingSubscribeCtaLabel(isNativeApp);
  const trialCtaLabel = marketingTrialCtaLabel(isNativeApp);
  const finalHref = user ? subscribeCtaHref : signInSubscribeHref;
  const finalLabel = isNativeApp
    ? user
      ? subscribeCtaLabel
      : trialCtaLabel
    : "Start My Free Trial";

  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(brandSchema).replace(/</g, "\\u003c"),
        }}
      />
      {/* Homepage hero — image-led, live HTML overlay */}
      <section className="relative w-full overflow-hidden border-b border-[var(--border)] bg-neutral-950">
        <div className="relative isolate min-h-[72vh] md:min-h-[80vh] w-full min-w-0">
          <div className="absolute inset-0 md:hidden" aria-hidden>
            <Image
              src="/brand/home-hero-mobile.png"
              alt=""
              fill
              sizes="100vw"
              priority
              className="object-cover object-[center_28%]"
            />
          </div>
          <div className="absolute inset-0 hidden md:block" aria-hidden>
            <Image
              src="/brand/home-hero-desktop.png"
              alt=""
              fill
              sizes="100vw"
              priority
              className="object-cover object-[center_30%] lg:object-center"
            />
          </div>
          <div
            className="absolute inset-0 z-[1] pointer-events-none bg-[linear-gradient(to_top,rgba(0,0,0,0.88)_0%,rgba(0,0,0,0.38)_42%,rgba(0,0,0,0.12)_58%,transparent_78%)] md:bg-[linear-gradient(90deg,rgba(0,0,0,0.94)_0%,rgba(0,0,0,0.52)_14%,rgba(0,0,0,0.2)_26%,rgba(0,0,0,0.06)_36%,transparent_46%)]"
            aria-hidden
          />
          <div className="relative z-10 flex min-h-[72vh] md:min-h-[80vh] w-full max-w-6xl mx-auto min-w-0 flex-col justify-end px-4 sm:px-6 py-10 pb-12 md:mx-0 md:ml-6 lg:ml-10 xl:ml-12 md:mr-auto md:py-20 md:pb-24 md:justify-center md:items-start">
            <div className="-mx-4 flex w-[calc(100%+2rem)] max-w-none flex-col gap-5 break-words bg-neutral-950 p-4 min-w-0 sm:-mx-6 sm:w-[calc(100%+3rem)] sm:p-5 md:mx-0 md:w-full md:max-w-2xl md:gap-8 md:bg-transparent md:p-0">
              <div>
                <h1 className="max-w-xl text-[1.65rem] font-black leading-[1.15] tracking-tight text-white drop-shadow-sm min-[390px]:text-[1.85rem] sm:text-4xl md:text-5xl md:leading-[1.05]">
                  <span className="block">Reach Your Goals.</span>
                  <span className="mt-1 block text-[var(--brand)] md:mt-1.5">
                    Remember the Journey.
                  </span>
                </h1>
                <p className="mt-3 max-w-xl text-lg font-medium leading-relaxed text-white/90 drop-shadow-sm md:mt-4 md:text-xl">
                  Get daily text messages from Coach Pat to help you reach your goals, celebrate your wins, and remember the special moments along the way.
                </p>
              </div>

              {user && (
                <div className="rounded-2xl border border-white/15 bg-white/95 p-6 shadow-lg backdrop-blur-sm space-y-4">
                  <p className="text-sm font-semibold text-[var(--text)]">
                    Welcome back{user.firstName ? `, ${user.firstName}` : ""}.
                  </p>

                  {showContinue && (
                    <>
                      <p className="text-sm text-[var(--muted)]">
                        Victory Room is ready—your commitment, daily text check-ins, and proof in one place.
                      </p>

                      <Link href={MEMBER_APP_HOME_PATH} className={ctaHeroPrimaryClass}>
                        Open Victory Room →
                      </Link>
                    </>
                  )}

                  {showResumeOnboarding && (
                    <>
                      <p className="text-sm text-[var(--muted)]">
                        Finish setup so Pat can hold you to your commitment by text.
                      </p>

                      <Link href="/onboarding" className={ctaHeroPrimaryClass}>
                        Resume Onboarding →
                      </Link>
                    </>
                  )}

                  {showSubscribe && (
                    <>
                      <p className="text-sm text-[var(--muted)]">
                        {isNativeApp
                          ? "Memberships are managed on the Summitt Mindset website."
                          : "Start your membership to turn on daily text accountability and the full app."}
                      </p>

                      <Link
                        href={subscribeCtaHref}
                        className={ctaHeroPrimaryClass}
                      >
                        {subscribeCtaLabel}
                      </Link>
                    </>
                  )}
                </div>
              )}

              {!user && (
                <>
                  <div className="w-full max-w-md">
                    <Link
                      href={signInSubscribeHref}
                      className={ctaHeroPrimaryClass}
                    >
                      {isNativeApp ? trialCtaLabel : "Start My Free Trial"}
                    </Link>
                  </div>
                  {showPricingCopy ? (
                    <p className="mt-1 max-w-md text-lg font-bold leading-relaxed tracking-tight text-white drop-shadow-sm">
                      7 days free · $0 today · Cancel anytime
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      <HomepageSmsExample />
      <HomepageHowItWorksSteps />
      <HomepageVictoryRoom />
      <HomepageMemberTestimonials />

      <section className="border-b border-gray-100 bg-white px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto grid max-w-5xl min-w-0 break-words grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-12">
          <div className="min-w-0">
            <Image
              src="/brand/pat_statue_grandkids_candidate_sharp.jpg"
              alt="Pat Summitt statue with her grandkids"
              width={2200}
              height={1650}
              sizes="(max-width: 1024px) 100vw, 50vw"
              unoptimized
              className="h-auto w-full max-w-full rounded-3xl border border-gray-200/80 bg-slate-50 shadow-lg shadow-gray-900/10"
            />
            <p className="mt-3 text-lg font-medium text-slate-800">
              Pat Summitt&apos;s grandkids
            </p>
          </div>
          <div className="min-w-0 text-left">
            <h2 className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl">
              Inspired by Pat Summitt. Made for Your Life.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-800 sm:text-xl">
              Created by Pat Summitt&apos;s family, Summitt Mindset brings her coaching principles into everyday life — helping people set goals, keep moving forward, and remember the moments that matter.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-neutral-950 px-4 py-12 text-white sm:px-6 sm:py-16">
        <div className="mx-auto flex w-full min-w-0 max-w-3xl break-words flex-col">
          <h2 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Your Next Chapter Starts Today.
          </h2>
          {showPricingCopy ? (
            <div className="mt-6 space-y-3">
              <p className="text-5xl font-black leading-none tracking-tight">$0 Today</p>
              <p className="text-lg leading-relaxed text-white sm:text-xl">
                Try Summitt Mindset free for 7 days.
              </p>
              <p className="text-lg leading-relaxed text-white sm:text-xl">
                Then {MEMBERSHIP_PUBLIC_OFFER.monthly}, or choose {MEMBERSHIP_PUBLIC_OFFER.annual}.
              </p>
              <p className="text-lg font-semibold leading-relaxed text-white sm:text-xl">
                {MEMBERSHIP_PUBLIC_OFFER.cancel}.
              </p>
            </div>
          ) : null}
          <div className="mt-8 w-full max-w-md">
            <Link href={finalHref} className={ctaHeroPrimaryClass}>
              {finalLabel}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
