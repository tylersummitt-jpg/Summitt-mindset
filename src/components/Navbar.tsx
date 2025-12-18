// src/components/Navbar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/summitt-assessment", label: "Summitt Assessment" },
  { href: "/ask-pat", label: "Ask Pat AI" },
  { href: "/modules", label: "Library" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/subscribe", label: "Subscribe" },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="border-b bg-white">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg tracking-tight">
          Summitt Leadership
        </Link>
        <nav className="flex gap-4 text-sm">
          {navLinks.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={
                  "px-2 py-1 rounded " +
                  (active
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

