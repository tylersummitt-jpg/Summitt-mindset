export const dynamic = "force-dynamic";

import Image from "next/image";
import type { Metadata } from "next";
import SubscribeCheckoutPanel from "./subscribe-checkout-panel";

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
    "Start your 7-day free trial of Summitt Mindset SMS-first accountability.",
};

export default function SubscribePage() {
  return (
    <main className="min-h-screen bg-[var(--bg)]">
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
              className="object-cover object-left lg:object-[center_22%]"
            />
          </div>

          <div
            className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-black via-black/75 to-black/35 md:bg-gradient-to-r md:from-black md:from-45% md:via-black/70 md:via-55% md:to-transparent"
            aria-hidden
          />

          {/* Foreground — story left / checkout right on lg+ */}
          <div className="relative z-10 mx-auto grid min-h-[72vh] w-full max-w-6xl min-w-0 grid-cols-1 gap-10 px-4 py-10 sm:px-6 sm:py-12 md:min-h-[80vh] md:gap-12 md:py-16 lg:grid-cols-2 lg:items-center lg:gap-14 xl:gap-16">
            <div className="flex min-w-0 flex-col justify-center gap-4 pt-2 md:gap-5 lg:pt-0">
              <h1 className="text-2xl font-bold leading-snug tracking-tight text-white drop-shadow-sm sm:text-3xl md:text-4xl md:leading-tight lg:text-[2.5rem] lg:leading-tight">
                Start your 7-day free trial.
              </h1>
              <p className="max-w-xl text-base leading-snug text-white/90 drop-shadow-sm sm:text-lg sm:leading-relaxed md:text-xl md:leading-relaxed">
                Daily accountability by text. One commitment. Honest check-ins.
                Proof you can see.
              </p>
            </div>

            <div className="flex min-w-0 w-full flex-col gap-4 lg:items-end">
              {/* Readable surface only — no overflow-hidden; no transform/filter/backdrop */}
              <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-white/95 p-4 shadow-xl sm:p-6 lg:ml-auto">
                <SubscribeCheckoutPanel />
              </div>

              <div className="w-full max-w-lg space-y-2 text-sm leading-relaxed text-white/85 lg:ml-auto">
                <p>
                  You won&apos;t be charged today. Cancel anytime. Secure checkout
                  via Stripe.
                </p>
                <p className="text-white/80">
                  Includes daily SMS accountability, Ask Pat, Film Room, and Victory
                  Room.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
