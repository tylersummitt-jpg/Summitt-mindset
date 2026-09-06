"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { useIsNativeSummittMindsetApp } from "@/components/native-app/NativeAppProvider";
import { APP_SIGN_IN_PATH } from "@/lib/app-sign-in/app-sign-in-constants";
import { APP_MEMBERSHIP_PATH } from "@/lib/native-app/membership-paths";

/**
 * ======================================================
 * Navbar — Public Marketing + App Navigation
 * ======================================================
 *
 * - Logged OUT: marketing nav (preview pages, Start Free Trial, Sign In)
 * - Logged IN: app nav (Home, Dashboard, Ask Pat, Film Room, Account, Subscribe if needed)
 * - Twilio: public users never see gated app links
 * - Responsive: horizontal nav on md+, hamburger + vertical menu below md
 */

const linkBase =
  "px-2 py-1 rounded transition-colors text-sm ";
const linkActive =
  "font-semibold text-[var(--text)] border-b-2 border-[var(--text)]";
const linkInactive =
  "text-[var(--muted)] hover:text-[var(--text)]";

const SIGN_UP_WITH_SUBSCRIBE_REDIRECT = `/sign-up?redirect_url=${encodeURIComponent("/checkout/start")}`;

/** Meta ad landing: coach funnel — primary acquisition uses sign-up. */
const SIGN_UP_WITH_COACH_SUBSCRIBE_REDIRECT = `/sign-up?redirect_url=${encodeURIComponent("/subscribe?src=coach")}`;

const SIGN_IN_WITH_COACH_SUBSCRIBE_REDIRECT = `/sign-in?redirect_url=${encodeURIComponent("/subscribe?src=coach")}`;

function isCoachLeadershipKitPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname === "/coach-leadership-kit" ||
    pathname.startsWith("/coach-leadership-kit/")
  );
}

export function Navbar() {
  const pathname = usePathname();
  const { user, isSignedIn } = useUser();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const isNativeApp = useIsNativeSummittMindsetApp();

  const subscribedRaw = user?.publicMetadata?.summittSubscribed;
  const plan = user?.publicMetadata?.summittPlan as string | undefined;

  const isSubscribed =
    subscribedRaw === true ||
    subscribedRaw === "true" ||
    plan === "monthly" ||
    plan === "annual";
  const isPaused = plan === "paused";

  // Close mobile menu when resizing to desktop
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = () => {
      if (mq.matches) setIsMenuOpen(false);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Native-app dedicated surfaces: suppress website marketing chrome in WKWebView.
  if (
    pathname === "/app/sign-in" ||
    (pathname?.startsWith("/app/sign-in/") ?? false) ||
    pathname === APP_MEMBERSHIP_PATH ||
    (pathname?.startsWith(`${APP_MEMBERSHIP_PATH}/`) ?? false)
  ) {
    return null;
  }

  const startFreeTrialHref = isCoachLeadershipKitPath(pathname)
    ? SIGN_UP_WITH_COACH_SUBSCRIBE_REDIRECT
    : SIGN_UP_WITH_SUBSCRIBE_REDIRECT;

  const signInHref = isNativeApp
    ? APP_SIGN_IN_PATH
    : isCoachLeadershipKitPath(pathname)
      ? SIGN_IN_WITH_COACH_SUBSCRIBE_REDIRECT
      : "/sign-in";

  // --------------------------------------------------
  // PUBLIC NAV (logged out) — mirrors product structure
  // --------------------------------------------------
  const publicLinks = [
    { href: "/", label: "Home", key: "home" },
    { href: "/ask-pat-preview", label: "Ask Pat", key: "ask-pat-preview" },
    { href: "/film-room-preview", label: "Film Room", key: "film-room-preview" },
    ...(!isNativeApp
      ? [
          {
            href: startFreeTrialHref,
            label: "Start Free Trial",
            key: "start-trial",
          },
        ]
      : []),
    { href: signInHref, label: "Sign In", key: "sign-in" },
  ];

  // --------------------------------------------------
  // APP NAV (logged in)
  // --------------------------------------------------
  const appLinks = [
    { href: "/", label: "Home", key: "home" },
    { href: "/dashboard/victory-room", label: "Victory Room", key: "victory-room" },
    { href: "/ask-pat", label: "Ask Pat", key: "ask-pat" },
    { href: "/film-room", label: "Film Room", key: "film-room" },
    { href: "/user", label: "Account", key: "user" },
    ...(!isNativeApp && !isSubscribed && !isPaused
      ? [{ href: "/subscribe", label: "Subscribe", key: "subscribe" }]
      : []),
  ];

  const navLinks = isSignedIn ? appLinks : publicLinks;

  const isNavLinkActive = (href: string) => {
    if (!pathname) return false;
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const linkClass = (href: string) => {
    return linkBase + (isNavLinkActive(href) ? linkActive : linkInactive);
  };

  return (
    <>
      {/* Mobile: click-outside backdrop (only when menu open) */}
      {isMenuOpen && (
        <div
          className="fixed inset-0 z-10 md:hidden"
          aria-hidden
          onClick={() => setIsMenuOpen(false)}
        />
      )}

      <header
        className={
          "border-b border-[var(--border)] bg-[var(--surface)]" +
          (isMenuOpen ? " relative z-20" : "")
        }
      >
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="font-semibold text-lg tracking-tight text-[var(--text)]">
          <span>Summitt</span> <span>Mindset</span>
        </Link>

        {/* Desktop: horizontal nav (md and up) */}
        <nav
          className="hidden md:flex gap-4 text-sm"
          aria-label="Main navigation"
        >
          {navLinks.map((link) => (
            <Link
              key={link.key}
              href={link.href}
              className={linkClass(link.href)}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Mobile: hamburger (below md) */}
        <button
          type="button"
          className="md:hidden p-2 -mr-2 text-[var(--text)] hover:text-[var(--brand)] rounded transition-colors"
          aria-label="Toggle menu"
          aria-expanded={isMenuOpen}
          onClick={() => setIsMenuOpen((prev) => !prev)}
        >
          {isMenuOpen ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile: vertical menu (below md, when open) */}
      {isMenuOpen && (
        <div className="md:hidden border-t border-[var(--border)] bg-[var(--surface)]">
          <nav
            className="max-w-6xl mx-auto px-4 py-2 flex flex-col max-h-[70vh] overflow-y-auto"
            aria-label="Main navigation"
          >
            {navLinks.map((link) => (
              <Link
                key={link.key}
                href={link.href}
                className={linkClass(link.href) + " py-3 px-2 block"}
                onClick={() => setIsMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
    </>
  );
}
