import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import {
  AUDIENCE_LANDING_SITE,
  audienceLandingPage,
  type AudienceLandingId,
  type AudienceLandingPageConfig,
} from "@/lib/audience-landing-pages";
import { MEMBERSHIP_PUBLIC_OFFER } from "@/lib/membership-public-offer";
import { isNativeSummittMindsetAppRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import {
  marketingAcquisitionHref,
  marketingTrialCtaLabel,
  shouldShowMarketingPricingCopy,
} from "@/lib/native-app/native-safe-marketing-cta";
import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";

const ctaClass =
  "inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[var(--brand)] px-6 py-3 text-center text-base font-semibold text-white shadow-md shadow-orange-500/20 hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 sm:w-auto";

export function audienceLandingMetadata(id: AudienceLandingId): Metadata {
  const page = audienceLandingPage(id);
  const url = `${AUDIENCE_LANDING_SITE}${page.path}`;
  return {
    title: { absolute: page.title },
    description: page.description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      siteName: "Summitt Mindset",
      title: page.title,
      description: page.description,
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
    },
  };
}

function TrialCta({
  href,
  label,
  surface,
  next,
}: {
  href: string;
  label: string;
  surface: string;
  next: string;
}) {
  return (
    <div className="flex w-full flex-col items-stretch gap-2 sm:items-start">
      <Link
        href={href}
        className={ctaClass}
        data-growth-cta="trial"
        data-growth-surface={surface}
      >
        {label}
      </Link>
      <p className="text-sm leading-relaxed text-[var(--muted)]">{next}</p>
    </div>
  );
}

function LandingView({
  page,
  isNativeApp,
  isSignedIn,
}: {
  page: AudienceLandingPageConfig;
  isNativeApp: boolean;
  isSignedIn: boolean;
}) {
  const href = marketingAcquisitionHref({ isNativeApp, isSignedIn });
  const label = marketingTrialCtaLabel(isNativeApp);
  const showPrice = shouldShowMarketingPricingCopy(isNativeApp);
  const next = isNativeApp
    ? "Next, you'll sign in. Membership is managed on the Summitt Mindset website."
    : "Next, you'll create an account. Then you'll start the free trial in secure checkout.";
  const offer = MEMBERSHIP_PUBLIC_OFFER;

  return (
    <article className="bg-[var(--bg)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] bg-neutral-950 text-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-2 lg:items-center">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
              Summitt Mindset
            </p>
            <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
              {page.headline}
            </h1>
            <p className="mt-4 text-base leading-relaxed text-white/80 sm:text-lg">
              {page.support}
            </p>
            <div className="mt-6">
              <TrialCta href={href} label={label} surface={page.ctaSurface} next={next} />
            </div>
            {showPrice ? (
              <p className="mt-4 text-sm font-semibold text-white/90">
                {offer.dueToday}. {offer.trial}. Then {offer.monthly}. {offer.cancel}.
              </p>
            ) : null}
          </div>
          <div className="min-w-0">
            <Image
              src={page.imageSrc}
              alt={page.imageAlt}
              width={1600}
              height={1200}
              priority
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="h-auto w-full rounded-2xl border border-white/10"
            />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6" aria-labelledby="what-it-is">
        <h2 id="what-it-is" className="text-2xl font-bold">
          What Summitt Mindset is
        </h2>
        <div className="mt-4 space-y-4 text-base leading-relaxed">
          <p>
            Summitt Mindset is a membership created by Pat Summitt&apos;s family. It brings her
            standard of accountability into your day through text coaching, a personal goal, and a
            place to keep what you accomplished.
          </p>
          <p>
            Coach Pat is the coaching in the membership. Pat Summitt is not personally sending
            these messages.
          </p>
        </div>
      </section>

      <section className="border-t border-[var(--border)] bg-[var(--surface)]" aria-labelledby="how-it-helps">
        <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <h2 id="how-it-helps" className="text-2xl font-bold">
            {page.helpTitle}
          </h2>
          <ul className="mt-4 list-disc space-y-3 pl-5 text-base leading-relaxed">
            {page.help.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6" aria-labelledby="what-you-receive">
        <h2 id="what-you-receive" className="text-2xl font-bold">
          What you receive
        </h2>
        <ul className="mt-4 list-disc space-y-3 pl-5 text-base leading-relaxed">
          <li>Morning and evening coaching by text, about the goal you chose.</li>
          <li>Ask Pat, when you want to talk a decision through.</li>
          <li>The Definite Dozen and the other leadership lessons included with membership.</li>
          <li>The Victory Room, for goal wins and proud moments.</li>
        </ul>
        <figure className="mt-6 rounded-2xl border border-[var(--border)] bg-white p-4 sm:p-5">
          <figcaption className="text-sm font-semibold text-[var(--text)]">
            {page.experienceTitle}
          </figcaption>
          <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{page.experienceNote}</p>
          <div className="mt-4 space-y-3">
            {page.lines.map((line) => (
              <p key={`${line.speaker}-${line.text}`} className="text-base leading-relaxed">
                <span className="font-semibold">{line.speaker}: </span>
                {line.text}
              </p>
            ))}
          </div>
        </figure>
      </section>

      <section className="border-t border-[var(--border)] bg-[var(--surface)]" aria-labelledby="what-it-costs">
        <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <h2 id="what-it-costs" className="text-2xl font-bold">
            How much it costs
          </h2>
          {showPrice ? (
            <div className="mt-4 space-y-4 text-base leading-relaxed">
              <p>
                {offer.dueToday}. You get a {offer.trial}. After that, the membership continues at{" "}
                {offer.monthly} unless you choose {offer.annual} instead during checkout.
              </p>
              <p>You do not pay the monthly price and the yearly price together.</p>
              <p>
                {offer.cancel}. Checkout shows the renewal and cancellation terms again before you
                pay. Billing is handled by the existing secure checkout.
              </p>
            </div>
          ) : (
            <p className="mt-4 text-base leading-relaxed">
              Membership is managed on the Summitt Mindset website.
            </p>
          )}
          <div className="mt-6">
            <TrialCta href={href} label={label} surface={page.ctaSurface} next={next} />
          </div>
          <p className="mt-6 text-sm leading-relaxed">
            <Link href="/privacy" className="underline">
              Privacy Policy
            </Link>
            {" · "}
            <Link href="/terms" className="underline">
              Terms
            </Link>
          </p>
        </div>
      </section>
    </article>
  );
}

export async function AudienceLandingRoute({ id }: { id: AudienceLandingId }) {
  const user = await currentUser();
  if (user && isSubscribedFromPublicMetadata(user.publicMetadata)) {
    redirect("/post-sign-in");
  }
  const isNativeApp = await isNativeSummittMindsetAppRequest();
  return (
    <LandingView
      page={audienceLandingPage(id)}
      isNativeApp={isNativeApp}
      isSignedIn={Boolean(user)}
    />
  );
}
