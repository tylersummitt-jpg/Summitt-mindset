export const dynamic = "force-dynamic";

import Image from "next/image";
import type { Metadata } from "next";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { maySetCoachAcquisitionSource } from "@/lib/coach-attribution";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { isNativeSummittMindsetIosRequest } from "@/lib/native-app/is-native-summitt-mindset-ios-request";
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

  const isNativeIos = await isNativeSummittMindsetIosRequest();
  if (isNativeIos) {
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

  const coachSubscribeHero =
    src === "coach" || md?.acquisitionSource === "coach";

  return (
    <main className="bg-[var(--bg)]">
      <section className="relative w-full border-b border-[var(--border)] bg-neutral-950">
        <div className="relative isolate min-h-[72vh] w-full min-w-0 md:min-h-[80vh]">
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

          {/* Mobile overlay — lighter at top (esp. top-right) so the photo reads; dark toward bottom for cards */}
          <div
            className="pointer-events-none absolute inset-0 z-[1] md:hidden bg-[linear-gradient(to_top,rgba(0,0,0,0.88)_0%,rgba(0,0,0,0.46)_34%,rgba(0,0,0,0.16)_58%,rgba(0,0,0,0.04)_100%)]"
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
          <div className="relative z-10 mx-auto grid min-h-[72vh] w-full max-w-6xl min-w-0 grid-cols-1 gap-10 px-4 py-10 sm:px-6 sm:py-12 md:min-h-[80vh] md:gap-12 md:py-16 lg:grid-cols-2 lg:items-center lg:gap-14 xl:gap-16">
            {coachSubscribeHero ? (
              <div className="hidden min-w-0 lg:block" aria-hidden />
            ) : (
              <div className="flex min-w-0 flex-col justify-center gap-4 pt-2 md:gap-5 lg:pt-0">
                <h1 className="text-2xl font-bold leading-snug tracking-tight text-white drop-shadow-sm sm:text-3xl md:text-4xl md:leading-tight lg:text-[2.5rem] lg:leading-tight">
                  Start your 7-day free trial.
                </h1>
              </div>
            )}

            <div className="flex min-w-0 w-full flex-col gap-4 lg:items-end">
              {/* Readable surface only — no overflow-hidden; no transform/filter/backdrop */}
              <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-white/95 p-4 shadow-xl sm:p-6 lg:ml-auto">
                <SubscribeCheckoutPanel />
              </div>

              <div className="w-full max-w-lg text-sm leading-relaxed text-white/85 lg:ml-auto">
                <p>
                  You won&apos;t be charged today. Cancel anytime. Secure checkout
                  via Stripe.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
