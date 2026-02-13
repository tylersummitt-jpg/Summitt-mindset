import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import "./globals.css";

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
    "A calm daily practice system inspired by Coach Pat Summitt.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
        <ClerkProvider
          publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
        >
          <div className="flex flex-col min-h-screen">
            {/* ======================================================
                NAVBAR
               ====================================================== */}
            <Navbar />

            {/* ======================================================
                MAIN CONTENT
                - Pages render on warm paper background
                - Individual pages control their own surfaces
               ====================================================== */}
            <main className="flex-1">{children}</main>

            {/* ======================================================
                FOOTER
                - Anchors the brand
                - Uses true white surface for contrast
               ====================================================== */}
            <footer className="border-t border-[var(--border)] bg-[var(--surface)]">
              <div className="max-w-6xl mx-auto px-4 py-6 text-xs text-[var(--muted)] flex flex-col md:flex-row justify-between gap-4">
                {/* Left */}
                <span>© {new Date().getFullYear()} Summitt Mindset</span>

                {/* Center Links */}
                <div className="flex gap-4 underline">
                  <a href="/privacy">Privacy Policy</a>
                  <a href="/terms">Terms</a>
                  <a href="/sms">SMS Disclosure</a>
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
