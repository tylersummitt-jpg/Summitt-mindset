"use client";

import Image from "next/image";

const AUTH_ARENA_MOBILE = "/brand/auth-arena-mobile.jpeg";
const AUTH_ARENA_DESKTOP = "/brand/auth-arena-desktop.jpeg";

export type AuthMarketingShellPage = "sign-in" | "sign-up" | "coach-complete";

type Props = {
  authPage: AuthMarketingShellPage;
  /** Clerk `<SignIn />` or `<SignUp />` — centered; Clerk supplies its own card UI. */
  children: React.ReactNode;
  /** Optional width/centering for the foreground column (default: max-w-md). */
  contentClassName?: string;
};

const SPAM_HELPER = "Didn't get the code? Check your spam folder.";

/**
 * Centered Clerk over a full-bleed arena image: image → overlay → Clerk + helper.
 * Presentation only — no Clerk props or redirect logic here.
 */
export function AuthMarketingShell({
  authPage,
  children,
  contentClassName = "w-full max-w-md",
}: Props) {
  const showSpamHelper = authPage === "sign-in" || authPage === "sign-up";
  const heroMinH =
    authPage === "coach-complete"
      ? "min-h-screen"
      : "min-h-[72vh] md:min-h-[80vh]";

  return (
    <section
      className="relative w-full border-b border-[var(--border)] bg-neutral-950"
      data-auth-page={authPage}
    >
      <div className={`relative isolate w-full min-w-0 ${heroMinH}`}>
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
        <div
          className={`relative z-10 mx-auto flex w-full flex-col items-center justify-center px-4 py-12 sm:py-14 md:py-16 ${heroMinH} ${contentClassName}`}
        >
          <div className="w-full">{children}</div>

          {showSpamHelper ? (
            <p
              className={
                authPage === "sign-up"
                  ? "mt-8 max-w-md text-center text-[13px] font-medium leading-relaxed text-white/92 sm:text-sm sm:text-white/95"
                  : "mt-8 max-w-md text-center text-[13px] leading-relaxed text-white/85 sm:text-sm sm:text-white/90"
              }
            >
              {SPAM_HELPER}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
