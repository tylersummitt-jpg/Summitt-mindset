// src/app/layout.tsx

import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { MetaPixelRoot } from "@/components/MetaPixelRoot";
import { Navbar } from "@/components/Navbar";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

/**
 * ======================================================
 * Root Layout (Global Shell) — AUTHORITATIVE
 * ======================================================
 *
 * This is the permanent frame of Summitt Mindset.
 *
 * DESIGN PRINCIPLES:
 * - Calm
 * - Premium
 * - Minimal
 * - Retention-first
 *
 * IMPORTANT:
 * - Light mode only by design (launch decision)
 * - No visual experiments here
 * - Any brand changes should happen via CSS tokens
 */

export const metadata: Metadata = {
  title: {
    default: "Summitt Mindset",
    template: "%s | Summitt Mindset",
  },
  description:
    "SMS-first accountability on one clear commitment—Coach Pat Summitt’s standards, calm depth in the app, and Victory Room for proof.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${inter.className} min-h-screen bg-[var(--bg)] text-[var(--text)]`}
      >
        <ClerkProvider
          publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
        >
          <MetaPixelRoot />
          <div className="flex flex-col min-h-screen">
            <Navbar />

            <main className="flex-1">{children}</main>

            <footer className="border-t border-[var(--border)] bg-[var(--surface)]">
              <div className="max-w-6xl mx-auto px-4 py-6 text-sm md:text-xs text-[var(--muted)] flex flex-col md:flex-row justify-between gap-4">
                <span>© {new Date().getFullYear()} Summitt Mindset</span>

                <div className="flex flex-wrap gap-x-4 gap-y-2 underline">
                  <a href="/privacy" className="py-0.5">Privacy Policy</a>
                  <a href="/terms" className="py-0.5">Terms</a>
                  <a href="/sms" className="py-0.5">SMS Disclosure</a>
                  <a href="/twilio" className="py-0.5">SMS Opt-In (Twilio)</a>
                </div>

                <span>Inspired by Coach Pat Summitt.</span>
              </div>
            </footer>
          </div>
        </ClerkProvider>
      </body>
    </html>
  );
}
