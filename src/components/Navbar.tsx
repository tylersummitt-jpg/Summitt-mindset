"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";

/**
 * ======================================================
 * Navbar — Public Marketing + App Navigation
 * ======================================================
 *
 * - Logged OUT: marketing nav (preview pages, About, Start Free Trial, Sign In)
 * - Logged IN: app nav (Dashboard, Ask Pat, Film Room, Account, Subscribe if needed)
 * - Twilio: public users never see gated app links
 */

export function Navbar() {
  const pathname = usePathname();
  const { user, isLoaded, isSignedIn } = useUser();

  const subscribedRaw = user?.publicMetadata?.summittSubscribed;
  const plan = user?.publicMetadata?.summittPlan as string | undefined;

  const isSubscribed =
    subscribedRaw === true ||
    subscribedRaw === "true" ||
    plan === "monthly" ||
    plan === "annual";

  // --------------------------------------------------
  // PUBLIC NAV (logged out) — mirrors product structure
  // --------------------------------------------------
  const publicLinks = [
    { href: "/", label: "Home" },
    { href: "/daily-practice", label: "Daily Practice" },
    { href: "/ask-pat-preview", label: "Ask Pat" },
    { href: "/film-room-preview", label: "Film Room" },
    { href: "/pat-summitt-leadership", label: "Pat Summitt" },
    { href: "/about", label: "About" },
    { href: "/subscribe", label: "Start Free Trial" },
    { href: "/sign-in", label: "Sign In" },
  ];

  // --------------------------------------------------
  // APP NAV (logged in)
  // --------------------------------------------------
  const appLinks = [
    { href: "/", label: "Home" },
    { href: "/dashboard", label: "Daily Practice" },
    { href: "/ask-pat", label: "Ask Pat" },
    { href: "/film-room", label: "Film Room" },
    { href: "/user", label: "Account" },
    ...(!isSubscribed ? [{ href: "/subscribe", label: "Subscribe" }] : []),
  ];

  const navLinks = isSignedIn ? appLinks : publicLinks;

  return (
    <header className="border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="font-semibold text-lg tracking-tight">
          <span className="text-[var(--text)]">Summitt</span>{" "}
          <span className="text-[var(--brand)]">Mindset</span>
        </Link>

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
