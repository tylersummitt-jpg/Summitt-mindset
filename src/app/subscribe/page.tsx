export const dynamic = "force-dynamic";

import Image from "next/image";
import { getPageImage } from "@/data/page-images";
import SubscribeCheckoutPanel from "./subscribe-checkout-panel";

/**
 * ======================================================
 * Subscribe Page — Twilio-Compliant Public Version
 * ======================================================
 *
 * IMPORTANT:
 * - Page must render publicly (no forced login)
 * - Login only required at checkout
 * - Stripe session still requires auth
 */

export default function SubscribePage() {
  const image =
    getPageImage("/subscribe") ?? {
      src: "/brand/subscribe-celebration.jpg",
      alt: "Coach Pat Summitt celebrating with confetti",
    };

  return (
    <main className="min-h-screen bg-[var(--bg)]">
      {/* Mobile: hero → trial + cards → trust → image. Desktop: hero | same stack. */}
      <section className="max-w-6xl mx-auto px-4 py-6 md:py-14">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 md:items-start">
          <div className="order-1 text-center md:text-left min-w-0 max-w-md mx-auto md:mx-0 md:pt-6">
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] mb-3 md:mb-4">
              Start SMS-first accountability
            </h1>
            <p className="text-lg text-[var(--muted)] mb-3">
              Summitt Mindset helps you hold one clear commitment with Pat’s leadership standards—by text first, with depth and proof in the app.
            </p>
            <p className="text-[var(--text)]">
              One bar. Honest check-ins. Victory Room for the record you can trust.
            </p>
          </div>

          <div className="order-2 flex flex-col gap-4 md:gap-3 w-full min-w-0">
            <SubscribeCheckoutPanel />

            <div className="text-center md:text-left text-sm text-[var(--muted)] space-y-2 w-full max-w-xl mx-auto md:max-w-none md:mx-0">
              <p>Cancel anytime. Secure checkout via Stripe.</p>
              <p>
                “Successful people are simply those with successful habits.”
                <span className="ml-2">— Pat Summitt</span>
              </p>
            </div>

            <div className="relative w-full h-[180px] sm:h-[200px] md:h-[200px] rounded-2xl overflow-hidden shrink-0">
              <Image
                src={image.src}
                alt={image.alt}
                fill
                priority
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-cover object-top"
              />
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------
          Section 2 — What You Get
          -------------------------------------------------- */}
      <section className="max-w-6xl mx-auto px-4 pt-2 md:pt-6 pb-16">
        <h2 className="text-2xl font-bold text-[var(--text)] text-center mb-12">
          Your Membership Includes
        </h2>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
              Commitment &amp; SMS
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              Name the behavior you want held to; Pat checks in on that bar over text.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
              Ask Pat
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              Ask leadership questions and receive guidance inspired by Pat
              Summitt’s philosophy.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-[var(--text)] mb-3">
              Film Room
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              Watch leadership lessons from respected voices in sports, media,
              and business.
            </p>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------
          Section 3 — How It Fits Your Life
          -------------------------------------------------- */}
      <section className="max-w-3xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-bold text-[var(--text)] mb-6">
          Built for real life.
        </h2>
        <p className="text-[var(--text)] leading-relaxed">
          Check-ins are short by design—most replies fit in a sentence.
        </p>
        <p className="text-[var(--text)] leading-relaxed mt-4">
          Accountability runs on SMS; the app is for identity, context, Ask Pat, Film Room, and Victory Room.
        </p>
        <p className="text-[var(--text)] leading-relaxed mt-4">
          The goal is simple: keep a serious promise to yourself.
        </p>
      </section>
    </main>
  );
}
