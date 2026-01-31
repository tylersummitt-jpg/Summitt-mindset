// src/app/layout.tsx

import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import "./globals.css";

/**
 * ======================================================
 * Root Layout (Global Shell)
 * ======================================================
 *
 * This is the permanent frame of Summitt Mindset.
 *
 * Principles:
 * - Calm
 * - Minimal
 * - Retention-first
 * - No “course” or “assessment” framing
 *
 * Footer must stay simple + compliant (Twilio).
 */

export const metadata: Metadata = {
  title: {
    default: "Summitt Mindset",
    template: "%s | Summitt Mindset",
  },
  description:
    "A calm daily practice system inspired by Coach Pat Summitt.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <ClerkProvider
          publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
        >
          <div className="flex flex-col min-h-screen">
            {/* ✅ NAVBAR (simple, focused) */}
            <Navbar />

            {/* ✅ MAIN CONTENT */}
            <main className="flex-1">{children}</main>

            {/* ✅ FOOTER (Compliance + Calm Brand Anchor) */}
            <footer className="border-t bg-white">
              <div className="max-w-6xl mx-auto px-4 py-6 text-xs text-gray-500 flex flex-col md:flex-row justify-between gap-4">
                {/* Left */}
                <span>© {new Date().getFullYear()} Summitt Mindset</span>

                {/* Center Links */}
                <div className="flex gap-4 underline">
                  <a href="/privacy">Privacy Policy</a>
                  <a href="/terms">Terms</a>
                </div>

                {/* Right Brand Ethos */}
                <span>Inspired by Coach Pat Summitt.</span>
              </div>
            </footer>
          </div>
        </ClerkProvider>
      </body>
    </html>
  );
}
