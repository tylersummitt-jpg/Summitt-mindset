"use client";

import Image from "next/image";

const AUTH_ARENA_MOBILE = "/brand/auth-arena-mobile.jpeg";
const AUTH_ARENA_DESKTOP = "/brand/auth-arena-desktop.jpeg";

export type AuthMarketingShellPage = "sign-in" | "sign-up";

type Props = {
  authPage: AuthMarketingShellPage;
  /** Clerk `<SignIn />` or `<SignUp />` — centered; Clerk supplies its own card UI. */
  children: React.ReactNode;
};

const SPAM_HELPER = "Didn't get the code? Check your spam folder.";

/**
 * Centered Clerk over a full-bleed arena image: image → overlay → Clerk + helper.
 * Presentation only — no Clerk props or redirect logic here.
 */
export function AuthMarketingShell({ authPage, children }: Props) {
  return (
    <section
      className="relative w-full border-b border-[var(--border)] bg-neutral-950"
      data-auth-page={authPage}
    >
      <div className="relative isolate min-h-[72vh] w-full min-w-0 md:min-h-[80vh]">
        {/* Background images — mobile md:hidden, desktop hidden md:block */}
        <div className="absolute inset-0 md:hidden" aria-hidden>
          <Image
            src={AUTH_ARENA_MOBILE}
            alt=""
            fill
            sizes="100vw"
            priority
            className="object-cover object-[center_45%]"
          />
        </div>
        <div className="absolute inset-0 hidden md:block" aria-hidden>
          <Image
            src={AUTH_ARENA_DESKTOP}
            alt=""
            fill
            sizes="100vw"
            priority
            className="object-cover object-[center_28%] lg:object-[center_30%]"
          />
        </div>

        {/* Strong but balanced overlay — image stays visible around the card */}
        <div
          className="pointer-events-none absolute inset-0 z-[1] bg-black/50 md:bg-black/45"
          aria-hidden
        />

        {/* Foreground: centered Clerk + helper (no extra shell card — Clerk is the card) */}
        <div className="relative z-10 mx-auto flex w-full min-h-[72vh] max-w-md flex-col items-center justify-center px-4 py-12 sm:py-14 md:min-h-[80vh] md:py-16">
          <div className="w-full">{children}</div>

          <p className="mt-8 max-w-md text-center text-[13px] leading-relaxed text-white/85 sm:text-sm sm:text-white/90">
            {SPAM_HELPER}
          </p>
        </div>
      </div>
    </section>
  );
}
