export const dynamic = "force-dynamic";

import Image from "next/image";
import type { Metadata } from "next";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { maySetCoachAcquisitionSource } from "@/lib/coach-attribution";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { linkMarketingVisitorToClerkUser } from "@/lib/marketing-account-link";
import { isNativeSummittMindsetAppRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import { APP_MEMBERSHIP_PATH } from "@/lib/native-app/membership-paths";
import SubscribeCheckoutPanel from "./subscribe-checkout-panel";

async function resolveSubscribeSearchParams(
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>
) {
  if (!searchParams) return {};
  return searchParams instanceof Promise ? await searchParams : searchParams;
}

/**
 * Subscribe hero assets — add net-cutting images to public/brand:
 * - subscribe-hero-mobile.jpeg
 * - subscribe-hero-desktop.jpeg
 */

const SUBSCRIBE_HERO_MOBILE = "/brand/subscribe-hero-mobile.jpeg";
const SUBSCRIBE_HERO_DESKTOP = "/brand/subscribe-hero-desktop.jpeg";

/**
 * ======================================================
 * Subscribe Page — Full-bleed hero (Home / Coach LP pattern)
 * ======================================================
 *
 * Visual only. Checkout behavior lives in SubscribeCheckoutPanel + API routes.
 */

export const metadata: Metadata = {
  title: { absolute: "Subscribe | Summitt Mindset" },
  description:
    "Start your 7-day free trial of Summitt Mindset text-first accountability.",
};

export default async function SubscribePage({
  searchParams,
}: {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}) {
  const sp = await resolveSubscribeSearchParams(searchParams);
  const rawSrc = sp.src;
  const src = Array.isArray(rawSrc) ? rawSrc[0] : rawSrc;
  const user = await currentUser();
  const md = user?.publicMetadata as Record<string, unknown> | undefined;

  const isNativeApp = await isNativeSummittMindsetAppRequest();
  if (isNativeApp) {
    redirect(APP_MEMBERSHIP_PATH);
  }

  if (
    user?.id &&
    src === "coach" &&
    maySetCoachAcquisitionSource(md?.acquisitionSource)
  ) {
    try {
      await updateClerkPublicMetadata(user.id, {
        acquisitionSource: "coach",
      });
    } catch (err) {
      console.warn(
        "[subscribe] unable to set acquisitionSource from src=coach:",
        err
      );
    }
  }

  if (user?.id) {
    try {
      await linkMarketingVisitorToClerkUser(user.id);
    } catch {
      // fail-open: analytics must never change subscribe or Checkout
    }
  }

  const coachSubscribeHero =
    src === "coach" || md?.acquisitionSource === "coach";

  return (
    <main className="bg-[var(--bg)]">
      <section className="relative w-full border-b border-[var(--border)] bg-neutral-950">
        <div className="relative isolate w-full min-w-0 md:min-h-[80vh]">
          {/* Background — mobile / desktop swap (Coach LP pattern) */}
          <div className="absolute inset-0 md:hidden" aria-hidden>
            <Image
              src={SUBSCRIBE_HERO_MOBILE}
              alt=""
              fill
              sizes="100vw"
              priority
              className="object-cover object-[center_40%]"
            />
          </div>
          <div className="absolute inset-0 hidden md:block" aria-hidden>
            <Image
              src={SUBSCRIBE_HERO_DESKTOP}
              alt=""
              fill
              sizes="100vw"
              priority
              className="object-cover object-[18%_center] lg:object-[20%_center]"
            />
          </div>

          {/* Mobile overlay — darker toward the offer so copy/CTA stay readable */}
          <div
            className="pointer-events-none absolute inset-0 z-[1] md:hidden bg-[linear-gradient(to_top,rgba(0,0,0,0.88)_0%,rgba(0,0,0,0.55)_42%,rgba(0,0,0,0.22)_72%,rgba(0,0,0,0.08)_100%)]"
            aria-hidden
          />

          {/* Desktop overlays — lighter over Pat (left); darker toward panel (right); layered */}
          <div
            className="pointer-events-none absolute inset-0 z-[1] hidden md:block"
            aria-hidden
          >
            {/* Base L→R: keep subject side bright, ramp dark for pricing column */}
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.06)_0%,rgba(0,0,0,0.03)_18%,rgba(0,0,0,0.18)_40%,rgba(0,0,0,0.52)_58%,rgba(0,0,0,0.72)_76%,rgba(0,0,0,0.86)_100%)]" />
            {/* Subtle bottom weight (Home/Coach-adjacent) without crushing the left subject */}
            <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.32)_0%,rgba(0,0,0,0.08)_32%,transparent_55%)]" />
            {/* Localized deepen behind right column + trust lines */}
            <div className="absolute inset-y-0 right-0 w-[min(62%,42rem)] bg-[linear-gradient(270deg,rgba(0,0,0,0.55)_0%,rgba(0,0,0,0.22)_42%,transparent_100%)]" />
          </div>

          {/* Foreground — story left / checkout right on lg+ (coach: empty left column on desktop, no headline over image) */}
          <div className="relative z-10 mx-auto grid w-full max-w-6xl min-w-0 grid-cols-1 gap-5 px-4 py-6 sm:px-6 sm:py-10 md:min-h-[80vh] md:gap-12 md:py-16 lg:grid-cols-2 lg:items-center lg:gap-14 xl:gap-16">
            {coachSubscribeHero ? (
              <div className="hidden min-w-0 lg:block" aria-hidden />
            ) : (
              <div className="flex min-w-0 flex-col justify-center gap-2 pt-1 md:gap-4 lg:pt-0">
                <p className="text-xs font-bold uppercase tracking-[0.25em] text-[var(--brand)]">
                  STEP 2 OF 2
                </p>
                <h1 className="text-2xl font-bold leading-snug tracking-tight text-white drop-shadow-sm sm:text-3xl md:text-4xl md:leading-tight lg:text-[2.5rem] lg:leading-tight">
                  Add a payment method to start your trial
                </h1>
                <p className="text-sm leading-snug text-white/85">
                  Your 7-day trial is free. You won&apos;t be charged today.
                </p>
              </div>
            )}

            <div className="flex min-w-0 w-full flex-col gap-3 lg:items-end">
              {/* Readable surface only — no overflow-hidden; no transform/filter/backdrop */}
              <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-white/95 p-4 shadow-xl sm:p-6 lg:ml-auto">
                <SubscribeCheckoutPanel />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        className="w-full border-t border-[var(--border)] bg-[var(--surface)]"
        aria-labelledby="founding-member-bonus-heading"
      >
        <div className="mx-auto max-w-6xl px-4 py-10 text-center sm:px-6 sm:py-12 md:py-14">
          <h2
            id="founding-member-bonus-heading"
            className="text-xs font-bold uppercase tracking-[0.25em] text-[var(--brand)]"
          >
            ALSO INCLUDED WITH YOUR MEMBERSHIP
          </h2>
          <p className="mt-3 text-lg font-semibold tracking-tight text-[var(--text)] sm:text-xl">
            $1,000+ in Pat Summitt leadership programs
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-[var(--muted)] sm:text-base">
            All video content from four Pat Summitt leadership programs is included at no additional cost.
          </p>
        </div>
      </section>
    </main>
  );
}
