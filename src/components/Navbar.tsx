"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";

/**
 * ======================================================
 * Navbar (Calm Global Shell)
 * ======================================================
 *
 * Rules:
 * - Daily Practice stays central
 * - Membership + Billing lives under Account
 * - Subscribe disappears once subscribed
 *
 * Visual rules:
 * - Neutral by default
 * - Summitt Orange used sparingly for active / hover
 */

export function Navbar() {
  const pathname = usePathname();
  const { user, isLoaded, isSignedIn } = useUser();

  // ----------------------------
  // Subscription State
  // ----------------------------
  const subscribedRaw = user?.publicMetadata?.summittSubscribed;
  const plan = user?.publicMetadata?.summittPlan as string | undefined;

  const isSubscribed =
    subscribedRaw === true ||
    subscribedRaw === "true" ||
    plan === "monthly" ||
    plan === "annual";

  // ----------------------------
  // Links (dynamic)
  // ----------------------------
  const navLinks = [
    { href: "/", label: "Home" },
    { href: "/dashboard", label: "Daily Practice" },
    { href: "/ask-pat", label: "Ask Pat" },
    { href: "/film-room", label: "Film Room" },

    ...(isSignedIn ? [{ href: "/user", label: "Account" }] : []),

    ...(isLoaded && (!isSignedIn || !isSubscribed)
      ? [{ href: "/subscribe", label: "Subscribe" }]
      : []),
  ];

  return (
    <header className="border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* ======================================================
            Brand
           ====================================================== */}
        <Link
          href="/"
          className="font-semibold text-lg tracking-tight"
        >
          <span className="text-[var(--text)]">Summitt</span>{" "}
          <span className="text-[var(--brand)]">Mindset</span>
        </Link>

        {/* ======================================================
            Navigation
           ====================================================== */}
        <nav className="flex gap-4 text-sm">
          {navLinks.map((link) => {
            const isActive =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);

            return (
              <Link
                key={link.href}
                href={link.href}
                className={
                  "px-2 py-1 rounded transition-colors " +
                  (isActive
                    ? "font-semibold text-[var(--text)] border-b-2 border-[var(--brand)]"
                    : "text-[var(--muted)] hover:text-[var(--text)]")
                }
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
