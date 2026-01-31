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

    // ✅ Account always visible once signed in
    ...(isSignedIn ? [{ href: "/user", label: "Account" }] : []),

    // ✅ Subscribe only shown if NOT subscribed
    ...(isLoaded && (!isSignedIn || !isSubscribed)
      ? [{ href: "/subscribe", label: "Subscribe" }]
      : []),
  ];

  return (
    <header className="border-b bg-white">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Brand */}
        <Link href="/" className="font-bold text-lg tracking-tight">
          Summitt Mindset
        </Link>

        {/* Navigation */}
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
                  "px-2 py-1 rounded transition " +
                  (isActive
                    ? "font-semibold border-b-2 border-gray-900"
                    : "text-gray-600 hover:text-gray-900")
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
